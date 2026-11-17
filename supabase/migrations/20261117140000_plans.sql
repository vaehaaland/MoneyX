-- Repayment plans. A plan is a fixed monthly amount from a start date, plus
-- optional one-off payments. Plans are only ever simulated by the app: nothing
-- here posts transactions. The active plan is the one the app asks about
-- ("did you pay … on the 15th?") and measures progress against.

create table public.loan_plans (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  monthly_amount_ore bigint not null check (monthly_amount_ore between 0 and 100000000000),
  -- 31 means the last day of shorter months.
  day_of_month integer not null check (day_of_month between 1 and 31),
  start_date date not null check (start_date >= date '2000-01-01'),
  -- Null: simulate with the loan's own rates.
  assumed_rate_bp integer check (assumed_rate_bp between 0 and 100000),
  -- One-off payments: [{"date": "2027-06-01", "amount_ore": 1000000}, ...]
  extra_payments jsonb not null default '[]'::jsonb
    check (jsonb_typeof(extra_payments) = 'array' and jsonb_array_length(extra_payments) <= 50),
  is_active boolean not null default false,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Lets loan_plan_occurrences tie its loan_id to the plan's.
  unique (id, loan_id)
);

create index loan_plans_loan_id_idx on public.loan_plans (loan_id);
create index loan_plans_created_by_idx on public.loan_plans (created_by);
-- At most one active plan per loan.
create unique index loan_plans_one_active_key on public.loan_plans (loan_id) where is_active;

-- What someone answered when asked about a planned payment that was not
-- registered: skip it for good, or ask again later. A payment that was made is
-- simply a transaction and needs no row here.
create table public.loan_plan_occurrences (
  plan_id uuid not null,
  loan_id uuid not null,
  due_date date not null,
  status text not null check (status in ('skipped', 'snoozed')),
  snoozed_until date,
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (plan_id, due_date),
  foreign key (plan_id, loan_id) references public.loan_plans (id, loan_id) on delete cascade,
  check ((status = 'snoozed') = (snoozed_until is not null))
);

create index loan_plan_occurrences_loan_id_idx on public.loan_plan_occurrences (loan_id);
create index loan_plan_occurrences_updated_by_idx on public.loan_plan_occurrences (updated_by);

alter table public.loan_plans enable row level security;
alter table public.loan_plan_occurrences enable row level security;
revoke all on public.loan_plans, public.loan_plan_occurrences from anon, authenticated;
grant select, insert, update, delete on public.loan_plans, public.loan_plan_occurrences to authenticated;

-- Same rule as transactions: readers read, owner and editors write.
create policy loan_plans_select on public.loan_plans for select to authenticated
  using (private.can_read_loan(loan_id));
create policy loan_plans_insert on public.loan_plans for insert to authenticated
  with check (private.can_write_loan(loan_id) and created_by = (select auth.uid()));
create policy loan_plans_update on public.loan_plans for update to authenticated
  using (private.can_write_loan(loan_id))
  with check (private.can_write_loan(loan_id));
create policy loan_plans_delete on public.loan_plans for delete to authenticated
  using (private.can_write_loan(loan_id));

create policy loan_plan_occurrences_select on public.loan_plan_occurrences for select to authenticated
  using (private.can_read_loan(loan_id));
create policy loan_plan_occurrences_insert on public.loan_plan_occurrences for insert to authenticated
  with check (private.can_write_loan(loan_id) and updated_by = (select auth.uid()));
create policy loan_plan_occurrences_update on public.loan_plan_occurrences for update to authenticated
  using (private.can_write_loan(loan_id))
  with check (private.can_write_loan(loan_id) and updated_by = (select auth.uid()));
create policy loan_plan_occurrences_delete on public.loan_plan_occurrences for delete to authenticated
  using (private.can_write_loan(loan_id));

-- Makes one plan the active one, or none when p_plan_id is null. Runs with the
-- caller's rights, so row level security decides whether they may.
create function public.set_active_loan_plan(p_loan_id uuid, p_plan_id uuid default null)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.loan_plans set is_active = false where loan_id = p_loan_id and is_active;
  if p_plan_id is not null then
    update public.loan_plans set is_active = true where id = p_plan_id and loan_id = p_loan_id;
    if not found then
      raise exception 'Plan not found' using errcode = 'P0002';
    end if;
  end if;
end;
$$;

revoke execute on function public.set_active_loan_plan(uuid, uuid) from public, anon;
grant execute on function public.set_active_loan_plan(uuid, uuid) to authenticated;
