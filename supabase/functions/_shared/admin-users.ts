import { corsHeaders, isUuid, json } from './http.ts';

type UserInfo = {
  id: string;
  email?: string;
  created_at: string;
  last_sign_in_at?: string;
  user_metadata?: Record<string, unknown>;
};

type AdminUsersDeps = {
  origins: string[];
  authenticate(authorization: string): Promise<{ id: string } | null>;
  isOwner(userId: string): Promise<boolean>;
  listUsers(page: number, perPage: number): Promise<{ users: UserInfo[]; total: number | null }>;
  getUser(userId: string): Promise<UserInfo | null>;
  inviteUser(email: string, displayName: string): Promise<UserInfo>;
  updateUser(userId: string, patch: Record<string, unknown>): Promise<UserInfo>;
  updateSettings(userId: string, patch: { is_active?: boolean; billing_started_at?: string }): Promise<void>;
  getSettings(userIds: string[]): Promise<Array<{ user_id: string; is_active: boolean; billing_started_at: string }>>;
  deleteUser(userId: string): Promise<string[]>;
  purgeWorkspaceMedia(workspaceIds: string[]): Promise<void>;
  listOwners(): Promise<string[]>;
  isPlatformOwner(userId: string): Promise<boolean>;
  setFlags(flags: Record<string, boolean>): Promise<void>;
  getFlags(): Promise<Record<string, unknown>>;
  log?(event: string, data: Record<string, unknown>): void;
};

