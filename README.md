# Feelcoin Browser Wallet

<!-- FEELCOIN-OFFICIAL-LINKS:START -->
## Official Feelcoin Ecosystem

| Service | Official address |
|---|---|
| Website | https://feelcoin.org |
| Mining Pool | https://pool.feelcoin.org |
| Block Explorer | https://explorer.feelcoin.org |
| Non-Custodial Web Wallet | https://wallet.feelcoin.org |
| Paper Wallet | https://paper.feelcoin.org |

### Mining endpoints

Standard mining: `pool.feelcoin.org:4242`

TLS mining: `pool.feelcoin.org:4244`

`feelcoin.org` is the canonical public domain for the Feelcoin ecosystem.
<!-- FEELCOIN-OFFICIAL-LINKS:END -->


**In Feels We Trust**

Official non-custodial browser wallet for the Feelcoin network.

## Architecture

Wallet creation, wallet restoration, private-key handling, blockchain ownership
detection and transaction signing occur in the browser.

The Feelcoin server provides public blockchain information and relay services.
A signed transaction is constructed locally before it is submitted to the
network.

The production browser-wallet backend does not store user wallet files.

## Features

- Local Feelcoin wallet creation
- Restore from recovery seed
- Restore from private keys
- View-only wallet support
- Password-encrypted local wallet vault
- AES-256-GCM encryption
- PBKDF2-SHA256 wallet-key derivation
- Browser-side blockchain scanning
- RingCT output detection
- Coinbase/mining-output detection
- Local key-image generation
- Correct spent-output tracking
- Encrypted IndexedDB blockchain scan cache
- Incremental blockchain synchronization
- Incoming and outgoing transaction history
- Balance and unlocked-balance calculation
- Browser-side transaction construction and signing
- Ring size 16
- Signed-transaction broadcast

## Persistent synchronization

Blockchain scan state is encrypted locally and stored using IndexedDB.

When a wallet is reopened, its previously synchronized state is restored
immediately. The wallet verifies the cached chain tip and scans only newer
blocks.

If the cached state is invalid or inconsistent, the wallet safely falls back
to a complete blockchain rescan.

## Security model

The recovery seed and private spend key remain in the browser.

The backend provides:

- public blockchain information
- network health information
- fee information
- decoy-output information
- spent-key-image checks
- signed transaction relay

A transaction is constructed and signed locally before being submitted to the
Feelcoin network.

## Security status

The browser wallet has undergone functional Feelcoin mainnet testing,
including repeated real transactions, spent-input tracking, change detection,
coinbase-output handling and incremental synchronization.

This is not a claim of an independent security audit.

Browser wallets inherit risks from browser extensions, injected scripts,
malware, phishing and compromised operating systems.

For meaningful funds, use a clean trusted environment and maintain an
independent recovery-seed backup.

## Related projects

- Core: https://github.com/feelcoin-org/feelcoin
- Mining Pool: https://github.com/feelcoin-org/feelcoin-pool
- Block Explorer: https://github.com/feelcoin-org/feelcoin-explorer
- Paper Wallet: https://github.com/feelcoin-org/feelcoin-paper-wallet

## Development

Install dependencies with:

    npm install

Never commit wallet files, recovery seeds, private keys, environment secrets
or production credentials.

---

**Feelcoin — In Feels We Trust**

---

## In Feels We Trust

## Contact

Official Feelcoin support and project contact:

[**support@feelcoin.org**](mailto:support@feelcoin.org)

---

## Support Feelcoin Development

Feelcoin is an open-source project.

If you would like to support ongoing development, infrastructure, documentation, testing, and community services, voluntary donations are welcome.

### FEEL

```text
FBx9yk7huEF9PjR33zABbUj915wFVw3LeXfHSX4F7eXMgvyrkaV7tEW4gDwZ9rnQdnRQ4RmZsfPyNezu2jFoLewZLCuS8iM
```

### Bitcoin

Bitcoin mainnet:

```text
bc1q78zv45v3tfek730x8es88vjavj0qej2n766h2f
```

### Ethereum

Ethereum mainnet:

```text
0x7eFC0c47ab555041c79a7269a37f46A835EB466f
```

Donations are entirely voluntary and do not provide ownership, governance rights, guaranteed returns, or preferential treatment.

These voluntary donation addresses are separate from the consensus-enforced Feelcoin development treasury.
