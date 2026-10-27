// src/services/api.ts
// Typed client for the NammaTwin SQLite-backed REST API.
// Base URL is configurable via VITE_API_BASE (defaults to http://localhost:5000).

export const API_BASE: string =
  typeof import.meta !== 'undefined' && import.meta.env
    ? (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:5000'
    : 'http://localhost:5000';

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
  fields?: Record<string, string>;
  status?: number;
}

export type RetryableErrorCode =
  | 'NETWORK_ERROR'
  | 'TIMEOUT_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'GATEWAY_TIMEOUT'
  | 'TOO_MANY_REQUESTS';

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_BASE_MS = 400;

function isRetryable(code: string | undefined, status: number | undefined): boolean {
  if (!code) return status === 503 || status === 504 || status === 429;
  return (
    code === 'NETWORK_ERROR' ||
    code === 'TIMEOUT_ERROR' ||
    code === 'SERVICE_UNAVAILABLE' ||
    code === 'GATEWAY_TIMEOUT' ||
    code === 'TOO_MANY_REQUESTS'
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  maxRetries: number = MAX_RETRIES
): Promise<ApiResult<T>> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  let lastError: ApiResult<T> = { ok: false, error: 'Unknown error', code: 'UNKNOWN_ERROR' };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let controller: AbortController | null = null;
    let retryAfterMs: number | null = null;
    try {
      controller = new AbortController();
      const timeoutId = setTimeout(() => controller?.abort(), timeoutMs);

      const res = await fetch(url, {
        ...options,
        headers,
        credentials: 'include',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const text = await res.text();
      let body: any = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { ok: false, error: 'Invalid JSON response' };
      }

      // Respect Retry-After header for 429 / 503 responses.
      const retryAfterHeader = res.headers.get('Retry-After');
      retryAfterMs =
        retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : null;

      const code = body?.code || (res.status >= 500 ? 'SERVICE_UNAVAILABLE' : undefined);
      const error = body?.error || `HTTP ${res.status}`;

      if (!res.ok || body?.ok === false) {
        lastError = {
          ok: false,
          error,
          code,
          fields: body?.fields,
          status: res.status,
        };

        // Retry only on transient failures, not on 4xx client errors (except 429).
        const shouldRetry =
          attempt < maxRetries && isRetryable(code, res.status);
        if (!shouldRetry) {
          return lastError;
        }

        const backoff = retryAfterMs ?? RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt);
        await sleep(backoff);
        continue;
      }

      return { ok: true, data: body?.data as T, status: res.status };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        lastError = {
          ok: false,
          error: 'Request timed out',
          code: 'TIMEOUT_ERROR',
          status: 408,
        };
      } else {
        lastError = {
          ok: false,
          error: err?.message || 'Network error',
          code: 'NETWORK_ERROR',
        };
      }

      if (attempt < maxRetries) {
        const backoff = retryAfterMs ?? RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt);
        await sleep(backoff);
        continue;
      }
    } finally {
      controller = null;
    }
  }

  return lastError;
}

// ---------- Projects ----------
export interface ApiProject {
  id: string;
  name: string;
  description: string;
  spaceType: string;
  roomCount: number;
  units: string;
  floorArea: number | null;
  ceilingHeight: number | null;
  captureMethod: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  photoCount: number;
  videoCount: number;
  hasFloorPlan: boolean;
  floorPlanName: string | null;
  startingAnchor: string | null;
  referenceMeasurement: string | null;
  reconstructionEngine: string;
  reconstructionProgress: number;
  lastErrorMessage: string | null;
  reconstructionModelStats?: any;
}

