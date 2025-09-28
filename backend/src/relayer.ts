import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbiItem, decodeEventLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAINS, CHAIN_RPC } from "./chains";
import { EscrowDstAbi, EscrowSrcAbi } from "./abi";
import { getSwapByHashlock, upsertSwap } from "./store";
import { EscrowFactoryAbi } from "./factoryAbi";

type Addresses = {
  sepolia: { EscrowSrc: `0x${string}`; EscrowDst: `0x${string}`; Factory: `0x${string}` };
  baseSepolia: { EscrowSrc: `0x${string}`; EscrowDst: `0x${string}`; Factory: `0x${string}` };
};

function normalizePk(pk?: string): `0x${string}` | null {
  if (!pk) return null;
  const trimmed = pk.trim();
  const hex = trimmed.startsWith("0x") ? trimmed : ("0x" + trimmed) as `0x${string}`;
  if (hex.length !== 66) return null;
  return hex as `0x${string}`;
}

export function startRelayer(addresses: Addresses) {
  console.log("🚀 [relayer] Starting relayer service...");
  console.log("📋 [relayer] Contract addresses:", addresses);
  
  const pk = normalizePk(process.env.RELAYER_PRIVATE_KEY);
  if (!pk) {
    console.warn("⚠️  [relayer] RELAYER_PRIVATE_KEY missing or invalid. Skipping relayer startup.");
    return;
  }
  const account = privateKeyToAccount(pk);
  console.log("🔑 [relayer] Using account:", account.address);

  console.log("🔗 [relayer] RPC URLs being used:");
  console.log("📡 [relayer] Sepolia RPC:", CHAIN_RPC.sepolia);
  console.log("📡 [relayer] Base Sepolia RPC:", CHAIN_RPC.baseSepolia);

  const dstClients = {
    sepolia: createPublicClient({ chain: CHAINS.sepolia, transport: http(CHAIN_RPC.sepolia) }),
    baseSepolia: createPublicClient({ chain: CHAINS.baseSepolia, transport: http(CHAIN_RPC.baseSepolia) }),
  };
  const srcWallets = {
    sepolia: createWalletClient({ account, chain: CHAINS.sepolia, transport: http(CHAIN_RPC.sepolia) }),
    baseSepolia: createWalletClient({ account, chain: CHAINS.baseSepolia, transport: http(CHAIN_RPC.baseSepolia) }),
  };

  console.log("🌐 [relayer] Initialized clients for chains:", Object.keys(dstClients));

  // Listen to factory events for escrow deployments and secret revelations
  async function subscribe(chain: keyof typeof dstClients) {
    const client = dstClients[chain];
    const srcWallet = srcWallets[chain];
    const factory = addresses[chain].Factory;

    console.log(`👂 [${chain}] Setting up factory event listeners for:`, factory);

    // Test RPC connectivity before starting listener
    try {
      const blockNumber = await client.getBlockNumber();
      console.log(`✅ [${chain}] RPC connectivity test passed - latest block:`, blockNumber);
    } catch (rpcError) {
      console.error(`❌ [${chain}] RPC connectivity test failed:`, rpcError);
      console.log(`🔄 [${chain}] Retrying in 10 seconds...`);
      setTimeout(() => subscribe(chain), 10000);
      return;
    }

    let lastProcessedBlock = await client.getBlockNumber();
    console.log(`🎯 [${chain}] Starting factory event polling from block:`, lastProcessedBlock);

    async function pollForFactoryEvents() {
      try {
        const currentBlock = await client.getBlockNumber();
        
        if (currentBlock > lastProcessedBlock) {
          console.log(`🔍 [${chain}] Checking blocks ${lastProcessedBlock + 1n} to ${currentBlock} for factory events...`);
          
          // Get all factory logs and decode them
          const allFactoryLogs = await client.getLogs({
            address: factory,
            fromBlock: lastProcessedBlock + 1n,
            toBlock: currentBlock,
          });

          if (allFactoryLogs.length > 0) {
            console.log(`📋 [${chain}] Found ${allFactoryLogs.length} raw factory log(s) to process`);
          }

          const srcLogs = [];
          const dstLogs = [];
          
          // Decode each log to determine its type
          for (const log of allFactoryLogs) {
            try {
              console.log(`🔍 [${chain}] Processing log from block ${log.blockNumber}, tx ${log.transactionHash}`);
              
              // Try to decode as factory event
              const decoded = decodeEventLog({
                abi: EscrowFactoryAbi,
                data: log.data,
                topics: log.topics,
              });
              
              console.log(`📋 [${chain}] Decoded event: ${decoded.eventName}`);
              
              if (decoded.eventName === 'SrcEscrowCreated') {
                srcLogs.push({ ...log, args: decoded.args });
                console.log(`✅ [${chain}] Added SrcEscrowCreated event`);
              } else if (decoded.eventName === 'DstEscrowCreated') {
                dstLogs.push({ ...log, args: decoded.args });
                console.log(`✅ [${chain}] Added DstEscrowCreated event`);
              } else {
                console.log(`ℹ️ [${chain}] Unknown factory event: ${decoded.eventName}`);
              }
            } catch (e) {
              // Log couldn't be decoded with factory ABI, skip
              console.warn(`⚠️ [${chain}] Could not decode factory log:`, e instanceof Error ? e.message : String(e));
              console.warn(`⚠️ [${chain}] Log data:`, log.data);
              console.warn(`⚠️ [${chain}] Log topics:`, log.topics);
            }
          }

          // Process SrcEscrowCreated events
          for (const log of srcLogs) {
            const executionData = (log.args as any).srcExecutionData;
            const hashlock = executionData.hashlock;

            console.log(`📥 [${chain}] SrcEscrowCreated for hashlock:`, hashlock?.slice(0, 10) + '...');
            console.log(`📊 [${chain}] Execution data:`, {
              asker: executionData.asker,
              srcToken: executionData.srcToken,
              askerAmount: executionData.askerAmount.toString()
            });

            // Update swap record to mark source as deployed
            const swap = getSwapByHashlock(hashlock);
            if (swap) {
              // Determine which chain the source escrow is on
              const srcChainId = BigInt(swap.executionData.srcChainId);
              const isSrcOnSepolia = srcChainId === 11155111n;
              
              // Use the correct client for the source chain
              const srcChainClient = isSrcOnSepolia ? dstClients.sepolia : dstClients.baseSepolia;
              
              console.log(`🔍 [${chain}] Source escrow is on ${isSrcOnSepolia ? 'Sepolia' : 'Base Sepolia'} (chainId: ${srcChainId})`);
              console.log(`🔍 [${chain}] Verifying source escrow on ${isSrcOnSepolia ? 'Sepolia' : 'Base Sepolia'}`);
              
              // Verify the source escrow is actually deployed by checking bytecode on the correct chain
              try {
                const srcCode = await srcChainClient.getBytecode({ address: swap.srcEscrow as `0x${string}` });
                const isActuallyDeployed = !!(srcCode && srcCode !== "0x");
                
                if (isActuallyDeployed) {
                  const updatedSwap = { ...swap, srcDeployed: true };
                  upsertSwap(updatedSwap);
                  console.log(`✅ [${chain}] Verified and marked source escrow as deployed for hashlock:`, hashlock?.slice(0, 10) + '...');
                } else {
                  console.warn(`⚠️ [${chain}] SrcEscrowCreated event detected but contract not actually deployed at:`, swap.srcEscrow);
                  console.warn(`⚠️ [${chain}] This might be a false positive or the deployment failed`);
                }
              } catch (verifyError) {
                console.warn(`⚠️ [${chain}] Could not verify source escrow deployment:`, verifyError);
                // Don't mark as deployed if we can't verify
              }
            } else {
              console.warn(`⚠️ [${chain}] No swap found for hashlock:`, hashlock?.slice(0, 10) + '...');
            }
          }

          // Process DstEscrowCreated events
          for (const log of dstLogs) {
            const { escrow, hashlock, asker } = (log.args as any);

            console.log(`📥 [${chain}] DstEscrowCreated for hashlock:`, hashlock?.slice(0, 10) + '...');
            console.log(`🏠 [${chain}] Destination escrow address:`, escrow);
            console.log(`👤 [${chain}] Asker:`, asker);

            // Update swap record to mark destination as deployed
            const swap = getSwapByHashlock(hashlock);
            if (swap) {
              const updatedSwap = {
                ...swap,
                dstDeployed: true,
                dstEscrow: escrow // Update with actual deployed address
              };
              upsertSwap(updatedSwap);
              console.log(`✅ [${chain}] Marked destination escrow as deployed for hashlock:`, hashlock?.slice(0, 10) + '...');

              // CRITICAL: Set the relayer as fulfiller on the source escrow
              if (swap.srcEscrow && swap.srcDeployed) {
                try {
                  console.log(`🔧 [${chain}] Setting relayer as fulfiller for source escrow:`, swap.srcEscrow);
                  
                  // Determine which chain the source escrow is on
                  const srcChainId = BigInt(swap.executionData.srcChainId);
                  const isSrcOnSepolia = srcChainId === 11155111n;
                  
                  // Get the correct factory address for the source chain
                  const srcFactoryAddress = isSrcOnSepolia 
                    ? "0xA26D2Ee1d536b0E17240c8c32D7e894578e21148"  // Sepolia factory
                    : "0x1F71948C09EA1702392d463174733d394621Ae17"; // Base Sepolia factory
                  
                  console.log(`🔧 [${chain}] Source escrow is on ${isSrcOnSepolia ? 'Sepolia' : 'Base Sepolia'}`);
                  console.log(`🔧 [${chain}] Using source chain factory:`, srcFactoryAddress);
                  console.log(`🔧 [${chain}] Relayer address:`, account.address);
                  
                  // Use the source chain client for the transaction
                  const srcChainClient = isSrcOnSepolia ? dstClients.sepolia : dstClients.baseSepolia;
                  const srcChainWallet = isSrcOnSepolia ? srcWallets.sepolia : srcWallets.baseSepolia;
                  
                  // First verify the source escrow actually exists
                  try {
                    const srcCode = await srcChainClient.getBytecode({ address: swap.srcEscrow as `0x${string}` });
                    if (!srcCode || srcCode === "0x") {
                      console.error(`❌ [${chain}] Source escrow does not exist at address:`, swap.srcEscrow);
                      console.error(`❌ [${chain}] Cannot set fulfiller on non-existent contract`);
                      return;
                    }
                    console.log(`✅ [${chain}] Source escrow verified to exist at:`, swap.srcEscrow);
                  } catch (verifyError) {
                    console.error(`❌ [${chain}] Could not verify source escrow exists:`, verifyError);
                    return;
                  }
                  
                  // Check what relayer address is configured in the source chain factory
                  const factoryRelayer = await srcChainClient.readContract({
                    address: srcFactoryAddress as `0x${string}`,
                    abi: EscrowFactoryAbi as any,
                    functionName: "relayer",
                  });
                  
                  console.log(`🔧 [${chain}] Source chain factory relayer address:`, factoryRelayer);
                  
                  if (factoryRelayer.toLowerCase() !== account.address.toLowerCase()) {
                    console.error(`❌ [${chain}] Relayer address mismatch! Source factory expects: ${factoryRelayer}, but we are: ${account.address}`);
                    console.error(`❌ [${chain}] The source chain factory contract needs to be updated with the correct relayer address`);
                    return;
                  }
                  
                  // Check if the source escrow is active before trying to set fulfiller
                  try {
                    const isActive = await srcChainClient.readContract({
                      address: swap.srcEscrow as `0x${string}`,
                      abi: [
                        {
                          type: "function",
                          stateMutability: "view",
                          name: "isActive",
                          inputs: [],
                          outputs: [{ name: "", type: "bool" }],
                        },
                      ],
                      functionName: "isActive",
                    });
                    
                    console.log(`🔍 [${chain}] Source escrow isActive status:`, isActive);
                    
                    if (!isActive) {
                      console.error(`❌ [${chain}] Source escrow is not active! Cannot set fulfiller.`);
                      return;
                    }
                    
                    // Check current fulfiller address
                    const currentFulfiller = await srcChainClient.readContract({
                      address: swap.srcEscrow as `0x${string}`,
                      abi: [
                        {
                          type: "function",
                          stateMutability: "view",
                          name: "executionData",
                          inputs: [],
                          outputs: [
                            {
                              name: "",
                              type: "tuple",
                              components: [
                                { name: "orderHash", type: "bytes32" },
                                { name: "hashlock", type: "bytes32" },
                                { name: "asker", type: "address" },
                                { name: "fullfiller", type: "address" },
                                { name: "srcToken", type: "address" },
                                { name: "dstToken", type: "address" },
                                { name: "srcChainId", type: "uint256" },
                                { name: "dstChainId", type: "uint256" },
                                { name: "askerAmount", type: "uint256" },
                                { name: "fullfillerAmount", type: "uint256" },
                                { name: "platformFee", type: "uint256" },
                                { name: "feeCollector", type: "address" },
                                { name: "timelocks", type: "uint256" },
                                { name: "parameters", type: "bytes" },
                              ],
                            },
                          ],
                        },
                      ],
                      functionName: "executionData",
                    });
                    
                    console.log(`🔍 [${chain}] Current fulfiller in source escrow:`, currentFulfiller.fullfiller);
                    console.log(`🔍 [${chain}] Trying to set fulfiller to:`, account.address);
                    
                    if (currentFulfiller.fullfiller.toLowerCase() === account.address.toLowerCase()) {
                      console.log(`ℹ️ [${chain}] Relayer is already the fulfiller, skipping setFulfiller call`);
                      return;
                    }
                  } catch (statusError) {
                    console.warn(`⚠️ [${chain}] Could not check escrow status:`, statusError);
                  }
                  
                  const txHash = await srcChainWallet.writeContract({
                    address: srcFactoryAddress as `0x${string}`,
                    abi: EscrowFactoryAbi as any,
                    functionName: "setFulfiller",
                    args: [swap.srcEscrow, account.address], // Set relayer as fulfiller
                  });

                  console.log(`✅ [${chain}] Fulfiller set successfully! Transaction:`, txHash);
                  
                  // Verify the fulfiller was actually set
                  setTimeout(async () => {
                    try {
                      const updatedExecutionData = await srcChainClient.readContract({
                        address: swap.srcEscrow as `0x${string}`,
                        abi: [
                          {
                            type: "function",
                            stateMutability: "view",
                            name: "executionData",
                            inputs: [],
                            outputs: [
                              {
                                name: "",
                                type: "tuple",
                                components: [
                                  { name: "orderHash", type: "bytes32" },
                                  { name: "hashlock", type: "bytes32" },
                                  { name: "asker", type: "address" },
                                  { name: "fullfiller", type: "address" },
                                  { name: "srcToken", type: "address" },
                                  { name: "dstToken", type: "address" },
                                  { name: "srcChainId", type: "uint256" },
                                  { name: "dstChainId", type: "uint256" },
                                  { name: "askerAmount", type: "uint256" },
                                  { name: "fullfillerAmount", type: "uint256" },
                                  { name: "platformFee", type: "uint256" },
                                  { name: "feeCollector", type: "address" },
                                  { name: "timelocks", type: "uint256" },
                                  { name: "parameters", type: "bytes" },
                                ],
                              },
                            ],
                          },
                        ],
                        functionName: "executionData",
                      });
                      
                      console.log(`🔍 [${chain}] Verification - Current fulfiller after setFulfiller:`, updatedExecutionData.fullfiller);
                      
                      if (updatedExecutionData.fullfiller.toLowerCase() === account.address.toLowerCase()) {
                        console.log(`✅ [${chain}] Fulfiller successfully set and verified!`);
                      } else {
                        console.error(`❌ [${chain}] Fulfiller was not set correctly! Expected: ${account.address}, Got: ${updatedExecutionData.fullfiller}`);
                      }
                    } catch (verifyError) {
                      console.error(`❌ [${chain}] Could not verify fulfiller was set:`, verifyError);
                    }
                  }, 5000); // Wait 5 seconds for transaction to be mined

                } catch (e) {
                  console.error(`❌ [${chain}] Failed to set fulfiller:`, e);
                  console.error(`❌ [${chain}] This might be because the relayer address is not set correctly in the source chain factory contract`);
                }
              }
            } else {
              console.warn(`⚠️ [${chain}] No swap found for hashlock:`, hashlock?.slice(0, 10) + '...');
            }
          }

          // Also listen for DstSecretRevealed events from any deployed destination escrows
          // We need to check all destination escrows we know about
          const allSwapsForSecrets = Object.values((global as any).swapStore || {});
          for (const swap of allSwapsForSecrets as any[]) {
            if (swap.dstDeployed && swap.dstEscrow) {
              try {
                const secretLogsRaw = await client.getLogs({
                  address: swap.dstEscrow as `0x${string}`,
                  fromBlock: lastProcessedBlock + 1n,
                  toBlock: currentBlock,
                });

                const secretLogs = [];
                for (const rawLog of secretLogsRaw) {
                  try {
                    const decoded = decodeEventLog({
                      abi: EscrowDstAbi,
                      data: rawLog.data,
                      topics: rawLog.topics,
                    });
                    
                    if (decoded.eventName === 'DstSecretRevealed') {
                      secretLogs.push({ ...rawLog, args: decoded.args });
                    }
                  } catch (e) {
                    // Not a DstSecretRevealed event, skip
                  }
                }

                for (const secretLog of secretLogs) {
                  const { secret, hashlock } = (secretLog.args as any);
                  
                  console.log(`🔐 [${chain}] Secret revealed for hashlock:`, hashlock?.slice(0, 10) + '...');
                  
                  const rec = getSwapByHashlock(hashlock);
                  if (rec) {
                    console.log(`🎯 [${chain}] Processing secret revelation - withdrawing from source escrow:`, rec.srcEscrow);
                    
                    try {
                      const txHash = await srcWallet.writeContract({
                        address: rec.srcEscrow,
                        abi: EscrowSrcAbi as any,
                        functionName: "withdraw",
                        args: [secret, rec.executionData],
                      });
                      
                      console.log(`🎉 [${chain}] Source withdraw transaction submitted successfully!`);
                      console.log(`📋 [${chain}] Transaction hash:`, txHash);
                      
                    } catch (e) {
                      console.error(`❌ [${chain}] Source withdraw transaction failed:`, e);
                    }
                  }
                }
              } catch (error) {
                // Ignore errors for individual escrow checks
                console.warn(`⚠️ [${chain}] Error checking escrow ${swap.dstEscrow} for secret events:`, error instanceof Error ? error.message : String(error));
              }
            }
          }

          if (srcLogs.length > 0 || dstLogs.length > 0) {
            console.log(`📊 [${chain}] Processed ${srcLogs.length} SrcEscrowCreated and ${dstLogs.length} DstEscrowCreated events`);
          } else {
            console.log(`⏰ [${chain}] No new factory events in blocks ${lastProcessedBlock + 1n}-${currentBlock}`);
          }

          // Debug: Check if we have any swaps that should have source escrows deployed
          const allSwapsForDebug = Object.values((global as any).swapStore || {});
          const swapsWithSrcEscrow = allSwapsForDebug.filter((swap: any) => swap.srcEscrow && !swap.srcDeployed);
          if (swapsWithSrcEscrow.length > 0) {
            console.log(`🔍 [${chain}] Found ${swapsWithSrcEscrow.length} swaps with source escrow addresses but not marked as deployed:`);
            swapsWithSrcEscrow.forEach((swap: any) => {
              console.log(`  - Hashlock: ${swap.executionData.hashlock.slice(0, 10)}..., SrcEscrow: ${swap.srcEscrow}, Deployed: ${swap.srcDeployed}`);
            });

            // Fallback: Check if source escrows are actually deployed by checking bytecode
            for (const swap of swapsWithSrcEscrow) {
              try {
                const swapData = swap as any;
                console.log(`🔍 [${chain}] Checking bytecode for source escrow: ${swapData.srcEscrow}`);
                const srcCode = await client.getBytecode({ address: swapData.srcEscrow as `0x${string}` });
                const isDeployed = !!(srcCode && srcCode !== "0x");
                
                if (isDeployed) {
                  console.log(`✅ [${chain}] Source escrow is actually deployed! Updating record for hashlock: ${swapData.executionData.hashlock.slice(0, 10)}...`);
                  const updatedSwap = { ...swapData, srcDeployed: true };
                  upsertSwap(updatedSwap);
                } else {
                  console.log(`❌ [${chain}] Source escrow is not deployed at: ${swapData.srcEscrow}`);
                }
              } catch (error) {
                console.error(`💥 [${chain}] Error checking source escrow bytecode:`, error);
              }
            }
          }

          lastProcessedBlock = currentBlock;
        }
      } catch (error) {
        console.error(`💥 [${chain}] Error polling for factory events:`, error);
      }

      // Poll every 10 seconds
      setTimeout(pollForFactoryEvents, 10000);
    }

    // Start polling
    pollForFactoryEvents();
    console.log(`✅ [${chain}] Factory event polling successfully started (10s intervals)`);
  }

  subscribe("sepolia");
  subscribe("baseSepolia");
  
  console.log("🎯 [relayer] All event listeners are now active!");
  console.log("⏳ [relayer] Waiting for DstSecretRevealed events to trigger source withdrawals...");
}


