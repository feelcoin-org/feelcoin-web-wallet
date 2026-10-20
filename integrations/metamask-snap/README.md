# Feelcoin Snap — experimental native FEEL integration

Status: **development scaffold only**. This is not a packaged or installable Snap yet.

## Goal
Support native Feelcoin (CryptoNote/RandomX) in MetaMask Snaps without creating an EVM token or a bridge.

## Implemented in this branch
- Read-only `feelcoin_getCapabilities` and `feelcoin_getNetworkStatus` handlers.
- Strictly no private-key handling, entropy access, signing, broadcasting, wallet RPC, or database changes.
- Network status uses the **public read-only** Feelcoin API.

## Security boundaries
- Do **not** treat Ethereum keys or addresses as Feelcoin keys or addresses.
- Native FEEL balance cannot reliably be derived from a public address alone for a privacy-oriented CryptoNote blockchain; obtaining correct wallet balances requires private view-key logic or appropriately designed trusted client-side scanning.
- Do not send seed phrases or private view/spend keys to `api.feelcoin.org` or other external endpoints.
- Before key management: evaluate MetaMask non-EVM account API, SES-compatible CryptoNote cryptography, deterministic recovery, secure client-side scanning, and transaction construction/signing.
- Never use live wallet credentials in an experimental build.

## Proposed follow-up
1. Package this scaffold using the current supported MetaMask Snaps CLI and permissions, run lint/build/SES evaluation and MetaMask extension tests.
2. Implement local native FEEL key derivation against test vectors, with reproducible recovery tests.
3. Add privacy-preserving wallet scanning, display and send after security review.

Reference: https://docs.metamask.io/snaps/features/non-evm-networks/
