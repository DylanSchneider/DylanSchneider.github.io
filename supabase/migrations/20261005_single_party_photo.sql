-- Single-image party photos. Run in Supabase SQL Editor for an existing app.
-- Safe to re-run. Existing photos, captions, ownership, and Storage objects
-- are preserved. Legacy film paths remain as metadata; no new film copies
-- are required, stored, or returned by the photo API.
-- The old RPC argument remains optional for cached clients.

begin;

alter table public.party_photos alter column film_path drop not null;

-- Candid photos are separate from costume entries and are intended to be
-- downloaded by the host after the party, then cleared from Storage.
-- The optional p_film_path argument is retained for older clients, but ignored.
create or replace function public.create_party_photo(
  p_party text, p_guest uuid, p_normal_path text, p_film_path text default null, p_caption text default null
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

grant execute on function public.create_party_photo(text, uuid, text, text, text) to anon, authenticated;
grant execute on function public.list_party_photos(text, uuid) to anon, authenticated;
grant execute on function public.admin_party_photos(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
