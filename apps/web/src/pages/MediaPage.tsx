import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { useCurrentWorkspace, useWorkspace } from '../auth/WorkspaceProvider';
import { Badge, Empty, ErrorBox, Field, Modal, Notice, PageHeader, Spinner } from '../components/ui';
import { ApiError, toError, unwrap } from '../lib/api';
import { formatBytes, formatDateTime, formatDuration, mediaStatusLabel, mediaTone } from '../lib/format';
import { useMedia } from '../lib/hooks';
import { supabase } from '../lib/supabase';
import type { MediaAsset } from '../lib/types';

const MAX_BYTES = 50 * 1024 * 1024; // limite do plano Free do Supabase
const EXT_BY_MIME: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

interface VideoMeta {
  duration: number;
  width: number;
  height: number;
}

function readVideoMeta(file: File): Promise<VideoMeta | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const finish = (r: VideoMeta | null) => {
      URL.revokeObjectURL(url);
      resolve(r);
    };
    const timer = window.setTimeout(() => finish(null), 8000);
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      finish({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      finish(null);
    };
    video.src = url;
  });
}

export default function MediaPage() {
  const ws = useCurrentWorkspace();
  const { user } = useAuth();
  const { canEdit, canAdmin } = useWorkspace();
  const qc = useQueryClient();
  const media = useMedia(ws.id);
  const fileInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [preview, setPreview] = useState<{ asset: MediaAsset; url: string } | null>(null);
  const [editing, setEditing] = useState<MediaAsset | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['media', ws.id] });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const ext = EXT_BY_MIME[file.type];
      if (!ext) throw new ApiError('Formato não suportado. Use MP4, MOV ou WebM.');
      if (file.size > MAX_BYTES) throw new ApiError(`Arquivo acima de ${formatBytes(MAX_BYTES)} (limite do plano atual).`);

      const id = crypto.randomUUID();
      const key = `${ws.id}/${id}/original.${ext}`;
      const meta = await readVideoMeta(file);

      unwrap(
        await supabase.from('media_assets').insert({
          id,
          workspace_id: ws.id,
          original_filename: file.name,
          storage_key: key,
          mime_type: file.type,
          file_size_bytes: file.size,
          created_by: user!.id,
        }),
      );

      const up = await supabase.storage.from('media').upload(key, file, { contentType: file.type, upsert: false });
      if (up.error) {
        await supabase.from('media_assets').delete().eq('id', id);
        throw toError({ message: `Falha no envio: ${up.error.message}` });
      }

      const fin = await supabase.rpc('finalize_media', {
        p_media_id: id,
        p_duration: meta?.duration ?? null,
        p_width: meta?.width ?? null,
        p_height: meta?.height ?? null,
      });
      if (fin.error) throw toError(fin.error);
      const result = fin.data as unknown as MediaAsset;
      if (result.status !== 'READY') throw new ApiError('O arquivo não foi encontrado no armazenamento após o envio.');
    },
    onSuccess: () => {
      setUploadError(null);
      return refresh();
    },
    onError: (e) => {
      setUploadError(e instanceof Error ? e.message : 'Falha no upload.');
      void refresh();
    },
  });

  const update = useMutation({
    mutationFn: async (v: { id: string; original_filename: string; tags: string[]; category: string | null }) =>
      unwrap(
        await supabase
          .from('media_assets')
          .update({ original_filename: v.original_filename, tags: v.tags, category: v.category })
          .eq('id', v.id),
      ),
    onSuccess: () => {
      setEditing(null);
      return refresh();
    },
  });

  const remove = useMutation({
    mutationFn: async (a: MediaAsset) => {
      // Apaga o registro primeiro: se houver publicações vinculadas, a FK bloqueia e o arquivo permanece intacto.
      unwrap(await supabase.from('media_assets').delete().eq('id', a.id));
      const rm = await supabase.storage.from('media').remove([a.storage_key]);
      if (rm.error) throw toError({ message: `Registro excluído, mas o arquivo não foi removido: ${rm.error.message}` });
    },
    onSuccess: refresh,
  });

  async function openPreview(asset: MediaAsset) {
    const { data, error } = await supabase.storage.from('media').createSignedUrl(asset.storage_key, 3600);
    if (error || !data) {
      setUploadError('Não foi possível gerar o link de visualização.');
      return;
    }
    setPreview({ asset, url: data.signedUrl });
  }

  const all = media.data ?? [];
  const allTags = [...new Set(all.flatMap((m) => m.tags))].sort();
  const visible = all.filter(
    (m) =>
      m.original_filename.toLowerCase().includes(search.toLowerCase()) && (!tagFilter || m.tags.includes(tagFilter)),
  );

  return (
    <>
      <PageHeader
        title="Biblioteca de vídeos"
        subtitle="Arquivos privados do workspace."
        actions={
          canEdit && (
            <>
              <input
                ref={fileInput}
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) upload.mutate(f);
                }}
              />
              <button className="btn primary" disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
                {upload.isPending ? 'Enviando…' : 'Enviar vídeo'}
              </button>
            </>
          )
        }
      />

      <Notice tone="neutral">Formatos: MP4, MOV e WebM, até {formatBytes(MAX_BYTES)} por arquivo.</Notice>
      {uploadError && <div className="alert danger">{uploadError}</div>}
      <ErrorBox error={media.error ?? remove.error} />

      <div className="toolbar">
        <input placeholder="Buscar por nome…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar" />
        <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} aria-label="Filtrar por tag">
          <option value="">Todas as tags</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {media.isLoading ? (
        <Spinner />
      ) : visible.length === 0 ? (
        <Empty title={all.length === 0 ? 'Biblioteca vazia' : 'Nenhum resultado'}>
          {all.length === 0 && canEdit ? 'Envie o primeiro vídeo.' : undefined}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Arquivo</th>
                <th>Estado</th>
                <th>Duração</th>
                <th>Resolução</th>
                <th>Tamanho</th>
                <th>Tags</th>
                <th>Enviado em</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.original_filename}
                    {m.category && <div className="muted">{m.category}</div>}
                  </td>
                  <td>
                    <Badge tone={mediaTone(m.status)}>{mediaStatusLabel[m.status]}</Badge>
                  </td>
                  <td>{formatDuration(m.duration_seconds)}</td>
                  <td>{m.width && m.height ? `${m.width}×${m.height}` : '—'}</td>
                  <td>{formatBytes(m.file_size_bytes)}</td>
                  <td>{m.tags.map((t) => <Badge key={t} tone="neutral">{t}</Badge>)}</td>
                  <td className="muted">{formatDateTime(m.created_at)}</td>
                  <td className="row-actions">
                    {m.status === 'READY' && (
                      <button className="btn small" onClick={() => void openPreview(m)}>
                        Ver
                      </button>
                    )}{' '}
                    {canEdit && (
                      <button className="btn small" onClick={() => setEditing(m)}>
                        Editar
                      </button>
                    )}{' '}
                    {(canAdmin || (canEdit && m.status !== 'READY')) && (
                      <button
                        className="btn small danger"
                        onClick={() => {
                          if (window.confirm(`Excluir "${m.original_filename}"?`)) remove.mutate(m);
                        }}
                      >
                        Excluir
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview && (
        <Modal title={preview.asset.original_filename} onClose={() => setPreview(null)} wide>
          <video className="preview" src={preview.url} controls autoPlay />
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
  onSave: (v: { original_filename: string; tags: string[]; category: string | null }) => void;
}) {
  const [filename, setFilename] = useState(asset.original_filename);
  const [tags, setTags] = useState(asset.tags.join(', '));
  const [category, setCategory] = useState(asset.category ?? '');

  return (
    <Modal title="Editar vídeo" onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            original_filename: filename.trim() || asset.original_filename,
            tags: [...new Set(tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))],
            category: category.trim() || null,
          });
        }}
      >
        <Field label="Nome">
          <input value={filename} onChange={(e) => setFilename(e.target.value)} required />
        </Field>
        <Field label="Categoria">
          <input value={category} onChange={(e) => setCategory(e.target.value)} />
        </Field>
        <Field label="Tags" hint="Separadas por vírgula.">
          <input value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
        <div className="actions end">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={busy}>
            Salvar
          </button>
        </div>
      </form>
    </Modal>
  );
}
