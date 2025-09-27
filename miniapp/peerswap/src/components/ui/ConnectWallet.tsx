"use client";
import { useAccount, useConnect } from "wagmi";
import { Button } from "./Button";

export function ConnectWallet() {
  const { isConnected, address } = useAccount();
  const { connect, connectors, isPending } = useConnect();

  if (isConnected) {
    return (
      <div className="card p-3 bg-green-50 text-green-800 text-sm">
        <div className="font-medium">Wallet Connected</div>
        <div className="text-xs">{address?.slice(0, 6)}...{address?.slice(-4)}</div>
      </div>
    );
  }

  return (
    <div className="card p-4 bg-blue-50 border-blue-200">
      <div className="text-center">
        <div className="font-medium text-blue-800 mb-2">Connect Wallet</div>
        <div className="text-sm text-blue-600 mb-3">
          Connect your wallet to create and fulfill swaps
        </div>
        <div className="space-y-2">
          {connectors.map((connector) => (
            <Button
              key={connector.id}
              onClick={() => connect({ connector })}
              disabled={isPending}
              variant={connector.id === 'farcasterFrame' ? 'default' : 'outline'}
              size="sm"
              className="w-full"
            >
              {isPending ? 'Connecting...' : `Connect with ${connector.name}`}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
