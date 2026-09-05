# Zelf Wallet — Web Extension

A Manifest V3 Chrome extension for self-custody crypto, identity, passwords, and 2FA. Access is gated by **HumanAuthn**: a face-derived encryption and recovery model that does not store raw biometric data. A **Zelf ID** is the portable identity that wallets, vault items, and authenticator secrets attach to.

The Chrome Web Store listing currently ships as **Zelf Name Service**. This repository is the browser client for the products on [zelf.world](https://zelf.world).

- [zelf.world](https://zelf.world) — product site
- [Download](https://zelf.world/download) — Chrome, Brave, Edge, iOS, and Android
- [Chrome Web Store](https://chromewebstore.google.com/detail/zelf-name-service/ennoagncbcpgikfajeeakjolikjmindc)
- [Documentation](https://docs.zelf.world/docs/intro)
- [HumanAuthn](https://humanauthn.com)

## What’s in this extension

### zWallet

Self-custody wallet with create, import, and recover flows. Balances, send, receive, swaps (LiFi), activity, collectibles, WalletConnect v2, and an in-page Web3 provider (`window.zelf`, EIP-1193 / EIP-6963).

### Zelf ID

Claim, import, recover, and manage a Zelf ID. New names use the v4 identity API. Older ZNS / Tags names remain supported for existing domains. Domain purchase and management live in the extension; checkout can open [zelf.world](https://zelf.world/tags/payment).

### zKeys

Encrypted vault for passwords and payment cards, plus password generation and website autofill via content scripts.

### zAuth

Protected TOTP / 2FA storage and recovery (Zelf Authenticator). Secrets are encrypted with HumanAuthn rather than a conventional cloud backup.

### Rewards

In-app $ZNS quests: daily rewards, invite friends, first transaction, claim, and redeem.

### Coming soon

**Zelf AI** and **Zelf Signals** have routes and hub entries, but they are placeholder screens. They are not shipped products.

Zelf Chat is not part of this extension. Residual placeholder code should not be treated as a product.

## Supported networks

Configured in `src/app/core/network-settings.util.ts`:

| Network | Symbol |
|---|---|
| Ethereum | ETH |
| Avalanche | AVAX |
| BNB Chain | BNB |
| Bitcoin | BTC |
| BlockDAG | BDAG |
| Polygon | POL |
| Solana | SOL |
| Stellar | XLM |
| Sui | SUI |
| TON | TON |
| Polkadot | DOT |
| Kusama | KSM |

Users can enable or disable networks in Settings.

## Zelf ecosystem

These are related products on zelf.world and the public APIs. They are **not** all features of this extension.

### How the pieces fit together

1. **Zelf ID** is the human-readable identity (v4 on `https://v4.zelf.world`; legacy Tags / ZNS on `https://v3.zelf.world`).
2. **HumanAuthn** encrypts and unlocks sensitive material from a live face scan. Raw biometrics are not stored.
3. This **extension** is the browser client for zWallet, zKeys, zAuth, Rewards, and dApp connections.

### Shipped here and marketed on zelf.world

| Product | Site | In this extension |
|---|---|---|
| zWallet | [zelf.world/zelf-wallet](https://zelf.world/zelf-wallet) | Yes |
| zKeys | [zelf.world/zelf-keys](https://zelf.world/zelf-keys) | Yes |
| zAuth | [zelf.world/zelf-auth](https://zelf.world/zelf-auth) | Yes |
| Zelf ID | [zelf.world](https://zelf.world/tags/payment) / [pricing](https://zelf.world/pricing) | Yes |
| Rewards | [zelf.world/rewards](https://zelf.world/rewards) | Yes |

### Related products (other clients)

| Product | Where it lives |
|---|---|
| [HumanAuthn](https://humanauthn.com) | Identity and encryption layer used by the apps |
| [Zelf Send](https://zelf.world/zsend) | Web file transfer on zelf.world (not an extension screen) |
| Zelf Legacy | Mobile / chain-specific inheritance on zelf.world (`/zelf-legacy-avalanche`, `/zelf-legacy-stellar`, `/zelf-legacy-base`, `/zelf-legacy-bnb`). Not in this extension. |
| Developer docs | [docs.zelf.world](https://docs.zelf.world/docs/intro) — Zelf ID, Zelf Keys, Face Certificates, zSend, licenses |

### Explore (not core extension services)

- [$ZNS](https://zelf.world/presale) — token / presale
- [Zelf Trade](https://zelf.world/zelf-trade) — trading-signals content
- BlockDAG NFT marketplace (`/nft`) — sunset on zelf.world

The extension still has collectible / NFT import screens for wallet assets. That is separate from the sunset marketplace.

## Tech stack

- Angular 20 and TypeScript ~5.8
- Custom Architect builder plus Webpack for background, content, autofill, and in-page provider scripts
- Chrome Manifest V3 (popup and side panel)
- Transloco for i18n
- RxJS 7
- WalletConnect v2 via Reown WalletKit

**Supported browser:** Chrome / Chromium (Brave and Edge via the same Chrome Web Store listing). Firefox packaging exists under `configurations/extension/firefox/` but is incomplete and not version-synced.

## Architecture

```
Angular UI (popup / side panel)
        │
        ▼
background service worker
        │
        ├── content scripts (autofill)
        ├── in-page provider + bridge (dApps)
        └── offscreen document (WalletConnect)
```

| Piece | Location |
|---|---|
| Angular app | `src/app/` |
| Routes | `src/app/app-routing.module.ts` |
| Background worker | `background-scripts/` |
| Content / autofill / provider | `content-scripts/` |
| Offscreen WalletConnect | `offscreen/walletconnect-offscreen.html` |
| Chrome manifest | `configurations/manifest.json` |
| App environments | `src/environments/` |
| Extension-script environments | `extension-scripts/environments/` |

Production API origins (from `src/environments/environment-ext.prod.ts`):

- Tags / ZNS: `https://v3.zelf.world`
- Zelf ID v4: `https://v4.zelf.world`
- Keys: `https://keys.zelf.world`
- Payments: `https://zelf.world/tags/payment` and `https://zelf.world/zelf-ids/payment`

Local Angular config in `src/environments/environment.ts` points at `http://localhost:3050` and payment URLs on `http://localhost:3009`.

## Requirements

- **Node.js** — LTS compatible with Angular 20 (20.x or 22.x recommended)
- **npm**
- **Chrome or Chromium** for loading the unpacked extension

There is no `.env` file. Configuration is TypeScript. The repo does not pin an `.nvmrc`.

## Install

```bash
npm install
```

For watch / development webpack, create the gitignored extension-script env file. See `extension-scripts/environments/README.md`.

```ts
// extension-scripts/environments/environment.dev.ts
export const environment = {
    production: false,
    apiBaseUrl: "http://localhost:3050",
};
```

## Development

The default workflow is the custom extension builder in watch mode. It compiles Angular and the Webpack extension scripts into `dist/dev`:

```bash
npm run watch
```

Then load the extension in Chrome:

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select `dist/dev`

Reload the extension in Chrome after the watcher rebuilds.

### Dev server (optional)

`npm start` runs `ng serve` at `http://localhost:4200/`. Use it to iterate on UI outside the extension context. It does **not** produce loadable extension output.

## Build

| Command | What it does |
|---|---|
| `npm run watch` | Dev Chrome builder in watch mode — output in `dist/dev` |
| `npm run build:dev` | One-off dev Chrome build — `dist/dev` |
| `npm run build:prod` | Production build + unit tests + Transloco optimize — `dist/prod` |
| `npm run build` | Bumps patch version, then runs `build:prod` |

Version bumps (`bump:major`, `bump:minor`, `bump:patch`) update `package.json` and the Chrome manifest via `scripts/sync-versions.js`. The Firefox manifest is not synced.

Production Angular builds replace `src/environments/environment.ts` with `src/environments/environment-ext.prod.ts`.

## Testing

```bash
npm test                # Headless Chrome, single run
npm run test:ci         # CI-optimized (ChromeHeadlessCI)
npm run test:coverage   # With code coverage report
```

End-to-end scripts (`npm run e2e`, `npm run e2e:headless`) are **not currently runnable**. The Puppeteer schematic dependency and e2e specs are absent.

## Internationalization

Translation files live in `src/assets/i18n/`. Configured locales in `transloco.config.ts`: English, Spanish, Portuguese (`br`), French, Russian, Korean, Hindi (`in`), Chinese (`cn`), Filipino (`ph`), Japanese, Arabic.

| Command | Purpose |
|---|---|
| `npm run i18n:find` | Find translation keys in source (Transloco keys manager) |
| `npm run i18n:sync` | Sync translation files across locales |
| `npm run check-translations` | Check for missing or unused keys |
| `npm run apply-translations` | Apply pending translation updates |

## Permissions

The Chrome manifest requests all-site host access, content scripts, storage, clipboard read/write, tabs, side panel, offscreen documents, and notifications so the extension can:

- Inject the Web3 provider and autofill credentials on websites
- Persist wallet and vault state locally
- Copy addresses and fill forms
- Run WalletConnect in an offscreen document
- Show the UI as a popup or side panel

Do not commit mnemonics, private keys, decrypted vault items, or production secrets.

## License

Proprietary. See repository for terms.

## Keeping this README current

Before changing feature, install, or ecosystem claims, verify:

- Routes in `src/app/app-routing.module.ts` and hub entries in `src/app/zelf-footer/footer-navigation.service.ts`
- Networks in `src/app/core/network-settings.util.ts`
- Scripts in `package.json`
- Production URLs in `src/environments/environment-ext.prod.ts`
- Public download links on [zelf.world/download](https://zelf.world/download)
