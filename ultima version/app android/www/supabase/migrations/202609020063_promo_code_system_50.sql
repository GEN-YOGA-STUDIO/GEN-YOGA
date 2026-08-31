-- Migration 202609020063: Sistema de Codigos Promocionales (GEN YOGA 50% DTO)
begin;

-- 1. Añadir columnas de control promocional en public.profiles
alter table public.profiles
  add column if not exists descuento_promo_50_activo boolean not null default false,
  add column if not exists codigo_promo_canjeado text default null,
  add column if not exists codigo_promo_usado boolean not null default false,
  add column if not exists codigo_promo_fecha_canje timestamptz default null;

-- 2. Actualizar trigger de creacion de perfiles en auth.users para registrar codigo en alta
create or replace function public.crear_perfil_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_nombre text;
  v_apellidos text;
  v_telefono text;
  v_fecha_nacimiento date;
  v_auth_method text;
  v_raw_bday text;
  v_raw_promo text;
  v_norm_promo text;
  v_promo_activo boolean := false;
  v_promo_codigo text := null;
  v_promo_fecha timestamptz := null;
begin
  v_nombre := regexp_replace(
    trim(coalesce(
      new.raw_user_meta_data->>'nombre',
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'full_name',
      ''
    )),
    '\s+',
    ' ',
    'g'
  );
  v_apellidos := regexp_replace(
    trim(coalesce(
      new.raw_user_meta_data->>'apellidos',
      new.raw_user_meta_data->>'family_name',
      ''
    )),
    '\s+',
    ' ',
    'g'
  );
  v_telefono := regexp_replace(
    trim(coalesce(
      new.raw_user_meta_data->>'telefono',
      new.phone,
      ''
    )),
    '[^0-9+]',
    '',
    'g'
  );
  v_auth_method := lower(trim(coalesce(
    new.raw_user_meta_data->>'auth_method',
    case
      when new.email ~* '^(movil|telefono)\.[0-9]+@genyoga\.studio$' or new.phone is not null then 'phone'
      else 'email'
    end
  )));
  if v_auth_method not in ('email', 'phone') then
    v_auth_method := 'email';
  end if;

  v_raw_bday := trim(coalesce(new.raw_user_meta_data->>'fecha_nacimiento', ''));
  if v_raw_bday ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      v_fecha_nacimiento := v_raw_bday::date;
    exception when others then
      v_fecha_nacimiento := null;
    end;
  else
    v_fecha_nacimiento := null;
  end if;

  if length(v_nombre) < 1 or length(v_nombre) > 80 or v_nombre ~ '[[:cntrl:]<>&]' then
    v_nombre := 'Alumno';
  end if;
  if length(v_apellidos) > 120 or v_apellidos ~ '[[:cntrl:]<>&]' then
    v_apellidos := '';
  end if;

  -- Comprobacion de codigo promocional en el registro
  v_raw_promo := trim(coalesce(new.raw_user_meta_data->>'codigo_promo', new.raw_user_meta_data->>'promo_code', ''));
  v_norm_promo := regexp_replace(upper(v_raw_promo), '\s+', '', 'g');
  if v_norm_promo = 'GENYOGA' then
    v_promo_activo := true;
    v_promo_codigo := 'GEN YOGA';
    v_promo_fecha := now();
  end if;

  insert into public.profiles (
    id,
    nombre,
    apellidos,
    email,
    telefono,
    fecha_nacimiento,
    auth_method,
    rol,
    bonos,
    saldo_psicologia,
    saldo_nutricion,
    saldo_clases_gratis,
    saldo_consultas_gratis,
    saldo_yoga_compania,
    descuento_promo_50_activo,
    codigo_promo_canjeado,
    codigo_promo_usado,
    codigo_promo_fecha_canje
  )
  values (
    new.id,
    v_nombre,
    v_apellidos,
    lower(trim(coalesce(new.email, ''))),
    nullif(v_telefono, ''),
    v_fecha_nacimiento,
    v_auth_method,
    'alumno',
    0,
    0,
    0,
    1,
    1,
    1,
    v_promo_activo,
    v_promo_codigo,
    false,
    v_promo_fecha
  )
  on conflict (id) do update
  set nombre = case
        when nullif(trim(coalesce(profiles.nombre, '')), '') is null
          then excluded.nombre
        else profiles.nombre
      end,
      apellidos = case
        when nullif(trim(coalesce(profiles.apellidos, '')), '') is null
          then excluded.apellidos
        else profiles.apellidos
      end,
      email = excluded.email,
      telefono = coalesce(nullif(excluded.telefono, ''), profiles.telefono),
      fecha_nacimiento = coalesce(excluded.fecha_nacimiento, profiles.fecha_nacimiento),
      auth_method = coalesce(nullif(excluded.auth_method, ''), profiles.auth_method),
      saldo_clases_gratis = coalesce(profiles.saldo_clases_gratis, 1),
      saldo_consultas_gratis = coalesce(profiles.saldo_consultas_gratis, 1),
      saldo_yoga_compania = coalesce(profiles.saldo_yoga_compania, 1),
      descuento_promo_50_activo = case
        when excluded.descuento_promo_50_activo = true and profiles.codigo_promo_usado is not true then true
        else profiles.descuento_promo_50_activo
      end,
      codigo_promo_canjeado = coalesce(profiles.codigo_promo_canjeado, excluded.codigo_promo_canjeado),
      codigo_promo_fecha_canje = coalesce(profiles.codigo_promo_fecha_canje, excluded.codigo_promo_fecha_canje);

  return new;
