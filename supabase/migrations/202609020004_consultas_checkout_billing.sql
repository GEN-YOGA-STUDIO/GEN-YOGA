-- Migration 202609020004_consultas_checkout_billing.sql
-- Ampliación de compras de Stripe y funciones de fulfillment para incluir todas las consultas y bonos de Miriam, Silvia e Isabel.

begin;

-- 1. Actualizar restricción check en stripe_purchases para admitir las nuevas consultas
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
      'miriam_psico_individual_1a',
      'miriam_psico_individual_sig',
      'miriam_psico_pareja_1a',
      'miriam_psico_pareja_sig',
      'silvia_ayurveda_1a',
      'silvia_ayurveda_sig',
      'silvia_ayurveda_bono3',
      'silvia_ayurveda_bono6',
      'isabel_pni_1a',
      'isabel_pni_sig'
    )
  );

-- 2. Actualizar la función stripe_fulfill_checkout para procesar el catálogo completo de consultas
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

  -- Validaciones de importes de pago esperados
  if p_purchase_type = 'clase_suelta' and p_amount_total is distinct from 1500 then
    raise exception 'Invalid single-class amount' using errcode = '22023';
  elsif p_purchase_type = 'pack_4' and p_amount_total is distinct from 5000 then
    raise exception 'Invalid four-class pack amount' using errcode = '22023';
  elsif p_purchase_type = 'pack_6' and p_amount_total is distinct from 6500 then
    raise exception 'Invalid six-class pack amount' using errcode = '22023';
  elsif p_purchase_type = 'pack_10' and p_amount_total is distinct from 9500 then
    raise exception 'Invalid ten-class pack amount' using errcode = '22023';
  elsif p_purchase_type in ('bono_ilimitado', 'bono_mensual') and p_amount_total is distinct from 9000 then
    raise exception 'Invalid unlimited-membership amount' using errcode = '22023';
  elsif p_purchase_type = 'miriam_psico_individual_1a' and p_amount_total is distinct from 7500 then
    raise exception 'Invalid amount' using errcode = '22023';
  elsif p_purchase_type = 'miriam_psico_individual_sig' and p_amount_total is distinct from 6500 then
    raise exception 'Invalid amount' using errcode = '22023';
  elsif p_purchase_type = 'miriam_psico_pareja_1a' and p_amount_total is distinct from 12000 then
    raise exception 'Invalid amount' using errcode = '22023';
  elsif p_purchase_type = 'miriam_psico_pareja_sig' and p_amount_total is distinct from 10000 then
    raise exception 'Invalid amount' using errcode = '22023';
  elsif p_purchase_type = 'silvia_ayurveda_1a' and p_amount_total is distinct from 8000 then
    raise exception 'Invalid amount' using errcode = '22023';
  elsif p_purchase_type = 'silvia_ayurveda_sig' and p_amount_total is distinct from 6000 then
    raise exception 'Invalid amount' using errcode = '22023';
  elsif p_purchase_type = 'silvia_ayurveda_bono3' and p_amount_total is distinct from 17000 then
    raise exception 'Invalid amount' using errcode = '22023';
  elsif p_purchase_type = 'silvia_ayurveda_bono6' and p_amount_total is distinct from 28000 then
    raise exception 'Invalid amount' using errcode = '22023';
  elsif p_purchase_type = 'isabel_pni_1a' and p_amount_total is distinct from 8000 then
    raise exception 'Invalid amount' using errcode = '22023';
  elsif p_purchase_type = 'isabel_pni_sig' and p_amount_total is distinct from 6000 then
    raise exception 'Invalid amount' using errcode = '22023';
  elsif p_purchase_type is null or p_purchase_type not in (
    'clase_suelta', 'pack_4', 'pack_6', 'pack_10', 'bono_ilimitado', 'bono_mensual',
    'miriam_psico_individual_1a', 'miriam_psico_individual_sig', 'miriam_psico_pareja_1a', 'miriam_psico_pareja_sig',
    'silvia_ayurveda_1a', 'silvia_ayurveda_sig', 'silvia_ayurveda_bono3', 'silvia_ayurveda_bono6',
    'isabel_pni_1a', 'isabel_pni_sig'
  ) then
    raise exception 'Unsupported purchase type' using errcode = '22023';
  end if;

  if p_is_guest is null then
    raise exception 'Missing guest purchase flag' using errcode = '22023';
  elsif p_is_guest and (p_user_id is not null or p_purchase_type not in (
    'clase_suelta', 'miriam_psico_individual_1a', 'miriam_psico_individual_sig',
    'miriam_psico_pareja_1a', 'miriam_psico_pareja_sig', 'silvia_ayurveda_1a', 'silvia_ayurveda_sig',
    'silvia_ayurveda_bono3', 'silvia_ayurveda_bono6', 'isabel_pni_1a', 'isabel_pni_sig'
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
       set stripe_customer_id = coalesce(p_customer_id, stripe_customer_id)
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
  elsif p_purchase_type in (
    'miriam_psico_individual_1a',
    'miriam_psico_individual_sig',
    'miriam_psico_pareja_1a',
    'miriam_psico_pareja_sig',
    'isabel_pni_1a',
    'isabel_pni_sig'
  ) then
    update public.profiles
       set saldo_psicologia = saldo_psicologia + 1,
           stripe_customer_id = coalesce(p_customer_id, stripe_customer_id)
     where id = p_user_id;
    get diagnostics v_profile_updated = row_count;
  elsif p_purchase_type in (
    'silvia_ayurveda_1a',
    'silvia_ayurveda_sig'
  ) then
    update public.profiles
       set saldo_nutricion = saldo_nutricion + 1,
           stripe_customer_id = coalesce(p_customer_id, stripe_customer_id)
     where id = p_user_id;
    get diagnostics v_profile_updated = row_count;
  elsif p_purchase_type = 'silvia_ayurveda_bono3' then
    update public.profiles
       set saldo_nutricion = saldo_nutricion + 3,
           stripe_customer_id = coalesce(p_customer_id, stripe_customer_id)
     where id = p_user_id;
    get diagnostics v_profile_updated = row_count;
  elsif p_purchase_type = 'silvia_ayurveda_bono6' then
    update public.profiles
       set saldo_nutricion = saldo_nutricion + 6,
           stripe_customer_id = coalesce(p_customer_id, stripe_customer_id)
     where id = p_user_id;
    get diagnostics v_profile_updated = row_count;
  else
    if nullif(trim(p_subscription_id), '') is null
      or nullif(trim(p_customer_id), '') is null
      or nullif(trim(p_subscription_status), '') is null
      or p_period_start is null or p_period_end is null
      or p_period_end <= p_period_start then
      raise exception 'Unlimited checkout lacks a valid subscription period' using errcode = '22023';
    end if;

    insert into public.stripe_subscriptions (
      subscription_id, user_id, customer_id, price_id, status,
      current_period_start, current_period_end, cancel_at_period_end,
      last_event_created
    ) values (
      p_subscription_id, p_user_id, p_customer_id, p_price_id, p_subscription_status,
      p_period_start, p_period_end, coalesce(p_cancel_at_period_end, false),
      p_event_created
    )
    on conflict (subscription_id) do update
      set user_id = excluded.user_id,
          customer_id = excluded.customer_id,
          price_id = excluded.price_id,
          status = excluded.status,
          current_period_start = excluded.current_period_start,
          current_period_end = excluded.current_period_end,
          cancel_at_period_end = excluded.cancel_at_period_end,
          last_event_created = excluded.last_event_created,
          updated_at = now()
      where public.stripe_subscriptions.last_event_created <= excluded.last_event_created;

    update public.profiles
       set bono_mensual_activo = p_subscription_status in ('active', 'trialing'),
           bono_mensual_inicio = p_period_start,
           bono_mensual_fin = p_period_end,
           stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
           stripe_subscription_id = p_subscription_id,
           stripe_subscription_status = p_subscription_status,
           stripe_current_period_start = p_period_start,
           stripe_current_period_end = p_period_end,
           stripe_cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
           stripe_subscription_event_created = p_event_created
     where id = p_user_id
       and coalesce(stripe_subscription_event_created, 0) <= p_event_created;
    get diagnostics v_profile_updated = row_count;
  end if;

  if v_profile_updated <> 1 and not exists (
    select 1 from public.profiles where id = p_user_id
  ) then
    raise exception 'Profile not found for Stripe fulfillment' using errcode = 'P0002';
  end if;

  return jsonb_build_object('processed', true, 'guest', false);
end;
$$;

commit;
