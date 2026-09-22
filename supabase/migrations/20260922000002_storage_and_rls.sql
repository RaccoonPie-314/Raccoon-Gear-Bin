create policy "Public catalog categories are viewable by everyone"
on public.categories
for select
using (is_active = true);

create policy "Public category translations are viewable by everyone"
on public.category_translations
for select
using (true);

create policy "Public products are viewable by everyone when published"
on public.products
for select
using (status = 'published');

create policy "Public product translations are viewable by everyone when published"
on public.product_translations
for select
using (
  exists (
    select 1
    from public.products p
    where p.id = product_translations.product_id
      and p.status = 'published'
  )
);

create policy "Public product images are viewable by everyone when published"
on public.product_images
for select
using (
  exists (
    select 1
    from public.products p
    where p.id = product_images.product_id
      and p.status = 'published'
  )
);

create policy "Users can read their own admin record"
on public.admin_users
for select
using (user_id = auth.uid());

create policy "Admins can manage categories"
on public.categories
for all
using (
  exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
  )
);

create policy "Admins can manage category translations"
on public.category_translations
for all
using (
  exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
  )
);

create policy "Admins can manage products"
on public.products
for all
using (
  exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
  )
);

create policy "Admins can manage product translations"
on public.product_translations
for all
using (
  exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
  )
);

create policy "Admins can manage product images"
on public.product_images
for all
using (
  exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
  )
);

create policy "Admins can manage admin users"
on public.admin_users
for all
using (
  exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
      and au.role = 'super_admin'
  )
)
with check (
  exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
      and au.role = 'super_admin'
  )
);

alter table public.categories enable row level security;
alter table public.category_translations enable row level security;
alter table public.products enable row level security;
alter table public.product_translations enable row level security;
alter table public.product_images enable row level security;
alter table public.admin_users enable row level security;

create policy "Allow public read access for product-images bucket"
on storage.objects for select
using (bucket_id = 'product-images');

create policy "Allow admins to upload product images"
on storage.objects for insert
with check (
  bucket_id = 'product-images'
  and exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
  )
);

create policy "Allow admins to update product images"
on storage.objects for update
using (
  bucket_id = 'product-images'
  and exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
  )
)
with check (
  bucket_id = 'product-images'
  and exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
  )
);

create policy "Allow admins to delete product images"
on storage.objects for delete
using (
  bucket_id = 'product-images'
  and exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
  )
);