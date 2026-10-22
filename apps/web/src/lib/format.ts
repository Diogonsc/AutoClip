import type { ChannelStatus, MediaStatus, PublicationStatus, Role } from './types';

export const publicationStatusLabel: Record<PublicationStatus, string> = {
  DRAFT: 'Rascunho',
  SCHEDULED: 'Agendada',
  READY: 'Pronta',
  PROCESSING: 'Processando',
  PUBLISHED: 'Publicada',
  SENT_TO_INBOX: 'Enviada ao rascunho do TikTok',
  FAILED: 'Falhou',
  RETRY_WAIT: 'Aguardando nova tentativa',
  BLOCKED_APPROVAL: 'Bloqueada (aprovação)',
  BLOCKED_PERMISSION: 'Bloqueada (permissão)',
  BLOCKED_REAUTH: 'Bloqueada (reconectar)',
  UNKNOWN: 'Resultado desconhecido',
  CANCELLED: 'Cancelada',
};

export const channelStatusLabel: Record<ChannelStatus, string> = {
  PENDING_AUTH: 'Aguardando autorização',
  CONNECTED: 'Conectado',
  REAUTH_REQUIRED: 'Reconexão necessária',
  PERMISSION_BLOCKED: 'Permissão bloqueada',
  REVOKED: 'Revogado',
  ERROR: 'Erro',
};

export const mediaStatusLabel: Record<MediaStatus, string> = {
  UPLOADING: 'Enviando',
  READY: 'Pronto',
  FAILED: 'Falhou',
  DELETED: 'Excluído',
};

export const roleLabel: Record<Role, string> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  EDITOR: 'Editor',
  VIEWER: 'Leitor',
};

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export function publicationTone(s: PublicationStatus): Tone {
  switch (s) {
    case 'PUBLISHED':
    case 'SENT_TO_INBOX':
      return 'success';
    case 'FAILED':
      return 'danger';
    case 'SCHEDULED':
    case 'READY':
    case 'PROCESSING':
      return 'info';
    case 'RETRY_WAIT':
    case 'BLOCKED_APPROVAL':
    case 'BLOCKED_PERMISSION':
    case 'BLOCKED_REAUTH':
    case 'UNKNOWN':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function channelTone(s: ChannelStatus): Tone {
  switch (s) {
    case 'CONNECTED':
      return 'success';
    case 'PENDING_AUTH':
      return 'info';
    case 'ERROR':
    case 'REVOKED':
      return 'danger';
    default:
      return 'warning';
  }
}

export function mediaTone(s: MediaStatus): Tone {
  switch (s) {
    case 'READY':
      return 'success';
    case 'FAILED':
      return 'danger';
    case 'UPLOADING':
      return 'warning';
    default:
      return 'neutral';
  }
}

export const BLOCKED_STATUSES: PublicationStatus[] = [
  'BLOCKED_APPROVAL',
  'BLOCKED_PERMISSION',
  'BLOCKED_REAUTH',
];

export const EDITABLE_STATUSES: PublicationStatus[] = [
  'DRAFT',
  'SCHEDULED',
  'READY',
  'RETRY_WAIT',
  ...BLOCKED_STATUSES,
];

export const PROBLEM_CHANNEL_STATUSES: ChannelStatus[] = [
  'REAUTH_REQUIRED',
  'PERMISSION_BLOCKED',
  'REVOKED',
  'ERROR',
];

export function formatDateTime(iso: string | null | undefined, tz?: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: tz,
  }).format(new Date(iso));
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(sec: number | null): string {
  if (sec == null) return '—';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
