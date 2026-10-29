import { useQuery } from "@tanstack/react-query";
import { useCurrentWorkspace } from "../auth/WorkspaceProvider";
import { Empty, ErrorBox, PageHeader } from "../components/ui";
import { unwrap } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useProfiles } from "../lib/hooks";
import { supabase } from "../lib/supabase";
import type { AuditLog } from "../lib/types";
import { Activity, ArrowRight, ScrollText, Trash2 } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { cn } from "@/lib/utils";
import Loading from "@/components/loading";

const ACTION: Record<string, string> = {
  INSERT: "Criou",
  UPDATE: "Alterou",
  DELETE: "Excluiu",
};
const ENTITY: Record<string, string> = {
  channels: "canal",
  media_assets: "vídeo",
  publication_jobs: "publicação",
  workspace_members: "membro",
  workspace_settings: "configurações",
};

export default function AuditPage() {
  const ws = useCurrentWorkspace();
  const logs = useQuery({
    queryKey: ["audit", ws.id],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("audit_logs")
          .select("*")
          .eq("workspace_id", ws.id)
          .order("created_at", { ascending: false })
          .limit(200),
      ) as unknown as AuditLog[],
  });
  const profiles = useProfiles(
    (logs.data ?? [])
      .map((l) => l.actor_user_id)
      .filter((x): x is string => Boolean(x)),
  );

  return (
    <>
      <PageHeader
        title="Auditoria"
        subtitle="Últimas 200 operações registradas neste workspace."
      />
      <ErrorBox error={logs.error} />
      {logs.isLoading ? (
        <Loading />
      ) : (logs.data ?? []).length === 0 ? (
        <Empty title="Nenhum registro" icon={ScrollText} />
      ) : (
        <div className="grid gap-3">
          {logs.data!.map((l) => {
            const changed = (l.metadata as { changed?: string[] }).changed;
            const isDelete =
              l.action === "DELETE" || l.action.endsWith("_deleted");
            const actor = l.actor_user_id
              ? (profiles.data?.[l.actor_user_id] ?? "Membro do workspace")
              : "Sistema";
            const entity =
              ENTITY[l.entity_type] ?? l.entity_type.replaceAll("_", " ");
            return (
              <Card size="sm" key={l.id}>
                <CardContent className="flex items-start gap-3">
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-lg",
                      isDelete
                        ? "bg-warning/10 text-warning"
                        : "bg-accent text-accent-foreground",
                    )}
                    aria-hidden="true"
                  >
                    {isDelete ? (
                      <Trash2 className="size-4" />
                    ) : (
                      <Activity className="size-4" />
                    )}
                  </span>
                  <div className="grid min-w-0 flex-1 gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="font-medium">
                        {ACTION[l.action] ?? l.action.replaceAll("_", " ")}
                      </strong>
                      <Badge
                        variant="outline"
                        className={
                          isDelete
                            ? "border-warning/30 bg-warning/10 text-warning"
                            : "border-border bg-secondary text-secondary-foreground"
                        }
                      >
                        {entity}
                      </Badge>
                    </div>
                    <p className="m-0 flex items-center gap-1.5 text-sm text-muted-foreground">
                      {actor}
                      <ArrowRight className="size-3.5" aria-hidden="true" />
                      {entity}
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <time dateTime={l.created_at}>
                        {formatDateTime(l.created_at)}
                      </time>
                      {changed?.length ? (
                        <span>Campos: {changed.join(", ")}</span>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
