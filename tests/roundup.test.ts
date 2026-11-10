import { describe, expect, it } from 'vitest'
import type { SpendEvent } from '../src/chain/spending'
import { priceForDay } from '../src/prices'
import { buildRoundUps, DEFAULT_STEP, getSweepQuote, roundUpAmount, stepFor, STEPS } from '../src/roundup'

const day = (d: string) => Date.parse(`${d}T12:00:00Z`)
const spend = (hash: string, nim: number, d: string, kind: SpendEvent['kind'] = 'payment'): SpendEvent => ({
  hash,
  timestamp: day(d),
  valueLuna: Math.round(nim * 1e5),
  recipient: 'NQ32 9CGX GGYH 2DNL D7AL AQGM FHU8 SJ5U 8DKM',
  kind,
  from: 'NQ89 4VDF DQ8Q JEGL KX8U A1HC DE6K A78Y CJR5',
})
// NIM at $0.25 makes the maths readable: 1 NIM = $0.25.
const table = { daily: { '2026-11-01': 0.25, '2026-11-02': 0.25, '2026-11-04': 0.2 }, approxDays: [] }
const none = { excluded: [], swept: [] }

describe('roundUpAmount', () => {
  it('rounds up to the next step', () => {
    expect(roundUpAmount(3.2, 1)).toBe(0.8)
    expect(roundUpAmount(3.21, 0.1)).toBe(0.09)
    expect(roundUpAmount(3.2, 0.5)).toBe(0.3)
  })

  it('an exact multiple gives 0, including float-noisy ones', () => {
    expect(roundUpAmount(4, 1)).toBe(0)
    expect(roundUpAmount(1.3, 0.1)).toBe(0) // 1.3/0.1 = 13.000000000000002
    expect(roundUpAmount(0.7, 0.1)).toBe(0)
    expect(roundUpAmount(1500, 500)).toBe(0)
  })

  it('CRC and GMD steps', () => {
    expect(STEPS.CRC).toEqual([100, 500, 1000])
    expect(DEFAULT_STEP.CRC).toBe(500)
    expect(roundUpAmount(1234.5, 500)).toBe(265.5)
    expect(roundUpAmount(1234.5, 100)).toBe(65.5)
    expect(STEPS.GMD).toEqual([5, 10, 50])
    expect(DEFAULT_STEP.GMD).toBe(10)
    expect(roundUpAmount(37.2, 10)).toBe(2.8)
    expect(roundUpAmount(37.2, 50)).toBe(12.8)
    expect(roundUpAmount(35, 5)).toBe(0)
  })
})

describe('stepFor', () => {
  it('is the power of ten at or below the payment, capped at maxStep', () => {
    expect(stepFor(0.0027, 1)).toBe(0.001)
    expect(stepFor(0.001, 1)).toBe(0.001)
    expect(stepFor(0.1, 1)).toBe(0.1)
    expect(stepFor(2.9129, 1)).toBe(1)
    expect(stepFor(9.98, 500)).toBe(1)
    expect(stepFor(100, 500)).toBe(100)
    expect(stepFor(999.9999999, 1000)).toBe(100)
    expect(stepFor(1000, 500)).toBe(500)
    expect(stepFor(1308.91, 500)).toBe(500)
    expect(stepFor(37.2, 10)).toBe(10)
  })
})

