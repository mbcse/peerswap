import configData from '../../config.json';

export interface TokenConfig {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string;
}

export interface ChainConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  blockExplorer: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  contracts: {
    factory: string;
    escrowSrcImpl: string;
    escrowDstImpl: string;
  };
  tokens: Record<string, TokenConfig>;
}

export interface AppConfig {
  chains: Record<string, ChainConfig>;
  relayer: string;
  feeCollector: string;
  rescueDelay: number;
  accessToken: string;
  platformFee: number;
}

export const config: AppConfig = configData as AppConfig;

export function getChainConfig(chainId: number): ChainConfig {
  const chainConfig = config.chains[chainId.toString()];

  if (!chainConfig) {
    throw new Error(`Chain configuration not found for chainId: ${chainId}`);
  }

  return chainConfig;
}

export function getSupportedChains(): ChainConfig[] {
  return Object.values(config.chains);
}

export function getChainConfigByName(name: string): ChainConfig | undefined {
  return Object.values(config.chains).find(chain => chain.name === name);
}

// Helper functions for backward compatibility
export function getFactoryAddress(chainId: number): string {
  const chainConfig = getChainConfig(chainId);
  return chainConfig.contracts.factory;
}

export function getFactoryAddresses(): Record<string, string> {
  const addresses: Record<string, string> = {};

  Object.values(config.chains).forEach(chain => {
    // Map to legacy naming convention
    if (chain.name === 'sepolia') {
      addresses.sepolia = chain.contracts.factory;
    } else if (chain.name === 'base-sepolia') {
      addresses.baseSepolia = chain.contracts.factory;
    }
  });

  return addresses;
}

export function getTokens(): Record<string, Record<string, string>> {
  const tokens: Record<string, Record<string, string>> = {};

  Object.values(config.chains).forEach(chain => {
    const chainTokens: Record<string, string> = {};

    Object.entries(chain.tokens).forEach(([symbol, tokenConfig]) => {
      chainTokens[symbol] = tokenConfig.address;
    });

    // Map to legacy naming convention
    if (chain.name === 'sepolia') {
      tokens.sepolia = chainTokens;
    } else if (chain.name === 'base-sepolia') {
      tokens.baseSepolia = chainTokens;
    }
  });

  return tokens;
}

export function getTokenConfig(chainId: number, symbol: string): TokenConfig {
  const chainConfig = getChainConfig(chainId);
  const tokenConfig = chainConfig.tokens[symbol];

  if (!tokenConfig) {
    throw new Error(`Token configuration not found for ${symbol} on chain ${chainId}`);
  }

  return tokenConfig;
}

export function getRpcUrl(chainId: number): string {
  const chainConfig = getChainConfig(chainId);
  return chainConfig.rpcUrl;
}

// Legacy support for specific hardcoded addresses that might be used in components
export function getETHAllowanceAddresses(): Record<string, string> {
  // These might need to be added to the config if they're contract addresses
  // For now, returning empty object as these seem to be specific contract addresses
  return {};
}