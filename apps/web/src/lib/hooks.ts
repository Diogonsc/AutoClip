import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { toError, unwrap } from "./api";
import type {
  BillingPlan,
  AccountGroup,
  AccountGroupMember,
  Channel,
  MediaAsset,
  Profile,
  PlatformFlags,
  PublicationJob,
  PublicationBatch,
  PublicationBatchSummary,
  PublicationStatus,
  SaasOverview,
  WorkspaceSettings,
} from "./types";

export function useAccountGroups(workspaceId: string) {
  return useQuery({
    queryKey: ["account-groups", workspaceId],
    queryFn: async () =>
      unwrap(await supabase.from("account_groups").select("*").eq("workspace_id", workspaceId).order("name")) as unknown as AccountGroup[],
  });
}

export function useAccountGroupMembers(workspaceId: string) {
  return useQuery({
    queryKey: ["account-group-members", workspaceId],
    queryFn: async () =>
      unwrap(await supabase.from("account_group_members").select("*").eq("workspace_id", workspaceId)) as unknown as AccountGroupMember[],
  });
}

export function usePublicationBatches(workspaceId: string) {
  return useQuery({
    queryKey: ["publication-batches", workspaceId],
    queryFn: async () =>
      unwrap(await supabase.from("publication_batches").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100)) as unknown as PublicationBatch[],
  });
}

export interface PublicationBatchFilters {
  search?: string;
  channelId?: string;
  status?: string;
  createdFrom?: string;
  createdTo?: string;
  batchId?: string;
  groupId?: string;
}

export function usePublicationBatchesPage(workspaceId: string, page: number, pageSize: number, filters: PublicationBatchFilters = {}) {
  const search = filters.search?.trim() ?? "";
  return useQuery({
    queryKey: ["publication-batches", workspaceId, page, pageSize, filters],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_publication_batches", {
        p_workspace: workspaceId,
        p_limit: pageSize,
        p_offset: page * pageSize,
        p_search: search || null,
        p_channel: filters.channelId || null,
        p_status: filters.status || null,
        p_created_from: filters.createdFrom || null,
        p_created_to: filters.createdTo || null,
        p_batch: filters.batchId?.trim() || null,
        p_group: filters.groupId || null,
      });
      if (error) throw toError(error);
      const value = (data ?? {}) as { rows?: PublicationBatchSummary[]; total?: number };
      return { rows: value.rows ?? [], total: value.total ?? 0 };
    },
  });
}

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

export function useBillingPlans() {
  return useQuery({
    queryKey: ["billing-plans"],
    staleTime: 5 * 60_000,
    queryFn: async () =>
      unwrap(await supabase.from("billing_plans").select("*").eq("active", true).order("sort_order")) as unknown as BillingPlan[],
  });
}

export function useSaasOverview(workspaceId: string) {
  return useQuery({
    queryKey: ["saas-overview", workspaceId],
    queryFn: async () =>
      unwrap(await supabase.rpc("get_workspace_saas_overview", { p_workspace: workspaceId })) as unknown as SaasOverview,
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
