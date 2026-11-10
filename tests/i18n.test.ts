import { describe, expect, it } from 'vitest'
import { allKeys, pickLang, stringCounts, translate } from '../src/i18n'

describe('i18n', () => {
  it('es covers every en key', () => {
    const { en, es } = stringCounts()
    expect(es).toBe(en)
  })

  it('every string has the same placeholders in en and es, and none is empty', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    // Without vars, placeholders survive as {name}, so they can be compared.
    for (const key of allKeys()) {
      const en = translate('en', key)
      const es = translate('es', key)
      expect(en.length, key).toBeGreaterThan(0)
      expect(es.length, key).toBeGreaterThan(0)
      expect(vars(es), key).toEqual(vars(en))
    }
  })

  it('fills placeholders', () => {
    expect(translate('es', 'min.start', { amount: '100' })).toBe('Empezar mi stake ahora · 100 NIM')
    expect(translate('en', 'home.explainer', { min: 12, max: 24 })).toContain('12–24 hours')
  })

  it('picks Spanish for any es-* host language', () => {
    expect(pickLang('es')).toBe('es')
    expect(pickLang('es-CR')).toBe('es')
    expect(pickLang('de')).toBe('en')
    expect(pickLang(undefined)).toBe('en')
  })
})
