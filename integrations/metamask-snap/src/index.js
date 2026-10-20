/**
 * Feelcoin Snap: read-only development entry point.
 * Never accepts wallet secrets and does not sign or broadcast transactions.
 */
const API = 'https://api.feelcoin.org/v1/network';

module.exports.onRpcRequest = async ({ request }) => {
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
      if (!response.ok) throw new Error('Feelcoin network status unavailable');
      const result = await response.json();
      return {
        height: typeof result.height === 'number' ? result.height : null,
        difficulty: typeof result.difficulty === 'number' ? result.difficulty : null,
        networkHashrate: typeof result.network_hashrate === 'number' ? result.network_hashrate : null,
      };
    }
    default:
      throw new Error('Method not found');
  }
};
