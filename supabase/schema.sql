-- =====================================================================
--  Halloween Party Costume Voting — Supabase schema
--  Paste this whole file into the Supabase SQL Editor and press Run.
--  Safe to re-run: everything is idempotent, including against a database
--  that already has an earlier version of this schema (see MIGRATIONS).
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

-- The master guest list. Spans every year; keyed on phone number. Never
-- deleted between parties — this is the persistent record + invite list.
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

-- A thing you can vote for: one solo costume, or one group costume. The
-- group/solo name lives here (e.g. "Alice in Wonderland"); who's actually
-- in it, and what each of them is wearing, lives in entry_members below.
create table if not exists public.entries (
  id            uuid        primary key default gen_random_uuid(),
  party_id      text        not null references public.parties(id) on delete cascade,
  owner_id      uuid        not null references public.guests(id)  on delete cascade,
  title         text        not null,
  photo_path    text,                                   -- path inside the 'costumes' bucket
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One row per guest per entry: their own individual costume/role (e.g.
-- "Mad Hatter") within that entry's group (or solo) name. A guest has at
-- most one membership per party, so this doubles as "what did this guest
-- wear, in which group, this year" — the persistent costume history.
create table if not exists public.entry_members (
  party_id      text        not null references public.parties(id) on delete cascade,
  guest_id      uuid        not null references public.guests(id)  on delete cascade,
  entry_id      uuid        not null references public.entries(id) on delete cascade,
  costume_name  text        not null,
  is_owner      boolean     not null default false,     -- started this entry (can rename it / set its photo)
  joined_at     timestamptz not null default now(),
  primary key (party_id, guest_id)                      -- one costume per guest per year
);

-- One vote per guest per year. Re-voting overwrites the row. Unlike
-- guests/entries/entry_members, this is not meant to be kept forever —
-- see the README's "Multi-year usage" section for an optional cleanup
-- query once a year's results are recorded.
create table if not exists public.votes (
  party_id   text        not null references public.parties(id)  on delete cascade,
  voter_id   uuid        not null references public.guests(id)   on delete cascade,
  entry_id   uuid        not null references public.entries(id)  on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (party_id, voter_id)
);

create index if not exists entries_party_idx       on public.entries       (party_id);
create index if not exists entry_members_entry_idx on public.entry_members (entry_id);
create index if not exists votes_entry_idx         on public.votes         (entry_id);


-- ---------------------------------------------------------------------
--  MIGRATIONS — upgrades an already-deployed database; no-ops on a fresh
--  install (nothing above created the old column/function, so these
--  "if exists" statements simply find nothing to do).
-- ---------------------------------------------------------------------

-- Replaced by entry_members: each guest's own costume now has its own row
-- instead of being a free-text name in the group owner's entry.
alter table public.entries drop column if exists member_names;
drop function if exists public.save_entry(text, uuid, text, text, text[]);


-- ---------------------------------------------------------------------
--  LOCK EVERYTHING DOWN
--  RLS on with zero policies = the public key cannot read or write these
--  tables at all. Every legitimate action goes through one of the
--  security-definer functions below, which enforce the party rules.
-- ---------------------------------------------------------------------

alter table public.parties       enable row level security;
alter table public.guests        enable row level security;
alter table public.attendance    enable row level security;
alter table public.entries       enable row level security;
alter table public.entry_members enable row level security;
alter table public.votes         enable row level security;


-- ---------------------------------------------------------------------
--  HELPERS
-- ---------------------------------------------------------------------

-- "  Mary   Jane  " -> "mary jane"   (case-insensitive sort/compare key)
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

-- Every member of an entry, as {name, costume_name, is_owner}, owner first
-- then alphabetical. Shared by list_entries, get_results, and join_party.
create or replace function public.entry_roster(p_entry uuid)
returns json language sql stable as $$
  select coalesce(json_agg(json_build_object(
           'name', g.full_name, 'costume_name', em.costume_name, 'is_owner', em.is_owner
         ) order by em.is_owner desc, g.full_name), '[]'::json)
  from public.entry_members em
  join public.guests g on g.id = em.guest_id
  where em.entry_id = p_entry
$$;


-- ---------------------------------------------------------------------
--  PUBLIC API  (callable with the publishable key)
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
-- attendance for this year, and hands back this guest's existing costume
-- entry (if any), so the app can skip straight to the dashboard.
create or replace function public.join_party(p_party text, p_name text, p_phone text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_phone      text;
  v_name       text;
  g            public.guests;
  v_membership json;
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

  select json_build_object(
           'entry_id',     e.id,
           'title',        e.title,
           'photo_path',   e.photo_path,
           'is_owner',     em.is_owner,
           'costume_name', em.costume_name,
           'members',      entry_roster(e.id)
         )
    into v_membership
  from public.entry_members em
  join public.entries e on e.id = em.entry_id
  where em.party_id = p_party and em.guest_id = g.id;

  return json_build_object(
    'guest',          json_build_object('id', g.id, 'full_name', g.full_name, 'phone', g.phone),
    'membership',     v_membership,
    'voted_entry_id', (select entry_id from public.votes where party_id = p_party and voter_id = g.id)
  );
end $$;

-- Start a brand-new entry: a solo costume, or the first person in a new
-- group. p_costume_name is this guest's own individual costume/role — for
-- a solo entry that's usually the same as p_title, so it defaults to it
-- when left blank.
create or replace function public.create_entry(
  p_party text, p_guest uuid, p_title text,
  p_costume_name text, p_photo_path text
) returns json language plpgsql security definer set search_path = public as $$
declare
  p         public.parties;
  e         public.entries;
  v_title   text;
  v_costume text;
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
  if exists (select 1 from public.entry_members where party_id = p_party and guest_id = p_guest) then
    raise exception 'You already have a costume entered this year — edit it from the menu instead.';
  end if;

  v_title := clean_text(p_title);
  if length(v_title) < 2 then
    raise exception 'Give your costume (or group) a name.';
  end if;

  v_costume := clean_text(p_costume_name);
  if length(v_costume) < 1 then
    v_costume := v_title;
  end if;

  insert into public.entries (party_id, owner_id, title, photo_path)
  values (p_party, p_guest, v_title, nullif(p_photo_path, ''))
  returning * into e;

  insert into public.entry_members (party_id, guest_id, entry_id, costume_name, is_owner)
  values (p_party, p_guest, e.id, v_costume, true);

  return json_build_object(
    'entry_id', e.id, 'title', e.title, 'photo_path', e.photo_path,
    'costume_name', v_costume, 'is_owner', true, 'members', entry_roster(e.id)
  );
end $$;

-- Join a group costume someone else already started, with your own
-- individual costume/role inside it (e.g. "White Rabbit").
create or replace function public.join_entry(
  p_party text, p_guest uuid, p_entry uuid, p_costume_name text
) returns json language plpgsql security definer set search_path = public as $$
declare
  p         public.parties;
  e         public.entries;
  v_costume text;
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
  if exists (select 1 from public.entry_members where party_id = p_party and guest_id = p_guest) then
    raise exception 'You already have a costume entered this year — edit it from the menu instead.';
  end if;

  select * into e from public.entries where id = p_entry and party_id = p_party;
  if e.id is null then
    raise exception 'That costume group no longer exists.';
  end if;

  v_costume := clean_text(p_costume_name);
  if length(v_costume) < 1 then
    raise exception 'What are you dressed as in this group?';
  end if;

  insert into public.entry_members (party_id, guest_id, entry_id, costume_name, is_owner)
  values (p_party, p_guest, e.id, v_costume, false);

  return json_build_object(
    'entry_id', e.id, 'title', e.title, 'photo_path', e.photo_path,
    'costume_name', v_costume, 'is_owner', false, 'members', entry_roster(e.id)
  );
end $$;

-- Rename the entry's group/solo title and/or swap its photo. Only the
-- person who started it can do this — everyone else edits their own
-- costume name with update_my_costume instead.
create or replace function public.update_entry(
  p_party text, p_guest uuid, p_title text, p_photo_path text
) returns json language plpgsql security definer set search_path = public as $$
declare
  p       public.parties;
  em      public.entry_members;
  e       public.entries;
  v_title text;
begin
  select * into p from public.parties where id = p_party;
  if p.id is null then
    raise exception 'Unknown party "%".', p_party;
  end if;
  if now() > p.voting_closes_at then
    raise exception 'Voting has closed, so costumes are locked.';
  end if;

  select * into em from public.entry_members where party_id = p_party and guest_id = p_guest;
  if em.entry_id is null then
    raise exception 'You have not entered a costume yet.';
  end if;
  if not em.is_owner then
    raise exception 'Only the person who started this group can rename it or change its photo.';
  end if;

  v_title := clean_text(p_title);
  if length(v_title) < 2 then
    raise exception 'Give your costume (or group) a name.';
  end if;

  update public.entries
     set title      = v_title,
         photo_path = nullif(p_photo_path, ''),
         updated_at = now()
   where id = em.entry_id
  returning * into e;

  return json_build_object(
    'entry_id', e.id, 'title', e.title, 'photo_path', e.photo_path, 'members', entry_roster(e.id)
  );
end $$;

-- Change your own individual costume/role — works whether you started the
-- entry or joined someone else's.
create or replace function public.update_my_costume(
  p_party text, p_guest uuid, p_costume_name text
) returns json language plpgsql security definer set search_path = public as $$
declare
  p         public.parties;
  v_costume text;
  em        public.entry_members;
begin
  select * into p from public.parties where id = p_party;
  if p.id is null then
    raise exception 'Unknown party "%".', p_party;
  end if;
  if now() > p.voting_closes_at then
    raise exception 'Voting has closed, so costumes are locked.';
  end if;

  v_costume := clean_text(p_costume_name);
  if length(v_costume) < 1 then
    raise exception 'What are you dressed as?';
  end if;

  update public.entry_members
     set costume_name = v_costume
   where party_id = p_party and guest_id = p_guest
  returning * into em;

  if em.entry_id is null then
    raise exception 'You have not entered a costume yet.';
  end if;

  return json_build_object('costume_name', v_costume, 'members', entry_roster(em.entry_id));
end $$;

-- Leave your current entry so you can join a different group or go solo
-- instead. If you started a group that other people already joined, this
-- refuses — ask the host to delete the entry from the admin page instead
-- of silently orphaning everyone else in it.
create or replace function public.leave_entry(p_party text, p_guest uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  p      public.parties;
  em     public.entry_members;
  v_rest int;
begin
  select * into p from public.parties where id = p_party;
  if p.id is null then
    raise exception 'Unknown party "%".', p_party;
  end if;
  if now() > p.voting_closes_at then
    raise exception 'Voting has closed, so costumes are locked.';
  end if;

  select * into em from public.entry_members where party_id = p_party and guest_id = p_guest;
  if em.entry_id is null then
    raise exception 'You have not entered a costume yet.';
  end if;

  select count(*) into v_rest from public.entry_members
   where entry_id = em.entry_id and guest_id <> p_guest;

  if em.is_owner and v_rest > 0 then
    raise exception 'You started this group and % other % already joined it — ask the host to remove the entry from the admin page instead of leaving.',
      v_rest, case when v_rest = 1 then 'person has' else 'people have' end;
  end if;

  if em.is_owner then
    delete from public.entries where id = em.entry_id;   -- cascades entry_members + votes
  else
    delete from public.entry_members where party_id = p_party and guest_id = p_guest;
  end if;

  return json_build_object('left', true);
end $$;

-- The dashboard list. Vote counts come back as null until the reveal, so
-- the numbers are not merely hidden in the UI — they never reach the phone.
create or replace function public.list_entries(p_party text, p_guest uuid default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  p        public.parties;
  v_reveal boolean;
begin
  select * into p from public.parties where id = p_party;
  if p.id is null then
    raise exception 'Unknown party "%".', p_party;
  end if;

  v_reveal := p.results_public or now() > p.voting_closes_at;

  return (
    select coalesce(json_agg(s.j order by s.rank_votes desc, s.created_at asc), '[]'::json)
    from (
      select json_build_object(
               'id',         e.id,
               'title',      e.title,
               'photo_path', e.photo_path,
               'is_group',   mc.n > 1,
               'is_mine',    exists (
                               select 1 from public.entry_members em
                               where em.entry_id = e.id and em.guest_id = p_guest
                             ),
               'members',    mc.members,
               'votes',      case when v_reveal then coalesce(vc.c, 0) else null end
             ) as j,
             case when v_reveal then coalesce(vc.c, 0) else 0 end as rank_votes,
             e.created_at
      from public.entries e
      join lateral (
        select count(*) as n, entry_roster(e.id) as members
        from public.entry_members em
        where em.entry_id = e.id
      ) mc on true
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
  p public.parties;
  e public.entries;
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

  if exists (select 1 from public.entry_members where entry_id = p_entry and guest_id = p_guest) then
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
                 'id',         e.id,
                 'title',      e.title,
                 'photo_path', e.photo_path,
                 'members',    entry_roster(e.id),
                 'votes',      coalesce(vc.c, 0),
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

-- The master guest list, across every year — including each guest's
-- costume history via entry_members. Feeds the CSV export and next
-- year's invite list.
create or replace function public.admin_guests(p_party text, p_pin text)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin(p_party, p_pin);
  return (
    select coalesce(json_agg(j order by nm), '[]'::json)
    from (
      select json_build_object(
               'id',           g.id,
               'full_name',    g.full_name,
               'phone',        g.phone,
               'first_seen',   g.created_at,
               'years',        (select coalesce(array_agg(a.party_id order by a.party_id), '{}')
                                from public.attendance a where a.guest_id = g.id),
               'here_now',     exists (select 1 from public.attendance a
                                       where a.guest_id = g.id and a.party_id = p_party),
               'entry',        (select e.title from public.entry_members em
                                 join public.entries e on e.id = em.entry_id
                                where em.guest_id = g.id and em.party_id = p_party),
               'costume_name', (select em.costume_name from public.entry_members em
                                where em.guest_id = g.id and em.party_id = p_party),
               'voted',        exists (select 1 from public.votes v
                                       where v.voter_id = g.id and v.party_id = p_party)
             ) as j,
             norm_name(g.full_name) as nm
      from public.guests g
    ) s
  );
end $$;

-- One guest's full costume history across every year — every party they
-- attended, and (if they entered one) the group/solo name and their own
-- individual costume within it. Handy for "what was I last year?".
create or replace function public.admin_guest_history(p_pin text, p_guest uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_any_party text;
begin
  -- assert_admin needs a party id; any party row works since the PIN check
  -- doesn't actually depend on which one, but we need at least one to exist.
  select id into v_any_party from public.parties limit 1;
  if v_any_party is null then
    raise exception 'No party has been set up yet.';
  end if;
  perform assert_admin(v_any_party, p_pin);

  return (
    select coalesce(json_agg(json_build_object(
             'party_id',     a.party_id,
             'title',        e.title,
             'costume_name', em.costume_name,
             'is_owner',     em.is_owner,
             'members',      case when em.entry_id is not null then entry_roster(em.entry_id) else null end
           ) order by a.party_id desc), '[]'::json)
    from public.attendance a
    left join public.entry_members em on em.party_id = a.party_id and em.guest_id = a.guest_id
    left join public.entries e on e.id = em.entry_id
    where a.guest_id = p_guest
  );
end $$;


-- ---------------------------------------------------------------------
--  GRANTS — the publishable key may only call these functions, nothing else.
-- ---------------------------------------------------------------------

revoke all on function public.assert_admin(text, text) from public, anon, authenticated;

grant execute on function public.party_info(text)                          to anon, authenticated;
grant execute on function public.join_party(text, text, text)              to anon, authenticated;
grant execute on function public.create_entry(text, uuid, text, text, text) to anon, authenticated;
grant execute on function public.join_entry(text, uuid, uuid, text)        to anon, authenticated;
grant execute on function public.update_entry(text, uuid, text, text)      to anon, authenticated;
grant execute on function public.update_my_costume(text, uuid, text)       to anon, authenticated;
grant execute on function public.leave_entry(text, uuid)                  to anon, authenticated;
grant execute on function public.list_entries(text, uuid)                 to anon, authenticated;
grant execute on function public.cast_vote(text, uuid, uuid)              to anon, authenticated;
grant execute on function public.get_results(text, text)                  to anon, authenticated;
grant execute on function public.admin_set_close(text, text, timestamptz) to anon, authenticated;
grant execute on function public.admin_set_reveal(text, text, boolean)    to anon, authenticated;
grant execute on function public.admin_delete_entry(text, text, uuid)     to anon, authenticated;
grant execute on function public.admin_guests(text, text)                 to anon, authenticated;
grant execute on function public.admin_guest_history(text, uuid)          to anon, authenticated;


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
  (timestamp '2026-10-24 22:00') at time zone 'America/Denver',
  -- 2. Your admin PIN. Change it. Guests can never read this column.
  '1031'
)
on conflict (id) do nothing;

-- Already seeded and want to change them? Run this instead:
--   update public.parties
--      set voting_closes_at = (timestamp '2026-10-24 22:00') at time zone 'America/Denver',
--          admin_pin        = '1031'
--    where id = '2026';

-- Starting a NEW year without losing history? Insert another row instead
-- of editing this one — guests/entries/entry_members are already keyed by
-- party_id, so last year's data is untouched:
--   insert into public.parties (id, name, voting_closes_at, admin_pin)
--   values ('2027', 'Halloween 2027', (timestamp '2027-10-30 22:00') at time zone 'America/Denver', '1520')
--   on conflict (id) do nothing;
-- Then bump PARTY_ID in config.js to '2027' and redeploy.
