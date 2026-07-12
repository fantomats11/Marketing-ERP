# TikTok OAuth Callback

This project now contains a minimal Node.js OAuth callback service for TikTok for Business Marketing API v1.3.

## Routes

- `GET /tiktok/oauth/start` — generates a signed state and redirects to TikTok.
- `GET /tiktok/oauth/callback` — validates state, exchanges `auth_code`, validates advertiser IDs, and stores the token locally.
- `GET /api/integrations/tiktok/start` — API-prefixed alias for the start route.
- `GET /api/integrations/tiktok/callback` — API-prefixed alias for the callback route.
- `GET /healthz` — health check.

## Required environment variables

```env
TIKTOK_APP_ID=...
TIKTOK_APP_SECRET=...
OAUTH_STATE_SECRET=...
TIKTOK_REDIRECT_URI=https://www.rentacoat.com/tiktok/oauth/callback
TIKTOK_ADVERTISER_IDS=7245294214857129985,7533483786189832193
TIKTOK_TOKEN_FILE=./data/tiktok-token.json
```

The token file is ignored by Git and written with owner-only permissions. For production, replace the file token store with a managed Secret Manager or encrypted database store; do not rely on an ephemeral filesystem in a serverless deployment.

## Local run

```bash
npm test
npm run start:tiktok
```

`npm start` runs the built Fastify application foundation. The TikTok OAuth callback remains a separate legacy service and is started with `npm run start:tiktok` until it has durable token storage and authentication adapters.

The public TikTok Redirect URL must point to a deployed service that actually serves `/tiktok/oauth/callback`. The current WordPress 404 will remain until this service is deployed behind `www.rentacoat.com` or the TikTok Redirect URL is changed to the deployed service URL.
