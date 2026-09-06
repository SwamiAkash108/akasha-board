-- Akasha Board schema — paste into Supabase SQL Editor and Run once.
create extension if not exists pgcrypto;

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text default '#e8a33d',
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  title text not null,
  notes text not null default '',
  status text not null default 'todo' check (status in ('todo','doing','blocked','done')),
  priority int not null default 2 check (priority in (1,2,3)),
  start date,
  due date,
  position float8 not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  author text not null default 'akash',
  text text not null,
  created_at timestamptz not null default now()
);

-- bot inbox: telegram messages land here, Fluso processes them
create table if not exists inbox (
  id bigint generated always as identity primary key,
  tg_id bigint,
  kind text not null default 'text',
  text text,
  file_path text,
  transcript text,
  processed boolean not null default false,
  received_at timestamptz not null default now()
);

-- bot conversation log (so Fluso sees full history on wake)
create table if not exists chat (
  id bigint generated always as identity primary key,
  role text not null check (role in ('user','fluso')),
  text text not null,
  created_at timestamptz not null default now()
);

-- voice notes from telegram
insert into storage.buckets (id, name, public)
values ('voice', 'voice', false)
on conflict (id) do nothing;

-- lock down: only the signed-in owner can read/write
alter table projects enable row level security;
alter table tasks enable row level security;
alter table updates enable row level security;
alter table inbox enable row level security;
alter table chat enable row level security;

create policy "owner all" on projects for all to authenticated using (true) with check (true);
create policy "owner all" on tasks for all to authenticated using (true) with check (true);
create policy "owner all" on updates for all to authenticated using (true) with check (true);
create policy "owner all" on inbox for all to authenticated using (true) with check (true);
create policy "owner all" on chat for all to authenticated using (true) with check (true);

-- realtime for live board refresh
alter publication supabase_realtime add table tasks;
alter publication supabase_realtime add table updates;
alter publication supabase_realtime add table projects;
