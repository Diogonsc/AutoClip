// Operações de banco exclusivas do endpoint de canal (service_role).
import type { SbClient } from './supabase-db.ts';

export function createChannelDb(sb: SbClient) {
  const must = (res: { error: { message: string } | null }, what: string) => {
    if (res.error) throw new Error(`${what}: ${res.error.message}`);
  };

  return {
    /**
     * Desconexão explícita (feita por ADMIN+): apaga os tokens, zera escopos/opções e libera a
     * conta TikTok (provider_user_id) para que o canal possa ser reconectado a outra conta.
     * O que estava agendado fica BLOQUEADO (BLOCKED_REAUTH): nunca publica sem autorização.
     * Jobs já enviados (PROCESSING com publish_id) não são tocados: o poll os reconcilia.
     */
    async disconnectChannel(channelId: string): Promise<void> {
      must(await sb.from('oauth_connections').delete().eq('channel_id', channelId), 'disconnect.connection');
      must(
        await sb
          .from('channels')
          .update({
            connection_status: 'REVOKED',
            provider_user_id: null,
            granted_scopes: [],
            creator_info: null,
            creator_info_at: null,
            authorized_at: null,
            last_error_code: 'DISCONNECTED',
            last_error_message: 'Canal desconectado do TikTok.',
          })
          .eq('id', channelId),
        'disconnect.channel',
      );
      must(
        await sb
          .from('publication_jobs')
          .update({
            status: 'BLOCKED_REAUTH',
            last_error_code: 'CHANNEL_DISCONNECTED',
            last_error_message: 'Canal desconectado do TikTok: conecte novamente e reagende.',
            next_attempt_at: null,
          })
          .eq('channel_id', channelId)
          .in('status', ['SCHEDULED', 'READY', 'RETRY_WAIT']),
        'disconnect.jobs',
      );
    },
  };
}
