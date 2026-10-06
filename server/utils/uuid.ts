/**
 * The one uuid shape check the routes use before a value reaches a `::uuid` cast — seven route
 * files had grown their own copy of this exact character class. The pg cast is still what
 * enforces validity for real; this only keeps a malformed id from erroring inside a transaction.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