end;
$$;

-- 3. RPC para canjear codigos promocionales por parte de usuarios autenticados
drop function if exists public.canjear_codigo_promocional(text);
drop function if exists public.canjear_codigo_promocional(p_codigo text);

create or replace function public.canjear_codigo_promocional(p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid;
  v_norm_code text;
  v_profile public.profiles%rowtype;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Debes iniciar sesión para canjear un código promocional.' using errcode = '42501';
  end if;

  v_norm_code := regexp_replace(upper(trim(coalesce(p_codigo, ''))), '\s+', '', 'g');
  if v_norm_code != 'GENYOGA' then
    raise exception 'El código promocional introducido no es válido o ha caducado.' using errcode = '22023';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_user_id
  for update;

  if not found then
    raise exception 'No se encontró el perfil de usuario.' using errcode = 'P0002';
  end if;

  if v_profile.codigo_promo_usado is true then
    raise exception 'Ya has disfrutado de una promoción de bienvenida anteriormente.' using errcode = '22023';
  end if;

  if v_profile.descuento_promo_50_activo is true or v_profile.codigo_promo_canjeado is not null then
    raise exception 'Ya tienes activo el código promocional GEN YOGA en tu perfil.' using errcode = '22023';
  end if;

  update public.profiles
  set descuento_promo_50_activo = true,
      codigo_promo_canjeado = 'GEN YOGA',
      codigo_promo_fecha_canje = now()
  where id = v_user_id;

  return jsonb_build_object(
    'success', true,
    'message', '¡Código GEN YOGA aplicado con éxito! Tienes un 50% de descuento en tu primera reserva.'
  );
end;
$$;

revoke all on function public.canjear_codigo_promocional(text) from public, anon;
grant execute on function public.canjear_codigo_promocional(text) to authenticated, anon;

-- 4. RPC de Administrador para gestionar el 50% de descuento promocional
drop function if exists public.admin_set_promo_50(uuid, boolean);
drop function if exists public.admin_set_promo_50(p_user_id uuid, p_active boolean);

create or replace function public.admin_set_promo_50(
  p_user_id uuid,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_caller_role text;
begin
  select lower(trim(coalesce(rol, ''))) into v_caller_role
  from public.profiles
  where id = auth.uid();

  if v_caller_role != 'admin' then
    raise exception 'Solo los administradores pueden modificar el estado promocional.' using errcode = '42501';
  end if;

  update public.profiles
  set descuento_promo_50_activo = p_active,
      codigo_promo_canjeado = case when p_active then 'GEN YOGA' else codigo_promo_canjeado end,
      codigo_promo_fecha_canje = case when p_active and codigo_promo_fecha_canje is null then now() else codigo_promo_fecha_canje end
  where id = p_user_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.admin_set_promo_50(uuid, boolean) from public, anon;
grant execute on function public.admin_set_promo_50(uuid, boolean) to authenticated, anon;

-- Recargar caché de esquema de PostgREST
notify pgrst, 'reload schema';

-- 5. Actualizar restriccion de stripe_purchases para admitir promo_50_clase
alter table public.stripe_purchases
  drop constraint if exists stripe_purchases_purchase_type_check;

alter table public.stripe_purchases
  add constraint stripe_purchases_purchase_type_check check (
    purchase_type in (
      'clase_suelta',
      'pack_4',
      'pack_6',
      'pack_10',
      'bono_ilimitado',
      'bono_mensual',
      'promo_50_clase',
      'miriam_psico_individual_1a',
      'miriam_psico_individual_sig',
      'miriam_psico_pareja_1a',
      'miriam_psico_pareja_sig',
      'silvia_ayurveda_1a',
      'silvia_ayurveda_sig',
      'silvia_ayurveda_bono3',
      'silvia_ayurveda_bono6',
      'isabel_pni_1a',
      'isabel_pni_sig',
      'clase_especial',
      'taller_intro_power_vinyasa'
    )
  );

-- 6. Actualizar stripe_fulfill_checkout para procesar promo_50_clase
create or replace function public.stripe_fulfill_checkout(
  p_event_id text,
  p_event_type text,
  p_event_created bigint,
  p_checkout_session_id text,
  p_user_id uuid,
  p_is_guest boolean,
  p_purchase_type text,
  p_price_id text,
  p_payment_intent_id text,
  p_subscription_id text,
  p_customer_id text,
  p_amount_total bigint,
  p_currency text,
  p_payment_status text,
  p_membership_month text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_subscription_status text,
  p_cancel_at_period_end boolean,
  p_livemode boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted integer;
  v_profile_updated integer := 0;
  v_existing public.stripe_purchases%rowtype;
  v_pack_credits integer;
  v_purchased_at timestamptz;
  v_account_deletion_pending boolean;
  v_membership_month date;
  v_membership_start timestamptz;
  v_membership_end timestamptz;
  v_current_month date;
begin
  if p_livemode is distinct from true then
    raise exception 'Only LIVE Stripe events are accepted' using errcode = '22023';
  end if;
  if nullif(trim(p_event_id), '') is null
    or nullif(trim(p_checkout_session_id), '') is null
    or nullif(trim(p_price_id), '') is null
    or p_event_type is distinct from 'checkout.session.completed'
    or p_event_created is null or p_event_created <= 0 then
    raise exception 'Missing Stripe identifiers' using errcode = '22023';
  end if;
  if p_payment_status is distinct from 'paid' or lower(p_currency) is distinct from 'eur' then
    raise exception 'Checkout is not a paid EUR session' using errcode = '22023';
  end if;

  v_pack_credits := case p_purchase_type
    when 'clase_suelta' then 1
    when 'promo_50_clase' then 1
    when 'pack_4' then 4
    when 'pack_6' then 6
    when 'pack_10' then 10
    else null
  end;

  if p_purchase_type = 'bono_ilimitado' then
    if nullif(trim(coalesce(p_membership_month, '')), '') is null
      or trim(p_membership_month) !~ '^\d{4}-(0[1-9]|1[0-2])$' then
      raise exception 'Unlimited checkout lacks a valid calendar month'
        using errcode = '22023';
    end if;
    v_membership_month := (trim(p_membership_month) || '-01')::date;
    v_current_month := date_trunc('month', timezone('Europe/Madrid', now()))::date;
    if v_membership_month < v_current_month
      or v_membership_month > (v_current_month + interval '11 months')::date then
      raise exception 'Unlimited calendar month is outside the allowed purchase window'
        using errcode = '22023';
    end if;
    v_membership_start := v_membership_month::timestamp at time zone 'Europe/Madrid';
    v_membership_end := (v_membership_month + interval '1 month')::timestamp
      at time zone 'Europe/Madrid';
  elsif nullif(trim(coalesce(p_membership_month, '')), '') is not null then
    raise exception 'Purchase type does not accept a calendar month' using errcode = '22023';
  end if;

  if p_is_guest is null then
    raise exception 'Missing guest purchase flag' using errcode = '22023';
  elsif p_is_guest and (p_user_id is not null or p_purchase_type not in (
    'clase_suelta', 'miriam_psico_individual_1a', 'miriam_psico_individual_sig',
    'miriam_psico_pareja_1a', 'miriam_psico_pareja_sig', 'silvia_ayurveda_1a', 'silvia_ayurveda_sig',
    'isabel_pni_1a', 'isabel_pni_sig', 'clase_especial', 'taller_intro_power_vinyasa'
  )) then
    raise exception 'Invalid guest purchase' using errcode = '22023';
  elsif not p_is_guest and p_user_id is null then
    raise exception 'Authenticated purchase has no user' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('gen_yoga_checkout:' || p_checkout_session_id, 0)
  );

  if not p_is_guest then
    select coalesce(account_deletion_pending, false)
      into v_account_deletion_pending
      from public.profiles
     where id = p_user_id
     for update;
    if not found then
      raise exception 'Profile not found for Stripe fulfillment' using errcode = 'P0002';
    end if;
    if v_account_deletion_pending then
      raise exception 'account deletion pending; entitlement update rejected' using errcode = '55000';
    end if;
  end if;

  insert into public.stripe_webhook_events (
    event_id, event_type, livemode, checkout_session_id, object_id
  ) values (
    p_event_id, p_event_type, true, p_checkout_session_id,
    coalesce(p_subscription_id, p_payment_intent_id, p_checkout_session_id)
  ) on conflict (event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('processed', false, 'reason', 'duplicate_event');
  end if;

  select * into v_existing
    from public.stripe_purchases
   where checkout_session_id = p_checkout_session_id
   for update;

  if found then
    if v_existing.is_guest <> p_is_guest
      or v_existing.user_id is distinct from p_user_id
      or v_existing.purchase_type <> p_purchase_type
      or v_existing.price_id <> p_price_id
      or v_existing.amount_total <> p_amount_total
      or v_existing.currency <> lower(p_currency)
      or v_existing.payment_status <> 'paid'
      or v_existing.membership_month is distinct from v_membership_month
      or (
        v_existing.payment_intent_id is not null and p_payment_intent_id is not null
        and v_existing.payment_intent_id <> p_payment_intent_id
      )
      or (
        v_existing.subscription_id is not null and p_subscription_id is not null
        and v_existing.subscription_id <> p_subscription_id
      )
      or (
        v_existing.customer_id is not null and p_customer_id is not null
        and v_existing.customer_id <> p_customer_id
      ) then
      raise exception 'Checkout session conflicts with an existing purchase' using errcode = '23514';
    end if;

    update public.stripe_purchases
       set stripe_event_id = coalesce(stripe_event_id, p_event_id),
           payment_intent_id = coalesce(payment_intent_id, p_payment_intent_id),
           subscription_id = coalesce(subscription_id, p_subscription_id),
           customer_id = coalesce(customer_id, p_customer_id),
           membership_month = coalesce(membership_month, v_membership_month),
           updated_at = now()
     where checkout_session_id = p_checkout_session_id;
    return jsonb_build_object('processed', false, 'reason', 'session_already_fulfilled');
  end if;

  if not p_is_guest and p_customer_id is not null then
    insert into public.stripe_customers (user_id, customer_id)
    values (p_user_id, p_customer_id)
    on conflict (user_id) do update
      set customer_id = excluded.customer_id, updated_at = now();
  end if;

  insert into public.stripe_purchases (
    checkout_session_id, stripe_event_id, user_id, is_guest, purchase_type,
    price_id, payment_intent_id, subscription_id, customer_id,
    amount_total, currency, payment_status, membership_month
  ) values (
    p_checkout_session_id, p_event_id, p_user_id, p_is_guest, p_purchase_type,
    p_price_id, p_payment_intent_id, p_subscription_id, p_customer_id,
    p_amount_total, lower(p_currency), p_payment_status, v_membership_month
  );

  if p_is_guest then
    return jsonb_build_object('processed', true, 'guest', true);
  end if;

  if v_pack_credits is not null then
    v_purchased_at := to_timestamp(p_event_created);
    insert into public.class_credit_packs (
      user_id, checkout_session_id, pack_type, credits_total,
      credits_remaining, purchased_at, expires_at
    ) values (
      p_user_id, p_checkout_session_id, p_purchase_type, v_pack_credits,
      v_pack_credits, v_purchased_at, v_purchased_at + interval '60 days'
    );
    update public.profiles
       set stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
           descuento_promo_50_activo = case when p_purchase_type = 'promo_50_clase' then false else descuento_promo_50_activo end,
           codigo_promo_usado = case when p_purchase_type = 'promo_50_clase' then true else codigo_promo_usado end
     where id = p_user_id;
    get diagnostics v_profile_updated = row_count;
  elsif p_purchase_type = 'bono_ilimitado' then
    v_purchased_at := to_timestamp(p_event_created);
    insert into public.unlimited_membership_periods (
      user_id, checkout_session_id, membership_month,
      starts_at, ends_at, purchased_at
    ) values (
      p_user_id, p_checkout_session_id, v_membership_month,
      v_membership_start, v_membership_end, v_purchased_at
    );
    update public.profiles
       set stripe_customer_id = coalesce(p_customer_id, stripe_customer_id)
     where id = p_user_id;
    get diagnostics v_profile_updated = row_count;
  elsif p_purchase_type = 'bono_mensual' then
    update public.profiles
       set bono_mensual_activo = true,
           stripe_customer_id = coalesce(p_customer_id, stripe_customer_id)
     where id = p_user_id;
    get diagnostics v_profile_updated = row_count;
  elsif p_purchase_type in ('silvia_ayurveda_bono3', 'silvia_ayurveda_bono6') then
    v_pack_credits := case p_purchase_type
      when 'silvia_ayurveda_bono3' then 3
      when 'silvia_ayurveda_bono6' then 6
      else 0
    end;
    v_purchased_at := to_timestamp(p_event_created);
    insert into public.class_credit_packs (
      user_id, checkout_session_id, pack_type, credits_total,
      credits_remaining, purchased_at, expires_at
    ) values (
      p_user_id, p_checkout_session_id, p_purchase_type, v_pack_credits,
      v_pack_credits, v_purchased_at, v_purchased_at + interval '180 days'
    );
    update public.profiles
       set stripe_customer_id = coalesce(p_customer_id, stripe_customer_id)
     where id = p_user_id;
    get diagnostics v_profile_updated = row_count;
  end if;

  return jsonb_build_object('processed', true, 'profile_updated', v_profile_updated > 0);
end;
$$;

commit;
