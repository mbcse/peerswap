import { useState } from 'react';
import { useWriteContract, useSwitchChain } from 'wagmi';

export function useContractWrite() {
  const [isLoading, setIsLoading] = useState(false);
  const { writeContractAsync: wagmiWriteContract, isPending } = useWriteContract();
  const { switchChain } = useSwitchChain();

  const writeContract = async (params: {
    address: `0x${string}`;
    abi: any;
    functionName: string;
    args: any[];
    value?: bigint;
    chainId: number;
  }) => {
    setIsLoading(true);
    
    try {
      console.log('Using standard wagmi for contract writing');
      
      // Try to switch to the target chain first
      try {
        await switchChain({ chainId: params.chainId });
        console.log(`Successfully switched to chain ${params.chainId}`);
      } catch (switchError) {
        console.log('Chain switch failed, proceeding anyway:', switchError);
      }

      // Use standard wagmi writeContract
      return await wagmiWriteContract({
        address: params.address,
        abi: params.abi,
        functionName: params.functionName,
        args: params.args,
        value: params.value,
        chainId: params.chainId,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return {
    writeContract,
    isPending: isPending || isLoading,
  };
}
