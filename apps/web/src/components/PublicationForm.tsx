import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { useCurrentWorkspace } from "../auth/WorkspaceProvider";
import { ApiError, invokeFunction, unwrap } from "../lib/api";
import { buildDefaultCaption } from "../lib/channelDefaults";
import { channelStatusLabel } from "../lib/format";
import {
  useChannels,
  useJobsPage,
  useMedia,
  usePlatformFlags,
  useSettings,
} from "../lib/hooks";
import { supabase } from "../lib/supabase";
import {
  BRANDED_CONTENT_URL,
  MUSIC_USAGE_URL,
  commercialLabel,
  declarationKind,
  durationProblem,
  privacyOptionsFor,
  validateCompliance,
} from "../lib/tiktokCompliance";
import PublicationPreview from "./PublicationPreview";
import type {
  CreatorInfo,
  MediaAsset,
  PublicationJob,
  PublicationStatus,
} from "../lib/types";
import {
  allTimezones,
  browserTimezone,
  utcToZonedInput,
  zonedToUtc,
} from "../lib/time";
import { SelectField } from "./select-field";
import { ErrorBox, Field, Modal, Notice } from "./ui";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

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
  const scheduledJobs = useJobsPage(ws.id, 0, 1000);
  const settings = useSettings(ws.id);
  const platformFlags = usePlatformFlags();

  const tzList = useMemo(() => allTimezones(), []);
  const defaultTz = settings.data?.default_timezone ?? browserTimezone();
  const [tz, setTz] = useState(job?.timezone ?? defaultTz);
  const [channelId, setChannelId] = useState(job?.channel_id ?? "");
  const [mediaId, setMediaId] = useState(job?.media_asset_id ?? "");
  const [postType, setPostType] = useState<"VIDEO" | "PHOTO">(
    job?.post_type ?? "VIDEO",
  );
  const [photoIds, setPhotoIds] = useState<string[]>(
    job?.media_asset_ids ?? (job?.media_asset_id ? [job.media_asset_id] : []),
  );
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
  const [commercialOn, setCommercialOn] = useState(
    Boolean(job?.brand_content || job?.brand_organic),
  );
  const [freshInfo, setFreshInfo] = useState<CreatorInfo | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [musicRightsConfirmed, setMusicRightsConfirmed] = useState(
    job?.music_rights_confirmed ?? false,
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [suggestedTimes, setSuggestedTimes] = useState<
    Array<{ value: string; label: string }>
  >([]);

  const readyMedia = (media.data ?? []).filter((m) => m.status === "READY");
  const readyVideos = readyMedia.filter((m) =>
    m.mime_type.startsWith("video/"),
  );
  const readyPhotos = readyMedia.filter((m) =>
    m.mime_type.startsWith("image/"),
  );
  const selectedPhotos = photoIds
    .map((id) => readyPhotos.find((m) => m.id === id))
    .filter((m): m is MediaAsset => Boolean(m));
  const selectedChannel = (channels.data ?? []).find((c) => c.id === channelId);
  const selectedMedia = readyMedia.find((m) => m.id === mediaId);

  const direct = settings.data?.publish_mode === "DIRECT";
  const audited = platformFlags.data?.tiktok_audited === true;
  const info: CreatorInfo | null =
    freshInfo ?? selectedChannel?.creator_info ?? null;
  // Configurações que o criador desativou no TikTok prevalecem sobre o que está marcado.
  const effComment = allowComment && !info?.comment_disabled;
  const effDuet = allowDuet && !info?.duet_disabled;
  const effStitch = allowStitch && !info?.stitch_disabled;
  const effOrganic = commercialOn && brandOrganic;
  const effBrand = commercialOn && brandContent;
  const label = commercialLabel(effOrganic, effBrand);
  const mediaDurationIssue = direct
    ? durationProblem(info, selectedMedia?.duration_seconds ?? null)
    : null;

  useEffect(() => {
    let active = true;
    setPreviewUrl(null);
    if (!selectedMedia) return;
    void supabase.storage
      .from("media")
      .createSignedUrl(selectedMedia.storage_key, 300)
      .then(({ data, error }) => {
        if (active && !error && data?.signedUrl) setPreviewUrl(data.signedUrl);
      });
    return () => {
      active = false;
    };
  }, [selectedMedia?.id, selectedMedia?.storage_key]);

  useEffect(() => {
    let active = true;
    setPhotoPreviewUrls([]);
    if (postType !== "PHOTO" || selectedPhotos.length === 0) return;
    void Promise.all(
      selectedPhotos.map(async (asset) => {
        const { data, error } = await supabase.storage
          .from("media")
          .createSignedUrl(asset.storage_key, 300);
        return !error && data?.signedUrl ? data.signedUrl : null;
      }),
    ).then((urls) => {
      if (active)
        setPhotoPreviewUrls(urls.filter((url): url is string => Boolean(url)));
    });
    return () => {
      active = false;
    };
  }, [postType, photoIds.join(","), media.data]);

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
      if (
        !audited &&
        r.creator_info.privacy_level_options.includes("SELF_ONLY")
      ) {
        setPrivacy("SELF_ONLY");
      } else if (
        privacy &&
        !r.creator_info.privacy_level_options.includes(privacy)
      ) {
        setPrivacy("");
      }
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
        media_asset_id: postType === "PHOTO" ? photoIds[0] : mediaId,
        media_asset_ids: postType === "PHOTO" ? photoIds : [mediaId],
        post_type: postType,
        caption,
        // No modo DIRECT a privacidade só vale se vier das opções reais do criador; no INBOX o usuário decide no app do TikTok.
        privacy_level: direct && privacy ? privacy : null,
        allow_comment: direct ? allowComment : null,
        allow_duet: direct ? allowDuet : null,
        allow_stitch: direct ? allowStitch : null,
        brand_content: direct ? brandContent : false,
        brand_organic: direct ? brandOrganic : false,
        music_rights_confirmed: musicRightsConfirmed,
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

  function suggestTimes() {
    // Sugestões heurísticas em horários espaçados; não são previsões baseadas em analytics.
    const now = new Date();
    const existing = (scheduledJobs.data?.rows ?? [])
      .filter(
        (j) =>
          j.status !== "CANCELLED" &&
          j.scheduled_at &&
          j.channel_id === channelId,
      )
      .map((j) => new Date(j.scheduled_at!).getTime());
    const candidates: Array<{ value: string; label: string; epoch: number }> =
      [];
    const dateParts = (d: Date) => {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(d);
      const get = (type: string) =>
        parts.find((p) => p.type === type)?.value ?? "";
      return `${get("year")}-${get("month")}-${get("day")}`;
    };
    for (let day = 0; day < 10 && candidates.length < 3; day++) {
      const base = new Date(now.getTime() + day * 86_400_000);
      for (const hour of [11, 14, 18]) {
        const local = `${dateParts(base)}T${String(hour).padStart(2, "0")}:30`;
        const utc = zonedToUtc(local, tz);
        if (utc.getTime() < now.getTime() + 30 * 60_000) continue;
        if (existing.some((t) => Math.abs(t - utc.getTime()) < 45 * 60_000))
          continue;
        candidates.push({
          value: local,
          epoch: utc.getTime(),
          label: new Intl.DateTimeFormat("pt-BR", {
            timeZone: tz,
            weekday: "short",
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          }).format(utc),
        });
        if (candidates.length === 3) break;
      }
    }
    setSuggestedTimes(candidates.map(({ value, label }) => ({ value, label })));
    if (candidates.length) {
      setWhen(candidates[0].value);
      setLocalError(null);
    } else
      setLocalError(
        "Não encontrei horários livres próximos. Escolha manualmente uma data e hora.",
      );
  }

  function submit(status: PublicationStatus) {
    setLocalError(null);
    if (!channelId) return setLocalError("Selecione um canal.");
    if (postType === "VIDEO" && !mediaId)
      return setLocalError("Selecione um vídeo.");
    if (postType === "PHOTO" && (photoIds.length < 1 || photoIds.length > 35))
      return setLocalError("Selecione entre 1 e 35 imagens para a publicação.");
    if (postType === "PHOTO" && !direct)
      return setLocalError(
        "Publicações de fotos/carrossel exigem modo Publicação direta e permissões do TikTok. O modo Caixa de entrada aceita apenas vídeos neste fluxo.",
      );
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
    if (
      status === "SCHEDULED" &&
      postType === "VIDEO" &&
      !musicRightsConfirmed
    ) {
      return setLocalError(
        "Confirme que você tem os direitos/consentimento necessários para o áudio ou que usará áudio autorizado antes de agendar.",
      );
    }
    if (
      status === "SCHEDULED" &&
      direct &&
      !audited &&
      privacy &&
      privacy !== "SELF_ONLY"
    ) {
      return setLocalError(
        "O aplicativo ainda está em modo de teste. Antes da auditoria, a publicação direta só pode usar “Somente eu”. Use INBOX para publicar manualmente no TikTok.",
      );
    }
    if (status === "SCHEDULED" && !confirmed) {
      return setLocalError(
        "Confirme a revisão da publicação antes de agendar.",
      );
    }
    if (
      status === "SCHEDULED" &&
      postType === "VIDEO" &&
      selectedMedia &&
      info?.max_video_post_duration_sec != null &&
      selectedMedia.duration_seconds != null &&
      selectedMedia.duration_seconds > info.max_video_post_duration_sec
    ) {
      return setLocalError(
        `O vídeo tem ${Math.ceil(selectedMedia.duration_seconds)}s, mas o TikTok permite até ${info.max_video_post_duration_sec}s neste canal. Escolha um vídeo mais curto.`,
      );
    }
    if (
      status === "SCHEDULED" &&
      postType === "VIDEO" &&
      selectedMedia &&
      selectedMedia.mime_type &&
      !["video/mp4", "video/quicktime", "video/webm"].includes(
        selectedMedia.mime_type,
      )
    ) {
      return setLocalError("Formato não compatível. Use MP4, MOV ou WebM.");
    }
    if (
      status === "SCHEDULED" &&
      postType === "VIDEO" &&
      selectedMedia &&
      ((selectedMedia.width != null && selectedMedia.width < 360) ||
        (selectedMedia.height != null && selectedMedia.height < 360) ||
        (selectedMedia.width != null && selectedMedia.width > 4096) ||
        (selectedMedia.height != null && selectedMedia.height > 4096))
    ) {
      return setLocalError(
        "A resolução do vídeo está fora da faixa validada (360 a 4096 pixels por dimensão). Verifique o arquivo antes de agendar.",
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
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit("SCHEDULED");
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo de publicação">
            <SelectField
              value={postType}
              onValueChange={(v) => {
                const next = v as "VIDEO" | "PHOTO";
                setPostType(next);
                setMediaId("");
                setPhotoIds([]);
              }}
              options={[
                { value: "VIDEO", label: "Vídeo" },
                { value: "PHOTO", label: "Fotos / carrossel" },
              ]}
            />
          </Field>
          <Field label="Canal">
            <SelectField
              value={channelId}
              required
              options={(channels.data ?? []).map((c) => ({
                value: c.id,
                label: `${c.display_name} — ${channelStatusLabel[c.connection_status]}`,
              }))}
              onValueChange={(nextId) => {
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
            />
          </Field>
          {postType === "VIDEO" ? (
            <Field label="Vídeo" hint="Somente vídeos prontos aparecem aqui.">
              <SelectField
                value={mediaId}
                onValueChange={setMediaId}
                options={readyVideos.map((m) => ({
                  value: m.id,
                  label: m.original_filename,
                }))}
              />
            </Field>
          ) : (
            <Field
              label="Imagens do carrossel"
              hint={`Escolha 1 a 35 imagens; ordem selecionada: ${photoIds.length}. Publicação de fotos requer modo direto.`}
            >
              <div className="max-h-44 overflow-auto rounded-md border p-2 grid gap-2">
                {readyPhotos.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={photoIds.includes(m.id)}
                      onChange={(e) =>
                        setPhotoIds((old) =>
                          e.target.checked
                            ? old.length < 35
                              ? [...old, m.id]
                              : old
                            : old.filter((id) => id !== m.id),
                        )
                      }
                    />
                    {m.original_filename}
                  </label>
                ))}
                {readyPhotos.length === 0 && (
                  <span className="text-sm text-muted-foreground">
                    Envie fotos na Biblioteca de mídia primeiro.
                  </span>
                )}
              </div>
              {selectedPhotos.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Ordem do carrossel:{" "}
                  {selectedPhotos
                    .map((m, i) => `${i + 1}. ${m.original_filename}`)
                    .join(" · ")}
                </p>
              )}
            </Field>
          )}
        </div>

        {postType === "VIDEO" && selectedMedia && (
          <div className="grid gap-2 rounded-lg border p-3">
            <strong className="text-sm">Prévia do vídeo</strong>
            {previewUrl ? (
              <video
                src={previewUrl}
                controls
                playsInline
                className="max-h-80 w-full rounded-md bg-black"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Carregando prévia segura…
              </p>
            )}
            <p className="m-0 text-xs text-muted-foreground">
              {selectedMedia.duration_seconds != null
                ? `Duração: ${Math.ceil(selectedMedia.duration_seconds)}s`
                : "Duração não identificada"}{" "}
              ·{" "}
              {selectedMedia.width && selectedMedia.height
                ? `${selectedMedia.width} × ${selectedMedia.height}`
                : "Resolução não identificada"}{" "}
              · {selectedMedia.mime_type}
            </p>
          </div>
        )}

        {postType === "PHOTO" && selectedPhotos.length > 0 && (
          <div className="grid gap-2 rounded-lg border p-3">
            <strong className="text-sm">
              Prévia do carrossel ({selectedPhotos.length} imagens)
            </strong>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {photoPreviewUrls.map((url, i) => (
                <img
                  key={`${photoIds[i]}-${url}`}
                  src={url}
                  alt={`Imagem ${i + 1} do carrossel`}
                  className="aspect-square w-full rounded-md border object-cover"
                />
              ))}
            </div>
            <p className="m-0 text-xs text-muted-foreground">
              A ordem das imagens corresponde à ordem em que foram selecionadas.
              O TikTok precisa conseguir acessar as URLs e o domínio de mídia
              deve estar verificado no portal de desenvolvedores.
            </p>
          </div>
        )}

        {selectedChannel &&
          selectedChannel.connection_status !== "CONNECTED" && (
            <Notice tone="warning">
              Este canal não está conectado ao TikTok. A publicação pode ser
              agendada, mas será bloqueada na revalidação até que o canal seja
              autorizado.
            </Notice>
          )}

        {mediaDurationIssue && (
          <Notice tone="danger">{mediaDurationIssue}</Notice>
        )}

        <Field label="Legenda">
          <Textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Escreva a legenda…"
            maxLength={2200}
          />
          <span className="text-xs font-normal text-muted-foreground">
            {caption.length}/2200
          </span>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Data e hora">
            <Input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={suggestTimes}
              disabled={!channelId || scheduledJobs.isLoading}
            >
              Sugerir horários livres
            </Button>
            <span className="text-xs text-muted-foreground">
              Sugestões heurísticas (11h30, 14h30 e 18h30), evitando horários
              próximos já agendados neste canal. Não são baseadas em métricas do
              TikTok.
            </span>
            {suggestedTimes.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {suggestedTimes.map((slot) => (
                  <Button
                    key={slot.value}
                    type="button"
                    size="sm"
                    variant={when === slot.value ? "default" : "outline"}
                    onClick={() => setWhen(slot.value)}
                  >
                    {slot.label}
                  </Button>
                ))}
              </div>
            )}
          </Field>
          <Field label="Fuso horário">
            <SelectField
              value={tz}
              onValueChange={setTz}
              options={(tzList.includes(tz) ? tzList : [tz, ...tzList]).map(
                (z) => ({ value: z, label: z }),
              )}
            />
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
          <div className="grid gap-3">
            <Notice tone="warning">
              As opções do criador ainda não foram carregadas para este canal.
            </Notice>
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              disabled={loadInfo.isPending}
              onClick={() => loadInfo.mutate()}
            >
              Carregar opções do TikTok
            </Button>
            <ErrorBox error={loadInfo.error} />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-lg border p-3">
              {info.creator_avatar_url ? (
                <img
                  src={info.creator_avatar_url}
                  alt="Foto do perfil TikTok"
                  className="size-10 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="grid size-10 place-items-center rounded-full bg-muted text-sm"
                >
                  TT
                </div>
              )}
              <div className="grid min-w-0">
                <strong className="truncate text-sm">
                  {info.creator_nickname || "Criador TikTok"}
                </strong>
                <span className="truncate text-xs text-muted-foreground">
                  {info.creator_username
                    ? `@${info.creator_username}`
                    : "Perfil conectado"}
                </span>
              </div>
            </div>
            {!audited && (
              <Notice tone="warning">
                App em teste: o Direct Post só pode ser agendado como “Somente
                eu” até a auditoria ser aprovada. A opção INBOX continua
                disponível.
              </Notice>
            )}
            <fieldset className="grid gap-4 rounded-lg border p-4">
              <legend className="px-1 text-sm font-medium">
                Privacidade e interações (opções reais do seu TikTok)
              </legend>
              <p className="m-0 text-sm text-muted-foreground">
                Publicando como{" "}
                <strong className="text-foreground">
                  {info.creator_nickname || info.creator_username || "—"}
                </strong>
                {info.creator_username && info.creator_nickname
                  ? ` (@${info.creator_username})`
                  : ""}
              </p>
              {platformFlags.data && !platformFlags.data.tiktok_audited && (
                <Notice tone="warning">
                  Aplicativo em modo de teste no TikTok: independentemente da
                  opção escolhida, a publicação direta ficará visível apenas
                  para você até a aprovação.
                </Notice>
              )}
              <Field
                label="Quem pode ver"
                hint="Sem valor padrão: escolha conscientemente."
              >
                <SelectField
                  value={privacy}
                  onValueChange={setPrivacy}
                  options={info.privacy_level_options
                    .filter((o) => audited || o === "SELF_ONLY")
                    .map((o) => ({ value: o, label: PRIVACY_LABEL[o] ?? o }))}
                />
              </Field>
              <Label className="font-normal">
                <Checkbox
                  checked={allowComment}
                  disabled={info.comment_disabled}
                  onCheckedChange={(checked) =>
                    setAllowComment(checked === true)
                  }
                />
                <span>
                  Permitir comentários
                  {info.comment_disabled ? " (desativado na sua conta)" : ""}
                </span>
              </Label>
              <Label className="font-normal">
                <Checkbox
                  checked={allowDuet}
                  disabled={info.duet_disabled}
                  onCheckedChange={(checked) => setAllowDuet(checked === true)}
                />
                <span>
                  Permitir dueto
                  {info.duet_disabled ? " (desativado na sua conta)" : ""}
                </span>
              </Label>
              <Label className="font-normal">
                <Checkbox
                  checked={allowStitch}
                  disabled={info.stitch_disabled}
                  onCheckedChange={(checked) =>
                    setAllowStitch(checked === true)
                  }
                />
                <span>
                  Permitir stitch
                  {info.stitch_disabled ? " (desativado na sua conta)" : ""}
                </span>
              </Label>
              <Label className="font-normal">
                <Checkbox
                  checked={commercialOn}
                  onCheckedChange={(checked) => {
                    const on = checked === true;
                    setCommercialOn(on);
                    if (!on) {
                      setBrandOrganic(false);
                      setBrandContent(false);
                    }
                  }}
                />
                <span>Divulgar conteúdo comercial</span>
              </Label>
              {commercialOn && (
                <div className="grid gap-3 rounded-md border border-dashed p-3">
                  <Label className="font-normal">
                    <Checkbox
                      checked={brandOrganic}
                      onCheckedChange={(checked) =>
                        setBrandOrganic(checked === true)
                      }
                    />
                    <span>Sua marca (você promove o seu próprio negócio)</span>
                  </Label>
                  <Label className="font-normal">
                    <Checkbox
                      checked={brandContent}
                      onCheckedChange={(checked) => {
                        const on = checked === true;
                        setBrandContent(on);
                        if (on && privacy === "SELF_ONLY") setPrivacy("");
                      }}
                    />
                    <span>
                      Conteúdo de marca (você promove outra marca ou terceiro)
                    </span>
                  </Label>
                  {!effOrganic && !effBrand && (
                    <Notice tone="warning">
                      Indique se o conteúdo promove a sua marca, uma marca de
                      terceiros ou ambos para poder agendar.
                    </Notice>
                  )}
                  {label && (
                    <Notice tone="info">
                      Sua publicação será rotulada como{" "}
                      <strong>
                        {label === "PROMOTIONAL"
                          ? "“Conteúdo promocional”"
                          : "“Parceria paga”"}
                      </strong>
                      .
                      {effBrand &&
                        " Conteúdo de marca não pode ser privado: a opção “Somente eu” foi desativada."}
                    </Notice>
                  )}
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={loadInfo.isPending}
                onClick={() => loadInfo.mutate()}
              >
                Atualizar opções
              </Button>
            </fieldset>
          </>
        )}

        {postType === "VIDEO" && (
          <Label className="font-normal">
            <Checkbox
              checked={musicRightsConfirmed}
              onCheckedChange={(checked) =>
                setMusicRightsConfirmed(checked === true)
              }
            />
            <span>
              Confirmo que tenho os direitos/consentimento necessários para o
              áudio usado ou que utilizarei áudio autorizado para esta
              publicação.
            </span>
          </Label>
        )}

        <Label className="font-normal">
          <Checkbox
            checked={confirmed}
            onCheckedChange={(checked) => setConfirmed(checked === true)}
          />
          <span>Revisei canal, mídia, legenda e horário desta publicação.</span>
        </Label>
        <p className="m-0 text-xs text-muted-foreground">
          {declarationKind(effBrand) === "BRANDED_AND_MUSIC" ? (
            <>
              Ao publicar, você concorda com a{" "}
              <a href={BRANDED_CONTENT_URL} target="_blank" rel="noreferrer">
                Política de Conteúdo de Marca
              </a>{" "}
              e com a{" "}
              <a href={MUSIC_USAGE_URL} target="_blank" rel="noreferrer">
                Confirmação de Uso de Música
              </a>{" "}
              do TikTok.
            </>
          ) : (
            <>
              Ao publicar, você concorda com a{" "}
              <a href={MUSIC_USAGE_URL} target="_blank" rel="noreferrer">
                Confirmação de Uso de Música
              </a>{" "}
              do TikTok.
            </>
          )}
        </p>

        {(localError || save.error) && (
          <ErrorBox error={localError ? new Error(localError) : save.error} />
        )}

        <div className="flex flex-wrap justify-end gap-2">
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
          <Button type="submit" disabled={save.isPending}>
            Agendar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
