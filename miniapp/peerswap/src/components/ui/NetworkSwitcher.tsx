"use client";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { sepolia, baseSepolia } from "wagmi/chains";
import { Button } from "./Button";

const SUPPORTED_CHAINS = {
  [sepolia.id]: {
    name: "Sepolia",
    chain: sepolia,
  },
  [baseSepolia.id]: {
    name: "Base Sepolia", 
    chain: baseSepolia,
  },
};

interface NetworkSwitcherProps {
  requiredChainId?: number;
  className?: string;
}

export function NetworkSwitcher({ requiredChainId, className = "" }: NetworkSwitcherProps) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected) return null;

  // If no specific chain required, show current network
  if (!requiredChainId) {
    const currentChain = SUPPORTED_CHAINS[chainId as keyof typeof SUPPORTED_CHAINS];
    return (
      <div className={`text-xs text-gray-600 ${className}`}>
        Network: {currentChain?.name || `Chain ${chainId}`}
      </div>
    );
  }

  // If already on the required chain, show success
  if (chainId === requiredChainId) {
    const currentChain = SUPPORTED_CHAINS[requiredChainId as keyof typeof SUPPORTED_CHAINS];
    return (
      <div className={`card p-2 bg-green-50 text-green-800 text-xs ${className}`}>
        ✓ Connected to {currentChain?.name}
      </div>
    );
  }

  // Show switch network button
  const targetChain = SUPPORTED_CHAINS[requiredChainId as keyof typeof SUPPORTED_CHAINS];
  const currentChain = SUPPORTED_CHAINS[chainId as keyof typeof SUPPORTED_CHAINS];
  
  return (
    <div className={`card p-3 bg-yellow-50 border-yellow-200 ${className}`}>
      <div className="text-sm font-medium text-yellow-800 mb-2">Wrong Network</div>
      <div className="text-xs text-yellow-700 mb-3">
        You're on {currentChain?.name || `Chain ${chainId}`}, but this transaction requires {targetChain?.name}.
      </div>
      <Button
        size="sm"
        onClick={() => {
          try {
            switchChain({ chainId: requiredChainId });
          } catch (error) {
            console.error('Network switch failed:', error);
            alert(`Failed to switch network. Please manually switch to ${targetChain?.name} in your wallet.`);
          }
        }}
        disabled={isPending}
        className="w-full"
      >
        {isPending ? "Switching..." : `Switch to ${targetChain?.name}`}
      </Button>
    </div>
  );
}
