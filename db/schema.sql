-- ============================================================================
--  KH IL VOSTRO CAFFÈ — نظام المبيعات المتكامل
--  Supabase (PostgreSQL + Auth + Realtime) — المخطط والصلاحيات
--
--  الطريقة: Supabase Dashboard → SQL Editor → New query → الصق كاملاً → Run
--  آمن للتشغيل أكثر من مرة (idempotent).
--
--  الأدوار: admin (إدارة) · cashier (كاشير) · customer (زبون) · guest (مجهول)
--  الحماية: Row Level Security على كل جدول + الصلاحيات مفروضة في قاعدة
--           البيانات نفسها، لا في الواجهة فقط.
-- ============================================================================

-- pgcrypto اختياري: gen_random_uuid() مدمج في PostgreSQL 13+ (وSupabase أحدث).
-- نشغّله بأمان حتى لا يُفشل المخطط إن مُنع التثبيت في بعض البيئات.
do $$
begin
  create extension if not exists pgcrypto;
exception when others then null;
end $$;

-- ---------------------------------------------------------------------------
-- 1) الحسابات والصلاحيات
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text        not null default '',
  phone       text,
  role        text        not null default 'customer'
              check (role in ('admin','cashier','customer')),
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- دوال مساعدة: تُتجاوز RLS عمدًا (security definer) لأنها مملوكة لـ postgres
-- وهي المسؤولة عن قراءة الدور دون تسبب في تكرار الاستعلامات (recursion).
create or replace function public.app_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'guest');
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.app_role() in ('admin','cashier');
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.app_role() = 'admin';
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- كل تسجيل ذاتي يبدأ «زبون». الترقية لكاشير/إدارة تُمنح يدويًا من لوحة
-- الإدارة فقط — لذلك metadata الدور عند التسجيل متجاهَل قصدًا (منع تصعيد صلاحيات).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    coalesce(new.phone, new.raw_user_meta_data->>'phone'),
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- لا يغير أحد دوره أو تفعيله إلا الإدارة.
create or replace function public.profiles_guard()
returns trigger language plpgsql as $$
begin
  -- العمليات الداخلية (security definer · محرر SQL) لا تُحاسَب هنا.
  -- قيد «authenticated» يمنع فقط محاولة الترقية من المتصفح.
  if current_user <> 'authenticated' then
    return new;
  end if;
  if new.role is distinct from old.role or new.active is distinct from old.active then
    if not public.is_admin() then
      raise exception 'غير مسموح بتغيير الصلاحيات';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- أول من يسجّل الدخول ويستدعي هذه الدالة يصبح الإدارة (فقط إن لم توجد إدارة).
-- تتعامل مع الحالتين: ملف حساب موجود، أو حساب أُنشئ قبل تشغيل المخطط.
create or replace function public.claim_first_admin()
returns boolean language plpgsql security definer set search_path = public as $$
declare n integer; r record;
begin
  if auth.uid() is null then return false; end if;
  select count(*) into n from public.profiles where role = 'admin';
  if n > 0 then return false; end if;

  select id, email, phone, raw_user_meta_data into r from auth.users where id = auth.uid();

  insert into public.profiles (id, full_name, phone, role)
  values (
    auth.uid(),
    coalesce(r.raw_user_meta_data->>'full_name', r.raw_user_meta_data->>'name', ''),
    coalesce(r.phone, r.raw_user_meta_data->>'phone'),
    'admin'
  )
  on conflict (id) do update set role = 'admin';

  return true;
end $$;
revoke all on function public.claim_first_admin() from public;
grant execute on function public.claim_first_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- 2) المنيو — مصدر الأسعار الوحيد (مستورد من index.html)
-- ---------------------------------------------------------------------------

