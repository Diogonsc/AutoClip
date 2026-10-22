import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { toError, unwrap } from '../lib/api';
import type { Role, WorkspaceWithRole } from '../lib/types';
import { useAuth } from './AuthProvider';

interface WorkspaceState {
  workspaces: WorkspaceWithRole[];
  current: WorkspaceWithRole | null;
  loading: boolean;
  role: Role | null;
  canEdit: boolean;
  canAdmin: boolean;
  isOwner: boolean;
  setCurrentId: (id: string) => void;
  createWorkspace: (name: string) => Promise<string>;
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);
const STORAGE_KEY = 'tiktok-saas:workspace';

interface MemberRow {
  role: Role;
  workspaces: { id: string; name: string; owner_user_id: string } | null;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [currentId, setCurrentIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const query = useQuery({
    queryKey: ['workspaces', user?.id],
    enabled: Boolean(user),
    queryFn: async (): Promise<WorkspaceWithRole[]> => {
      const rows = unwrap(
        await supabase
          .from('workspace_members')
          .select('role, workspaces(id, name, owner_user_id)')
          .eq('user_id', user!.id),
      ) as unknown as MemberRow[];
      return rows
        .filter((r): r is MemberRow & { workspaces: NonNullable<MemberRow['workspaces']> } => r.workspaces !== null)
        .map((r) => ({ ...r.workspaces, role: r.role }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    },
  });

  const workspaces = query.data ?? [];
  const current = workspaces.find((w) => w.id === currentId) ?? workspaces[0] ?? null;

  useEffect(() => {
    if (current && current.id !== currentId) {
      setCurrentIdState(current.id);
    }
  }, [current, currentId]);

  const setCurrentId = useCallback((id: string) => {
    setCurrentIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* armazenamento indisponível: segue sem persistir */
    }
  }, []);

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ['workspaces'] });
  }, [qc]);

  const createWorkspace = useCallback(
    async (name: string) => {
      const { data, error } = await supabase.rpc('create_workspace', { p_name: name });
      if (error) throw toError(error);
      await qc.invalidateQueries({ queryKey: ['workspaces'] });
      const id = data as string;
      setCurrentId(id);
      return id;
    },
    [qc, setCurrentId],
  );

  const role = current?.role ?? null;
  const value = useMemo<WorkspaceState>(
    () => ({
      workspaces,
      current,
      loading: query.isLoading,
      role,
      canEdit: role === 'OWNER' || role === 'ADMIN' || role === 'EDITOR',
      canAdmin: role === 'OWNER' || role === 'ADMIN',
      isOwner: role === 'OWNER',
      setCurrentId,
      createWorkspace,
      refresh,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query.data, current?.id, current?.role, query.isLoading, setCurrentId, createWorkspace, refresh],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace fora do WorkspaceProvider');
  return ctx;
}

/** Workspace atual garantido (use dentro de páginas protegidas já com workspace carregado). */
export function useCurrentWorkspace(): WorkspaceWithRole {
  const { current } = useWorkspace();
  if (!current) throw new Error('Nenhum workspace selecionado');
  return current;
}
