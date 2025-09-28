import { PublicClient, WalletClient, erc20Abi } from "viem";

export interface ApprovalResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

export interface ApprovalOptions {
  maxRetries?: number;
  retryDelay?: number;
  gasMultiplier?: number;
}

/**
 * Handles token approval with retry logic and better error handling
 */
export async function handleTokenApproval(
  publicClient: PublicClient,
  walletClient: WalletClient,
  tokenAddress: `0x${string}`,
  spenderAddress: `0x${string}`,
  amount: bigint,
  userAddress: `0x${string}`,
  options: ApprovalOptions = {}
): Promise<ApprovalResult> {
  const { maxRetries = 3, retryDelay = 2000, gasMultiplier = 1.2 } = options;

  console.log(`🔐 [approval] Starting approval process for ${amount.toString()} tokens`);
  console.log(`🔐 [approval] Token: ${tokenAddress}, Spender: ${spenderAddress}`);

  // First, check current allowance
  try {
    const currentAllowance = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [userAddress, spenderAddress],
    });

    console.log(`🔍 [approval] Current allowance: ${currentAllowance.toString()}`);

    if (currentAllowance >= amount) {
      console.log(`✅ [approval] Sufficient allowance already exists`);
      return { success: true };
    }
  } catch (error) {
    console.error("❌ [approval] Failed to check allowance:", error);
    return { 
      success: false, 
      error: `Failed to check token allowance: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }

  // Attempt approval with retries
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 [approval] Attempt ${attempt}/${maxRetries}`);

      const approveTx = await walletClient.writeContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [spenderAddress, amount],
        account: walletClient.account || null,
        chain: walletClient.chain,
      });

      console.log(`⏳ [approval] Approval transaction submitted: ${approveTx}`);

      // Wait for transaction confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ 
        hash: approveTx,
        timeout: 60000 // 60 second timeout
      });

      if (receipt.status === 'success') {
        console.log(`✅ [approval] Approval transaction confirmed successfully`);
        
        // Verify the approval was actually set
        const newAllowance = await publicClient.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [userAddress, spenderAddress],
        });

        if (newAllowance >= amount) {
          console.log(`✅ [approval] Approval verified: ${newAllowance.toString()}`);
          return { success: true, txHash: approveTx };
        } else {
          console.warn(`⚠️ [approval] Approval transaction succeeded but allowance not updated correctly`);
          if (attempt < maxRetries) {
            console.log(`🔄 [approval] Retrying in ${retryDelay}ms...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            continue;
          }
        }
      } else {
        throw new Error("Approval transaction failed");
      }

    } catch (error) {
      console.error(`❌ [approval] Attempt ${attempt} failed:`, error);

      if (attempt === maxRetries) {
        let errorMessage = "Token approval failed";
        if (error instanceof Error) {
          if (error.message.includes("User denied transaction signature")) {
            errorMessage = "Approval was cancelled by user";
          } else if (error.message.includes("insufficient funds")) {
            errorMessage = "Insufficient funds for approval transaction";
          } else if (error.message.includes("execution reverted")) {
            errorMessage = "Token contract rejected the approval";
          } else if (error.message.includes("network")) {
            errorMessage = "Network error during approval";
          } else if (error.message.includes("timeout")) {
            errorMessage = "Approval transaction timed out";
          } else {
            errorMessage = `Token approval failed: ${error.message}`;
          }
        }
        
        return { success: false, error: errorMessage };
      }

      // Wait before retry
      console.log(`🔄 [approval] Retrying in ${retryDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }

  return { success: false, error: "All approval attempts failed" };
}

/**
 * Checks if a token requires approval (not ETH)
 */
export function requiresApproval(tokenAddress: string): boolean {
  return tokenAddress !== "0x0000000000000000000000000000000000000000";
}

/**
 * Gets user-friendly error message for approval failures
 */
export function getApprovalErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes("User denied transaction signature")) {
      return "Approval was cancelled by user";
    } else if (error.message.includes("insufficient funds")) {
      return "Insufficient funds for approval transaction";
    } else if (error.message.includes("execution reverted")) {
      return "Token contract rejected the approval";
    } else if (error.message.includes("network")) {
      return "Network error during approval";
    } else if (error.message.includes("timeout")) {
      return "Approval transaction timed out";
    } else {
      return `Token approval failed: ${error.message}`;
    }
  }
  
  return "Token approval failed: Unknown error";
}
