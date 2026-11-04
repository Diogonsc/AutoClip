import { describe, expect, it } from "vitest";
import { batchStrategyCount, buildBatchPlan } from "./batchPlanner";
import type { Channel, MediaAsset } from "./types";

const channels = [
  { id: "c1", connection_status: "CONNECTED", display_name: "A" },
  { id: "c2", connection_status: "CONNECTED", display_name: "B" },
] as Channel[];
const media = [
  { id: "m1", status: "READY", validation_status: "VALIDATED", mime_type: "video/mp4", original_filename: "1.mp4" },
  { id: "m2", status: "READY", validation_status: "VALIDATED", mime_type: "video/mp4", original_filename: "2.mp4" },
  { id: "m3", status: "READY", validation_status: "VALIDATED", mime_type: "video/mp4", original_filename: "3.mp4" },
] as MediaAsset[];
const base = { startsAt: "2099-01-02T10:00", timezone: "UTC", intervalMinutes: 10, maxPerChannelPerDay: 15, allowedWeekdays: [0,1,2,3,4,5,6], caption: "ok", musicRightsConfirmed: true };

describe("batch planner", () => {
  it("calcula todos para todas de forma determinística", () => {
    const plan = buildBatchPlan({ ...base, channelIds: ["c1", "c2", "c1"], mediaIds: ["m1", "m2"], strategy: "ALL_TO_ALL" }, channels, media);
    expect(plan).toHaveLength(4);
    expect(plan.map((item) => `${item.channelId}:${item.mediaId}`)).toEqual(["c1:m1", "c2:m1", "c1:m2", "c2:m2"]);
    expect(batchStrategyCount("ALL_TO_ALL", 2, 2)).toBe(4);
  });
  it("distribui sequencialmente e equilibradamente sem duplicar contas", () => {
    const sequential = buildBatchPlan({ ...base, channelIds: ["c1", "c2"], mediaIds: ["m1", "m2", "m3"], strategy: "SEQUENTIAL" }, channels, media);
    const balanced = buildBatchPlan({ ...base, channelIds: ["c1", "c2"], mediaIds: ["m1", "m2", "m3"], strategy: "BALANCED" }, channels, media);
    expect(sequential.map((item) => item.channelId)).toEqual(["c1", "c2", "c1"]);
    expect(balanced.map((item) => item.channelId)).toEqual(["c1", "c2", "c1"]);
  });
  it("bloqueia conta desconectada, mídia indisponível e direitos não confirmados", () => {
    const plan = buildBatchPlan({ ...base, channelIds: ["c1", "x"], mediaIds: ["m1", "x"], strategy: "ALL_TO_ALL", musicRightsConfirmed: false }, channels, media);
    expect(plan.some((item) => item.errors.some((error) => error.includes("direitos")))).toBe(true);
    expect(plan.some((item) => item.errors.some((error) => error.includes("Conta")))).toBe(true);
    expect(plan.some((item) => item.errors.some((error) => error.includes("Mídia")))).toBe(true);
  });
  it("preserva a ordem de imagens para um carrossel", () => {
    const images = [
      { id: "p1", status: "READY", validation_status: "VALIDATED", mime_type: "image/jpeg" },
      { id: "p2", status: "READY", validation_status: "VALIDATED", mime_type: "image/jpeg" },
    ] as MediaAsset[];
    const plan = buildBatchPlan({ ...base, channelIds: ["c1"], mediaIds: ["p1", "p2"], carouselAssetIds: ["p2", "p1"], postType: "PHOTO", strategy: "ALL_TO_ALL", musicRightsConfirmed: false }, channels, images);
    expect(plan).toHaveLength(1);
    expect(plan[0].postType).toBe("PHOTO");
    expect(plan[0].mediaIds).toEqual(["p2", "p1"]);
    expect(plan[0].errors).not.toContain("Confirme os direitos de uso do áudio.");
  });
  it("constrói rascunho repetido na ordem original sem datas antigas", () => {
    const initialItems = [
      { channelId: "c2", mediaIds: ["m2"], postType: "VIDEO" as const, caption: "segunda" },
      { channelId: "c1", mediaIds: ["m1"], postType: "VIDEO" as const, caption: "primeira" },
    ];
    const plan = buildBatchPlan({ ...base, startsAt: "", channelIds: ["c1", "c2"], mediaIds: ["m1", "m2"], strategy: "SEQUENTIAL", initialItems }, channels, media);
    expect(plan.map((item) => [item.channelId, item.mediaId, item.caption])).toEqual([
      ["c2", "m2", "segunda"], ["c1", "m1", "primeira"],
    ]);
    expect(plan.every((item) => item.scheduledAt === null)).toBe(true);
    expect(plan.every((item) => item.errors.some((error) => error.includes("Data inicial")))).toBe(true);
  });
  it("bloqueia conta desconectada e mídia removida no rascunho repetido", () => {
    const unavailableChannel = { ...channels[0], connection_status: "REVOKED" } as Channel;
    const deletedMedia = { ...media[0], status: "DELETED" } as MediaAsset;
    const plan = buildBatchPlan({ ...base, channelIds: ["c1"], mediaIds: ["m1"], strategy: "SEQUENTIAL", initialItems: [{ channelId: "c1", mediaIds: ["m1"], postType: "VIDEO", caption: "repetir" }] }, [unavailableChannel], [deletedMedia]);
    expect(plan[0].errors.some((error) => error.includes("Conta desconectada"))).toBe(true);
    expect(plan[0].errors.some((error) => error.includes("Mídia indisponível"))).toBe(true);
    expect(plan[0].scheduledAt).not.toBeNull();
  });
  it("preserva configurações avançadas individuais ao reconstruir o rascunho", () => {
    const capable = { ...channels[0], creator_info_at: new Date().toISOString(), creator_info: { privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"], comment_disabled: false, duet_disabled: false, stitch_disabled: false, max_video_post_duration_sec: 600 } } as Channel;
    const initialItems = [{ channelId: "c1", mediaIds: ["m1"], postType: "VIDEO" as const, caption: "original", privacyLevel: "SELF_ONLY", allowComment: false, allowDuet: true, allowStitch: false, brandContent: true, brandOrganic: false, musicRightsConfirmed: true }];
    const plan = buildBatchPlan({ ...base, channelIds: ["c1"], mediaIds: ["m1"], strategy: "SEQUENTIAL", initialItems, publishMode: "DIRECT" }, [capable], [{ ...media[0], mime_type: "video/mp4" } as MediaAsset]);
    expect(plan[0]).toMatchObject({ privacyLevel: "SELF_ONLY", allowComment: false, allowDuet: true, allowStitch: false, brandContent: true, brandOrganic: false, musicRightsConfirmed: true });
    expect(plan[0].errors).toEqual([]);
  });
  it("bloqueia opções não verificadas ou incompatíveis com as capacidades atuais", () => {
    const unverified = buildBatchPlan({ ...base, channelIds: ["c1"], mediaIds: ["m1"], strategy: "SEQUENTIAL", publishMode: "DIRECT" }, channels, media);
    expect(unverified[0].errors).toContain("Capacidades do criador não verificadas ou desatualizadas; atualize as opções antes da confirmação.");
    const restricted = { ...channels[0], creator_info_at: new Date().toISOString(), creator_info: { privacy_level_options: ["SELF_ONLY"], comment_disabled: true, duet_disabled: true, stitch_disabled: false, max_video_post_duration_sec: null } } as Channel;
    const plan = buildBatchPlan({ ...base, channelIds: ["c1"], mediaIds: ["m1"], strategy: "SEQUENTIAL", publishMode: "DIRECT", initialItems: [{ channelId: "c1", mediaIds: ["m1"], postType: "VIDEO", caption: "x", privacyLevel: "PUBLIC_TO_EVERYONE", allowComment: true, allowDuet: true, allowStitch: true }] }, [restricted], media);
    expect(plan[0].errors).toContain("A privacidade escolhida não está disponível para esta conta.");
    expect(plan[0].errors).toContain("Uma interação selecionada está desativada nas capacidades atuais desta conta.");
  });
  it("limita Direct Post a SELF_ONLY enquanto o aplicativo TikTok não está auditado", () => {
    const capable = { ...channels[0], creator_info_at: new Date().toISOString(), creator_info: { privacy_level_options: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"], comment_disabled: false, duet_disabled: false, stitch_disabled: false, max_video_post_duration_sec: null } } as Channel;
    const plan = buildBatchPlan({ ...base, channelIds: ["c1"], mediaIds: ["m1"], strategy: "SEQUENTIAL", publishMode: "DIRECT", tiktokAudited: false, initialItems: [{ channelId: "c1", mediaIds: ["m1"], postType: "VIDEO", caption: "x", privacyLevel: "PUBLIC_TO_EVERYONE", allowComment: true, allowDuet: false, allowStitch: false }] }, [capable], [{ ...media[0], mime_type: "video/mp4" } as MediaAsset]);
    expect(plan[0].errors).toContain("O aplicativo TikTok ainda não foi auditado; Direct Post exige privacidade Somente eu.");
  });
  it("não trata capacidades antigas da conta como validação atual", () => {
    const stale = { ...channels[0], creator_info_at: "2020-01-01T00:00:00.000Z", creator_info: { privacy_level_options: ["SELF_ONLY"], comment_disabled: false, duet_disabled: false, stitch_disabled: false, max_video_post_duration_sec: null } } as Channel;
    const plan = buildBatchPlan({ ...base, channelIds: ["c1"], mediaIds: ["m1"], strategy: "SEQUENTIAL", publishMode: "DIRECT", initialItems: [{ channelId: "c1", mediaIds: ["m1"], postType: "VIDEO", caption: "x", privacyLevel: "SELF_ONLY", allowComment: true, allowDuet: false, allowStitch: false }] }, [stale], [{ ...media[0], mime_type: "video/mp4" } as MediaAsset]);
    expect(plan[0].errors).toContain("Capacidades do criador não verificadas ou desatualizadas; atualize as opções antes da confirmação.");
  });
  it("não valida duetos e stitch para carrossel e mantém as opções fora do item", () => {
    const capable = { ...channels[0], creator_info_at: new Date().toISOString(), creator_info: { privacy_level_options: ["SELF_ONLY"], comment_disabled: false, duet_disabled: true, stitch_disabled: true, max_video_post_duration_sec: null } } as Channel;
    const images = [{ id: "p1", status: "READY", validation_status: "VALIDATED", mime_type: "image/jpeg" }] as MediaAsset[];
    const plan = buildBatchPlan({ ...base, channelIds: ["c1"], mediaIds: ["p1"], strategy: "SEQUENTIAL", postType: "PHOTO", carouselAssetIds: ["p1"], publishMode: "DIRECT", initialItems: [{ channelId: "c1", mediaIds: ["p1"], postType: "PHOTO", caption: "foto", privacyLevel: "SELF_ONLY", allowComment: true, allowDuet: true, allowStitch: true }] }, [capable], images);
    expect(plan[0].allowDuet).toBeNull();
    expect(plan[0].allowStitch).toBeNull();
    expect(plan[0].errors).toEqual([]);
  });
});
