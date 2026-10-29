import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Clock3, FileVideo, ShieldCheck, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import Loading from '../components/loading';

type ApprovalData = { decision: string; expires_at: string; reviewer_name: string | null; reviewer_note: string | null; publication: { caption: string; scheduled_at: string | null; timezone: string; status: string; channel_name: string; media: { filename: string; mime_type: string; duration_seconds: number | null; width: number | null; height: number | null; preview_url: string | null } | null } };
export default function ClientApprovalPage() {
  const { token = '' } = useParams();
  const [data, setData] = useState<ApprovalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [note, setNote] = useState('');
  const [done, setDone] = useState('');
  useEffect(() => {
    let live = true;
    supabase.functions.invoke('client-approval', { body: { action: 'view', token } }).then(({ data: result, error: invokeError }) => {
      if (!live) return;
      if (invokeError || result?.error) setError(result?.message ?? 'Não foi possível abrir este link. Ele pode ter expirado.');
      else setData(result as ApprovalData);
    }).catch(() => { if (live) setError('Não foi possível carregar a publicação.'); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [token]);
  async function decide(decision: 'APPROVED' | 'REJECTED') {
    setBusy(true); setError('');
    const { data: result, error: invokeError } = await supabase.functions.invoke('client-approval', { body: { action: 'decide', token, decision, reviewer_name: reviewer, reviewer_note: note } });
    setBusy(false);
    if (invokeError || result?.error) { setError(result?.message ?? 'Não foi possível registrar sua resposta.'); return; }
    setDone(result?.message ?? 'Resposta registrada.');
    setData((old) => old ? { ...old, decision } : old);
  }
  if (loading) return <div className="grid min-h-screen place-items-center p-6"><Loading /></div>;
  return <main className="mx-auto grid min-h-screen max-w-3xl content-start gap-5 p-4 py-10 sm:p-8">
    <header className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground"><ShieldCheck /></span><div><h1 className="m-0 text-2xl font-semibold">Aprovação de publicação</h1><p className="m-0 text-sm text-muted-foreground">Prévia compartilhada pelo AutoClip</p></div></header>
    {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">{error}</div>}
    {done && <div role="status" className="rounded-lg border border-green-600/30 bg-green-600/5 p-4 text-sm">{done}</div>}
    {data && <>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileVideo className="size-5" />{data.publication.channel_name}</CardTitle></CardHeader><CardContent className="grid gap-4">
        {data.publication.media?.preview_url && (data.publication.media.mime_type.startsWith('video/') ? <video className="max-h-[480px] w-full rounded-lg bg-black" controls src={data.publication.media.preview_url} /> : <img className="max-h-[480px] w-full rounded-lg object-contain" src={data.publication.media.preview_url} alt="Prévia da mídia" />)}
        <div><p className="mb-1 text-sm text-muted-foreground">Arquivo</p><p className="m-0 font-medium">{data.publication.media?.filename ?? 'Mídia indisponível'}</p>{data.publication.media?.duration_seconds != null && <p className="m-0 text-sm text-muted-foreground">Duração: {Math.round(data.publication.media.duration_seconds)} s</p>}</div>
        <div><p className="mb-1 text-sm text-muted-foreground">Legenda</p><p className="m-0 whitespace-pre-wrap">{data.publication.caption || 'Sem legenda'}</p></div>
        {data.publication.scheduled_at && <p className="m-0 flex items-center gap-2 text-sm text-muted-foreground"><Clock3 className="size-4" />Agendado para {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short', timeZone: data.publication.timezone }).format(new Date(data.publication.scheduled_at))}</p>}
        <p className="m-0 text-xs text-muted-foreground">Link válido até {new Date(data.expires_at).toLocaleString('pt-BR')}.</p>
      </CardContent></Card>
      {data.decision !== 'PENDING' ? <div className="rounded-lg border p-4 text-sm">Este link já foi respondido: <strong>{data.decision === 'APPROVED' ? 'Aprovado' : data.decision === 'REJECTED' ? 'Alterações solicitadas' : data.decision}</strong>{data.reviewer_note && <p className="mb-0">Observação: {data.reviewer_note}</p>}</div> : !done && <Card><CardHeader><CardTitle>Registrar sua decisão</CardTitle></CardHeader><CardContent className="grid gap-4"><div className="grid gap-2"><Label htmlFor="reviewer">Seu nome (opcional)</Label><Input id="reviewer" value={reviewer} onChange={(e) => setReviewer(e.target.value)} maxLength={120} /></div><div className="grid gap-2"><Label htmlFor="note">Observações ou alterações solicitadas</Label><Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Descreva ajustes necessários, se houver." /></div><div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={() => void decide('APPROVED')}><CheckCircle2 className="mr-2 size-4" />Aprovar publicação</Button><Button variant="outline" disabled={busy || !note.trim()} onClick={() => void decide('REJECTED')}><XCircle className="mr-2 size-4" />Solicitar alterações</Button></div><p className="m-0 text-xs text-muted-foreground">Ao aprovar, você autoriza a equipe a seguir com o agendamento. A publicação não é enviada automaticamente por esta página.</p></CardContent></Card>}
    </>}
  </main>;
}
