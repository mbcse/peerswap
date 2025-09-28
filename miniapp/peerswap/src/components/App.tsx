"use client";

import { useEffect, useState } from "react";
import { useMiniApp } from "@neynar/react";
import { useAccount } from "wagmi";
import { Header } from "~/components/ui/Header";
import { Button } from "~/components/ui/Button";
import { ConnectWallet } from "~/components/ui/ConnectWallet";
import { backend } from "~/lib/backend";
import { useNeynarUser } from "../hooks/useNeynarUser";
import sdk from "@farcaster/miniapp-sdk";
import { useRouter } from "next/navigation";
import { formatTokenAmount, getTokenDecimals, getTokenSymbol } from "~/utils/formatAmount";
import { WorldAppStatus } from "~/components/WorldAppStatus";

export interface AppProps {
  title?: string;
}

export default function App(
  { title }: AppProps = { title: "PeerSwap" }
) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { isSDKLoaded, context } = useMiniApp();
  const { user: neynarUser } = useNeynarUser(context || undefined);
  
  const [swaps, setSwaps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');

  useEffect(() => {
    if (isSDKLoaded) {
      loadSwaps();
    }
  }, [isSDKLoaded, activeTab]);

  const loadSwaps = async () => {
    setLoading(true);
    try {
      // Load active swaps (no status filter) or completed swaps
      const status = activeTab === 'completed' ? 'completed' : undefined;
      const swapsData = await backend.listSwaps(status);
      
      // For active tab, filter out completed swaps
      const filteredSwaps = activeTab === 'active' 
        ? swapsData.filter((swap: any) => swap.status !== 'completed')
        : swapsData;
      
      setSwaps(filteredSwaps);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load swaps");
    } finally {
      setLoading(false);
      // Call ready after content is loaded
      if (isSDKLoaded) {
        sdk.actions.ready();
      }
    }
  };

  if (!isSDKLoaded) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="spinner h-8 w-8 mx-auto mb-4"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        paddingTop: context?.client.safeAreaInsets?.top ?? 0,
        paddingBottom: context?.client.safeAreaInsets?.bottom ?? 0,
        paddingLeft: context?.client.safeAreaInsets?.left ?? 0,
        paddingRight: context?.client.safeAreaInsets?.right ?? 0,
      }}
    >
      <Header neynarUser={neynarUser} />

      <div className="container py-4 space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">{title}</h1>
          <p className="text-sm text-gray-600 mb-1">P2P Cross-Chain Token Swaps</p>
          <p className="text-xs text-gray-500 mb-3">Trade with people directly • Trade with friends • No intermediaries</p>
          <div className="flex justify-center mb-4">
            <WorldAppStatus />
          </div>
        </div>

        {/* Wallet Connection */}
        {!isConnected && <ConnectWallet />}
        
        {isConnected && (
          <div className="text-center space-y-2">
            <Button 
              onClick={() => router.push("/create-swap")}
              className="w-full max-w-sm mx-auto"
            >
              Create New Swap
            </Button>
            <Button 
              onClick={() => router.push("/claim-swap")}
              className="w-full max-w-sm mx-auto bg-green-500 hover:bg-green-600 text-white"
            >
              Claim Your Tokens
            </Button>
          </div>
        )}

        <div className="mt-6">
          {/* Tab Navigation */}
          <div className="flex bg-gray-100 rounded-lg p-1 mb-4">
            <button
              onClick={() => setActiveTab('active')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'active' 
                  ? 'bg-white text-blue-600 shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Active Orders
            </button>
            <button
              onClick={() => setActiveTab('completed')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'completed' 
                  ? 'bg-white text-blue-600 shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Past Orders
            </button>
          </div>

          <h2 className="text-lg font-semibold mb-3">
            {activeTab === 'active' ? 'Available Swaps' : 'Completed Swaps'}
          </h2>
          
          {loading && (
            <div className="text-center py-8">
              <div className="spinner h-6 w-6 mx-auto mb-2"></div>
              <p className="text-sm">Loading swaps...</p>
            </div>
          )}

          {error && (
            <div className="card p-3 bg-red-50 text-red-800 text-sm mb-4">
              {error}
            </div>
          )}

          {!loading && swaps.length === 0 && (
            <div className="card p-6 text-center">
              <div className="text-gray-500 mb-2">
                {activeTab === 'active' ? 'No active swaps available' : 'No completed swaps yet'}
              </div>
              <p className="text-xs text-gray-400 mb-3">
                {activeTab === 'active' 
                  ? 'Be the first to create a swap!' 
                  : 'Complete some swaps to see them here!'
                }
              </p>
            </div>
          )}

          {!loading && swaps.map((swap, i) => (
            <div key={i} className={`card p-4 border-l-4 mb-3 ${
              activeTab === 'completed' ? 'border-green-500 bg-green-50' : 'border-blue-500'
            }`}>
              <div className="flex justify-between items-start mb-2">
                <div className="text-sm font-medium">
                  Swap #{i + 1}
                  {activeTab === 'completed' && (
                    <span className="ml-2 px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                      ✓ Completed
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500">
                  {swap.executionData.srcChainId === "11155111" ? "Sepolia" : "Base Sepolia"} → {swap.executionData.dstChainId === "11155111" ? "Sepolia" : "Base Sepolia"}
                </div>
              </div>
              
              <div className="text-xs text-gray-600 space-y-1 mb-3">
                <div><strong>Give:</strong> {formatTokenAmount(
                  swap.executionData.askerAmount,
                  getTokenDecimals(swap.executionData.srcToken),
                  getTokenSymbol(swap.executionData.srcToken)
                )}</div>
                <div><strong>Get:</strong> {formatTokenAmount(
                  swap.executionData.fullfillerAmount,
                  getTokenDecimals(swap.executionData.dstToken),
                  getTokenSymbol(swap.executionData.dstToken)
                )}</div>
                <div><strong>From:</strong> {swap.executionData.asker?.slice(0, 6)}...{swap.executionData.asker?.slice(-4)}</div>
                {swap.executionData.fullfiller && swap.executionData.fullfiller !== '0x0000000000000000000000000000000000000000' && (
                  <div><strong>Fulfilled by:</strong> {swap.executionData.fullfiller?.slice(0, 6)}...{swap.executionData.fullfiller?.slice(-4)}</div>
                )}
              </div>

              {activeTab === 'active' ? (
                <Button
                  size="sm"
                  onClick={() => router.push(`/fulfill-swap?swapId=${i}`)}
                  className="w-full"
                  disabled={!isConnected}
                >
                  {!isConnected ? "Connect Wallet to Fulfill" : "Fulfill Swap"}
                </Button>
              ) : (
                <div className="space-y-2">
                  <div className="text-center py-2 text-sm text-green-600 font-medium">
                    Swap Successfully Completed
                  </div>
                  {swap.completionTxHashes && (
                    <div className="text-xs text-gray-600 space-y-1 border-t pt-2">
                      <div className="font-medium text-gray-700">Transaction Hashes:</div>
                      <div>
                        <strong>Destination:</strong>{' '}
                        <a 
                          href={`${swap.executionData.dstChainId === "11155111" ? "https://sepolia.etherscan.io" : "https://sepolia.basescan.org"}/tx/${swap.completionTxHashes.dstTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 underline"
                        >
                          {swap.completionTxHashes.dstTxHash?.slice(0, 8)}...{swap.completionTxHashes.dstTxHash?.slice(-6)}
                        </a>
                      </div>
                      <div>
                        <strong>Source:</strong>{' '}
                        <a 
                          href={`${swap.executionData.srcChainId === "11155111" ? "https://sepolia.etherscan.io" : "https://sepolia.basescan.org"}/tx/${swap.completionTxHashes.srcTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 underline"
                        >
                          {swap.completionTxHashes.srcTxHash?.slice(0, 8)}...{swap.completionTxHashes.srcTxHash?.slice(-6)}
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Mini App Links Section */}
        <div className="mt-8 border-t pt-6">
          <div className="text-center mb-4">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Available On</h3>
            <p className="text-sm text-gray-600">Try PeerSwap on your favorite platforms</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-md mx-auto">
            {/* Farcaster Mini App Link */}
            <a
              href="https://farcaster.xyz/miniapps/Fsw6avz8_EKu/peerswap"
              target="_blank"
              rel="noopener noreferrer"
              className="card p-4 flex items-center space-x-3 hover:shadow-md transition-shadow group"
            >
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center group-hover:bg-purple-200 transition-colors">
                <svg className="w-6 h-6 text-purple-600" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
              </div>
              <div className="flex-1">
                <div className="font-medium text-gray-900">Farcaster</div>
                <div className="text-xs text-gray-500">Available as Mini App</div>
              </div>
              <div className="w-4 h-4 text-gray-400">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </div>
            </a>

            {/* World App Mini App Link */}
            <a
              href="https://world.org/mini-app?app_id=app_506a8a5565ba2fca4e523d0a4487d74a"
              target="_blank"
              rel="noopener noreferrer"
              className="card p-4 flex items-center space-x-3 hover:shadow-md transition-shadow group"
            >
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                <svg className="w-6 h-6 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="10"/>
                  <circle cx="12" cy="12" r="6"/>
                  <circle cx="12" cy="12" r="2"/>
                </svg>
              </div>
              <div className="flex-1">
                <div className="font-medium text-gray-900">World App</div>
                <div className="text-xs text-gray-500">Available as Mini App</div>
              </div>
              <div className="w-4 h-4 text-gray-400">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </div>
            </a>
          </div>

          {/* Additional Info */}
          <div className="mt-4 text-center">
            <p className="text-xs text-gray-500">
              Access PeerSwap directly from your favorite Web3 platforms
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

