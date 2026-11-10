// NIM prices in the host fiat, now and per day. Verified live (Nov 2026), all CORS `*`:
// - NIM/USD daily: DefiLlama chart for coingecko:nimiq-2 (no key, not throttled in testing);
//   fallback CoinGecko market_chart. CoinGecko id `nimiq` is a dead listing frozen in 2019, `nimiq-2` is NIM.
// - CoinGecko has no CRC/GMD vs_currency, so every non-USD fiat goes NIM/USD × USD/fiat from the
//   fawazahmed0 currency-api daily snapshots (jsdelivr, mirror on pages.dev), which cover EUR, CRC, GMD.

import { createStore, type KvStore } from './chain/cache'

export type FiatCode = 'USD' | 'EUR' | 'CRC' | 'GMD'

const DAY_MS = 24 * 3600 * 1000
const COIN = 'coingecko:nimiq-2'
const HISTORY_DAYS = 120
const DAILY_TTL_MS = 6 * 3600 * 1000
const NOW_TTL_MS = 5 * 60 * 1000
/** NIM has never traded near $1; anything above means a wrong coin id answered. */
const MAX_PLAUSIBLE_USD = 1

export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export interface DayPrice {
  price: number
  /** The day whose price was used. */
  day: string
  /** True when `day` differs from the requested day, or the FX rate came from another day. */
  approximate: boolean
}

export interface PriceTable {
  fiat: FiatCode
  /** NIM price in `fiat`, by UTC day. */
  daily: Record<string, number>
  /** Days whose fiat price used an FX rate from a different day. */
  approxDays: string[]
  current: { price: number; time: number } | null
  sources: string[]
}

/** Pure: the price on `day`, or the nearest day that has one (flagged). Null when the table is empty. */
export function priceForDay(table: Pick<PriceTable, 'daily' | 'approxDays'>, day: string): DayPrice | null {
  const exact = table.daily[day]
  if (exact !== undefined) return { price: exact, day, approximate: table.approxDays.includes(day) }
  const target = Date.parse(day)
  let best: string | null = null
  for (const d of Object.keys(table.daily)) {
    if (best === null || Math.abs(Date.parse(d) - target) < Math.abs(Date.parse(best) - target)) best = d
  }
  return best === null ? null : { price: table.daily[best], day: best, approximate: true }
}

async function getJson<T>(url: string, timeoutMs = 15_000): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

function lastPerDay(points: [number, number][]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [ms, price] of points.sort((a, b) => a[0] - b[0])) {
    if (Number.isFinite(price) && price > 0 && price < MAX_PLAUSIBLE_USD) out[dayKey(ms)] = price
  }
  return out
}

export async function fetchNimUsdDaily(now = Date.now()): Promise<{ daily: Record<string, number>; source: string }> {
  try {
    const start = Math.floor((now - HISTORY_DAYS * DAY_MS) / 1000)
    const j = await getJson<{ coins: Record<string, { prices: { timestamp: number; price: number }[] }> }>(
      `https://coins.llama.fi/chart/${COIN}?start=${start}&span=${HISTORY_DAYS + 1}&period=1d`,
    )
    const daily = lastPerDay((j.coins[COIN]?.prices ?? []).map((p) => [p.timestamp * 1000, p.price]))
    if (Object.keys(daily).length) return { daily, source: 'defillama' }
  } catch {
    /* fall through */
  }
  const j = await getJson<{ prices: [number, number][] }>(
    `https://api.coingecko.com/api/v3/coins/nimiq-2/market_chart?vs_currency=usd&days=${HISTORY_DAYS}&interval=daily`,
  )
  return { daily: lastPerDay(j.prices ?? []), source: 'coingecko' }
}

export async function fetchNimUsdNow(): Promise<{ price: number; time: number; source: string }> {
  try {
    const j = await getJson<{ coins: Record<string, { price: number; timestamp: number }> }>(`https://coins.llama.fi/prices/current/${COIN}`)
    const c = j.coins[COIN]
    if (c && c.price > 0 && c.price < MAX_PLAUSIBLE_USD) return { price: c.price, time: c.timestamp * 1000, source: 'defillama' }
  } catch {
    /* fall through */
  }
  const j = await getJson<{ 'nimiq-2': { usd: number; last_updated_at: number } }>(
    'https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2&vs_currencies=usd&include_last_updated_at=true',
  )
  return { price: j['nimiq-2'].usd, time: j['nimiq-2'].last_updated_at * 1000, source: 'coingecko' }
}

interface FxSnapshot {
  date: string
  rates: Record<'eur' | 'crc' | 'gmd', number>
}

