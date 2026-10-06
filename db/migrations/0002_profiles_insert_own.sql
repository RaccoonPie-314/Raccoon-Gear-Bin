-- 0002 — profiles become app-written on the claims path (plans/005 P6). 0001 is pushed and never
-- edited; the port's deltas land as new files.
--
-- Why an insert policy now: 0001 dropped the Supabase `on_auth_user_created` trigger without a
-- replacement writer, and P6 added the upsert in /api/profile — the first place an EMAIL account
-- (created client-side by Clerk, where no server route runs) gets its row. Without this policy
-- that upsert is refused by RLS (insert has no policy = denied), and email accounts could never
-- save a display name or a checkout prefill phone. The predicate is the same own-row rule every
-- identity policy uses: you may create exactly your own row, nothing else.

create policy "Users can create their own profile"
on public.profiles for insert
with check (id = app.current_user_id());

grant insert on public.profiles to app_authenticated;
