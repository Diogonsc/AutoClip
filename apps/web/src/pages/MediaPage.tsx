import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspace, useWorkspace } from "../auth/WorkspaceProvider";
import { Library, Upload } from "lucide-react";
import { useConfirm } from "../components/confirm-provider";
import { SelectField } from "../components/select-field";
import {
  Badge,
  Empty,
  ErrorBox,
  Field,
  Modal,
  Notice,
  PageHeader,
  TableCard,
  Toolbar,
} from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { ApiError, toError, unwrap } from "../lib/api";
import {
  formatBytes,
  formatDateTime,
  formatDuration,
  mediaStatusLabel,
  mediaTone,
} from "../lib/format";
import { useMedia } from "../lib/hooks";
import { supabase } from "../lib/supabase";
import type { MediaAsset } from "../lib/types";
import Loading from "@/components/loading";

const ALL = "__all__";
const MAX_BYTES = 50 * 1024 * 1024; // limite do plano Free do Supabase
const EXT_BY_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
};

interface VideoMeta {
  duration: number;
  width: number;
  height: number;
}

function readImageMeta(file: File): Promise<VideoMeta | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file); const img = new Image();
    const finish = (r: VideoMeta | null) => { URL.revokeObjectURL(url); resolve(r); };
    const timer = window.setTimeout(() => finish(null), 8000);
    img.onload = () => { window.clearTimeout(timer); finish({ duration: 0, width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { window.clearTimeout(timer); finish(null); }; img.src = url;
  });
}

