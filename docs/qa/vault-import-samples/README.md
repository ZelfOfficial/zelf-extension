# Vault import QA samples

Synthetic password-manager export files used for local Zelf Keys vault import QA. **Fake credentials only** — `example.com` / `example.org` hosts and test passwords like `TestPass_*`; never real secrets.

## Files

| File | Import provider | Rows | Notes |
|------|-----------------|------|-------|
| [`lastpass-synthetic.csv`](./lastpass-synthetic.csv) | LastPass CSV | 5 | `url,username,password,extra,name,grouping,fav` |
| [`onepassword-synthetic.csv`](./onepassword-synthetic.csv) | 1Password CSV (full export) | 5 | Extra columns (`Favorite`, `Tags`, …) after core fields |
| [`onepassword-minimal-synthetic.csv`](./onepassword-minimal-synthetic.csv) | 1Password CSV (minimal) | 5 | `Title,URL,Username,Password,Notes` only |
| [`chrome-synthetic.csv`](./chrome-synthetic.csv) | Google Chrome / Passwords CSV | 5 | `name,url,username,password,note` |
| [`bitwarden-synthetic.csv`](./bitwarden-synthetic.csv) | Bitwarden CSV | 5 | `login_uri`, `login_username`, `login_password`, … |
| [`keepassxc-synthetic.csv`](./keepassxc-synthetic.csv) | KeePassXC CSV | 5 | `Group,Title,Username,Password,URL,Notes` |
| [`apple-synthetic.csv`](./apple-synthetic.csv) | Apple Passwords / iCloud CSV | 5 | Includes `OTPAuth` column |

Several rows exercise RFC 4180 edge cases (commas and quotes in notes/passwords).

## How to use

1. Open **Zelf Keys → Vault → Import passwords**.
2. Browse or drop any sample CSV (or paste its contents).
3. Confirm auto-detected format, select rows, and import.

On non-prod builds, the import preview step includes a **Store API (dev)** toggle to A/B one-by-one vs bulk store calls.

## Test mirror

The same CSV strings are exported from `src/app/services/fixtures/vault-import-sample-exports.ts` for unit tests. Update both locations when changing sample data.
