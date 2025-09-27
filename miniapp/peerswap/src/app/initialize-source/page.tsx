"use client";
import { useEffect, useState } from "react";
import { backend } from "~/lib/backend";
import { Button } from "~/components/ui/Button";
import { NetworkSwitcher } from "~/components/ui/NetworkSwitcher";
import { useAccount, useChainId } from "wagmi";
import { useContractWrite } from "~/hooks/useContractWrite";
import { useRouter } from "next/navigation";
import sdk from "@farcaster/miniapp-sdk";


export default function InitializeSourcePage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const [swaps, setSwaps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notification, setNotification] = useState<{type: 'success' | 'error' | 'info', message: string} | null>(null);
  const [deployedSwaps, setDeployedSwaps] = useState<Set<number>>(new Set());
  
  const { writeContract, isPending } = useContractWrite();

  useEffect(() => {
    setLoading(true);
    backend.listSwaps()
      .then(setSwaps)
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load swaps");
        setSwaps([]);
      })
      .finally(() => {
        setLoading(false);
        // Call ready after content is loaded
        sdk.actions.ready();
      });
  }, []);

  return (
    <div className="container py-4 space-y-3">
      <div className="flex items-center gap-2 mb-4">
        <Button variant="outline" onClick={() => router.back()}>
          ← Back
        </Button>
        <h2 className="text-xl font-semibold">Initialize Source</h2>
      </div>
      
      <div className="card p-3 bg-blue-50 text-blue-800 text-sm">
        <div className="font-medium mb-1">How it works:</div>
        <div className="text-xs">
          Deploy the source escrow contract to lock your tokens. This makes your swap request active and available for others to fulfill.
        </div>
      </div>
      
      {!isConnected && (
        <div className="card p-3 bg-yellow-50 text-yellow-800 text-sm">
          Please connect your wallet to approve tokens
        </div>
      )}
      
      {error && (
        <div className="card p-3 bg-red-50 text-red-800 text-sm">
          {error}
        </div>
      )}

      {/* Notification Display */}
      {notification && (
        <div className={`card p-3 text-sm ${
          notification.type === 'success' ? 'bg-green-50 text-green-800' :
          notification.type === 'error' ? 'bg-red-50 text-red-800' :
          'bg-blue-50 text-blue-800'
        }`}>
          <div className="flex justify-between items-start">
            <div>{notification.message}</div>
            <button 
              onClick={() => setNotification(null)}
              className="ml-2 text-lg leading-none opacity-70 hover:opacity-100"
            >
              ×
            </button>
          </div>
        </div>
      )}
      
      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <div className="spinner h-6 w-6 mx-auto mb-2"></div>
            <p className="text-sm">Loading your swaps...</p>
          </div>
        </div>
      )}
      
      {!loading && swaps.length === 0 && (
        <div className="card p-6 text-center">
          <div className="text-gray-500 mb-2">No swaps to initialize</div>
          <Button onClick={() => router.push("/create-swap")}>
            Create Your First Swap
          </Button>
        </div>
      )}
      
      {!loading && swaps.filter(s => s.executionData.asker?.toLowerCase() === address?.toLowerCase()).map((s, i) => {
        const requiredChainId = parseInt(s.executionData.srcChainId);
        return (
          <div className="card p-4 border-l-4 border-green-500" key={i}>
            <div className="mb-3">
              <div className="font-medium text-sm mb-1">Your Swap #{i + 1}</div>
              <div className="text-xs text-gray-600 space-y-1">
                <div><strong>Hashlock:</strong> {s.executionData.hashlock?.slice(0, 10)}...</div>
                <div><strong>Source Escrow:</strong> {s.srcEscrow?.slice(0, 10)}...</div>
                <div><strong>Source Token:</strong> {s.executionData.srcToken?.slice(0, 10)}...</div>
                <div><strong>Amount:</strong> {s.executionData.askerAmount}</div>
                <div><strong>Chain:</strong> {requiredChainId === 11155111 ? "Sepolia" : "Base Sepolia"}</div>
              </div>
            </div>

            <NetworkSwitcher requiredChainId={requiredChainId} className="mb-3" />
            
            <div className="space-y-2">
              {/* Step 1: Approve tokens (if ERC-20) */}
              {s.executionData.srcToken !== "0x0000000000000000000000000000000000000000" ? (
                <Button
                  size="sm"
                  onClick={async () => {
                    if (!isConnected) {
                      alert("Please connect your wallet first");
                      return;
                    }
                    try {
                      const erc20Abi = [{
                        type: "function", stateMutability: "nonpayable", name: "approve",
                        inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }]
                      }];
                      const amount = BigInt(s.executionData.askerAmount);
                      
                      console.log(`🔐 [init-approval] Requesting approval for ${amount.toString()} tokens to ${s.srcEscrow}`);
                      
                      const txHash = await writeContract({
                        address: s.executionData.srcToken,
                        abi: erc20Abi as any,
                        functionName: "approve",
                        args: [s.srcEscrow, amount],
                        chainId: chainId, // Use current chain for approval
                      });
                      
                      console.log(`⏳ [init-approval] Approval transaction submitted: ${txHash}`);
                      
                      setNotification({type: 'success', message: 'Tokens approved! Now deploy the source escrow.'});
                    } catch (err) {
                      console.error("❌ [init-approval] Approval error:", err);
                      setNotification({type: 'error', message: `Approval failed: ${err instanceof Error ? err.message : 'Unknown error'}`});
                    }
                  }}
                  disabled={isPending || !isConnected}
                  className="w-full"
                >
                  {isPending ? "Approving..." : "1. Approve Tokens"}
                </Button>
              ) : (
                <div className="card p-2 bg-blue-50 text-blue-800 text-xs text-center">
                  ✓ ETH doesn't need approval
                </div>
              )}

              {/* Step 2: Deploy Source Escrow */}
              <Button
                size="sm"
                onClick={async () => {
                  if (!isConnected) {
                    alert("Please connect your wallet first");
                    return;
                  }
                  
                  try {
                    const factoryAbi = [{
                      type: "function", stateMutability: "payable", name: "createSrcEscrow",
                      inputs: [{
                        type: "tuple", name: "executionData", components: [
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
                        ]
                      }], outputs: []
                    }];

                    // Convert string values back to BigInt for the contract call
                    const ed = s.executionData;
                    const execData = {
                      orderHash: ed.orderHash,
                      hashlock: ed.hashlock,
                      asker: ed.asker,
                      fullfiller: ed.fullfiller,
                      srcToken: ed.srcToken,
                      dstToken: ed.dstToken,
                      srcChainId: BigInt(ed.srcChainId),
                      dstChainId: BigInt(ed.dstChainId),
                      askerAmount: BigInt(ed.askerAmount),
                      fullfillerAmount: BigInt(ed.fullfillerAmount),
                      platformFee: BigInt(ed.platformFee),
                      feeCollector: ed.feeCollector,
                      timelocks: BigInt(ed.timelocks ?? 0),
                      parameters: ed.parameters ?? "0x",
                    } as const;

                    const factoryAddress = requiredChainId === 11155111 
                    ? "0xA26D2Ee1d536b0E17240c8c32D7e894578e21148" 
                    : "0x1F71948C09EA1702392d463174733d394621Ae17";
                    const value = s.executionData.srcToken === "0x0000000000000000000000000000000000000000" 
                      ? BigInt(s.executionData.askerAmount) // Send ETH if it's native token
                      : BigInt("0");

                    console.log(`Current chain: ${chainId}, Required chain: ${requiredChainId}`);
                    
                    const txHash = await writeContract({
                      address: factoryAddress,
                      abi: factoryAbi as any,
                      functionName: "createSrcEscrow",
                      args: [execData as any],
                      value,
                      chainId: requiredChainId,
                    });
                    
                    console.log('Transaction hash:', txHash);
                    
                    // Mark this swap as deployed
                    setDeployedSwaps(prev => new Set(prev).add(i));
                    
                    // Refresh the swaps list to get updated data
                    backend.listSwaps().then(setSwaps);
                    
                    setNotification({type: 'success', message: '🎉 Source escrow deployed! Your swap is now active and ready for fulfillment. Once someone fulfills it, use "Claim Your Tokens" to reveal your secret and complete the swap.'});
                  } catch (err) {
                    console.error('Deployment error:', err);
                    let errorMessage = 'Unknown error';
                    if (err instanceof Error) {
                      errorMessage = err.message;
                      // Check for specific chain-related errors
                      if (errorMessage.includes('chainId') || errorMessage.includes('chain')) {
                        errorMessage = `Chain error: Please ensure your wallet supports ${requiredChainId === 11155111 ? 'Sepolia' : 'Base Sepolia'} testnet`;
                      }
                    }
                    setNotification({type: 'error', message: `Deploy failed: ${errorMessage}`});
                  }
                }}
                disabled={isPending || !isConnected || deployedSwaps.has(i)}
                className={`w-full ${deployedSwaps.has(i) ? 'bg-green-500 hover:bg-green-600' : ''}`}
              >
                {deployedSwaps.has(i) ? "✅ Source Escrow Deployed" : 
                 isPending ? "Deploying..." : "2. Deploy Source Escrow"}
              </Button>
              
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => setNotification({type: 'info', message: 'Flow: 1) You deploy source escrow (locks your tokens) 2) Someone deploys destination escrow 3) Relayer reveals secret to complete both sides'})}
                className="w-full"
              >
                How it works
              </Button>
            </div>
          </div>
        );
      })}
      
      {!loading && swaps.filter(s => s.executionData.asker?.toLowerCase() !== address?.toLowerCase()).length > 0 && (
        <div className="card p-3 bg-gray-50 text-gray-600 text-sm text-center">
          Showing only your swaps. Visit "Fulfill Swap" to see others' requests.
        </div>
      )}
    </div>
  );
}


