-- The product-images bucket itself. Its RLS policies live in 20260922000002_storage_and_rls.sql,
-- but the bucket row was created in the dashboard on the original project and never migrated —
-- the RGB-DB-SG migration surfaced it (a fresh project came up with policies and no bucket, and
-- every upload answered "Bucket not found"). Idempotent: the original project and the new one
-- both already carry the row, so this is a no-op there and the source of truth everywhere else.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;
