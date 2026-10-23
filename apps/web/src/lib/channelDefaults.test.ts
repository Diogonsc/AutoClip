import { describe, expect, it } from "vitest";
import {
  buildDefaultCaption,
  channelLocaleLabel,
  countryFlag,
  COUNTRIES,
  LANGUAGES,
  normalizeHashtags,
} from "./channelDefaults";

describe("normalizeHashtags", () => {
  it('padroniza separadores, "#" repetidos e duplicadas', () => {
    expect(normalizeHashtags("fé, #deus ##Motivação\n#FÉ;  paz")).toBe(
      "#fé #deus #Motivação #paz",
    );
  });

  it("remove caracteres inválidos e entradas vazias", () => {
    expect(normalizeHashtags("# #!!! #a-b #ok_1")).toBe("#ab #ok_1");
    expect(normalizeHashtags("   ")).toBe("");
  });
});

describe("buildDefaultCaption", () => {
  it("junta legenda e hashtags separadas por linha em branco", () => {
    expect(
      buildDefaultCaption({
        default_caption: "Boa noite.",
        default_hashtags: "#fe #paz",
      }),
    ).toBe("Boa noite.\n\n#fe #paz");
  });

  it("funciona com só um dos dois e com vazios", () => {
    expect(
      buildDefaultCaption({ default_caption: "", default_hashtags: "#fe" }),
    ).toBe("#fe");
    expect(
      buildDefaultCaption({ default_caption: " Oi ", default_hashtags: "" }),
    ).toBe("Oi");
    expect(
      buildDefaultCaption({ default_caption: null, default_hashtags: null }),
    ).toBe("");
  });
});

describe("país e idioma", () => {
  it("gera a bandeira só para códigos válidos", () => {
    expect(countryFlag("BR")).toBe("🇧🇷");
    expect(countryFlag("us")).toBe("");
    expect(countryFlag(null)).toBe("");
  });

  it("monta o rótulo do canal", () => {
    expect(channelLocaleLabel({ country: "BR", language: "pt-BR" })).toBe(
      "🇧🇷 pt-BR",
    );
    expect(channelLocaleLabel({ country: null, language: "en-US" })).toBe(
      "en-US",
    );
    expect(channelLocaleLabel({ country: "ES", language: null })).toBe("🇪🇸 ES");
    expect(channelLocaleLabel({})).toBe("");
  });

  it("todas as opções respeitam as regras do banco", () => {
    for (const c of COUNTRIES) expect(c.code).toMatch(/^[A-Z]{2}$/);
    for (const l of LANGUAGES)
      expect(l.code).toMatch(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/);
  });
});
