create table if not exists public.support_requests (
  id uuid primary key,
  workspace_id uuid not null,
  customer_name text not null check (char_length(customer_name) between 1 and 120),
  message text not null check (char_length(message) between 1 and 5000),
  created_at timestamptz not null default now(),
  analysis jsonb,
  analyzed_at timestamptz
);
create index if not exists support_requests_workspace_created_idx
  on public.support_requests (workspace_id, created_at desc);
alter table public.support_requests enable row level security;
-- Only the server-side service role can access this table. Never expose that key in the browser.
