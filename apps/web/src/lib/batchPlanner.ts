import type { BatchStrategy, Channel, MediaAsset, PublicationJob } from "./types";
import { zonedToUtc } from "./time";

export interface BatchPlanInput {
  channelIds: string[];
  mediaIds: string[];
  strategy: Exclude<BatchStrategy, "CSV">;
  startsAt: string;
  timezone: string;
  intervalMinutes: number;
  maxPerChannelPerDay: number;
  allowedWeekdays: number[];
  caption: string;
  musicRightsConfirmed: boolean;
  publishMode?: "INBOX" | "DIRECT";
  tiktokAudited?: boolean;
  postType?: "VIDEO" | "PHOTO";
  carouselAssetIds?: string[];
  initialItems?: Array<Partial<BatchPlanItem> & { channelId: string; mediaIds: string[]; postType: "VIDEO" | "PHOTO"; caption: string }>;
}

export interface BatchPlanItem {
  key: string;
  channelId: string;
  mediaId: string;
  mediaIds: string[];
  postType: "VIDEO" | "PHOTO";
  scheduledAt: string | null;
  timezone: string;
  caption: string;
  privacyLevel: string | null;
  allowComment: boolean | null;
  allowDuet: boolean | null;
  allowStitch: boolean | null;
  brandContent: boolean;
  brandOrganic: boolean;
  musicRightsConfirmed: boolean;
  errors: string[];
  warnings: string[];
  included: boolean;
}

const activeStatuses = new Set(["DRAFT", "SCHEDULED", "READY", "PROCESSING", "RETRY_WAIT", "BLOCKED_APPROVAL", "BLOCKED_PERMISSION", "BLOCKED_REAUTH", "UNKNOWN"]);
const CREATOR_INFO_MAX_AGE_MS = 15 * 60_000;

