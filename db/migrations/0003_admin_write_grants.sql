-- 0003 — admin write grants on the claims path (plans/005 P7). 0001 granted `app_authenticated`
-- SELECT only on the catalog tables, so the "Admins can manage …" policies existed without the
-- table privileges that would let the role ever reach them: every admin write through `userTx`
-- answered "permission denied for table …" before RLS was consulted (found live, first P7 probe).
-- Same shape as 0002's profiles fix; grants open the tables, the policies remain the boundary.

grant insert, update, delete on
  public.categories,
  public.category_translations,
  public.products,
  public.product_translations,
  public.product_images,
  public.site_settings
to app_authenticated;
