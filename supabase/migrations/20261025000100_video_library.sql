create extension if not exists pgcrypto;

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  placement text not null default 'project',
  published boolean not null default false,
  active_asset_id uuid,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.video_assets (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  provider text not null check (provider in ('mux', 'static_mp4')),
  external_id text unique,
  mux_upload_id text unique,
  mux_asset_id text unique,
  mux_playback_id text,
  playback_policy text check (playback_policy in ('public', 'signed')),
  source_url text,
  original_filename text,
  source_size_bytes bigint,
  source_sha256 text,
  upload_state text not null default 'not_started'
    check (upload_state in ('not_started', 'awaiting_upload', 'uploaded', 'failed', 'timed_out', 'cancelled')),
  asset_status text check (asset_status is null or asset_status in ('preparing', 'ready', 'errored', 'deleted')),
  processing_state text,
  duration_seconds numeric,
  aspect_ratio text,
  resolution_tier text,
  thumbnail_url text,
  poster_time_seconds numeric not null default 1.5,
  captions_url text,
  uploaded_at timestamptz,
  last_error text,
  last_mux_event_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_assets_provider_reference_check check (
    (provider = 'mux' and source_url is null) or
    (provider = 'static_mp4' and source_url is not null)
  )
);

alter table public.videos
  drop constraint if exists videos_active_asset_id_fkey;
alter table public.videos
  add constraint videos_active_asset_id_fkey
  foreign key (active_asset_id) references public.video_assets(id) on delete set null;

create index if not exists videos_placement_published_idx on public.videos (placement, published, sort_order);
create index if not exists video_assets_video_id_created_at_idx on public.video_assets (video_id, created_at desc);

create table if not exists public.mux_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text not null,
  payload jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text
);

create or replace function public.set_video_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists videos_set_updated_at on public.videos;
create trigger videos_set_updated_at before update on public.videos
for each row execute function public.set_video_updated_at();
drop trigger if exists video_assets_set_updated_at on public.video_assets;
create trigger video_assets_set_updated_at before update on public.video_assets
for each row execute function public.set_video_updated_at();

alter table public.videos enable row level security;
alter table public.video_assets enable row level security;
alter table public.mux_webhook_events enable row level security;

-- Browser-facing roles get no direct table access; Edge Functions own all reads/writes.
revoke all on public.videos from anon, authenticated;
revoke all on public.video_assets from anon, authenticated;
revoke all on public.mux_webhook_events from anon, authenticated;
