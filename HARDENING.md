# Production Hardening

The Feelcoin browser wallet is designed as a non-custodial wallet.

## Browser security

The production service uses:

- a same-origin Content Security Policy;
- no third-party runtime scripts;
- clickjacking protection;
- no-referrer policy through Helmet;
- strict transport security;
- API no-store responses;
- Origin and Fetch Metadata validation;
- request-rate limits;
- signed-transaction input validation.

The current MyMonero/Emscripten WASM build requires CSP `unsafe-eval`
compatibility. Removing this exception is a future hardening target when the
WASM runtime is upgraded and verified without it.

## Wallet isolation

Recovery seeds and private spend/view keys remain browser-side.

The legacy server-side wallet API is explicitly disabled in production.

The production relay accepts a serialized transaction that has already been
constructed and signed locally.

## Local persistence

Wallet vault information is encrypted locally in the browser.

Blockchain scan state is encrypted separately and stored in IndexedDB.

## Server isolation

The browser-wallet Node.js process is restricted with systemd hardening
including no-new-privileges, private temporary storage, restricted kernel
access, an empty capability bounding set and restricted address families.

## Security status

The wallet has undergone functional Feelcoin mainnet testing.

This repository does not claim that the wallet has completed an independent
professional security audit.
