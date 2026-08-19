begin;

alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_subscription_status text,
  add column if not exists stripe_current_period_start timestamptz,
  add column if not exists stripe_current_period_end timestamptz,
  add column if not exists stripe_cancel_at_period_end boolean not null default false,
  add column if not exists stripe_subscription_event_created bigint;

create unique index if not exists profiles_stripe_customer_id_uidx
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists profiles_stripe_subscription_id_uidx
  on public.profiles (stripe_subscription_id)
  where stripe_subscription_id is not null;

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  livemode boolean not null check (livemode),
  checkout_session_id text,
  object_id text,
  processed_at timestamptz not null default now()
);

create table if not exists public.stripe_customers (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  customer_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stripe_subscriptions (
  subscription_id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  customer_id text not null,
  price_id text not null,
  status text not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  last_event_created bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stripe_subscriptions_user_id_idx
  on public.stripe_subscriptions (user_id);

create index if not exists stripe_subscriptions_customer_id_idx
  on public.stripe_subscriptions (customer_id);

create table if not exists public.stripe_purchases (
  checkout_session_id text primary key,
  stripe_event_id text unique references public.stripe_webhook_events(event_id),
  user_id uuid references public.profiles(id) on delete set null,
  is_guest boolean not null,
  purchase_type text not null check (purchase_type in ('clase_suelta', 'bono_mensual')),
  price_id text not null,
  payment_intent_id text,
  subscription_id text,
  customer_id text,
  amount_total bigint not null check (amount_total > 0),
  currency text not null check (currency = 'eur'),
  payment_status text not null check (payment_status = 'paid'),
  fulfilled_at timestamptz not null default now(),
  guest_redeemed_at timestamptz,
  guest_user_id uuid references public.profiles(id) on delete set null,
  guest_class_id bigint,
  guest_reservation_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stripe_purchases_owner_shape_check check (
    (is_guest and user_id is null and purchase_type = 'clase_suelta')
    or not is_guest
  )
);

create unique index if not exists stripe_purchases_payment_intent_uidx
  on public.stripe_purchases (payment_intent_id)
  where payment_intent_id is not null;

create unique index if not exists stripe_purchases_subscription_uidx
  on public.stripe_purchases (subscription_id)
  where subscription_id is not null;

alter table public.stripe_webhook_events enable row level security;
alter table public.stripe_customers enable row level security;
alter table public.stripe_subscriptions enable row level security;
alter table public.stripe_purchases enable row level security;

revoke all on table public.stripe_webhook_events from public, anon, authenticated;
revoke all on table public.stripe_customers from public, anon, authenticated;
revoke all on table public.stripe_subscriptions from public, anon, authenticated;
revoke all on table public.stripe_purchases from public, anon, authenticated;

grant select, insert, update, delete on table public.stripe_webhook_events to service_role;
grant select, insert, update, delete on table public.stripe_customers to service_role;
grant select, insert, update, delete on table public.stripe_subscriptions to service_role;
grant select, insert, update, delete on table public.stripe_purchases to service_role;

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
  v_profile_updated integer;
  v_existing public.stripe_purchases%rowtype;
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
  if p_purchase_type = 'clase_suelta' and p_amount_total is distinct from 1500 then
    raise exception 'Invalid single-class amount' using errcode = '22023';
  elsif p_purchase_type = 'bono_mensual' and p_amount_total is distinct from 9000 then
    raise exception 'Invalid monthly-plan amount' using errcode = '22023';
  elsif p_purchase_type is null or p_purchase_type not in ('clase_suelta', 'bono_mensual') then
    raise exception 'Unsupported purchase type' using errcode = '22023';
  end if;
  if p_is_guest is null then
    raise exception 'Missing guest purchase flag' using errcode = '22023';
  elsif p_is_guest and (p_user_id is not null or p_purchase_type <> 'clase_suelta') then
    raise exception 'Invalid guest purchase' using errcode = '22023';
  elsif not p_is_guest and p_user_id is null then
    raise exception 'Authenticated purchase has no user' using errcode = '22023';
  end if;

  -- The webhook and the success-page verification may fulfill the same paid
  -- session concurrently. Serialize by Checkout id so the second caller sees
  -- the canonical purchase instead of hitting a transient unique violation.
  perform pg_advisory_xact_lock(
    hashtextextended('gen_yoga_checkout:' || p_checkout_session_id, 0)
  );

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
      or (
        v_existing.payment_intent_id is not null
        and p_payment_intent_id is not null
        and v_existing.payment_intent_id <> p_payment_intent_id
      )
      or (
        v_existing.subscription_id is not null
        and p_subscription_id is not null
        and v_existing.subscription_id <> p_subscription_id
      )
      or (
        v_existing.customer_id is not null
        and p_customer_id is not null
        and v_existing.customer_id <> p_customer_id
      ) then
      raise exception 'Checkout session conflicts with an existing purchase' using errcode = '23514';
    end if;

    update public.stripe_purchases
    set stripe_event_id = coalesce(stripe_event_id, p_event_id),
        payment_intent_id = coalesce(payment_intent_id, p_payment_intent_id),
        subscription_id = coalesce(subscription_id, p_subscription_id),
        customer_id = coalesce(customer_id, p_customer_id),
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
    amount_total, currency, payment_status
  ) values (
    p_checkout_session_id, p_event_id, p_user_id, p_is_guest, p_purchase_type,
    p_price_id, p_payment_intent_id, p_subscription_id, p_customer_id,
    p_amount_total, lower(p_currency), p_payment_status
  );

  if p_is_guest then
    return jsonb_build_object('processed', true, 'guest', true);
  end if;

  if p_purchase_type = 'clase_suelta' then
    update public.profiles
    set bonos = coalesce(bonos, 0) + 1,
        stripe_customer_id = coalesce(p_customer_id, stripe_customer_id)
    where id = p_user_id;
    get diagnostics v_profile_updated = row_count;
  else
    if nullif(trim(p_subscription_id), '') is null
      or nullif(trim(p_customer_id), '') is null
      or nullif(trim(p_subscription_status), '') is null
      or p_period_start is null or p_period_end is null then
      raise exception 'Monthly checkout lacks subscription period' using errcode = '22023';
    end if;
    if p_period_end <= p_period_start then
      raise exception 'Monthly checkout has an invalid subscription period' using errcode = '22023';
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

create or replace function public.stripe_sync_subscription(
  p_event_id text,
  p_event_type text,
  p_event_created bigint,
  p_user_id uuid,
  p_subscription_id text,
  p_customer_id text,
  p_price_id text,
  p_status text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_entitled boolean,
  p_livemode boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted integer;
  v_subscription_updated integer;
  v_profile_updated integer;
begin
  if p_livemode is distinct from true then
    raise exception 'Only LIVE Stripe events are accepted' using errcode = '22023';
  end if;
  if nullif(trim(p_event_id), '') is null or p_user_id is null
    or nullif(trim(p_subscription_id), '') is null
    or nullif(trim(p_customer_id), '') is null
    or nullif(trim(p_price_id), '') is null
    or nullif(trim(p_status), '') is null
    or p_event_created is null or p_event_created <= 0
    or p_period_start is null or p_period_end is null
    or p_period_end <= p_period_start
    or p_entitled is null
    or p_event_type is null or p_event_type not in (
      'invoice.paid',
      'invoice.payment_failed',
      'customer.subscription.updated',
      'customer.subscription.deleted'
    ) then
    raise exception 'Missing subscription identifiers' using errcode = '22023';
  end if;

  insert into public.stripe_webhook_events (
    event_id, event_type, livemode, object_id
  ) values (
    p_event_id, p_event_type, true, p_subscription_id
  ) on conflict (event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('processed', false, 'reason', 'duplicate_event');
  end if;

  insert into public.stripe_subscriptions (
    subscription_id, user_id, customer_id, price_id, status,
    current_period_start, current_period_end, cancel_at_period_end,
    last_event_created
  ) values (
    p_subscription_id, p_user_id, p_customer_id, p_price_id, p_status,
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
  get diagnostics v_subscription_updated = row_count;

  if v_subscription_updated = 0 then
    return jsonb_build_object('processed', false, 'reason', 'stale_event');
  end if;

  -- Do not let an out-of-order event rewrite the canonical customer mapping.
  -- The subscription timestamp gate above is the ordering authority.
  insert into public.stripe_customers (user_id, customer_id)
  values (p_user_id, p_customer_id)
  on conflict (user_id) do update
    set customer_id = excluded.customer_id, updated_at = now();

  update public.profiles
  set bono_mensual_activo = p_entitled,
      bono_mensual_inicio = p_period_start,
      bono_mensual_fin = p_period_end,
      stripe_customer_id = p_customer_id,
      stripe_subscription_id = p_subscription_id,
      stripe_subscription_status = p_status,
      stripe_current_period_start = p_period_start,
      stripe_current_period_end = p_period_end,
      stripe_cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
      stripe_subscription_event_created = p_event_created
  where id = p_user_id
    and coalesce(stripe_subscription_event_created, 0) <= p_event_created;
  get diagnostics v_profile_updated = row_count;

  if v_profile_updated <> 1 then
    if not exists (select 1 from public.profiles where id = p_user_id) then
      raise exception 'Profile not found for subscription sync' using errcode = 'P0002';
    end if;
    return jsonb_build_object('processed', false, 'reason', 'stale_profile_event');
  end if;

  return jsonb_build_object('processed', true, 'entitled', p_entitled);
end;
$$;

create or replace function public.stripe_register_guest_checkout(
  p_checkout_session_id text,
  p_price_id text,
  p_payment_intent_id text,
  p_customer_id text,
  p_amount_total bigint,
  p_currency text,
  p_payment_status text,
  p_livemode boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.stripe_purchases%rowtype;
  v_inserted integer;
begin
  if p_livemode is distinct from true
    or p_payment_status is distinct from 'paid'
    or lower(p_currency) is distinct from 'eur'
    or p_amount_total is distinct from 1500 then
    raise exception 'Invalid LIVE guest checkout' using errcode = '22023';
  end if;
  if nullif(trim(p_checkout_session_id), '') is null
    or nullif(trim(p_price_id), '') is null then
    raise exception 'Missing guest checkout identifiers' using errcode = '22023';
  end if;

  insert into public.stripe_purchases (
    checkout_session_id, user_id, is_guest, purchase_type, price_id,
    payment_intent_id, customer_id, amount_total, currency, payment_status
  ) values (
    p_checkout_session_id, null, true, 'clase_suelta', p_price_id,
    p_payment_intent_id, p_customer_id, 1500, 'eur', 'paid'
  ) on conflict (checkout_session_id) do nothing;
  get diagnostics v_inserted = row_count;

  -- Lock and validate the canonical row even when two retries attempted the
  -- first registration concurrently. SELECT-then-INSERT left a race that
  -- surfaced as a transient duplicate-key error.
  select * into v_existing
  from public.stripe_purchases
  where checkout_session_id = p_checkout_session_id
  for update;

  if not found
    or not v_existing.is_guest
    or v_existing.purchase_type <> 'clase_suelta'
    or v_existing.price_id <> p_price_id
    or v_existing.amount_total <> 1500
    or v_existing.currency <> 'eur'
    or v_existing.payment_status <> 'paid'
    or (
      v_existing.payment_intent_id is not null
      and p_payment_intent_id is not null
      and v_existing.payment_intent_id <> p_payment_intent_id
    )
    or (
      v_existing.customer_id is not null
      and p_customer_id is not null
      and v_existing.customer_id <> p_customer_id
    ) then
    raise exception 'Guest checkout conflicts with an existing purchase' using errcode = '23514';
  end if;

  update public.stripe_purchases
  set payment_intent_id = coalesce(payment_intent_id, p_payment_intent_id),
      customer_id = coalesce(customer_id, p_customer_id),
      updated_at = now()
  where checkout_session_id = p_checkout_session_id;

  return case when v_inserted = 1
    then jsonb_build_object('registered', true)
    else jsonb_build_object('registered', false, 'reason', 'already_registered')
  end;
end;
$$;

create or replace function public.stripe_redeem_guest_checkout(
  p_checkout_session_id text,
  p_guest_user_id uuid,
  p_clase_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_purchase public.stripe_purchases%rowtype;
  v_capacity integer;
  v_class_start timestamptz;
  v_booking_limit_hours integer := 12;
  v_bookings integer;
  v_reservation_id bigint;
begin
  if p_checkout_session_id is null or p_guest_user_id is null or p_clase_id is null then
    raise exception 'Missing guest redemption identifiers' using errcode = '22023';
  end if;

  select * into v_purchase
  from public.stripe_purchases
  where checkout_session_id = p_checkout_session_id
  for update;

  if not found or not v_purchase.is_guest or v_purchase.purchase_type <> 'clase_suelta'
    or v_purchase.payment_status <> 'paid' or v_purchase.amount_total <> 1500
    or v_purchase.currency <> 'eur' then
    raise exception 'Guest checkout is not redeemable' using errcode = '22023';
  end if;

  if v_purchase.guest_redeemed_at is not null then
    if v_purchase.guest_user_id = p_guest_user_id and v_purchase.guest_class_id = p_clase_id then
      return jsonb_build_object(
        'redeemed', true,
        'already_redeemed', true,
        'reservation_id', v_purchase.guest_reservation_id
      );
    end if;
    raise exception 'Guest checkout has already been redeemed' using errcode = '23505';
  end if;

  select capacidad_max, fecha_inicio into v_capacity, v_class_start
  from public.clases
  where id = p_clase_id
    and tipo_clase = 'yoga'
  for update;

  if not found then
    raise exception 'Yoga class not found' using errcode = 'P0002';
  end if;
  if coalesce(v_capacity, 0) <= 0 then
    raise exception 'Class has no available capacity' using errcode = 'P0001';
  end if;

  begin
    select least(
      168::numeric,
      greatest(0::numeric, round(nullif(trim(both '"' from valor::text), '')::numeric))
    )::integer
    into v_booking_limit_hours
    from public.configuracion
    where clave = 'horas_limite_reserva'
    limit 1;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      v_booking_limit_hours := 12;
  end;
  v_booking_limit_hours := coalesce(v_booking_limit_hours, 12);

  if v_class_start is null
    or v_class_start <= now() + make_interval(hours => v_booking_limit_hours) then
    raise exception 'Class booking deadline has passed' using errcode = 'P0001';
  end if;

  select id into v_reservation_id
  from public.reservas_yoga
  where clase_id = p_clase_id
    and user_id = p_guest_user_id
    and estado = 'confirmada'
  order by id
  limit 1
  for update;

  if v_reservation_id is not null then
    -- Only the purchase row can prove idempotency (handled above). Reusing an
    -- unrelated reservation here would consume a second paid checkout without
    -- granting a second class.
    raise exception 'Guest identity already has a booking for this class' using errcode = '23505';
  end if;

  select count(*)::integer into v_bookings
  from public.reservas_yoga
  where clase_id = p_clase_id
    and estado = 'confirmada';

  if v_bookings >= v_capacity then
    raise exception 'Class is full' using errcode = 'P0001';
  end if;

  insert into public.reservas_yoga (
    clase_id, user_id, estado, usado_bono_mensual
  ) values (
    p_clase_id, p_guest_user_id, 'confirmada', false
  ) returning id into v_reservation_id;

  update public.stripe_purchases
  set guest_redeemed_at = now(),
      guest_user_id = p_guest_user_id,
      guest_class_id = p_clase_id,
      guest_reservation_id = v_reservation_id,
      updated_at = now()
  where checkout_session_id = p_checkout_session_id;

  return jsonb_build_object(
    'redeemed', true,
    'already_redeemed', false,
    'reservation_id', v_reservation_id
  );
end;
$$;

revoke all on function public.stripe_fulfill_checkout(
  text, text, bigint, text, uuid, boolean, text, text, text, text, text,
  bigint, text, text, timestamptz, timestamptz, text, boolean, boolean
) from public, anon, authenticated;
revoke all on function public.stripe_sync_subscription(
  text, text, bigint, uuid, text, text, text, text, timestamptz,
  timestamptz, boolean, boolean, boolean
) from public, anon, authenticated;
revoke all on function public.stripe_register_guest_checkout(
  text, text, text, text, bigint, text, text, boolean
) from public, anon, authenticated;
revoke all on function public.stripe_redeem_guest_checkout(text, uuid, bigint)
  from public, anon, authenticated;

grant execute on function public.stripe_fulfill_checkout(
  text, text, bigint, text, uuid, boolean, text, text, text, text, text,
  bigint, text, text, timestamptz, timestamptz, text, boolean, boolean
) to service_role;
grant execute on function public.stripe_sync_subscription(
  text, text, bigint, uuid, text, text, text, text, timestamptz,
  timestamptz, boolean, boolean, boolean
) to service_role;
grant execute on function public.stripe_register_guest_checkout(
  text, text, text, text, bigint, text, text, boolean
) to service_role;
grant execute on function public.stripe_redeem_guest_checkout(text, uuid, bigint)
  to service_role;

commit;
