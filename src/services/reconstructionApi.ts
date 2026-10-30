// Client for the local FastAPI photo-reconstruction service (COLMAP + Brush).
// The main product API stays on :5000; this service is separate because SfM and
// splat training are long-running CPU/GPU jobs.

import type { ReconstructionModelStats } from '../types/dart';

const env = (import.meta as any).env || {};
export const RECONSTRUCTION_API_BASE = '/reconstruction-api';

export interface ReconstructionResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  status?: number;
}

export type ReconstructionJobStatus =
  | 'queued'
  | 'preparing'
  | 'estimating_cameras'
  | 'reconstructing'
  | 'optimizing'
  | 'uploading_artifacts'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'succeeded'
  | 'running';

export interface ReconstructionJob {
  id: string;
  projectId: string;
  status: ReconstructionJobStatus;
  stage: string;
  progress: number;
  message: string;
  inputCount: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  stats: ReconstructionModelStats | null;
  error: string | null;
  assetUrls: Record<string, string>;
  logUrl: string;
  /** Direct URL to the exported Gaussian-splat / point-cloud PLY artifact. */
  splatUrl?: string | null;
  /** Direct URL to the sparse COLMAP point-cloud PLY artifact. */
  pointCloudUrl?: string | null;
}

export interface ReconstructionHealth {
  ok: boolean;
  service: string;
  version: string;
  pycolmap: string | null;
  colmapSfmAvailable: boolean;
  pycolmapError?: string | null;
  splattingAvailable: boolean;
  brushPath: string | null;
  dataDirectory: string;
  activeJobs: number;
  limits: {
    maxPhotos: number;
    maxFileMB: number;
    maxTotalMB: number;
  };
}

function errorMessage(body: any, fallback: string): string {
  const detail = body?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (typeof item?.msg === 'string' ? item.msg : ''))
      .filter(Boolean);
    if (messages.length) return messages.join('; ');
  }
  if (typeof body?.error === 'string' && body.error.trim()) return body.error;
  return fallback;
}

function networkMessage(error: any): string {
  if (error?.name === 'AbortError') {
    return 'The reconstruction service did not respond in time.';
  }
  return (
    `Cannot reach the reconstruction service at ${RECONSTRUCTION_API_BASE}. ` +
    'Start it from the project folder with "npm run reconstruction".'
  );
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 15_000
): Promise<ReconstructionResult<T>> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${RECONSTRUCTION_API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    let body: any = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: errorMessage(body, `Reconstruction service returned HTTP ${response.status}.`),
      };
    }
    return { ok: true, data: body as T, status: response.status };
  } catch (error: any) {
    return { ok: false, error: networkMessage(error) };
  } finally {
    window.clearTimeout(timer);
  }
}

export const reconstructionApi = {
  baseUrl: RECONSTRUCTION_API_BASE,

  health: () => request<ReconstructionHealth>('/health', {}, 6_000),

  createJob: async (
    files: File[],
    projectId: string
  ): Promise<ReconstructionResult<ReconstructionJob>> => {
    if (!files.length) return { ok: false, error: 'Choose at least one photo.' };
    const form = new FormData();
    files.forEach((file) => form.append('photos', file, file.name));
    form.append('projectId', projectId);
    // Uploading a phone photo set can legitimately take a while on a slow disk.
    const result = await request<ReconstructionJob>(
      '/v1/jobs',
      { method: 'POST', body: form },
      180_000
    );
    if (!result.ok || !result.data) return result;
    return { ...result, data: result.data };
  },

  getJob: async (jobId: string): Promise<ReconstructionResult<ReconstructionJob>> => {
    const result = await request<{ ok: boolean; job: ReconstructionJob }>(
      `/v1/jobs/${encodeURIComponent(jobId)}`
    );
    if (!result.ok) return { ...result, data: undefined };
    return { ...result, data: result.data?.job };
  },

  listJobs: async (
    projectId?: string
  ): Promise<ReconstructionResult<ReconstructionJob[]>> => {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    const result = await request<{ ok: boolean; jobs: ReconstructionJob[] }>(
      `/v1/jobs${query}`
    );
    if (!result.ok) return { ...result, data: undefined };
    return { ...result, data: result.data?.jobs || [] };
  },

  deleteJob: (jobId: string) =>
    request<{ ok: boolean; id: string; deleted: boolean }>(
      `/v1/jobs/${encodeURIComponent(jobId)}`,
      { method: 'DELETE' }
    ),
};

/**
 * Turn a stored relative asset path into a URL the browser can load. The
 * optional version busts the browser cache when a scan is re-run in place.
 */
export function reconstructionAssetUrl(
  path?: string | null,
  version?: string | null
): string {
  if (!path) return '';
  const base = /^https?:\/\//i.test(path)
    ? path
    : `${RECONSTRUCTION_API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
  if (!version) return base;
  return `${base}${base.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}`;
}

export function reconstructionServiceHint(): string {
  return `npm run reconstruction (${RECONSTRUCTION_API_BASE})`;
}
