-- Protect persisted user profiles from stale clients and decouple authorization
-- from editable profile metadata.

create schema if not exists private;

create table if not exists private.jetwork_admin_acl (
  uid uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid null references auth.users(id) on delete set null,
  note text null
);

revoke all on table private.jetwork_admin_acl from public, anon, authenticated;

-- Preserve legitimate legacy admins that are still intact at migration time.
insert into private.jetwork_admin_acl (uid, note)
select u.uid, 'Seeded from legacy public.users.role during profile integrity hardening'
from public.users u
where lower(coalesce(u.role, '')) in ('admin', 'administrator', 'yonetici', 'yönetici')
on conflict (uid) do nothing;

create or replace function public.is_jetwork_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.jetwork_admin_acl acl
    where acl.uid = (select auth.uid())
  );
$$;

revoke all on function public.is_jetwork_admin() from public, anon;
grant execute on function public.is_jetwork_admin() to authenticated;

create table if not exists private.user_profile_audit (
  id bigint generated always as identity primary key,
  profile_uid uuid not null,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  actor_uid uuid null,
  actor_role text null,
  old_values jsonb null,
  new_values jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists user_profile_audit_profile_uid_created_at_idx
  on private.user_profile_audit (profile_uid, created_at desc);

revoke all on table private.user_profile_audit from public, anon, authenticated;

create or replace function private.profile_audit_payload(p public.users)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'username', p.username,
    'name', p.name,
    'surname', p.surname,
    'role', p.role,
    'onboarding_completed', p.onboarding_completed
  );
$$;

revoke all on function private.profile_audit_payload(public.users) from public, anon, authenticated;

create or replace function private.audit_user_profile_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.user_profile_audit (
    profile_uid,
    operation,
    actor_uid,
    actor_role,
    old_values,
    new_values
  ) values (
    coalesce(new.uid, old.uid),
    tg_op,
    auth.uid(),
    auth.role(),
    case when tg_op in ('UPDATE', 'DELETE') then private.profile_audit_payload(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then private.profile_audit_payload(new) else null end
  );

  return coalesce(new, old);
end;
$$;

revoke all on function private.audit_user_profile_change() from public, anon, authenticated;

create or replace function private.guard_user_profile_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor_uid uuid := auth.uid();
  v_actor_role text := auth.role();
  v_scope text := current_setting('jetwork.profile_write_scope', true);
begin
  -- Trusted database/service operations remain available for migrations and support.
  if v_actor_uid is null or v_actor_role = 'service_role' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if old.uid is distinct from v_actor_uid then
    raise exception using errcode = '42501', message = 'profile_write_forbidden';
  end if;

  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'profile_delete_forbidden';
  end if;

  if new.uid is distinct from old.uid then
    raise exception using errcode = '42501', message = 'profile_uid_immutable';
  end if;

  -- Security-definer RPCs opt into narrowly scoped protected-field writes.
  if v_scope in ('onboarding', 'profile') then
    return new;
  end if;

  -- Email, username and onboarding state are never mutable from an arbitrary
  -- authenticated browser UPDATE once onboarding is complete.
  if old.onboarding_completed is true then
    if new.email is distinct from old.email then
      raise exception using errcode = '42501', message = 'profile_email_protected';
    end if;
    if new.username is distinct from old.username then
      raise exception using errcode = '42501', message = 'profile_username_protected';
    end if;
    if new.onboarding_completed is distinct from true then
      raise exception using errcode = '42501', message = 'profile_onboarding_state_protected';
    end if;
    return new;
  end if;

  -- Backward-compatible bridge for the currently deployed onboarding screen:
  -- an incomplete profile may only transition directly to a completed profile.
  if new.onboarding_completed is not true then
    if new.username is distinct from old.username
       or new.name is distinct from old.name
       or new.surname is distinct from old.surname
       or new.role is distinct from old.role
       or new.email is distinct from old.email
       or new.photo_url is distinct from old.photo_url then
      raise exception using errcode = '42501', message = 'incomplete_profile_requires_onboarding_completion';
    end if;
    return new;
  end if;

  if nullif(trim(coalesce(new.username, '')), '') is null
     or nullif(trim(coalesce(new.name, '')), '') is null
     or nullif(trim(coalesce(new.surname, '')), '') is null
     or nullif(trim(coalesce(new.role, '')), '') is null then
    raise exception using errcode = '22023', message = 'incomplete_onboarding_profile';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_user_profile_mutation() from public, anon, authenticated;

drop trigger if exists users_profile_integrity_guard on public.users;
create trigger users_profile_integrity_guard
before update or delete on public.users
for each row execute function private.guard_user_profile_mutation();

drop trigger if exists users_profile_audit on public.users;
create trigger users_profile_audit
after insert or update or delete on public.users
for each row execute function private.audit_user_profile_change();

-- Self-deletion and table-level structural privileges are not application features.
drop policy if exists users_delete_self on public.users;
revoke delete, truncate, trigger, references on table public.users from anon, authenticated;

create or replace function public.complete_user_onboarding(
  p_username text,
  p_name text,
  p_surname text,
  p_role text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  if nullif(trim(coalesce(p_username, '')), '') is null
     or nullif(trim(coalesce(p_name, '')), '') is null
     or nullif(trim(coalesce(p_surname, '')), '') is null
     or nullif(trim(coalesce(p_role, '')), '') is null then
    raise exception using errcode = '22023', message = 'incomplete_onboarding_profile';
  end if;

  if exists (
    select 1 from public.users u
    where u.uid <> v_uid
      and lower(trim(coalesce(u.username, ''))) = lower(trim(p_username))
  ) then
    raise exception using errcode = '23505', message = 'username_already_exists';
  end if;

  perform set_config('jetwork.profile_write_scope', 'onboarding', true);

  update public.users
  set username = trim(p_username),
      name = trim(p_name),
      surname = trim(p_surname),
      role = trim(p_role),
      onboarding_completed = true
  where uid = v_uid
    and onboarding_completed is not true;

  if not found then
    raise exception using errcode = '55000', message = 'onboarding_already_completed_or_profile_missing';
  end if;

  return true;
end;
$$;

revoke all on function public.complete_user_onboarding(text, text, text, text) from public, anon;
grant execute on function public.complete_user_onboarding(text, text, text, text) to authenticated;

create or replace function public.update_user_profile(
  p_name text,
  p_surname text,
  p_role text,
  p_color text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  if nullif(trim(coalesce(p_name, '')), '') is null
     or nullif(trim(coalesce(p_role, '')), '') is null then
    raise exception using errcode = '22023', message = 'invalid_profile';
  end if;

  perform set_config('jetwork.profile_write_scope', 'profile', true);

  update public.users
  set name = trim(p_name),
      surname = trim(coalesce(p_surname, '')),
      role = trim(p_role),
      color = coalesce(p_color, color)
  where uid = v_uid
    and onboarding_completed is true;

  if not found then
    raise exception using errcode = '55000', message = 'profile_not_ready';
  end if;

  return true;
end;
$$;

revoke all on function public.update_user_profile(text, text, text, text) from public, anon;
grant execute on function public.update_user_profile(text, text, text, text) to authenticated;