describe('buildRoundUps', () => {
  it('values each spend at its own day price', () => {
    const [a, b] = buildRoundUps([spend('a', 10, '2026-11-01'), spend('b', 10, '2026-11-04')], table, { maxStep: 1, multiplier: 1 }, none)
    expect(a.fiatAtTime).toBe(2.5)
    expect(a.roundUp).toBe(0.5)
    expect(b.fiatAtTime).toBe(2)
    expect(b.roundUp).toBe(0)
  })

  it('caps the round-up at 50% of the payment', () => {
    // $0.11 → step $0.10 → raw round-up $0.09, more than half of $0.11 → $0.055.
    const [i] = buildRoundUps([spend('a', 0.44, '2026-11-01')], table, { maxStep: 1, multiplier: 1 }, none)
    expect(i.fiatAtTime).toBe(0.11)
    expect(i.step).toBe(0.1)
    expect(i.roundUp).toBe(0.055)
  })

  it('sizes the step to the payment', () => {
    // 1 NIM = $0.25 → step $0.10 → $0.30, not $1.00.
    const [i] = buildRoundUps([spend('a', 1, '2026-11-01')], table, { maxStep: 1, multiplier: 1 }, none)
    expect(i.step).toBe(0.1)
    expect(i.roundUp).toBe(0.05)
  })

  it('applies the multiplier after the cap', () => {
    const [capped] = buildRoundUps([spend('a', 0.44, '2026-11-01')], table, { maxStep: 1, multiplier: 3 }, none)
    expect(capped.roundUp).toBe(0.055)
    expect(capped.saved).toBe(0.165)
    const [normal] = buildRoundUps([spend('b', 10, '2026-11-01')], table, { maxStep: 1, multiplier: 2 }, none)
    expect(normal.roundUp).toBe(0.5)
    expect(normal.saved).toBe(1)
  })

  it('labels lightning items and keeps them pending by default', () => {
    const [i] = buildRoundUps([spend('l', 10, '2026-11-01', 'lightning')], table, { maxStep: 1, multiplier: 1 }, none)
    expect(i.label).toBe('Lightning / swap')
    expect(i.status).toBe('pending')
  })

  it('flags a missing day price and uses the nearest day', () => {
    const [i] = buildRoundUps([spend('a', 10, '2026-11-03')], table, { maxStep: 1, multiplier: 1 }, none)
    expect(i.priceApproximate).toBe(true)
    expect(['2026-11-02', '2026-11-04']).toContain(i.priceDay)
    expect(priceForDay(table, '2026-11-01')).toEqual({ price: 0.25, day: '2026-11-01', approximate: false })
    expect(priceForDay({ daily: {}, approxDays: [] }, '2026-11-01')).toBeNull()
  })

  it('with no price at all, the item is flagged and saves nothing', () => {
    const [i] = buildRoundUps([spend('a', 10, '2026-11-01')], { daily: {}, approxDays: [] }, { maxStep: 1, multiplier: 1 }, none)
    expect(i).toMatchObject({ price: null, priceApproximate: true, fiatAtTime: 0, roundUp: 0, saved: 0 })
  })
})

describe('getSweepQuote', () => {
  const spends = [spend('a', 10, '2026-11-01'), spend('b', 13, '2026-11-01'), spend('c', 7, '2026-11-02'), spend('d', 3, '2026-11-02')]
  // fiat 2.5, 3.25, 1.75, 0.75 → steps 1, 1, 1, 0.1 → round-ups 0.5, 0.75, 0.25, 0.05 (all under the 50% cap)

  it('sums pending round-ups and converts to integer luna at the current price', () => {
    const items = buildRoundUps(spends, table, { maxStep: 1, multiplier: 1 }, none)
    const q = getSweepQuote('USD', items, { price: 0.3, time: 1 })
    expect(q.fiatTotal).toBe(1.55)
    expect(q.luna).toBe(Math.floor((1.55 / 0.3) * 1e5))
    expect(Number.isInteger(q.luna)).toBe(true)
    expect(q.nimTotal).toBe(q.luna / 1e5)
    expect(q.priceUsed).toBe(0.3)
    expect(q.items).toHaveLength(4)
  })

  it('skips excluded and swept items', () => {
    const items = buildRoundUps(spends, table, { maxStep: 1, multiplier: 1 }, { excluded: ['a'], swept: ['b'] })
    expect(items.find((i) => i.hash === 'a')!.status).toBe('excluded')
    expect(items.find((i) => i.hash === 'b')!.status).toBe('swept')
    const q = getSweepQuote('USD', items, { price: 0.25, time: 1 })
    expect(q.items.map((i) => i.hash)).toEqual(['c', 'd'])
    expect(q.fiatTotal).toBe(0.3)
    expect(q.luna).toBe(120_000)
  })

  it('luna stays an integer for awkward prices, and is 0 with no current price', () => {
    const items = buildRoundUps(spends, table, { maxStep: 0.1, multiplier: 3 }, none)
    for (const price of [0.000254680176, 0.115203, 12.75]) {
      expect(Number.isInteger(getSweepQuote('USD', items, { price, time: 1 }).luna)).toBe(true)
    }
    expect(getSweepQuote('USD', items, null)).toMatchObject({ luna: 0, priceUsed: null })
  })
})
