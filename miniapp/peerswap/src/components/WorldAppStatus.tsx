'use client';

import { useMiniKit } from '~/hooks/useMiniKit';

export function WorldAppStatus() {
  const { isWorldApp, isLoading } = useMiniKit();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <div className="animate-spin h-4 w-4 border-2 border-gray-300 rounded-full border-t-gray-600" />
        Checking environment...
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      {isWorldApp ? (
        <>
          <div className="w-2 h-2 bg-green-500 rounded-full" />
          <span className="text-green-700">Running in World App</span>
        </>
      ) : (
        <>
          <div className="w-2 h-2 bg-blue-500 rounded-full" />
          <span className="text-blue-700">Running in Browser</span>
        </>
      )}
    </div>
  );
}