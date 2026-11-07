-- Run once in the Supabase SQL Editor. Safe to rerun for this schema version.
create table if not exists public.nutripath_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint nutripath_data_shape check (
    jsonb_typeof(data) = 'object'
    and jsonb_typeof(data -> 'logs') = 'array'
    and jsonb_typeof(data -> 'custom') = 'array'
    and jsonb_typeof(data -> 'measurements') = 'array'
    and jsonb_typeof(data -> 'profile') = 'object'
    and jsonb_typeof(data -> 'goals') = 'object'
    and data ?& array['logs', 'custom', 'measurements', 'profile', 'goals']
    and octet_length(data::text) <= 2097152
  )
);

alter table public.nutripath_accounts enable row level security;
revoke all on public.nutripath_accounts from anon, authenticated;
grant select, insert, update on public.nutripath_accounts to authenticated;

drop policy if exists "Read own NutriPath data" on public.nutripath_accounts;
create policy "Read own NutriPath data" on public.nutripath_accounts
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Insert own NutriPath data" on public.nutripath_accounts;
create policy "Insert own NutriPath data" on public.nutripath_accounts
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Update own NutriPath data" on public.nutripath_accounts;
create policy "Update own NutriPath data" on public.nutripath_accounts
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Compare-and-swap prevents two devices silently overwriting each other.
-- SECURITY INVOKER keeps RLS enforced, including for calls to this RPC.
create or replace function public.save_nutripath_state(
  p_data jsonb, p_expected_revision bigint, p_user_id uuid
) returns setof public.nutripath_accounts
language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or uid is distinct from p_user_id then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_expected_revision = 0 then
    return query insert into public.nutripath_accounts (user_id, data)
      values (uid, p_data) on conflict (user_id) do nothing returning *;
  else
    return query update public.nutripath_accounts
      set data = p_data, revision = revision + 1, updated_at = now()
      where user_id = uid and revision = p_expected_revision returning *;
  end if;
  if not found then
    raise exception 'Data changed on another device' using errcode = 'PT409';
  end if;
end;
$$;

revoke all on function public.save_nutripath_state(jsonb, bigint, uuid) from public, anon;
grant execute on function public.save_nutripath_state(jsonb, bigint, uuid) to authenticated;