create table if not exists public.menu_items (
  id          bigint primary key,          -- نفس id الصنف في صفحة المنيو
  ar          text        not null,
  it          text        not null default '',
  category    text        not null,
  sub         text,
  price       numeric(10,2),               -- سعر رقمي لحساب الإجمالي
  price_text  text,                        -- النص الأصلي كما يظهر للزبون
  options     jsonb,                       -- [{label|name, price, price_text}]
  image       text,
  active      boolean     not null default true,
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_menu_items_updated on public.menu_items;
create trigger trg_menu_items_updated before update on public.menu_items
  for each row execute function public.set_updated_at();

create index if not exists idx_menu_items_cat on public.menu_items(category, active);

-- ---------------------------------------------------------------------------
-- 3) الطلبات والفواتير
-- ---------------------------------------------------------------------------

create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  order_no       bigint generated always as identity,
  customer_id    uuid        references auth.users(id) on delete set null,
  customer_name  text        not null default '',
  customer_phone text,
  source         text        not null default 'online'
                 check (source in ('online','pos')),
  status         text        not null default 'pending'
                 check (status in ('pending','confirmed','preparing','ready','completed','cancelled')),
  subtotal       numeric(10,2) not null default 0,
  discount       numeric(10,2) not null default 0,
  total          numeric(10,2) not null default 0,
  paid           boolean     not null default false,
  payment_method text        check (payment_method in ('cash','card','wallet','other')),
  note           text,
  created_by     uuid        references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ابدأ الترقيم من 1001 لقراءة طلبات أقرب للواقع (لا يُعاد إن وُجدت طلبات)
do $$
begin
  if not exists (select 1 from public.orders) then
    execute 'alter table public.orders alter column order_no restart with 1001';
  end if;
end $$;

create index if not exists idx_orders_created on public.orders(created_at desc);
create index if not exists idx_orders_status  on public.orders(status, created_at desc);
create index if not exists idx_orders_phone   on public.orders(customer_phone);
create index if not exists idx_orders_by      on public.orders(created_by, created_at desc);

create table if not exists public.order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid        not null references public.orders(id) on delete cascade,
  item_id    bigint      references public.menu_items(id) on delete set null,
  name_ar    text        not null,
  name_it    text        not null default '',
  variant    text,
  unit_price numeric(10,2) not null check (unit_price >= 0),
  price_text text,
  qty        integer     not null check (qty between 1 and 999),
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists idx_order_items_order on public.order_items(order_id);
create index if not exists idx_order_items_item  on public.order_items(item_id);

create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid        references public.orders(id) on delete cascade,
  amount      numeric(10,2) not null check (amount >= 0),
  method      text        not null check (method in ('cash','card','wallet','other')),
  received_by uuid        references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_payments_created on public.payments(created_at desc);

create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor      uuid        references public.profiles(id) on delete set null,
  action     text        not null,
  entity     text,
  entity_id  text,
  detail     jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_created on public.audit_log(created_at desc);

-- ---------------------------------------------------------------------------
-- 4) محرّكات حساب الإجماليات — لا يُtrusted المُبلَّغ من المتصفح
-- ---------------------------------------------------------------------------

create or replace function public.recalc_order_totals()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_order uuid;
begin
  v_order := coalesce(new.order_id, old.order_id);
  if v_order is null then return null; end if;
  update public.orders o set
    subtotal = coalesce((select sum(unit_price * qty)
                          from public.order_items where order_id = v_order), 0),
    total    = greatest(0, coalesce((select sum(unit_price * qty)
                          from public.order_items where order_id = v_order), 0)
                          - coalesce(o.discount, 0)),
    updated_at = now()
  where o.id = v_order;
  return null;
end $$;

drop trigger if exists trg_recalc_items on public.order_items;
create trigger trg_recalc_items
  after insert or update or delete on public.order_items
  for each row execute function public.recalc_order_totals();

-- خصم الإدارة/الكاشير يعيد حساب الإجمالي تلقائيًا.
create or replace function public.recalc_on_discount()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.discount is distinct from old.discount then
    new.total := greatest(0, new.subtotal - new.discount);
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_orders_discount on public.orders;
create trigger trg_orders_discount before update on public.orders
  for each row execute function public.recalc_on_discount();