function unique(ids: string[]) { return [...new Set(ids)]; }
function localDay(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
function localWeekday(iso: string, timezone: string) {
  // Sunday=0, matching Date#getDay and the UI checkboxes.
  const label = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(new Date(iso));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(label);
}

/** Puro e determinístico: a mesma entrada sempre produz as mesmas linhas e horários. */
export function buildBatchPlan(
  input: BatchPlanInput,
  channels: Channel[],
  media: MediaAsset[],
  existingJobs: PublicationJob[] = [],
): BatchPlanItem[] {
  const channelIds = unique(input.channelIds);
  const mediaIds = unique(input.mediaIds);
  const postType = input.postType ?? "VIDEO";
  const carouselAssetIds = unique(input.carouselAssetIds ?? []);
  const planningMedia = postType === "PHOTO" ? (carouselAssetIds.length ? [carouselAssetIds[0]] : []) : mediaIds;
  const pairs: Array<Partial<BatchPlanItem> & { channelId: string; mediaId: string; mediaIds: string[]; postType: "VIDEO" | "PHOTO"; caption: string }> = [];
  if (input.initialItems) {
    input.initialItems.forEach((item) => pairs.push({ ...item, channelId: item.channelId, mediaId: item.mediaIds[0] ?? "", mediaIds: item.mediaIds, postType: item.postType, caption: item.caption }));
  } else if (input.strategy === "ALL_TO_ALL") {
    for (const mediaId of planningMedia) for (const channelId of channelIds) pairs.push({ channelId, mediaId, mediaIds: postType === "PHOTO" ? carouselAssetIds : [mediaId], postType, caption: input.caption });
  } else if (input.strategy === "SEQUENTIAL") {
    planningMedia.forEach((mediaId, index) => { if (channelIds.length) pairs.push({ channelId: channelIds[index % channelIds.length], mediaId, mediaIds: postType === "PHOTO" ? carouselAssetIds : [mediaId], postType, caption: input.caption }); });
  } else {
    const load = new Map(channelIds.map((id) => [id, 0]));
    for (const mediaId of planningMedia) {
      const channelId = [...channelIds].sort((a, b) => (load.get(a)! - load.get(b)!) || a.localeCompare(b))[0];
      if (channelId) { pairs.push({ channelId, mediaId, mediaIds: postType === "PHOTO" ? carouselAssetIds : [mediaId], postType, caption: input.caption }); load.set(channelId, load.get(channelId)! + 1); }
    }
  }
  let cursor = input.startsAt ? zonedToUtc(input.startsAt, input.timezone).getTime() : NaN;
  const interval = Math.max(1, Math.floor(input.intervalMinutes || 1)) * 60_000;
  const daily = new Map<string, number>();
  return pairs.map((pair, index) => {
    const { channelId, mediaId, mediaIds: itemMediaIds, postType: itemType, caption: itemCaption } = pair;
    const errors: string[] = [];
    const warnings: string[] = [];
    const channel = channels.find((value) => value.id === channelId);
    const asset = media.find((value) => value.id === mediaId);
    if (!channel || channel.connection_status !== "CONNECTED") errors.push("Conta desconectada ou indisponível.");
    if (!asset || asset.status !== "READY" || asset.validation_status !== "VALIDATED" || (itemType === "PHOTO" ? !asset.mime_type?.startsWith("image/") : !asset.mime_type?.startsWith("video/"))) errors.push("Mídia indisponível ou não validada pelo servidor para agendamento.");
    if (itemType === "PHOTO" && (itemMediaIds.length < 1 || itemMediaIds.length > 35 || itemMediaIds.some((id) => { const value = media.find((asset) => asset.id === id); return !value || value.status !== "READY" || value.validation_status !== "VALIDATED" || !value.mime_type.startsWith("image/"); }))) errors.push("Carrossel contém imagens indisponíveis ou não validadas; revise o item.");
    const privacyLevel = pair.privacyLevel ?? null;
    const allowComment = pair.allowComment ?? (input.publishMode === "DIRECT" ? false : null);
    const allowDuet = itemType === "VIDEO" ? (pair.allowDuet ?? (input.publishMode === "DIRECT" ? false : null)) : null;
    const allowStitch = itemType === "VIDEO" ? (pair.allowStitch ?? (input.publishMode === "DIRECT" ? false : null)) : null;
    const brandContent = pair.brandContent ?? false;
    const brandOrganic = pair.brandOrganic ?? false;
    const musicRightsConfirmed = pair.musicRightsConfirmed ?? input.musicRightsConfirmed;
    const creatorInfoFresh = Boolean(channel?.creator_info && channel.creator_info_at && Date.now() - new Date(channel.creator_info_at).getTime() <= CREATOR_INFO_MAX_AGE_MS);
    const creatorInfo = creatorInfoFresh ? channel?.creator_info ?? null : null;
    if (itemType === "VIDEO" && !musicRightsConfirmed) errors.push("Confirme os direitos de uso do áudio.");
    if (input.publishMode === "DIRECT") {
      if (!creatorInfo) errors.push("Capacidades do criador não verificadas ou desatualizadas; atualize as opções antes da confirmação.");
      else {
        if (!privacyLevel) errors.push("Escolha uma opção de privacidade disponível para esta conta.");
        else if (!creatorInfo.privacy_level_options.includes(privacyLevel)) errors.push("A privacidade escolhida não está disponível para esta conta.");
        if (input.tiktokAudited !== true && privacyLevel !== "SELF_ONLY") errors.push("O aplicativo TikTok ainda não foi auditado; Direct Post exige privacidade Somente eu.");
        if (allowComment === null || (itemType === "VIDEO" && (allowDuet === null || allowStitch === null))) errors.push("Defina as opções de interação obrigatórias para Direct Post.");
        if ((allowComment && creatorInfo.comment_disabled) || (allowDuet && creatorInfo.duet_disabled) || (allowStitch && creatorInfo.stitch_disabled)) errors.push("Uma interação selecionada está desativada nas capacidades atuais desta conta.");
      }
    }
    if (itemCaption.length > 2200) errors.push("Legenda acima de 2200 caracteres.");
    if (!Number.isFinite(cursor) || cursor <= Date.now()) errors.push("Data inicial inválida ou no passado.");
    const explicitSchedule = input.initialItems ? pair.scheduledAt ?? null : null;
    let scheduledAt: string | null = explicitSchedule ?? (Number.isFinite(cursor) ? new Date(cursor).toISOString() : null);
    if (explicitSchedule) cursor = new Date(explicitSchedule).getTime();
    let attempts = 0;
    while (!explicitSchedule && scheduledAt && attempts++ < 20_000) {
      const day = localDay(scheduledAt, input.timezone);
      const dayKey = `${channelId}:${day}`;
      const weekday = localWeekday(scheduledAt, input.timezone);
      if (input.allowedWeekdays.includes(weekday) && (daily.get(dayKey) ?? 0) < input.maxPerChannelPerDay) {
        daily.set(dayKey, (daily.get(dayKey) ?? 0) + 1);
        break;
      }
      cursor += interval;
      scheduledAt = new Date(cursor).toISOString();
    }
    if (attempts >= 20_000) errors.push("Não foi possível encontrar horário dentro das regras escolhidas.");
    if (scheduledAt && new Date(scheduledAt).getTime() <= Date.now()) errors.push("Data da publicação inválida ou no passado.");
    if (scheduledAt && existingJobs.some((job) => activeStatuses.has(job.status) && job.channel_id === channelId && job.media_asset_id === mediaId && job.scheduled_at === scheduledAt)) errors.push("Já existe agendamento equivalente.");
    if (scheduledAt && existingJobs.some((job) => activeStatuses.has(job.status) && job.channel_id === channelId && job.scheduled_at && Math.abs(new Date(job.scheduled_at).getTime() - new Date(scheduledAt).getTime()) < interval)) warnings.push("Há outra publicação próxima neste canal.");
    cursor += interval;
    return { ...pair, key: pair.key ?? `${channelId}:${mediaId}:${index}`, channelId, mediaId, mediaIds: itemMediaIds, postType: itemType, scheduledAt, timezone: input.timezone, caption: itemCaption, privacyLevel, allowComment, allowDuet, allowStitch, brandContent, brandOrganic, musicRightsConfirmed, errors, warnings, included: pair.included ?? true };
  });
}

export function batchStrategyCount(strategy: Exclude<BatchStrategy, "CSV">, channelCount: number, mediaCount: number) {
  return strategy === "ALL_TO_ALL" ? channelCount * mediaCount : mediaCount;
}
