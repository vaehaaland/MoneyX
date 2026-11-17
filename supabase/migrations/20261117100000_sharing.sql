-- Sharing a loan with the other party.
-- The owner creates an invite link; whoever opens it while signed in becomes a
-- member with the invite's role. Only a hash of the link's token is stored.

create table public.loan_invites (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete cascade,
  role text not null default 'editor' check (role in ('viewer', 'editor')),
  -- SHA-256 of the token in the link, hex encoded.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz
);

create index loan_invites_loan_id_idx on public.loan_invites (loan_id);
create index loan_invites_created_by_idx on public.loan_invites (created_by);
create index loan_invites_accepted_by_idx on public.loan_invites (accepted_by);

alter table public.loan_invites enable row level security;
revoke all on public.loan_invites from anon, authenticated;
-- No update: an invite is created, accepted through the function below, or deleted.
grant select, insert, delete on public.loan_invites to authenticated;

create policy loan_invites_select on public.loan_invites for select to authenticated
  using (private.loan_access(loan_id) = 'owner');
create policy loan_invites_insert on public.loan_invites for insert to authenticated
  with check (
    private.loan_access(loan_id) = 'owner'
    and created_by = (select auth.uid())
    and accepted_by is null
    and accepted_at is null
    and expires_at <= now() + interval '31 days'
  );
create policy loan_invites_delete on public.loan_invites for delete to authenticated
  using (private.loan_access(loan_id) = 'owner');

-- A member can leave a loan on their own.
create policy loan_members_delete_self on public.loan_members for delete to authenticated
  using (user_id = (select auth.uid()));

-- When each person last opened a loan, to point out what the other party added since.
create table public.loan_views (
  loan_id uuid not null references public.loans (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (loan_id, user_id)
);

create index loan_views_user_id_idx on public.loan_views (user_id);

alter table public.loan_views enable row level security;
revoke all on public.loan_views from anon, authenticated;
grant select, insert, update on public.loan_views to authenticated;

create policy loan_views_select on public.loan_views for select to authenticated
  using (user_id = (select auth.uid()));
create policy loan_views_insert on public.loan_views for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_read_loan(loan_id));
create policy loan_views_update on public.loan_views for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.can_read_loan(loan_id));

-- Stamps the loan as seen now, by the database clock that also stamps transactions.
create function public.mark_loan_seen(p_loan_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.loan_views (loan_id, user_id, last_seen_at)
  values (p_loan_id, (select auth.uid()), now())
  on conflict (loan_id, user_id) do update set last_seen_at = excluded.last_seen_at;
$$;

create function private.invite_token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

-- Where an invite stands for the caller. Holding the token is what grants
-- access, so these two functions look the invite up with the definer's rights.
create function private.invite_status(p_invite public.loan_invites, p_user_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_invite.id is null then 'invalid'
    when exists (select 1 from public.loans l where l.id = p_invite.loan_id and l.owner_id = p_user_id) then 'own_loan'
    when exists (
      select 1 from public.loan_members m where m.loan_id = p_invite.loan_id and m.user_id = p_user_id
    ) then 'already_member'
    when p_invite.accepted_at is not null then 'used'
    when p_invite.expires_at <= now() then 'expired'
    else 'open'
  end;
$$;

-- What the invite page shows before the person accepts.
create function public.loan_invite_preview(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  invite public.loan_invites;
  status text;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  select i.* into invite from public.loan_invites i
  where i.token_hash = private.invite_token_hash(p_token);
  status := private.invite_status(invite, uid);

  if status in ('invalid', 'used', 'expired') then
    return jsonb_build_object('status', status);
  end if;
  return (
    select jsonb_build_object(
      'status', status,
      'loan_id', l.id,
      'loan_name', l.name,
      'role', invite.role,
      'invited_by', coalesce(nullif(btrim(u.raw_user_meta_data ->> 'name'), ''), u.email)
    )
    from public.loans l
    join auth.users u on u.id = l.owner_id
    where l.id = invite.loan_id
  );
end;
$$;

-- Turns an open invite into a membership. An invite works once.
create function public.accept_loan_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  invite public.loan_invites;
  status text;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  -- Lock the row so two people cannot accept the same invite.
  select i.* into invite from public.loan_invites i
  where i.token_hash = private.invite_token_hash(p_token)
  for update;
  status := private.invite_status(invite, uid);

  if status = 'open' then
    insert into public.loan_members (loan_id, user_id, role) values (invite.loan_id, uid, invite.role);
    update public.loan_invites set accepted_by = uid, accepted_at = now() where id = invite.id;
    status := 'accepted';
  end if;
  return jsonb_build_object(
    'status', status,
    'loan_id', case when status in ('accepted', 'own_loan', 'already_member') then invite.loan_id end
  );
end;
$$;

-- Everyone on the loans the caller can read: the owner and the members, with
-- the name they have chosen (or their email) so each side can tell who is who.
create function public.loan_people(p_loan_id uuid default null)
returns table (loan_id uuid, user_id uuid, display_name text, email text, role text, joined_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, u.id, nullif(btrim(u.raw_user_meta_data ->> 'name'), ''), u.email::text, 'owner', l.created_at
  from public.loans l
  join auth.users u on u.id = l.owner_id
  where (p_loan_id is null or l.id = p_loan_id)
    and private.loan_access(l.id) is not null
  union all
  select m.loan_id, u.id, nullif(btrim(u.raw_user_meta_data ->> 'name'), ''), u.email::text, m.role, m.created_at
  from public.loan_members m
  join auth.users u on u.id = m.user_id
  where (p_loan_id is null or m.loan_id = p_loan_id)
    and private.loan_access(m.loan_id) is not null;
$$;

revoke execute on function private.invite_token_hash(text) from public, anon, authenticated;
revoke execute on function private.invite_status(public.loan_invites, uuid) from public, anon, authenticated;
revoke execute on function public.mark_loan_seen(uuid) from public, anon;
revoke execute on function public.loan_invite_preview(text) from public, anon;
revoke execute on function public.accept_loan_invite(text) from public, anon;
revoke execute on function public.loan_people(uuid) from public, anon;
grant execute on function public.mark_loan_seen(uuid) to authenticated;
grant execute on function public.loan_invite_preview(text) to authenticated;
grant execute on function public.accept_loan_invite(text) to authenticated;
grant execute on function public.loan_people(uuid) to authenticated;
