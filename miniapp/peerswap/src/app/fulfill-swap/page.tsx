"use client";
import { useEffect, useState } from "react";
import { backend } from "~/lib/backend";
import { Button } from "~/components/ui/Button";
import { useAccount, usePublicClient, useWalletClient, useBalance, useChainId } from "wagmi";
import { useRouter, useSearchParams } from "next/navigation";
import sdk from "@farcaster/miniapp-sdk";
import { formatTokenAmount, getTokenDecimals, getTokenSymbol } from "~/utils/formatAmount";
import { parseUnits, formatUnits, formatEther, erc20Abi } from "viem";
import { ChainSwitcher } from "~/components/ui/ChainSwitcher";
import { sepolia, baseSepolia } from "wagmi/chains";
import { handleTokenApproval, requiresApproval } from "~/utils/approvalUtils";

// Token addresses for testnets
const TOKENS = {
  sepolia: {
    USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    ETH: "0x0000000000000000000000000000000000000000",
  },
  baseSepolia: {
    USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    ETH: "0x0000000000000000000000000000000000000000",
  }
};

interface StepInfo {
  key: string;
  label: string;
  description: string;
  isActive: boolean;
  isCompleted: boolean;
}

type TransactionStep =
  | 'idle'
  | 'checking-allowance'
  | 'approving'
  | 'waiting-approval'
  | 'fulfilling'
  | 'deploying-dst'
  | 'completed'
  | 'error';

