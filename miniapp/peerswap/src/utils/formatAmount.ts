// Helper function to format token amounts
export function formatTokenAmount(
  amountWei: string | number | bigint | undefined,
  decimals: number = 18,
  tokenSymbol: string = "tokens"
): string {
  try {
    // Handle undefined or null values
    if (amountWei === undefined || amountWei === null) {
      return `0 ${tokenSymbol}`;
    }

    const amount = BigInt(amountWei);
    const divisor = BigInt(10 ** decimals);
    const wholePart = amount / divisor;
    const fractionalPart = amount % divisor;

    if (fractionalPart === 0n) {
      return `${wholePart.toString()} ${tokenSymbol}`;
    }

    // Show up to 6 decimal places for fractional part
    const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
    const trimmedFractional = fractionalStr.replace(/0+$/, '');

    if (trimmedFractional === '') {
      return `${wholePart.toString()} ${tokenSymbol}`;
    }

    return `${wholePart.toString()}.${trimmedFractional} ${tokenSymbol}`;
  } catch (error) {
    return `0 ${tokenSymbol}`;
  }
}

export function getTokenDecimals(tokenAddress: string | undefined): number {
  // Handle undefined or null tokenAddress
  if (!tokenAddress) {
    return 18; // Default to 18
  }

  // ETH = 18 decimals, USDC = 6 decimals
  if (tokenAddress === "0x0000000000000000000000000000000000000000") {
    return 18; // ETH
  }
  // For USDC addresses, return 6 decimals
  if (tokenAddress.toLowerCase().includes("usdc") ||
      tokenAddress === "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" ||
      tokenAddress === "0x036CbD53842c5426634e7929541eC2318f3dCF7e") {
    return 6; // USDC
  }
  return 18; // Default to 18
}

export function getTokenSymbol(tokenAddress: string | undefined): string {
  // Handle undefined or null tokenAddress
  if (!tokenAddress) {
    return "tokens"; // Default
  }

  if (tokenAddress === "0x0000000000000000000000000000000000000000") {
    return "ETH";
  }
  if (tokenAddress === "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" ||
      tokenAddress === "0x036CbD53842c5426634e7929541eC2318f3dCF7e") {
    return "USDC";
  }
  return "tokens";
}
