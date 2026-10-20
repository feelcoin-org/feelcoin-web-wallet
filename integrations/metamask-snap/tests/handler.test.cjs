const test = require('node:test');
const assert = require('node:assert/strict');
const { onRpcRequest } = require('../src/index.js');

test('capabilities are read-only', async () => {
  const result = await onRpcRequest({request:{method:'feelcoin_getCapabilities'}});
  assert.equal(result.walletSupport,false);
  assert.equal(result.signingSupport,false);
  assert.equal(result.sendSupport,false);
});
test('unknown methods are denied', async () => {
  await assert.rejects(onRpcRequest({request:{method:'feelcoin_send'}}),/Method not found/);
});
test('network RPC returns restricted fields', async () => {
  const oldFetch=global.fetch;
  global.fetch=async()=>({ok:true,json:async()=>({height:125,difficulty:5000,network_hashrate:42,secret:'discard'})});
  try {
    const result=await onRpcRequest({request:{method:'feelcoin_getNetworkStatus'}});
    assert.deepEqual(result,{height:125,difficulty:5000,networkHashrate:42});
  } finally { global.fetch=oldFetch; }
});