export default function FulfillSwapPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const swapId = searchParams.get('swapId');

  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();

  const [swap, setSwap] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [txStep, setTxStep] = useState<TransactionStep>('idle');
  const [txHash, setTxHash] = useState<string>("");
  const [fulfilled, setFulfilled] = useState(false);
  const [dstEscrowAddress, setDstEscrowAddress] = useState<string>("");

  // Get token balances
  const { data: ethBalance } = useBalance({ address });

  // Check if on correct chain for this swap
  const isCorrectChain = swap?.executionData
    ? (Number(swap.executionData.dstChainId) === sepolia.id && chainId === sepolia.id) ||
      (Number(swap.executionData.dstChainId) === baseSepolia.id && chainId === baseSepolia.id)
    : true; // Default to true if swap not loaded yet

  // Debug logging for chain mismatch issues
  useEffect(() => {
    if (swap?.executionData) {
      console.log("🔍 [fulfill] Chain Debug Info:");
      console.log("📊 [fulfill] Current Chain ID:", chainId);
      console.log("📊 [fulfill] Required Dst Chain ID:", swap.executionData.dstChainId);
      console.log("📊 [fulfill] Sepolia ID:", sepolia.id);
      console.log("📊 [fulfill] Base Sepolia ID:", baseSepolia.id);
      console.log("📊 [fulfill] Is Correct Chain:", isCorrectChain);
      console.log("📊 [fulfill] Expected condition 1:", Number(swap.executionData.dstChainId) === sepolia.id && chainId === sepolia.id);
      console.log("📊 [fulfill] Expected condition 2:", Number(swap.executionData.dstChainId) === baseSepolia.id && chainId === baseSepolia.id);
    }
  }, [swap, chainId, isCorrectChain]);

  // Query USDC balance on correct chain
  const { data: usdcBalance } = useBalance({
    address,
    token: swap?.executionData?.dstToken && swap.executionData.dstToken !== "0x0000000000000000000000000000000000000000" ? swap.executionData.dstToken as `0x${string}` : undefined,
    query: {
      enabled: !!address && isCorrectChain && !!swap?.executionData?.dstToken,
    }
  });


  useEffect(() => {
    loadSwap();
  }, [swapId]);

  useEffect(() => {
    if (!loading) {
      sdk.actions.ready();
    }
  }, [loading]);

  const loadSwap = async () => {
    setLoading(true);
    try {
      const swaps = await backend.listSwaps();
      if (swapId && swaps[parseInt(swapId)]) {
        setSwap(swaps[parseInt(swapId)]);
      } else {
        setError("Swap not found");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load swap");
    } finally {
      setLoading(false);
    }
  };

  const getStepMessage = (step: TransactionStep): string => {
    switch (step) {
      case 'checking-allowance': return "Checking token allowance...";
      case 'approving': return "Requesting token approval...";
      case 'waiting-approval': return "Waiting for approval confirmation...";
      case 'fulfilling': return "Fulfilling swap order...";
      case 'deploying-dst': return "Deploying destination escrow...";
      case 'completed': return "Swap fulfilled successfully!";
      case 'error': return "Transaction failed";
      default: return "";
    }
  };

  const getProgressSteps = (tokenSymbol: string): StepInfo[] => {
    const steps: StepInfo[] = [
      {
        key: 'approval',
        label: 'Token Approval',
        description: tokenSymbol === 'ETH' ? 'No approval needed for ETH' : `Approve ${tokenSymbol} spending`,
        isCompleted: tokenSymbol === 'ETH' || ['waiting-approval', 'fulfilling', 'deploying-dst', 'completed'].includes(txStep),
        isActive: ['checking-allowance', 'approving', 'waiting-approval'].includes(txStep)
      },
      {
        key: 'fulfill',
        label: 'Process Swap',
        description: 'Submit fulfillment transaction',
        isCompleted: ['deploying-dst', 'completed'].includes(txStep),
        isActive: txStep === 'fulfilling'
      },
      {
        key: 'deploy',
        label: 'Lock Tokens',
        description: 'Deploy destination escrow',
        isCompleted: txStep === 'completed',
        isActive: txStep === 'deploying-dst'
      }
    ];

    return steps.filter(step => {
      if (step.key === 'approval' && tokenSymbol === 'ETH') {
        return false; // Skip approval step for ETH
      }
      return true;
    });
  };

  const fulfillSwapWithFlow = async () => {
    if (!isConnected || !address || !walletClient || !publicClient || !swap) {
      setError("Please connect your wallet first");
      return;
    }

    setError("");
    setTxStep('checking-allowance');

    try {
      const tokenSymbol = getTokenSymbol(swap.executionData.dstToken);
      const tokenDecimals = getTokenDecimals(swap.executionData.dstToken);
      const fulfillAmount = swap?.executionData?.fullfillerAmount ? BigInt(swap.executionData.fullfillerAmount) : 0n;

      // Check if sufficient balance
      const currentBalance = tokenSymbol === "ETH" ? ethBalance?.value : usdcBalance?.value;
      if (!currentBalance || currentBalance < fulfillAmount) {
        throw new Error(`Insufficient ${tokenSymbol} balance`);
      }

      // Get factory address for destination chain
      const factoryAddress = Number(swap.executionData.dstChainId) === sepolia.id
        ? "0xA26D2Ee1d536b0E17240c8c32D7e894578e21148"  // Sepolia factory
        : "0x1F71948C09EA1702392d463174733d394621Ae17"; // Base Sepolia factory

      // Step 1: Handle token approval (only for ERC20 tokens)
      if (requiresApproval(swap.executionData.dstToken)) {
        setTxStep('approving');
        
        // Get the deterministic destination escrow address first
        const escrowAddress = await publicClient.readContract({
          address: factoryAddress as `0x${string}`,
          abi: [
            {
              type: "function",
              name: "addressOfEscrowDst",
              inputs: [
                {
                  type: "tuple",
                  name: "executionData",
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
              outputs: [{ name: "", type: "address" }],
              stateMutability: "view",
            },
          ],
          functionName: "addressOfEscrowDst",
          args: [swap.executionData],
        });

        console.log(`🏠 [fulfill-approval] Destination escrow address: ${escrowAddress}`);
        
        const approvalResult = await handleTokenApproval(
          publicClient,
          walletClient,
          swap.executionData.dstToken as `0x${string}`,
          escrowAddress as `0x${string}`,
          fulfillAmount,
          address,
          { maxRetries: 3, retryDelay: 2000 }
        );

        if (!approvalResult.success) {
          throw new Error(approvalResult.error || "Token approval failed");
        }

        if (approvalResult.txHash) {
          setTxHash(approvalResult.txHash);
          setTxStep('waiting-approval');
        }
      }

      // Step 2: Deploy destination escrow with tokens
      setTxStep('deploying-dst');

      // Prepare execution data for destination escrow deployment
      const dstExecutionData = {
        orderHash: swap.executionData.orderHash as `0x${string}`,
        hashlock: swap.executionData.hashlock as `0x${string}`,
        asker: swap.executionData.asker as `0x${string}`,
        fullfiller: address, // Set the fulfiller address
        srcToken: swap.executionData.srcToken as `0x${string}`,
        dstToken: swap.executionData.dstToken as `0x${string}`,
        srcChainId: BigInt(swap.executionData.srcChainId),
        dstChainId: BigInt(swap.executionData.dstChainId),
        askerAmount: BigInt(swap.executionData.askerAmount),
        fullfillerAmount: fulfillAmount,
        platformFee: BigInt(swap.executionData.platformFee),
        feeCollector: swap.executionData.feeCollector as `0x${string}`,
        timelocks: BigInt(swap.executionData.timelocks),
        parameters: swap.executionData.parameters as `0x${string}`,
      };

      // Factory ABI for createDstEscrow function
      const factoryAbi = [
        {
          type: "function",
          stateMutability: "payable",
          name: "createDstEscrow",
          inputs: [
            {
              type: "tuple",
              name: "executionData",
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
          outputs: [],
        },
      ];

      // Deploy destination escrow contract
      const deployTx = await walletClient.writeContract({
        address: factoryAddress as `0x${string}`,
        abi: factoryAbi,
        functionName: 'createDstEscrow',
        args: [dstExecutionData],
        value: dstTokenSymbol === "ETH" ? fulfillAmount : 0n, // Send ETH if destination token is ETH
      });

      setTxHash(deployTx);

      // Wait for deployment transaction to be confirmed
      const receipt = await publicClient.waitForTransactionReceipt({ hash: deployTx });

      if (receipt.status === 'success') {
        console.log(`✅ [fulfill] Destination escrow deployed successfully`);
        
        // Get the deployed escrow address
        const dstEscrowAddress = await publicClient.readContract({
          address: factoryAddress as `0x${string}`,
          abi: [
            {
              type: "function",
              name: "addressOfEscrowDst",
              inputs: [
                {
                  type: "tuple",
                  name: "executionData",
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
              outputs: [{ name: "", type: "address" }],
              stateMutability: "view",
            },
          ],
          functionName: "addressOfEscrowDst",
          args: [dstExecutionData],
        });

        setDstEscrowAddress(dstEscrowAddress);
        setFulfilled(true);
        setTxStep('completed');
      } else {
        throw new Error("Destination escrow deployment failed");
      }

    } catch (err) {
      console.error("Fulfill swap error:", err);

      let errorMessage = "Failed to fulfill swap";
      if (err instanceof Error) {
        if (err.message.includes("User denied transaction signature")) {
          errorMessage = "Transaction was cancelled by user";
        } else if (err.message.includes("insufficient funds")) {
          errorMessage = "Insufficient funds for transaction";
        } else if (err.message.includes("allowance")) {
          errorMessage = "Token approval failed - please try again";
        } else if (err.message.includes("network")) {
          errorMessage = "Network error - please check your connection";
        } else {
          errorMessage = err.message;
        }
      }

      setError(errorMessage);
      setTxStep('error');
    }
  };

  const isLoading = txStep !== 'idle' && txStep !== 'completed' && txStep !== 'error';

  if (loading) {
    return (
      <div className="container py-4">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  if (error && !swap) {
    return (
      <div className="container py-4">
        <div className="card p-4 bg-red-50 border-red-200">
          <div className="text-red-800">{error}</div>
          <Button className="mt-3" onClick={() => router.back()}>
            ← Back
          </Button>
        </div>
      </div>
    );
  }

  if (!swap) return null;

  const srcTokenSymbol = getTokenSymbol(swap?.executionData?.srcToken);
  const srcTokenDecimals = getTokenDecimals(swap?.executionData?.srcToken);
  const dstTokenSymbol = getTokenSymbol(swap?.executionData?.dstToken);
  const dstTokenDecimals = getTokenDecimals(swap?.executionData?.dstToken);

  return (
    <div className="container py-4 space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Button variant="outline" onClick={() => router.back()}>
          ← Back
        </Button>
        <h2 className="text-xl font-semibold">Fulfill Swap</h2>
      </div>

      {!isConnected && (
        <div className="card p-3 bg-yellow-50 text-yellow-800 text-sm">
          Please connect your wallet to fulfill this swap
        </div>
      )}

      {/* Chain Switcher - Show when connected but on wrong chain */}
      {isConnected && swap?.executionData && (
        <ChainSwitcher
          requiredChainId={Number(swap.executionData.dstChainId) === sepolia.id ? sepolia.id : baseSepolia.id}
          requiredChainName={Number(swap.executionData.dstChainId) === sepolia.id ? "Sepolia" : "Base Sepolia"}
        />
      )}


      {error && (
        <div className="card p-4 bg-red-50 border border-red-200">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <div className="flex-1">
              <div className="text-sm font-medium text-red-800 mb-1">Transaction Failed</div>
              <div className="text-sm text-red-700">{error}</div>
              {txStep === 'error' && (
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setError("");
                      setTxStep('idle');
                      setTxHash("");
                    }}
                    className="text-red-700 border-red-300 hover:bg-red-50"
                  >
                    Try Again
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Progress Steps */}
      {(isLoading || txStep === 'completed') && (
        <div className="card p-4">
          <h3 className="font-medium text-gray-900 mb-4">Transaction Progress</h3>
          <div className="space-y-3">
            {getProgressSteps(dstTokenSymbol).map((step, index) => (
              <div key={step.key} className="flex items-center gap-3">
                <div className={`
                  flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                  ${step.isCompleted
                    ? 'bg-green-100 text-green-700 ring-2 ring-green-200'
                    : step.isActive
                      ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-200'
                      : 'bg-gray-100 text-gray-500'
                  }
                `}>
                  {step.isCompleted ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : step.isActive ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                  ) : (
                    index + 1
                  )}
                </div>
                <div className="flex-1">
                  <div className={`font-medium ${
                    step.isCompleted ? 'text-green-700' :
                    step.isActive ? 'text-blue-700' : 'text-gray-500'
                  }`}>
                    {step.label}
                  </div>
                  <div className={`text-sm ${
                    step.isCompleted ? 'text-green-600' :
                    step.isActive ? 'text-blue-600' : 'text-gray-400'
                  }`}>
                    {step.description}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Current Action */}
          {isLoading && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="text-sm font-medium text-gray-900">{getStepMessage(txStep)}</div>
              {txHash && (
                <div className="text-xs text-gray-500 mt-1">
                  Transaction: {txHash.slice(0, 10)}...{txHash.slice(-6)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Swap Details */}
      <div className="card p-4">
        <h3 className="text-lg font-medium mb-4">Swap Details</h3>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div className="card p-3 bg-blue-50">
              <div className="text-sm font-medium text-blue-800">They Give</div>
              <div className="text-lg font-semibold">
                {formatTokenAmount(swap?.executionData?.askerAmount, srcTokenDecimals, srcTokenSymbol)}
              </div>
              <div className="text-xs text-blue-600">
                Chain: {Number(swap?.executionData?.srcChainId) === sepolia.id ? "Sepolia" : "Base Sepolia"}
              </div>
            </div>

            <div className="card p-3 bg-green-50">
              <div className="text-sm font-medium text-green-800">You Give</div>
              <div className="text-lg font-semibold">
                {formatTokenAmount(swap?.executionData?.fullfillerAmount, dstTokenDecimals, dstTokenSymbol)}
              </div>
              <div className="text-xs text-green-600">
                Chain: {Number(swap?.executionData?.dstChainId) === sepolia.id ? "Sepolia" : "Base Sepolia"}
              </div>
            </div>
          </div>

          <div className="card p-3 bg-gray-50 text-sm">
            <div className="flex items-center justify-between mb-1">
              <div className="font-medium">Your Balance:</div>
              {(() => {
                const currentBalance = dstTokenSymbol === "ETH" ? ethBalance?.value : usdcBalance?.value;
                const fulfillAmount = swap?.executionData?.fullfillerAmount ? BigInt(swap.executionData.fullfillerAmount) : 0n;
                const isInsufficient = !currentBalance || currentBalance < fulfillAmount;

                return isInsufficient ? (
                  <div className="text-xs text-red-600 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    Insufficient balance
                  </div>
                ) : (
                  <div className="text-xs text-green-600 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Sufficient balance
                  </div>
                );
              })()}
            </div>
            <div>
              {dstTokenSymbol === "ETH"
                ? ethBalance ? formatEther(ethBalance.value) : "0"
                : usdcBalance ? formatUnits(usdcBalance.value, dstTokenDecimals) : "0"
              } {dstTokenSymbol}
            </div>
          </div>

          <div className="card p-3 bg-gray-50 text-sm">
            <div className="font-medium mb-1">Transaction Summary:</div>
            <div>• You provide {formatTokenAmount(swap?.executionData?.fullfillerAmount, dstTokenDecimals, dstTokenSymbol)}</div>
            <div>• You receive {formatTokenAmount(swap?.executionData?.askerAmount, srcTokenDecimals, srcTokenSymbol)}</div>
            <div className="text-xs text-gray-600 mt-1">
              Asker: {swap?.executionData?.asker?.slice(0, 6)}...{swap?.executionData?.asker?.slice(-4)}
            </div>
          </div>
        </div>
      </div>

      {/* Action Button with Preview */}
      {!fulfilled && !isLoading && isConnected && swap && (
        <div className="card p-4 bg-gradient-to-r from-purple-50 to-green-50 border border-purple-200">
          <div className="text-sm font-medium text-gray-900 mb-2">Ready to fulfill swap order:</div>
          <div className="text-sm text-gray-700 mb-3">
            {dstTokenSymbol !== 'ETH' && (
              <div className="flex items-center gap-2 text-orange-700 bg-orange-50 px-2 py-1 rounded mb-2">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span>You'll need to approve {dstTokenSymbol} spending first</span>
              </div>
            )}
            <div>• Approve {dstTokenSymbol !== 'ETH' ? `${dstTokenSymbol} spending and ` : ''}lock your tokens</div>
            <div>• Provide {formatTokenAmount(swap?.executionData?.fullfillerAmount, dstTokenDecimals, dstTokenSymbol)} on {swap?.executionData?.dstChainId === 11155111n ? "Sepolia" : "Base Sepolia"}</div>
            <div>• Receive {formatTokenAmount(swap?.executionData?.askerAmount, srcTokenDecimals, srcTokenSymbol)} when completed</div>
          </div>
        </div>
      )}

      {/* Single Action Button */}
      <Button
        onClick={fulfillSwapWithFlow}
        disabled={isLoading || !isConnected || fulfilled || !isCorrectChain || (() => {
          if (!swap) return true;
          const currentBalance = dstTokenSymbol === "ETH" ? ethBalance?.value : usdcBalance?.value;
          const fulfillAmount = swap?.executionData?.fullfillerAmount ? BigInt(swap.executionData.fullfillerAmount) : 0n;
          return !currentBalance || currentBalance < fulfillAmount;
        })()}
        isLoading={isLoading}
        className="w-full"
      >
        {!isCorrectChain ? `Switch to ${swap?.executionData?.dstChainId === 11155111n ? "Sepolia" : "Base Sepolia"} First` :
         isLoading ? getStepMessage(txStep) : fulfilled ? "Swap Fulfilled ✓" :
         dstTokenSymbol !== 'ETH' ? "Approve & Fulfill Swap" : "Fulfill Swap Order"}
      </Button>

      {fulfilled && dstEscrowAddress && (
        <div className="card p-4 bg-green-50 border-green-200">
          <div className="text-sm font-medium text-green-800 mb-2">🎉 Swap Fulfilled Successfully!</div>
          <div className="text-xs space-y-1 mb-3">
            <div><strong>Destination Escrow:</strong> {dstEscrowAddress?.slice(0, 10)}...{dstEscrowAddress?.slice(-6)}</div>
          </div>
          <div className="text-xs text-green-700 mb-3">
            Your {dstTokenSymbol} tokens have been locked. Once the asker reveals the secret, you'll automatically receive their {srcTokenSymbol} tokens.
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => router.push("/")}>
              ← Back to Home
            </Button>
            <Button size="sm" variant="outline" onClick={() => {
              setFulfilled(false);
              setTxStep('idle');
              setDstEscrowAddress("");
              loadSwap(); // Refresh swap data
            }}>
              View Updated Status
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}