-- الكاشير: الحالة والدفع فقط. لا يلمس الإجماليات أو تاريخ الفاتورة.
create or replace function public.orders_guard()
returns trigger language plpgsql as $$
begin
  -- إعادة حساب الإجماليات تتم داخل القاعدة بحقوق صاحب الجدول
  -- (security definer) — لا اعتراض عليها.
  if current_user <> 'authenticated' then
    return new;
  end if;
  if public.is_admin() then return new; end if;
  if new.subtotal     is distinct from old.subtotal
  or  new.total       is distinct from old.total
  or  new.discount    is distinct from old.discount
  or  new.order_no    is distinct from old.order_no
  or  new.customer_id is distinct from old.customer_id
  or  new.source      is distinct from old.source
  or  new.created_at  is distinct from old.created_at
  or  new.created_by  is distinct from old.created_by then
    raise exception 'غير مسموح بتعديل هذا الحقل';
  end if;
  if new.status is distinct from old.status then
    insert into public.audit_log(actor, action, entity, entity_id, detail)
    values (auth.uid(), 'status:'||old.status||'->'||new.status, 'order', new.id::text,
            jsonb_build_object('by', auth.uid()));
  end if;
  return new;
end $$;

drop trigger if exists trg_orders_guard on public.orders;
create trigger trg_orders_guard before update on public.orders
  for each row execute function public.orders_guard();

-- ---------------------------------------------------------------------------
-- 5) تسجيل الطلب — الدالة الوحيدة التي تكتب الطلبات
--    السعر يُقرأ من menu_items داخل القاعدة، لا من المتصفح.
--    هذا ما يمنع أي شخص من تزوير السعر قبل الدفع.
-- ---------------------------------------------------------------------------

