// Incoming payments for a wallet: what counts as received, what is left out, and why.
// Usage: npx tsx scripts/trace-income.ts "<NQ wallet>" [days=30] [mainnet|testnet] [fixture-name]
// With a fixture name, the wallet's cache (trimmed rows + HTLC origins) is saved to tests/fixtures/income-<name>.json.
import { writeFileSync } from 'node:fs'
import { isValidAddress } from '../src/chain/address'
import { createStore, loadWalletCache } from '../src/chain/cache'
import { withRewards } from '../src/chain/income'
import { createRpcClient, type Network } from '../src/chain/rpc'
import { traceWallet } from '../src/chain/spending'
import { buildIncomeItems, incomeTotal, SUGGESTED_PCT } from '../src/income-rule'
import { dayKey, getPriceTable } from '../src/prices'
import { fetchValidators } from '../src/sweep'

const [address, daysArg, networkArg, fixtureName] = process.argv.slice(2)
if (!address || !isValidAddress(address)) {
  console.error('Usage: npx tsx scripts/trace-income.ts "<NQ wallet>" [days] [mainnet|testnet] [fixture-name]')
  process.exit(1)
}
const days = Number(daysArg ?? 30)
const network = (networkArg ?? 'mainnet') as Network
const store = createStore(null)
const rpc = createRpcClient(network)
const now = Date.now()
const t = await traceWallet(address, days, { network, rpc, store, now })
const validators = await fetchValidators(network, store)
const incoming = withRewards(t.incoming, validators.map((v) => v.address))
const nim = (luna: number) => (luna / 1e5).toFixed(5).padStart(14)

console.log(`${t.wallet} on ${network}, last ${days} days: ${t.vaults.length} vaults, ${t.swaps.length} swap HTLCs, ${validators.length} validators`)
for (const i of incoming) {
  console.log(
    [
      new Date(i.timestamp).toISOString().slice(0, 16).replace('T', ' '),
      i.kind === 'received' ? 'RECEIVED ' : i.kind.padEnd(9),
      nim(i.valueLuna),
      i.from.slice(0, 14),
      '→',
      i.to === t.wallet ? 'wallet' : 'vault ',
      i.hash.slice(0, 10),
      i.note,
      i.message ? `"${i.message.slice(0, 40)}"` : '',
    ].join('  '),
  )
}
const by = (k: string) => incoming.filter((i) => i.kind === k)
const kinds = [...new Set(incoming.map((i) => i.kind))]
console.log(`\nSUMMARY ${t.wallet}: ${kinds.map((k) => `${k} ${by(k).length}`).join(', ')}`)
console.log(`  received total ${nim(by('received').reduce((s, i) => s + i.valueLuna, 0)).trim()} NIM; RPC ${rpc.stats.requests} requests, ${rpc.stats.throttled429}×429`)

// What the sample shows: 5% of every payment received in the window, at each day's USD price.
const counted = incoming.filter((i) => i.kind === 'received' || i.kind === 'reward')
const table = await getPriceTable('USD', [...new Set(counted.map((i) => dayKey(i.timestamp)))], { store, now })
const would = incomeTotal(buildIncomeItems(incoming, table, { pct: SUGGESTED_PCT, since: t.sinceMs }, { excluded: [], swept: [] }))
const nimNow = table.current ? would.fiat / table.current.price : null
console.log(`  would have saved at ${SUGGESTED_PCT * 100}%: $${would.fiat.toFixed(4)} from ${would.count} payments${nimNow !== null ? ` = ${nimNow.toFixed(2)} NIM at $${table.current!.price}` : ''}`)

if (fixtureName) {
  const file = `tests/fixtures/income-${fixtureName}.json`
  const data = loadWalletCache(store, network, t.wallet)
  writeFileSync(file, JSON.stringify({ _captured: new Date(now).toISOString(), wallet: t.wallet, network, now, days, validators: validators.map((v) => v.address), data }))
  console.log(`  saved ${file}`)
}
