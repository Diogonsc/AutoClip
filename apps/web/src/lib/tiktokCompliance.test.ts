import { describe, expect, it } from "vitest";
import {
  commercialLabel,
  declarationKind,
  durationProblem,
  privacyOptionsFor,
  validateCompliance,
  type ComplianceInput,
} from "./tiktokCompliance";
import type { CreatorInfo } from "./types";

const info: CreatorInfo = {
  privacy_level_options: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
  comment_disabled: false,
  duet_disabled: false,
  stitch_disabled: false,
  max_video_post_duration_sec: 600,
};

const base: ComplianceInput = {
  direct: true,
  scheduling: true,
  info,
  privacy: "PUBLIC_TO_EVERYONE",
  commercialOn: false,
  organic: false,
  brand: false,
  durationSeconds: 30,
  consent: true,
};

describe("rótulos comerciais", () => {
  it("parceria paga vence promoção própria", () => {
    expect(commercialLabel(true, true)).toBe("PAID_PARTNERSHIP");
    expect(commercialLabel(true, false)).toBe("PROMOTIONAL");
    expect(commercialLabel(false, false)).toBeNull();
  });
  it("declaração inclui a política de marca só com conteúdo de marca", () => {
    expect(declarationKind(false)).toBe("MUSIC");
    expect(declarationKind(true)).toBe("BRANDED_AND_MUSIC");
  });
});

describe("privacidade", () => {
  it("remove Somente eu quando é conteúdo de marca", () => {
    expect(privacyOptionsFor(info, true)).toEqual(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS"]);
    expect(privacyOptionsFor(info, false)).toHaveLength(3);
  });
});

describe("duração", () => {
  it("bloqueia vídeo acima do máximo do criador", () => {
    expect(durationProblem(info, 601)).toMatch(/máximo 600s/);
    expect(durationProblem(info, 600)).toBeNull();
    expect(durationProblem({ ...info, max_video_post_duration_sec: null }, 9999)).toBeNull();
    expect(durationProblem(info, null)).toBeNull();
  });
});

describe("validateCompliance", () => {
  it("passa no caminho feliz", () => {
    expect(validateCompliance(base)).toBeNull();
  });
  it("rascunho não é bloqueado", () => {
    expect(validateCompliance({ ...base, scheduling: false, consent: false, privacy: "" })).toBeNull();
  });
  it("exige consentimento", () => {
    expect(validateCompliance({ ...base, consent: false })).toMatch(/autorização/);
  });
  it("exige privacidade escolhida (sem valor padrão)", () => {
    expect(validateCompliance({ ...base, privacy: "" })).toMatch(/quem pode ver/);
  });
  it("toggle comercial ligado sem opção bloqueia", () => {
    expect(validateCompliance({ ...base, commercialOn: true })).toMatch(/promove/);
    expect(validateCompliance({ ...base, commercialOn: true, organic: true })).toBeNull();
  });
  it("conteúdo de marca não aceita Somente eu", () => {
    expect(validateCompliance({ ...base, commercialOn: true, brand: true, privacy: "SELF_ONLY" })).toMatch(/não pode ser privada/);
  });
  it("no modo rascunho do TikTok (INBOX) só exige consentimento", () => {
    expect(validateCompliance({ ...base, direct: false, info: null, privacy: "" })).toBeNull();
  });
  it("bloqueia duração acima do máximo", () => {
    expect(validateCompliance({ ...base, durationSeconds: 900 })).toMatch(/máximo/);
  });
});
