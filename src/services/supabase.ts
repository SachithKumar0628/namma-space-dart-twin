// src/services/supabase.ts
// Supabase client and authentication helpers.
//
// Configuration (see .env.example):
//   VITE_SUPABASE_URL      Supabase project URL (required for Supabase auth)
//   VITE_SUPABASE_ANON_KEY Supabase public anon key (required for Supabase auth)
//
// When these variables are missing, the Supabase client is not created and the
// application falls back to the existing cookie-based session API
// (/api/auth/* on the Express backend). No credentials are ever embedded here,
// and the service-role key is never exposed to the browser.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL;
const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabaseAnonKey && String(supabaseUrl).startsWith('http')
);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(String(supabaseUrl), String(supabaseAnonKey))
  : null;

export interface SupabaseUser {
  id: string;
  email: string | null;
  aud: string;
  role: string;
  created_at?: string | null;
}

export function mapSupabaseUser(u: any): SupabaseUser | null {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email ?? null,
    aud: u.aud ?? '',
    role: u.role ?? 'authenticated',
    created_at: u.created_at ?? null,
  };
}

// Sign up with email and password (Supabase).
export async function supabaseSignUp(
  email: string,
  password: string
): Promise<{ ok: boolean; user: SupabaseUser | null; error?: string }> {
  if (!supabase) {
    return {
      ok: false,
      user: null,
      error: 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    };
  }
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { ok: false, user: null, error: error.message };
  return { ok: true, user: mapSupabaseUser(data.user) };
}

// Sign in with email and password (Supabase).
export async function supabaseSignIn(
  email: string,
  password: string
): Promise<{ ok: boolean; user: SupabaseUser | null; error?: string }> {
  if (!supabase) {
    return {
      ok: false,
      user: null,
      error: 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    };
  }
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) return { ok: false, user: null, error: error.message };
  return { ok: true, user: mapSupabaseUser(data.user) };
}

// Sign out (Supabase).
export async function supabaseSignOut(): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'Supabase is not configured.' };
  }
  const { error } = await supabase.auth.signOut();
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Get the current Supabase session user.
export async function supabaseGetUser(): Promise<SupabaseUser | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return mapSupabaseUser(data.user);
}