export default function MediaPage() {
  const ws = useCurrentWorkspace();
  const { canEdit, canAdmin } = useWorkspace();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const media = useMedia(ws.id);
  const fileInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [preview, setPreview] = useState<{
    asset: MediaAsset;
    url: string;
  } | null>(null);
  const [editing, setEditing] = useState<MediaAsset | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["media", ws.id] });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const ext = EXT_BY_MIME[file.type];
      if (!ext) throw new ApiError("Formato não suportado. Use MP4 H.264, JPEG, PNG ou WebP.");
      const isImage = file.type.startsWith("image/");
      if (isImage && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new ApiError("Fotos devem ser JPEG, PNG ou WebP.");
      if (file.size > (isImage ? 20 * 1024 * 1024 : MAX_BYTES))
        throw new ApiError(
          `Arquivo acima do limite permitido (${formatBytes(isImage ? 20 * 1024 * 1024 : MAX_BYTES)}).`,
        );

      if (isImage) {
        const meta = await readImageMeta(file);
        if (!meta || meta.width < 360 || meta.height < 360 || meta.width > 4096 || meta.height > 4096) throw new ApiError("A imagem precisa ter dimensões entre 360 e 4096 pixels por lado.");
      }
      const started = unwrap(await supabase.rpc("begin_media_upload", {
        p_workspace: ws.id,
        p_filename: file.name,
        p_mime: file.type,
        p_size: file.size,
      })) as { media_id: string; quarantine_key: string };
      const { media_id: id, quarantine_key: key } = started;
      let uploaded = false;
      try {
        const up = await supabase.storage
          .from("media-quarantine")
          .upload(key, file, { contentType: file.type, upsert: false });
        if (up.error) throw new ApiError(`Falha no envio: ${up.error.message}`);
        uploaded = true;
        const validation = await supabase.functions.invoke("media-validate", { body: { media_id: id } });
        if (validation.error) {
          const body = await validation.error.context?.json?.().catch(() => null);
          throw new ApiError(`O servidor não aceitou este arquivo${body?.error ? ` (${body.error})` : ""}.`);
        }
        if (validation.data?.status === "VALIDATING") {
          const deadline = Date.now() + 120_000;
          while (Date.now() < deadline) {
            await new Promise((resolve) => window.setTimeout(resolve, 1000));
            const row = await supabase.from("media_assets").select("status,validation_status,validation_error_code").eq("id", id).single();
            if (row.error) throw new ApiError("Não foi possível acompanhar a validação do vídeo.");
            if (row.data.status === "READY" && row.data.validation_status === "VALIDATED") break;
            if (row.data.status === "FAILED" || row.data.validation_status === "REJECTED") throw new ApiError(`O servidor rejeitou o vídeo${row.data.validation_error_code ? ` (${row.data.validation_error_code})` : ""}.`);
          }
          const check = await supabase.from("media_assets").select("status,validation_status").eq("id", id).single();
          if (check.data?.status !== "READY" || check.data?.validation_status !== "VALIDATED") {
            throw new ApiError("O vídeo continua em validação. Ele permanece privado e indisponível para agendamento; atualize a biblioteca em instantes.");
          }
        } else if (validation.data?.status !== "READY") throw new ApiError("O servidor não aprovou este arquivo para uso.");
      } catch (cause) {
        const reason =
          cause instanceof Error
            ? cause.message
            : "Falha ao finalizar o upload.";
        // Depois que o upload foi aceito, timeout/rede não pode apagar objeto
        // que o worker esteja validando. A fila é idempotente e com lease.
        if (!uploaded) {
          await supabase.storage.from("media-quarantine").remove([key]);
          await supabase.rpc("fail_media_upload", { p_media_id: id, p_code: "UPLOAD_OR_VALIDATION_FAILED" });
        }
        throw cause instanceof Error ? cause : new ApiError(reason);
      }
    },
    onSuccess: () => {
      setUploadError(null);
      return refresh();
    },
    onError: (e) => {
      setUploadError(e instanceof Error ? e.message : "Falha no upload.");
      void refresh();
    },
  });

  const update = useMutation({
    mutationFn: async (v: {
      id: string;
      original_filename: string;
      tags: string[];
      category: string | null;
    }) =>
      unwrap(
        await supabase
          .from("media_assets")
          .update({
            original_filename: v.original_filename,
            tags: v.tags,
            category: v.category,
          })
          .eq("id", v.id),
      ),
    onSuccess: () => {
      setEditing(null);
      return refresh();
    },
  });

  const remove = useMutation({
    mutationFn: async (a: MediaAsset) => {
      // A FK impede excluir mídia ainda usada por publicações, antes de apagar o objeto do Storage.
      unwrap(await supabase.from("media_assets").delete().eq("id", a.id));
      if (a.status !== "READY") return;
      const rm = await supabase.storage.from("media").remove([a.storage_key]);
      if (rm.error) {
        throw toError({
          message: `O registro foi removido, mas o objeto pode permanecer órfão e requer limpeza administrativa: ${rm.error.message}`,
        });
      }
    },
    onSuccess: refresh,
  });

  async function openPreview(asset: MediaAsset) {
    const { data, error } = await supabase.storage
      .from("media")
      .createSignedUrl(asset.storage_key, 3600);
    if (error || !data) {
      setUploadError("Não foi possível gerar o link de visualização.");
      return;
    }
    setPreview({ asset, url: data.signedUrl });
  }

  const all = media.data ?? [];
  const storedBytes = all
    .filter((asset) => asset.status !== "DELETED")
    .reduce((total, asset) => total + asset.file_size_bytes, 0);
  const deletedCount = all.filter((asset) => asset.status === "DELETED").length;
  const allTags = [...new Set(all.flatMap((m) => m.tags))].sort();
  const visible = all.filter(
    (m) =>
      m.original_filename.toLowerCase().includes(search.toLowerCase()) &&
      (!tagFilter || m.tags.includes(tagFilter)),
  );

  return (
    <>
      <PageHeader
        title="Biblioteca de mídia"
        subtitle="Arquivos privados do workspace."
        actions={
          canEdit && (
            <>
              <input
                ref={fileInput}
                type="file"
                accept="video/mp4,image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) upload.mutate(f);
                }}
              />
              <Button
                disabled={upload.isPending}
                onClick={() => fileInput.current?.click()}
              >
                <Upload aria-hidden="true" />
                {upload.isPending ? "Enviando…" : "Enviar mídia"}
              </Button>
            </>
          )
        }
      />

      <Notice tone="neutral">
        Imagens JPEG, PNG e WebP (até 20 MB) e vídeos MP4 H.264 (até 50 MB) passam por validação binária no servidor antes do agendamento. MOV, WebM e outros codecs não são aceitos nesta versão.
      </Notice>
      <Notice tone="info">
        Armazenamento atual: <strong>{formatBytes(storedBytes)}</strong>. {deletedCount > 0 ? `${deletedCount} arquivo(s) foram removidos do Storage e permanecem no histórico.` : "Arquivos removidos automaticamente continuam visíveis no histórico."}
      </Notice>
      <ErrorBox error={uploadError} />
      <ErrorBox error={media.error ?? remove.error} />

      <Toolbar>
        <Input
          placeholder="Buscar por nome…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar"
          className="w-full sm:w-72"
        />
        <SelectField
          aria-label="Filtrar por tag"
          className="w-full sm:w-48"
          value={tagFilter || ALL}
          onValueChange={(v) => setTagFilter(v === ALL ? "" : v)}
          options={[
            { value: ALL, label: "Todas as tags" },
            ...allTags.map((t) => ({ value: t, label: t })),
          ]}
        />
      </Toolbar>

      {media.isLoading ? (
        <Loading />
      ) : visible.length === 0 ? (
        <Empty
          title={all.length === 0 ? "Biblioteca vazia" : "Nenhum resultado"}
          icon={Library}
        >
          {all.length === 0 && canEdit ? "Envie o primeiro vídeo." : undefined}
        </Empty>
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Arquivo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Duração</TableHead>
                <TableHead>Resolução</TableHead>
                <TableHead>Tamanho</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Enviado em</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">
                    {m.original_filename}
                    {m.category && (
                      <div className="text-xs font-normal text-muted-foreground">
                        {m.category}
                      </div>
                    )}
                    {m.status === "DELETED" && (
                      <div className="text-xs font-normal text-muted-foreground">
                        Removido {formatDateTime(m.storage_deleted_at)}{m.storage_deletion_reason ? ` · ${m.storage_deletion_reason}` : ""}
                      </div>
                    )}
                    {m.cleanup_locked_at && m.status === "READY" && (
                      <div className="text-xs font-normal text-warning">Em revisão para retenção; novos agendamentos são bloqueados temporariamente.</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge tone={mediaTone(m.status)}>
                      {mediaStatusLabel[m.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>{m.mime_type.startsWith("image/") ? "Foto" : formatDuration(m.duration_seconds)}</TableCell>
                  <TableCell>
                    {m.width && m.height ? `${m.width}×${m.height}` : "—"}
                  </TableCell>
                  <TableCell>{formatBytes(m.file_size_bytes)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {m.tags.map((t) => (
                        <Badge key={t} tone="neutral">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(m.created_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {m.status === "READY" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void openPreview(m)}
                        >
                          Ver
                        </Button>
                      )}
                      {canEdit && m.status !== "DELETED" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditing(m)}
                        >
                          Editar
                        </Button>
                      )}
                      {m.status !== "DELETED" && (canAdmin || (canEdit && m.status !== "READY")) && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={async () => {
                            if (
                              await confirm({
                                title: `Excluir "${m.original_filename}"?`,
                                description:
                                  "O vídeo será removido da biblioteca e do armazenamento.",
                                confirmLabel: "Excluir",
                                destructive: true,
                              })
                            )
                              remove.mutate(m);
                          }}
                        >
                          Excluir
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}

      {preview && (
        <Modal
          title={preview.asset.original_filename}
          onClose={() => setPreview(null)}
          wide
        >
          {preview.asset.mime_type.startsWith("image/") ? <img className="max-h-[70vh] w-full rounded-lg object-contain" src={preview.url} alt={preview.asset.original_filename} /> : <video className="max-h-[70vh] w-full rounded-lg bg-black" src={preview.url} controls autoPlay />}
        </Modal>
      )}

      {editing && (
        <EditMedia
          asset={editing}
          busy={update.isPending}
          error={update.error}
          onClose={() => setEditing(null)}
          onSave={(v) => update.mutate({ id: editing.id, ...v })}
        />
      )}
    </>
  );
}

function EditMedia({
  asset,
  busy,
  error,
  onClose,
  onSave,
}: {
  asset: MediaAsset;
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (v: {
    original_filename: string;
    tags: string[];
    category: string | null;
  }) => void;
}) {
  const [filename, setFilename] = useState(asset.original_filename);
  const [tags, setTags] = useState(asset.tags.join(", "));
  const [category, setCategory] = useState(asset.category ?? "");

  return (
    <Modal title="Editar vídeo" onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            original_filename: filename.trim() || asset.original_filename,
            tags: [
              ...new Set(
                tags
                  .split(",")
                  .map((t) => t.trim().toLowerCase())
                  .filter(Boolean),
              ),
            ],
            category: category.trim() || null,
          });
        }}
      >
        <Field label="Nome">
          <Input
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            required
          />
        </Field>
        <Field label="Categoria">
          <Input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </Field>
        <Field label="Tags" hint="Separadas por vírgula.">
          <Input value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy}>
            Salvar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
