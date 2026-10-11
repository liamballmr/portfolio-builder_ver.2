create extension if not exists pgcrypto;

create table if not exists public.portfolio_sites (
  id uuid primary key default '00000000-0000-4000-8000-000000000001',
  owner_id uuid unique references auth.users(id) on delete restrict,
  current_publication_id uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.portfolio_drafts (
  site_id uuid primary key references public.portfolio_sites(id) on delete cascade,
  content jsonb not null,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists public.portfolio_assets (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.portfolio_sites(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 15728640),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  alt_text text not null default '',
  caption text not null default '',
  focus_x numeric(5,2) not null default 50 check (focus_x between 0 and 100),
  focus_y numeric(5,2) not null default 50 check (focus_y between 0 and 100),
  status text not null default 'ready' check (status in ('ready', 'processing', 'failed')),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id)
);

create table if not exists public.portfolio_publications (
  id uuid primary key,
  site_id uuid not null references public.portfolio_sites(id) on delete cascade,
  version integer not null,
  content jsonb not null,
  format_version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  unique (site_id, version)
);

create table if not exists public.portfolio_publication_assets (
  publication_id uuid not null references public.portfolio_publications(id) on delete restrict,
  asset_id uuid not null references public.portfolio_assets(id) on delete restrict,
  storage_path text not null unique,
  primary key (publication_id, asset_id)
);

alter table public.portfolio_sites
  drop constraint if exists portfolio_sites_current_publication_id_fkey;
alter table public.portfolio_sites
  add constraint portfolio_sites_current_publication_id_fkey
  foreign key (current_publication_id)
  references public.portfolio_publications(id)
  on delete restrict;

insert into public.portfolio_sites (id)
values ('00000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;

insert into public.portfolio_drafts (site_id, content)
values (
  '00000000-0000-4000-8000-000000000001',
  '{
    "profile": {
      "name": "Liam",
      "bookTitle": "Portfolio",
      "descriptor": "Independent practice · 2026",
      "coverTitle": "Selected work,\nthoughtfully made.",
      "coverIntro": "A collection of ideas, experiments, and outcomes.",
      "year": "2026",
      "coverAssetId": ""
    },
    "chapters": [
      {
        "id": "about-liam",
        "section": "about",
        "type": "text",
        "eyebrow": "A LITTLE ABOUT ME",
        "title": "Hello, I’m Liam.",
        "year": "",
        "role": "",
        "summary": "",
        "body": {"type":"doc","content":[
          {"type":"paragraph","content":[{"type":"text","text":"This space is for a short, personal introduction: what Liam cares about, how he likes to work, and the kinds of problems he enjoys solving."}]},
          {"type":"paragraph","content":[{"type":"text","text":"The final biography and any professional details should be supplied and approved by Liam."}]}
        ]},
        "assetIds": [],
        "externalUrl": "",
        "startNewPage": true
      },
      {
        "id": "project-one",
        "section": "project",
        "type": "opening",
        "eyebrow": "PROJECT 01 · OPENING",
        "title": "A project, from first question to final form.",
        "year": "Year not provided",
        "role": "Role not provided",
        "summary": "A concise introduction to a selected piece of work will go here.",
        "body": {"type":"doc","content":[
          {"type":"paragraph","content":[{"type":"text","text":"Describe the task, the people it served, and the constraints that shaped the work. Keep the context clear before introducing the solution."}]},
          {"type":"paragraph","content":[{"type":"text","text":"A useful case study makes the reasoning visible, not just the finished screen."}]}
        ]},
        "assetIds": [],
        "externalUrl": "",
        "startNewPage": true
      }
    ],
    "contact": {
      "title": "Let’s make something meaningful.",
      "message": "For project enquiries, collaborations, or a good conversation:",
      "email": "",
      "links": []
    }
  }'::jsonb
)
on conflict (site_id) do nothing;

alter table public.portfolio_sites enable row level security;
alter table public.portfolio_drafts enable row level security;
alter table public.portfolio_assets enable row level security;
alter table public.portfolio_publications enable row level security;
alter table public.portfolio_publication_assets enable row level security;

revoke all on table public.portfolio_sites, public.portfolio_drafts,
  public.portfolio_assets, public.portfolio_publications,
  public.portfolio_publication_assets from anon, authenticated;
grant select on table public.portfolio_sites, public.portfolio_drafts,
  public.portfolio_assets, public.portfolio_publications,
  public.portfolio_publication_assets to authenticated;
grant insert, update, delete on table public.portfolio_assets to authenticated;

create policy "Owner can read portfolio site"
  on public.portfolio_sites for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "Owner can read portfolio draft"
  on public.portfolio_drafts for select to authenticated
  using (exists (
    select 1 from public.portfolio_sites s
    where s.id = site_id and s.owner_id = (select auth.uid())
  ));

create policy "Owner can manage portfolio assets"
  on public.portfolio_assets for all to authenticated
  using (exists (
    select 1 from public.portfolio_sites s
    where s.id = site_id and s.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.portfolio_sites s
    where s.id = site_id and s.owner_id = (select auth.uid())
  ));

create policy "Owner can read portfolio publications"
  on public.portfolio_publications for select to authenticated
  using (exists (
    select 1 from public.portfolio_sites s
    where s.id = site_id and s.owner_id = (select auth.uid())
  ));

create policy "Owner can read publication asset links"
  on public.portfolio_publication_assets for select to authenticated
  using (exists (
    select 1
    from public.portfolio_publications p
    join public.portfolio_sites s on s.id = p.site_id
    where p.id = publication_id and s.owner_id = (select auth.uid())
  ));

create or replace function public.save_portfolio_draft(
  p_expected_revision integer,
  p_content jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision integer;
  v_site_id uuid := '00000000-0000-4000-8000-000000000001';
begin
  if auth.uid() is null or not exists (
    select 1 from public.portfolio_sites s
    where s.id = v_site_id and s.owner_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'Not authorized to edit this portfolio.';
  end if;

  if jsonb_typeof(p_content) is distinct from 'object'
    or jsonb_typeof(p_content->'profile') is distinct from 'object'
    or jsonb_typeof(p_content->'chapters') is distinct from 'array'
    or jsonb_typeof(p_content->'contact') is distinct from 'object'
    or jsonb_array_length(p_content->'chapters') > 100 then
    raise exception using errcode = '22023', message = 'Portfolio content has an invalid structure.';
  end if;

  update public.portfolio_drafts
  set content = p_content,
      revision = revision + 1,
      updated_at = now(),
      updated_by = auth.uid()
  where site_id = v_site_id
    and revision = p_expected_revision
  returning revision into v_revision;

  if v_revision is null then
    raise exception using errcode = '40001', message = 'Draft changed in another session. Reload before saving.';
  end if;
  return v_revision;
end;
$$;

create or replace function public.publish_portfolio_draft(
  p_publication_id uuid,
  p_expected_revision integer,
  p_assets jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid := '00000000-0000-4000-8000-000000000001';
  v_draft public.portfolio_drafts%rowtype;
  v_version integer;
  v_content jsonb;
  v_asset_count integer;
  v_expected_ids uuid[];
  v_received_ids uuid[];
begin
  if auth.uid() is null or not exists (
    select 1 from public.portfolio_sites s
    where s.id = v_site_id and s.owner_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'Not authorized to publish this portfolio.';
  end if;

  select * into v_draft
  from public.portfolio_drafts
  where site_id = v_site_id
  for update;

  if not found or v_draft.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'Draft changed in another session. Reload before publishing.';
  end if;
  if jsonb_typeof(p_assets) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Publication media manifest is invalid.';
  end if;

  select coalesce(array_agg(distinct (item.value #>> '{}')::uuid), '{}'::uuid[])
  into v_expected_ids
  from jsonb_path_query(v_draft.content, '$.chapters[*].assetIds[*]') as item(value);

  if coalesce(v_draft.content #>> '{profile,coverAssetId}', '') <> '' then
    v_expected_ids := array_append(v_expected_ids, (v_draft.content #>> '{profile,coverAssetId}')::uuid);
  end if;
  select coalesce(array_agg(distinct (item->>'id')::uuid), '{}'::uuid[])
  into v_received_ids
  from jsonb_array_elements(p_assets) as item;

  if exists (select unnest(v_expected_ids) except select unnest(v_received_ids))
    or exists (select unnest(v_received_ids) except select unnest(v_expected_ids)) then
    raise exception using errcode = '22023', message = 'Publication media does not match the saved draft.';
  end if;

  -- The publication pointer is only advanced after every public derivative exists.
  select count(*) into v_asset_count
  from jsonb_array_elements(p_assets) as staged(item)
  join public.portfolio_assets a on a.id = (staged.item->>'id')::uuid and a.site_id = v_site_id
  join storage.objects o
    on o.bucket_id = 'portfolio-published'
   and o.name = staged.item->>'path'
   and staged.item->>'path' = (p_publication_id::text || '/' || a.id::text || '.webp')
  where a.status = 'ready' and a.alt_text <> '';

  if v_asset_count <> cardinality(v_received_ids) then
    raise exception using errcode = '22023', message = 'An image is missing, has no alternative text, or is not ready to publish.';
  end if;

  select coalesce(jsonb_object_agg(
    a.id::text,
    jsonb_build_object(
      'path', staged.item->>'path',
      'altText', a.alt_text,
      'caption', a.caption,
      'width', a.width,
      'height', a.height,
      'focusX', a.focus_x,
      'focusY', a.focus_y
    )
  ), '{}'::jsonb)
  into v_content
  from jsonb_array_elements(p_assets) as staged(item)
  join public.portfolio_assets a on a.id = (staged.item->>'id')::uuid;

  v_content := jsonb_set(v_draft.content, '{publishedAssets}', v_content, true);
  select coalesce(max(version), 0) + 1 into v_version
  from public.portfolio_publications where site_id = v_site_id;

  insert into public.portfolio_publications (id, site_id, version, content, created_by)
  values (p_publication_id, v_site_id, v_version, v_content, auth.uid());

  insert into public.portfolio_publication_assets (publication_id, asset_id, storage_path)
  select p_publication_id, (item->>'id')::uuid, item->>'path'
  from jsonb_array_elements(p_assets) as item;

  update public.portfolio_sites
  set current_publication_id = p_publication_id, updated_at = now()
  where id = v_site_id;

  return jsonb_build_object('id', p_publication_id, 'version', v_version, 'publishedAt', now());
end;
$$;

create or replace function public.set_portfolio_publication(p_publication_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid := '00000000-0000-4000-8000-000000000001';
begin
  if auth.uid() is null or not exists (
    select 1 from public.portfolio_sites s
    where s.id = v_site_id and s.owner_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'Not authorized to change the published version.';
  end if;
  if not exists (
    select 1 from public.portfolio_publications p
    where p.id = p_publication_id and p.site_id = v_site_id
  ) then
    raise exception using errcode = '22023', message = 'Publication was not found.';
  end if;
  update public.portfolio_sites
  set current_publication_id = p_publication_id, updated_at = now()
  where id = v_site_id;
end;
$$;

create or replace function public.get_portfolio_publication()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p.id is null then null else jsonb_build_object(
    'id', p.id,
    'version', p.version,
    'publishedAt', p.created_at,
    'content', p.content
  ) end
  from public.portfolio_sites s
  left join public.portfolio_publications p on p.id = s.current_publication_id
  where s.id = '00000000-0000-4000-8000-000000000001';
$$;

revoke all on function public.save_portfolio_draft(integer, jsonb) from public, anon;
revoke all on function public.publish_portfolio_draft(uuid, integer, jsonb) from public, anon;
revoke all on function public.set_portfolio_publication(uuid) from public, anon;
revoke all on function public.get_portfolio_publication() from public;
grant execute on function public.save_portfolio_draft(integer, jsonb) to authenticated;
grant execute on function public.publish_portfolio_draft(uuid, integer, jsonb) to authenticated;
grant execute on function public.set_portfolio_publication(uuid) to authenticated;
grant execute on function public.get_portfolio_publication() to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('portfolio-drafts', 'portfolio-drafts', false, 15728640, array['image/jpeg', 'image/png', 'image/webp']),
  ('portfolio-published', 'portfolio-published', true, 15728640, array['image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Owner can read private portfolio images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'portfolio-drafts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.portfolio_sites s where s.owner_id = (select auth.uid()))
  );

create policy "Owner can upload private portfolio images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'portfolio-drafts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.portfolio_sites s where s.owner_id = (select auth.uid()))
  );

create policy "Owner can remove private portfolio images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'portfolio-drafts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.portfolio_sites s where s.owner_id = (select auth.uid()))
  );

create policy "Owner can add publication images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'portfolio-published'
    and exists (select 1 from public.portfolio_sites s where s.owner_id = (select auth.uid()))
  );

create policy "Owner can clean unpublished staged images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'portfolio-published'
    and exists (select 1 from public.portfolio_sites s where s.owner_id = (select auth.uid()))
    and not exists (
      select 1 from public.portfolio_publication_assets pa
      where pa.storage_path = name
    )
  );
