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
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

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
            <Select
              value={channelId}
              onValueChange={(selectedId) => {
                if (!selectedId) return;
                const nextId = selectedId;
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
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {(channels.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.display_name} — {channelStatusLabel[c.connection_status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Vídeo" hint="Somente vídeos prontos aparecem aqui.">
            <Select
              value={mediaId}
              onValueChange={(value) => value && setMediaId(value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {readyMedia.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.original_filename}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <Textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Escreva a legenda…"
            maxLength={2200}
          />
          <span className="muted">{caption.length}/2200</span>
        </Field>

        <div className="row">
          <Field label="Data e hora">
            <Input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </Field>
          <Field label="Fuso horário">
            <Select value={tz} onValueChange={(value) => value && setTz(value)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(tzList.includes(tz) ? tzList : [tz, ...tzList]).map((z) => (
                  <SelectItem key={z} value={z}>
                    {z}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <Button
              type="button"
              variant="outline"
              disabled={loadInfo.isPending}
              onClick={() => loadInfo.mutate()}
            >
              Carregar opções do TikTok
            </Button>
            <ErrorBox error={loadInfo.error} />
          </div>
        ) : (
          <fieldset className="form">
            <legend>
              Privacidade e interações (opções reais do seu TikTok)
            </legend>
            <Field label="Quem pode ver">
              <Select
                value={privacy || null}
                onValueChange={(value) => setPrivacy(value ?? "")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione…" />
                </SelectTrigger>
                <SelectContent>
                  {info.privacy_level_options.map((o) => (
                    <SelectItem key={o} value={o}>
                      {PRIVACY_LABEL[o] ?? o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <label className="actions">
              <Checkbox
                checked={allowComment}
                disabled={info.comment_disabled}
                onCheckedChange={(checked) => setAllowComment(checked === true)}
              />
              <span>
                Permitir comentários
                {info.comment_disabled ? " (desativado na sua conta)" : ""}
              </span>
            </label>
            <label className="actions">
              <Checkbox
                checked={allowDuet}
                disabled={info.duet_disabled}
                onCheckedChange={(checked) => setAllowDuet(checked === true)}
              />
              <span>
                Permitir dueto
                {info.duet_disabled ? " (desativado na sua conta)" : ""}
              </span>
            </label>
            <label className="actions">
              <Checkbox
                checked={allowStitch}
                disabled={info.stitch_disabled}
                onCheckedChange={(checked) => setAllowStitch(checked === true)}
              />
              <span>
                Permitir stitch
                {info.stitch_disabled ? " (desativado na sua conta)" : ""}
              </span>
            </label>
            <label className="actions">
              <Checkbox
                checked={brandOrganic}
                onCheckedChange={(checked) => setBrandOrganic(checked === true)}
              />
              <span>Promove a minha própria marca</span>
            </label>
            <label className="actions">
              <Checkbox
                checked={brandContent}
                onCheckedChange={(checked) => setBrandContent(checked === true)}
              />
              <span>Conteúdo de marca (parceria paga)</span>
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loadInfo.isPending}
              onClick={() => loadInfo.mutate()}
            >
              Atualizar opções
            </Button>
          </fieldset>
        )}

        <label className="actions">
          <Checkbox
            checked={confirmed}
            onCheckedChange={(checked) => setConfirmed(checked === true)}
          />
          <span>Revisei canal, vídeo, legenda e horário desta publicação.</span>
        </label>

        {(localError || save.error) && (
          <ErrorBox error={localError ? new Error(localError) : save.error} />
        )}

        <div className="actions end">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={save.isPending}
            onClick={() => submit("DRAFT")}
          >
            Salvar rascunho
          </Button>
          <Button disabled={save.isPending}>Agendar</Button>
        </div>
      </form>
    </Modal>
  );
}
