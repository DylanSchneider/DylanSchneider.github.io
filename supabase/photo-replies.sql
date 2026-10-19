begin;
create table if not exists public.party_photo_comments (
  id            uuid        primary key default gen_random_uuid(),
  photo_id      uuid        not null references public.party_photos(id) on delete cascade,
  guest_id      uuid        not null references public.guests(id) on delete cascade,
  body          text        not null check (char_length(btrim(body)) between 1 and 100),
  created_at    timestamptz not null default now()
);

-- Update existing installations too. Older replies are kept as written;
-- the new limit is enforced on every new or updated reply.
alter table public.party_photo_comments
  drop constraint if exists party_photo_comments_body_check,
  add constraint party_photo_comments_body_check
    check (char_length(btrim(body)) between 1 and 100) not valid;

create index if not exists party_photo_comments_photo_idx on public.party_photo_comments (photo_id, created_at, id);

alter table public.party_photo_comments enable row level security;

create or replace function public.list_party_photo_comments(p_party text, p_guest uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.attendance where party_id = p_party and guest_id = p_guest) then
    raise exception 'Check in with your name and number first.';
  end if;
  return (
    select coalesce(json_agg(json_build_object(
      'id', c.id, 'photo_id', c.photo_id, 'body', c.body,
      'author', g.full_name, 'is_mine', c.guest_id = p_guest,
      'created_at', c.created_at
    ) order by c.created_at, c.id), '[]'::json)
    from public.party_photo_comments c
    join public.party_photos pp on pp.id = c.photo_id
    join public.guests g on g.id = c.guest_id
    where pp.party_id = p_party
  );
end $$;

create or replace function public.add_party_photo_comment(
  p_party text, p_guest uuid, p_photo uuid, p_body text
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_body text := clean_text(p_body);
  v_comment public.party_photo_comments;
begin
  if not exists (select 1 from public.attendance where party_id = p_party and guest_id = p_guest) then
    raise exception 'Check in with your name and number first.';
  end if;
  if not exists (select 1 from public.party_photos where id = p_photo and party_id = p_party) then
    raise exception 'That party photo is no longer available.';
  end if;
  if char_length(v_body) not between 1 and 100 then
    raise exception 'Write a comment or emoji, up to 100 characters.';
  end if;
  insert into public.party_photo_comments (photo_id, guest_id, body)
  values (p_photo, p_guest, v_body) returning * into v_comment;
  return json_build_object(
    'id', v_comment.id, 'photo_id', p_photo, 'body', v_body,
    'author', (select full_name from public.guests where id = p_guest),
    'is_mine', true, 'created_at', v_comment.created_at
  );
end $$;

create or replace function public.delete_party_photo_comment(
  p_party text, p_guest uuid, p_comment uuid
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.attendance where party_id = p_party and guest_id = p_guest) then
    raise exception 'Check in with your name and number first.';
  end if;
  delete from public.party_photo_comments c using public.party_photos pp
  where c.id = p_comment and c.guest_id = p_guest
    and pp.id = c.photo_id and pp.party_id = p_party;
  if not found then
    raise exception 'That reply is no longer available or belongs to another guest.';
  end if;
end $$;

grant execute on function public.list_party_photo_comments(text, uuid)     to anon, authenticated;
grant execute on function public.add_party_photo_comment(text, uuid, uuid, text) to anon, authenticated;
grant execute on function public.delete_party_photo_comment(text, uuid, uuid) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
