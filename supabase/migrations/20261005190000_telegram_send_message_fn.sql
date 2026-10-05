-- identity v2 support — one door for the Worker to send a Telegram message without the bot token
-- ever leaving the database. Reads the same Vault secret pg_net's order push uses; execute is
-- revoked from every client role (public, anon, authenticated) and granted to service_role alone,
-- mirroring 20261004130000_payments.sql's revoke discipline.
--
-- Why this is not the 20261005180000 file it was meant to be: that migration was applied EMPTY —
-- a tooling race overwrote its file with the empty scaffold between write and push, and pushed
-- migrations are never edited. The no-op stays in history; this file is the real one.
create or replace function public.telegram_send_message(p_chat_id bigint, p_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name = 'telegram_bot_token';

  -- Inert without the secret (the same stance the order push took): no token, no message.
  if v_token is null then
    return;
  end if;

  -- Same call shape as the order push's trigger — net queues it post-transaction.
  perform net.http_post(
    url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    body := jsonb_build_object('chat_id', p_chat_id, 'text', left(p_text, 4000)),
    timeout_milliseconds := 5000
  );
end;
$$;

revoke all on function public.telegram_send_message(bigint, text) from public, anon, authenticated;
grant execute on function public.telegram_send_message(bigint, text) to service_role;
