import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { useCurrentWorkspace } from "../auth/WorkspaceProvider";
import { ApiError, invokeFunction, unwrap } from "../lib/api";
import { buildDefaultCaption } from "../lib/channelDefaults";
import { channelStatusLabel } from "../lib/format";
import { useChannels, useMedia, useSettings } from "../lib/hooks";
import { supabase } from "../lib/supabase";
import type {
  CreatorInfo,
  PublicationJob,
  PublicationStatus,
} from "../lib/types";
import {
  allTimezones,
  browserTimezone,
  utcToZonedInput,
  zonedToUtc,
} from "../lib/time";
import { ErrorBox, Field, Modal, Notice } from "./ui";

const PRIVACY_LABEL: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Todos",
  MUTUAL_FOLLOW_FRIENDS: "Amigos (seguimento mútuo)",
  FOLLOWER_OF_CREATOR: "Seguidores",
  SELF_ONLY: "Somente eu",
};

export default function PublicationForm({
  job,
  initialDate,
  onClose,
}: {
  job?: PublicationJob;
  initialDate?: string; // "YYYY-MM-DDTHH:mm"
  onClose: () => void;
}) {
  const ws = useCurrentWorkspace();
  const { user } = useAuth();
  const qc = useQueryClient();
  const channels = useChannels(ws.id);
  const media = useMedia(ws.id);
  const settings = useSettings(ws.id);

  const tzList = useMemo(() => allTimezones(), []);
  const defaultTz = settings.data?.default_timezone ?? browserTimezone();
  const [tz, setTz] = useState(job?.timezone ?? defaultTz);
  const [channelId, setChannelId] = useState(job?.channel_id ?? "");
  const [mediaId, setMediaId] = useState(job?.media_asset_id ?? "");
  const [caption, setCaption] = useState(job?.caption ?? "");
  const [when, setWhen] = useState(
    job?.scheduled_at
      ? utcToZonedInput(job.scheduled_at, job.timezone)
      : (initialDate ?? ""),
  );
  const [privacy, setPrivacy] = useState(job?.privacy_level ?? "");
  const [allowComment, setAllowComment] = useState(job?.allow_comment ?? false);
  const [allowDuet, setAllowDuet] = useState(job?.allow_duet ?? false);
  const [allowStitch, setAllowStitch] = useState(job?.allow_stitch ?? false);
  const [brandContent, setBrandContent] = useState(job?.brand_content ?? false);
  const [brandOrganic, setBrandOrganic] = useState(job?.brand_organic ?? false);
  const [freshInfo, setFreshInfo] = useState<CreatorInfo | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const readyMedia = (media.data ?? []).filter((m) => m.status === "READY");
  const selectedChannel = (channels.data ?? []).find((c) => c.id === channelId);

  const direct = settings.data?.publish_mode === "DIRECT";
  const info: CreatorInfo | null =
    freshInfo ?? selectedChannel?.creator_info ?? null;

  const loadInfo = useMutation({
    mutationFn: async () => {
      const r = await invokeFunction<{ creator_info: CreatorInfo }>(
        supabase,
        "tiktok-channel",
        {
          action: "creator_info",
          channel_id: channelId,
        },
      );
      setFreshInfo(r.creator_info);
      if (privacy && !r.creator_info.privacy_level_options.includes(privacy))
        setPrivacy("");
    },
  });

  const save = useMutation({
    mutationFn: async (status: PublicationStatus) => {
      let scheduled_at: string | null = null;
      if (status === "SCHEDULED") {
        if (!when) throw new ApiError("Informe data e hora para agendar.");
        const utc = zonedToUtc(when, tz);
        if (utc.getTime() < Date.now() - 60_000)
          throw new ApiError("A data de agendamento já passou.");
        scheduled_at = utc.toISOString();
      } else if (when) {
        scheduled_at = zonedToUtc(when, tz).toISOString();
      }

      const common = {
        channel_id: channelId,
        media_asset_id: mediaId,
        caption,
        // No modo DIRECT a privacidade só vale se vier das opções reais do criador; no INBOX o usuário decide no app do TikTok.
        privacy_level: direct && privacy ? privacy : null,
        allow_comment: direct ? allowComment : null,
        allow_duet: direct ? allowDuet : null,
        allow_stitch: direct ? allowStitch : null,
        brand_content: direct ? brandContent : false,
        brand_organic: direct ? brandOrganic : false,
        scheduled_at,
        timezone: tz,
        status,
      };

      if (job) {
        unwrap(
          await supabase
            .from("publication_jobs")
            .update(common)
            .eq("id", job.id),
        );
      } else {
        unwrap(
          await supabase
            .from("publication_jobs")
            .insert({ ...common, workspace_id: ws.id, created_by: user!.id }),
        );
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["jobs", ws.id] });
      onClose();
    },
  });

  function submit(status: PublicationStatus) {
    setLocalError(null);
    if (!channelId) return setLocalError("Selecione um canal.");
    if (!mediaId) return setLocalError("Selecione um vídeo.");
    if (caption.length > 2200)
      return setLocalError("A legenda pode ter no máximo 2200 caracteres.");
    if (status === "SCHEDULED" && direct && !privacy)
      return setLocalError("Escolha a privacidade da publicação.");
    if (
      status === "SCHEDULED" &&
      direct &&
      brandContent &&
      privacy === "SELF_ONLY"
    )
      return setLocalError("Conteúdo de marca não pode ser “Somente eu”.");
    if (status === "SCHEDULED" && !confirmed) {
      return setLocalError(
        "Confirme a revisão da publicação antes de agendar.",
      );
    }
    save.mutate(status);
  }

  return (
    <Modal
      title={job ? "Editar publicação" : "Nova publicação"}
      onClose={onClose}
      wide
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          submit("SCHEDULED");
        }}
      >
        <div className="row">
          <Field label="Canal">
            <select
              value={channelId}
              onChange={(e) => {
                const nextId = e.target.value;
                const prev = (channels.data ?? []).find(
                  (c) => c.id === channelId,
                );
                const next = (channels.data ?? []).find((c) => c.id === nextId);
                // Preenche novos agendamentos sem sobrescrever texto que o usuário já editou.
                const untouched =
                  caption.trim() === "" ||
                  (prev !== undefined && caption === buildDefaultCaption(prev));
                if (!job && next && untouched)
                  setCaption(buildDefaultCaption(next));
                setChannelId(nextId);
              }}
              required
            >
              <option value="">Selecione…</option>
              {(channels.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_name} — {channelStatusLabel[c.connection_status]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Vídeo" hint="Somente vídeos prontos aparecem aqui.">
            <select
              value={mediaId}
              onChange={(e) => setMediaId(e.target.value)}
              required
            >
              <option value="">Selecione…</option>
              {readyMedia.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.original_filename}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {selectedChannel &&
          selectedChannel.connection_status !== "CONNECTED" && (
            <Notice tone="warning">
              Este canal não está conectado ao TikTok. A publicação pode ser
              agendada, mas será bloqueada na revalidação até que o canal seja
              autorizado.
            </Notice>
          )}

        <Field label="Legenda">
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Escreva a legenda…"
            maxLength={2200}
          />
          <span className="muted">{caption.length}/2200</span>
        </Field>

        <div className="row">
          <Field label="Data e hora">
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </Field>
          <Field label="Fuso horário">
            <select value={tz} onChange={(e) => setTz(e.target.value)}>
              {(tzList.includes(tz) ? tzList : [tz, ...tzList]).map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {!direct ? (
          <Notice tone="info">
            Modo rascunho: o vídeo será enviado para a caixa de entrada do
            TikTok e a privacidade e as interações são definidas por você no
            aplicativo, na hora de postar.
          </Notice>
        ) : !selectedChannel ||
          selectedChannel.connection_status !== "CONNECTED" ? (
          <Notice tone="info">
            Selecione um canal conectado para carregar as opções de privacidade.
          </Notice>
        ) : !info ? (
          <div>
            <Notice tone="warning">
              As opções do criador ainda não foram carregadas para este canal.
            </Notice>
            <button
              type="button"
              className="btn"
              disabled={loadInfo.isPending}
              onClick={() => loadInfo.mutate()}
            >
              Carregar opções do TikTok
            </button>
            <ErrorBox error={loadInfo.error} />
          </div>
        ) : (
          <fieldset className="form">
            <legend>
              Privacidade e interações (opções reais do seu TikTok)
            </legend>
            <Field label="Quem pode ver">
              <select
                value={privacy}
                onChange={(e) => setPrivacy(e.target.value)}
              >
                <option value="">Selecione…</option>
                {info.privacy_level_options.map((o) => (
                  <option key={o} value={o}>
                    {PRIVACY_LABEL[o] ?? o}
                  </option>
                ))}
              </select>
            </Field>
            <label className="actions">
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={allowComment}
                disabled={info.comment_disabled}
                onChange={(e) => setAllowComment(e.target.checked)}
              />
              <span>
                Permitir comentários
                {info.comment_disabled ? " (desativado na sua conta)" : ""}
              </span>
            </label>
            <label className="actions">
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={allowDuet}
                disabled={info.duet_disabled}
                onChange={(e) => setAllowDuet(e.target.checked)}
              />
              <span>
                Permitir dueto
                {info.duet_disabled ? " (desativado na sua conta)" : ""}
              </span>
            </label>
            <label className="actions">
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={allowStitch}
                disabled={info.stitch_disabled}
                onChange={(e) => setAllowStitch(e.target.checked)}
              />
              <span>
                Permitir stitch
                {info.stitch_disabled ? " (desativado na sua conta)" : ""}
              </span>
            </label>
            <label className="actions">
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={brandOrganic}
                onChange={(e) => setBrandOrganic(e.target.checked)}
              />
              <span>Promove a minha própria marca</span>
            </label>
            <label className="actions">
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={brandContent}
                onChange={(e) => setBrandContent(e.target.checked)}
              />
              <span>Conteúdo de marca (parceria paga)</span>
            </label>
            <button
              type="button"
              className="btn small"
              disabled={loadInfo.isPending}
              onClick={() => loadInfo.mutate()}
            >
              Atualizar opções
            </button>
          </fieldset>
        )}

        <label className="actions">
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>Revisei canal, vídeo, legenda e horário desta publicação.</span>
        </label>

        {(localError || save.error) && (
          <ErrorBox error={localError ? new Error(localError) : save.error} />
        )}

        <div className="actions end">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn"
            disabled={save.isPending}
            onClick={() => submit("DRAFT")}
          >
            Salvar rascunho
          </button>
          <button className="btn primary" disabled={save.isPending}>
            Agendar
          </button>
        </div>
      </form>
    </Modal>
  );
}
