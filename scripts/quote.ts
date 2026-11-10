// Usage: npx tsx scripts/quote.ts <NQ address> [USD|EUR|CRC|GMD] [days] [step] [multiplier]
// Runs a cold trace and a warm trace on the same in-memory cache, then prints the sweep quote.
import { isValidAddress } from '../src/chain/address'
import { createStore } from '../src/chain/cache'
import { traceWallet } from '../src/chain/spending'
import { dayKey, getPriceTable, type FiatCode } from '../src/prices'
import { buildRoundUps, DEFAULT_STEP, getSweepQuote, type Multiplier } from '../src/roundup'

const [address, fiatArg, daysArg, stepArg, multArg] = process.argv.slice(2)
if (!address || !isValidAddress(address)) {
  console.error('Usage: npx tsx scripts/quote.ts "<NQ address>" [USD|EUR|CRC|GMD] [days] [step] [multiplier]')
  process.exit(1)
}
const fiat = (fiatArg ?? 'USD').toUpperCase() as FiatCode
const days = Number(daysArg ?? 30)
const step = stepArg ? Number(stepArg) : DEFAULT_STEP[fiat]
const multiplier = Number(multArg ?? 1) as Multiplier
const store = createStore(null)

const cold = await traceWallet(address, days, { store })
const warm = await traceWallet(address, days, { store })
console.log(`Wallet ${cold.wallet}, ${days}d, ${cold.vaults.length} vaults, ${cold.spends.length} spends`)
console.log(`RPC cold: ${cold.stats.requests} requests, ${cold.stats.throttled429}×429, waited ${cold.stats.waitedMs}ms, ${cold.stats.loadMs}ms`)
console.log(`RPC warm: ${warm.stats.requests} requests, ${warm.stats.throttled429}×429, skipped final ${warm.stats.skippedFinal}, ${warm.stats.loadMs}ms`)

const table = await getPriceTable(fiat, warm.spends.map((s) => dayKey(s.timestamp)), { store })
console.log(`Prices: ${table.sources.join('; ')}`)
const items = buildRoundUps(warm.spends, table, { step, multiplier }, { excluded: [], swept: [] })
const quote = getSweepQuote(fiat, items, table.current)

const f = (x: number) => x.toFixed(fiat === 'CRC' || fiat === 'GMD' ? 2 : 4)
console.log(`\nStep ${step} ${fiat}, ×${multiplier}`)
console.log(['day'.padEnd(10), 'label'.padEnd(16), 'NIM'.padStart(12), `price ${fiat}/NIM`.padStart(16), `${fiat} at time`.padStart(12), 'round-up'.padStart(10), 'saved'.padStart(10), 'status', 'hash'].join('  '))
for (const i of items) {
  console.log(
    [
      i.day,
      i.label.padEnd(16),
      (i.valueLuna / 1e5).toFixed(5).padStart(12),
      `${i.price?.toPrecision(6) ?? 'n/a'}${i.priceApproximate ? '*' : ''}`.padStart(16),
      f(i.fiatAtTime).padStart(12),
      f(i.roundUp).padStart(10),
      f(i.saved).padStart(10),
      i.status.padEnd(7),
      i.hash.slice(0, 12),
    ].join('  '),
  )
}
console.log('(* = nearest-day price or FX from another day)')
console.log('\ngetSweepQuote() =', JSON.stringify({ ...quote, items: quote.items.map((i) => ({ hash: i.hash.slice(0, 12), saved: i.saved })) }, null, 2))
