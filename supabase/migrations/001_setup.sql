-- Run in Supabase SQL Editor. Enable anonymous sign-ins in Authentication > Providers.
create extension if not exists pgcrypto;
create table if not exists public.site_settings (
  id int primary key default 1 check (id=1),
  price_cents int not null default 1000 check(price_cents >= 50),
  currency text not null default 'usd',
  zelle_recipient text not null default 'Set Zelle recipient in admin',
  venue text not null default 'Location to be announced',
  game_time text not null default 'Weekly pickup soccer',
  stripe_enabled boolean not null default false
);
insert into public.site_settings(id) values(1) on conflict do nothing;

create table if not exists public.admins (user_id uuid primary key references auth.users(id) on delete cascade);
create table if not exists public.signups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_monday date not null,
  player_name text not null check(char_length(player_name) between 2 and 50),
  status text not null check(status in ('roster','waitlist')),
  paid boolean not null default false,
  payment_method text check(payment_method in ('zelle','apple_pay') or payment_method is null),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id,week_monday)
);
create index if not exists signups_week_index on public.signups(week_monday, status, paid, created_at);
create table if not exists public.payments (
  stripe_session_id text primary key,
  signup_id uuid not null references public.signups(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.site_settings enable row level security;
alter table public.admins enable row level security;
alter table public.signups enable row level security;
alter table public.payments enable row level security;
revoke all on public.admins,public.signups,public.payments from anon,authenticated;
grant select on public.site_settings to anon,authenticated;
create policy "settings public" on public.site_settings for select to anon,authenticated using(true);

-- Public roster projection does not expose user IDs or payment details.
create or replace function public.get_roster(p_week date)
returns table (id uuid, player_name text, status text, paid boolean, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
 select s.id,s.player_name,s.status,s.paid,s.created_at
 from public.signups s where s.week_monday=p_week
 order by case when s.status='roster' then 0 else 1 end,
          case when s.paid then 0 else 1 end, s.created_at, s.id;
$$;

create or replace function public.join_week(p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_now timestamp; v_week date; v_id uuid; v_count int;
begin
 if auth.uid() is null then raise exception 'Please sign in before joining'; end if;
 v_now := now() at time zone 'America/Chicago';
 v_week := date_trunc('week',v_now)::date;
 if v_now < (v_week::timestamp + interval '21 hours') then
  raise exception 'Registration opens Monday at 9:00 PM Central time';
 end if;
 if length(trim(p_name)) < 2 or length(trim(p_name)) > 50 then
  raise exception 'Please enter a name (2-50 characters)';
 end if;
 -- Serialize roster assignment across concurrent visitors.
 perform pg_advisory_xact_lock(hashtext(v_week::text));
 select count(*) into v_count from public.signups where week_monday=v_week and status='roster';
 insert into public.signups(user_id,week_monday,player_name,status)
 values(auth.uid(),v_week,trim(p_name),case when v_count < 12 then 'roster' else 'waitlist' end)
 returning id into v_id;
 return v_id;
exception when unique_violation then
 raise exception 'You have already joined this week';
end;$$;

-- Paid players have priority. When full, a paid waitlisted player replaces the latest unpaid roster player.
-- The replaced player becomes the first waitlisted player (ordered by original join time).
create or replace function public.confirm_payment(p_signup uuid, p_method text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_week date; v_status text; v_replaced uuid; v_count int;
begin
 if p_method not in ('zelle','apple_pay') then raise exception 'Invalid payment method'; end if;
 -- Only service_role (Stripe webhook) or a configured administrator may confirm.
 if auth.role() <> 'service_role' and not exists(select 1 from public.admins where user_id=auth.uid()) then
  raise exception 'Only an administrator can confirm payment';
 end if;
 select week_monday,status into v_week,v_status from public.signups where id=p_signup;
 if v_week is null then raise exception 'Signup not found'; end if;
 perform pg_advisory_xact_lock(hashtext(v_week::text));
 if exists(select 1 from public.signups where id=p_signup and paid) then return; end if;
 update public.signups set paid=true,paid_at=now(),payment_method=p_method where id=p_signup;
 if v_status='waitlist' then
  select count(*) into v_count from public.signups where week_monday=v_week and status='roster';
  if v_count < 12 then
   update public.signups set status='roster' where id=p_signup;
  else
   select id into v_replaced from public.signups
    where week_monday=v_week and status='roster' and paid=false
    order by created_at desc,id desc limit 1;
   if v_replaced is not null then
    update public.signups set status='waitlist' where id=v_replaced;
    update public.signups set status='roster' where id=p_signup;
   end if;
  end if;
 end if;
end;$$;

create or replace function public.my_signup(p_week date)
returns table(id uuid,status text,paid boolean,payment_method text)
language sql stable security definer set search_path='' as $$
 select s.id,s.status,s.paid,s.payment_method from public.signups s
 where s.week_monday=p_week and s.user_id=auth.uid();
$$;

create or replace function public.admin_signups(p_week date)
returns table(id uuid,player_name text,status text,paid boolean,created_at timestamptz,payment_method text)
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.admins where user_id=auth.uid()) then
  raise exception 'Unauthorized';
 end if;
 return query select s.id,s.player_name,s.status,s.paid,s.created_at,s.payment_method
 from public.signups s where s.week_monday=p_week order by s.created_at;
end;$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.admins where user_id=auth.uid());
$$;

revoke all on function public.get_roster(date), public.join_week(text), public.confirm_payment(uuid,text), public.my_signup(date),public.admin_signups(date),public.is_admin() from public,anon,authenticated;
grant execute on function public.get_roster(date) to anon,authenticated;
grant execute on function public.join_week(text),public.my_signup(date),public.admin_signups(date),public.is_admin() to authenticated;
grant execute on function public.confirm_payment(uuid,text) to authenticated,service_role;
-- Add admin after account exists: insert into public.admins(user_id) select id from auth.users where email='YOUR_EMAIL';
-- Service-role backend can update settings. Never expose service-role key in frontend.
