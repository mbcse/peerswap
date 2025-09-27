"use client";
import { useSwitchChain, useChainId } from "wagmi";
import { sepolia, baseSepolia } from "wagmi/chains";
import { Button } from "./Button";

interface ChainSwitcherProps {
  requiredChainId: number;
  requiredChainName: string;
  className?: string;
}

export function ChainSwitcher({ requiredChainId, requiredChainName, className }: ChainSwitcherProps) {
  const currentChainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();

  const isCorrectChain = currentChainId === requiredChainId;

  if (isCorrectChain) {
    return (
      <div className={`card p-3 bg-green-50 border-green-200 ${className}`}>
        <div className="flex items-center gap-2 text-green-800 text-sm">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          <span>✅ Connected to {requiredChainName}</span>
        </div>
      </div>
    );
  }

  const handleSwitchChain = () => {
    switchChain({ chainId: requiredChainId });
  };

  return (
    <div className={`card p-4 bg-orange-50 border-orange-200 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 text-orange-800 text-sm font-medium mb-1">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            Wrong Network
          </div>
          <div className="text-sm text-orange-700">
            You're connected to the wrong network. Please switch to {requiredChainName} to continue.
          </div>
        </div>
        <Button
          onClick={handleSwitchChain}
          disabled={isPending}
          size="sm"
          className="bg-orange-600 hover:bg-orange-700 text-white"
        >
          {isPending ? "Switching..." : `Switch to ${requiredChainName}`}
        </Button>
      </div>
    </div>
  );
}

export function SepoliaChainSwitcher({ className }: { className?: string }) {
  return (
    <ChainSwitcher
      requiredChainId={sepolia.id}
      requiredChainName="Sepolia"
      className={className}
    />
  );
}

export function BaseSepoliaChainSwitcher({ className }: { className?: string }) {
  return (
    <ChainSwitcher
      requiredChainId={baseSepolia.id}
      requiredChainName="Base Sepolia"
      className={className}
    />
  );
}