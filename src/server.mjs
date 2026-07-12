import { createServer } from 'node:http';
import { createFileTokenStore, buildAuthorizationUrl, createStateToken, exchangeAuthCode, handleCallback } from './tiktok-oauth.mjs';

const config = {
  appId: process.env.TIKTOK_APP_ID,
  appSecret: process.env.TIKTOK_APP_SECRET,
  redirectUri: process.env.TIKTOK_REDIRECT_URI || 'https://www.rentacoat.com/tiktok/oauth/callback',
  stateSecret: process.env.OAUTH_STATE_SECRET,
  allowedAdvertiserIds: (process.env.TIKTOK_ADVERTISER_IDS || '7245294214857129985,7533483786189832193')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  stateMaxAgeMs: 600_000,
};

const tokenStore = createFileTokenStore(
  process.env.TIKTOK_TOKEN_FILE || './data/tiktok-token.json',
);

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendHtml(res, statusCode, body) {
  res.writeHead(statusCode, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
}

function errorHtml() {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>TikTok OAuth Error</title></head><body><h1>TikTok authorization failed</h1><p>Unable to complete TikTok authorization. Please try again later.</p></body></html>';
}

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (requestUrl.pathname === '/healthz') return sendJson(res, 200, { ok: true });

  if (requestUrl.pathname === '/tiktok/oauth/start' || requestUrl.pathname === '/api/integrations/tiktok/start') {
    try {
      const state = createStateToken(config.stateSecret);
      res.writeHead(302, { location: buildAuthorizationUrl({ appId: config.appId, redirectUri: config.redirectUri, state }) });
      return res.end();
    } catch {
      return sendHtml(res, 500, errorHtml());
    }
  }

  if (requestUrl.pathname === '/tiktok/oauth/callback' || requestUrl.pathname === '/api/integrations/tiktok/callback') {
    try {
      const result = await handleCallback({
        query: Object.fromEntries(requestUrl.searchParams.entries()),
        config,
        tokenStore,
        exchange: (args) => exchangeAuthCode(args),
      });
      res.writeHead(result.statusCode, result.headers);
      return res.end(result.body);
    } catch {
      return sendHtml(res, 400, errorHtml());
    }
  }

  return sendJson(res, 404, { error: 'Not found' });
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`TikTok OAuth server listening on port ${port}`);
});
