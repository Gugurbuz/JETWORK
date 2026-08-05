alter table public.messages
  add column if not exists sender_color text,
  add column if not exists reply_to_id text;

alter table public.messages
  drop constraint if exists messages_reply_to_id_fkey;

alter table public.messages
  add constraint messages_reply_to_id_fkey
  foreign key (reply_to_id)
  references public.messages(id)
  on delete set null;
