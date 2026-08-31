-- Fix for admin unlimited membership activation
-- Issue: checkout_session_id column in unlimited_membership_periods table has NOT NULL constraint
-- When admin manually activates unlimited membership, there's no Stripe checkout session
-- Solution: Make checkout_session_id nullable and update admin function to handle manual activations

begin;

-- Make checkout_session_id nullable in unlimited_membership_periods
alter table public.unlimited_membership_periods 
  alter column checkout_session_id drop not null;

-- Drop the unique constraint on checkout_session_id since it can now be null
alter table public.unlimited_membership_periods 
  drop constraint if exists unlimited_membership_periods_checkout_session_id_key;

-- Add a new unique constraint that only applies when checkout_session_id is not null
alter table public.unlimited_membership_periods 
  add constraint unlimited_membership_periods_checkout_session_id_unique 
  unique (checkout_session_id) 
  where checkout_session_id is not null;

-- Update the admin function to also insert into unlimited_membership_periods when activating manually
create or replace function public.admin_configurar_bono_mensual(
  p_user_id uuid,
  p_activo boolean,
  p_inicio timestamptz default null,
  p_fin timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_role text;
  v_actor_deletion_pending boolean;
  v_target_role text;
  v_target_deletion_pending boolean;
  v_target_subscription_id text;
  v_target_subscription_status text;
  v_membership_month date;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select lower(trim(coalesce(rol, ''))), coalesce(account_deletion_pending, false)
    into v_actor_role, v_actor_deletion_pending
    from public.profiles
    where id = auth.uid();

  if not found or v_actor_role is distinct from 'admin' or v_actor_deletion_pending then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if p_user_id is null or p_activo is null then
    raise exception 'invalid monthly pass request' using errcode = '22023';
  end if;
  if p_activo and (p_inicio is null or p_fin is null or p_fin <= p_inicio) then
    raise exception 'invalid monthly pass dates' using errcode = '22023';
  end if;

  select lower(trim(coalesce(rol, ''))), coalesce(account_deletion_pending, false),
         stripe_subscription_id, lower(trim(coalesce(stripe_subscription_status, '')))
    into v_target_role, v_target_deletion_pending,
         v_target_subscription_id, v_target_subscription_status
    from public.profiles
    where id = p_user_id
    for update;

  if not found then
    raise exception 'target profile not found' using errcode = 'P0002';
  end if;
  if v_target_role in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'monthly passes can only be assigned to clients' using errcode = '22023';
  end if;
  if v_target_deletion_pending then
    raise exception 'target account deletion is pending' using errcode = '55000';
  end if;
  if (
    nullif(trim(coalesce(v_target_subscription_id, '')), '') is not null
    and v_target_subscription_status not in ('canceled', 'incomplete_expired')
  ) or v_target_subscription_status in (
    'active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'
  ) then
    raise exception 'active Stripe subscription must be managed in Customer Portal'
      using errcode = '55000';
  end if;

  -- Handle activation
  if p_activo then
    -- Calculate membership month from start date
    v_membership_month := date_trunc('month', p_inicio::timestamp with time zone)::date;
    
    -- Check if there's already an unlimited membership for this month
    if exists (
      select 1 from public.unlimited_membership_periods 
      where user_id = p_user_id 
      and membership_month = v_membership_month
    ) then
      raise exception 'user already has unlimited membership for this month' using errcode = '23505';
    end if;
    
    -- Insert into unlimited_membership_periods for manual admin activation
    insert into public.unlimited_membership_periods (
      user_id,
      checkout_session_id,
      membership_month,
      starts_at,
      ends_at,
      purchased_at
    ) values (
      p_user_id,
      null, -- null for manual admin activations
      v_membership_month,
      p_inicio,
      p_fin,
      now()
    );
  else
    -- Handle deactivation - remove all unlimited membership periods
    delete from public.unlimited_membership_periods 
    where user_id = p_user_id;
  end if;

  -- Update profiles table
  update public.profiles
  set bono_mensual_activo = p_activo,
      bono_mensual_inicio = case when p_activo then p_inicio else null end,
      bono_mensual_fin = case when p_activo then p_fin else null end
  where id = p_user_id;
end;
$$;

-- Update function comment
comment on function public.admin_configurar_bono_mensual(uuid, boolean, timestamptz, timestamptz)
is 'Admin-only function to configure unlimited monthly passes. Handles both profiles table and unlimited_membership_periods table for manual activations.';

commit;