create or replace function public.place_order(
  p_name   text default null,
  p_phone  text default null,
  p_items  jsonb default '[]'::jsonb,
  p_note   text default null,
  p_source text default 'online',
  p_payment text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order  uuid;
  v_no     bigint;
  v_sub    numeric(10,2) := 0;
  v_name   text := nullif(trim(coalesce(p_name,'')), '');
  v_phone  text := nullif(trim(coalesce(p_phone,'')), '');
  v_it     jsonb;
  v_row    record;
  v_item   record;
  v_price  numeric(10,2);
  v_label  text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 40 then
    raise exception 'السلة فارغة أو أكبر من الحد المسموح';
  end if;

  if p_source not in ('online','pos') then p_source := 'online'; end if;
  if p_payment is not null and p_payment not in ('cash','card','wallet','other') then
    p_payment := null;
  end if;

  -- منع الإرسال المتكرر (حماية من النفايات/الروبوت)
  if v_phone is not null and exists (
       select 1 from public.orders
        where customer_phone = v_phone and created_at > now() - interval '90 seconds') then
    raise exception 'تم إرسال طلب مؤخرًا، انتظر قليلًا ثم أعد المحاولة';
  end if;

  if p_source = 'pos' and not public.is_staff() then
    raise exception 'هذه الصلاحية للكاشير فقط';
  end if;

  insert into public.orders
    (customer_name, customer_phone, source, status, note, created_by)
  values
    (coalesce(v_name, 'زبون'), v_phone, p_source, 'pending', nullif(p_note,''),
     case when p_source='pos' then auth.uid() else null end)
  returning id, order_no into v_order, v_no;

  -- نمرّ على عناصر السلة: [{id, qty, variant, note}]
  for v_row in
    select el from jsonb_array_elements(p_items) as t(el)
  loop
    v_it := v_row.el;

    if jsonb_typeof(v_it) <> 'object' then
      continue;
    end if;
    -- qty يجب أن يكون رقمًا (يمنع أخطاء التحويل الخام)
    if coalesce(v_it->>'qty', '') !~ '^[0-9]{1,9}$' then
      continue;
    end if;
    -- id يجب أن يكون رقمًا أيضًا
    if coalesce(v_it->>'id', '') !~ '^[0-9]{1,9}$' then
      raise exception 'صنف غير صحيح في السلة';
    end if;

    select * into v_item
      from public.menu_items
     where id = (v_it->>'id')::bigint and active = true;

    if not found then
      raise exception 'صنف غير موجود: %', coalesce(v_it->>'id','?');
    end if;

    v_label := nullif(trim(coalesce(v_it->>'variant','')), '');

    if v_item.price is not null then
      v_price := v_item.price;
    elsif v_item.options is not null and jsonb_typeof(v_item.options) = 'array'
          and jsonb_array_length(v_item.options) > 0 then
      select coalesce((o->>'price')::numeric, 0) into v_price
        from jsonb_array_elements(v_item.options) o
       where coalesce(o->>'label', o->>'name') = v_label
       limit 1;
      if v_price is null or v_price = 0 then
        raise exception 'اختر الحجم/التشكيلة لصنف: %', v_item.ar;
      end if;
    else
      -- بوكس مفتوح بلا سعر ثابت: يُسعّر يدويًا عند التأكيد
      v_price := 0;
    end if;

    v_sub := v_sub + v_price * least(greatest((v_it->>'qty')::integer, 1), 999);

    insert into public.order_items
      (order_id, item_id, name_ar, name_it, variant, unit_price, price_text, qty, note)
    values (
      v_order,
      v_item.id,
      v_item.ar,
      v_item.it,
      v_label,
      v_price,
      case when v_price = 0 then 'حسب الاختيار'
           when v_label is not null then v_label
           else v_item.price_text end,
      least(greatest((v_it->>'qty')::integer, 1), 999),
      nullif(trim(coalesce(v_it->>'note','')), '')
    );
  end loop;

  if v_sub = 0 then
    delete from public.orders where id = v_order;
    raise exception 'تعذّر حساب سعر الطلب، تواصل مع المقهى';
  end if;

  return jsonb_build_object(
    'ok', true, 'order_no', v_no, 'subtotal', v_sub, 'total', v_sub,
    'items', (select count(*) from public.order_items where order_id = v_order)
  );
end $$;

revoke all on function public.place_order(text,text,jsonb,text,text,text) from public;
grant execute on function public.place_order(text,text,jsonb,text,text,text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles    enable row level security;
alter table public.menu_items  enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;
alter table public.payments    enable row level security;
alter table public.audit_log   enable row level security;

-- profiles -------------------------------------------------------------------
drop policy if exists "profiles read own"      on public.profiles;
drop policy if exists "profiles admin read"    on public.profiles;
drop policy if exists "profiles admin write"   on public.profiles;
drop policy if exists "profiles insert own"    on public.profiles;

create policy "profiles read own"   on public.profiles for select
  to authenticated using (id = auth.uid());
create policy "profiles admin read" on public.profiles for select
  to authenticated using (public.is_admin());
create policy "profiles insert own" on public.profiles for insert
  to authenticated with check (id = auth.uid());
create policy "profiles admin write" on public.profiles for update
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- menu_items -----------------------------------------------------------------
drop policy if exists "menu read"          on public.menu_items;
drop policy if exists "menu admin rw"      on public.menu_items;
drop policy if exists "menu admin insert"  on public.menu_items;
drop policy if exists "menu admin delete"  on public.menu_items;

create policy "menu read" on public.menu_items for select
  using (active = true or public.is_staff());
create policy "menu admin rw" on public.menu_items for update
  to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "menu admin insert" on public.menu_items for insert
  to authenticated with check (public.is_admin());
create policy "menu admin delete" on public.menu_items for delete
  to authenticated using (public.is_admin());

-- orders ---------------------------------------------------------------------
drop policy if exists "orders staff read"     on public.orders;
drop policy if exists "orders own read"       on public.orders;
drop policy if exists "orders staff update"   on public.orders;
drop policy if exists "orders admin delete"   on public.orders;

create policy "orders staff read"   on public.orders for select
  to authenticated using (public.is_staff());
create policy "orders own read"     on public.orders for select
  to authenticated using (customer_id = auth.uid());
create policy "orders staff update" on public.orders for update
  to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "orders admin delete" on public.orders for delete
  to authenticated using (public.is_admin());

-- لا توجد سياسة INSERT للطلبات إطلاقًا: الكتابة عبر place_order فقط.

-- order_items ----------------------------------------------------------------
drop policy if exists "items staff read" on public.order_items;
drop policy if exists "items own read"   on public.order_items;

create policy "items staff read" on public.order_items for select
  to authenticated using (public.is_staff());
create policy "items own read"   on public.order_items for select
  to authenticated using (exists (
    select 1 from public.orders o
     where o.id = order_id and o.customer_id = auth.uid()));

-- payments -------------------------------------------------------------------
drop policy if exists "payments staff read" on public.payments;
drop policy if exists "payments staff add"  on public.payments;
drop policy if exists "payments admin del"  on public.payments;

create policy "payments staff read" on public.payments for select
  to authenticated using (public.is_staff());
create policy "payments staff add"  on public.payments for insert
  to authenticated with check (public.is_staff());
create policy "payments admin del"  on public.payments for delete
  to authenticated using (public.is_admin());

-- audit_log ------------------------------------------------------------------
drop policy if exists "audit admin read"  on public.audit_log;
drop policy if exists "audit staff write" on public.audit_log;

create policy "audit admin read"  on public.audit_log for select
  to authenticated using (public.is_admin());
create policy "audit staff write" on public.audit_log for insert
  to authenticated with check (public.is_staff());

-- دفاع في العمق: منع الكتابة المباشرة حتى بدون سياسة
revoke insert, update, delete on public.orders      from anon, authenticated;
revoke insert, update, delete on public.order_items from anon, authenticated;
revoke insert, update, delete on public.payments, public.audit_log from anon;

-- صلاحيات على مستوى الجدول — وفوقها RLS يحدّ الصفوف المسموح بها
grant  select         on public.orders, public.order_items to authenticated;
-- الكاشير يغيّر الحالة والدفع فقط؛ الحماية من التعديل المحرّم داخل orders_guard
grant  update         on public.orders                     to authenticated;
grant  select, insert on public.payments                   to authenticated;
-- سجل التدقيق: الكاشير يكتب، والقراءة محصورة بالإدارة عبر RLS
grant  select, insert on public.audit_log                  to authenticated;
-- الإدارة تحدّث الحسابات (الدور/التفعيل) — RLS: للإدارة فقط
grant  update         on public.profiles                   to authenticated;

grant  select on public.menu_items, public.profiles to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7) التقارير (تُقرأ بحقوق المستدعِي — RLS مطبَّق تلقائيًا)
-- ---------------------------------------------------------------------------

create or replace view public.v_daily_sales
with (security_invoker = true) as
select
  (created_at at time zone 'Africa/Tripoli')::date as day,
  count(*) filter (where status <> 'cancelled')                       as orders,
  coalesce(sum(total) filter (where status <> 'cancelled'), 0)        as revenue,
  coalesce(sum(discount) filter (where status <> 'cancelled'), 0)     as discounts,
  count(*) filter (where status = 'cancelled')                        as cancelled,
  count(*) filter (where paid)                                        as paid_orders,
  count(*) filter (where source = 'pos')                              as pos_orders
from public.orders
group by 1
order by 1 desc;

create or replace view public.v_top_items
with (security_invoker = true) as
select
  oi.item_id,
  oi.name_ar,
  oi.variant,
  sum(oi.qty)::integer                         as qty,
  sum(oi.unit_price * oi.qty)                  as revenue,
  count(distinct oi.order_id)::integer         as orders
from public.order_items oi
join public.orders o on o.id = oi.order_id
where o.status <> 'cancelled'
group by 1, 2, 3
order by qty desc, revenue desc;

create or replace view public.v_peak_hours
with (security_invoker = true) as
select
  extract(hour from created_at at time zone 'Africa/Tripoli')::int as hour,
  count(*)::int                         as orders,
  coalesce(sum(total), 0)               as revenue
from public.orders
where status <> 'cancelled'
group by 1
order by 1;

create or replace view public.v_staff_perf
with (security_invoker = true) as
select
  p.id,
  p.full_name,
  count(o.id)::int                                   as handled,
  coalesce(sum(o.total) filter (where o.status <> 'cancelled'), 0) as revenue
from public.profiles p
left join public.orders o on o.created_by = p.id
where public.is_admin()
group by p.id, p.full_name
order by revenue desc;

-- صلاحيات قراءة التقارير (الصفوف نفسها تحميها RLS بحقوق المستدعِي)
grant select on public.v_daily_sales, public.v_top_items,
               public.v_peak_hours,  public.v_staff_perf to authenticated;

-- ---------------------------------------------------------------------------
-- 8) التحديث اللحظي للوحة الطلبات
-- ---------------------------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null;
         when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.order_items;
