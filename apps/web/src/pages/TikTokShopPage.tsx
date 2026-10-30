import { useMemo, useState } from "react";
import { Link2, RefreshCw, ShoppingBag, WalletCards } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspace, useWorkspace } from "../auth/WorkspaceProvider";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge, Empty, ErrorBox, Notice, PageHeader } from "../components/ui";
import { invokeFunction } from "../lib/api";
import { supabase } from "../lib/supabase";
import { useChannels, useTikTokShopConnections, useTikTokShopOrders, useTikTokShopProducts } from "../lib/hooks";
import type { TikTokShopConnection } from "../lib/types";
import Loading from "../components/loading";

const statusTone = (status: TikTokShopConnection["connection_status"]) =>
  status === "CONNECTED" ? "success" : status === "ERROR" || status === "REVOKED" ? "danger" : "warning" as const;

export default function TikTokShopPage() {
  const ws = useCurrentWorkspace();
  const { canEdit } = useWorkspace();
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const channels = useChannels(ws.id);
  const connections = useTikTokShopConnections(ws.id);
  const products = useTikTokShopProducts(ws.id);
  const orders = useTikTokShopOrders(ws.id);
  const connected = connections.data?.filter((c) => c.connection_status === "CONNECTED") ?? [];
  const stats = useMemo(() => ({
    products: products.data?.length ?? 0,
    orders: orders.data?.length ?? 0,
    commission: (orders.data ?? []).filter((o) => ["PAID", "COMPLETED"].includes(o.status)).reduce((sum, o) => sum + Number(o.commission_amount ?? 0), 0),
  }), [orders.data, products.data]);

  const startConnection = useMutation({
    mutationFn: async (channelId: string) => {
      return invokeFunction<{ url: string }>(supabase, "tiktok-shop", { action: "authorize", channel_id: channelId });
    },
    onSuccess: async ({ url }) => {
      await qc.invalidateQueries({ queryKey: ["shop-connections", ws.id] });
      window.location.assign(url);
    },
  });
  const sync = useMutation({
    mutationFn: async (connectionId: string) => invokeFunction<{ message?: string }>(supabase, "tiktok-shop", { action: "sync", connection_id: connectionId }),
    onSuccess: async (r) => {
      setMessage(r.message ?? "Sincronização iniciada.");
      await Promise.all(["shop-products", "shop-orders", "shop-connections"].map((key) => qc.invalidateQueries({ queryKey: [key, ws.id] })));
    },
  });
  const channelName = (id: string) => channels.data?.find((c) => c.id === id)?.display_name ?? "Canal";

  if (channels.isLoading || connections.isLoading || products.isLoading || orders.isLoading) return <Loading />;
  return <div className="grid gap-5">
    <PageHeader title="TikTok Shop e Afiliados" subtitle="Gerencie produtos afiliados, acompanhe conversões e associe o catálogo ao seu conteúdo." />
    <ErrorBox error={channels.error ?? connections.error ?? products.error ?? orders.error ?? startConnection.error ?? sync.error} />
    {message && <Notice tone="info">{message}</Notice>}
    <Notice tone="warning"><strong>Ativação necessária.</strong> A Affiliate API precisa estar aprovada no TikTok Shop Partner Center. O AutoClip não publica nem cria links de afiliado até que a conexão esteja autorizada.</Notice>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric icon={Link2} label="Canais Shop conectados" value={connected.length} />
      <Metric icon={ShoppingBag} label="Produtos no catálogo" value={stats.products} />
      <Metric icon={WalletCards} label="Pedidos rastreados" value={stats.orders} />
      <Metric icon={WalletCards} label="Comissão confirmada" value={stats.commission.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} />
    </div>

    <Card><CardHeader><CardTitle>Conexões por canal</CardTitle></CardHeader><CardContent className="grid gap-3">
      {(connections.data ?? []).map((connection) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3" key={connection.id}>
        <div><strong>{channelName(connection.channel_id)}</strong><p className="m-0 text-sm text-muted-foreground">{connection.shop_name ?? "Nenhuma loja autorizada ainda"}</p></div>
        <div className="flex items-center gap-2"><Badge tone={statusTone(connection.connection_status)}>{connection.connection_status}</Badge>{connection.connection_status === "CONNECTED" && canEdit && <Button variant="outline" size="sm" disabled={sync.isPending} onClick={() => sync.mutate(connection.id)}><RefreshCw className="mr-2 size-4" />Sincronizar</Button>}</div>
      </div>)}
      {(channels.data ?? []).filter((channel) => !(connections.data ?? []).some((c) => c.channel_id === channel.id)).map((channel) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-3" key={channel.id}><div><strong>{channel.display_name}</strong><p className="m-0 text-sm text-muted-foreground">Disponível para conexão com TikTok Shop.</p></div>{canEdit && <Button size="sm" disabled={startConnection.isPending} onClick={() => startConnection.mutate(channel.id)}>Conectar TikTok Shop</Button>}</div>)}
      {(channels.data ?? []).length === 0 && <Empty title="Conecte primeiro um canal TikTok" icon={Link2}>O Shop é vinculado a um canal já conectado no workspace.</Empty>}
    </CardContent></Card>

    <Card><CardHeader><CardTitle>Produtos afiliados</CardTitle></CardHeader><CardContent className="overflow-x-auto">
      {stats.products === 0 ? <Empty title="Catálogo ainda não sincronizado" icon={ShoppingBag}>Após a autorização do TikTok Shop, sincronize para importar produtos e comissões disponíveis.</Empty> : <table className="w-full min-w-[700px] text-sm"><thead><tr className="border-b text-left"><th className="p-2">Produto</th><th className="p-2">Preço</th><th className="p-2">Comissão</th><th className="p-2">Disponibilidade</th></tr></thead><tbody>{products.data?.map((product) => <tr key={product.id} className="border-b last:border-0"><td className="p-2"><strong>{product.title}</strong><span className="block text-xs text-muted-foreground">#{product.external_product_id}</span></td><td className="p-2">{product.price == null ? "—" : `${product.currency ?? ""} ${product.price}`}</td><td className="p-2">{product.commission_rate == null ? "—" : `${(product.commission_rate * 100).toFixed(1)}%`}</td><td className="p-2">{product.availability ?? "—"}</td></tr>)}</tbody></table>}
    </CardContent></Card>
  </div>;
}

function Metric({ icon: Icon, label, value }: { icon: typeof ShoppingBag; label: string; value: string | number }) {
  return <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Icon className="size-4" />{label}</CardTitle></CardHeader><CardContent><p className="m-0 text-2xl font-semibold">{value}</p></CardContent></Card>;
}
