import "dotenv/config";
import express from "express";
import cors from "cors";
import { startRelayer } from "./relayer";
import { createPublicClient, http } from "viem";
import { CHAINS, CHAIN_RPC } from "./chains";
import { EscrowFactoryAbi } from "./factoryAbi";
import { upsertSwap, listSwaps, getSwapByHashlock } from "./store";
import { frames } from "./frames";

const app = express();
app.use(cors({
  origin: ["http://localhost:3000", "http://192.168.1.7:3000", "https://peerswap.vercel.app"],
  credentials: true
}));
app.use(express.json());

app.get("/health", (_req, res) => {
  console.log("🏥 [api] Health check requested");
  res.json({ ok: true });
});


app.post("/swaps", (req, res) => {
  const body = req.body;
  const chainKey = (body.chainKey || "sepolia") as keyof typeof CHAINS;
  const factoryAddress = body.factoryAddress as `0x${string}`;
  
  console.log("📝 [api] New swap creation request:");
  console.log("🌐 [api] Chain:", chainKey);
  console.log("🏭 [api] Factory:", factoryAddress);
  console.log("📊 [api] Execution data:", {
    asker: body.executionData?.asker,
    srcToken: body.executionData?.srcToken,
    dstToken: body.executionData?.dstToken,
    hashlock: body.executionData?.hashlock?.slice(0, 10) + '...',
    srcChainId: body.executionData?.srcChainId,
    dstChainId: body.executionData?.dstChainId
  });
  
  const client = createPublicClient({ chain: CHAINS[chainKey], transport: http(CHAIN_RPC[chainKey]) });
  
  const executionDataForContract = {
    ...body.executionData,
    srcChainId: BigInt(body.executionData.srcChainId),
    dstChainId: BigInt(body.executionData.dstChainId),
    askerAmount: BigInt(body.executionData.askerAmount),
    fullfillerAmount: BigInt(body.executionData.fullfillerAmount),
    platformFee: BigInt(body.executionData.platformFee),
    timelocks: BigInt(body.executionData.timelocks),
  };
  
  console.log("🔍 [api] Computing deterministic escrow addresses...");
  
  Promise.all([
    client.readContract({ address: factoryAddress, abi: EscrowFactoryAbi as any, functionName: "addressOfEscrowSrc", args: [executionDataForContract] }),
    client.readContract({ address: factoryAddress, abi: EscrowFactoryAbi as any, functionName: "addressOfEscrowDst", args: [executionDataForContract] }),
  ]).then(([srcEscrow, dstEscrow]) => {
    console.log("✅ [api] Successfully computed escrow addresses:");
    console.log("📍 [api] Source escrow:", srcEscrow);
    console.log("📍 [api] Destination escrow:", dstEscrow);

    const rec = {
      ...body,
      srcEscrow,
      dstEscrow,
      status: 'pending' as const,
      srcDeployed: false,
      dstDeployed: false
    };
    upsertSwap(rec);
    
    console.log("💾 [api] Swap record stored with hashlock:", body.executionData?.hashlock?.slice(0, 10) + '...');
    console.log("📈 [api] Total swaps in store:", Object.keys((global as any).swapStore || {}).length);
    
    res.json({ ok: true, srcEscrow, dstEscrow });
  }).catch((e) => {
    console.error("❌ [api] Address derivation error:", e);
    console.error("🔧 [api] Failed request details:", {
      chainKey,
      factoryAddress,
      hasExecutionData: !!body.executionData
    });
    res.status(500).json({ ok: false, error: String(e) });
  });
});

app.get("/swaps", (req, res) => {
  const status = req.query.status as string;
  const allSwaps = listSwaps();
  
  // Filter by status if provided
  const swaps = status ? allSwaps.filter(swap => swap.status === status) : allSwaps;
  
  console.log(`📋 [api] Swaps list requested - returning ${swaps.length} swaps${status ? ` with status: ${status}` : ''} (total: ${allSwaps.length})`);
  res.json(swaps);
});

