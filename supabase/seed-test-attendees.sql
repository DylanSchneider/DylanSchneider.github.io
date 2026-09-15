-- =====================================================================
-- Test data seed — 20 attendees for one party
--
-- Change the party id below if needed, then run this file in Supabase SQL
-- Editor after schema.sql. It is safe to re-run: rows using the [TEST]
-- names and 555-010-00xx phone numbers are replaced first.
-- No photos are uploaded.
-- =====================================================================

begin;

create temporary table _test_config (party_id text primary key);
insert into _test_config (party_id) values ('2026'); -- change this one value if needed

do $$
begin
  if not exists (select 1 from public.parties where id = (select party_id from _test_config)) then
    raise exception 'The configured test party does not exist. Change _test_config.party_id first.';
  end if;
end $$;

drop table if exists _test_members;
drop table if exists _test_entries;
drop table if exists _test_people;

create temporary table _test_people (
  full_name text not null,
  phone text primary key
);

insert into _test_people (full_name, phone) values
  ('Test Guest 01', '5550100001'),
  ('Test Guest 02', '5550100002'),
  ('Test Guest 03', '5550100003'),
  ('Test Guest 04', '5550100004'),
  ('Test Guest 05', '5550100005'),
  ('Test Guest 06', '5550100006'),
  ('Test Guest 07', '5550100007'),
  ('Test Guest 08', '5550100008'),
  ('Test Guest 09', '5550100009'),
  ('Test Guest 10', '5550100010'),
  ('Test Guest 11', '5550100011'),
  ('Test Guest 12', '5550100012'),
  ('Test Guest 13', '5550100013'),
  ('Test Guest 14', '5550100014'),
  ('Test Guest 15', '5550100015'),
  ('Test Guest 16', '5550100016'),
  ('Test Guest 17', '5550100017'),
  ('Test Guest 18', '5550100018'),
  ('Test Guest 19', '5550100019'),
  ('Test Guest 20', '5550100020');

-- Remove this script's previous entries and their dependent rows.
delete from public.entries e
 where e.party_id = (select party_id from _test_config)
   and e.title like '[TEST] %';

insert into public.guests (full_name, phone)
select full_name, phone from _test_people
on conflict (phone) do update set full_name = excluded.full_name;

insert into public.attendance (party_id, guest_id)
select (select party_id from _test_config), g.id
  from public.guests g
  join _test_people p on p.phone = g.phone
on conflict do nothing;

create temporary table _test_entries (
  title text primary key,
  entry_type text not null,
  owner_phone text not null
);

insert into _test_entries (title, entry_type, owner_phone) values
  ('[TEST] Solo 01 — Cheshire Cat', 'solo', '5550100001'),
  ('[TEST] Solo 02 — Mad Hatter', 'solo', '5550100002'),
  ('[TEST] Solo 03 — White Rabbit', 'solo', '5550100003'),
  ('[TEST] Solo 04 — Queen of Hearts', 'solo', '5550100004'),
  ('[TEST] Solo 05 — Tweedledee', 'solo', '5550100005'),
  ('[TEST] Solo 06 — Caterpillar', 'solo', '5550100006'),
  ('[TEST] Solo 07 — Dormouse', 'solo', '5550100007'),
  ('[TEST] Solo 08 — Playing Card', 'solo', '5550100008'),
  ('[TEST] Group — Mad Tea Party', 'group', '5550100009'),
  ('[TEST] Group — Queen''s Court', 'group', '5550100013'),
  ('[TEST] Group — Card Soldiers', 'group', '5550100017');

insert into public.entries (party_id, owner_id, entry_type, title, photo_path)
select (select party_id from _test_config), g.id, e.entry_type, e.title, null
  from _test_entries e
  join public.guests g on g.phone = e.owner_phone;

create temporary table _test_members (
  entry_title text not null,
  phone text not null,
  costume_name text not null,
  primary key (entry_title, phone)
);

insert into _test_members (entry_title, phone, costume_name) values
  ('[TEST] Solo 01 — Cheshire Cat', '5550100001', 'Cheshire Cat'),
  ('[TEST] Solo 02 — Mad Hatter', '5550100002', 'Mad Hatter'),
  ('[TEST] Solo 03 — White Rabbit', '5550100003', 'White Rabbit'),
  ('[TEST] Solo 04 — Queen of Hearts', '5550100004', 'Queen of Hearts'),
  ('[TEST] Solo 05 — Tweedledee', '5550100005', 'Tweedledee'),
  ('[TEST] Solo 06 — Caterpillar', '5550100006', 'Caterpillar'),
  ('[TEST] Solo 07 — Dormouse', '5550100007', 'Dormouse'),
  ('[TEST] Solo 08 — Playing Card', '5550100008', 'Playing Card'),
  ('[TEST] Group — Mad Tea Party', '5550100009', 'Mad Hatter'),
  ('[TEST] Group — Mad Tea Party', '5550100010', 'March Hare'),
  ('[TEST] Group — Mad Tea Party', '5550100011', 'Dormouse'),
  ('[TEST] Group — Mad Tea Party', '5550100012', 'White Rabbit'),
  ('[TEST] Group — Queen''s Court', '5550100013', 'Queen of Hearts'),
  ('[TEST] Group — Queen''s Court', '5550100014', 'King of Hearts'),
  ('[TEST] Group — Queen''s Court', '5550100015', 'Knave of Hearts'),
  ('[TEST] Group — Queen''s Court', '5550100016', 'Cheshire Cat'),
  ('[TEST] Group — Card Soldiers', '5550100017', 'Ace of Spades'),
  ('[TEST] Group — Card Soldiers', '5550100018', 'Two of Hearts'),
  ('[TEST] Group — Card Soldiers', '5550100019', 'Three of Clubs'),
  ('[TEST] Group — Card Soldiers', '5550100020', 'Four of Diamonds');

insert into public.entry_members (party_id, guest_id, entry_id, costume_name, is_owner)
select (select party_id from _test_config), g.id, e.id, m.costume_name, (m.phone = te.owner_phone)
  from _test_members m
  join _test_entries te on te.title = m.entry_title
  join public.entries e on e.party_id = (select party_id from _test_config) and e.title = te.title
  join public.guests g on g.phone = m.phone;

commit;

select
  count(distinct a.guest_id) as test_attendees,
  count(distinct e.id) as test_entries,
  count(distinct case when e.entry_type = 'solo' then e.id end) as solo_entries,
  count(distinct case when e.entry_type = 'group' then e.id end) as group_entries
from public.attendance a
left join public.entry_members em on em.party_id = a.party_id and em.guest_id = a.guest_id
left join public.entries e on e.id = em.entry_id
where a.party_id = (select party_id from _test_config)
  and a.guest_id in (select g.id from public.guests g join _test_people p on p.phone = g.phone);
