import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { SpendEvent } from '../src/chain/spending'
import { minimumProgress, newSinceLastSweep, POLICY, unstakeWindowHours, weekStart, weekStreak } from '../src/progress'
import type { SweepRecord } from '../src/sweep'

const policy = (JSON.parse(readFileSync(new URL('./fixtures/policy-constants.json', import.meta.url), 'utf8')) as {
  result: { data: { blocksPerEpoch: number; blockSeparationTime: number; minimumStake: number } }
}).result.data

const rec = (iso: string, status: SweepRecord['status'] = 'confirmed'): SweepRecord => ({
  id: iso,
  createdAt: Date.parse(iso),
  confirmedAt: Date.parse(iso),
  status,
  route: 'add',
  delegation: null,
  luna: 1,
  fiat: 0,
  fiatCode: 'USD',
  price: 1,
  priceTime: null,
  itemHashes: [],
  stakeBefore: 0,
  txHash: 'h',
})

describe('policy', () => {
  it('matches the live chain policy', () => {
    expect(POLICY).toEqual({ blocksPerEpoch: policy.blocksPerEpoch, blockSeparationTimeMs: policy.blockSeparationTime, minimumStake: policy.minimumStake })
  })
  it('unstaking takes one to two epochs: 12 to 24 hours', () => {
    expect(unstakeWindowHours()).toEqual({ min: 12, max: 24 })
  })
})

describe('weekStreak', () => {
  const now = Date.parse('2026-11-11T12:00:00Z') // a Wednesday
  it('weeks start on Monday UTC', () => {
    expect(new Date(weekStart(now)).toISOString()).toBe('2026-11-09T00:00:00.000Z')
  })
  it('counts consecutive weeks with a confirmed sweep', () => {
    expect(weekStreak([rec('2026-11-10T08:00:00Z'), rec('2026-11-03T08:00:00Z'), rec('2026-10-27T08:00:00Z')], now)).toBe(3)
  })
  it('stays alive when this week has no sweep yet', () => {
    expect(weekStreak([rec('2026-11-06T08:00:00Z'), rec('2026-10-30T08:00:00Z')], now)).toBe(2)
  })
  it('breaks on a missed week and ignores unconfirmed sweeps', () => {
    expect(weekStreak([rec('2026-11-10T08:00:00Z'), rec('2026-10-27T08:00:00Z')], now)).toBe(1)
    expect(weekStreak([rec('2026-11-10T08:00:00Z', 'failed'), rec('2026-11-10T09:00:00Z', 'checking')], now)).toBe(0)
    expect(weekStreak([], now)).toBe(0)
  })
})

describe('newSinceLastSweep', () => {
  const spend = (iso: string): SpendEvent => ({ hash: iso, timestamp: Date.parse(iso), valueLuna: 1, recipient: 'x', kind: 'payment', from: 'y' })
  const spends = [spend('2026-11-01T00:00:00Z'), spend('2026-11-05T00:00:00Z'), spend('2026-11-08T00:00:00Z')]
  it('counts payments after the last confirmed sweep', () => {
    expect(newSinceLastSweep(spends, [rec('2026-11-04T00:00:00Z'), rec('2026-11-06T00:00:00Z', 'failed')]).count).toBe(2)
  })
  it('with no sweep yet, every payment is new', () => {
    expect(newSinceLastSweep(spends, [])).toEqual({ count: 3, since: null })
  })
})

describe('minimumProgress', () => {
  it('tops a small first sweep up to 100 NIM', () => {
    expect(minimumProgress(3_000_000, null)).toEqual({ fraction: 0.3, shortLuna: 7_000_000, startLuna: 10_000_000, extraLuna: 7_000_000 })
  })
  it('is null once the quote reaches the minimum or the user already stakes', () => {
    expect(minimumProgress(10_000_000, null)).toBeNull()
    expect(minimumProgress(1, { active: 18_000_000, inactive: 0, retired: 0, delegation: null })).toBeNull()
  })
  it('a fully retired staker needs the minimum again', () => {
    expect(minimumProgress(4_000_000, { active: 0, inactive: 0, retired: 20_000_000, delegation: null })?.extraLuna).toBe(6_000_000)
  })
})
