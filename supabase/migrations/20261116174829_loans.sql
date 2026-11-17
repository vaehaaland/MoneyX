-- Loans, rates, transactions and per-loan membership.
-- Balances are never stored: they are derived from these rows by lib/loan-engine.

create schema if not exists private;

create table public.loans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  counterparty_name text check (char_length(counterparty_name) <= 120),
  direction text not null check (direction in ('borrowed', 'lent')),
  currency text not null default 'NOK' check (currency ~ '^[A-Z]{3}$'),
  start_date date not null,
  capitalization text not null default 'none' check (capitalization in ('none', 'monthly', 'yearly')),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.loan_members (
  loan_id uuid not null references public.loans (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('viewer', 'editor')),
  created_at timestamptz not null default now(),
  primary key (loan_id, user_id)
);

create table public.loan_rates (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete cascade,
  valid_from date not null,
  annual_rate_bp integer not null check (annual_rate_bp between 0 and 100000),
  created_at timestamptz not null default now(),
  unique (loan_id, valid_from)
);

create table public.loan_transactions (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete cascade,
  date date not null,
  amount_ore bigint not null check (amount_ore <> 0 and (kind = 'adjustment' or amount_ore > 0)),
  kind text not null check (kind in ('disbursement', 'repayment', 'fee', 'adjustment')),
  note text check (char_length(note) <= 500),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index loans_owner_id_idx on public.loans (owner_id);
create index loan_members_user_id_idx on public.loan_members (user_id);
create index loan_transactions_loan_id_date_idx on public.loan_transactions (loan_id, date);
create index loan_transactions_created_by_idx on public.loan_transactions (created_by);

-- Access helpers. Security definer so policies on loans and loan_members can
-- consult each other without recursing; they only ever answer for the caller.
create function private.loan_access(p_loan_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.loans l
      where l.id = p_loan_id and l.owner_id = (select auth.uid())
    ) then 'owner'
    else (
      select m.role from public.loan_members m
      where m.loan_id = p_loan_id and m.user_id = (select auth.uid())
    )
  end;
$$;

create function private.can_read_loan(p_loan_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.loan_access(p_loan_id) is not null;
$$;

create function private.can_write_loan(p_loan_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(private.loan_access(p_loan_id) in ('owner', 'editor'), false);
$$;

revoke all on schema private from public, anon;
revoke execute on all functions in schema private from public, anon;
grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;

alter table public.loans enable row level security;
alter table public.loan_members enable row level security;
alter table public.loan_rates enable row level security;
alter table public.loan_transactions enable row level security;

revoke all on public.loans, public.loan_members, public.loan_rates, public.loan_transactions from anon;
grant select, insert, update, delete
  on public.loans, public.loan_members, public.loan_rates, public.loan_transactions
  to authenticated;

-- loans: owner manages, members read.
create policy loans_select on public.loans for select to authenticated
  using (owner_id = (select auth.uid()) or (select private.can_read_loan(id)));
create policy loans_insert on public.loans for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy loans_update on public.loans for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy loans_delete on public.loans for delete to authenticated
  using (owner_id = (select auth.uid()));

-- loan_members: a member sees their own row, the owner manages all of them.
create policy loan_members_select on public.loan_members for select to authenticated
  using (user_id = (select auth.uid()) or private.loan_access(loan_id) = 'owner');
create policy loan_members_insert on public.loan_members for insert to authenticated
  with check (private.loan_access(loan_id) = 'owner' and user_id <> (select auth.uid()));
create policy loan_members_update on public.loan_members for update to authenticated
  using (private.loan_access(loan_id) = 'owner')
  with check (private.loan_access(loan_id) = 'owner' and user_id <> (select auth.uid()));
create policy loan_members_delete on public.loan_members for delete to authenticated
  using (private.loan_access(loan_id) = 'owner');

-- loan_rates: readers read, owner and editors write.
create policy loan_rates_select on public.loan_rates for select to authenticated
  using (private.can_read_loan(loan_id));
create policy loan_rates_insert on public.loan_rates for insert to authenticated
  with check (private.can_write_loan(loan_id));
create policy loan_rates_update on public.loan_rates for update to authenticated
  using (private.can_write_loan(loan_id))
  with check (private.can_write_loan(loan_id));
create policy loan_rates_delete on public.loan_rates for delete to authenticated
  using (private.can_write_loan(loan_id));

-- loan_transactions: readers read, owner and editors write.
create policy loan_transactions_select on public.loan_transactions for select to authenticated
  using (private.can_read_loan(loan_id));
create policy loan_transactions_insert on public.loan_transactions for insert to authenticated
  with check (private.can_write_loan(loan_id) and created_by = (select auth.uid()));
create policy loan_transactions_update on public.loan_transactions for update to authenticated
  using (private.can_write_loan(loan_id))
  with check (private.can_write_loan(loan_id));
create policy loan_transactions_delete on public.loan_transactions for delete to authenticated
  using (private.can_write_loan(loan_id));
