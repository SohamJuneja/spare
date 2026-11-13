import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { WalletCacheData } from '../src/chain/cache'
import { withRewards, type IncomingTx } from '../src/chain/income'
import { buildTrace, type SpendEvent } from '../src/chain/spending'
import { buildIncomeItems, incomeTotal, nextIncomeRule, RULE_OFF, toggleCounted } from '../src/income-rule'
import { buildRoundUps, getSweepQuote } from '../src/roundup'
import { pickAffordable, savedWithSpare, splitItemsLuna, sweepBreakdown, type SweepRecord } from '../src/sweep'
import { breakdownText } from '../src/ui/breakdown'

const day = (d: string, h = 12) => Date.parse(`${d}T${String(h).padStart(2, '0')}:00:00Z`)
// 1 NIM = $0.25 keeps the maths readable.
const table = { daily: { '2026-11-01': 0.25, '2026-11-02': 0.25, '2026-11-03': 0.2 }, approxDays: [] }
const none = { excluded: [], swept: [] }
const inc = (hash: string, nim: number, ts: number, kind: IncomingTx['kind'] = 'received'): IncomingTx => ({
  hash,
  timestamp: ts,
  valueLuna: Math.round(nim * 1e5),
  from: 'NQ08 MHLL 9EFJ 0310 TYG1 FUSQ HVYK UPPU HS3N',
  to: 'NQ45 57M8 9VMC 16NL 31D0 99M1 YX9Y HC1D NVKU',
  kind,
  note: '',
})
const incoming = [
  inc('before', 400, day('2026-11-01', 9)),
  inc('a', 400, day('2026-11-02')), // $100
  inc('b', 10, day('2026-11-03')), // $2
  inc('reward', 4, day('2026-11-02'), 'reward'), // $1
  inc('own', 1000, day('2026-11-02'), 'own'),
  inc('unstake', 1000, day('2026-11-02'), 'unstake'),
  inc('swap', 1000, day('2026-11-02'), 'swap'),
  inc('unverified', 1000, day('2026-11-02'), 'unverified'),
]
const since = day('2026-11-01', 10)

describe('the rule switch', () => {
  it('off (the default for existing users) → no items', () => {
    expect(buildIncomeItems(incoming, table, RULE_OFF, none)).toEqual([])
    expect(buildIncomeItems(incoming, table, { pct: 0.05, since: null }, none)).toEqual([])
  })

  it('turning on stamps the time; changing the % keeps it; off clears it; on again starts afresh', () => {
    const on = nextIncomeRule(RULE_OFF, 0.05, 1000)
    expect(on).toEqual({ pct: 0.05, since: 1000 })
    expect(nextIncomeRule(on, 0.1, 5000)).toEqual({ pct: 0.1, since: 1000 })
    expect(nextIncomeRule(on, 0, 6000)).toEqual(RULE_OFF)
    expect(nextIncomeRule(nextIncomeRule(on, 0, 6000), 0.02, 9000)).toEqual({ pct: 0.02, since: 9000 })
  })
})

describe('buildIncomeItems', () => {
  const items = buildIncomeItems(incoming, table, { pct: 0.05, since }, none)

  it('counts only received + reward payments from after the rule was turned on', () => {
    expect(items.map((i) => i.hash).sort()).toEqual(['a', 'b', 'reward'])
  })

  it('slice = pct × fiat at that day’s price', () => {
    const a = items.find((i) => i.hash === 'a')!
    expect(a).toMatchObject({ kind: 'income', source: 'received', fiatAtTime: 100, pct: 0.05, saved: 5, status: 'pending', priceDay: '2026-11-02' })
    expect(items.find((i) => i.hash === 'b')!).toMatchObject({ fiatAtTime: 2, saved: 0.1 })
    const ten = buildIncomeItems(incoming, table, { pct: 0.1, since }, none)
    expect(ten.find((i) => i.hash === 'a')!.saved).toBe(10)
    const two = buildIncomeItems(incoming, table, { pct: 0.02, since }, none)
    expect(two.find((i) => i.hash === 'b')!.saved).toBe(0.04)
  })

  it('rewards are left out by default; received payments are in by default', () => {
    expect(items.find((i) => i.hash === 'reward')!).toMatchObject({ source: 'reward', status: 'excluded', saved: 0.05 })
    expect(incomeTotal(items)).toEqual({ fiat: 5.1, count: 2 })
  })

  it('the "Not counted" toggle works both ways, opt-out for received and opt-in for rewards', () => {
    let status = { excluded: [] as string[], swept: [] as string[] }
    status = toggleCounted(status, 'a', false)
    status = toggleCounted(status, 'reward', true)
    const after = buildIncomeItems(incoming, table, { pct: 0.05, since }, status)
    expect(after.find((i) => i.hash === 'a')!.status).toBe('excluded')
    expect(after.find((i) => i.hash === 'reward')!.status).toBe('pending')
    expect(incomeTotal(after)).toEqual({ fiat: 0.15, count: 2 })
    status = toggleCounted(toggleCounted(status, 'a', false), 'reward', true)
    expect(status).toEqual({ excluded: [], included: [], swept: [] })
  })

  it('swept (or locked by an unsettled sweep) items are never quoted again', () => {
    const s = buildIncomeItems(incoming, table, { pct: 0.05, since }, { excluded: [], swept: ['a'] })
    expect(s.find((i) => i.hash === 'a')!.status).toBe('swept')
    expect(getSweepQuote('USD', s, { price: 0.25, time: 1 }).items.map((i) => i.hash)).toEqual(['b'])
  })

  it('no price for the day → flagged, saves nothing', () => {
    const [i] = buildIncomeItems([inc('x', 10, day('2026-11-02'))], { daily: {}, approxDays: [] }, { pct: 0.05, since: 0 }, none)
    expect(i).toMatchObject({ price: null, priceApproximate: true, saved: 0 })
  })
})

