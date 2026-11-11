// Find a good public sample wallet: a real Nimiq Pay user whose last 30 days show ordinary purchases.
// Usage: npx tsx scripts/find-sample.ts [blocksToWalk=400] [maxCandidates=40]
//
// 1. Walk recent mainnet blocks (newest first) for vault payments: fromType 2 (HTLC) → basic recipient.
// 2. Expand through each payee's history (one request = up to 500 txs): more vault payments to the same merchants.
//    Vault spends are rare (0 in 100 blocks when this was written), so known real payees seed the list too:
//    NQ32 9CGX… (Kuza "KZ1|" payments) and NQ09 XHGH… ("kitty:" payments), both seen in tests/fixtures.
//    The swap hub's claims add Pay wallets that also use Lightning (their swap HTLCs carry the owner too).
// 3. For each paying vault, read its creation tx and decode the owner (HTLC sender) — only vault-shaped HTLCs
//    (all-zero hashRoot) count, exactly as in the spending engine.
// 4. Trace each owner, price the round-ups in USD, and rank.
import { createStore } from '../src/chain/cache'
import { AccountType, createRpcClient, type RpcTransaction } from '../src/chain/rpc'
import { decodeHtlcData, traceWallet } from '../src/chain/spending'
import { dayKey, getPriceTable } from '../src/prices'
import { buildRoundUps, DEFAULT_STEP, getSweepQuote } from '../src/roundup'

const blocksToWalk = Number(process.argv[2] ?? 400)
const maxCandidates = Number(process.argv[3] ?? 40)
const rpc = createRpcClient('mainnet')
const store = createStore(null)
const log = (...a: unknown[]) => console.error(new Date().toISOString().slice(11, 19), ...a)

const isVaultPayment = (t: RpcTransaction) => t.fromType === AccountType.Htlc && t.toType === AccountType.Basic && t.executionResult && t.value > 0

// 1. block walk
const head = await rpc.getBlockNumber()
const vaults = new Set<string>()
const payees = new Map<string, number>()
for (let n = head; n > head - blocksToWalk; n--) {
  // One bad block must not end the search.
  const b = await rpc.getBlockByNumber(n).catch((e) => {
    log(`block ${n}: ${String(e)}`)
    return { transactions: [] as RpcTransaction[] }
  })
  for (const t of b.transactions ?? []) {
    if (!isVaultPayment(t)) continue
    vaults.add(t.from)
    payees.set(t.to, (payees.get(t.to) ?? 0) + 1)
  }
  if ((head - n) % 100 === 0) log(`walked ${head - n} blocks: ${vaults.size} paying HTLCs, ${payees.size} payees`)
}

// 2. expand via payees (walked + known)
const SEED_PAYEES = ['NQ32 9CGX GGYH 2DNL D7AL AQGM FHU8 SJ5U 8DKM', 'NQ09 XHGH TP20 DDNQ H4SK JVPX QP1R XG2B A91V']
for (const p of SEED_PAYEES) payees.set(p, payees.get(p) ?? 0)
for (const payee of [...payees.keys()].slice(0, 15)) {
  for (const t of await rpc.getTransactionsByAddress(payee, 500)) if (isVaultPayment(t) && t.to === payee) vaults.add(t.from)
}
log(`after payee expansion: ${vaults.size} paying HTLCs`)

// 3. owners from vault creation data (+ swap-hub claims)
const owners = new Set<string>()
const SWAP_HUB = 'NQ56 VE9K PV0Y TK4T QBMY 8E9G B85J QR6M MSHL'
const claimed = (await rpc.getTransactionsByAddress(SWAP_HUB, 500)).filter((t) => t.to === SWAP_HUB && t.fromType === AccountType.Htlc)
for (const c of claimed.slice(0, 25)) {
  const h = await rpc.getTransactionsByAddress(c.from, 10)
  const creation = h.find((t) => t.to === c.from && t.toType === AccountType.Htlc && t.flags === 1)
  const d = creation && decodeHtlcData(creation.recipientData)
  // The hub funds its own HTLCs too (sender = hub): it is the swap service, not a Pay user.
  if (d && d.sender !== SWAP_HUB) owners.add(d.sender)
}
log(`${owners.size} owners from swap-hub claims`)
for (const v of vaults) {
  if (owners.size >= maxCandidates) break
  const h = await rpc.getTransactionsByAddress(v, 50)
  const creation = h.find((t) => t.to === v && t.toType === AccountType.Htlc && t.flags === 1)
  const d = creation && decodeHtlcData(creation.recipientData)
  if (d && /^0+$/.test(d.hashRoot)) owners.add(d.sender)
}
log(`${owners.size} Nimiq Pay wallets to trace`)

