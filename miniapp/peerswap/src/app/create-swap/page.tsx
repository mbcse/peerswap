"use client";
import { useState, useEffect } from "react";
import { backend } from "~/lib/backend";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Button } from "~/components/ui/Button";
import { useRouter } from "next/navigation";
import { useAccount, usePublicClient, useWalletClient, useBalance, useChainId } from "wagmi";
import { keccak256, toHex, parseEther, parseUnits, formatEther, formatUnits, erc20Abi } from "viem";
import sdk from "@farcaster/miniapp-sdk";
import { ChainSwitcher } from "~/components/ui/ChainSwitcher";
import { sepolia, baseSepolia } from "wagmi/chains";
import { handleTokenApproval, requiresApproval } from "~/utils/approvalUtils";
import { SelfVerification } from "~/components/SelfVerification";
import { useSelfVerification } from "~/hooks/useSelfVerification";

// Token addresses for testnets
const TOKENS = {
  sepolia: {
    USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // USDC on Sepolia
    ETH: "0x0000000000000000000000000000000000000000", // Native ETH
  },
  baseSepolia: {
    USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // USDC on Base Sepolia
    ETH: "0x0000000000000000000000000000000000000000", // Native ETH
  }
};

type TransactionStep =
  | 'idle'
  | 'checking-allowance'
  | 'approving'
  | 'waiting-approval'
  | 'creating-swap'
  | 'deploying-escrow'
  | 'completed'
  | 'error';

interface StepInfo {
  key: string;
  label: string;
  description: string;
  isActive: boolean;
  isCompleted: boolean;
}

