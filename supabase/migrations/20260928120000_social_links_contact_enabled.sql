-- Product → Contact to Order needs to be separable from "shown in the masthead", so a social link
-- gains a second visibility flag. `social_links` is already a jsonb array of per-link objects, so
-- this needs no column, no table and no RLS change — the admin `for all` policy already permits the
-- UPDATE, and the shape of the collection is the extension point the schema was designed around.
--
-- What this migration does is make the rows that exist today explicit, so the two settings cannot
-- diverge between "what the data says" and "what the code assumes". A link that has never carried
-- `contact_enabled` inherits the value of its own `enabled` (and `true` when even that key is
-- absent or not a boolean). That is deliberately not `true` outright: the product page currently
-- reads the masthead's filtered list as its channel list, so defaulting to enabled would hand every
-- shop a new customer-facing contact channel for links its owner had hidden. Inheriting keeps the
-- live behaviour byte-for-byte and lets the owner opt a hidden link in from the admin UI.
--
-- The application applies the same fallback in `useSiteInfo`, so a row written by an older client —
-- or a database this migration has not reached yet — stays usable either way.
comment on column public.site_settings.social_links is
  'Array of { platform, url, enabled, sort_order, contact_enabled }. enabled = shown in the masthead; contact_enabled = offered by Product -> Contact to Order. A missing contact_enabled falls back to enabled.';

update public.site_settings s
set social_links = (
  select jsonb_agg(
    case
      -- Only well-formed link objects are touched. Anything else in the array is passed through
      -- unchanged: a defaults-backfill is not a licence to delete data the editor never wrote.
      when jsonb_typeof(e.elem) = 'object'
        and e.elem ? 'platform' and e.elem ? 'url'
        and not e.elem ? 'contact_enabled'
      then e.elem || jsonb_build_object(
        'contact_enabled',
        case jsonb_typeof(e.elem -> 'enabled')
          when 'boolean' then (e.elem ->> 'enabled')::boolean
          else true
        end
      )
      else e.elem
    end
    order by e.ord
  )
  from jsonb_array_elements(s.social_links) with ordinality as e(elem, ord)
)
where jsonb_typeof(s.social_links) = 'array' and s.social_links <> '[]'::jsonb;
