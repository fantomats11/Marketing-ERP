# Integration Credential Sources

This file contains references only. It must never contain secret values.

## Development Sources

| Integration | Source | Required values | Verification status |
|---|---|---|---|
| Airtable | `./.env.local` | `AIRTABLE_PAT`, `AIRTABLE_BASE_IDS` | Connected; schema read succeeded |
| Google Ads | `./.env.local` | Developer token, OAuth client, refresh token, login customer ID | OAuth and read-only campaign queries succeeded |
| TikTok | `./.env.local` | App ID, App Secret, OAuth access token | App credentials present; advertiser access token still required |
| LINE Rent A Coat | `./.env.local` | Provider ID, Channel Secret, Channel Access Token | `bot/info` read-only check succeeded |
| LINE GO Mall | `./.env.local` | Provider ID, Channel Secret, Channel Access Token | `bot/info` read-only check succeeded |
| Google Search Console | `./.secrets/gsc-private-key.json` | Service account JSON key | Read-only API check succeeded for 2 properties |
| FlowAccount | Not configured | Open API client credentials | Pending API access and document reconciliation discovery |
| Google Search Console | `./gsc-private-key.json` | Service Account JSON | Active (`siteFullUser` permission verified) |

## Production Rule

The canonical local development file is `./.env.local`. The original `.env.airtable.local` is retained temporarily as an existing backup and should not be used by the application once the consolidated file has been verified. For production, migrate all values to a managed Secret Manager and expose them to the application through environment variables.

## Current API Findings

- Google Ads API v23 OAuth is valid.
- Google Ads read access works for Rent A Coat customer `888-950-6623`, GO Mall customer `627-054-8325`, and the manager account `218-829-6866`.
- LINE access tokens for both active brands are valid for read-only bot information.
- TikTok App ID and App Secret are present, but no TikTok advertiser access token variable is present.
- Google Search Console is accessible as `siteFullUser` for `rentacoat.com` and `gomall.fashion`.
- FlowAccount has not yet been connected; CA document matching remains an open discovery task.
