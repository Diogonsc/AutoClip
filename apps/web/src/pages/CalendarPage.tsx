import { useMemo, useState } from "react";
import { useCurrentWorkspace, useWorkspace } from "../auth/WorkspaceProvider";
import JobDetail from "../components/JobDetail";
import PublicationForm from "../components/PublicationForm";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { ErrorBox, PageHeader, Toolbar, toneClasses } from "../components/ui";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { cn } from "@/lib/utils";
import { publicationTone } from "../lib/format";
import { useChannels, useJobsPage, useMedia } from "../lib/hooks";
import type { PublicationJob } from "../lib/types";
import { Button } from "../components/ui/button";
import Loading from "@/components/loading";

type View = "month" | "week" | "day";

const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function key(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CalendarPage() {
  const ws = useCurrentWorkspace();
  const { canEdit } = useWorkspace();
  const jobs = useJobsPage(ws.id, 0, 1000);
  const channels = useChannels(ws.id);
  const media = useMedia(ws.id);

  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [detail, setDetail] = useState<PublicationJob | null>(null);
  const [newAt, setNewAt] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const map = new Map<string, PublicationJob[]>();
    for (const j of jobs.data?.rows ?? []) {
      if (!j.scheduled_at || j.status === "CANCELLED") continue;
      const k = key(new Date(j.scheduled_at)); // exibido no fuso do navegador
      map.set(k, [...(map.get(k) ?? []), j]);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          new Date(a.scheduled_at!).getTime() -
          new Date(b.scheduled_at!).getTime(),
      );
    }
    return map;
  }, [jobs.data]);

  const { days, title, leading } = useMemo(() => {
    if (view === "day") {
      return {
        days: [cursor],
        leading: 0,
        title: cursor.toLocaleDateString("pt-BR", { dateStyle: "full" }),
      };
    }
    if (view === "week") {
      const start = addDays(cursor, -cursor.getDay());
      const ds = Array.from({ length: 7 }, (_, i) => addDays(start, i));
      return {
        days: ds,
        leading: 0,
        title: `${ds[0].toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${ds[6].toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}`,
      };
    }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const count = new Date(
      cursor.getFullYear(),
      cursor.getMonth() + 1,
      0,
    ).getDate();
    return {
      days: Array.from({ length: count }, (_, i) => addDays(first, i)),
      leading: first.getDay(),
      title: cursor.toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric",
      }),
    };
  }, [view, cursor]);

  function move(dir: -1 | 1) {
    if (view === "month")
      setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1));
    else setCursor(addDays(cursor, dir * (view === "week" ? 7 : 1)));
  }

  const todayKey = key(new Date());
  const channelOf = (id: string) => channels.data?.find((c) => c.id === id);
  const mediaOf = (id: string) => media.data?.find((m) => m.id === id);

  return (
    <>
      <PageHeader
        title="Calendário"
        subtitle="Horários exibidos no fuso do seu navegador."
        actions={
          <Tabs value={view} onValueChange={(v) => setView(v as View)}>
            <TabsList aria-label="Modo de visualização">
              <TabsTrigger value="month">Mês</TabsTrigger>
              <TabsTrigger value="week">Semana</TabsTrigger>
              <TabsTrigger value="day">Dia</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />
      <ErrorBox error={jobs.error} />

      <Toolbar>
        <Button
          variant="outline"
          size="icon"
          onClick={() => move(-1)}
          aria-label="Anterior"
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          onClick={() => setCursor(startOfDay(new Date()))}
        >
          Hoje
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => move(1)}
          aria-label="Próximo"
        >
          <ChevronRight />
        </Button>
        <strong className="ml-1 font-heading text-base capitalize">
          {title}
        </strong>
      </Toolbar>

      {jobs.isLoading ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto">
          <div
            className={cn(
              "grid gap-1.5",
              view === "day" ? "grid-cols-1" : "min-w-[42rem] grid-cols-7",
            )}
          >
            {view !== "day" &&
              DOW.map((d) => (
                <div
                  key={d}
                  className="px-1 pb-0.5 text-center text-xs font-medium text-muted-foreground"
                >
                  {d}
                </div>
              ))}
            {Array.from({ length: leading }, (_, i) => (
              <div key={`pad-${i}`} aria-hidden="true" />
            ))}
            {days.map((d) => {
              const k = key(d);
              const list = byDay.get(k) ?? [];
              const isToday = k === todayKey;
              return (
                <div
                  key={k}
                  className={cn(
                    "flex min-h-24 min-w-0 flex-col gap-1 rounded-lg border bg-card p-1.5",
                    view === "day" && "min-h-40",
                    isToday && "border-primary ring-1 ring-primary/40",
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={cn(
                        "grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs font-medium",
                        isToday
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {view === "day" ? "Hoje" : d.getDate()}
                    </span>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Agendar neste dia"
                        aria-label={`Agendar em ${d.toLocaleDateString("pt-BR")}`}
                        onClick={() => setNewAt(`${k}T12:00`)}
                      >
                        <Plus />
                      </Button>
                    )}
                  </div>
                  {list.map((j) => (
                    <Button
                      key={j.id}
                      variant="ghost"
                      size="xs"
                      className={cn(
                        "h-auto w-full justify-start overflow-hidden border px-1.5 py-1 text-left text-xs font-normal text-ellipsis",
                        toneClasses[publicationTone(j.status)],
                      )}
                      onClick={() => setDetail(j)}
                    >
                      <span className="truncate">
                        {new Date(j.scheduled_at!).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        {channelOf(j.channel_id)?.display_name ?? ""}
                      </span>
                    </Button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {detail && (
        <JobDetail
          job={detail}
          channel={channelOf(detail.channel_id)}
          media={mediaOf(detail.media_asset_id)}
          onClose={() => setDetail(null)}
        />
      )}
      {newAt && (
        <PublicationForm initialDate={newAt} onClose={() => setNewAt(null)} />
      )}
    </>
  );
}
