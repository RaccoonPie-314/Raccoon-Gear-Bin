/**
 * The one place a `?redirect=` value is judged (login and signup both hand it here).
 *
 * Same-site paths only: the value must start with a single `/` and never `//` or `/\`, which are
 * protocol-relative URLs pointing at another origin. Anything else falls back — an open redirect
 * is how a login page turns into a phishing hop.
 *
 * A plain function, not a composable: it reads no reactive state and touches no browser API.
 */
export function safeRedirectPath(raw: unknown, fallback: string): string {
  if (typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\')) {
    return raw
  }

  return fallback
}
