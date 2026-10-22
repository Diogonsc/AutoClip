import type { WorkerDeps } from '../_shared/worker.ts';
import { TikTokError } from '../_shared/tiktok.ts';
import type { PublishStatus } from '../_shared/tiktok.ts';
import type { Channel, CreatorInfo, Db, FinishArgs, Job, Media, Settings } from '../_shared/types.ts';

export const MB = 1024 * 1024;

export function mkJob(p: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    workspace_id: 'ws-1',
    channel_id: 'ch-1',
    media_asset_id: 'media-1',
    caption: 'olá',
    privacy_level: null,
    allow_comment: null,
    allow_duet: null,
    allow_stitch: null,
    brand_content: false,
    brand_organic: false,
    scheduled_at: new Date(Date.now() - 60_000).toISOString(),
    status: 'SCHEDULED',
    remote_publish_id: null,
    attempt_count: 0,
    max_attempts: 3,
    ...p,
  };
}

export const CREATOR: CreatorInfo = {
  creator_username: 'user',
  creator_nickname: 'User',
  privacy_level_options: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'],
  comment_disabled: false,
  duet_disabled: false,
  stitch_disabled: false,
  max_video_post_duration_sec: 600,
};

export interface Clock {
  t: number;
  now(): Date;
  advance(ms: number): void;
}

export function mkClock(start = Date.parse('2026-10-21T12:00:00Z')): Clock {
  const c: Clock = {
    t: start,
    now: () => new Date(c.t),
    advance: (ms: number) => {
      c.t += ms;
    },
  };
  return c;
}

/** Banco em memória com a mesma semântica dos RPCs (claim, finish, refund). */
export class FakeDb implements Db {
  job: Job;
  channel: Channel | null;
  media: Media | null;
  settings: Settings | null;
  clock: Clock;
  nextAt: Date | null = null;
  locked = false;
  attemptStart: Date | null;
  events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
  finishes: FinishArgs[] = [];
  channelStatusCalls: Array<{ status: string; code: string | null }> = [];
  savedCreatorInfo: CreatorInfo | null = null;
  recordFails = 0;
  recordCalls = 0;
  notifications: string[] = [];

  constructor(clock: Clock, p: { job?: Partial<Job>; channel?: Partial<Channel> | null; media?: Partial<Media> | null; settings?: Partial<Settings> | null } = {}) {
    this.clock = clock;
    this.job = mkJob(p.job);
    this.attemptStart = new Date(clock.t);
    this.channel =
      p.channel === null
        ? null
        : {
            id: 'ch-1',
            workspace_id: 'ws-1',
            connection_status: 'CONNECTED',
            provider_user_id: 'open_1',
            granted_scopes: ['user.info.basic', 'video.upload', 'video.publish'],
            creator_info: null,
            ...p.channel,
          };
    this.media =
      p.media === null
        ? null
        : {
            id: 'media-1',
            workspace_id: 'ws-1',
            status: 'READY',
            storage_key: 'ws-1/media-1/original.mp4',
            mime_type: 'video/mp4',
            file_size_bytes: 1024,
            duration_seconds: 20,
            ...p.media,
          };
    this.settings =
      p.settings === null ? null : { auto_publish_enabled: true, publish_mode: 'INBOX', ...p.settings };
  }

  getSettings() {
    return Promise.resolve(this.settings);
  }
  getChannel() {
    return Promise.resolve(this.channel);
  }
  getMedia() {
    return Promise.resolve(this.media);
  }
  saveCreatorInfo(_id: string, info: CreatorInfo) {
    this.savedCreatorInfo = info;
    return Promise.resolve();
  }
  setChannelStatus(_id: string, status: never, code: string | null) {
    this.channelStatusCalls.push({ status, code });
    if (this.channel) this.channel.connection_status = status;
    return Promise.resolve();
  }
  getLatestAttemptStart() {
    return Promise.resolve(this.attemptStart);
  }
  addEvent(_id: string, type: string, payload?: Record<string, unknown>) {
    this.events.push({ type, payload });
    return Promise.resolve();
  }
  recordRemoteId(_id: string, remoteId: string) {
    this.recordCalls++;
    if (this.recordFails > 0) {
      this.recordFails--;
      return Promise.reject(new Error('db down'));
    }
    this.job.remote_publish_id = remoteId;
    this.events.push({ type: 'REMOTE_ID_RECORDED', payload: { publish_id: remoteId } });
    return Promise.resolve();
  }

