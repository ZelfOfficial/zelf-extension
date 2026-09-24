# TON (Toncoin) Integration

Research notes and design decisions for **TON (The Open Network)** as a first-class
network in the Zelf wallet extension. Mirrors the existing non-EVM precedents
(Sui, Stellar, Polkadot/Kusama).

This document reconciles [Open-Verifik/zelf-extension#222](https://github.com/Open-Verifik/zelf-extension/pull/222)
with the ZelfOfficial `v3` stack (backend-aligned Wallet V5R1, native send, tx history).

## Research summary

- **Token:** Toncoin (TON), native coin of The Open Network. 9 decimals (1 TON = 1e9 nanoton).
- **Account model:** TON is contract-based — a "wallet" is a smart contract that holds the balance and verifies an ed25519 signature. Zelf uses **Wallet V5R1** (`WalletContractV5R1`), aligned with the Zelf backend.
- **Addresses:** derived from `(workchain, stateInit hash)`. The backend stores the bounceable (`EQ…`) form in `publicData.tonAddress`.
- **Key derivation:** Zelf wallets use **one BIP39 mnemonic shared across all chains**. TON keys are derived from the BIP39 seed via SLIP-0010 ed25519 at path **`m/44'/607'/0'`** (607 = TON's SLIP-44 coin type).
- **RPC:** public access via **toncenter** for client-side sends; balances and transaction history use the Zelf backend API.

### References
- https://coinmarketcap.com/currencies/toncoin/
- https://docs.ton.org/

## What this integration adds

| Area | File |
|---|---|
| Key derivation (BIP39 → ed25519 → V5R1 address) | `shared/utils/ton-derivation.util.ts` |
| Chain service (balance / fees / send / tx history) | `src/app/services/ton.service.ts` |
| `publicData.tonAddress` reader + model field | `shared/types/tag.types.ts` |
| Network registry (name/symbol/chainId/image) | `src/app/services/network.service.ts` |
| Manage-Networks defaults | `src/app/core/network-settings.util.ts` |
| Wallet wiring (address, available networks, icon) | `src/app/wallet.service.ts` |
| Routing (balance / fees / send / explorer / history) | `src/app/services/blockchain-transactions.service.ts` |
| RPC config | `src/environments/environment*.ts` |
| Network icon | `src/assets/networks/ton.svg` |
| SDKs | `@ton/ton`, `@ton/core`, `@ton/crypto` |

## Contract with the backend

Like every other chain, the TON address is expected from the API in
`publicData.tonAddress` (with `toncoinAddress` / `ton` chunk fallbacks via
`readPublicDataTonAddress`). The client-side derivation in
`ton-derivation.util.ts` **must match the backend derivation** so the derived
keypair controls the same address the API stores (same relationship documented
in `substrate-derivation.util.ts`).

## Known limitations / follow-ups

- **Fee estimation** uses a stable constant (~0.0055 TON) instead of dynamic `estimateExternalMessageFee`.
- Wallet contract is fixed to **V5R1** to match the Zelf backend.
