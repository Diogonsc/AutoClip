import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleAdminUsers } from '../_shared/admin-users.ts';

const ORIGIN = 'https://app.example.com';
const OWNER = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const OTHER_OWNER = '33333333-3333-4333-8333-333333333333';

type Calls = string[];

function setup(over: Record<string, unknown> = {}) {
  const calls: Calls = [];
  const owners = new Set([OWNER]);
  const users: Record<string, { id: string; email: string; created_at: string; user_metadata: Record<string, unknown> }> = {
    [OWNER]: { id: OWNER, email: 'dono@x.com', created_at: '2026-01-02T10:00:00Z', user_metadata: { display_name: 'Dona' } },
    [CLIENT]: { id: CLIENT, email: 'cli@x.com', created_at: '2026-02-03T10:00:00Z', user_metadata: {} },
    [OTHER_OWNER]: { id: OTHER_OWNER, email: 'o2@x.com', created_at: '2026-03-03T10:00:00Z', user_metadata: {} },
  };
  const deps = {
    origins: [ORIGIN],
    authenticate: async (auth: string) => (auth === 'Bearer owner' ? { id: OWNER } : auth === 'Bearer client' ? { id: CLIENT } : null),
    isOwner: async (id: string) => owners.has(id),
    listUsers: async () => ({ users: Object.values(users), total: 3 }),
    getUser: async (id: string) => users[id] ?? null,
    inviteUser: async (email: string) => {
      calls.push(`invite:${email}`);
      return { id: '44444444-4444-4444-8444-444444444444', email, created_at: '2026-10-28T00:00:00Z' };
    },
    updateUser: async (id: string, patch: Record<string, unknown>) => {
      calls.push(`updateUser:${id}:${JSON.stringify(patch)}`);
      return users[id];
    },
    updateSettings: async (id: string, patch: Record<string, unknown>) => {
      calls.push(`settings:${id}:${JSON.stringify(patch)}`);
    },
    getSettings: async (ids: string[]) => ids.map((user_id) => ({ user_id, is_active: true, billing_started_at: '2026-02-03' })),
    deleteUser: async (id: string) => {
      calls.push(`delete:${id}`);
      return ['aaaaaaaa-0000-4000-8000-000000000001'];
    },
    purgeWorkspaceMedia: async (ids: string[]) => {
      calls.push(`purge:${ids.join(',')}`);
    },
    listOwners: async () => [...owners],
    isPlatformOwner: async (id: string) => owners.has(id),
    setFlags: async (flags: Record<string, boolean>) => {
      calls.push(`flags:${JSON.stringify(flags)}`);
    },
    getFlags: async () => ({ tiktok_audited: false }),
    ...over,
  };
  const call = (method: string, auth: string | null, opts: { body?: unknown; query?: string } = {}) =>
    handleAdminUsers(
      new Request(`https://x.supabase.co/functions/v1/admin-users${opts.query ?? ''}`, {
        method,
        headers: {
          origin: ORIGIN,
          ...(auth ? { authorization: auth } : {}),
          ...(opts.body ? { 'content-type': 'application/json' } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      }),
      deps as never,
    );
  return { call, calls, owners };
}

test('admin: preflight libera GET/PATCH/DELETE', async () => {
  const { call } = setup();
  const res = await call('OPTIONS', null);
  assert.equal(res.status, 204);
  const methods = res.headers.get('access-control-allow-methods') ?? '';
  for (const m of ['GET', 'POST', 'PATCH', 'DELETE']) assert.ok(methods.includes(m), m);
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
});

test('admin: sem token → 401; cliente comum (owner de workspace) → 403', async () => {
  const { call, calls } = setup();
  assert.equal((await call('GET', null)).status, 401);
  assert.equal((await call('GET', 'Bearer lixo')).status, 401);
  assert.equal((await call('GET', 'Bearer client')).status, 403);
  assert.equal((await call('DELETE', 'Bearer client', { body: { user_id: OWNER } })).status, 403);
  assert.deepEqual(calls, []);
});

test('admin: check=owner e listagem com status/cobrança', async () => {
  const { call } = setup();
  const check = await call('GET', 'Bearer owner', { query: '?check=owner' });
  assert.deepEqual(await check.json(), { is_owner: true });
  const list = await (await call('GET', 'Bearer owner')).json();
  assert.equal(list.users.length, 3);
  const dona = list.users.find((u: { id: string }) => u.id === OWNER);
  assert.equal(dona.is_platform_owner, true);
  assert.equal(dona.display_name, 'Dona');
  assert.equal(list.users.find((u: { id: string }) => u.id === CLIENT).billing_started_at, '2026-02-03');
});

test('admin: cria por convite e grava data de cobrança', async () => {
  const { call, calls } = setup();
  const res = await call('POST', 'Bearer owner', {
    body: { email: ' Novo@X.com ', display_name: 'Novo', billing_started_at: '2026-11-01' },
  });
  assert.equal(res.status, 201);
  assert.deepEqual(calls, ['invite:novo@x.com', 'settings:44444444-4444-4444-8444-444444444444:{"billing_started_at":"2026-11-01"}']);
});

test('admin: valida e-mail, nome e data', async () => {
  const { call, calls } = setup();
  assert.equal((await call('POST', 'Bearer owner', { body: { email: 'x', display_name: 'A' } })).status, 400);
  assert.equal((await call('POST', 'Bearer owner', { body: { email: 'a@b.co', display_name: '' } })).status, 400);
  assert.equal((await call('POST', 'Bearer owner', { body: { email: 'a@b.co', display_name: 'A', billing_started_at: '2026-02-31' } })).status, 400);
  assert.equal((await call('PATCH', 'Bearer owner', { body: { user_id: CLIENT, billing_started_at: 'ontem' } })).status, 400);
  assert.deepEqual(calls, []);
});

test('admin: desativar bane no Auth e marca is_active=false; ativar remove o ban', async () => {
  const { call, calls } = setup();
  assert.equal((await call('PATCH', 'Bearer owner', { body: { user_id: CLIENT, is_active: false } })).status, 200);
  assert.ok(calls.includes(`updateUser:${CLIENT}:{"ban_duration":"876000h"}`));
  assert.ok(calls.includes(`settings:${CLIENT}:{"is_active":false}`));
  calls.length = 0;
  await call('PATCH', 'Bearer owner', { body: { user_id: CLIENT, is_active: true } });
  assert.ok(calls.includes(`updateUser:${CLIENT}:{"ban_duration":"none"}`));
});

test('admin: não desativa a si mesmo nem o último owner ativo', async () => {
  const { call, owners } = setup();
  assert.equal((await call('PATCH', 'Bearer owner', { body: { user_id: OWNER, is_active: false } })).status, 409);
  // outro owner tenta desativar o único owner restante (ator ≠ alvo): precisa existir outro ativo
  owners.add(OTHER_OWNER);
  const ok = await call('PATCH', 'Bearer owner', { body: { user_id: OTHER_OWNER, is_active: false } });
  assert.equal(ok.status, 200);
});

test('admin: edição altera e-mail (confirmado) e nome sem perder metadata', async () => {
  const { call, calls } = setup();
  await call('PATCH', 'Bearer owner', { body: { user_id: OWNER, display_name: 'Nova', email: 'N@x.com' } });
  const patch = JSON.parse(calls[0].replace(`updateUser:${OWNER}:`, ''));
  assert.equal(patch.email, 'n@x.com');
  assert.equal(patch.email_confirm, true);
  assert.equal(patch.user_metadata.display_name, 'Nova');
});

test('admin: exclusão remove usuário, limpa o Storage e bloqueia auto-exclusão', async () => {
  const { call, calls } = setup();
  assert.equal((await call('DELETE', 'Bearer owner', { body: { user_id: OWNER } })).status, 409);
  assert.equal((await call('DELETE', 'Bearer owner', { body: { user_id: '33333333-3333-4333-8333-33333333333' } })).status, 400);
  const res = await call('DELETE', 'Bearer owner', { body: { user_id: CLIENT } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).deleted_workspaces, 1);
  assert.deepEqual(calls, [`delete:${CLIENT}`, 'purge:aaaaaaaa-0000-4000-8000-000000000001']);
});

test('admin: falha na limpeza do Storage não desfaz a exclusão; erro 23514 vira 409', async () => {
  const a = setup({ purgeWorkspaceMedia: async () => { throw new Error('storage down'); } });
  assert.equal((await a.call('DELETE', 'Bearer owner', { body: { user_id: CLIENT } })).status, 200);
  const b = setup({ deleteUser: async () => { throw Object.assign(new Error('x'), { code: '23514' }); } });
  assert.equal((await b.call('DELETE', 'Bearer owner', { body: { user_id: CLIENT } })).status, 409);
});

test('admin: flags da plataforma — só owner, só chaves conhecidas, só booleanos', async () => {
  const { call, calls } = setup();
  assert.equal((await call('PATCH', 'Bearer client', { body: { flags: { tiktok_audited: true } } })).status, 403);
  assert.equal((await call('PATCH', 'Bearer owner', { body: { flags: { outra: true } } })).status, 400);
  assert.equal((await call('PATCH', 'Bearer owner', { body: { flags: { tiktok_audited: 'sim' } } })).status, 400);
  assert.equal((await call('PATCH', 'Bearer owner', { body: { flags: {} } })).status, 400);
  assert.deepEqual(calls, []);
  assert.equal((await call('PATCH', 'Bearer owner', { body: { flags: { tiktok_audited: true } } })).status, 200);
  assert.deepEqual(calls, ['flags:{"tiktok_audited":true}']);
  const got = await (await call('GET', 'Bearer owner', { query: '?flags' })).json();
  assert.deepEqual(got, { flags: { tiktok_audited: false } });
});
