import { describe, expect, test } from 'bun:test'
import {
  LOGIN_CODE_ALPHABET,
  SYNTHETIC_EMAIL_DOMAIN,
  constantTimeEqual,
  formatLoginCode,
  generateLoginCode,
  generateNonce,
  hashCode,
  normalizeCodeInput,
  normalizePhone,
  syntheticEmail
} from '../../server/utils/auth'

describe('normalizePhone', () => {
  test('accepts the spellings Cambodia actually produces', () => {
    expect(normalizePhone('012 345 678')).toBe('+85512345678')
    expect(normalizePhone('0123456789')).toBe('+855123456789')
    expect(normalizePhone('85512345678')).toBe('+85512345678')
    expect(normalizePhone('+855 12 345 678')).toBe('+85512345678')
    expect(normalizePhone('+855-12-345-678')).toBe('+85512345678')
    expect(normalizePhone('(012) 345-678')).toBe('+85512345678')
  })

  test('rejects junk, foreign numbers, and the double-zero typo', () => {
    const junk = ['', 'hello', '+1 555 0100', '12345', '0012345678', '+855012345678', '012345678901']
    for (const bad of junk) {
      expect(normalizePhone(bad)).toBeNull()
    }
  })
})

describe('login codes', () => {
  test('generates 12 chars over the reduced alphabet, fresh every call', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 64; i++) {
      const code = generateLoginCode()
      expect(code).toHaveLength(12)
      expect(/[ILOU]/.test(code)).toBe(false)
      for (const ch of code) expect(LOGIN_CODE_ALPHABET.includes(ch)).toBe(true)
      seen.add(code)
    }
    expect(seen.size).toBe(64)
  })

  test('formats groups of four', () => {
    expect(formatLoginCode('ABCDEFGHJKMN')).toBe('ABCD-EFGH-JKMN')
  })

  test('normalizes case, separators, and the two invited misreads', () => {
    expect(normalizeCodeInput('abcd-efgh-jkmn')).toBe('ABCDEFGHJKMN')
    expect(normalizeCodeInput('ABCD EFGH JKMN')).toBe('ABCDEFGHJKMN')
    expect(normalizeCodeInput('ABCD-EFGH-JKMO')).toBe('ABCDEFGHJKM0')
    expect(normalizeCodeInput('ABCD-EFGH-JKMI')).toBe('ABCDEFGHJKM1')
    expect(normalizeCodeInput('ABCD-EFGH-JKML')).toBe('ABCDEFGHJKM1')
    expect(normalizeCodeInput('ABCD-EFGH-JKM')).toBeNull()
    expect(normalizeCodeInput('ABCD-EFGH-JKMU')).toBeNull()
    expect(normalizeCodeInput('ABCD-EFGH-JKM!')).toBeNull()
  })
})

describe('hashCode', () => {
  test('pins SHA-256 hex and is stable', async () => {
    expect(await hashCode('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await hashCode('ABCDEFGHJKMN')).toBe(await hashCode('ABCDEFGHJKMN'))
    expect(await hashCode('ABCDEFGHJKMN')).not.toBe(await hashCode('abcdefghjkmn'))
  })
})

describe('generateNonce', () => {
  test('is 32-char base64url and unique across calls', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 64; i++) {
      const nonce = generateNonce()
      expect(/^[A-Za-z0-9_-]{32}$/.test(nonce)).toBe(true)
      seen.add(nonce)
    }
    expect(seen.size).toBe(64)
  })
})

describe('syntheticEmail', () => {
  test('carries the account shape without the plus sign', () => {
    expect(syntheticEmail('phone', '+85512345678')).toBe(`p85512345678@${SYNTHETIC_EMAIL_DOMAIN}`)
    expect(syntheticEmail('telegram', '7759554016')).toBe(`tg7759554016@${SYNTHETIC_EMAIL_DOMAIN}`)
  })
})

describe('constantTimeEqual', () => {
  test('compares equal, unequal, and mismatched-length digests', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
    expect(constantTimeEqual('abc', 'ab')).toBe(false)
  })
})
