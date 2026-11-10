// Pure helpers for the Home screen: streak, return hook, minimum-stake progress, unstake timing.
import type { SpendEvent } from './chain/spending'
import { MIN_STAKE_LUNA, type StakerInfo, type SweepRecord } from './sweep'

const DAY_MS = 24 * 3600 * 1000
const WEEK_MS = 7 * DAY_MS

/** Policy constants verified via getPolicyConstants (tests/fixtures/policy-constants.json). */
export const POLICY = { blocksPerEpoch: 43_200, blockSeparationTimeMs: 1000, minimumStake: MIN_STAKE_LUNA }

/**
 * Unstaking in Albatross: stake set inactive becomes inactive at the next election block (0–1 epoch away)
 * and can be retired one full epoch after that (core-rs: inactiveFrom + blocksPerEpoch + 1).
 */
export function unstakeWindowHours(policy = POLICY): { min: number; max: number } {
  const epochHours = (policy.blocksPerEpoch * policy.blockSeparationTimeMs) / 3600_000
  return { min: epochHours, max: 2 * epochHours }
}

/** Monday 00:00 UTC of the week containing `ms`. */
export function weekStart(ms: number): number {
  const d = new Date(ms)
  const day = (d.getUTCDay() + 6) % 7
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)
}

/**
 * Consecutive UTC weeks (Mon–Sun) with at least one confirmed sweep. A streak stays alive through the
 * current week until it ends: if this week has no sweep yet, counting starts from last week.
 */
export function weekStreak(history: SweepRecord[], now: number): number {
  const weeks = new Set(history.filter((r) => r.status === 'confirmed').map((r) => weekStart(r.confirmedAt ?? r.createdAt)))
  let cursor = weekStart(now)
  if (!weeks.has(cursor)) cursor -= WEEK_MS
  let streak = 0
  while (weeks.has(cursor)) {
    streak++
    cursor -= WEEK_MS
  }
  return streak
}

/** Payments made after the last confirmed sweep: the reason to come back. */
export function newSinceLastSweep(spends: SpendEvent[], history: SweepRecord[]): { count: number; since: number | null } {
  const last = history.filter((r) => r.status === 'confirmed').reduce<number | null>((m, r) => Math.max(m ?? 0, r.createdAt), null)
  if (last === null) return { count: spends.length, since: null }
  return { count: spends.filter((s) => s.timestamp > last).length, since: last }
}

export interface MinimumProgress {
  /** 0..1 toward the 100 NIM minimum for a first stake. */
  fraction: number
  shortLuna: number
  /** "Start my stake now": sweep this much (quote topped up to the minimum). */
  startLuna: number
  extraLuna: number
}

/** Only meaningful with no stake yet and a quote below the minimum; null otherwise. */
export function minimumProgress(quoteLuna: number, staker: StakerInfo | null): MinimumProgress | null {
  const nonRetired = staker ? staker.active + staker.inactive : 0
  if (nonRetired >= MIN_STAKE_LUNA || quoteLuna >= MIN_STAKE_LUNA - nonRetired) return null
  const need = MIN_STAKE_LUNA - nonRetired
  return {
    fraction: Math.max(0, Math.min(1, quoteLuna / need)),
    shortLuna: need - quoteLuna,
    startLuna: need,
    extraLuna: need - quoteLuna,
  }
}
