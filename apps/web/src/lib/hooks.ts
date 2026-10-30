import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { toError, unwrap } from "./api";
import type {
  Channel,
  MediaAsset,
  Profile,
  PlatformFlags,
  PublicationJob,
  PublicationStatus,
  WorkspaceSettings,
  TikTokShopConnection,
  TikTokShopOrder,
  TikTokShopProduct,
} from "./types";

/** Owner da plataforma (SaaS). Só controla a visibilidade da UI; a Edge Function reautoriza no servidor. */
export function usePlatformOwner(userId: string | undefined) {
  return useQuery({
    queryKey: ["platform-owner", userId],
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_platform_owner");
      if (error) throw toError(error);
      return Boolean(data);
    },
  });
}

/** Estado da auditoria TikTok. Falha de consulta sempre assume modo de teste seguro. */
export function usePlatformFlags() {
  return useQuery({
    queryKey: ["platform-flags"],
    staleTime: 60_000,
    queryFn: async (): Promise<PlatformFlags> => {
      const { data, error } = await supabase.rpc("get_platform_flags");
      if (error) throw toError(error);
      const value = (data ?? {}) as Partial<PlatformFlags>;
      return {
        tiktok_audited: value.tiktok_audited === true,
        test_mode: value.test_mode !== false,
        demo_video_url:
          typeof value.demo_video_url === "string"
            ? value.demo_video_url
            : null,
        updated_at:
          typeof value.updated_at === "string" ? value.updated_at : null,
      };
    },
    retry: 1,
  });
}

export function useChannels(workspaceId: string) {
  return useQuery({
    queryKey: ["channels", workspaceId],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("channels")
          .select("*")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: true }),
      ) as unknown as Channel[],
  });
}

export function useMedia(workspaceId: string) {
  return useQuery({
    queryKey: ["media", workspaceId],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("media_assets")
          .select("*")
          .eq("workspace_id", workspaceId)
          .neq("status", "DELETED")
          .order("created_at", { ascending: false }),
      ) as unknown as MediaAsset[],
  });
}

export function useJobsPage(
  workspaceId: string,
  page: number,
  pageSize: number,
  statuses?: readonly PublicationStatus[],
  sortBy: "scheduled_at" | "updated_at" = "scheduled_at",
) {
  const statusKey = statuses?.join(",") ?? "all";
  return useQuery({
    queryKey: ["jobs", workspaceId, "page", page, pageSize, statusKey, sortBy],
    queryFn: async () => {
      let request = supabase
        .from("publication_jobs")
        .select("*", { count: "exact" })
        .eq("workspace_id", workspaceId)
        .order(sortBy, {
          ascending: false,
          nullsFirst: sortBy === "scheduled_at",
        })
        .order("scheduled_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: true });
      if (statuses?.length) request = request.in("status", [...statuses]);
      const { data, error, count } = await request.range(
        page * pageSize,
        (page + 1) * pageSize - 1,
      );
      if (error) throw toError(error);
      return {
        rows: (data ?? []) as unknown as PublicationJob[],
        total: count ?? 0,
      };
    },
  });
}

export function useSettings(workspaceId: string) {
  return useQuery({
    queryKey: ["settings", workspaceId],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("workspace_settings")
          .select("*")
          .eq("workspace_id", workspaceId)
          .maybeSingle(),
      ) as unknown as WorkspaceSettings | null,
  });
}

export function useTikTokShopConnections(workspaceId: string) {
  return useQuery({
    queryKey: ["shop-connections", workspaceId],
    queryFn: async () =>
      unwrap(await supabase.rpc("list_tiktok_shop_connections", { p_workspace: workspaceId })) as unknown as TikTokShopConnection[],
  });
}

export function useTikTokShopProducts(workspaceId: string) {
  return useQuery({
    queryKey: ["shop-products", workspaceId],
    queryFn: async () =>
      unwrap(await supabase.from("tiktok_shop_products").select("*").eq("workspace_id", workspaceId).order("synced_at", { ascending: false })) as unknown as TikTokShopProduct[],
  });
}

export function useTikTokShopOrders(workspaceId: string) {
  return useQuery({
    queryKey: ["shop-orders", workspaceId],
    queryFn: async () =>
      unwrap(await supabase.from("tiktok_shop_orders").select("*").eq("workspace_id", workspaceId).order("ordered_at", { ascending: false }).limit(500)) as unknown as TikTokShopOrder[],
  });
}

export function useProfiles(userIds: string[]) {
  const ids = [...new Set(userIds)].sort();
  return useQuery({
    queryKey: ["profiles", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const rows = unwrap(
        await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", ids),
      ) as unknown as Profile[];
      return Object.fromEntries(
        rows.map((r) => [r.id, r.display_name]),
      ) as Record<string, string>;
    },
  });
}
