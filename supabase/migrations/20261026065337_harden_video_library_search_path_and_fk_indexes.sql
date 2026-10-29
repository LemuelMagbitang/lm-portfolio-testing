-- Lock down the search path used by trigger code. The function only uses pg_catalog built-ins and NEW.
alter function public.set_video_updated_at() set search_path = pg_catalog;

-- Index referencing columns so parent updates/deletes and joins do not scan the full videos table.
create index if not exists videos_active_asset_id_idx
  on public.videos (active_asset_id);

create index if not exists videos_created_by_idx
  on public.videos (created_by);
