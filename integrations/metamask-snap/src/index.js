/**
 * Feelcoin MetaMask Snap proof-of-concept handler.
 * Read-only public network information only.
 * Not a complete Snap bundle: package/manifest and extension tests are pending.
 */

const API = 'https://api.feelcoin.org/v1/network';

export const onRpcRequest = async ({ request }) => {
  switch (request.method) {
    case 'feelcoin_getCapabilities':
      return {
        chain: 'feelcoin:mainnet',
        asset: 'FEEL',
        walletSupport: false,
        sendSupport: false,
        signingSupport: false,
        stage: 'read-only-development',
      };
    case 'feelcoin_getNetworkStatus': {
      const response = await fetch(API, { method: 'GET' });
      if (!response.ok) {
        throw new Error('Feelcoin network status unavailable');
      }
      const result = await response.json();
      // Do not forward arbitrary remote content to the caller.
      return {
        height: result.height ?? null,
        difficulty: result.difficulty ?? null,
        networkHashrate: result.network_hashrate ?? null,
      };
    }
    default:
      throw new Error('Method not found');
  }
};
