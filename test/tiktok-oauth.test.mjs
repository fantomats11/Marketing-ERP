import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { spawn } from 'node:child_process';
import {
  buildAuthorizationUrl,
  createStateToken,
  exchangeAuthCode,
  handleCallback,
  verifyStateToken,
} from '../src/tiktok-oauth.mjs';

test('builds an advertiser authorization URL with the configured redirect URI', () => {
  const url = buildAuthorizationUrl({
    appId: 'app-123',
    redirectUri: 'https://www.rentacoat.com/tiktok/oauth/callback',
    state: 'state-123',
  });

  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://business-api.tiktok.com');
  assert.equal(parsed.pathname, '/portal/auth');
  assert.equal(parsed.searchParams.get('app_id'), 'app-123');
  assert.equal(parsed.searchParams.get('state'), 'state-123');
  assert.equal(
    parsed.searchParams.get('redirect_uri'),
    'https://www.rentacoat.com/tiktok/oauth/callback',
  );
});

test('accepts a fresh state token and rejects tampered or expired tokens', () => {
  const secret = 'state-secret';
  const now = 1_700_000_000_000;
  const state = createStateToken(secret, now, 'nonce-123');

  assert.equal(verifyStateToken(state, secret, 600_000, now + 10_000), true);
  assert.equal(verifyStateToken(`${state}x`, secret, 600_000, now + 10_000), false);
  assert.equal(verifyStateToken(state, secret, 600_000, now + 601_000), false);
});

test('exchanges auth_code against the current TikTok v1.3 token endpoint', async () => {
  let request;
  const result = await exchangeAuthCode({
    appId: 'app-123',
    appSecret: 'secret-123',
    authCode: 'auth-code-123',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(
        JSON.stringify({
          code: 0,
          message: 'OK',
          data: {
            access_token: 'access-token-123',
            advertiser_ids: ['7245294214857129985'],
            scope: [1, 2],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });

  assert.equal(
    request.url,
    'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/',
  );
  assert.deepEqual(JSON.parse(request.options.body), {
    app_id: 'app-123',
    secret: 'secret-123',
    auth_code: 'auth-code-123',
  });
  assert.deepEqual(result, {
    accessToken: 'access-token-123',
    advertiserIds: ['7245294214857129985'],
    scope: [1, 2],
  });
});

test('redacts TikTok provider response details from token exchange errors', async () => {
  const providerSecret = 'provider-message-contains-a-secret';

  await assert.rejects(
    () => exchangeAuthCode({
      appId: 'app-123',
      appSecret: 'secret-123',
      authCode: 'auth-code-123',
      fetchImpl: async () => new Response(
        JSON.stringify({
          code: 40001,
          message: providerSecret,
          data: { diagnostic: 'raw-provider-payload' },
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ),
    }),
    (error) => {
      assert.equal(error.message, 'TikTok token exchange failed');
      assert.doesNotMatch(error.message, /provider-message|40001|403|raw-provider-payload/);
      return true;
    },
  );
});

test('callback stores the token and never renders the access token', async () => {
  const secret = 'state-secret';
  const state = createStateToken(secret, Date.now(), 'nonce-123');
  let stored;

  const response = await handleCallback({
    query: { auth_code: 'auth-code-123', state },
    config: {
      appId: 'app-123',
      appSecret: 'secret-123',
      stateSecret: secret,
      allowedAdvertiserIds: ['7245294214857129985'],
    },
    exchange: async () => ({
      accessToken: 'must-not-render',
      advertiserIds: ['7245294214857129985'],
      scope: [1, 2],
    }),
    tokenStore: {
      async save(value) {
        stored = value;
      },
    },
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /TikTok authorization successful/);
  assert.doesNotMatch(response.body, /must-not-render/);
  assert.deepEqual(stored, {
    accessToken: 'must-not-render',
    advertiserIds: ['7245294214857129985'],
    scope: [1, 2],
  });
});

test('callback rejects authorization from an unexpected advertiser account', async () => {
  const secret = 'state-secret';
  const state = createStateToken(secret, Date.now(), 'nonce-123');

  await assert.rejects(
    () => handleCallback({
      query: { auth_code: 'auth-code-123', state },
      config: {
        appId: 'app-123',
        appSecret: 'secret-123',
        stateSecret: secret,
        allowedAdvertiserIds: ['7533483786189832193'],
      },
      exchange: async () => ({
        accessToken: 'access-token-123',
        advertiserIds: ['7245294214857129985'],
        scope: [1, 2],
      }),
      tokenStore: { async save() {} },
    }),
    /No allowed advertiser account was authorized/,
  );
});

test('standalone OAuth service renders a fixed public failure message', async () => {
  const port = await findUnusedPort();
  const server = spawn(process.execPath, ['src/server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });

  try {
    await waitForHealthcheck(port);
    const response = await fetch(`http://127.0.0.1:${port}/tiktok/oauth/start`);
    const body = await response.text();

    assert.equal(response.status, 500);
    assert.match(body, /Unable to complete TikTok authorization\. Please try again later\./);
    assert.doesNotMatch(body, /OAUTH_STATE_SECRET is required/);
  } finally {
    server.kill();
    await once(server, 'exit');
  }
});

async function findUnusedPort() {
  const server = createHttpServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForHealthcheck(port) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) return;
    } catch {
      // The child process has not opened its listener yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('TikTok OAuth service did not become ready.');
}
