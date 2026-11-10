// Usage: npx tsx scripts/trace.ts <NQ address> [days] [mainnet|testnet]
import { isValidAddress } from '../src/chain/address'
import { traceWallet } from '../src/chain/spending'
import type { Network } from '../src/chain/rpc'

const [address, daysArg, networkArg] = process.argv.slice(2)
if (!address || !isValidAddress(address)) {
  console.error('Usage: npx tsx scripts/trace.ts "<NQ address>" [days] [mainnet|testnet]')
  process.exit(1)
}
const days = daysArg ? Number(daysArg) : 30
const network = (networkArg ?? 'mainnet') as Network
const nim = (luna: number) => (luna / 1e5).toFixed(5)

const t = await traceWallet(address, days, { network })

console.log(`Wallet:  ${t.wallet}`)
console.log(`Window:  last ${days} days (since ${new Date(t.sinceMs).toISOString()}) on ${network}`)
console.log(`\nVaults found: ${t.vaults.length}`)
for (const v of t.vaults) console.log(`  ${v}`)

console.log(`\nOutgoing transactions in window (${t.classified.length}):`)
console.log(['date'.padEnd(16), 'kind'.padEnd(9), 'NIM'.padStart(14), 'from'.padEnd(14), 'to'.padEnd(14), 'hash', 'note'].join('  '))
for (const c of t.classified) {
  console.log(
    [
      new Date(c.timestamp).toISOString().slice(0, 16).replace('T', ' '),
      c.kind.padEnd(9),
      nim(c.valueLuna).padStart(14),
      c.from.slice(0, 14),
      c.to.slice(0, 14),
      c.hash.slice(0, 12),
      c.note ?? '',
    ].join('  '),
  )
}

const total = t.spends.reduce((s, e) => s + e.valueLuna, 0)
const byKind = (k: string) => t.spends.filter((e) => e.kind === k)
console.log(`\nReal spends in window: ${t.spends.length} (payment ${byKind('payment').length}, lightning ${byKind('lightning').length})`)
console.log(`TOTAL REAL SPEND: ${nim(total)} NIM`)
