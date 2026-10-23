// Padrões por canal: idioma, país, legenda e hashtags. Funções puras (testáveis sem React).
// O país e o idioma são só rótulos de organização: não mudam como nem de onde se publica.

export const CAPTION_MAX = 2200;
export const HASHTAGS_MAX = 500;

export const COUNTRIES: Array<{ code: string; name: string }> = [
  { code: "BR", name: "Brasil" },
  { code: "PT", name: "Portugal" },
  { code: "US", name: "Estados Unidos" },
  { code: "GB", name: "Reino Unido" },
  { code: "CA", name: "Canadá" },
  { code: "AU", name: "Austrália" },
  { code: "ES", name: "Espanha" },
  { code: "MX", name: "México" },
  { code: "AR", name: "Argentina" },
  { code: "CO", name: "Colômbia" },
  { code: "CL", name: "Chile" },
  { code: "DE", name: "Alemanha" },
  { code: "FR", name: "França" },
  { code: "IT", name: "Itália" },
  { code: "NL", name: "Países Baixos" },
  { code: "JP", name: "Japão" },
  { code: "KR", name: "Coreia do Sul" },
  { code: "IN", name: "Índia" },
  { code: "ID", name: "Indonésia" },
  { code: "PH", name: "Filipinas" },
  { code: "TR", name: "Turquia" },
  { code: "AE", name: "Emirados Árabes" },
  { code: "ZA", name: "África do Sul" },
];

export const LANGUAGES: Array<{ code: string; name: string }> = [
  { code: "pt-BR", name: "Português (Brasil)" },
  { code: "pt-PT", name: "Português (Portugal)" },
  { code: "en-US", name: "Inglês (EUA)" },
  { code: "en-GB", name: "Inglês (Reino Unido)" },
  { code: "es-ES", name: "Espanhol (Espanha)" },
  { code: "es-MX", name: "Espanhol (México)" },
  { code: "es-AR", name: "Espanhol (Argentina)" },
  { code: "de-DE", name: "Alemão" },
  { code: "fr-FR", name: "Francês" },
  { code: "it-IT", name: "Italiano" },
  { code: "nl-NL", name: "Holandês" },
  { code: "ja-JP", name: "Japonês" },
  { code: "ko-KR", name: "Coreano" },
  { code: "id-ID", name: "Indonésio" },
  { code: "tr-TR", name: "Turco" },
  { code: "hi-IN", name: "Hindi" },
];

/** Emoji de bandeira a partir do código ISO de 2 letras; vazio se o código for inválido. */
export function countryFlag(code: string | null | undefined): string {
  if (!code || !/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(
    ...[...code].map((c) => 127397 + c.charCodeAt(0)),
  );
}

export function countryName(code: string | null | undefined): string {
  return COUNTRIES.find((c) => c.code === code)?.name ?? code ?? "";
}

export function languageName(code: string | null | undefined): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code ?? "";
}

/** Rótulo curto para a lista de canais, ex.: "🇧🇷 pt-BR". Vazio se nada foi definido. */
export function channelLocaleLabel(c: {
  country?: string | null;
  language?: string | null;
}): string {
  return [countryFlag(c.country), c.language ?? c.country ?? ""]
    .filter(Boolean)
    .join(" ")
    .trim();
}

/**
 * Normaliza hashtags digitadas de forma livre: separa por espaço, vírgula ou quebra de linha,
 * remove "#" repetidos e caracteres inválidos, tira duplicadas (sem diferenciar maiúsculas)
 * e devolve "#a #b #c".
 */
export function normalizeHashtags(input: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[\s,;]+/)) {
    const word = raw.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (!word) continue;
    const key = word.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`#${word}`);
  }
  return out.join(" ");
}

/** Texto inicial da legenda de uma nova publicação: legenda padrão, linha em branco e hashtags. */
export function buildDefaultCaption(c: {
  default_caption?: string | null;
  default_hashtags?: string | null;
}): string {
  return [(c.default_caption ?? "").trim(), (c.default_hashtags ?? "").trim()]
    .filter(Boolean)
    .join("\n\n");
}
