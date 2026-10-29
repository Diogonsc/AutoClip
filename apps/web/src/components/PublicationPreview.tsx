import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import {
  commercialLabelText,
  type CommercialLabel,
} from "../lib/tiktokCompliance";

export interface PreviewProps {
  nickname?: string;
  username?: string;
  caption: string;
  mediaName?: string;
  mediaDuration?: number | null;
  storageKey?: string;
  privacyText?: string;
  interactions: string[];
  whenText?: string;
  label: CommercialLabel;
}

/** Prévia obrigatória antes de enviar ao TikTok (Content Sharing Guidelines). */
export default function PublicationPreview(p: PreviewProps) {
  const url = useQuery({
    queryKey: ["preview-url", p.storageKey],
    enabled: Boolean(p.storageKey),
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("media")
        .createSignedUrl(p.storageKey as string, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
  });

  return (
    <section
      aria-label="Prévia da publicação"
      className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-[9rem_1fr]"
    >
      <div className="aspect-[9/16] w-36 overflow-hidden rounded-md bg-black">
        {url.data ? (
          <video
            src={url.data}
            controls
            muted
            preload="metadata"
            className="size-full object-contain"
          />
        ) : (
          <div className="grid size-full place-items-center p-2 text-center text-xs text-muted-foreground">
            {p.storageKey ? "Carregando vídeo…" : "Selecione um vídeo"}
          </div>
        )}
      </div>
      <dl className="grid content-start gap-1.5 text-sm">
        <div className="font-medium">
          Publicando como{" "}
          <span className="text-primary">
            {p.nickname || p.username || "canal selecionado"}
          </span>
          {p.nickname && p.username && (
            <span className="text-xs text-muted-foreground"> @{p.username}</span>
          )}
        </div>
        <div className="whitespace-pre-wrap break-words text-foreground/90">
          {p.caption.trim() || (
            <em className="text-muted-foreground">Sem legenda</em>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {p.mediaName ?? "—"}
          {p.mediaDuration ? ` · ${Math.round(p.mediaDuration)}s` : ""}
          {p.whenText ? ` · ${p.whenText}` : ""}
        </div>
        {p.privacyText && (
          <div className="text-xs">
            Visibilidade: <strong>{p.privacyText}</strong>
          </div>
        )}
        {p.interactions.length > 0 && (
          <div className="text-xs">
            Interações permitidas: <strong>{p.interactions.join(", ")}</strong>
          </div>
        )}
        {p.label && (
          <div className="text-xs">
            Rótulo no TikTok: <strong>{commercialLabelText[p.label]}</strong>
          </div>
        )}
      </dl>
    </section>
  );
}
