// "Pay yourself first": keep a slice of every payment you receive. Pure functions only.
import type { IncomingTx } from './chain/income'
import { dayKey, priceForDay, type PriceTable } from './prices'
import type { SpendStatus } from './roundup'

export const INCOME_PCTS = [0, 0.02, 0.05, 0.1] as const
export type IncomePct = (typeof INCOME_PCTS)[number]
/** What the Home prompt offers, and what the sample shows as "would have saved". */
export const SUGGESTED_PCT: IncomePct = 0.05

/** Stored per wallet + network. `since` is when the rule was turned on; null while it is off. */
export interface IncomeRule {
  pct: IncomePct
  since: number | null
}

export const RULE_OFF: IncomeRule = { pct: 0, since: null }

/** Turning on stamps `since = now`; changing the % keeps it; turning off clears it (a later turn-on starts afresh). */
export function nextIncomeRule(prev: IncomeRule, pct: IncomePct, now: number): IncomeRule {
  if (pct === 0) return RULE_OFF
  return { pct, since: prev.pct > 0 && prev.since !== null ? prev.since : now }
}

export function isIncomePct(x: unknown): x is IncomePct {
  return (INCOME_PCTS as readonly unknown[]).includes(x)
}

export interface IncomeItem {
  hash: string
  timestamp: number
  day: string
  kind: 'income'
  source: 'received' | 'reward'
  from: string
  message?: string
  valueLuna: number
  price: number | null
  priceDay: string | null
  priceApproximate: boolean
  fiatAtTime: number
  pct: number
  /** pct × fiatAtTime: what this item adds to the sweep. */
  saved: number
  status: SpendStatus
}

const round8 = (x: number) => Math.round(x * 1e8) / 1e8

/**
 * Slices for incoming payments received at or after `rule.since`. Rule off → none. Received payments count unless
 * marked "Not counted"; staking rewards are left out unless the user counts them (they're already "Earned on top").
 */
export function buildIncomeItems(
  incoming: IncomingTx[],
  table: Pick<PriceTable, 'daily' | 'approxDays'>,
  rule: IncomeRule,
  status: { excluded: Iterable<string>; included?: Iterable<string>; swept: Iterable<string> },
): IncomeItem[] {
  if (!(rule.pct > 0) || rule.since === null) return []
  const since = rule.since
  const excluded = new Set(status.excluded)
  const included = new Set(status.included ?? [])
  const swept = new Set(status.swept)
  return incoming
    .filter((i): i is IncomingTx & { kind: 'received' | 'reward' } => (i.kind === 'received' || i.kind === 'reward') && i.timestamp >= since && i.valueLuna > 0)
    .map((i) => {
      const day = dayKey(i.timestamp)
      const p = priceForDay(table, day)
      const fiatAtTime = p ? round8((i.valueLuna / 1e5) * p.price) : 0
      const left = i.kind === 'reward' ? !included.has(i.hash) : excluded.has(i.hash)
      return {
        hash: i.hash,
        timestamp: i.timestamp,
        day,
        kind: 'income' as const,
        source: i.kind,
        from: i.from,
        message: i.message,
        valueLuna: i.valueLuna,
        price: p?.price ?? null,
        priceDay: p?.day ?? null,
        priceApproximate: p ? p.approximate : true,
        fiatAtTime,
        pct: rule.pct,
        saved: round8(fiatAtTime * rule.pct),
        status: swept.has(i.hash) ? 'swept' : left ? 'excluded' : 'pending',
      }
    })
}

/** Flip an item's "Not counted" state. Rewards are opt-in (`included`), everything else opt-out (`excluded`). */
export function toggleCounted<T extends { excluded: string[]; included?: string[] }>(status: T, hash: string, defaultExcluded: boolean): T {
  const flip = (list: string[]) => (list.includes(hash) ? list.filter((h) => h !== hash) : [...list, hash])
  return defaultExcluded ? { ...status, included: flip(status.included ?? []) } : { ...status, excluded: flip(status.excluded) }
}

/**
 * Preview only: what keeping `pct` of everything received since `windowStart` would have saved. Returns totals,
 * never items, so it can't reach a quote or a sweep. Honours "Not counted" marks and leaves rewards out by default.
 * A pct of 0 previews the suggested 5%.
 */
export function previewSlices(
  incoming: IncomingTx[],
  table: Pick<PriceTable, 'daily' | 'approxDays'>,
  pct: IncomePct,
  windowStart: number,
  status: { excluded: Iterable<string>; included?: Iterable<string> } = { excluded: [] },
): { pct: IncomePct; fiat: number; count: number } {
  const p = pct > 0 ? pct : SUGGESTED_PCT
  const items = buildIncomeItems(incoming, table, { pct: p, since: windowStart }, { ...status, swept: [] })
  return { pct: p, ...incomeTotal(items) }
}

/** Sum of what pending slices add, in fiat (for the sample's "would have saved"). */
export function incomeTotal(items: IncomeItem[]): { fiat: number; count: number } {
  const pending = items.filter((i) => i.status === 'pending' && i.saved > 0)
  return { fiat: round8(pending.reduce((s, i) => s + i.saved, 0)), count: pending.length }
}
