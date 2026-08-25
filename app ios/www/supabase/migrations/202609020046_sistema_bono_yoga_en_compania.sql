-- Migration 202609020046: Sistema de Bono Yoga en Compañía de Bienvenida
alter table public.profiles add column if not exists saldo_yoga_compania integer not null default 1;
update public.profiles set saldo_yoga_compania = coalesce(saldo_yoga_compania, 1);
