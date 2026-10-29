// Gerenciamento de usuários da plataforma: todo acesso administrativo é validado pelo JWT
// do solicitante e pela allowlist de owners mantida exclusivamente via service_role.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleAdminUsers } from '../_shared/admin-users.ts';
import { corsHeaders, json, parseOrigins } from '../_shared/http.ts';
import { env, envOptional } from '../_shared/env.ts';

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): unknown;
};

const url = env('SUPABASE_URL');
const service = env('SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(async (req) => {
  const origins = parseOrigins(envOptional('WEB_URL'));
  const cors = corsHeaders(req.headers.get('origin'), origins);

  try {
    return await handleAdminUsers(req, {
      origins,
      async authenticate(authorization) {
        const token = authorization.replace(/^Bearer\s+/i, '');
        const { data, error } = await admin.auth.getUser(token);
        return error || !data.user ? null : { id: data.user.id };
      },
      async isOwner(userId) {
        const { data, error } = await admin.from('platform_owners').select('user_id').eq('user_id', userId).maybeSingle();
        if (error) throw error;
        return Boolean(data);
      },
      async listUsers(page, perPage) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
        if (error) throw error;
        return { users: data.users, total: data.total };
      },
      async getUser(userId) {
        const { data, error } = await admin.auth.admin.getUserById(userId);
        if (error) {
          if (error.status === 404) return null;
          throw error;
        }
        return data.user;
      },
      async inviteUser(email, displayName) {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { display_name: displayName } });
        if (error) throw error;
        return data.user;
      },
      async updateUser(userId, patch) {
        const { data, error } = await admin.auth.admin.updateUserById(userId, patch);
        if (error) throw error;
        return data.user;
      },
      async updateSettings(userId, patch) {
        const { error } = await admin.from('platform_user_settings').upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' });
        if (error) throw error;
      },
      async getSettings(userIds) {
        if (!userIds.length) return [];
        const { data, error } = await admin.from('platform_user_settings').select('user_id,is_active,billing_started_at').in('user_id', userIds);
        if (error) throw error;
        return data ?? [];
      },
      async deleteUser(userId) {
        const { data, error } = await admin.rpc('delete_platform_user', { p_user_id: userId });
        if (error) throw error;
        return (data ?? []) as string[];
      },
      async purgeWorkspaceMedia(workspaceIds) {
        // Caminho no bucket: <workspace_id>/<media_id>/<arquivo>
        const bucket = admin.storage.from('media');
        for (const workspaceId of workspaceIds) {
          const { data: folders, error } = await bucket.list(workspaceId, { limit: 1000 });
          if (error) throw error;
          const paths: string[] = [];
          for (const folder of folders ?? []) {
            const { data: files, error: listError } = await bucket.list(`${workspaceId}/${folder.name}`, { limit: 1000 });
            if (listError) throw listError;
            for (const file of files ?? []) paths.push(`${workspaceId}/${folder.name}/${file.name}`);
          }
          for (let i = 0; i < paths.length; i += 100) {
            const { error: removeError } = await bucket.remove(paths.slice(i, i + 100));
            if (removeError) throw removeError;
          }
        }
      },
      log(event, data) {
        console.error(JSON.stringify({ event, ...data }));
      },
      async listOwners() {
        const { data, error } = await admin.from('platform_owners').select('user_id');
        if (error) throw error;
        return (data ?? []).map((row) => row.user_id);
      },
      async setFlags(flags) {
        const rows = Object.entries(flags).map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
        const { error } = await admin.from('platform_flags').upsert(rows, { onConflict: 'key' });
        if (error) throw error;
      },
      async getFlags() {
        const { data, error } = await admin.from('platform_flags').select('key,value');
        if (error) throw error;
        return Object.fromEntries((data ?? []).map((row) => [row.key, row.value]));
      },
      async isPlatformOwner(userId) {
        const { data, error } = await admin.from('platform_owners').select('user_id').eq('user_id', userId).maybeSingle();
        if (error) throw error;
        return Boolean(data);
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'admin_users.fatal', message: error instanceof Error ? error.message : String(error) }));
    return json({ error: 'internal', message: 'Não foi possível concluir a operação.' }, 500, cors);
  }
});