const METHODS = 'GET, POST, PATCH, DELETE, OPTIONS';

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function handleAdminUsers(req: Request, d: AdminUsersDeps): Promise<Response> {
  const cors = { ...corsHeaders(req.headers.get('origin'), d.origins), 'Access-Control-Allow-Methods': METHODS };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) {
    return json({ error: 'method_not_allowed' }, 405, cors);
  }

  const authorization = req.headers.get('authorization');
  if (!authorization) return json({ error: 'unauthorized' }, 401, cors);
  const actor = await d.authenticate(authorization).catch(() => null);
  if (!actor) return json({ error: 'unauthorized' }, 401, cors);
  if (!(await d.isOwner(actor.id).catch(() => false))) return json({ error: 'forbidden' }, 403, cors);

  const url = new URL(req.url);
  try {
    if (req.method === 'GET') {
      if (url.searchParams.get('check') === 'owner') return json({ is_owner: true }, 200, { ...cors, 'Cache-Control': 'private, no-store' });
      if (url.searchParams.get('flags') !== null) return json({ flags: await d.getFlags() }, 200, { ...cors, 'Cache-Control': 'private, no-store' });
      const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
      const perPage = Math.min(100, Math.max(1, Math.floor(Number(url.searchParams.get('per_page')) || 50)));
      const { users, total } = await d.listUsers(page, perPage);
      const [settings, owners] = await Promise.all([
        d.getSettings(users.map((u) => u.id)),
        d.listOwners(),
      ]);
      const byId = new Map(settings.map((s) => [s.user_id, s]));
      const ownerIds = new Set(owners);
      return json({
        users: users.map((user) => ({
          id: user.id,
          email: user.email ?? '',
          display_name: String(user.user_metadata?.display_name ?? ''),
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at ?? null,
          is_active: byId.get(user.id)?.is_active ?? true,
          billing_started_at: byId.get(user.id)?.billing_started_at ?? user.created_at.slice(0, 10),
          is_platform_owner: ownerIds.has(user.id),
        })),
        page,
        per_page: perPage,
        total,
      }, 200, { ...cors, 'Cache-Control': 'private, no-store' });
    }

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return json({ error: 'invalid_request' }, 400, cors);

    if (req.method === 'POST') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
      if (!validEmail(email) || !displayName || displayName.length > 80) {
        return json({ error: 'invalid_request', message: 'Informe nome e e-mail válidos.' }, 400, cors);
      }
      if (body.billing_started_at !== undefined && !validDate(body.billing_started_at)) {
        return json({ error: 'invalid_request', message: 'Data de início da cobrança inválida.' }, 400, cors);
      }
      if (body.is_active !== undefined && typeof body.is_active !== 'boolean') return json({ error: 'invalid_request' }, 400, cors);
      if (body.is_active === false) return json({ error: 'invalid_request', message: 'Crie a conta ativa e depois use a ação de desativar.' }, 400, cors);
      const created = await d.inviteUser(email, displayName);
      const settings: { is_active?: boolean; billing_started_at?: string } = {};
      if (typeof body.is_active === 'boolean') settings.is_active = body.is_active;
      if (validDate(body.billing_started_at)) settings.billing_started_at = body.billing_started_at;
      if (Object.keys(settings).length) await d.updateSettings(created.id, settings);
      return json({ user: { id: created.id, email: created.email, created_at: created.created_at } }, 201, cors);
    }

    if (req.method === 'PATCH' && body.flags !== undefined) {
      const flags = body.flags as Record<string, unknown> | null;
      const allowed = ['tiktok_audited'];
      if (!flags || typeof flags !== 'object' || Array.isArray(flags)) return json({ error: 'invalid_request' }, 400, cors);
      const clean: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(flags)) {
        if (!allowed.includes(key) || typeof value !== 'boolean') return json({ error: 'invalid_request', message: 'Flag inválida.' }, 400, cors);
        clean[key] = value;
      }
      if (!Object.keys(clean).length) return json({ error: 'invalid_request' }, 400, cors);
      await d.setFlags(clean);
      return json({ ok: true }, 200, cors);
    }

    const userId = body.user_id;
    if (!isUuid(userId)) return json({ error: 'invalid_request' }, 400, cors);
    if (userId === actor.id && req.method === 'DELETE') {
      return json({ error: 'cannot_delete_self', message: 'Não é possível excluir a própria conta de owner.' }, 409, cors);
    }
    const target = await d.getUser(userId);
    if (!target) return json({ error: 'user_not_found' }, 404, cors);

    if (req.method === 'PATCH') {
      const updatesAuth = body.email !== undefined || body.display_name !== undefined || body.is_active !== undefined;
      const updatesSettings = body.is_active !== undefined || body.billing_started_at !== undefined;
      if (!updatesAuth && !updatesSettings) return json({ error: 'invalid_request' }, 400, cors);
      if (body.is_active !== undefined && typeof body.is_active !== 'boolean') return json({ error: 'invalid_request' }, 400, cors);
      if (body.billing_started_at !== undefined && !validDate(body.billing_started_at)) {
        return json({ error: 'invalid_request', message: 'Data de início da cobrança inválida.' }, 400, cors);
      }

      const patch: Record<string, unknown> = {};
      if (body.email !== undefined) {
        if (typeof body.email !== 'string' || !validEmail(body.email.trim())) return json({ error: 'invalid_request', message: 'E-mail inválido.' }, 400, cors);
        patch.email = body.email.trim().toLowerCase();
        patch.email_confirm = true;
      }
      if (body.display_name !== undefined) {
        if (typeof body.display_name !== 'string' || !body.display_name.trim() || body.display_name.trim().length > 80) {
          return json({ error: 'invalid_request', message: 'Nome inválido.' }, 400, cors);
        }
        patch.user_metadata = { ...(target.user_metadata ?? {}), display_name: body.display_name.trim() };
      }

      if (body.is_active === false && userId === actor.id) {
        return json({ error: 'cannot_disable_self', message: 'Não é possível desativar a própria conta.' }, 409, cors);
      }
      if (body.is_active === false && await d.isPlatformOwner(userId)) {
        const owners = await d.listOwners();
        const settings = await d.getSettings(owners);
        const enabledOthers = owners.filter((id) => id !== userId && (settings.find((s) => s.user_id === id)?.is_active ?? true));
        if (!enabledOthers.length) return json({ error: 'last_platform_owner', message: 'Não é possível desativar o último owner da aplicação.' }, 409, cors);
      }

      if (Object.keys(patch).length) await d.updateUser(userId, patch);
      if (body.is_active !== undefined) {
        await d.updateUser(userId, { ban_duration: body.is_active ? 'none' : '876000h' });
      }
      const settingsPatch: { is_active?: boolean; billing_started_at?: string } = {};
      if (typeof body.is_active === 'boolean') settingsPatch.is_active = body.is_active;
      if (validDate(body.billing_started_at)) settingsPatch.billing_started_at = body.billing_started_at;
      if (Object.keys(settingsPatch).length) await d.updateSettings(userId, settingsPatch);
      return json({ ok: true }, 200, cors);
    }

    if (req.method === 'DELETE') {
      const deletedWorkspaces = await d.deleteUser(userId);
      // Limpeza do Storage depois do banco: falha aqui só deixa arquivos órfãos, nunca dados vivos.
      await d.purgeWorkspaceMedia(deletedWorkspaces).catch(() => d.log?.('admin_users.purge_failed', { workspaces: deletedWorkspaces.length }));
      return json({ ok: true, deleted_workspaces: deletedWorkspaces.length }, 200, cors);
    }

    return json({ error: 'method_not_allowed' }, 405, cors);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '23514') return json({ error: 'last_platform_owner', message: 'Não é possível remover o último owner da aplicação.' }, 409, cors);
    if (code === '23505' || code === 'email_exists') return json({ error: 'email_exists', message: 'Já existe um usuário com este e-mail.' }, 409, cors);
    console.error(JSON.stringify({ event: 'admin_users.failed', method: req.method, code }));
    return json({ error: 'internal', message: 'Não foi possível concluir a operação.' }, 500, cors);
  }
}
