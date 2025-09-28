'use client';

import { MiniKit } from '@worldcoin/minikit-js';
import { useEffect, useState } from 'react';

interface MiniKitProviderProps {
  children: React.ReactNode;
}

export function MiniKitProvider({ children }: MiniKitProviderProps) {
  const [isMiniKitInstalled, setIsMiniKitInstalled] = useState(false);

  useEffect(() => {
    // Check if we're running in World App
    const isWorldApp = MiniKit.isInstalled();
    setIsMiniKitInstalled(isWorldApp);

    if (isWorldApp) {
      console.log('🌍 Running in World App - MiniKit available');

      // Initialize MiniKit for World App
      MiniKit.subscribe(
        'app_closed',
        () => {
          console.log('🌍 World App closed');
        }
      );

      // Subscribe to theme changes if needed
      MiniKit.subscribe(
        'theme_changed',
        (theme) => {
          console.log('🌍 Theme changed:', theme);
        }
      );
    } else {
      console.log('🌐 Running in regular browser - MiniKit not available');
    }

    return () => {
      // Cleanup subscriptions
      if (isWorldApp) {
        MiniKit.unsubscribe('app_closed');
        MiniKit.unsubscribe('theme_changed');
      }
    };
  }, []);

  return (
    <>
      {children}
      {/* Optional: Show World App status indicator */}
      {process.env.NODE_ENV === 'development' && (
        <div className="fixed bottom-4 right-4 bg-black text-white px-2 py-1 rounded text-xs z-50">
          {isMiniKitInstalled ? '🌍 World App' : '🌐 Browser'}
        </div>
      )}
    </>
  );
}