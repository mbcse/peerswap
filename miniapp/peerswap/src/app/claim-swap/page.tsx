"use client";
import { useState, useEffect } from "react";
import { Button } from "~/components/ui/Button";
import { useAccount } from "wagmi";
import { formatTokenAmount } from "~/utils/formatAmount";
import { backend, BACKEND_URL } from "~/lib/backend";
import { useRouter } from "next/navigation";
import sdk from "@farcaster/miniapp-sdk";



interface StoredSwap {
  secret: string;
  hashlock: string;
  srcChain: string;
  dstChain: string;
  srcAmount: string;
  dstAmount: string;
  srcTokenType: string;
  dstTokenType: string;
  created: number;
}

export default function ClaimSwapPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const [userSwaps, setUserSwaps] = useState<StoredSwap[]>([]);
  const [selectedSwap, setSelectedSwap] = useState<StoredSwap | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [step, setStep] = useState<'select' | 'claim'>('select');
  const [dstEscrowAddress, setDstEscrowAddress] = useState<string>("");

  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    sdk.actions.ready();
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && address) {
      // Load user's swaps from localStorage
      const swaps: StoredSwap[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('swap_')) {
          try {
            const swapData = JSON.parse(localStorage.getItem(key) || '{}');
            swaps.push(swapData);
          } catch (e) {
            console.warn('Failed to parse swap data:', e);
          }
        }
      }
      setUserSwaps(swaps.sort((a, b) => b.created - a.created));
    }
  }, [address]);



  const handleClaimSwap = async (swap: StoredSwap) => {
    setSelectedSwap(swap);
    setStep('claim');
    
    setNotification({ type: 'success', message: 'Checking escrow deployment status...' });
    
    try {
      // Check if both escrows are deployed
      const statusResponse = await fetch(`${BACKEND_URL}/swap-status/${swap.hashlock}`);
      const status = await statusResponse.json();
      
      if (!statusResponse.ok) {
        throw new Error(status.error || 'Failed to check swap status');
      }
      
      if (!status.canClaim) {
        setNotification({ 
          type: 'error', 
          message: `Cannot claim yet. Source deployed: ${status.srcDeployed ? '✅' : '❌'}, Destination deployed: ${status.dstDeployed ? '✅' : '❌'}` 
        });
        return;
      }
      
      setDstEscrowAddress(status.dstEscrow);
      setNotification({ type: 'success', message: 'Both escrows deployed! Ready to claim.' });
      
    } catch (error) {
      console.error('Failed to check swap status:', error);
      setNotification({ type: 'error', message: 'Failed to check swap status: ' + (error as Error).message });
    }
  };

  const executeWithdraw = async () => {
    if (!selectedSwap || !address) return;

    setIsProcessing(true);
    try {
      setNotification({ type: 'success', message: 'Submitting secret to relayer...' });

      // Send secret to backend for processing
      const result = await backend.claimSwap(
        selectedSwap.secret,
        selectedSwap.hashlock,
        address
      );

      setNotification({ 
        type: 'success', 
        message: '🎉 Secret verified! Relayer is processing both withdrawals. Your tokens will arrive shortly!' 
      });

      // Remove the claimed swap from localStorage
      const swapKeys = Object.keys(localStorage).filter(key => key.startsWith('swap_'));
      for (const key of swapKeys) {
        try {
          const swapData = JSON.parse(localStorage.getItem(key) || '{}');
          if (swapData.hashlock === selectedSwap.hashlock) {
            localStorage.removeItem(key);
            localStorage.removeItem(`secret_${key.replace('swap_', '')}`);
            break;
          }
        } catch (e) {
          console.warn('Failed to parse swap data:', e);
        }
      }

      // Refresh the swap list
      setTimeout(() => {
        window.location.reload();
      }, 2000);

    } catch (error) {
      console.error('Claim failed:', error);
      setNotification({ type: 'error', message: 'Claim failed: ' + (error as Error).message });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="container mx-auto p-6 max-w-md">
        <h1 className="text-2xl font-bold mb-6">Claim Your Tokens</h1>
        <p>Please connect your wallet to view and claim your swaps.</p>
      </div>
    );
  }

  if (step === 'select') {
    return (
      <div className="container mx-auto p-6 max-w-md">
        <h1 className="text-2xl font-bold mb-6">Your Swaps to Claim</h1>
        
        {userSwaps.length === 0 ? (
          <div className="space-y-4">
            <p className="text-gray-600">No swaps found. Create a swap first!</p>
            <Button
              onClick={() => router.push('/')}
              variant="outline"
              className="w-full"
            >
              🏠 Back to Home
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {userSwaps.map((swap, index) => (
              <div key={index} className="border rounded-lg p-4 bg-white shadow-sm">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-medium">
                      {swap.srcAmount} {swap.srcTokenType} → {swap.dstAmount} {swap.dstTokenType}
                    </p>
                    <p className="text-sm text-gray-600">
                      {swap.srcChain} → {swap.dstChain}
                    </p>
                  </div>
                  <Button
                    onClick={() => handleClaimSwap(swap)}
                    className="bg-blue-500 hover:bg-blue-600 text-white"
                    size="sm"
                  >
                    Claim
                  </Button>
                </div>
                <p className="text-xs text-gray-500">
                  Created: {new Date(swap.created).toLocaleString()}
                </p>
              </div>
            ))}
            <Button
              onClick={() => router.push('/')}
              variant="outline"
              className="w-full"
            >
              🏠 Back to Home
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Claim step
  return (
    <div className="container mx-auto p-6 max-w-md">
      <h1 className="text-2xl font-bold mb-6">Claim Your Tokens</h1>
      
      {selectedSwap && (
        <div className="space-y-6">
          <div className="border rounded-lg p-4 bg-gray-50">
            <h3 className="font-medium mb-2">Swap Details</h3>
            <p>You will receive: {selectedSwap.dstAmount} {selectedSwap.dstTokenType}</p>
            <p>On chain: {selectedSwap.dstChain}</p>
            <p className="text-sm text-gray-600 mt-2">
              Destination Escrow: {dstEscrowAddress.slice(0, 10)}...
            </p>
          </div>

          <div className="space-y-4">
            <Button
              onClick={executeWithdraw}
              disabled={isProcessing || !dstEscrowAddress}
              className="w-full bg-green-500 hover:bg-green-600 text-white disabled:opacity-50"
            >
              {isProcessing ? "Processing..." : "Submit Secret to Relayer"}
            </Button>
            
            <div className="text-sm text-gray-600 text-center">
              💡 The relayer will handle both withdrawals and pay all gas fees
            </div>
          </div>

          {notification && (
            <div className={`p-3 rounded border ${
              notification.type === 'success' 
                ? 'bg-green-100 border-green-300 text-green-800' 
                : 'bg-red-100 border-red-300 text-red-800'
            }`}>
              {notification.message}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={() => setStep('select')}
              variant="outline"
              className="flex-1"
            >
              ← Back to Swaps
            </Button>
            <Button
              onClick={() => router.push('/')}
              variant="outline"
              className="flex-1"
            >
              🏠 Home
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
