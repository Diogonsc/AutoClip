import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { toError, unwrap } from './api';
import type {
  Channel,
  MediaAsset,
  Profile,
  PublicationJob,
  PublicationStatus,
  WorkspaceSettings,
} from './types';

export function useChannels(workspaceId: string) {
  return useQuery({
    queryKey: ['channels', workspaceId],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('channels')
          .select('*')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: true }),
      ) as unknown as Channel[],
  });
}

export function useMedia(workspaceId: string) {
  return useQuery({
    queryKey: ['media', workspaceId],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('media_assets')
          .select('*')
          .eq('workspace_id', workspaceId)
          .neq('status', 'DELETED')
          .order('created_at', { ascending: false }),
      ) as unknown as MediaAsset[],
  });
}

export function useJobsPage(
  workspaceId: string,
  page: number,
  pageSize: number,
  statuses?: readonly PublicationStatus[],
  sortBy: 'scheduled_at' | 'updated_at' = 'scheduled_at',
) {
  const statusKey = statuses?.join(',') ?? 'all';
  return useQuery({
    queryKey: ['jobs', workspaceId, 'page', page, pageSize, statusKey, sortBy],
    queryFn: async () => {
      let request = supabase
        .from('publication_jobs')
        .select('*', { count: 'exact' })
        .eq('workspace_id', workspaceId)
        .order(sortBy, { ascending: false, nullsFirst: sortBy === 'scheduled_at' })
        .order('scheduled_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: true });
      if (statuses?.length) request = request.in('status', [...statuses]);
      const { data, error, count } = await request.range(page * pageSize, (page + 1) * pageSize - 1);
      if (error) throw toError(error);
      return { rows: (data ?? []) as unknown as PublicationJob[], total: count ?? 0 };
    },
  });
}

export function useSettings(workspaceId: string) {
  return useQuery({
    queryKey: ['settings', workspaceId],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('workspace_settings')
          .select('*')
          .eq('workspace_id', workspaceId)
          .maybeSingle(),
      ) as unknown as WorkspaceSettings | null,
  });
}

export function useProfiles(userIds: string[]) {
  const ids = [...new Set(userIds)].sort();
  return useQuery({
    queryKey: ['profiles', ids.join(',')],
    enabled: ids.length > 0,
    queryFn: async () => {
      const rows = unwrap(
        await supabase.from('profiles').select('id, display_name').in('id', ids),
      ) as unknown as Profile[];
      return Object.fromEntries(rows.map((r) => [r.id, r.display_name])) as Record<string, string>;
    },
  });
}
