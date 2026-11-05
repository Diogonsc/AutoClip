import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('first-launch allowlist is explicit and excludes every Shop Edge Function', async () => {
  const names = (await read('deploy/edge-functions-first-launch.txt'))
    .split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  assert.equal(new Set(names).size, names.length, 'allowlist contains no duplicates');
  assert.deepEqual(names, [
    'admin-users', 'client-approval', 'media-cleanup', 'media-serve', 'media-validate',
    'publication-worker', 'tiktok-channel', 'tiktok-oauth-callback', 'video-worker-api',
  ]);
  for (const shop of ['tiktok-shop', 'tiktok-shop-oauth-callback', 'tiktok-shop-publish']) {
    assert.equal(names.includes(shop), false, `${shop} must not be deployed`);
  }
  const functionDirs = (await readdir(new URL('supabase/functions/', root), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => entry.name).sort();
  assert.deepEqual(functionDirs.filter((name) => !name.startsWith('tiktok-shop')), [...names].sort());
});

test('Shop endpoints check server availability before parsing input or performing I/O', async () => {
  const endpoints = [
    ['supabase/functions/tiktok-shop/index.ts', 'req.json()', 'rpcAsUser(', 'freshToken(', 'shopRequest('],
    ['supabase/functions/tiktok-shop-oauth-callback/index.ts', 'searchParams', 'serviceClient()', 'fetchShopOAuth('],
    ['supabase/functions/tiktok-shop-publish/index.ts', 'req.json()', 'serviceClient()', 'token(connection', 'request('],
  ];
  for (const [path, ...effects] of endpoints) {
    const source = await read(path);
    const guard = source.indexOf('if (!isTikTokShopEnabled()) return tikTokShopUnavailableResponse');
    assert.notEqual(guard, -1, `${path} has a centralized fail-closed guard`);
    const handler = source.indexOf('Deno.serve(async (req) => {');
    assert.ok(guard > handler, `${path} guard is inside request handler`);
    for (const effect of effects) {
      const position = source.indexOf(effect, handler);
      if (position !== -1) assert.ok(guard < position, `${path}: guard precedes ${effect}`);
    }
  }
});

test('Shop UI and data hooks are not reachable from active frontend routes', async () => {
  const app = await read('apps/web/src/App.tsx');
  const layout = await read('apps/web/src/components/Layout.tsx');
  const form = await read('apps/web/src/components/PublicationForm.tsx');
  const hooks = await read('apps/web/src/lib/hooks.ts');
  const landing = await read('apps/web/src/pages/LandingPage.tsx');
  const shopPage = await read('apps/web/src/pages/TikTokShopPage.tsx');
  assert.doesNotMatch(app, /Route\s+path=["']shop["']/i);
  assert.doesNotMatch(app, /TikTokShopPage/);
  assert.doesNotMatch(layout, /\/shop|TikTok Shop|ShoppingBag/);
  assert.doesNotMatch(form, /shop_product_id|shop_anchor_title|shop_is_ai_generated|TikTokShopProducts/);
  assert.doesNotMatch(hooks, /useTikTokShop(Connections|Products|Orders)/);
  assert.doesNotMatch(landing, /TikTok Shop|afiliad[oa]s/i);
  assert.doesNotMatch(shopPage, /useTikTokShop|invokeFunction|tiktok-shop|Sincronizar|Conectar TikTok Shop/);
});

test('SQL availability migration protects claims and revokes Shop client access', async () => {
  const migration = await read('supabase/migrations/20261104000001_disable_tiktok_shop_for_initial_launch.sql');
  assert.match(migration, /shop_product_id is null/);
  assert.match(migration, /shop_video_id is null/);
  assert.match(migration, /not like 'shop:%'/);
  assert.match(migration, /from public, anon, authenticated, service_role/i);
  assert.match(migration, /TIKTOK_SHOP_DISABLED/);
  const loginKitTokens = await read('supabase/functions/_shared/tokens.ts');
  assert.match(loginKitTokens, /export async function ensureAccessToken/);
  assert.doesNotMatch(loginKitTokens, /TIKTOK_SHOP_ENABLED/);
});

test('no repository deployment automation uses a deploy-all Edge Function command', async () => {
  const workflows = await readdir(new URL('.github/workflows/', root)).catch(() => []);
  assert.equal(workflows.length, 0, 'unexpected CI workflow must be reviewed before release');
  const runbook = await read('deploy/EDGE_FUNCTIONS_FIRST_LAUNCH.md');
  assert.match(runbook, /explicit names/i);
  assert.match(runbook, /does not disable an older already-deployed\s+copy/i);
});
