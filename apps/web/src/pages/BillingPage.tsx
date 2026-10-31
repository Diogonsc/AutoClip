import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspace, useWorkspace } from "../auth/WorkspaceProvider";
import { ErrorBox, Notice, PageHeader } from "../components/ui";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { toError, unwrap } from "../lib/api";
import { useBillingPlans, useSaasOverview } from "../lib/hooks";
import { supabase } from "../lib/supabase";
import Loading from "@/components/loading";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function BillingPage() {
  const ws = useCurrentWorkspace();
  const { canAdmin } = useWorkspace();
  const query = useQueryClient();
  const plans = useBillingPlans();
  const overview = useSaasOverview(ws.id);
  const change = useMutation({
    mutationFn: async (plan: string) => {
      const { error } = await supabase.rpc("change_workspace_plan", { p_workspace: ws.id, p_plan: plan });
      if (error) throw toError(error);
    },
    onSuccess: async () => {
      await query.invalidateQueries({ queryKey: ["saas-overview", ws.id] });
      await query.invalidateQueries({ queryKey: ["settings", ws.id] });
    },
  });
  const cancel = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("cancel_workspace_subscription", { p_workspace: ws.id });
      if (error) throw toError(error);
    },
    onSuccess: () => query.invalidateQueries({ queryKey: ["saas-overview", ws.id] }),
  });

  if (plans.isLoading || overview.isLoading) return <Loading />;
  return (
    <>
      <PageHeader title="Plano e consumo" subtitle="Limites aplicados por workspace; cobrança real ainda não está ativada." />
      <ErrorBox error={plans.error ?? overview.error ?? change.error ?? cancel.error} />
      {overview.data && (
        <Notice tone="info">
          Plano atual: <strong>{overview.data.plan_name}</strong>. {overview.data.consumed_publications} confirmadas e {overview.data.reserved_publications} reservadas de {overview.data.publication_limit} neste ciclo. Renovação em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(overview.data.period_ends_at))}.
        </Notice>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(plans.data ?? []).map((plan) => {
          const current = overview.data?.plan_id === plan.id;
          return (
            <Card key={plan.id} className={current ? "border-primary" : undefined}>
              <CardHeader>
                <CardTitle>{plan.display_name}{current ? " · atual" : ""}</CardTitle>
                <CardDescription>{money.format(plan.price_cents / 100)} / mês</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <span>{plan.max_connected_accounts} contas TikTok conectadas</span>
                <span>{plan.monthly_publication_limit.toLocaleString("pt-BR")} publicações por ciclo</span>
                {canAdmin && !current && <Button disabled={change.isPending} onClick={() => change.mutate(plan.id)}>Selecionar para teste</Button>}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {canAdmin && overview.data?.subscription_status !== "CANCELLED" && (
        <div className="mt-4"><Button variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate()}>Cancelar ao fim do ciclo</Button></div>
      )}
    </>
  );
}
