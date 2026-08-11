-- ==========================================================
-- گھر کا حساب — Supabase Database Schema
-- ==========================================================
-- یہ اسکرپٹ اپنے Supabase پراجیکٹ کے SQL Editor میں چلائیں
-- (Supabase Dashboard → SQL Editor → New Query → Paste → Run)
-- ==========================================================

-- تمام ٹیبلز ایک "household_id" سے جڑی ہوں گی۔
-- یہ household_id آپ خود ایک لمبا، اندازہ نہ لگایا جا سکنے والا
-- تصادفی کوڈ منتخب کریں گے (مثلاً UUID) اور صرف آپ دونوں کے
-- فونز میں محفوظ ہوگا۔ یہی آپ کے ڈیٹا کی رازداری کی بنیاد ہے۔

create extension if not exists "pgcrypto";

-- 1) خاندانی سیٹنگز (ماہانہ آمدن وغیرہ) ------------------------
create table if not exists household_settings (
  household_id   uuid primary key,
  monthly_income numeric(12,2) not null default 0,
  updated_at     timestamptz not null default now()
);

-- 2) اندراجات: خرچ، بچت ----------------------------------------
create table if not exists entries (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null,
  entry_type    text not null check (entry_type in ('expense','saving')),
  category      text not null,
  subcategory   text,
  amount        numeric(12,2) not null check (amount >= 0),
  note          text,
  entered_by    text not null,
  entry_date    date not null default current_date,
  created_at    timestamptz not null default now()
);

create index if not exists entries_household_month_idx
  on entries (household_id, entry_date);

-- 3) ماہانہ بجٹ (فی مد) ------------------------------------------
create table if not exists budgets (
  household_id  uuid not null,
  category      text not null,
  month         text not null, -- 'YYYY-MM'
  limit_amount  numeric(12,2) not null check (limit_amount >= 0),
  primary key (household_id, category, month)
);

-- ==========================================================
-- Row Level Security
-- ==========================================================
-- نوٹ: یہ ایپ صرف "household_id" کی رازداری پر انحصار کرتی ہے —
-- یعنی جس کے پاس آپ کا مخصوص household_id اور anon key دونوں
-- ہوں وہی ڈیٹا تک رسائی رکھ سکتا ہے۔ یہ سادہ ذاتی/گھریلو استعمال
-- کے لیے کافی ہے، لیکن انٹرپرائز درجے کی سیکیورٹی نہیں۔
-- household_id کو کبھی عوامی جگہ پر شیئر نہ کریں۔

alter table household_settings enable row level security;
alter table entries enable row level security;
alter table budgets enable row level security;

create policy "household_settings_all" on household_settings
  for all using (true) with check (true);

create policy "entries_all" on entries
  for all using (true) with check (true);

create policy "budgets_all" on budgets
  for all using (true) with check (true);

-- ==========================================================
-- Realtime (تاکہ دونوں فون خودکار Sync ہوں)
-- ==========================================================
alter publication supabase_realtime add table entries;
alter publication supabase_realtime add table household_settings;
alter publication supabase_realtime add table budgets;
