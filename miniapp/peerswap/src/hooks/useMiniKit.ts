'use client';

import { MiniKit } from '@worldcoin/minikit-js';
import { useEffect, useState } from 'react';

export function useMiniKit() {
  const [isWorldApp, setIsWorldApp] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if we're running in World App
    const checkMiniKit = () => {
      const installed = MiniKit.isInstalled();
      setIsWorldApp(installed);
      setIsLoading(false);
    };

    // Small delay to ensure MiniKit is properly initialized
    const timer = setTimeout(checkMiniKit, 100);

    return () => clearTimeout(timer);
  }, []);

  return {
    isWorldApp,
    isLoading,
    MiniKit: isWorldApp ? MiniKit : null,
  };
}