import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const TIKTOK_ACCESS_TOKEN_URL =
  'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/';
export const TIKTOK_AUTHORIZATION_URL =
  'https://business-api.tiktok.com/portal/auth';

const TOKEN_EXCHANGE_FAILURE_MESSAGE = 'TikTok token exchange failed';

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function createStateToken(secret, now = Date.now(), nonce = randomBytes(16).toString('base64url')) {
  if (!secret) throw new Error('OAUTH_STATE_SECRET is required');
  const payload = Buffer.from(`${now}.${nonce}`).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyStateToken(state, secret, maxAgeMs = 600_000, now = Date.now()) {
  try {
    if (!state || !secret) return false;
    const [payload, signature] = state.split('.');
    if (!payload || !signature) return false;

    const expected = sign(payload, secret);
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) return false;

    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    const [createdAt] = decoded.split('.');
    const timestamp = Number(createdAt);
    return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= maxAgeMs;
  } catch {
    return false;
  }
}

export function buildAuthorizationUrl({ appId, redirectUri, state }) {
  if (!appId || !redirectUri || !state) {
    throw new Error('TikTok appId, redirectUri, and state are required');
  }

  const url = new URL(TIKTOK_AUTHORIZATION_URL);
  url.searchParams.set('app_id', appId);
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', redirectUri);
  return url.toString();
}

export async function exchangeAuthCode({ appId, appSecret, authCode, fetchImpl = fetch }) {
  try {
    if (!appId || !appSecret || !authCode) {
      throw new Error('Missing TikTok token exchange input');
    }

    const response = await fetchImpl(TIKTOK_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: appId, secret: appSecret, auth_code: authCode }),
    });
    const body = await response.json();

    if (!response.ok || body.code !== 0 || !body.data?.access_token) {
      throw new Error('TikTok token exchange rejected');
    }

    return {
      accessToken: body.data.access_token,
      advertiserIds: (body.data.advertiser_ids || []).map(String),
      scope: body.data.scope || [],
    };
  } catch {
    throw new Error(TOKEN_EXCHANGE_FAILURE_MESSAGE);
  }
}

function htmlEscape(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]);
}

function successHtml(advertiserIds) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>TikTok Connected</title></head><body><h1>TikTok authorization successful</h1><p>Authorized advertiser accounts: ${advertiserIds.map(htmlEscape).join(', ') || 'none'}</p><p>You may close this window.</p></body></html>`;
}

export async function handleCallback({ query, config, exchange = exchangeAuthCode, tokenStore }) {
  const state = query.state;
  const authCode = query.auth_code || query.code;

  if (!verifyStateToken(state, config.stateSecret, config.stateMaxAgeMs)) {
    throw new Error('Invalid or expired OAuth state');
  }
  if (!authCode) throw new Error('Missing TikTok authorization code');

  const token = await exchange({
    appId: config.appId,
    appSecret: config.appSecret,
    authCode,
  });

  const allowed = new Set((config.allowedAdvertiserIds || []).map(String));
  const authorized = token.advertiserIds.filter((id) => allowed.has(id));
  if (allowed.size > 0 && authorized.length === 0) {
    throw new Error('No allowed advertiser account was authorized');
  }

  if (!tokenStore?.save) throw new Error('TikTok token store is not configured');
  await tokenStore.save(token);

  return {
    statusCode: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: successHtml(authorized.length ? authorized : token.advertiserIds),
  };
}

export function createFileTokenStore(filePath) {
  return {
    async save(token) {
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      await writeFile(
        temporaryPath,
        JSON.stringify({ ...token, obtainedAt: new Date().toISOString() }, null, 2),
        { mode: 0o600, encoding: 'utf8' },
      );
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, filePath);
      await chmod(filePath, 0o600);
    },
  };
}
