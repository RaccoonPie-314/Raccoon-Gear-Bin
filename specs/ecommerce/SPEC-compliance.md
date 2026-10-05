# SPEC-compliance — module id `compliance`

Phase 1, parallel with `identity`. Must land before identity deploys (gate G1): accounts start
collecting personal data the day they ship. Specified in [CAPABILITY-MAP.md](CAPABILITY-MAP.md);
global rules in [SPEC-overview.md](SPEC-overview.md).

## Objective

The site's legal pages do not exist yet (no `/privacy`, no `/terms` — verified 2026-10-04). This
module creates them for a **transactional** store, and writes down the data-retention and
account-deletion policy that the ledger (`orders`) and the identity module must honour.

The old position — "does not collect user personal data for any purpose" — stops being true when
`identity` deploys. The pages created here are the notice of the new position; the `orders` module
provides the deletion mechanism (`anonymize_customer`); this module owns the policy text and the
runbook that uses it.

## Boundaries

- **Owns**: `app/pages/privacy.vue`, `app/pages/terms.vue`, the signup consent line (copy + links,
  mounted on the identity page), footer links to both pages, the content checklists below, the
  retention policy, and the account-deletion runbook.
- **Does not own**: the `anonymize_customer` RPC itself (`orders`), any self-serve deletion UI (v1 is
  contact-first — recorded decision), cookie consent banner (no analytics, no marketing cookies —
  nothing to consent to beyond the session cookie, which the privacy page discloses).
- English copy is drafted here and mirrored in Khmer; both locales pass the harness' Khmer source
  scan (no non-Khmer codepoints sneaking in).

## Pages

- Routes `/privacy` and `/terms` render for both locales via the existing route prefix
  (`/km/privacy` etc.). All copy ships as `t()` keys in
  [i18n.config.ts](../../i18n.config.ts), sectioned (`privacySectionXxxTitle` / body keys — long
  strings stay greppable and the harness scan sees them).
- **Footer links contract (amended 2026-10-04, implementation evidence)**: `StoreFooter.vue` renders
  on the catalog page; the two legal pages cross-link each other; `/signup` carries the consent
  line. The **product detail page deliberately does not carry the footer**: bottom content there
  changes the page's scrollable height, which the tuned panel-swap checks measure exactly (first
  harness run: 3 red checks — on that fixture the panels ARE the page's scrollable height). Account
  and legal entries reach that page's visitors through the catalog footer and the order surfaces;
  the phase-2/3 masthead work installs the proper site-wide entries. The no-horizontal-overflow
  sweeps stay green at the standard widths.
- `/signup` carries the consent line: "By creating an account you agree to the Terms and Privacy
  Policy." with both links.

## Privacy page — content checklist (all points must be covered; wording is the owner's to review)

| # | Section | Must state |
|---|---|---|
| P1 | What is collected | Account email; display name + phone (optional); order data: delivery name, phone, address, note, items, totals; session cookie; device-local prefs (language, theme, cart — local only, never sent) |
| P2 | Why | Order fulfilment and delivery contact; order support; legal/accounting record |
| P3 | Who processes it | Supabase (database, auth, storage), Cloudflare (hosting/CDN), ABA PayWay (payments, **once phase 4 ships** — the sentence ships now, marked for the payments release to activate) |
| P4 | Retention | Account: until deletion is requested. Orders: anonymized on deletion, retained without personal data for accounting (window = owner's decision, open question) |
| P5 | Deletion & rights | Request via the contact channels (phone/Telegram on the contact page); access/correction same route; the deletion runbook below |
| P6 | Not done | No marketing emails, no analytics, no advertising cookies, no data sold or shared beyond P3 processors |
| P7 | Children / misc | Not directed at children; contact details for questions |

## Terms page — content checklist

| # | Section | Must state |
|---|---|---|
| T1 | Who is selling | The shop as a **reseller** — it does not own the brands of the items sold (existing fact, kept) |
| T2 | Ordering & prices | Prices in USD; **the price shown at order placement is binding** for that order (the reversal of "indicative and negotiable" is stated here; negotiation stays available through Contact-to-Order but does not change a placed order) |
| T3 | Payment | Pay on receipt (cash or bank transfer on delivery); online payment added with phase 4 |
| T4 | Delivery & shipping | Delivery arranged with the shop after order confirmation; **shipping is not free** — its cost is settled during confirmation and is not part of the order total |
| T5 | Cancellation | Buyer may request cancellation via contact before dispatch; the shop may cancel (with notice) when an item turns out unavailable |
| T6 | Warranty & returns | **Placeholder section — must be filled before G1.** The project records mark warranty/return policy as undecided; an explicit "to be determined" is not acceptable on a live transactional terms page, so this is an owner-input gate, not a coding task |
| T7 | Liability, governing law | Governing law: Cambodia (owner confirms); standard liability limits |
| T8 | Contact | The site's contact channels |

## Account deletion runbook (v1, contact-first)

1. Buyer requests deletion through a contact channel; the seller confirms from the account's email
   or phone pattern (social verification, logged in the reply).
2. Admin runs `select public.anonymize_customer('<user uuid>');` on the project (Supabase SQL
   editor) — nulls delivery PII on that user's orders, **before** the next step (after user deletion
   the rows are unfindable by `user_id`).
3. Admin deletes the auth user (Supabase dashboard → Authentication) — profile cascades away,
   `orders.user_id` detaches to null.
4. Reply to the buyer confirming deletion.

This runbook is executed once on the local stack during C1 as a rehearsal and its output recorded;
no self-serve UI in v1 (deferred, open question).

## Copy harmonization (owner review, part of C1)

The product pages currently invite negotiation ("Contact to order"); with a cart charging list
prices, that copy needs one harmonizing pass so the two channels do not contradict the Terms:
negotiation = for questions and special cases; placed orders = the shown price. Listed here so the
wording change is a decision, not drift.

## i18n keys

`privacyTitle`, `termsTitle`, plus the sectioned keys for P1–P7 and T1–T8 (≈30 keys per locale).
The Khmer side is a real translation, not transliteration; the harness' `km`-charset scan must stay
green (it reads this file from disk before the browser starts).

## Success criteria

1. `/privacy` and `/terms` reachable (EN + KM) from the storefront footer and `/signup`; harness
   asserts both routes render with their translated headings.
2. Every checklist row P1–P7 and T1–T8 is present; T6 is either filled (owner input) or C1 is **not
   accepted** — G1 stays closed.
3. Signup shows the consent line with both links (harness-asserted on the signup page).
4. Deletion runbook rehearsed once on the local stack, output recorded.
5. Fast gates green; `bun run verify` green once before the phase-1 G3 merge; no tuned-geometry or
   Khmer-typography regression.

## Open questions

- Retention window for anonymized order records (owner/accounting).
- Governing law confirmation + business registration details if the owner wants them on the Terms.
- Warranty/returns policy (T6) — the one hard blocker for G1.
- Whether "Contact to order" copy changes site-wide, and whether the pre-written contact messages
  (harness-matched strings) are affected — if so, harness checks move in the same commit.