describe('one sweep for round-ups + slices', () => {
  const spend = (hash: string, nim: number, d: string): SpendEvent => ({ hash, timestamp: day(d), valueLuna: Math.round(nim * 1e5), recipient: 'x', kind: 'payment', from: 'y' })
  const roundUps = buildRoundUps([spend('p1', 10, '2026-11-02'), spend('p2', 13, '2026-11-02')], table, { maxStep: 1, multiplier: 1 }, none) // $0.50 + $0.75
  const slices = buildIncomeItems(incoming, table, { pct: 0.05, since }, none) // $5 + $0.10

  it('the quote adds both kinds', () => {
    const q = getSweepQuote('USD', [...roundUps, ...slices], { price: 0.25, time: 1 })
    expect(q.fiatTotal).toBe(6.35)
    expect(q.luna).toBe(2_540_000) // 25.4 NIM
    expect(q.items.map((i) => i.kind).sort()).toEqual(['income', 'income', 'payment', 'payment'])
    const split = splitItemsLuna(q.luna, q.items)
    expect(split).toEqual({ roundUpLuna: 500_000, sliceLuna: 2_040_000 })
    expect(split.roundUpLuna + split.sliceLuna).toBe(q.luna)
  })

  it('a partial sweep picks across both kinds, oldest first, and still splits exactly', () => {
    // 25.2 NIM: p1 (2) + p2 (3) + a (20) = 25 fit; b (+0.4) does not.
    const p = pickAffordable([...roundUps, ...slices], 2_520_000, 0.25)
    expect(p.items.map((i) => i.hash)).toEqual(['p1', 'p2', 'a'])
    const split = splitItemsLuna(p.luna, p.items)
    expect(split.roundUpLuna + split.sliceLuna).toBe(p.luna)
    expect(split.sliceLuna).toBe(2_000_000)
  })

  it('awkward prices never lose a luna in the split', () => {
    for (const price of [0.000254680176, 0.115203]) {
      const q = getSweepQuote('USD', [...roundUps, ...slices], { price, time: 1 })
      const s = splitItemsLuna(q.luna, q.items)
      expect(s.roundUpLuna + s.sliceLuna).toBe(q.luna)
      expect(Number.isInteger(s.sliceLuna)).toBe(true)
    }
    expect(splitItemsLuna(0, [])).toEqual({ roundUpLuna: 0, sliceLuna: 0 })
    expect(splitItemsLuna(1000, roundUps)).toEqual({ roundUpLuna: 1000, sliceLuna: 0 })
  })

  const rec = (over: Partial<SweepRecord>): SweepRecord => ({
    id: 'r',
    createdAt: 1,
    status: 'confirmed',
    route: 'add',
    delegation: null,
    luna: 2_540_000,
    fiat: 6.35,
    fiatCode: 'USD',
    price: 0.25,
    priceTime: 1,
    itemHashes: [],
    stakeBefore: 0,
    txHash: 'h',
    ...over,
  })

  it('history shows the split, with the starter top-up apart', () => {
    expect(sweepBreakdown(rec({ sliceLuna: 2_040_000 }))).toEqual({ roundUpLuna: 500_000, sliceLuna: 2_040_000, topUpLuna: 0 })
    expect(breakdownText(rec({ sliceLuna: 2_040_000 }))).toBe('Round-ups: 5 NIM · Slices: 20.4 NIM')
    expect(breakdownText(rec({ luna: 10_000_000, sliceLuna: 2_040_000, topUpLuna: 7_460_000 }))).toBe('Round-ups: 5 NIM · Slices: 20.4 NIM · Starter top-up: 74.6 NIM')
    // A plain v1.0 round-up sweep keeps its old one-line look.
    expect(breakdownText(rec({}))).toBeNull()
    expect(breakdownText(rec({ luna: 10_000_000, topUpLuna: 7_000_000 }))).toBe('Round-ups: 30 NIM · Starter top-up: 70 NIM')
  })

  it('slices are savings; the top-up is not', () => {
    expect(savedWithSpare([rec({ luna: 10_000_000, sliceLuna: 2_040_000, topUpLuna: 7_460_000 })])).toEqual({
      luna: 2_540_000,
      topUpLuna: 7_460_000,
      sliceLuna: 2_040_000,
      fiatByCode: { USD: 6.35 },
    })
  })
})

describe('sample "would have saved" on real wallets', () => {
  const fx = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/income-${name}.json`, import.meta.url), 'utf8')) as { wallet: string; now: number; days: number; validators: string[]; data: WalletCacheData }
  // Fixed $0.0004/NIM so the expectation doesn't move with the market.
  const flat = (days: string[]) => ({ daily: Object.fromEntries(days.map((d) => [d, 0.0004])), approxDays: [] })

  it.each([
    ['nq45', 12, 71_591.51604],
    ['nq20', 6, 199_435.64334],
  ])('%s: 5%% of everything received over 30 days', (name, n, nim) => {
    const f = fx(name)
    const t = buildTrace(f.wallet, f.data, f.now - f.days * 24 * 3600 * 1000)
    const income = withRewards(t.incoming, f.validators)
    const items = buildIncomeItems(income, flat([...new Set(income.map((i) => new Date(i.timestamp).toISOString().slice(0, 10)))]), { pct: 0.05, since: t.sinceMs }, none)
    const would = incomeTotal(items)
    expect(would.count).toBe(n)
    expect(would.fiat).toBeCloseTo(nim * 0.0004 * 0.05, 6)
  })
})
