/**
 * The one owner of "does this account already have a name to show", which is the verdict that
 * decides where a finished sign-in belongs: `/account` is the profile editor, so landing there is
 * onboarding, not a destination.
 *
 * Both name sources count, because an account can be named in either place:
 * - `profiles.display_name` is the name the buyer typed on `/account`;
 * - the Clerk name is the one an OAuth account arrives with — Google hands a display name over at
 *   first consent, and editing it in Clerk's own UI is still the buyer having named their account.
 * Reading only the column sent every nicknamed Gmail account back into onboarding, and kept
 * sending the ones that had saved a name there (live report, 2026-10-07).
 *
 * A `null` profile means "no row written yet", not "the read failed" — callers keep their own
 * fallback for a failed read, where the miss is visible.
 *
 * A plain function, not a composable: it reads no reactive state and touches no browser API.
 */
export function accountHasName(
  profile: { display_name: string | null } | null,
  clerkName?: string | null
): boolean {
  return Boolean(profile?.display_name?.trim() || clerkName?.trim())
}