// New endpoint for users to submit secrets for claiming
app.post("/claim", async (req, res) => {
  console.log("🔐 [api] POST /claim - User submitting secret for claiming");
  
  try {
    const { secret, hashlock, userAddress } = req.body;
    
    if (!secret || !hashlock || !userAddress) {
      return res.status(400).json({ error: "Missing required fields: secret, hashlock, userAddress" });
    }
    
    console.log(`🔍 [api] Claim request from ${userAddress} for hashlock: ${hashlock.slice(0, 10)}...`);
    
    // Verify secret matches hashlock
    const { keccak256 } = await import("viem");
    const computedHashlock = keccak256(secret as `0x${string}`);
    
    if (computedHashlock !== hashlock) {
      console.warn(`❌ [api] Secret verification failed for ${userAddress}`);
      return res.status(400).json({ error: "Secret does not match hashlock" });
    }
    
    console.log(`✅ [api] Secret verified for hashlock: ${hashlock.slice(0, 10)}...`);
    
    // Find the swap record
    const swap = getSwapByHashlock(hashlock);
    if (!swap) {
      console.warn(`⚠️ [api] No swap found for hashlock: ${hashlock.slice(0, 10)}...`);
      return res.status(404).json({ error: "Swap not found" });
    }
    
    // Verify user is the asker
    if (swap.executionData.asker.toLowerCase() !== userAddress.toLowerCase()) {
      console.warn(`❌ [api] Unauthorized claim attempt by ${userAddress} for swap owned by ${swap.executionData.asker}`);
      return res.status(403).json({ error: "Only the asker can claim this swap" });
    }
    
    console.log(`🎯 [api] Valid claim request - processing withdrawals for both escrows`);
    
    // Store the secret for the relayer to use
    (global as any).pendingClaims = (global as any).pendingClaims || {};
    (global as any).pendingClaims[hashlock] = {
      secret,
      swap,
      userAddress,
      timestamp: Date.now()
    };
    
    console.log(`📝 [api] Stored pending claim for relayer processing`);
    
    // Trigger immediate processing (instead of waiting for events)
    setImmediate(() => {
      console.log(`⚡ [api] Triggering immediate claim processing for ${hashlock.slice(0, 10)}...`);
      processClaim(hashlock, secret, swap);
    });
    
    res.json({ 
      success: true, 
      message: "Secret verified and withdrawals initiated. Your tokens will be transferred shortly." 
    });
    
  } catch (error) {
    console.error("💥 [api] Error processing claim:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


app.get("/swap-status/:hashlock", async (req, res) => {
  console.log("🔍 [api] GET /swap-status - Checking escrow deployment status");
  
  try {
    const { hashlock } = req.params;
    
    const swap = getSwapByHashlock(hashlock as `0x${string}`);
    if (!swap) {
      return res.status(404).json({ error: "Swap not found" });
    }
    
    const { createPublicClient } = await import("viem");
    
    // Determine chains
    const srcChain = BigInt(swap.executionData.srcChainId) === 11155111n ? "sepolia" : "baseSepolia";
    const dstChain = BigInt(swap.executionData.dstChainId) === 11155111n ? "sepolia" : "baseSepolia";
    
    const srcClient = createPublicClient({ 
      chain: CHAINS[srcChain as keyof typeof CHAINS], 
      transport: http(CHAIN_RPC[srcChain as keyof typeof CHAIN_RPC]) 
    });
    
    const dstClient = createPublicClient({ 
      chain: CHAINS[dstChain as keyof typeof CHAINS], 
      transport: http(CHAIN_RPC[dstChain as keyof typeof CHAIN_RPC]) 
    });
    
    console.log(`🔍 [api] Checking deployment status from swap record:`);
    console.log(`📍 [api] Source escrow (${srcChain}): ${swap.srcEscrow}`);
    console.log(`📍 [api] Destination escrow (${dstChain}): ${swap.dstEscrow}`);
    
    let srcDeployed = false;
    let dstDeployed = false;
    
    try {
      // Check source escrow
      if (swap.srcEscrow) {
        const srcCode = await srcClient.getBytecode({ address: swap.srcEscrow as `0x${string}` });
        srcDeployed = !!(srcCode && srcCode !== "0x");
        console.log(`🔍 [api] Source escrow bytecode check: ${srcDeployed ? 'DEPLOYED' : 'NOT DEPLOYED'}`);
        if (srcCode) {
          console.log(`📝 [api] Source bytecode length: ${srcCode.length} chars`);
        }
      } else {
        console.log(`⚠️ [api] No source escrow address in swap record`);
      }
      
      // Check destination escrow
      if (swap.dstEscrow) {
        const dstCode = await dstClient.getBytecode({ address: swap.dstEscrow as `0x${string}` });
        dstDeployed = !!(dstCode && dstCode !== "0x");
        console.log(`🔍 [api] Destination escrow bytecode check: ${dstDeployed ? 'DEPLOYED' : 'NOT DEPLOYED'}`);
        if (dstCode) {
          console.log(`📝 [api] Destination bytecode length: ${dstCode.length} chars`);
        }
      } else {
        console.log(`⚠️ [api] No destination escrow address in swap record`);
      }
      
      const updatedSwap = {
        ...swap,
        srcDeployed,
        dstDeployed
      };
      upsertSwap(updatedSwap);
      
    } catch (error) {
      console.error(`❌ [api] Error checking escrow bytecode:`, error);
      srcDeployed = swap.srcDeployed ?? false;
      dstDeployed = swap.dstDeployed ?? false;
    }
    
    console.log(`📊 [api] Final escrow status for ${hashlock.slice(0, 10)}: src=${srcDeployed}, dst=${dstDeployed}`);
    
    res.json({
      hashlock,
      srcEscrow: swap.srcEscrow,
      dstEscrow: swap.dstEscrow,
      srcDeployed,
      dstDeployed,
      bothDeployed: srcDeployed && dstDeployed,
      canClaim: srcDeployed && dstDeployed
    });
    
  } catch (error) {
    console.error("💥 [api] Error checking swap status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/check-deployments", async (req, res) => {
  console.log("🔍 [api] POST /check-deployments - Manually checking all swap deployments");
  
  try {
    const { createPublicClient } = await import("viem");
    const allSwaps = listSwaps();
    const results = [];
    
    for (const swap of allSwaps) {
      try {
        const srcChain = swap.executionData.srcChainId === 11155111n ? "sepolia" : "baseSepolia";
        const dstChain = swap.executionData.dstChainId === 11155111n ? "sepolia" : "baseSepolia";
        
        const srcClient = createPublicClient({ 
          chain: CHAINS[srcChain as keyof typeof CHAINS], 
          transport: http(CHAIN_RPC[srcChain as keyof typeof CHAIN_RPC]) 
        });
        
        const dstClient = createPublicClient({ 
          chain: CHAINS[dstChain as keyof typeof CHAINS], 
          transport: http(CHAIN_RPC[dstChain as keyof typeof CHAIN_RPC]) 
        });
        
        let srcDeployed = false;
        let dstDeployed = false;
        
        if (swap.srcEscrow) {
          const srcCode = await srcClient.getBytecode({ address: swap.srcEscrow as `0x${string}` });
          srcDeployed = !!(srcCode && srcCode !== "0x");
        }
        
        if (swap.dstEscrow) {
          const dstCode = await dstClient.getBytecode({ address: swap.dstEscrow as `0x${string}` });
          dstDeployed = !!(dstCode && dstCode !== "0x");
        }
        
        const updatedSwap = {
          ...swap,
          srcDeployed,
          dstDeployed
        };
        upsertSwap(updatedSwap);
        
        results.push({
          hashlock: swap.executionData.hashlock,
          srcEscrow: swap.srcEscrow,
          dstEscrow: swap.dstEscrow,
          srcDeployed,
          dstDeployed,
          bothDeployed: srcDeployed && dstDeployed
        });
        
        console.log(`✅ [api] Updated deployment status for ${swap.executionData.hashlock.slice(0, 10)}: src=${srcDeployed}, dst=${dstDeployed}`);
        
      } catch (error) {
        console.error(`❌ [api] Error checking swap ${swap.executionData.hashlock.slice(0, 10)}:`, error);
        results.push({
          hashlock: swap.executionData.hashlock,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    res.json({
      success: true,
      message: `Checked ${allSwaps.length} swaps`,
      results
    });
    
  } catch (error) {
    console.error("💥 [api] Error checking deployments:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/check-relayer", async (req, res) => {
  console.log("🔍 [api] GET /check-relayer - Checking relayer addresses in factory contracts");
  
  try {
    const { createPublicClient } = await import("viem");
    
    const results = [];
    
    try {
      const sepoliaClient = createPublicClient({ 
        chain: CHAINS.sepolia, 
        transport: http(CHAIN_RPC.sepolia) 
      });
      
      const sepoliaRelayer = await sepoliaClient.readContract({
        address: "0xA26D2Ee1d536b0E17240c8c32D7e894578e21148" as `0x${string}`,
        abi: [
          {
            type: "function",
            stateMutability: "view",
            name: "relayer",
            inputs: [],
            outputs: [{ name: "", type: "address" }],
          },
        ],
        functionName: "relayer",
      });
      
      results.push({
        chain: "sepolia",
        factory: "0xA26D2Ee1d536b0E17240c8c32D7e894578e21148",
        relayer: sepoliaRelayer
      });
      
    } catch (error) {
      results.push({
        chain: "sepolia",
        error: error instanceof Error ? error.message : String(error)
      });
    }
    
    try {
      const baseSepoliaClient = createPublicClient({ 
        chain: CHAINS.baseSepolia, 
        transport: http(CHAIN_RPC.baseSepolia) 
      });
      
      const baseSepoliaRelayer = await baseSepoliaClient.readContract({
        address: "0x1F71948C09EA1702392d463174733d394621Ae17" as `0x${string}`,
        abi: [
          {
            type: "function",
            stateMutability: "view",
            name: "relayer",
            inputs: [],
            outputs: [{ name: "", type: "address" }],
          },
        ],
        functionName: "relayer",
      });
      
      results.push({
        chain: "baseSepolia",
        factory: "0x1F71948C09EA1702392d463174733d394621Ae17",
        relayer: baseSepoliaRelayer
      });
      
    } catch (error) {
      results.push({
        chain: "baseSepolia",
        error: error instanceof Error ? error.message : String(error)
      });
    }
    
    res.json({
      success: true,
      message: "Relayer addresses checked",
      results
    });
    
  } catch (error) {
    console.error("💥 [api] Error checking relayer addresses:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function processClaim(hashlock: string, secret: string, swap: any) {
  console.log(`🔄 [claim] Processing claim for hashlock: ${hashlock.slice(0, 10)}...`);
  
  try {
    const { createWalletClient, createPublicClient } = await import("viem");
    const { privateKeyToAccount } = await import("viem/accounts");
    const { EscrowSrcAbi, EscrowDstAbi } = await import("./abi");
    
    const pk = process.env.RELAYER_PRIVATE_KEY;
    if (!pk) {
      console.error("❌ [claim] RELAYER_PRIVATE_KEY not set");
      return;
    }
    
    const normalizedPk = pk.startsWith('0x') ? pk as `0x${string}` : `0x${pk}` as `0x${string}`;
    const account = privateKeyToAccount(normalizedPk);
    
    // Determine chains
    const srcChain = BigInt(swap.executionData.srcChainId) === 11155111n ? "sepolia" : "baseSepolia";
    const dstChain = BigInt(swap.executionData.dstChainId) === 11155111n ? "sepolia" : "baseSepolia";
    
    console.log(`📍 [claim] Source chain: ${srcChain}, Destination chain: ${dstChain}`);
    
    const srcWallet = createWalletClient({ 
      account, 
      chain: CHAINS[srcChain as keyof typeof CHAINS], 
      transport: http(CHAIN_RPC[srcChain as keyof typeof CHAIN_RPC]) 
    });
    
    const dstWallet = createWalletClient({ 
      account, 
      chain: CHAINS[dstChain as keyof typeof CHAINS], 
      transport: http(CHAIN_RPC[dstChain as keyof typeof CHAIN_RPC]) 
    });
    
    const dstPublicClient = createPublicClient({
      chain: CHAINS[dstChain as keyof typeof CHAINS], 
      transport: http(CHAIN_RPC[dstChain as keyof typeof CHAIN_RPC]) 
    });
    
    console.log(`🔍 [claim] Reading execution data from destination escrow: ${swap.dstEscrow}`);
    const contractExecutionData = await dstPublicClient.readContract({
      address: swap.dstEscrow as `0x${string}`,
      abi: [{
        type: "function",
        name: "executionData", 
        stateMutability: "view",
        inputs: [],
        outputs: [{
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
            { name: "parameters", type: "bytes" }
          ]
        }]
      }],
      functionName: "executionData"
    }) as any;
    
    console.log(`✅ [claim] Retrieved execution data from contract:`, {
      fullfiller: contractExecutionData.fullfiller,
      asker: contractExecutionData.asker,
      hashlock: contractExecutionData.hashlock.slice(0, 10) + '...'
    });
    
    const dstExecutionData = contractExecutionData;
    
    console.log(`🎯 [claim] Withdrawing from destination escrow: ${swap.dstEscrow}`);
    
    const dstTxHash = await dstWallet.writeContract({
      address: swap.dstEscrow as `0x${string}`,
      abi: EscrowDstAbi as any,
      functionName: "withdraw",
      args: [secret as `0x${string}`, dstExecutionData]
    });
    
    console.log(`✅ [claim] Destination withdrawal submitted: ${dstTxHash}`);
    
    console.log(`🔍 [claim] Reading execution data from source escrow: ${swap.srcEscrow}`);
    const srcPublicClient = createPublicClient({
      chain: CHAINS[srcChain as keyof typeof CHAINS], 
      transport: http(CHAIN_RPC[srcChain as keyof typeof CHAIN_RPC]) 
    });
    
    const srcExecutionData = await srcPublicClient.readContract({
      address: swap.srcEscrow as `0x${string}`,
      abi: [{
        type: "function",
        name: "executionData", 
        stateMutability: "view",
        inputs: [],
        outputs: [{
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
            { name: "parameters", type: "bytes" }
          ]
        }]
      }],
      functionName: "executionData"
    }) as any;
    
    console.log(`✅ [claim] Retrieved source execution data:`, {
      fullfiller: srcExecutionData.fullfiller,
      asker: srcExecutionData.asker,
      hashlock: srcExecutionData.hashlock.slice(0, 10) + '...'
    });
    
    console.log(`🎯 [claim] Withdrawing from source escrow: ${swap.srcEscrow}`);
    
    const srcTxHash = await srcWallet.writeContract({
      address: swap.srcEscrow as `0x${string}`,
      abi: EscrowSrcAbi as any,
      functionName: "withdraw",
      args: [secret as `0x${string}`, srcExecutionData]
    });
    
    console.log(`✅ [claim] Source withdrawal submitted: ${srcTxHash}`);
    console.log(`🎉 [claim] Swap completed successfully!`);
    console.log(`📊 [claim] Destination tx: ${dstTxHash}`);
    console.log(`📊 [claim] Source tx: ${srcTxHash}`);
    
    const updatedSwap = { 
      ...swap, 
      status: 'completed',
      completionTxHashes: {
        dstTxHash,
        srcTxHash
      }
    };
    upsertSwap(updatedSwap);
    console.log(`📝 [claim] Marked swap as completed in store with tx hashes`);
    
    if ((global as any).pendingClaims) {
      delete (global as any).pendingClaims[hashlock];
    }
    
  } catch (error) {
    console.error(`💥 [claim] Error processing claim for ${hashlock.slice(0, 10)}:`, error);
  }
}

app.use("/frames", frames);

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`🚀 PeerSwap backend started successfully!`);
  console.log(`📡 Server listening on port: ${port}`);
  console.log(`🌐 CORS enabled for: http://localhost:3000, http://192.168.1.7:3000, https://73b19124b7c3.ngrok-free.app`);
  console.log(`💡 Health check: http://localhost:${port}/health`);
  console.log(`📊 API endpoints: /swaps (GET/POST), /frames`);
});

startRelayer({
  sepolia: {
    EscrowSrc: "0xC3fC39A8877CBEdb1bb081d204Ab068455747F68",
    EscrowDst: "0xA6f855760Cf3EE1b0d09E4aF1Da412Ce6F2213C1",
    Factory: "0xA26D2Ee1d536b0E17240c8c32D7e894578e21148",
  },
  baseSepolia: {
    EscrowSrc: "0x4DB0e9675eB13679C46DEBa7057e1A65bFFF1a7F",
    EscrowDst: "0x17f5d713Fe09e0458EBBb8907746b685877124E8",
    Factory: "0x1F71948C09EA1702392d463174733d394621Ae17",
  },
});