export const projectsApi = {
  list: () => request<ApiProject[]>('/api/projects'),
  get: (id: string) => request<ApiProject>(`/api/projects/${encodeURIComponent(id)}`),
  create: (body: Partial<ApiProject> & { name: string }) =>
    request<ApiProject>('/api/projects', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<ApiProject>) =>
    request<ApiProject>(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  remove: (id: string) =>
    request<{ id: string; deleted: boolean }>(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};

// ---------- Rooms ----------
export interface ApiRoom {
  id: string;
  projectId?: string;
  name: string;
  category: string;
  lengthMeters: number;
  widthMeters: number;
  heightMeters: number;
  originDescription: string;
  coordinateConvention: string;
  connectedDoorwayIds: string[];
  features: any;
}

export const roomsApi = {
  list: (projectId?: string) =>
    request<ApiRoom[]>(`/api/rooms${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`),
  get: (id: string) => request<ApiRoom>(`/api/rooms/${encodeURIComponent(id)}`),
  create: (body: any, projectId?: string) =>
    request<ApiRoom>(`/api/rooms${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  update: (id: string, body: any) =>
    request<ApiRoom>(`/api/rooms/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string) =>
    request<{ id: string; deleted: boolean }>(`/api/rooms/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

// ---------- Doorways ----------
export interface ApiDoorway {
  id: string;
  projectId?: string;
  name: string;
  connectedRoomIds: string[];
  widthMeters: number;
  heightMeters: number;
  wallLocation: string;
  offsetMeters: number;
  hasClearLineOfSight: boolean;
  observations: any;
}

export const doorwaysApi = {
  list: (projectId?: string) =>
    request<ApiDoorway[]>(
      `/api/doorways${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`
    ),
  get: (id: string) => request<ApiDoorway>(`/api/doorways/${encodeURIComponent(id)}`),
  create: (body: any) => request<ApiDoorway>('/api/doorways', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: any) =>
    request<ApiDoorway>(`/api/doorways/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string) =>
    request<{ id: string; deleted: boolean }>(`/api/doorways/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

// ---------- Photos ----------
export interface ApiPhoto {
  id: string;
  projectId?: string;
  filename: string;
  roomId: string;
  pass: string;
  modality: string;
  cameraPoseTag: string;
  focalLengthMm: number;
  sharpnessScore: number;
  exposureReview: string;
  overlapReview: string;
  occlusionFlag: boolean;
  doorwayAnchorId?: string | null;
  sensorMetadata?: any;
  reviewerNotes?: string | null;
  timestamp: string;
  isAutomatedMetric: boolean;
  imageUrl?: string | null;
  dominantColor?: string | null;
  spatialPose?: any;
}

export const photosApi = {
  list: (projectId?: string) =>
    request<ApiPhoto[]>(
      `/api/photos${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`
    ),
  get: (id: string) => request<ApiPhoto>(`/api/photos/${encodeURIComponent(id)}`),
  create: (body: any) => request<ApiPhoto>('/api/photos', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: any) =>
    request<ApiPhoto>(`/api/photos/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string) =>
    request<{ id: string; deleted: boolean }>(`/api/photos/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

// ---------- Manifest ----------
export const manifestApi = {
  validate: (body: any) =>
    request<{ isValid: boolean; issues: any[] }>('/api/manifest/validate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

// ---------- Health ----------
export const healthApi = {
  check: () =>
    request<{ status: string; db: string; timestamp: string }>('/api/health', undefined, 5000, 1),
};// ---------- Auth (cookie-based session API fallback) ----------

export interface AuthUser {
  id: string;
  username?: string | null;
  email?: string | null;
  role?: string;
}

export interface AuthResult {
  ok: boolean;
  user?: AuthUser;
  error?: string;
  code?: string;
}

export const authApi = {
  register: async (
    username: string,
    email: string,
    password: string
  ): Promise<AuthResult> => {
    const res = await request<{ user: AuthUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
    if (!res.ok) return { ok: false, error: res.error, code: res.code };
    return { ok: true, user: res.data?.user };
  },
  login: async (
    username: string,
    password: string
  ): Promise<AuthResult> => {
    const res = await request<{ user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) return { ok: false, error: res.error, code: res.code };
    return { ok: true, user: res.data?.user };
  },
  logout: async (): Promise<AuthResult> => {
    const res = await request<{ ok: boolean }>('/api/auth/logout', {
      method: 'POST',
    });
    if (!res.ok) return { ok: false, error: res.error, code: res.code };
    return { ok: true, user: undefined };
  },
  me: async (): Promise<AuthResult> => {
    const res = await request<{ user: AuthUser }>('/api/auth/me');
    if (!res.ok) return { ok: false, error: res.error, code: res.code };
    return { ok: true, user: res.data?.user };
  },
};
