import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspace } from "../auth/WorkspaceProvider";
import { Empty, ErrorBox, PageHeader } from "../components/ui";
import { unwrap } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { supabase } from "../lib/supabase";
import type { AppNotification } from "../lib/types";
import { Bell, Check } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { cn } from "@/lib/utils";
import Loading from "@/components/loading";

export default function NotificationsPage() {
  const ws = useCurrentWorkspace();
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["notifications", ws.id],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("notifications")
          .select("*")
          .eq("workspace_id", ws.id)
          .order("created_at", { ascending: false })
          .limit(100),
      ) as unknown as AppNotification[],
  });

  const markRead = useMutation({
    mutationFn: async (id: string | null) => {
      const q = supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("workspace_id", ws.id)
        .is("read_at", null);
      return unwrap(await (id ? q.eq("id", id) : q));
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["notifications", ws.id] }),
  });

  const unread = (list.data ?? []).filter((n) => !n.read_at).length;

  return (
    <>
      <PageHeader
        title="Notificações"
        subtitle={unread > 0 ? `${unread} não lida(s)` : "Tudo em dia"}
        actions={
          unread > 0 && (
            <Button
              variant="outline"
              disabled={markRead.isPending}
              onClick={() => markRead.mutate(null)}
            >
              <Check aria-hidden="true" />
              Marcar todas como lidas
            </Button>
          )
        }
      />
      <ErrorBox error={list.error ?? markRead.error} />

      {list.isLoading ? (
        <Loading />
      ) : (list.data ?? []).length === 0 ? (
        <Empty title="Sem notificações" icon={Bell} />
      ) : (
        <div className="grid gap-3">
          {list.data!.map((n) => (
            <Card
              key={n.id}
              size="sm"
              className={cn(n.read_at && "opacity-70")}
            >
              <CardContent className="flex items-start gap-3">
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-lg",
                    n.read_at
                      ? "bg-muted text-muted-foreground"
                      : "bg-accent text-accent-foreground",
                  )}
                  aria-hidden="true"
                >
                  <Bell className="size-4" />
                </span>
                <div className="grid min-w-0 flex-1 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="font-medium">{n.title}</strong>
                    {!n.read_at ? <Badge>Nova</Badge> : null}
                  </div>
                  {n.body && (
                    <p className="m-0 text-sm text-muted-foreground">
                      {n.body}
                    </p>
                  )}
                  <time
                    className="text-xs text-muted-foreground"
                    dateTime={n.created_at}
                  >
                    {formatDateTime(n.created_at)}
                  </time>
                </div>
                {!n.read_at && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={markRead.isPending}
                    onClick={() => markRead.mutate(n.id)}
                  >
                    <Check aria-hidden="true" />
                    Marcar como lida
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
