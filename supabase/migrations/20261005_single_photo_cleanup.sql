-- Complete photo-field cleanup for existing installations.
-- Run this file in Supabase SQL Editor before using the updated app.
-- It supersedes 20261005_single_party_photo.sql and can run directly against
-- the older schema. Safe to re-run. Guest, costume, vote, and original-photo
-- records remain intact; the two obsolete photo columns are discarded.

begin;

-- Remove the obsolete RPC signatures so PostgREST cannot select them.
drop function if exists public.create_entry(text, uuid, text, text, text, text, text);
drop function if exists public.create_entry(text, uuid, text, text, text, text);
drop function if exists public.update_entry(text, uuid, text, text, text);
drop function if exists public.create_party_photo(text, uuid, text, text, text);

alter table public.entries drop column if exists photo_path_film;
alter table public.party_photos drop column if exists film_path;

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
           'entry_type',   e.entry_type,
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

create or replace function public.create_entry(
  p_party text, p_guest uuid, p_title text,
  p_costume_name text, p_entry_type text, p_photo_path text
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
  if p_entry_type not in ('solo', 'group') then
    raise exception 'Choose either a solo or group costume.';
  end if;
  if nullif(btrim(p_photo_path), '') is null then
    raise exception 'A costume photo is required to start a costume entry.';
  end if;

  v_costume := clean_text(p_costume_name);
  if length(v_costume) < 1 then
    v_costume := v_title;
  end if;

  insert into public.entries (party_id, owner_id, entry_type, title, photo_path)
  values (p_party, p_guest, p_entry_type, v_title,
          nullif(p_photo_path, ''))
  returning * into e;

  insert into public.entry_members (party_id, guest_id, entry_id, costume_name, is_owner)
  values (p_party, p_guest, e.id, v_costume, true);

  return json_build_object(
    'entry_id', e.id, 'entry_type', e.entry_type, 'title', e.title,
    'photo_path', e.photo_path,
    'costume_name', v_costume, 'is_owner', true, 'members', entry_roster(e.id)
  );
end $$;

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
  if e.entry_type <> 'group' then
    raise exception 'That costume is solo and is not open to group members.';
  end if;

  v_costume := clean_text(p_costume_name);
  if length(v_costume) < 1 then
    raise exception 'What are you dressed as in this group?';
  end if;

  insert into public.entry_members (party_id, guest_id, entry_id, costume_name, is_owner)
  values (p_party, p_guest, e.id, v_costume, false);

  return json_build_object(
    'entry_id', e.id, 'entry_type', e.entry_type, 'title', e.title,
    'photo_path', e.photo_path,
    'costume_name', v_costume, 'is_owner', false, 'members', entry_roster(e.id)
  );
end $$;

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
  if nullif(btrim(p_photo_path), '') is null then
    raise exception 'A costume photo is required for every costume entry.';
  end if;

  update public.entries
     set title      = v_title,
         photo_path = nullif(p_photo_path, ''),
         updated_at = now()
   where id = em.entry_id
  returning * into e;

  return json_build_object(
    'entry_id', e.id, 'entry_type', e.entry_type, 'title', e.title,
    'photo_path', e.photo_path,
    'members', entry_roster(e.id)
  );
end $$;

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
               'entry_type', e.entry_type,
               'is_group',   e.entry_type = 'group',
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
                   'entry_type', e.entry_type,
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

create or replace function public.create_party_photo(
  p_party text, p_guest uuid, p_normal_path text, p_caption text default null
) returns json language plpgsql security definer set search_path = public as $$
declare
  p public.parties;
  v_id uuid;
  v_caption text;
begin
  select * into p from public.parties where id = p_party;
  if p.id is null then
    raise exception 'Unknown party "%".', p_party;
  end if;
  if now() > p.voting_closes_at then
    raise exception 'The party photo wall is closed.';
  end if;
  if not exists (select 1 from public.attendance where party_id = p_party and guest_id = p_guest) then
    raise exception 'Check in with your name and number first.';
  end if;
  if nullif(btrim(p_normal_path), '') is null then
    raise exception 'A photo is required.';
  end if;

  v_caption := nullif(clean_text(p_caption), '');
  insert into public.party_photos (party_id, uploader_id, normal_path, caption)
  values (p_party, p_guest, p_normal_path, v_caption)
  returning id into v_id;

  return json_build_object('id', v_id, 'normal_path', p_normal_path, 'caption', v_caption);
end $$;

create or replace function public.list_party_photos(p_party text, p_guest uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  p public.parties;
begin
  select * into p from public.parties where id = p_party;
  if p.id is null then
    raise exception 'Unknown party "%".', p_party;
  end if;
  if not exists (select 1 from public.attendance where party_id = p_party and guest_id = p_guest) then
    raise exception 'Check in with your name and number first.';
  end if;

  return (
    select coalesce(json_agg(json_build_object(
             'id', pp.id,
             'normal_path', pp.normal_path,
             'caption', pp.caption,
             'created_at', pp.created_at,
             'uploader', g.full_name
           ) order by pp.created_at desc), '[]'::json)
    from public.party_photos pp
    join public.guests g on g.id = pp.uploader_id
    where pp.party_id = p_party
  );
end $$;

create or replace function public.admin_party_photos(p_party text, p_pin text)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin(p_party, p_pin);
  return (
    select coalesce(json_agg(json_build_object(
             'id', pp.id,
             'normal_path', pp.normal_path,
             'caption', pp.caption,
             'created_at', pp.created_at,
             'uploader', g.full_name
           ) order by pp.created_at desc), '[]'::json)
    from public.party_photos pp
    join public.guests g on g.id = pp.uploader_id
    where pp.party_id = p_party
  );
end $$;

grant execute on function public.join_party(text, text, text)              to anon, authenticated;
grant execute on function public.create_entry(text, uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.join_entry(text, uuid, uuid, text)        to anon, authenticated;
grant execute on function public.update_entry(text, uuid, text, text) to anon, authenticated;
grant execute on function public.list_entries(text, uuid)                 to anon, authenticated;
grant execute on function public.get_results(text, text)                  to anon, authenticated;
grant execute on function public.create_party_photo(text, uuid, text, text) to anon, authenticated;
grant execute on function public.list_party_photos(text, uuid)             to anon, authenticated;
grant execute on function public.admin_party_photos(text, text)            to anon, authenticated;

notify pgrst, 'reload schema';
commit;