  finishJob(a: FinishArgs) {
    this.finishes.push(a);
    if (a.refundAttempt) this.job.attempt_count = Math.max(this.job.attempt_count - 1, 0);
    this.job.status = a.status;
    if (a.clearRemote) this.job.remote_publish_id = null;
    else if (a.remoteId) this.job.remote_publish_id = a.remoteId;
    this.nextAt = a.nextAttemptAt ?? null;
    this.locked = false;
    if (a.event) this.events.push(a.event);
    if (a.status !== 'PROCESSING' && a.status !== 'RETRY_WAIT') this.notifications.push(a.status);
    return Promise.resolve();
  }

  private due(): boolean {
    return this.nextAt === null || this.nextAt.getTime() <= this.clock.t;
  }

  claimPublishJob() {
    if ((this.job.status === 'SCHEDULED' || this.job.status === 'RETRY_WAIT') && this.due()) {
      this.job.status = 'PROCESSING';
      this.job.attempt_count++;
      this.locked = true;
      this.nextAt = null;
      this.attemptStart = this.clock.now();
      return Promise.resolve({ ...this.job });
    }
    return Promise.resolve(null);
  }

  claimPollingJob() {
    if (this.job.status === 'PROCESSING' && this.job.remote_publish_id && !this.locked && this.due()) {
      this.locked = true;
      return Promise.resolve({ ...this.job });
    }
    return Promise.resolve(null);
  }

  last(): FinishArgs {
    return this.finishes[this.finishes.length - 1];
  }
}

export interface FakeTikTok {
  calls: string[];
  queryCreatorInfo: () => Promise<CreatorInfo>;
  initVideoPost: (token: string, p: { mode: string; postInfo?: unknown; plan: unknown }) => Promise<{ publishId: string; uploadUrl: string }>;
  uploadVideo: () => Promise<void>;
  fetchPublishStatus: (token: string, id: string) => Promise<PublishStatus>;
  lastInit?: { mode: string; postInfo?: unknown; plan: unknown };
}

export function mkTikTok(over: Partial<FakeTikTok> = {}): FakeTikTok {
  const t: FakeTikTok = {
    calls: [],
    queryCreatorInfo: () => {
      t.calls.push('creator_info');
      return Promise.resolve(CREATOR);
    },
    initVideoPost: (_tok, p) => {
      t.calls.push('init');
      t.lastInit = p;
      return Promise.resolve({ publishId: 'pub1', uploadUrl: 'https://upload.example/x' });
    },
    uploadVideo: () => {
      t.calls.push('upload');
      return Promise.resolve();
    },
    fetchPublishStatus: () => {
      t.calls.push('status');
      return Promise.resolve({ status: 'SEND_TO_USER_INBOX', failReason: null, publicPostIds: [] });
    },
    ...over,
  };
  return t;
}

export function mkDeps(
  db: FakeDb,
  tk: FakeTikTok,
  clock: Clock,
  over: Partial<WorkerDeps> & { tokenCalls?: string[]; downloads?: string[] } = {},
): WorkerDeps {
  const tokenCalls = over.tokenCalls ?? [];
  const downloads = over.downloads ?? [];
  return {
    db,
    tiktok: tk as unknown as WorkerDeps['tiktok'],
    storage: {
      download: (key: string) => {
        downloads.push(key);
        tk.calls.push('download');
        return Promise.resolve(new Uint8Array(db.media?.file_size_bytes ?? 0));
      },
    },
    ensureToken: (_c: string, o?: { force?: boolean }) => {
      tokenCalls.push(o?.force ? 'force' : 'normal');
      return Promise.resolve('tok');
    },
    now: () => clock.now(),
    sleep: () => Promise.resolve(),
    log: () => undefined,
    ...over,
  };
}

export function err(kind: ConstructorParameters<typeof TikTokError>[0], code: string, status = 0): TikTokError {
  return new TikTokError(kind, code, `${code} (teste)`, status);
}
