import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { useCurrentWorkspace } from "../auth/WorkspaceProvider";
import { ApiError, invokeFunction, unwrap } from "../lib/api";
import { buildDefaultCaption } from "../lib/channelDefaults";
import { channelStatusLabel } from "../lib/format";
import {
  useChannels,
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
  const [commercialOn, setCommercialOn] = useState(
    Boolean(job?.brand_content || job?.brand_organic),
  );
  const [freshInfo, setFreshInfo] = useState<CreatorInfo | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const flags = usePlatformFlags();

  const readyMedia = (media.data ?? []).filter((m) => m.status === "READY");
  const selectedChannel = (channels.data ?? []).find((c) => c.id === channelId);
  const selectedMedia = readyMedia.find((m) => m.id === mediaId);

  const direct = settings.data?.publish_mode === "DIRECT";
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
        allow_comment: direct ? effComment : null,
        allow_duet: direct ? effDuet : null,
        allow_stitch: direct ? effStitch : null,
        brand_content: direct ? effBrand : false,
        brand_organic: direct ? effOrganic : false,
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
    const problem = validateCompliance({
      direct,
      scheduling: status === "SCHEDULED",
      info,
      privacy,
      commercialOn,
      organic: brandOrganic,
      brand: brandContent,
      durationSeconds: selectedMedia?.duration_seconds ?? null,
      consent: confirmed,
    });
    if (problem) return setLocalError(problem);
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
          <Field
            label="Vídeo"
            hint="Somente vídeos prontos aparecem aqui. O vídeo precisa respeitar a duração máxima da sua conta no TikTok."
          >
            <SelectField
              value={mediaId}
              onValueChange={setMediaId}
              options={readyMedia.map((m) => ({
                value: m.id,
                label: m.original_filename,
              }))}
            />
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

        {mediaDurationIssue && <Notice tone="danger">{mediaDurationIssue}</Notice>}

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
            {flags.data && !flags.data.tiktok_audited && (
              <Notice tone="warning">
                Aplicativo em modo de teste no TikTok: independentemente da
                opção escolhida, a publicação direta ficará visível apenas para
                você até a aprovação.
              </Notice>
            )}
            <Field label="Quem pode ver" hint="Sem valor padrão: escolha conscientemente.">
              <SelectField
                value={privacy}
                onValueChange={setPrivacy}
                options={privacyOptionsFor(info, effBrand).map((o) => ({
                  value: o,
                  label: PRIVACY_LABEL[o] ?? o,
                }))}
              />
            </Field>
            <Label className="font-normal">
              <Checkbox
                checked={allowComment}
                disabled={info.comment_disabled}
                onCheckedChange={(checked) => setAllowComment(checked === true)}
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
                onCheckedChange={(checked) => setAllowStitch(checked === true)}
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
                  <span>Conteúdo de marca (você promove outra marca ou terceiro)</span>
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
        )}

        <PublicationPreview
          nickname={info?.creator_nickname}
          username={info?.creator_username}
          caption={caption}
          mediaName={selectedMedia?.original_filename}
          mediaDuration={selectedMedia?.duration_seconds}
          storageKey={selectedMedia?.storage_key}
          privacyText={
            direct && privacy ? (PRIVACY_LABEL[privacy] ?? privacy) : undefined
          }
          interactions={
            direct
              ? [
                  effComment && "comentários",
                  effDuet && "dueto",
                  effStitch && "stitch",
                ].filter((x): x is string => Boolean(x))
              : []
          }
          whenText={when ? `${when.replace("T", " ")} (${tz})` : undefined}
          label={label}
        />

        <Notice tone="info">
          Depois do envio, o TikTok pode levar alguns minutos para processar o
          vídeo e exibi-lo no perfil. Legenda e hashtags continuam editáveis por
          você antes de agendar.
        </Notice>

        <Label className="font-normal">
          <Checkbox
            checked={confirmed}
            onCheckedChange={(checked) => setConfirmed(checked === true)}
          />
          <span>
            Revisei a prévia e autorizo o AutoClip a enviar este conteúdo ao
            TikTok em meu nome.
          </span>
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
