-- Namma Space: initial schema + RLS (part 1 of 2)
-- Mirrors the SQLite schema in server/db.cjs.
-- Apply with: supabase db push

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique not null,
  email text unique not null,
  role text not null default 'user',
  created_at timestamptz not null default now(),
  last_login timestamptz
);

alter table public.profiles enable row level security;

create policy "profiles are self-readable"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles are self-updatable"
  on public.profiles for update
  using (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- projects (spaces)
create table if not exists public.projects (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  space_type text not null default 'Custom',
  units text not null default 'metres',
  floor_area real,
  ceiling_height real,
  capture_method text not null default 'Still Photos Loop',
  status text not null default 'Ready for Upload',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  photo_count integer not null default 0,
  room_count integer not null default 0,
  video_count integer not null default 0,
  has_floor_plan boolean not null default false,
  floor_plan_name text,
  starting_anchor text,
  reference_measurement text,
  reconstruction_engine text default 'Calibrated Geometric Twin',
  reconstruction_progress integer not null default 0,
  last_error_message text,
  reconstruction_model_stats jsonb
);

alter table public.projects enable row level security;

create policy "projects owned by user"
  on public.projects for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- rooms
create table if not exists public.rooms (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id text references public.projects (id) on delete set null,
  name text not null,
  category text not null,
  length_meters real not null,
  width_meters real not null,
  height_meters real not null,
  origin_description text not null default '',
  coordinate_convention text not null default 'Right-Handed Y-Up (Three.js standard)',
  connected_doorway_ids jsonb not null default '[]'::jsonb,
  features jsonb not null default '{}'::jsonb,
  reconstruction_dimension_estimate text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rooms enable row level security;

create policy "rooms owned by user"
  on public.rooms for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
-- ---------------------------------------------------------------- doorways
create table if not exists public.doorways (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id text references public.projects (id) on delete set null,
  name text not null,
  connected_room_ids jsonb not null default '[]'::jsonb,
  width_meters real not null,
  height_meters real not null,
  wall_location text,
  offset_meters real,
  has_clear_line_of_sight boolean not null default true,
  observations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.doorways enable row level security;

create policy "doorways owned by user"
  on public.doorways for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- photos
create table if not exists public.photos (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id text references public.projects (id) on delete cascade,
  filename text not null,
  room_id text,
  pass text,
  modality text,
  camera_pose_tag text,
  focal_length_mm real,
  sharpness_score integer,
  exposure_review text,
  overlap_review text,
  occlusion_flag boolean not null default false,
  doorway_anchor_id text,
  reviewer_notes text,
  uploaded_at timestamptz not null default now(),
  sort_order integer not null default 0,
  asset_path text,
  thumbnail_path text,
  metadata jsonb
);

alter table public.photos enable row level security;

create policy "photos owned by user"
  on public.photos for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- reconstruction jobs
create table if not exists public.reconstruction_jobs (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id text references public.projects (id) on delete cascade,
  status text not null default 'queued',
  stage text,
  progress integer not null default 0,
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  stats jsonb,
  assets jsonb,
  log_path text
);

alter table public.reconstruction_jobs enable row level security;

create policy "reconstruction_jobs owned by user"
  on public.reconstruction_jobs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- artifacts
create table if not exists public.artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id text not null references public.reconstruction_jobs (id) on delete cascade,
  kind text not null,
  storage_path text not null,
  content_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

alter table public.artifacts enable row level security;

create policy "artifacts owned by user"
  on public.artifacts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- storage bucket
insert into storage.buckets (id, name, public)
values ('reconstruction-artifacts', 'reconstruction-artifacts', false)
on conflict (id) do nothing;

create policy "artifact objects readable by owner"
  on storage.objects for select
  using (
    bucket_id = 'reconstruction-artifacts'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "artifact objects insertable by owner"
  on storage.objects for insert
  with check (
    bucket_id = 'reconstruction-artifacts'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "artifact objects deletable by owner"
  on storage.objects for delete
  using (
    bucket_id = 'reconstruction-artifacts'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ---------------------------------------------------------------- updated_at triggers
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  for t in select unnest(array['projects','rooms','doorways','reconstruction_jobs']) loop
    execute format('drop trigger if exists touch_%I on public.%I', t, t);
    execute format('create trigger touch_%I before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;