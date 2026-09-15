-- =====================================================================
--  Halloween Party Costume Voting — Supabase schema
--  Paste this whole file into the Supabase SQL Editor and press Run.
--  Safe to re-run: everything is idempotent.
--
--  AFTER RUNNING, edit the two marked lines in the "SEED" block at the
--  bottom to set your party date and admin PIN, then run just that block
--  again. (Or change them later from the admin page on your phone.)
-- =====================================================================

create extension if not exists pgcrypto;


-- ---------------------------------------------------------------------
--  TABLES
-- ---------------------------------------------------------------------

-- One row per year. Holds the voting window and your admin PIN.
create table if not exists public.parties (
  id                text        primary key,          -- e.g. '2026'
  name              text        not null,
  voting_opens_at   timestamptz not null default now(),
  voting_closes_at  timestamptz not null,
  results_public    boolean     not null default false, -- force an early reveal
  admin_pin         text,                              -- unreadable to guests (RLS)
  created_at        timestamptz not null default now()
);

-- The master guest list. Spans every year; keyed on phone number.
create table if not exists public.guests (
  id          uuid        primary key default gen_random_uuid(),
  full_name   text        not null,
  phone       text        not null unique,             -- normalized to 10 digits
  created_at  timestamptz not null default now()
);

-- Which guest showed up to which party.
create table if not exists public.attendance (
  party_id   text        not null references public.parties(id) on delete cascade,
  guest_id   uuid        not null references public.guests(id)  on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (party_id, guest_id)
);

-- A thing you can vote for: one solo costume, or one group costume.
create table if not exists public.entries (
  id            uuid        primary key default gen_random_uuid(),
  party_id      text        not null references public.parties(id) on delete cascade,
  owner_id      uuid        not null references public.guests(id)  on delete cascade,
  title         text        not null,
  photo_path    text,                                   -- path inside the 'costumes' bucket
  member_names  text[]      not null default '{}',      -- other real names in the group
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (party_id, owner_id)                           -- one entry per guest per year
);

-- One vote per guest per year. Re-voting overwrites the row.
create table if not exists public.votes (
  party_id   text        not null references public.parties(id)  on delete cascade,
  voter_id   uuid        not null references public.guests(id)   on delete cascade,
  entry_id   uuid        not null references public.entries(id)  on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (party_id, voter_id)
);

create index if not exists entries_party_idx on public.entries (party_id);
create index if not exists votes_entry_idx   on public.votes   (entry_id);


-- ---------------------------------------------------------------------
--  LOCK EVERYTHING DOWN
--  RLS on with zero policies = the public anon key cannot read or write
--  these tables at all. Every legitimate action goes through one of the
--  security-definer functions below, which enforce the party rules.
-- ---------------------------------------------------------------------

alter table public.parties    enable row level security;
alter table public.guests     enable row level security;
alter table public.attendance enable row level security;
alter table public.entries    enable row level security;
alter table public.votes      enable row level security;


-- ---------------------------------------------------------------------
--  HELPERS
-- ---------------------------------------------------------------------

