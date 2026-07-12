import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

test('package start contract targets the built Fastify entrypoint and rejects invalid production configuration safely', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

  assert.equal(packageJson.engines?.node, '>=22');
  assert.equal(packageJson.scripts.start, 'node dist/index.js');
  assert.equal(packageJson.scripts['start:tiktok'], 'node src/server.mjs');

  const result = spawnSync(process.execPath, ['dist/index.js'], {
    cwd: process.cwd(),
    env: { PATH: process.env.PATH, APP_ENV: 'production' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), 'Application startup failed');
});
