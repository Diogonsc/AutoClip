// Regras de conformidade da Content Posting API do TikTok (Content Sharing Guidelines).
// Funções puras: a interface usa para orientar e o teste garante o comportamento.
import type { CreatorInfo } from "./types";

export const MUSIC_USAGE_URL =
  "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
export const BRANDED_CONTENT_URL =
  "https://www.tiktok.com/legal/page/global/bc-policy/en";

export type CommercialLabel = "PROMOTIONAL" | "PAID_PARTNERSHIP" | null;

/** Rótulo que o TikTok aplicará ao post conforme a declaração comercial. */
export function commercialLabel(organic: boolean, brand: boolean): CommercialLabel {
  if (brand) return "PAID_PARTNERSHIP";
  if (organic) return "PROMOTIONAL";
  return null;
}

export const commercialLabelText: Record<Exclude<CommercialLabel, null>, string> = {
  PROMOTIONAL: "Conteúdo promocional",
  PAID_PARTNERSHIP: "Parceria paga",
};

/** Declaração que deve aparecer antes do botão de publicar. */
export function declarationKind(brand: boolean): "MUSIC" | "BRANDED_AND_MUSIC" {
  return brand ? "BRANDED_AND_MUSIC" : "MUSIC";
}

/** Conteúdo de marca não pode ser privado: remove "Somente eu" das opções. */
export function privacyOptionsFor(info: CreatorInfo, brandContent: boolean): string[] {
  return brandContent
    ? info.privacy_level_options.filter((o) => o !== "SELF_ONLY")
    : info.privacy_level_options;
}

export function durationProblem(
  info: CreatorInfo | null,
  durationSeconds: number | null,
): string | null {
  const max = info?.max_video_post_duration_sec ?? null;
  if (max === null || durationSeconds === null) return null;
  if (durationSeconds > max) {
    return `O vídeo tem ${Math.round(durationSeconds)}s e este criador pode postar no máximo ${max}s.`;
  }
  return null;
}

export interface ComplianceInput {
  direct: boolean;
  scheduling: boolean; // false = salvar rascunho
  info: CreatorInfo | null;
  privacy: string;
  commercialOn: boolean;
  organic: boolean;
  brand: boolean;
  durationSeconds: number | null;
  consent: boolean;
}

/** Retorna a primeira violação encontrada (ou null). Só valida o que a API exige no momento de agendar. */
export function validateCompliance(i: ComplianceInput): string | null {
  if (!i.scheduling) return null;
  if (!i.consent) {
    return "Marque a autorização para enviar o conteúdo ao TikTok antes de agendar.";
  }
  if (!i.direct) return null;
  if (!i.info) return "Carregue as opções do TikTok para este canal antes de agendar.";
  if (!i.privacy) return "Escolha quem pode ver a publicação.";
  if (!privacyOptionsFor(i.info, i.brand).includes(i.privacy)) {
    return i.brand
      ? "A visibilidade de conteúdo de marca não pode ser privada."
      : "Esta privacidade não está disponível para o seu TikTok.";
  }
  if (i.commercialOn && !i.organic && !i.brand) {
    return "Indique se o conteúdo promove a sua marca, uma marca de terceiros ou ambos.";
  }
  return durationProblem(i.info, i.durationSeconds);
}
