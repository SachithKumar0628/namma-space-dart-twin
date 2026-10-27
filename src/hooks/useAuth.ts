// src/hooks/useAuth.ts
// Authentication hook.
//
// Prefers Supabase Auth when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are
// configured. Falls back to the existing cookie-based session API
// (/api/auth/me, /api/auth/login, /api/auth/register, /api/auth/logout) so the
// application keeps working without Supabase credentials. Never fabricates a
// session and never exposes service-role credentials to the browser.

import { useCallback, useEffect, useState } from 'react';
import {
  supabase,
  isSupabaseConfigured,
  mapSupabaseUser,
  supabaseSignUp,
  supabaseSignIn,
  supabaseSignOut,
  supabaseGetUser,
} from '../services/supabase';
import { authApi } from '../services/api';

export interface AuthUser {
  id: string;
  email: string | null;
  provider: 'supabase' | 'session';
}

interface UseAuthReturn {
  user: AuthUser | null;
  loading: boolean;
  authenticated: boolean;
  supabaseConfigured: boolean;
  signUp: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (isSupabaseConfigured && supabase) {
        const u = await supabaseGetUser();
        setUser(u ? { id: u.id, email: u.email, provider: 'supabase' } : null);
      } else {
        const res = await authApi.me();
        if (res.ok && res.user) {
          const u = res.user as { id: string; email?: string | null };
          setUser({ id: u.id, email: u.email ?? null, provider: 'session' });
        } else {
          setUser(null);
        }
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();

    if (isSupabaseConfigured && supabase) {
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user
          ? { id: session.user.id, email: session.user.email ?? null, provider: 'supabase' }
          : null);
        setLoading(false);
      });
      return () => {
        sub?.subscription.unsubscribe();
      };
    }
  }, [refresh, isSupabaseConfigured, supabase]);

  const signUp = useCallback(
    async (email: string, password: string): Promise<{ ok: boolean; error?: string }> => {
      if (isSupabaseConfigured && supabase) {
        const r = await supabaseSignUp(email, password);
        if (r.ok && r.user) {
          setUser({ id: r.user.id, email: r.user.email, provider: 'supabase' });
        }
        setLoading(false);
        return { ok: r.ok, error: r.error };
      }
      // email is used as username for the session API fallback.
      const res = await authApi.register(email, email, password);
      if (res.ok) await refresh();
      return { ok: res.ok, error: res.error };
    },
    [refresh]
  );

  const signIn = useCallback(
    async (email: string, password: string): Promise<{ ok: boolean; error?: string }> => {
      if (isSupabaseConfigured && supabase) {
        const r = await supabaseSignIn(email, password);
        if (r.ok && r.user) {
          setUser({ id: r.user.id, email: r.user.email, provider: 'supabase' });
        }
        setLoading(false);
        return { ok: r.ok, error: r.error };
      }
      const res = await authApi.login(email, password);
      if (res.ok) await refresh();
      return { ok: res.ok, error: res.error };
    },
    [refresh]
  );

  const signOut = useCallback(async (): Promise<void> => {
    if (isSupabaseConfigured && supabase) {
      await supabaseSignOut();
    } else {
      try { await authApi.logout(); } catch { /* ignore */ }
    }
    setUser(null);
    setLoading(false);
  }, []);

  return {
    user,
    loading,
    authenticated: !!user,
    supabaseConfigured: isSupabaseConfigured,
    signUp,
    signIn,
    signOut,
    refresh,
  };
}
