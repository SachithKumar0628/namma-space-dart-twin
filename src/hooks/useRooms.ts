// src/hooks/useRooms.ts
import { useCallback, useEffect, useState } from 'react';
import { roomsApi } from '../services/api';
import { RoomMetadata } from '../types/dart';

const LS_KEY = 'nammatwin_rooms';

function cacheKey(projectId?: string) {
  return projectId ? `${LS_KEY}_${projectId}` : LS_KEY;
}

function readLocal(projectId?: string): RoomMetadata[] {
  // No active project → never read the legacy global cache, which may still
  // hold the bundled sample apartment from older sessions.
  if (!projectId) return [];
  try {
    const raw = localStorage.getItem(cacheKey(projectId));
    return raw ? (JSON.parse(raw) as RoomMetadata[]) : [];
  } catch {
    return [];
  }
}

export function useRooms(projectId?: string) {
  const [rooms, setRooms] = useState<RoomMetadata[]>(() => readLocal(projectId));
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [usingFallback, setUsingFallback] = useState<boolean>(false);

  const refresh = useCallback(async () => {
    // No active space yet (empty string) → nothing to fetch, and never fall
    // back to the global list which would leak the bundled sample data.
    if (projectId === '') {
      setRooms([]);
      setError(null);
      setUsingFallback(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const res = await roomsApi.list(projectId);
    if (res.ok && res.data) {
      setRooms(res.data as unknown as RoomMetadata[]);
      setUsingFallback(false);
      try {
        localStorage.setItem(cacheKey(projectId), JSON.stringify(res.data));
      } catch {
        /* ignore */
      }
    } else {
      setRooms(readLocal(projectId));
      setUsingFallback(true);
      setError(res.error || 'Failed to load rooms');
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    setRooms(readLocal(projectId));
    refresh();
  }, [projectId, refresh]);

  const create = useCallback(
    async (body: any, projectIdOverride?: string) => {
      const res = await roomsApi.create(body, projectIdOverride || projectId);
      if (res.ok && res.data) {
        setRooms((prev) => [...prev, res.data as unknown as RoomMetadata]);
        return res.data as unknown as RoomMetadata;
      }
      setError(res.error || 'Create failed');
      return null;
    },
    [projectId]
  );

  const update = useCallback(async (id: string, body: any) => {
    const res = await roomsApi.update(id, body);
    if (res.ok && res.data) {
      setRooms((prev) => prev.map((r) => (r.id === id ? (res.data as unknown as RoomMetadata) : r)));
      return res.data as unknown as RoomMetadata;
    }
    setError(res.error || 'Update failed');
    return null;
  }, []);

  const remove = useCallback(async (id: string) => {
    const res = await roomsApi.remove(id);
    if (res.ok) {
      setRooms((prev) => prev.filter((r) => r.id !== id));
      return true;
    }
    setError(res.error || 'Delete failed');
    return false;
  }, []);

  return { rooms, loading, error, usingFallback, refresh, create, update, remove };
}