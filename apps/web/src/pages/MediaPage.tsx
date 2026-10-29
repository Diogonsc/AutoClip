import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
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
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
};

interface VideoMeta {
  duration: number;
  width: number;
  height: number;
}

function readVideoMeta(file: File): Promise<VideoMeta | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const finish = (r: VideoMeta | null) => {
      URL.revokeObjectURL(url);
      resolve(r);
    };
    const timer = window.setTimeout(() => finish(null), 8000);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      finish({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      });
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      finish(null);
    };
    video.src = url;
  });
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
  const { user } = useAuth();
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
      if (!ext) throw new ApiError("Formato não suportado. Use MP4, MOV, WebM, JPEG, PNG ou WebP.");
      const isImage = file.type.startsWith("image/");
      if (isImage && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new ApiError("Fotos devem ser JPEG, PNG ou WebP.");
      if (file.size > (isImage ? 20 * 1024 * 1024 : MAX_BYTES))
        throw new ApiError(
          `Arquivo acima do limite permitido (${formatBytes(isImage ? 20 * 1024 * 1024 : MAX_BYTES)}).`,
        );

      const id = crypto.randomUUID();
      const key = `${ws.id}/${id}/original.${ext}`;
      const meta = isImage ? await readImageMeta(file) : await readVideoMeta(file);
      if (isImage && (!meta || meta.width < 360 || meta.height < 360 || meta.width > 4096 || meta.height > 4096)) throw new ApiError("A imagem precisa ter dimensões entre 360 e 4096 pixels por lado.");

      unwrap(
        await supabase.from("media_assets").insert({
          id,
          workspace_id: ws.id,
          original_filename: file.name,
          storage_key: key,
          mime_type: file.type,
          file_size_bytes: file.size,
          created_by: user!.id,
        }),
      );

      try {
        const up = await supabase.storage
          .from("media")
          .upload(key, file, { contentType: file.type, upsert: false });
        if (up.error) throw new ApiError(`Falha no envio: ${up.error.message}`);

        const fin = await supabase.rpc("finalize_media", {
          p_media_id: id,
          p_duration: meta?.duration ?? null,
          p_width: meta?.width ?? null,
          p_height: meta?.height ?? null,
        });
        if (fin.error) throw toError(fin.error);
        const result = fin.data as unknown as MediaAsset;
        if (result.status !== "READY")
          throw new ApiError(
            "O arquivo não foi encontrado no armazenamento após o envio.",
          );
      } catch (cause) {
        const reason =
          cause instanceof Error
            ? cause.message
            : "Falha ao finalizar o upload.";
        const removed = await supabase.storage.from("media").remove([key]);
        if (removed.error) {
          throw new ApiError(
            `${reason} O arquivo pode ter ficado no armazenamento; o registro foi mantido para permitir a limpeza: ${removed.error.message}`,
          );
        }
        const deleted = await supabase
          .from("media_assets")
          .delete()
          .eq("id", id);
        if (deleted.error) {
          throw new ApiError(
            `${reason} O objeto foi removido, mas não foi possível limpar o registro: ${deleted.error.message}`,
          );
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
      const rm = await supabase.storage.from("media").remove([a.storage_key]);
      if (rm.error) {
        const restored = await supabase.from("media_assets").insert({
          id: a.id,
          workspace_id: a.workspace_id,
          original_filename: a.original_filename,
          storage_key: a.storage_key,
          mime_type: a.mime_type,
          file_size_bytes: a.file_size_bytes,
          tags: a.tags,
          category: a.category,
          created_by: user!.id,
        });
        if (restored.error) {
          throw toError({
            message: `Não foi possível remover o arquivo nem restaurar o registro: ${rm.error.message}; ${restored.error.message}`,
          });
        }
        const finalized = await supabase.rpc("finalize_media", {
          p_media_id: a.id,
          p_duration: a.duration_seconds,
          p_width: a.width,
          p_height: a.height,
        });
        if (finalized.error) {
          throw toError({
            message: `O arquivo não foi removido e o registro restaurado precisa ser finalizado: ${rm.error.message}; ${finalized.error.message}`,
          });
        }
        throw toError({
          message: `Não foi possível remover o arquivo. O registro foi restaurado para permitir nova tentativa: ${rm.error.message}`,
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
                accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp"
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
        Vídeos MP4, MOV e WebM; fotos JPEG, PNG e WebP. Até {formatBytes(MAX_BYTES)} por arquivo. Para carrossel, selecione imagens ao criar a publicação.
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
                      {canEdit && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditing(m)}
                        >
                          Editar
                        </Button>
                      )}
                      {(canAdmin || (canEdit && m.status !== "READY")) && (
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
