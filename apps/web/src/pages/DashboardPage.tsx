import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarClock, Activity } from "lucide-react";
import { useCurrentWorkspace } from "../auth/WorkspaceProvider";
import {
  Badge,
  Empty,
  ErrorBox,
  Notice,
  PageHeader,
  Spinner,
} from "../components/ui";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { unwrap } from "../lib/api";
import {
  BLOCKED_STATUSES,
  PROBLEM_CHANNEL_STATUSES,
  formatDateTime,
  publicationStatusLabel,
  publicationTone,
} from "../lib/format";
import { useChannels, useJobs, useSettings } from "../lib/hooks";
import { supabase } from "../lib/supabase";
import type { PublicationEvent } from "../lib/types";
import type { Tone } from "../lib/format";
import { cn } from "@/lib/utils";

const STAT_ACCENT: Record<Tone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-foreground",
  neutral: "text-foreground",
};

function Timeline({
  items,
}: {
  items: { id: string; time: string; content: React.ReactNode }[];
}) {
  return (
    <ul className="m-0 grid list-none gap-0 p-0">
      {items.map((item) => (
        <li
          key={item.id}
          className="grid gap-0.5 border-b py-2.5 last:border-b-0 last:pb-0 first:pt-0 sm:grid-cols-[11rem_1fr] sm:gap-3"
        >
          <time className="text-xs text-muted-foreground sm:pt-0.5">
            {item.time}
          </time>
          <span className="min-w-0 text-sm break-words">{item.content}</span>
        </li>
      ))}
    </ul>
  );
}

export default function DashboardPage() {
  const ws = useCurrentWorkspace();
  const channels = useChannels(ws.id);
  const jobs = useJobs(ws.id);
  const settings = useSettings(ws.id);
  const events = useQuery({
    queryKey: ["recent-events", ws.id],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("publication_events")
          .select("*")
          .eq("workspace_id", ws.id)
          .order("created_at", { ascending: false })
          .limit(8),
      ) as unknown as PublicationEvent[],
  });

  if (channels.isLoading || jobs.isLoading) return <Spinner />;

  const ch = channels.data ?? [];
  const jb = jobs.data ?? [];
  const connected = ch.filter((c) => c.connection_status === "CONNECTED").length;
  const problemChannels = ch.filter((c) =>
    PROBLEM_CHANNEL_STATUSES.includes(c.connection_status),
  );
  const scheduled = jb.filter(
    (j) => j.status === "SCHEDULED" || j.status === "READY",
  ).length;
  const published = jb.filter((j) => j.status === "PUBLISHED").length;
  const failed = jb.filter((j) => j.status === "FAILED").length;
  const blocked = jb.filter((j) => BLOCKED_STATUSES.includes(j.status)).length;
  const unknown = jb.filter((j) => j.status === "UNKNOWN").length;
  const now = Date.now();
  const upcoming = jb
    .filter(
      (j) =>
        (j.status === "SCHEDULED" || j.status === "READY") &&
        j.scheduled_at &&
        new Date(j.scheduled_at).getTime() >= now - 60_000,
    )
    .sort(
      (a, b) =>
        new Date(a.scheduled_at!).getTime() -
        new Date(b.scheduled_at!).getTime(),
    )
    .slice(0, 5);
  const channelName = (id: string) =>
    ch.find((c) => c.id === id)?.display_name ?? "—";

  const stats: { n: number; l: string; tone: Tone }[] = [
    { n: ch.length, l: "Canais cadastrados", tone: "neutral" },
    { n: connected, l: "Canais conectados", tone: "success" },
    {
      n: problemChannels.length,
      l: "Canais com problema",
      tone: problemChannels.length ? "warning" : "neutral",
    },
    { n: scheduled, l: "Agendadas", tone: "info" },
    { n: published, l: "Publicadas", tone: "success" },
    { n: failed, l: "Com falha", tone: failed ? "danger" : "neutral" },
    { n: blocked, l: "Bloqueadas", tone: blocked ? "warning" : "neutral" },
    {
      n: unknown,
      l: "Resultado desconhecido",
      tone: unknown ? "warning" : "neutral",
    },
  ];

  return (
    <>
      <PageHeader title="Painel" subtitle={ws.name} />
      <ErrorBox error={channels.error ?? jobs.error} />

      {settings.data && !settings.data.auto_publish_enabled && (
        <Notice tone="info">
          A publicação automática está <strong>desligada</strong> neste
          workspace: os agendamentos ficam salvos, mas nada é enviado ao
          TikTok. A ativação depende da integração oficial validada
          (Configurações).
        </Notice>
      )}
      {problemChannels.length > 0 && (
        <Notice tone="warning">
          {problemChannels.length} canal(is) precisam de atenção:{" "}
          {problemChannels.map((c) => c.display_name).join(", ")}.{" "}
          <Link to="/canais">Ver canais</Link>
        </Notice>
      )}
      {unknown > 0 && (
        <Notice tone="warning">
          {unknown} publicação(ões) com resultado desconhecido aguardam
          conferência. <Link to="/historico">Ver histórico</Link>
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.l} size="sm">
            <CardContent className="grid gap-1">
              <div
                className={cn(
                  "font-heading text-3xl font-semibold tabular-nums",
                  STAT_ACCENT[s.tone],
                )}
              >
                {s.n}
              </div>
              <div className="text-sm text-muted-foreground">{s.l}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="size-4 text-primary" aria-hidden="true" />
              Próximas publicações
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <Empty title="Nada agendado">
                Crie uma publicação em <Link to="/publicacoes">Publicações</Link>
                .
              </Empty>
            ) : (
              <Timeline
                items={upcoming.map((j) => ({
                  id: j.id,
                  time: formatDateTime(j.scheduled_at, j.timezone),
                  content: `${channelName(j.channel_id)} — ${
                    j.caption ? j.caption.slice(0, 50) : "sem legenda"
                  }`,
                }))}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4 text-primary" aria-hidden="true" />
              Atividade recente
            </CardTitle>
          </CardHeader>
          <CardContent>
            {events.isLoading ? (
              <Spinner />
            ) : (events.data ?? []).length === 0 ? (
              <Empty title="Sem atividade ainda" />
            ) : (
              <Timeline
                items={events.data!.map((ev) => {
                  const p = ev.event_payload as {
                    to?: keyof typeof publicationStatusLabel;
                  };
                  return {
                    id: ev.id,
                    time: formatDateTime(ev.created_at),
                    content:
                      ev.event_type === "STATUS_CHANGED" && p.to ? (
                        <Badge tone={publicationTone(p.to)}>
                          {publicationStatusLabel[p.to] ?? p.to}
                        </Badge>
                      ) : (
                        ev.event_type
                      ),
                  };
                })}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