-- "  Mary   Jane  " -> "mary jane"   (for matching names to each other)
create or replace function public.norm_name(t text)
returns text language sql immutable as $$
  select lower(btrim(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g')))
$$;

-- "(555) 123-4567" -> "5551234567" ; also strips a leading US country code
create or replace function public.norm_phone(t text)
returns text language sql immutable as $$
  select case
           when length(d) = 11 and left(d, 1) = '1' then right(d, 10)
           else d
         end
  from (select regexp_replace(coalesce(t, ''), '\D', '', 'g') as d) s
$$;

-- Tidy a free-typed name for storage: collapse spaces, trim.
create or replace function public.clean_text(t text)
returns text language sql immutable as $$
  select btrim(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g'))
$$;

create or replace function public.assert_admin(p_party text, p_pin text)
returns public.parties language plpgsql security definer set search_path = public as $$
declare p public.parties;
begin
  select * into p from public.parties where id = p_party;
  if p.id is null then
    raise exception 'Unknown party "%".', p_party;
  end if;
  if p.admin_pin is null or length(p.admin_pin) = 0 then
    raise exception 'No admin PIN is set for this party yet.';
  end if;
  if p_pin is null or p_pin <> p.admin_pin then
    raise exception 'Wrong PIN.';
  end if;
  return p;
end $$;


-- ---------------------------------------------------------------------
--  PUBLIC API  (callable with the anon key)
-- ---------------------------------------------------------------------

-- Party status + server clock, so the countdown ignores wrong phone clocks.
create or replace function public.party_info(p_party text)
returns json language plpgsql security definer set search_path = public as $$
declare p public.parties;
begin
  select * into p from public.parties where id = p_party;
  if p.id is null then
    raise exception 'Unknown party "%".', p_party;
  end if;
  return json_build_object(
    'id',          p.id,
    'name',        p.name,
    'opens_at',    p.voting_opens_at,
    'closes_at',   p.voting_closes_at,
    'revealed',    p.results_public or now() > p.voting_closes_at,
    'open',        now() between p.voting_opens_at and p.voting_closes_at,
    'server_now',  now(),
    'entry_count', (select count(*) from public.entries where party_id = p.id),
    'guest_count', (select count(*) from public.attendance where party_id = p.id),
    'vote_count',  (select count(*) from public.votes where party_id = p.id)
  );
end $$;

-- Step 1: check in. Creates or updates the master guest record, marks
-- attendance for this year, and tells the app what this guest already did.
create or replace function public.join_party(p_party text, p_name text, p_phone text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_phone text;
  v_name  text;
  g       public.guests;
  e       public.entries;
  v_vote  uuid;
  v_listed json;
begin
  if not exists (select 1 from public.parties where id = p_party) then
    raise exception 'Unknown party "%".', p_party;
  end if;

  v_name  := clean_text(p_name);
  v_phone := norm_phone(p_phone);

  if length(v_name) < 2 or position(' ' in v_name) = 0 then
    raise exception 'Please enter your first and last name.';
  end if;
  if length(v_phone) <> 10 then
    raise exception 'Please enter a 10-digit US phone number.';
  end if;

  insert into public.guests (full_name, phone)
  values (v_name, v_phone)
  on conflict (phone) do update set full_name = excluded.full_name
  returning * into g;

  insert into public.attendance (party_id, guest_id)
  values (p_party, g.id)
  on conflict do nothing;

  select * into e from public.entries where party_id = p_party and owner_id = g.id;
  select entry_id into v_vote from public.votes where party_id = p_party and voter_id = g.id;

  -- Someone else may have already listed this guest in a group costume.
  -- Surfacing it stops two people entering the same group twice.
  select json_build_object('id', e2.id, 'title', e2.title, 'owner_name', g2.full_name)
    into v_listed
  from public.entries e2
  join public.guests g2 on g2.id = e2.owner_id
  where e2.party_id = p_party
    and e2.owner_id <> g.id
    and exists (select 1 from unnest(e2.member_names) m where norm_name(m) = norm_name(g.full_name))
  limit 1;

  return json_build_object(
    'guest', json_build_object('id', g.id, 'full_name', g.full_name, 'phone', g.phone),
    'entry', case when e.id is null then null else json_build_object(
                'id',           e.id,
                'title',        e.title,
                'photo_path',   e.photo_path,
                'member_names', e.member_names) end,
    'voted_entry_id', v_vote,
    'listed_in',      v_listed
  );
end $$;

-- Step 2: create or update this guest's costume entry.
create or replace function public.save_entry(
  p_party text, p_guest uuid, p_title text,
  p_photo_path text, p_members text[]
) returns json language plpgsql security definer set search_path = public as $$
declare
  p         public.parties;
  e         public.entries;
  v_title   text;
  v_members text[];
begin
  select * into p from public.parties where id = p_party;
  if p.id is null then
    raise exception 'Unknown party "%".', p_party;
  end if;
  if now() > p.voting_closes_at then
    raise exception 'Voting has closed, so costumes are locked.';
  end if;
  if not exists (select 1 from public.attendance where party_id = p_party and guest_id = p_guest) then
    raise exception 'Check in with your name and number first.';
  end if;

  v_title := clean_text(p_title);
  if length(v_title) < 2 then
    raise exception 'Give your costume a name.';
  end if;

  select coalesce(array_agg(distinct s.x), '{}'::text[]) into v_members
  from (
    select clean_text(m) as x
    from unnest(coalesce(p_members, '{}'::text[])) as m
  ) s
  where length(s.x) > 1
    and norm_name(s.x) <> (select norm_name(full_name) from public.guests where id = p_guest);

  insert into public.entries (party_id, owner_id, title, photo_path, member_names)
  values (p_party, p_guest, v_title, nullif(p_photo_path, ''), v_members)
  on conflict (party_id, owner_id) do update
    set title        = excluded.title,
        photo_path   = excluded.photo_path,
        member_names = excluded.member_names,
        updated_at   = now()
  returning * into e;

  return json_build_object(
    'id', e.id, 'title', e.title,
    'photo_path', e.photo_path, 'member_names', e.member_names
  );
end $$;

-- The dashboard list. Vote counts come back as null until the reveal, so
-- the numbers are not merely hidden in the UI — they never reach the phone.
create or replace function public.list_entries(p_party text, p_guest uuid default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  p        public.parties;
  v_reveal boolean;
  v_name   text;
begin
  select * into p from public.parties where id = p_party;
  if p.id is null then
    raise exception 'Unknown party "%".', p_party;
  end if;

  v_reveal := p.results_public or now() > p.voting_closes_at;
  select norm_name(full_name) into v_name from public.guests where id = p_guest;

  return (
    select coalesce(json_agg(s.j order by s.rank_votes desc, s.created_at asc), '[]'::json)
    from (
      select json_build_object(
               'id',           e.id,
               'title',        e.title,
               'photo_path',   e.photo_path,
               'member_names', e.member_names,
               'owner_name',   g.full_name,
               'is_group',     array_length(e.member_names, 1) is not null,
               'is_mine',      (e.owner_id = p_guest)
                                 or (v_name is not null and exists (
                                       select 1 from unnest(e.member_names) m
                                       where norm_name(m) = v_name)),
               'votes',        case when v_reveal then coalesce(vc.c, 0) else null end
             ) as j,
             case when v_reveal then coalesce(vc.c, 0) else 0 end as rank_votes,
             e.created_at
      from public.entries e
      join public.guests g on g.id = e.owner_id
      left join (
        select entry_id, count(*)::int as c
        from public.votes where party_id = p_party group by entry_id
      ) vc on vc.entry_id = e.id
      where e.party_id = p_party
    ) s
  );
end $$;

-- Cast or change a vote. All the rules live here, not in the browser.
create or replace function public.cast_vote(p_party text, p_guest uuid, p_entry uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  p      public.parties;
  e      public.entries;
  v_name text;
begin
  select * into p from public.parties where id = p_party;
  if p.id is null then
    raise exception 'Unknown party "%".', p_party;
  end if;
  if now() < p.voting_opens_at then
    raise exception 'Voting has not opened yet.';
  end if;
  if now() > p.voting_closes_at then
    raise exception 'Voting is closed.';
  end if;
  if not exists (select 1 from public.attendance where party_id = p_party and guest_id = p_guest) then
    raise exception 'Check in with your name and number first.';
  end if;

  select * into e from public.entries where id = p_entry and party_id = p_party;
  if e.id is null then
    raise exception 'That costume is no longer listed.';
  end if;

  select norm_name(full_name) into v_name from public.guests where id = p_guest;
  if e.owner_id = p_guest
     or exists (select 1 from unnest(e.member_names) m where norm_name(m) = v_name) then
    raise exception 'You cannot vote for your own costume.';
  end if;

  insert into public.votes (party_id, voter_id, entry_id)
  values (p_party, p_guest, p_entry)
  on conflict (party_id, voter_id) do update
    set entry_id = excluded.entry_id, updated_at = now();

  return json_build_object('voted_entry_id', p_entry);
end $$;

-- Results. Open to everyone once voting closes; before that, only with the PIN.
create or replace function public.get_results(p_party text, p_pin text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  p       public.parties;
  v_admin boolean;
  v_open  boolean;
begin
  select * into p from public.parties where id = p_party;
  if p.id is null then
    raise exception 'Unknown party "%".', p_party;
  end if;

  v_admin := p_pin is not null and p.admin_pin is not null and p_pin = p.admin_pin;
  v_open  := p.results_public or now() > p.voting_closes_at;

  if not (v_admin or v_open) then
    raise exception 'Results are hidden until voting closes.';
  end if;

  return json_build_object(
    'party', json_build_object(
      'id', p.id, 'name', p.name,
      'closes_at', p.voting_closes_at,
      'results_public', p.results_public,
      'revealed', v_open,
      'server_now', now()),
    'is_admin',    v_admin,
    'guest_count', (select count(*) from public.attendance where party_id = p.id),
    'vote_count',  (select count(*) from public.votes where party_id = p.id),
    'entries', (
      select coalesce(json_agg(s.j order by s.c desc, s.title asc), '[]'::json)
      from (
        select json_build_object(
                 'id',           e.id,
                 'title',        e.title,
                 'photo_path',   e.photo_path,
                 'member_names', e.member_names,
                 'owner_name',   g.full_name,
                 'votes',        coalesce(vc.c, 0),
                 -- who voted for it: admins only
                 'voters', case when v_admin then (
                     select coalesce(json_agg(vg.full_name order by vg.full_name), '[]'::json)
                     from public.votes v
                     join public.guests vg on vg.id = v.voter_id
                     where v.entry_id = e.id
                   ) else null end
               ) as j,
               coalesce(vc.c, 0) as c,
               e.title
        from public.entries e
        join public.guests g on g.id = e.owner_id
        left join (
          select entry_id, count(*)::int as c
          from public.votes where party_id = p.id group by entry_id
        ) vc on vc.entry_id = e.id
        where e.party_id = p.id
      ) s
    )
  );
end $$;


-- ---------------------------------------------------------------------
--  ADMIN API  (every call needs the PIN)
-- ---------------------------------------------------------------------

create or replace function public.admin_set_close(p_party text, p_pin text, p_closes_at timestamptz)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin(p_party, p_pin);
  update public.parties set voting_closes_at = p_closes_at where id = p_party;
  return json_build_object('closes_at', p_closes_at);
end $$;

create or replace function public.admin_set_reveal(p_party text, p_pin text, p_reveal boolean)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin(p_party, p_pin);
  update public.parties set results_public = p_reveal where id = p_party;
  return json_build_object('results_public', p_reveal);
end $$;

create or replace function public.admin_delete_entry(p_party text, p_pin text, p_entry uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin(p_party, p_pin);
  delete from public.entries where id = p_entry and party_id = p_party;
  return json_build_object('deleted', p_entry);
end $$;

-- The master guest list, across every year. Feeds the CSV export.
create or replace function public.admin_guests(p_party text, p_pin text)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin(p_party, p_pin);
  return (
    select coalesce(json_agg(j order by nm), '[]'::json)
    from (
      select json_build_object(
               'id',         g.id,
               'full_name',  g.full_name,
               'phone',      g.phone,
               'first_seen', g.created_at,
               'years',      (select coalesce(array_agg(a.party_id order by a.party_id), '{}')
                              from public.attendance a where a.guest_id = g.id),
               'here_now',   exists (select 1 from public.attendance a
                                     where a.guest_id = g.id and a.party_id = p_party),
               'entry',      (select e.title from public.entries e
                              where e.owner_id = g.id and e.party_id = p_party),
               'voted',      exists (select 1 from public.votes v
                                     where v.voter_id = g.id and v.party_id = p_party)
             ) as j,
             norm_name(g.full_name) as nm
      from public.guests g
    ) s
  );
end $$;


-- ---------------------------------------------------------------------
--  GRANTS — the anon key may only call these functions, nothing else.
-- ---------------------------------------------------------------------

revoke all on function public.assert_admin(text, text) from public, anon, authenticated;

grant execute on function public.party_info(text)                        to anon, authenticated;
grant execute on function public.join_party(text, text, text)            to anon, authenticated;
grant execute on function public.save_entry(text, uuid, text, text, text[]) to anon, authenticated;
grant execute on function public.list_entries(text, uuid)                to anon, authenticated;
grant execute on function public.cast_vote(text, uuid, uuid)             to anon, authenticated;
grant execute on function public.get_results(text, text)                 to anon, authenticated;
grant execute on function public.admin_set_close(text, text, timestamptz) to anon, authenticated;
grant execute on function public.admin_set_reveal(text, text, boolean)   to anon, authenticated;
grant execute on function public.admin_delete_entry(text, text, uuid)    to anon, authenticated;
grant execute on function public.admin_guests(text, text)                to anon, authenticated;


-- ---------------------------------------------------------------------
--  PHOTO STORAGE — a public bucket guests may add to but not overwrite.
-- ---------------------------------------------------------------------

-- Photos are shrunk on the phone before upload, so a 5MB ceiling is generous.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('costumes', 'costumes', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = true,
      file_size_limit    = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "costume photos are readable" on storage.objects;
create policy "costume photos are readable"
  on storage.objects for select
  using (bucket_id = 'costumes');

drop policy if exists "guests may upload costume photos" on storage.objects;
create policy "guests may upload costume photos"
  on storage.objects for insert
  with check (bucket_id = 'costumes');


-- =====================================================================
--  SEED — EDIT THESE TWO LINES
--  You can also change both later from the admin page on your phone.
-- =====================================================================

insert into public.parties (id, name, voting_closes_at, admin_pin)
values (
  '2026',
  'Halloween 2026',
  -- 1. When voting closes. Change the date/time or the timezone name.
  (timestamp '2026-10-24 22:00') at time zone 'America/New_York',
  -- 2. Your admin PIN. Change it. Guests can never read this column.
  '1031'
)
on conflict (id) do nothing;

-- Already seeded and want to change them? Run this instead:
--   update public.parties
--      set voting_closes_at = (timestamp '2026-10-24 22:00') at time zone 'America/New_York',
--          admin_pin        = '1031'
--    where id = '2026';
