// src/hooks/useDoorways.ts
import { useCallback, useEffect, useState } from 'react';
import { doorwaysApi, ApiDoorway } from '../services/api';
import { DoorwayAnchor } from '../types/dart';

const LS_KEY = 'nammatwin_doorways';

function cacheKey(projectId?: string) {
  return projectId ? `${LS_KEY}_${projectId}` : LS_KEY;
}

function readLocal(projectId?: string): DoorwayAnchor[] {
  // No active project → never read the legacy global cache.
  if (!projectId) return [];
  try {
    const raw = localStorage.getItem(cacheKey(projectId));
    return raw ? (JSON.parse(raw) as DoorwayAnchor[]) : [];
  } catch {
    return [];
  }
}

export function useDoorways(projectId?: string) {
  const [doorways, setDoorways] = useState<DoorwayAnchor[]>(() => readLocal(projectId));
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [usingFallback, setUsingFallback] = useState<boolean>(false);

  const refresh = useCallback(async () => {
    if (projectId === '') {
      setDoorways([]);
      setError(null);
      setUsingFallback(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const res = await doorwaysApi.list(projectId);
    if (res.ok && res.data) {
      setDoorways(res.data as unknown as DoorwayAnchor[]);
      setUsingFallback(false);
      try {
        localStorage.setItem(cacheKey(projectId), JSON.stringify(res.data));
      } catch {
        /* ignore */
      }
    } else {
      setDoorways(readLocal(projectId));
      setUsingFallback(true);
      setError(res.error || 'Failed to load doorways');
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    setDoorways(readLocal(projectId));
    refresh();
  }, [projectId, refresh]);

  const create = useCallback(async (body: any) => {
    const res = await doorwaysApi.create(body);
    if (res.ok && res.data) {
      setDoorways((prev) => [...prev, res.data as unknown as DoorwayAnchor]);
      return res.data;
    }
    setError(res.error || 'Create failed');
    return null;
  }, []);

  const update = useCallback(async (id: string, body: any) => {
    const res = await doorwaysApi.update(id, body);
    if (res.ok && res.data) {
      setDoorways((prev) => prev.map((d) => (d.id === id ? (res.data as unknown as DoorwayAnchor) : d)));
      return res.data;
    }
    setError(res.error || 'Update failed');
    return null;
  }, []);

  const remove = useCallback(async (id: string) => {
    const res = await doorwaysApi.remove(id);
    if (res.ok) {
      setDoorways((prev) => prev.filter((d) => d.id !== id));
      return true;
    }
    setError(res.error || 'Delete failed');
    return false;
  }, []);

  return { doorways, loading, error, usingFallback, refresh, create, update, remove };
}