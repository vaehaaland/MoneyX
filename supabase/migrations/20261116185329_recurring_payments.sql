-- Recurring loan payments: a rule per fixed monthly amount. A daily job posts
-- each one as an ordinary loan transaction when its date arrives, so the
-- balance still comes from transactions alone.

create extension if not exists pg_cron;

create table public.loan_recurring_payments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete cascade,
  kind text not null default 'repayment' check (kind in ('repayment', 'disbursement')),
  amount_ore bigint not null check (amount_ore > 0),
  -- 31 means the last day of shorter months.
  day_of_month integer not null check (day_of_month between 1 and 31),
  start_date date not null check (start_date >= date '2000-01-01'),
  end_date date check (end_date >= start_date),
  note text check (char_length(note) <= 500),
  -- The next date to post. Set on insert, advanced by the posting function.
  next_due date not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index loan_recurring_payments_loan_id_idx on public.loan_recurring_payments (loan_id);
create index loan_recurring_payments_next_due_idx on public.loan_recurring_payments (next_due);
create index loan_recurring_payments_created_by_idx on public.loan_recurring_payments (created_by);

alter table public.loan_transactions
  add column recurring_id uuid references public.loan_recurring_payments (id) on delete set null;

-- One posting per rule per date makes the job safe to run more than once.
create unique index loan_transactions_recurring_date_key
  on public.loan_transactions (recurring_id, date)
  where recurring_id is not null;

-- The due date in the month of p_month for a given day of month.
create function private.recurring_due_date(p_month date, p_day integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select (
    date_trunc('month', p_month)
    + (least(p_day, extract(day from date_trunc('month', p_month) + interval '1 month - 1 day')::integer) - 1)
      * interval '1 day'
  )::date;
$$;

create function private.set_recurring_next_due()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  due date := private.recurring_due_date(new.start_date, new.day_of_month);
begin
  if due < new.start_date then
    due := private.recurring_due_date((date_trunc('month', new.start_date) + interval '1 month')::date, new.day_of_month);
  end if;
  new.next_due := due;
  return new;
end;
$$;

create trigger loan_recurring_payments_set_next_due
  before insert on public.loan_recurring_payments
  for each row execute function private.set_recurring_next_due();

-- Posts every due occurrence up to today (Norwegian time) and returns how many
-- transactions were added. Runs with the caller's rights, so row level
-- security decides which rules a signed-in user can post for.
create function public.post_due_recurring_payments(p_loan_id uuid default null)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  rule record;
  today date := (now() at time zone 'Europe/Oslo')::date;
  due date;
  added integer;
  total integer := 0;
begin
  for rule in
    select * from public.loan_recurring_payments r
    where (p_loan_id is null or r.loan_id = p_loan_id)
      and r.next_due <= today
      and (r.end_date is null or r.next_due <= r.end_date)
    for update skip locked
  loop
    due := rule.next_due;
    while due <= today and (rule.end_date is null or due <= rule.end_date) loop
      insert into public.loan_transactions (loan_id, date, amount_ore, kind, note, recurring_id)
      values (rule.loan_id, due, rule.amount_ore, rule.kind, rule.note, rule.id)
      on conflict (recurring_id, date) where recurring_id is not null do nothing;
      get diagnostics added = row_count;
      total := total + added;
      due := private.recurring_due_date((date_trunc('month', due) + interval '1 month')::date, rule.day_of_month);
    end loop;
    update public.loan_recurring_payments set next_due = due where id = rule.id;
  end loop;
  return total;
end;
$$;

revoke execute on function private.recurring_due_date(date, integer) from public, anon;
revoke execute on function private.set_recurring_next_due() from public, anon;
grant execute on function private.recurring_due_date(date, integer) to authenticated;
revoke execute on function public.post_due_recurring_payments(uuid) from public, anon;
grant execute on function public.post_due_recurring_payments(uuid) to authenticated;

alter table public.loan_recurring_payments enable row level security;
revoke all on public.loan_recurring_payments from anon;
grant select, insert, update, delete on public.loan_recurring_payments to authenticated;

create policy loan_recurring_payments_select on public.loan_recurring_payments for select to authenticated
  using (private.can_read_loan(loan_id));
create policy loan_recurring_payments_insert on public.loan_recurring_payments for insert to authenticated
  with check (private.can_write_loan(loan_id) and created_by = (select auth.uid()));
create policy loan_recurring_payments_update on public.loan_recurring_payments for update to authenticated
  using (private.can_write_loan(loan_id))
  with check (private.can_write_loan(loan_id));
create policy loan_recurring_payments_delete on public.loan_recurring_payments for delete to authenticated
  using (private.can_write_loan(loan_id));

-- Every night at 03:15 UTC, after the date has turned in Norway.
select cron.schedule(
  'post-recurring-loan-payments',
  '15 3 * * *',
  $$select public.post_due_recurring_payments()$$
);
