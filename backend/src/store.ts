export type ExecutionData = {
  orderHash: `0x${string}`;
  hashlock: `0x${string}`;
  asker: `0x${string}`;
  fullfiller: `0x${string}`;
  srcToken: `0x${string}`;
  dstToken: `0x${string}`;
  srcChainId: bigint;
  dstChainId: bigint;
  askerAmount: bigint;
  fullfillerAmount: bigint;
  platformFee: bigint;
  feeCollector: `0x${string}`;
  timelocks: bigint;
  parameters: `0x${string}`;
};

export type SwapRecord = {
  chainKey: "sepolia" | "baseSepolia"; // destination chain for listening
  factoryAddress: `0x${string}`;
  executionData: ExecutionData;
  srcEscrow: `0x${string}`;
  dstEscrow: `0x${string}`;
  status: 'pending' | 'fulfilled' | 'completed';
  srcDeployed?: boolean;
  dstDeployed?: boolean;
  completionTxHashes?: {
    srcTxHash: string;
    dstTxHash: string;
  };
  createdAt: number;
  updatedAt: number;
};

const byHashlock = new Map<string, SwapRecord>();

export function upsertSwap(rec: SwapRecord) {
  const hashlock = rec.executionData.hashlock.toLowerCase();
  const existing = byHashlock.get(hashlock);
  const isNew = !existing;

  // Set timestamps and preserve existing data
  const now = Date.now();
  const updatedRec = {
    ...rec,
    status: rec.status || 'pending',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    srcDeployed: rec.srcDeployed ?? existing?.srcDeployed ?? false,
    dstDeployed: rec.dstDeployed ?? existing?.dstDeployed ?? false,
    completionTxHashes: rec.completionTxHashes || existing?.completionTxHashes,
  };

  byHashlock.set(hashlock, updatedRec);

  console.log(`💾 [store] ${isNew ? 'Added new' : 'Updated'} swap record:`);
  console.log(`🔑 [store] Hashlock: ${hashlock.slice(0, 10)}...`);
  console.log(`📊 [store] Status: ${existing?.status || 'new'} → ${updatedRec.status}`);
  console.log(`👤 [store] Asker: ${rec.executionData.asker}`);
  console.log(`🏭 [store] Source escrow: ${rec.srcEscrow} (deployed: ${updatedRec.srcDeployed})`);
  console.log(`🏭 [store] Destination escrow: ${rec.dstEscrow} (deployed: ${updatedRec.dstDeployed})`);
  console.log(`📊 [store] Total swaps in store: ${byHashlock.size}`);

  // Update status based on deployment state
  if (updatedRec.srcDeployed && updatedRec.dstDeployed && updatedRec.status === 'pending') {
    updatedRec.status = 'fulfilled';
    updatedRec.updatedAt = now;
    byHashlock.set(hashlock, updatedRec);
    console.log(`🎯 [store] Auto-updated status to 'fulfilled' - both escrows deployed`);
  }

  // Store reference for relayer access
  if (typeof global !== 'undefined') {
    global.swapStore = Object.fromEntries(byHashlock);
  }
}

export function getSwapByHashlock(hashlock: `0x${string}`): SwapRecord | undefined {
  const record = byHashlock.get(hashlock.toLowerCase());
  console.log(`🔍 [store] Lookup for hashlock ${hashlock.slice(0, 10)}...: ${record ? 'FOUND' : 'NOT FOUND'}`);
  
  if (!record) {
    console.log(`📝 [store] Available hashlocks:`, Array.from(byHashlock.keys()).map(h => h.slice(0, 10) + '...'));
  }
  
  return record;
}

export function listSwaps(): SwapRecord[] {
  return Array.from(byHashlock.values());
}


