export type JobStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'READY'
  | 'PROCESSING'
  | 'PUBLISHED'
  | 'SENT_TO_INBOX'
  | 'FAILED'
  | 'RETRY_WAIT'
  | 'BLOCKED_APPROVAL'
  | 'BLOCKED_PERMISSION'
  | 'BLOCKED_REAUTH'
  | 'UNKNOWN'
  | 'CANCELLED';

export type ChannelStatus =
  | 'PENDING_AUTH'
  | 'CONNECTED'
  | 'REAUTH_REQUIRED'
  | 'PERMISSION_BLOCKED'
  | 'REVOKED'
  | 'ERROR';

export type PublishMode = 'INBOX' | 'DIRECT';

export interface Job {
  id: string;
  workspace_id: string;
  channel_id: string;
  media_asset_id: string;
  caption: string;
  privacy_level: string | null;
  allow_comment: boolean | null;
  allow_duet: boolean | null;
  allow_stitch: boolean | null;
  brand_content: boolean;
  brand_organic: boolean;
  scheduled_at: string | null;
  status: JobStatus;
  remote_publish_id: string | null;
  attempt_count: number;
  max_attempts: number;
}

export interface CreatorInfo {
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number | null;
}

export interface Channel {
  id: string;
  workspace_id: string;
  connection_status: ChannelStatus;
  provider_user_id: string | null;
  granted_scopes: string[];
  creator_info: CreatorInfo | null;
}

export interface Connection {
  channel_id: string;
  workspace_id: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  granted_scopes: string[];
}

export interface Media {
  id: string;
  workspace_id: string;
  status: string;
  storage_key: string;
  mime_type: string;
  file_size_bytes: number;
  duration_seconds: number | null;
}

export interface Settings {
  auto_publish_enabled: boolean;
  publish_mode: PublishMode;
}

export interface FinishArgs {
  jobId: string;
  status: JobStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  /** Define o publish_id (undefined mantém o atual). */
  remoteId?: string | null;
  /** Remove o publish_id (usado após o TikTok confirmar que aquele envio falhou). */
  clearRemote?: boolean;
  nextAttemptAt?: Date | null;
  result: string;
  remoteStatus?: string | null;
  /** Devolve a tentativa (não conta no limite): usado para rate limit e cotas temporárias. */
  refundAttempt?: boolean;
  event?: { type: string; payload?: Record<string, unknown> };
}

/** Acesso a dados usado pelo worker (implementado sobre o Supabase em supabase-db.ts). */
export interface Db {
  getSettings(workspaceId: string): Promise<Settings | null>;
  getChannel(channelId: string): Promise<Channel | null>;
  getMedia(mediaId: string): Promise<Media | null>;
  saveCreatorInfo(channelId: string, info: CreatorInfo): Promise<void>;
  setChannelStatus(
    channelId: string,
    status: ChannelStatus,
    errorCode: string | null,
    errorMessage: string | null,
  ): Promise<void>;
  getLatestAttemptStart(jobId: string): Promise<Date | null>;
  addEvent(jobId: string, type: string, payload?: Record<string, unknown>): Promise<void>;
  recordRemoteId(jobId: string, remoteId: string): Promise<void>;
  finishJob(args: FinishArgs): Promise<void>;
  claimPublishJob(worker: string): Promise<Job | null>;
  claimPollingJob(worker: string): Promise<Job | null>;
}
