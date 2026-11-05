// Implementação do acesso a dados (Db do worker + TokenStore) sobre o Supabase.
// Recebe o cliente por parâmetro (service_role) em vez de importá-lo: este arquivo não tem
// dependência de Deno e os nomes/parâmetros das RPCs podem ser testados no Node.
//
// Cada RPC aqui corresponde a uma função de 20261021000002_tiktok_integration.sql.
import type { TokenStore } from './tokens.ts';
import type { ChannelStatus, Channel, Connection, CreatorInfo, Db, FinishArgs, Job, Media, Settings } from './types.ts';

interface SbResult<T = unknown> {
  data: T | null;
  error: { message: string } | null;
}

/** Subconjunto do supabase-js usado aqui (evita acoplar o arquivo à lib). */
export interface SbClient {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<SbResult>;
}

/** Erros do banco entram no log: nunca incluir tokens/segredos em `what`. */
function ok<T>(res: SbResult<T>, what: string): T | null {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export function createDb(sb: SbClient): Db {
  const rpc = async (fn: string, args: Record<string, unknown>) => ok(await sb.rpc(fn, args), fn);

  const claimOne = async (fn: string, worker: string): Promise<Job | null> => {
    const rows = (await rpc(fn, { p_limit: 1, p_worker: worker })) as Job[] | null;
    return rows && rows.length > 0 ? rows[0] : null;
  };

  return {
    async getSettings(workspaceId): Promise<Settings | null> {
      return ok(
        await sb.from('workspace_settings').select('auto_publish_enabled, publish_mode').eq('workspace_id', workspaceId).maybeSingle(),
        'getSettings',
      );
    },

    async getChannel(channelId): Promise<Channel | null> {
      return ok(
        await sb
          .from('channels')
          .select('id, workspace_id, connection_status, provider_user_id, granted_scopes, creator_info')
          .eq('id', channelId)
          .maybeSingle(),
        'getChannel',
      );
    },

    async getMedia(mediaId): Promise<Media | null> {
      return ok(
        await sb
          .from('media_assets')
          .select('id, workspace_id, status, storage_key, mime_type, file_size_bytes, duration_seconds, validation_status, checksum_sha256, detected_mime_type, detected_video_codec')
          .eq('id', mediaId)
          .maybeSingle(),
        'getMedia',
      );
    },

    async getMediaAssets(mediaIds): Promise<Media[]> {
      if (!mediaIds.length) return [];
      return (ok(
        await sb.from('media_assets')
          .select('id, workspace_id, status, storage_key, mime_type, file_size_bytes, duration_seconds, width, height, validation_status, checksum_sha256, detected_mime_type, detected_video_codec')
          .in('id', mediaIds),
        'getMediaAssets',
      ) ?? []) as Media[];
    },

    async saveCreatorInfo(channelId, info: CreatorInfo) {
      ok(
        await sb.from('channels').update({ creator_info: info, creator_info_at: new Date().toISOString() }).eq('id', channelId),
        'saveCreatorInfo',
      );
    },

    async setChannelStatus(channelId, status: ChannelStatus, errorCode, errorMessage) {
      ok(
        await sb
          .from('channels')
          .update({
            connection_status: status,
            last_error_code: errorCode,
            last_error_message: errorMessage ? errorMessage.slice(0, 500) : null,
          })
          .eq('id', channelId),
        'setChannelStatus',
      );
    },

    async getLatestAttemptStart(jobId) {
      const row = ok(
        await sb
          .from('publication_attempts')
          .select('started_at')
          .eq('publication_job_id', jobId)
          .order('attempt_number', { ascending: false })
          .limit(1)
          .maybeSingle(),
        'getLatestAttemptStart',
      ) as { started_at: string } | null;
      return row ? new Date(row.started_at) : null;
    },

    async addEvent(jobId, type, payload) {
      await rpc('add_job_event', { p_job: jobId, p_type: type, p_payload: payload ?? {} });
    },

    async recordRemoteId(jobId, remoteId) {
      await rpc('record_remote_id', { p_job: jobId, p_remote_id: remoteId });
    },

    async finishJob(a: FinishArgs) {
      await rpc('finish_job', {
        p_job: a.jobId,
        p_status: a.status,
        p_error_code: a.errorCode ?? null,
        p_error_message: a.errorMessage ?? null,
        p_remote_id: a.remoteId ?? null,
        p_clear_remote: a.clearRemote ?? false,
        p_next_attempt_at: a.nextAttemptAt ? a.nextAttemptAt.toISOString() : null,
        p_result: a.result,
        p_remote_status: a.remoteStatus ?? null,
        p_refund: a.refundAttempt ?? false,
        p_event_type: a.event?.type ?? null,
        p_event_payload: a.event?.payload ?? {},
      });
    },

    claimPublishJob: (worker) => claimOne('claim_publication_jobs', worker),
    claimPollingJob: (worker) => claimOne('claim_polling_jobs', worker),
  };
}

export function createTokenStore(sb: SbClient): TokenStore {
  return {
    async getConnection(channelId) {
      return ok(
        await sb
          .from('oauth_connections')
          .select(
            'channel_id, workspace_id, encrypted_access_token, encrypted_refresh_token, access_token_expires_at, refresh_token_expires_at, granted_scopes, refresh_state, token_version',
          )
          .eq('channel_id', channelId)
          .maybeSingle(),
        'getConnection',
      );
    },

    async acquireRefresh(a) {
      const result = ok(await sb.rpc('acquire_tiktok_token_refresh', {
        p_channel: a.channelId, p_workspace: a.workspaceId, p_attempt: a.attemptId,
      }), 'acquireRefresh') as {
        state?: string; token_version?: number; connection?: Connection;
      } | null;
      const state = result?.state;
      if (state !== 'ACQUIRED' && state !== 'BUSY' && state !== 'REAUTH_REQUIRED' && state !== 'NOT_FOUND') {
        throw new Error('acquireRefresh: resposta inválida');
      }
      return {
        state,
        ...(result?.connection ? { connection: result.connection } : {}),
        ...(typeof result?.token_version === 'number' ? { token_version: result.token_version } : {}),
      };
    },

    async completeRefresh(a) {
      return ok(await sb.rpc('complete_tiktok_token_refresh', {
        p_channel: a.channelId, p_workspace: a.workspaceId, p_attempt: a.attemptId,
        p_token_version: a.tokenVersion, p_enc_access: a.encAccess, p_enc_refresh: a.encRefresh,
        p_access_exp: a.accessExp.toISOString(), p_refresh_exp: a.refreshExp.toISOString(), p_scopes: a.scopes,
      }), 'completeRefresh') === true;
    },

    async failRefresh(a) {
      return ok(await sb.rpc('fail_tiktok_token_refresh', {
        p_channel: a.channelId, p_workspace: a.workspaceId, p_attempt: a.attemptId,
        p_token_version: a.tokenVersion, p_error_code: a.code,
      }), 'failRefresh') === true;
    },


  };
}