export default function CreateSwapPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();

  const [srcChain, setSrcChain] = useState("sepolia");
  const [dstChain, setDstChain] = useState("baseSepolia");
  const [srcTokenType, setSrcTokenType] = useState("USDC");
  const [dstTokenType, setDstTokenType] = useState("USDC");
  const [srcAmount, setSrcAmount] = useState("1"); // Human readable amount
  const [dstAmount, setDstAmount] = useState("1"); // Human readable amount

  const [txStep, setTxStep] = useState<TransactionStep>('idle');
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState<string>("");
  const [srcEscrow, setSrcEscrow] = useState<string>("");
  const [dstEscrow, setDstEscrow] = useState<string>("");
  const [swapCreated, setSwapCreated] = useState(false);
  const [showVerification, setShowVerification] = useState(false);
  const { isVerified, setVerification } = useSelfVerification(address);

  // Get token balances - only query when on correct chain
  const isCorrectChain = (srcChain === "sepolia" && chainId === sepolia.id) ||
                        (srcChain === "baseSepolia" && chainId === baseSepolia.id);

  const { data: ethBalance } = useBalance({
    address: address,
    query: {
      enabled: !!address && isCorrectChain,
    }
  });

  const { data: usdcBalance } = useBalance({
    address: address,
    token: TOKENS[srcChain as keyof typeof TOKENS].USDC as `0x${string}`,
    query: {
      enabled: !!address && isCorrectChain,
    }
  });

  useEffect(() => {
    sdk.actions.ready();
  }, []);

  const getStepMessage = (step: TransactionStep): string => {
    switch (step) {
      case 'checking-allowance': return "Checking token allowance...";
      case 'approving': return "Requesting token approval...";
      case 'waiting-approval': return "Waiting for approval confirmation...";
      case 'creating-swap': return "Creating swap order...";
      case 'deploying-escrow': return "Deploying escrow contracts...";
      case 'completed': return "Swap created successfully!";
      case 'error': return "Transaction failed";
      default: return "";
    }
  };

  const getProgressSteps = (): StepInfo[] => {
    const steps: StepInfo[] = [
      {
        key: 'approval',
        label: 'Token Approval',
        description: srcTokenType === 'ETH' ? 'No approval needed for ETH' : 'Approve token spending',
        isCompleted: srcTokenType === 'ETH' || ['waiting-approval', 'creating-swap', 'deploying-escrow', 'completed'].includes(txStep),
        isActive: ['checking-allowance', 'approving', 'waiting-approval'].includes(txStep)
      },
      {
        key: 'create',
        label: 'Create Order',
        description: 'Generate swap parameters',
        isCompleted: ['deploying-escrow', 'completed'].includes(txStep),
        isActive: txStep === 'creating-swap'
      },
      {
        key: 'deploy',
        label: 'Deploy Contract',
        description: 'Deploy escrow contract',
        isCompleted: txStep === 'completed',
        isActive: txStep === 'deploying-escrow'
      }
    ];

    return steps.filter(step => {
      if (step.key === 'approval' && srcTokenType === 'ETH') {
        return false; // Skip approval step for ETH
      }
      return true;
    });
  };

  async function createSwapWithFlow() {
    if (!isConnected || !address || !walletClient || !publicClient) {
      setError("Please connect your wallet first");
      return;
    }

    if (!srcAmount || !dstAmount) {
      setError("Please enter amounts");
      return;
    }

    setError("");
    setTxStep('checking-allowance');

    try {
      // Convert amounts to proper decimals
      const srcDecimals = srcTokenType === "USDC" ? 6 : 18;
      const dstDecimals = dstTokenType === "USDC" ? 6 : 18;
      const srcAmountWei = parseUnits(srcAmount, srcDecimals);
      const dstAmountWei = parseUnits(dstAmount, dstDecimals);

      // Check if sufficient balance
      const currentBalance = srcTokenType === "ETH" ? ethBalance?.value : usdcBalance?.value;
      if (!currentBalance || currentBalance < srcAmountWei) {
        throw new Error(`Insufficient ${srcTokenType} balance`);
      }

      // Factory address for source chain
      const factoryAddress = srcChain === "sepolia"
        ? "0xA26D2Ee1d536b0E17240c8c32D7e894578e21148"
        : "0x1F71948C09EA1702392d463174733d394621Ae17" as const;

      // Step 1: Generate swap data first (needed for escrow address)
      setTxStep('creating-swap');

      const secret = "0x" + Array.from({length: 64}, () => Math.floor(Math.random() * 16).toString(16)).join("");
      const hashlock = keccak256(secret as `0x${string}`);

      // Store secret locally
      const swapId = `${hashlock}_${Date.now()}`;
      localStorage.setItem(`secret_${swapId}`, secret);
      localStorage.setItem(`swap_${swapId}`, JSON.stringify({
        secret,
        hashlock,
        srcChain,
        dstChain,
        srcAmount,
        dstAmount,
        srcTokenType,
        dstTokenType,
        created: Date.now()
      }));

      const executionData = {
        orderHash: "0x" + "0".repeat(64),
        hashlock,
        asker: address,
        fullfiller: "0x0000000000000000000000000000000000000000",
        srcToken: TOKENS[srcChain as keyof typeof TOKENS][srcTokenType as keyof typeof TOKENS.sepolia],
        dstToken: TOKENS[dstChain as keyof typeof TOKENS][dstTokenType as keyof typeof TOKENS.sepolia],
        srcChainId: srcChain === "sepolia" ? "11155111" : "84532",
        dstChainId: dstChain === "sepolia" ? "11155111" : "84532",
        askerAmount: srcAmountWei.toString(),
        fullfillerAmount: dstAmountWei.toString(),
        platformFee: "100",
        feeCollector: address as `0x${string}`,
        timelocks: "0",
        parameters: "0x",
      };

      // Prepare execution data for contract call (with BigInt values)
      const executionDataForContract = {
        orderHash: executionData.orderHash as `0x${string}`,
        hashlock: executionData.hashlock as `0x${string}`,
        asker: executionData.asker as `0x${string}`,
        fullfiller: executionData.fullfiller as `0x${string}`,
        srcToken: executionData.srcToken as `0x${string}`,
        dstToken: executionData.dstToken as `0x${string}`,
        srcChainId: BigInt(executionData.srcChainId),
        dstChainId: BigInt(executionData.dstChainId),
        askerAmount: srcAmountWei,
        fullfillerAmount: dstAmountWei,
        platformFee: BigInt(executionData.platformFee),
        feeCollector: executionData.feeCollector as `0x${string}`,
        timelocks: BigInt(executionData.timelocks),
        parameters: executionData.parameters as `0x${string}`,
      };

      // Step 2: Get the escrow address and handle token approval (only for ERC20 tokens)
      if (srcTokenType !== "ETH") {
        const tokenAddress = TOKENS[srcChain as keyof typeof TOKENS][srcTokenType as keyof typeof TOKENS.sepolia] as `0x${string}`;

        if (requiresApproval(tokenAddress)) {
          setTxStep('approving');
          
          // Get the deterministic escrow address first
          const escrowAddress = await publicClient.readContract({
            address: factoryAddress,
            abi: [
              {
                type: "function",
                name: "addressOfEscrowSrc",
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
            functionName: "addressOfEscrowSrc",
            args: [executionDataForContract],
          });

          console.log(`🏠 [approval] Escrow address: ${escrowAddress}`);

          const approvalResult = await handleTokenApproval(
            publicClient,
            walletClient,
            tokenAddress,
            escrowAddress as `0x${string}`,
            srcAmountWei,
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
      }

      // Step 3: Deploy source escrow contract directly
      setTxStep('deploying-escrow');

      // Factory ABI for createSrcEscrow function
      const factoryAbi = [
        {
          type: "function",
          stateMutability: "payable",
          name: "createSrcEscrow",
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

      // Deploy source escrow contract by calling factory
      const deployTx = await walletClient.writeContract({
        address: factoryAddress,
        abi: factoryAbi,
        functionName: 'createSrcEscrow',
        args: [executionDataForContract],
        value: srcTokenType === "ETH" ? srcAmountWei : 0n, // Send ETH if source token is ETH
      });

      setTxHash(deployTx);

      // Wait for deployment transaction to be confirmed
      const receipt = await publicClient.waitForTransactionReceipt({ hash: deployTx });

      // Contract should be deployed now
      setSwapCreated(true);
      setTxStep('completed');

      // Store swap in backend for tracking
      try {
        await backend.createSwap({
          chainKey: srcChain,
          factoryAddress,
          executionData: {
            ...executionData,
            srcChainId: executionData.srcChainId,
            dstChainId: executionData.dstChainId,
            askerAmount: executionData.askerAmount,
            fullfillerAmount: executionData.fullfillerAmount,
            platformFee: executionData.platformFee,
            timelocks: executionData.timelocks,
          }
        });
        console.log("✅ Swap stored in backend successfully");
      } catch (backendError) {
        console.warn("⚠️ Failed to store swap in backend:", backendError);
        // Don't fail the whole transaction for backend storage issues
      }

    } catch (err) {
      console.error("Swap creation error:", err);

      let errorMessage = "Failed to create swap";
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
  }

  const isLoading = txStep !== 'idle' && txStep !== 'completed' && txStep !== 'error';

  return (
    <div className="container py-4 space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Button variant="outline" onClick={() => router.back()}>
          ← Back
        </Button>
        <h2 className="text-xl font-semibold">Create Swap</h2>
      </div>

      {!isConnected && (
        <div className="card p-3 bg-yellow-50 text-yellow-800 text-sm">
          Please connect your wallet to create a swap
        </div>
      )}


      {/* Chain Switcher - Show when connected but on wrong chain */}
      {isConnected && (
        <ChainSwitcher
          requiredChainId={srcChain === "sepolia" ? sepolia.id : baseSepolia.id}
          requiredChainName={srcChain === "sepolia" ? "Sepolia" : "Base Sepolia"}
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
            {getProgressSteps().map((step, index) => (
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

      {/* Identity Verification Section */}
      {isConnected && !swapCreated && (
        <div className="space-y-4">
          <div className="card p-4 border-blue-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-medium">Identity Verification</h3>
              {isVerified && (
                <span className="text-sm bg-green-100 text-green-800 px-2 py-1 rounded-full">
                  ✓ Verified
                </span>
              )}
            </div>

            {!isVerified && !showVerification ? (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">
                  Enhance your swap security and build trust with identity verification.
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => setShowVerification(true)}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    Verify Identity
                  </Button>
                  <span className="text-xs text-gray-500 py-2">Optional - you can create swaps without verification</span>
                </div>
              </div>
            ) : !isVerified && showVerification ? (
              <SelfVerification
                onVerified={(proofData) => {
                  setVerification(proofData);
                  setShowVerification(false);
                }}
                onSkip={() => setShowVerification(false)}
                title="Verify Your Identity"
                description="Verify your nationality to build trust in your swap orders"
                requireVerification={false}
              />
            ) : (
              <div className="text-sm text-green-700">
                Your identity has been verified. Verified users tend to have higher fulfillment rates.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card p-4">
        <h3 className="text-lg font-medium mb-4">Swap Details</h3>

        <div className="space-y-4">
          {/* What you're giving */}
          <div className="border rounded-lg p-3 bg-blue-50">
            <Label className="text-sm font-medium text-blue-800">You Give</Label>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <div>
                <select
                  className="input text-sm"
                  value={srcChain}
                  onChange={(e) => setSrcChain(e.target.value)}
                  disabled={isLoading}
                >
                  <option value="sepolia">Sepolia</option>
                  <option value="baseSepolia">Base Sepolia</option>
                </select>
              </div>
              <div>
                <select
                  className="input text-sm"
                  value={srcTokenType}
                  onChange={(e) => setSrcTokenType(e.target.value)}
                  disabled={isLoading}
                >
                  <option value="USDC">USDC</option>
                  <option value="ETH">ETH</option>
                </select>
              </div>
              <div>
                <Input
                  value={srcAmount}
                  onChange={(e) => setSrcAmount(e.target.value)}
                  placeholder="1.0"
                  type="number"
                  step="0.01"
                  disabled={isLoading}
                />
              </div>
            </div>
            {/* Balance Display with Validation */}
            <div className="flex items-center justify-between text-xs mt-2">
              <div className="text-blue-600">
                Balance: {
                  !isCorrectChain ? "Switch to correct network" :
                  srcTokenType === "ETH"
                    ? ethBalance ? formatEther(ethBalance.value) : "0"
                    : usdcBalance ? formatUnits(usdcBalance.value, 6) : "0"
                } {isCorrectChain && srcTokenType}
              </div>
              {srcAmount && parseFloat(srcAmount) > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const balance = srcTokenType === "ETH" ? ethBalance?.value : usdcBalance?.value;
                    if (balance) {
                      const decimals = srcTokenType === "ETH" ? 18 : 6;
                      const formattedBalance = srcTokenType === "ETH"
                        ? formatEther(balance)
                        : formatUnits(balance, 6);
                      setSrcAmount(formattedBalance);
                    }
                  }}
                  className="text-blue-600 hover:text-blue-800 underline"
                  disabled={isLoading}
                >
                  Max
                </button>
              )}
            </div>
            {/* Validation Warning */}
            {srcAmount && parseFloat(srcAmount) > 0 && (
              (() => {
                const currentBalance = srcTokenType === "ETH" ? ethBalance?.value : usdcBalance?.value;
                const decimals = srcTokenType === "ETH" ? 18 : 6;
                const srcAmountWei = parseUnits(srcAmount, decimals);
                const isInsufficient = !currentBalance || currentBalance < srcAmountWei;

                return isInsufficient ? (
                  <div className="text-xs text-red-600 mt-1 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    Insufficient balance
                  </div>
                ) : null;
              })()
            )}
          </div>

          {/* What you want */}
          <div className="border rounded-lg p-3 bg-green-50">
            <Label className="text-sm font-medium text-green-800">You Want</Label>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <div>
                <select
                  className="input text-sm"
                  value={dstChain}
                  onChange={(e) => setDstChain(e.target.value)}
                  disabled={isLoading}
                >
                  <option value="sepolia">Sepolia</option>
                  <option value="baseSepolia">Base Sepolia</option>
                </select>
              </div>
              <div>
                <select
                  className="input text-sm"
                  value={dstTokenType}
                  onChange={(e) => setDstTokenType(e.target.value)}
                  disabled={isLoading}
                >
                  <option value="USDC">USDC</option>
                  <option value="ETH">ETH</option>
                </select>
              </div>
              <div>
                <Input
                  value={dstAmount}
                  onChange={(e) => setDstAmount(e.target.value)}
                  placeholder="1.0"
                  type="number"
                  step="0.01"
                  disabled={isLoading}
                />
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="card p-3 bg-gray-50 text-sm">
            <div className="font-medium mb-1">Swap Summary:</div>
            <div>Give {srcAmount} {srcTokenType} on {srcChain === "sepolia" ? "Sepolia" : "Base Sepolia"}</div>
            <div>Get {dstAmount} {dstTokenType} on {dstChain === "sepolia" ? "Sepolia" : "Base Sepolia"}</div>
            <div className="text-xs text-gray-600 mt-1">Your address: {address?.slice(0, 6)}...{address?.slice(-4)}</div>
          </div>
        </div>
      </div>

      {/* Action Button with Preview */}
      {!swapCreated && !isLoading && isConnected && srcAmount && dstAmount && (
        <div className="card p-4 bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200">
          <div className="text-sm font-medium text-gray-900 mb-2">Ready to create swap order:</div>
          <div className="text-sm text-gray-700 mb-3">
            {srcTokenType !== 'ETH' && (
              <div className="flex items-center gap-2 text-orange-700 bg-orange-50 px-2 py-1 rounded mb-2">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span>You'll need to approve {srcTokenType} spending first</span>
              </div>
            )}
            <div>• Approve {srcTokenType !== 'ETH' ? `${srcTokenType} spending and ` : ''}deploy escrow contract</div>
            <div>• Lock {srcAmount} {srcTokenType} on {srcChain === "sepolia" ? "Sepolia" : "Base Sepolia"}</div>
            <div>• Others can fulfill by providing {dstAmount} {dstTokenType} on {dstChain === "sepolia" ? "Sepolia" : "Base Sepolia"}</div>
          </div>
        </div>
      )}

      {/* Single Action Button */}
      <Button
        onClick={createSwapWithFlow}
        disabled={isLoading || !isConnected || !srcAmount || !dstAmount || swapCreated || !isCorrectChain}
        isLoading={isLoading}
        className="w-full"
      >
        {!isCorrectChain ? `Switch to ${srcChain === "sepolia" ? "Sepolia" : "Base Sepolia"} First` :
         isLoading ? getStepMessage(txStep) : swapCreated ? "Swap Created ✓" :
         srcTokenType !== 'ETH' ? "Approve & Create Swap Order" : "Create Swap Order"}
      </Button>

      {swapCreated && srcEscrow && (
        <div className="card p-4 bg-green-50 border-green-200">
          <div className="text-sm font-medium text-green-800 mb-2">🎉 Swap Created Successfully!</div>
          <div className="text-xs space-y-1 mb-3">
            <div><strong>Source Escrow:</strong> {srcEscrow?.slice(0, 10)}...{srcEscrow?.slice(-6)}</div>
            <div><strong>Destination Escrow:</strong> {dstEscrow?.slice(0, 10)}...{dstEscrow?.slice(-6)}</div>
          </div>
          <div className="text-xs text-green-700 mb-3">
            Your swap order is now live! Others can fulfill it by providing {dstAmount} {dstTokenType} on {dstChain === "sepolia" ? "Sepolia" : "Base Sepolia"}.
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => router.push("/")}>
              ← Back to Home
            </Button>
            <Button size="sm" variant="outline" onClick={() => {
              setSwapCreated(false);
              setTxStep('idle');
              setSrcEscrow("");
              setDstEscrow("");
              setSrcAmount("1");
              setDstAmount("1");
            }}>
              Create Another
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}