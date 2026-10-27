// src/hooks/usePhotos.ts
import { useCallback, useEffect, useState } from 'react';
import { photosApi } from '../services/api';
import { CapturePhotoRecord } from '../types/dart';

const LS_KEY = 'nammatwin_photos';

function cacheKey(projectId?: string) {
  return projectId ? `${LS_KEY}_${projectId}` : LS_KEY;
}

function readLocal(projectId?: string): CapturePhotoRecord[] {
  // No active project → never read the legacy global cache.
  if (!projectId) return [];
  try {
    const raw = localStorage.getItem(cacheKey(projectId));
    return raw ? (JSON.parse(raw) as CapturePhotoRecord[]) : [];
  } catch {
    return [];
  }
}

export function usePhotos(projectId?: string) {
  const [photos, setPhotos] = useState<CapturePhotoRecord[]>(() => readLocal(projectId));
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [usingFallback, setUsingFallback] = useState<boolean>(false);

  const refresh = useCallback(async () => {
    if (projectId === '') {
      setPhotos([]);
      setError(null);
      setUsingFallback(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const res = await photosApi.list(projectId);
    if (res.ok && res.data) {
      setPhotos(res.data as unknown as CapturePhotoRecord[]);
      setUsingFallback(false);
      try {
        localStorage.setItem(cacheKey(projectId), JSON.stringify(res.data));
      } catch {
        /* ignore */
      }
    } else {
      setPhotos(readLocal(projectId));
      setUsingFallback(true);
      setError(res.error || 'Failed to load photos');
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    setPhotos(readLocal(projectId));
    refresh();
  }, [projectId, refresh]);

  const create = useCallback(async (body: any) => {
    const res = await photosApi.create(body);
    if (res.ok && res.data) {
      setPhotos((prev) => [res.data as unknown as CapturePhotoRecord, ...prev]);
      return res.data;
    }
    setError(res.error || 'Create failed');
    return null;
  }, []);

  const update = useCallback(async (id: string, body: any) => {
    const res = await photosApi.update(id, body);
    if (res.ok && res.data) {
      setPhotos((prev) => prev.map((p) => (p.id === id ? (res.data as unknown as CapturePhotoRecord) : p)));
      return res.data;
    }
    setError(res.error || 'Update failed');
    return null;
  }, []);

  const remove = useCallback(async (id: string) => {
    const res = await photosApi.remove(id);
    if (res.ok) {
      setPhotos((prev) => prev.filter((p) => p.id !== id));
      return true;
    }
    setError(res.error || 'Delete failed');
    return false;
  }, []);

  return { photos, loading, error, usingFallback, refresh, create, update, remove };
}