// src/hooks/useProjects.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { projectsApi } from '../services/api';
import { NammaProject } from '../types/dart';

const LS_KEY = 'nammatwin_projects';

function readLocal(): NammaProject[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as NammaProject[]) : [];
  } catch {
    return [];
  }
}

export function useProjects() {
  const [projects, setProjects] = useState<NammaProject[]>(() => readLocal());
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [usingFallback, setUsingFallback] = useState<boolean>(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistToLocal = useCallback((data: NammaProject[]) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(data));
      } catch {
        /* ignore quota errors */
      }
      debounceTimer.current = null;
    }, 300);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await projectsApi.list();
    if (res.ok && res.data) {
      const data = res.data as unknown as NammaProject[];
      setProjects(data);
      setUsingFallback(false);
      persistToLocal(data);
    } else {
      // Fall back to cached localStorage data
      setProjects(readLocal());
      setUsingFallback(true);
      setError(res.error || 'Failed to load projects');
    }
    setLoading(false);
  }, [persistToLocal]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Persist local changes on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(projects));
      } catch {
        /* ignore */
      }
    };
  }, [projects]);

  const create = useCallback(
    async (body: Partial<NammaProject> & { name: string }) => {
      // Optimistic update - capture fresh snapshot for rollback
      const now = new Date().toISOString();
      const optimistic: NammaProject = {
        id: `opt_${Date.now()}`,
        name: body.name,
        description: '',
        spaceType: 'Apartment',
        roomCount: 0,
        units: 'metres',
        floorArea: undefined,
        ceilingHeight: undefined,
        captureMethod: 'Still Photos Loop',
        status: 'Draft',
        createdAt: now,
        updatedAt: now,
        photoCount: 0,
        videoCount: 0,
        hasFloorPlan: false,
        floorPlanName: undefined,
        startingAnchor: 'Main entrance',
        referenceMeasurement: undefined,
        reconstructionEngine: 'Calibrated Geometric Twin',
        reconstructionProgress: 0,
        lastErrorMessage: undefined,
      };

      const snapshot = [...projects];
      setProjects((prev) => [optimistic, ...prev]);
      persistToLocal([optimistic, ...snapshot]);

      const res = await projectsApi.create(body as any);
      if (res.ok && res.data) {
        const data = res.data as unknown as NammaProject;
        setProjects((prev) => prev.map((p) => (p.id === optimistic.id ? data : p)));
        const updated = snapshot.map((p) =>
          p.id === optimistic.id ? data : p
        );
        persistToLocal(updated);
        return data;
      }
      // Rollback optimistic update on failure using the captured snapshot
      setProjects(snapshot.filter((p) => p.id !== optimistic.id));
      persistToLocal(snapshot.filter((p) => p.id !== optimistic.id));
      setError(res.error || 'Create failed');
      return null;
    },
    [projects, persistToLocal]
  );

  const update = useCallback(async (id: string, body: Partial<NammaProject>) => {
    const now = new Date().toISOString();

    const snapshot = [...projects];
    // Optimistic update
    setProjects((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, ...body, updatedAt: now } : p
      )
    );
    const optimisticallyUpdated = snapshot.map((p) =>
      p.id === id ? { ...p, ...body, updatedAt: now } : p
    );
    persistToLocal(optimisticallyUpdated);

    const res = await projectsApi.update(id, body as any);
    if (res.ok && res.data) {
      const data = res.data as unknown as NammaProject;
      setProjects((prev) => prev.map((p) => (p.id === id ? data : p)));
      const updated2 = snapshot.map((p) =>
        p.id === id ? data : p
      );
      persistToLocal(updated2);
      return data;
    }
    // Rollback to snapshot on failure
    setProjects(snapshot);
    persistToLocal(snapshot);
    setError(res.error || 'Update failed');
    return null;
  }, [projects, persistToLocal]);

  const remove = useCallback(async (id: string) => {
    // Optimistic remove - capture fresh snapshot for rollback
    const snapshot = [...projects];
    const removed = snapshot.find((p) => p.id === id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
    const withoutRemoved = snapshot.filter((p) => p.id !== id);
    persistToLocal(withoutRemoved);

    const res = await projectsApi.remove(id);
    if (res.ok) {
      return true;
    }
    // Rollback on failure using captured snapshot
    setProjects(snapshot);
    persistToLocal(snapshot);
    setError(res.error || 'Delete failed');
    return false;
  }, [projects, persistToLocal]);

  return { projects, loading, error, usingFallback, refresh, create, update, remove };
}