exception when duplicate_object then null;
         when undefined_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 9) إدارة المنيو — إضافة أصناف وأسعار جديدة (الإدارة فقط)
--    غير الإدارة لا يستطيع الكتابة مطلقًا: الدالة نفسها ترفض، وسياسات RLS
--    ترفض أي محاولة كتابة مباشرة من المتصفح.
-- ---------------------------------------------------------------------------

-- معرّفات الأصناف التي يضيفها الإدارة تبدأ من 900000 حتى لا تتعارض
-- مع معرّفات المنيو الثابتة الموجودة في صفحة الرابط.
create sequence if not exists public.menu_items_new_seq start with 900000;

create or replace function public.admin_save_menu_item(
  p_id         bigint   default null,   -- null = صنف جديد · رقم = تعديل صنف قائم
  p_ar         text     default null,   -- اسم الصنف بالعربية (يُفحص داخل الدالة)
  p_it         text     default '',
  p_category   text     default null,   -- التصنيف (يُفحص داخل الدالة)
  p_sub        text     default null,
  p_price      numeric  default null,   -- سعر مفرد (يُترك فارغًا إن كان هناك خيارات)
  p_price_text text     default null,   -- يُشتق تلقائيًا إن لم يُكتب
  p_options    jsonb    default null,   -- [{label|name, price}] للأحجام والتشكيلات
  p_image      text     default null,   -- اسم ملف الصورة مثل "capp.webp"
  p_active     boolean  default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id     bigint;
  v_ar     text   := nullif(trim(coalesce(p_ar, '')), '');
  v_cat    text   := nullif(trim(coalesce(p_category, '')), '');
  v_opts   jsonb  := nullif(coalesce(p_options, '[]'::jsonb), '[]'::jsonb);
  v_ptext  text   := nullif(trim(coalesce(p_price_text, '')), '');
  v_price  numeric(10,2) :=
             case when p_price is null or p_price < 0 then null else p_price end;
begin
  if not public.is_admin() then
    raise exception 'هذه الصلاحية للإدارة فقط';
  end if;

  if v_ar  is null then raise exception 'اسم الصنف مطلوب';                 end if;
  if v_cat is null then raise exception 'التصنيف مطلوب';                   end if;
  if not exists (select 1 from public.menu_items where category = v_cat) then
    raise exception 'تصنيف غير معروف: %', v_cat;
  end if;

  -- كل صنف يحتاج سعرًا: إما سعر مفرد أو قائمة أسعار/تشكيلات
  if coalesce(v_price, 0) = 0 and v_opts is null then
    raise exception 'أدخل سعرًا للصنف «%»', v_ar;
  end if;

  if v_opts is not null then
    if jsonb_typeof(v_opts) <> 'array' or jsonb_array_length(v_opts) = 0 then
      raise exception 'صيغة الخيارات غير صحيحة';
    end if;
    if exists (select 1 from jsonb_array_elements(v_opts) o
                where case
                        when coalesce(o->>'price','') ~ '^[0-9]+(\.[0-9]{1,2})?$'
                        then (o->>'price')::numeric
                        else 0
                      end <= 0) then
      raise exception 'كل حجم/تشكيلة يحتاج سعرًا صحيحًا';
    end if;
    v_price := null;                       -- الخيارات تحل محل السعر المفرد
    if v_ptext is null then
      select 'يبدأ من ' ||
             min(case
                   when coalesce(o->>'price','') ~ '^[0-9]+(\.[0-9]{1,2})?$'
                   then (o->>'price')::numeric
                   else 0
                 end)::text || ' د.ل'
        into v_ptext
        from jsonb_array_elements(v_opts) o;
    end if;
  elsif v_ptext is null then
    v_ptext := v_price::text || ' د.ل';
  end if;

  if p_id is null then
    v_id := nextval('public.menu_items_new_seq');
    insert into public.menu_items
      (id, ar, it, category, sub, price, price_text, options, image, active)
    values
      (v_id, v_ar, coalesce(p_it, ''), v_cat,
       nullif(trim(coalesce(p_sub, '')), ''),
       v_price, v_ptext, v_opts,
       nullif(trim(coalesce(p_image, '')), ''), coalesce(p_active, true));

    insert into public.audit_log(actor, action, entity, entity_id, detail)
    values (auth.uid(), 'menu:create', 'menu_item', v_id::text,
            jsonb_build_object('ar', v_ar, 'price_text', v_ptext, 'category', v_cat));

    return jsonb_build_object('ok', true, 'created', true, 'id', v_id);
  else
    update public.menu_items set
      ar = v_ar,
      it = coalesce(p_it, ''),
      category = v_cat,
      sub = nullif(trim(coalesce(p_sub, '')), ''),
      price = v_price,
      price_text = v_ptext,
      options = v_opts,
      image = nullif(trim(coalesce(p_image, '')), ''),
      active = coalesce(p_active, true)
    where id = p_id;
    if not found then raise exception 'الصنف غير موجود'; end if;

    insert into public.audit_log(actor, action, entity, entity_id, detail)
    values (auth.uid(), 'menu:update', 'menu_item', p_id::text,
            jsonb_build_object('ar', v_ar, 'price_text', v_ptext));

    return jsonb_build_object('ok', true, 'created', false, 'id', p_id);
  end if;
end $$;

-- إخفاء/إظهار صنف (حذف لطيف يحافظ على سجل الفواتير)
create or replace function public.admin_set_menu_active(p_id bigint, p_active boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'هذه الصلاحية للإدارة فقط';
  end if;
  update public.menu_items set active = coalesce(p_active, false) where id = p_id;
  if not found then return false; end if;
  insert into public.audit_log(actor, action, entity, entity_id, detail)
  values (auth.uid(), case when coalesce(p_active,false) then 'menu:show' else 'menu:hide' end,
          'menu_item', p_id::text, null);
  return true;
end $$;

revoke all on function public.admin_save_menu_item(bigint,text,text,text,text,numeric,text,jsonb,text,boolean)
  from public, anon;
revoke all on function public.admin_set_menu_active(bigint, boolean) from public, anon;
grant execute on function public.admin_save_menu_item(bigint,text,text,text,text,numeric,text,jsonb,text,boolean)
  to authenticated;
grant execute on function public.admin_set_menu_active(bigint, boolean) to authenticated;

-- قراءة قائمة الأصناف (لشاشتي الكاشير والإدارة) — بدون تعريف
create or replace function public.list_menu_items(p_include_hidden boolean default false)
returns setof public.menu_items
language sql stable security definer set search_path = public as $$
  select * from public.menu_items
   where active = true or (p_include_hidden and public.is_staff())
   order by category, id;
$$;
revoke all on function public.list_menu_items(boolean) from public, anon;
grant execute on function public.list_menu_items(boolean) to authenticated;

-- حسابات سُجّلت قبل تشغيل المخطط ليس لها صف في profiles — نُكملها الآن
-- حتى لا يفشل أي استعلام لاحق على الدور.
insert into public.profiles (id, full_name, phone, role)
select u.id,
       coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', ''),
       coalesce(u.phone, u.raw_user_meta_data->>'phone'),
       'customer'
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 10) تشغيل أولي — احذف علامات التعليق بعد أول تشغيل
-- ---------------------------------------------------------------------------
-- (1) أنشئ حسابك من صفحة /login ثم فعّل الإدارة مرة واحدة:
--     update public.profiles set role='admin'
--      where id = (select id from auth.users where email='EMAIL@EXAMPLE.COM');
--     — أو من الواجهة: زر «أنا الإدارة» يستدعي claim_first_admin().
--
-- (2) استورد الأصناف بعد هذا المخطط:
--     db/menu_items.sql
-- ============================================================================
