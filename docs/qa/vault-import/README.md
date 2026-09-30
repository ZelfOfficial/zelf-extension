# Vault import QA samples

Synthetic password-manager export files for manual Zelf Keys vault import testing. **Fake credentials only** — use `example.com` hosts and placeholder passwords, never real secrets.

## Files

| File | Format | Rows |
|------|--------|------|
| [`samples/lastpass-sample.csv`](./samples/lastpass-sample.csv) | LastPass CSV (`url,username,password,extra,name,grouping,fav`) | 5 |
| [`samples/1password-sample.csv`](./samples/1password-sample.csv) | 1Password CSV (`Title,URL,Username,Password,Notes`) | 5 |

## How to use

1. Open **Zelf Keys → Vault → Import passwords**.
2. Browse or drop one of the sample CSVs (or paste its contents).
3. Confirm auto-detected format, select rows, and run import.

On non-prod builds, the import preview step includes a **Store API (dev)** toggle to A/B one-by-one vs bulk store calls.

## Keeping samples in sync

The same CSV strings live in `src/app/services/fixtures/vault-import-sample-exports.ts` for unit tests. Update both locations when changing sample data.