// 4. trace + rank
interface Candidate {
  wallet: string
  payments: number
  qualifying: number
  lightning: number
  spentUsd: number
  quoteUsd: number
  quoteNim: number
  savedPct: number
  lines: string[]
}
const out: Candidate[] = []
for (const wallet of owners) {
  try {
    const t = await traceWallet(wallet, 30, { rpc, store })
    if (!t.spends.length) continue
    const table = await getPriceTable('USD', t.spends.map((s) => dayKey(s.timestamp)), { store })
    const items = buildRoundUps(t.spends, table, { maxStep: DEFAULT_STEP.USD, multiplier: 1 }, { excluded: [], swept: [] })
    const quote = getSweepQuote('USD', items, table.current)
    const payments = items.filter((i) => i.kind === 'payment')
    const spentUsd = items.reduce((s, i) => s + i.fiatAtTime, 0)
    const c: Candidate = {
      wallet,
      payments: payments.length,
      qualifying: payments.filter((i) => i.fiatAtTime >= 0.2).length,
      lightning: items.length - payments.length,
      spentUsd,
      quoteUsd: quote.fiatTotal,
      quoteNim: quote.luna / 1e5,
      savedPct: spentUsd ? quote.fiatTotal / spentUsd : 0,
      lines: items.map((i) => `${i.day} ${i.label.padEnd(16)} ${(i.valueLuna / 1e5).toFixed(2).padStart(11)} NIM  $${i.fiatAtTime.toFixed(4).padStart(8)}  step ${String(i.step).padStart(5)}  +$${i.saved.toFixed(4)}`),
    }
    out.push(c)
    log(`${wallet}: ${c.payments} payments (${c.qualifying} ≥ $0.20), ${c.lightning} lightning, quote ${c.quoteNim.toFixed(0)} NIM`)
  } catch (e) {
    log(`${wallet}: ${String(e)}`)
  }
}

// ≥4 ordinary payments ≥ $0.20, quote ≥ 100 NIM, and round-ups that look like round-ups (2–40% of spend).
const eligible = (c: Candidate) => c.qualifying >= 4 && c.quoteNim >= 100 && c.savedPct >= 0.02 && c.savedPct <= 0.4
const ranked = out.filter(eligible).sort((a, b) => b.qualifying - a.qualifying || a.lightning - b.lightning || b.quoteNim - a.quoteNim)
console.log(`\nTraced ${out.length} wallets with spends; ${ranked.length} eligible. RPC: ${rpc.stats.requests} requests, ${rpc.stats.throttled429}×429.`)
for (const [i, c] of ranked.slice(0, 3).entries()) {
  console.log(`\n#${i + 1} ${c.wallet}`)
  console.log(`   ${c.payments} payments (${c.qualifying} ≥ $0.20), ${c.lightning} lightning/swap; spent $${c.spentUsd.toFixed(2)}; quote $${c.quoteUsd.toFixed(4)} = ${c.quoteNim.toFixed(5)} NIM (${(c.savedPct * 100).toFixed(1)}% of spend)`)
  for (const l of c.lines) console.log(`   ${l}`)
}
if (!ranked.length) {
  console.log('\nNo eligible wallet. Closest:')
  for (const c of out.sort((a, b) => b.qualifying - a.qualifying).slice(0, 5)) console.log(`  ${c.wallet}: ${c.qualifying} qualifying, quote ${c.quoteNim.toFixed(0)} NIM, ${(c.savedPct * 100).toFixed(1)}%`)
}
