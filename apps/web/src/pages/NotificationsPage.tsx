import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspace } from "../auth/WorkspaceProvider";
import { Empty, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { unwrap } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { supabase } from "../lib/supabase";
import type { AppNotification } from "../lib/types";
import { Bell, Check } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";

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
        <Spinner />
      ) : (list.data ?? []).length === 0 ? (
        <Empty title="Sem notificações" />
      ) : (
        <div className="grid">
          {list.data!.map((n) => (
            <article
              key={n.id}
              className={`card notification-card${n.read_at ? " is-read" : ""}`}
            >
              <span className="notification-icon" aria-hidden="true">
                <Bell />
              </span>
              <div className="notification-content">
                <div className="notification-heading">
                  <strong>{n.title}</strong>
                  {!n.read_at ? <Badge>Nova</Badge> : null}
                </div>
                {n.body && <p>{n.body}</p>}
                <time dateTime={n.created_at}>
                  {formatDateTime(n.created_at)}
                </time>
              </div>
              {!n.read_at && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => markRead.mutate(n.id)}
                >
                  <Check aria-hidden="true" />
                  Marcar como lida
                </Button>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
