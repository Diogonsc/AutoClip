// Regras de decisão puras (sem I/O): fáceis de testar.
import type { PostInfo } from './tiktok.ts';
import type { CreatorInfo, Job, JobStatus, Media, PublishMode } from './types.ts';

export const REQUIRED_SCOPE: Record<PublishMode, string> = {
  INBOX: 'video.upload',
  DIRECT: 'video.publish',
};

export const ALLOWED_MIME = ['video/mp4', 'video/quicktime', 'video/webm'];

/** Tempo máximo aguardando o TikTok concluir o processamento antes de declarar UNKNOWN. */
export const MAX_REMOTE_WAIT_MS = 2 * 60 * 60 * 1000;

const BACKOFF_MINUTES = [2, 10, 30];

export function backoffMinutes(attempt: number): number {
  return BACKOFF_MINUTES[Math.min(Math.max(attempt, 1), BACKOFF_MINUTES.length) - 1];
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

export function addSeconds(d: Date, seconds: number): Date {
  return new Date(d.getTime() + seconds * 1000);
}

/** Estado do canal -> estado do job quando o canal não permite publicar. */
export function blockedStatusForChannel(status: string): JobStatus | null {
  switch (status) {
    case 'CONNECTED':
      return null;
    case 'PERMISSION_BLOCKED':
    case 'ERROR':
      return 'BLOCKED_PERMISSION';
    default: // PENDING_AUTH, REAUTH_REQUIRED, REVOKED
      return 'BLOCKED_REAUTH';
  }
}

export interface FailMapping {
  status: 'FAILED' | 'BLOCKED_REAUTH' | 'BLOCKED_PERMISSION';
  retryable: boolean;
  channelStatus?: 'REVOKED';
}

/** fail_reason do endpoint de status -> decisão. */
export function mapFailReason(reason: string | null): FailMapping {
  switch (reason) {
    case 'internal':
    case 'video_pull_failed':
    case 'photo_pull_failed':
      return { status: 'FAILED', retryable: true };
    case 'auth_removed':
      return { status: 'BLOCKED_REAUTH', retryable: false, channelStatus: 'REVOKED' };
    case 'spam_risk_user_banned_from_posting':
      return { status: 'BLOCKED_PERMISSION', retryable: false };
    default:
      // file_format_check_failed, duration_check_failed, frame_rate_check_failed,
      // picture_size_check_failed, publish_cancelled, spam_risk*, desconhecido
      return { status: 'FAILED', retryable: false };
  }
}

export type DirectValidation =
  | { ok: true; postInfo: PostInfo }
  | { ok: false; status: JobStatus; code: string; message: string };

/** Valida um Direct Post contra as opções ATUAIS do criador. Nunca assume valores padrão. */
export function validateDirect(job: Job, media: Media, info: CreatorInfo): DirectValidation {
  if (job.caption.length > 2200) {
    return { ok: false, status: 'FAILED', code: 'CAPTION_TOO_LONG', message: 'Legenda acima de 2200 caracteres.' };
  }
  if (!job.privacy_level) {
    return {
      ok: false,
      status: 'BLOCKED_PERMISSION',
      code: 'MISSING_POST_OPTIONS',
      message: 'Escolha a privacidade da publicação.',
    };
  }
  if (!info.privacy_level_options.includes(job.privacy_level)) {
    return {
      ok: false,
      status: 'BLOCKED_PERMISSION',
      code: 'PRIVACY_MISMATCH',
      message: `Privacidade "${job.privacy_level}" não está entre as opções atuais do criador.`,
    };
  }
  if (job.allow_comment === null || job.allow_duet === null || job.allow_stitch === null) {
    return {
      ok: false,
      status: 'BLOCKED_PERMISSION',
      code: 'MISSING_POST_OPTIONS',
      message: 'Defina as opções de comentário, dueto e stitch.',
    };
  }
  const max = info.max_video_post_duration_sec;
  if (max !== null && media.duration_seconds !== null && media.duration_seconds > max) {
    return {
      ok: false,
      status: 'FAILED',
      code: 'DURATION_EXCEEDED',
      message: `Vídeo com ${Math.round(media.duration_seconds)}s excede o máximo de ${max}s do criador.`,
    };
  }
  return {
    ok: true,
    postInfo: {
      title: job.caption,
      privacy_level: job.privacy_level,
      // Configurações já desativadas pelo criador prevalecem sobre a escolha do job.
      disable_comment: !job.allow_comment || info.comment_disabled,
      disable_duet: !job.allow_duet || info.duet_disabled,
      disable_stitch: !job.allow_stitch || info.stitch_disabled,
      brand_content_toggle: job.brand_content,
      brand_organic_toggle: job.brand_organic,
    },
  };
}

const FAIL_MESSAGES: Record<string, string> = {
  file_format_check_failed: 'O TikTok rejeitou o formato do arquivo. Ação: converta para MP4 (H.264/AAC) e tente novamente.',
  duration_check_failed: 'O TikTok rejeitou a duração do vídeo. Ação: encurte o vídeo para o limite informado pelo canal e reagende.',
  frame_rate_check_failed: 'O TikTok rejeitou a taxa de quadros. Ação: exporte novamente em uma taxa de quadros compatível e tente de novo.',
  picture_size_check_failed: 'O TikTok rejeitou a resolução do vídeo. Ação: exporte em resolução compatível e valide a prévia antes de reagendar.',
  internal: 'Erro interno do TikTok ao processar o vídeo.',
  video_pull_failed: 'O TikTok não conseguiu obter o vídeo.',
  publish_cancelled: 'A publicação foi cancelada no TikTok.',
  auth_removed: 'O acesso do app foi removido no TikTok. Ação: reconecte o canal e conceda novamente as permissões solicitadas.',
  spam_risk_too_many_posts: 'Limite diário de publicações do TikTok atingido. Ação: aguarde até o próximo dia local ou reagende para outra data.',
  spam_risk_user_banned_from_posting: 'A conta está impedida de publicar no TikTok.',
  spam_risk_text: 'O TikTok recusou a legenda por risco de spam. Ação: reduza repetições, links e chamadas excessivas e revise a legenda.',
  spam_risk: 'O TikTok recusou a publicação por risco de spam. Ação: revise a frequência, o conteúdo e tente novamente mais tarde.',
};

export function failReasonMessage(reason: string | null): string {
  return (reason && FAIL_MESSAGES[reason]) || `O TikTok informou falha no processamento${reason ? ` (${reason})` : ''}. Ação: abra os detalhes do erro, revise mídia e permissões e tente novamente apenas depois de corrigir a causa.`;
}
