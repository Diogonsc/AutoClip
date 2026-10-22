export type Role = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';

export type ChannelStatus =
  | 'PENDING_AUTH'
  | 'CONNECTED'
  | 'REAUTH_REQUIRED'
  | 'PERMISSION_BLOCKED'
  | 'REVOKED'
  | 'ERROR';

export type PublicationStatus =
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

export type MediaStatus = 'UPLOADING' | 'READY' | 'FAILED' | 'DELETED';

export interface Workspace {
  id: string;
  name: string;
  owner_user_id: string;
}

export interface WorkspaceWithRole extends Workspace {
  role: Role;
}

export type PublishMode = 'INBOX' | 'DIRECT';

export interface CreatorInfo {
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number | null;
}

export interface WorkspaceSettings {
  workspace_id: string;
  publish_mode: PublishMode;
  auto_publish_enabled: boolean;
  default_timezone: string;
}

export interface Member {
  workspace_id: string;
  user_id: string;
  role: Role;
  created_at: string;
}

export interface Profile {
  id: string;
  display_name: string;
}

export interface Channel {
  id: string;
  workspace_id: string;
  provider: string;
  provider_user_id: string | null;
  display_name: string;
  connection_status: ChannelStatus;
  authorized_at: string | null;
  last_validated_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  granted_scopes: string[];
  creator_info: CreatorInfo | null;
  creator_info_at: string | null;
  created_at: string;
}

export interface MediaAsset {
  id: string;
  workspace_id: string;
  original_filename: string;
  storage_key: string;
  mime_type: string;
  file_size_bytes: number;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  tags: string[];
  category: string | null;
  status: MediaStatus;
  created_at: string;
}

export interface PublicationJob {
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
  timezone: string;
  status: PublicationStatus;
  remote_publish_id: string | null;
  attempt_count: number;
  max_attempts: number;
  last_error_code: string | null;
  last_error_message: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicationEvent {
  id: string;
  workspace_id: string;
  publication_job_id: string;
  event_type: string;
  event_payload: Record<string, unknown>;
  created_at: string;
}

export interface PublicationAttempt {
  id: string;
  publication_job_id: string;
  attempt_number: number;
  started_at: string;
  finished_at: string | null;
  result: string | null;
  error_code: string | null;
  error_message: string | null;
  remote_status: string | null;
}

export interface AppNotification {
  id: string;
  workspace_id: string;
  type: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  workspace_id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
