-- Sparcadex Solutions - Supabase PostgreSQL schema
create extension if not exists pgcrypto;

create table if not exists public.inquiries (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    email text not null,
    phone text,
    company text,
    project_type text,
    message text not null,
    created_at timestamptz not null default now()
);

create index if not exists inquiries_created_at_idx
on public.inquiries (created_at desc);

-- The Node/Express server connects with the database credentials.
-- Keep direct client-side access disabled unless you intentionally
-- configure Supabase RLS policies for a separate client application.