/** USD→fiat rates for `date` ('latest' or YYYY-MM-DD). The snapshot's own date may differ (publication lag). */
export async function fetchUsdFx(date: string): Promise<FxSnapshot> {
  const urls = [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.min.json`,
    `https://${date}.currency-api.pages.dev/v1/currencies/usd.min.json`,
  ]
  let lastError: unknown
  for (const url of urls) {
    try {
      const j = await getJson<{ date: string; usd: Record<string, number> }>(url)
      return { date: j.date, rates: { eur: j.usd.eur, crc: j.usd.crc, gmd: j.usd.gmd } }
    } catch (e) {
      lastError = e
    }
  }
  throw lastError
}

const defaultStore = createStore()

async function cachedNimUsdDaily(store: KvStore, now: number) {
  const key = 'prices:nim-usd:daily'
  const cached = store.get<{ daily: Record<string, number>; fetchedAt: number; source: string }>(key)
  if (cached && now - cached.fetchedAt < DAILY_TTL_MS) return cached
  try {
    const fresh = await fetchNimUsdDaily(now)
    // History is immutable: keep old days, overwrite with fresh closes.
    const merged = { daily: { ...cached?.daily, ...fresh.daily }, fetchedAt: now, source: fresh.source }
    store.set(key, merged)
    return merged
  } catch (e) {
    if (cached) return cached
    throw e
  }
}

async function cachedNimUsdNow(store: KvStore, now: number) {
  const key = 'prices:nim-usd:now'
  const cached = store.get<{ price: number; time: number; source: string; fetchedAt: number }>(key)
  if (cached && now - cached.fetchedAt < NOW_TTL_MS) return cached
  try {
    const fresh = { ...(await fetchNimUsdNow()), fetchedAt: now }
    store.set(key, fresh)
    return fresh
  } catch (e) {
    if (cached) return cached
    throw e
  }
}

/** Past days are fetched once and kept forever; 'latest' is refreshed every 6h. */
async function cachedFx(store: KvStore, date: string, now: number): Promise<FxSnapshot | null> {
  const key = `fx:usd:${date}`
  const cached = store.get<FxSnapshot & { fetchedAt: number }>(key)
  if (cached && (date !== 'latest' || now - cached.fetchedAt < DAILY_TTL_MS)) return cached
  try {
    const fresh = await fetchUsdFx(date)
    store.set(key, { ...fresh, fetchedAt: now })
    return fresh
  } catch {
    return cached ?? null
  }
}

/**
 * Build the price table for `fiat` covering `days` (the UTC days of the spends).
 * Requests: 1 DefiLlama chart + 1 current price (cached 6h / 5min), plus for non-USD one FX snapshot per
 * distinct spend day (cached forever) and one 'latest'.
 */
export async function getPriceTable(fiat: FiatCode, days: string[], opts: { store?: KvStore; now?: number } = {}): Promise<PriceTable> {
  const store = opts.store ?? defaultStore
  const now = opts.now ?? Date.now()
  const [usdDaily, usdNow] = await Promise.all([cachedNimUsdDaily(store, now), cachedNimUsdNow(store, now).catch(() => null)])
  const sources = [`NIM/USD daily: ${usdDaily.source}`, `NIM/USD now: ${usdNow?.source ?? 'unavailable'}`]

  if (fiat === 'USD') {
    return { fiat, daily: usdDaily.daily, approxDays: [], current: usdNow && { price: usdNow.price, time: usdNow.time }, sources }
  }

  const rateKey = fiat.toLowerCase() as keyof FxSnapshot['rates']
  const today = dayKey(now)
  const fxByDay: Record<string, FxSnapshot> = {}
  for (const day of [...new Set(days)].sort()) {
    // Today's snapshot is usually not published yet; the latest one stands in (and is flagged).
    const snap = day >= today ? await cachedFx(store, 'latest', now) : await cachedFx(store, day, now)
    if (snap) fxByDay[day] = snap
  }
  const latest = await cachedFx(store, 'latest', now)
  sources.push(`USD/${fiat} FX: fawazahmed0 currency-api (${Object.keys(fxByDay).length} day snapshots${latest ? `, latest ${latest.date}` : ''})`)

  const fxRates = Object.fromEntries(Object.entries(fxByDay).map(([d, s]) => [d, s.rates[rateKey]]))
  const daily: Record<string, number> = {}
  const approxDays: string[] = []
  for (const day of days) {
    const usd = priceForDay({ daily: usdDaily.daily, approxDays: [] }, day)
    const nearestFx = priceForDay({ daily: fxRates, approxDays: [] }, day)
    const snap = nearestFx ? fxByDay[nearestFx.day] : latest
    if (!usd || !snap) continue
    daily[day] = usd.price * snap.rates[rateKey]
    if (usd.approximate || snap.date !== day) approxDays.push(day)
  }
  const current = usdNow && latest ? { price: usdNow.price * latest.rates[rateKey], time: usdNow.time } : null
  return { fiat, daily, approxDays, current, sources }
}
