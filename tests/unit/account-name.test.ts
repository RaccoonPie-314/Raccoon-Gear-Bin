import { describe, expect, test } from 'bun:test'
import { accountHasName } from '../../app/utils/account-name'

// The verdict that decides storefront vs. profile editor after a sign-in. Both name sources count:
// the row the buyer saved on /account, and the name Clerk carries for an OAuth account. Getting
// this backwards is invisible in every other gate — the landing simply keeps being wrong.

describe('where a finished sign-in belongs', () => {
  test('a saved profile name is a named account', () => {
    expect(accountHasName({ display_name: 'Ah poy', id: 'user_1', phone: null })).toBe(true)
  })

  test('a Clerk name counts when no row was ever written', () => {
    // The Gmail case: Google hands a display name over at first consent, `/api/profile` answers
    // null because nothing upserted the row.
    expect(accountHasName(null, 'RaccoonPie')).toBe(true)
  })

  test('whitespace is not a name', () => {
    expect(accountHasName({ display_name: '   ', id: 'user_1', phone: null })).toBe(false)
    expect(accountHasName(null, '  ')).toBe(false)
  })

  test('an unnamed account stays on the onboarding landing', () => {
    expect(accountHasName(null, null)).toBe(false)
    expect(accountHasName({ display_name: null, id: 'user_1', phone: null })).toBe(false)
    expect(accountHasName({ display_name: null, id: 'user_1', phone: null }, undefined)).toBe(false)
  })
})
