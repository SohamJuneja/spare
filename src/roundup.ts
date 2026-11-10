// Round-up engine. Pure functions only: no network, no storage.
import type { SpendEvent } from './chain/spending'
import { dayKey, priceForDay, type FiatCode, type PriceTable } from './prices'

export const STEPS: Record<FiatCode, number[]> = {
  USD: [0.1, 0.5, 1],
  EUR: [0.1, 0.5, 1],
  CRC: [100, 500, 1000],
  GMD: [5, 10, 50],
}

export const DEFAULT_STEP: Record<FiatCode, number> = { USD: 1, EUR: 1, CRC: 500, GMD: 10 }

export type Multiplier = 1 | 2 | 3
export type SpendStatus = 'pending' | 'swept' | 'excluded'

export interface RoundUpSettings {
  step: number
  multiplier: Multiplier
}

export interface RoundUpItem {
  hash: string
  timestamp: number
  day: string
  kind: SpendEvent['kind']
  label: 'Payment' | 'Lightning / swap'
  recipient: string
  valueLuna: number
  /** NIM price in fiat used for this item; null when no price at all was available. */
  price: number | null
  priceDay: string | null
  /** Nearest-day price or FX from another day. */
  priceApproximate: boolean
  fiatAtTime: number
  /** After the cap, before the multiplier. */
  roundUp: number
  /** roundUp × multiplier: what this item adds to the sweep. */
  saved: number
  status: SpendStatus
}

export interface SweepQuote {
  fiat: FiatCode
  fiatTotal: number
  nimTotal: number
  luna: number
  items: RoundUpItem[]
  priceUsed: number | null
  priceTime: number | null
}

const round8 = (x: number) => Math.round(x * 1e8) / 1e8

/** ceil(fiat/step)×step − fiat, 0 for exact multiples, robust to float noise (1.30/0.10 = 13.000000000000002). */
export function roundUpAmount(fiat: number, step: number): number {
  if (!(step > 0)) throw new Error(`Invalid step ${step}`)
  if (!(fiat > 0)) return 0
  const q = fiat / step
  if (Math.abs(q - Math.round(q)) < 1e-9) return 0
  return round8(Math.ceil(q) * step - fiat)
}

export function buildRoundUps(
  spends: SpendEvent[],
  table: Pick<PriceTable, 'daily' | 'approxDays'>,
  settings: RoundUpSettings,
  status: { excluded: Iterable<string>; swept: Iterable<string> },
): RoundUpItem[] {
  const excluded = new Set(status.excluded)
  const swept = new Set(status.swept)
  return spends.map((s) => {
    const day = dayKey(s.timestamp)
    const p = priceForDay(table, day)
    const fiatAtTime = p ? round8((s.valueLuna / 1e5) * p.price) : 0
    // Cap: never save more than the payment itself.
    const roundUp = Math.min(roundUpAmount(fiatAtTime, settings.step), fiatAtTime)
    return {
      hash: s.hash,
      timestamp: s.timestamp,
      day,
      kind: s.kind,
      label: s.kind === 'lightning' ? 'Lightning / swap' : 'Payment',
      recipient: s.recipient,
      valueLuna: s.valueLuna,
      price: p?.price ?? null,
      priceDay: p?.day ?? null,
      priceApproximate: p ? p.approximate : true,
      fiatAtTime,
      roundUp,
      saved: round8(roundUp * settings.multiplier),
      status: swept.has(s.hash) ? 'swept' : excluded.has(s.hash) ? 'excluded' : 'pending',
    }
  })
}

/** Sum of pending round-ups, converted at the current price into whole luna (floored). */
export function getSweepQuote(fiat: FiatCode, items: RoundUpItem[], current: { price: number; time: number } | null): SweepQuote {
  const pending = items.filter((i) => i.status === 'pending' && i.saved > 0)
  const fiatTotal = round8(pending.reduce((sum, i) => sum + i.saved, 0))
  const luna = current && current.price > 0 ? Math.floor(round8((fiatTotal / current.price) * 1e5)) : 0
  return {
    fiat,
    fiatTotal,
    nimTotal: luna / 1e5,
    luna,
    items: pending,
    priceUsed: current?.price ?? null,
    priceTime: current?.time ?? null,
  }
}
