// Spending engine: find a Nimiq Pay wallet's vault HTLCs and classify outgoing txs.
//
// Verified on mainnet (see tests/fixtures/):
// - A vault is an HTLC whose creation data has sender (= refund address) = the wallet,
//   recipient = the Nimiq Pay cosigner, and an all-zero blake2b hashRoot (no preimage path;
//   it is only ever spent with both signatures). The rule never looks at the cosigner address,
//   so it holds on testnet too; the cosigner is only recorded for diagnostics.
// - Lightning/swap HTLCs funded from a vault ALSO have sender = the wallet, but carry a real
//   sha256 hashRoot and a swap-service recipient. Those are spends unless refunded.
// - Expired HTLC accounts are pruned (getAccountByAddress returns basic/0), so ownership is
//   read from the creation tx's recipientData, never from account state.

import { addressFromHex, normalizeAddress, STAKING_CONTRACT } from './address'
import {
  balanceFromRows,
  createStore,
  loadWalletCache,
  mergeRows,
  saveWalletCache,
  toRow,
  type AddressRecord,
  type KvStore,
  type SwapStatus,
  type TxRow,
  type VaultRecord,
  type WalletCacheData,
} from './cache'
import { classifyIncoming, htlcOriginFromRows, htlcsToLookUp, type IncomingTx } from './income'
import { AccountType, createRpcClient, normalizeTimestamp, type Network, type RpcClient } from './rpc'

export type TxKind = 'payment' | 'lightning' | 'internal' | 'staking' | 'fee-only' | 'failed'

export interface ClassifiedTx {
  hash: string
  timestamp: number
  valueLuna: number
  feeLuna: number
  from: string
  to: string
  kind: TxKind
  note?: string
}

export interface SpendEvent {
  hash: string
  timestamp: number
  valueLuna: number
  recipient: string
  kind: 'payment' | 'lightning'
  from: string
}

export interface HtlcData {
  sender: string
  recipient: string
  hashAlgorithm: number
  hashRoot: string
  hashCount: number
  timeoutMs: number
}

const HASH_ALGO_SHA512 = 4
const MAX_VAULT_DEPTH = 64
const MAX_VAULTS = 500
const DAY_MS = 24 * 3600 * 1000
/** Vaults time out after 14 days, so one created before the window can still spend inside it. */
const VAULT_LOOKBACK_MS = 15 * DAY_MS
/** Warm refreshes only need the few rows newer than the cached newest hash. */
const WARM_PAGE_SIZE = 25

/** Decode HTLC creation data: sender(20) recipient(20) algo(1) root(32|64) count(1) timeout(u64 ms). */
export function decodeHtlcData(hex: string): HtlcData | null {
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length < 82) return null
  const hashAlgorithm = parseInt(hex.slice(80, 82), 16)
  const rootLen = hashAlgorithm === HASH_ALGO_SHA512 ? 128 : 64
  const end = 82 + rootLen
  if (hex.length !== end + 2 + 16) return null
  return {
    sender: addressFromHex(hex.slice(0, 40)),
    recipient: addressFromHex(hex.slice(40, 80)),
    hashAlgorithm,
    hashRoot: hex.slice(82, end).toLowerCase(),
    hashCount: parseInt(hex.slice(end, end + 2), 16),
    timeoutMs: parseInt(hex.slice(end + 2), 16),
  }
}

/** Nimiq Pay vault signature: refund goes to `wallet`, and the hash lock is a dummy all-zero root. */
export function isVaultCreation(tx: TxRow, wallet: string): boolean {
  if (tx.toType !== AccountType.Htlc) return false
  const d = decodeHtlcData(tx.recipientData)
  return !!d && d.sender === normalizeAddress(wallet) && /^0+$/.test(d.hashRoot)
}

export interface ClassifyContext {
  wallet: string
  vaults: Iterable<string>
  /** Swap HTLCs whose funds went back to an own address (timeout refund). */
  refundedHtlcs?: Iterable<string>
}

/** Pure: classify every tx sent FROM the wallet or one of its vaults. Incoming txs are dropped; hashes deduped. */
export function classifyTransactions(txs: TxRow[], ctx: ClassifyContext): ClassifiedTx[] {
  const wallet = normalizeAddress(ctx.wallet)
  const own = new Set([wallet, ...[...ctx.vaults].map(normalizeAddress)])
  const refunded = new Set([...(ctx.refundedHtlcs ?? [])].map(normalizeAddress))
  const seen = new Set<string>()
  const out: ClassifiedTx[] = []

  for (const tx of txs) {
    if (seen.has(tx.hash) || !own.has(tx.from)) continue
    seen.add(tx.hash)
    const base = { hash: tx.hash, timestamp: normalizeTimestamp(tx.timestamp), valueLuna: tx.value, feeLuna: tx.fee, from: tx.from, to: tx.to }
    out.push({ ...base, ...classifyOne(tx, wallet, own, refunded) })
  }
  return out.sort((a, b) => b.timestamp - a.timestamp)
}

function classifyOne(tx: TxRow, wallet: string, own: Set<string>, refunded: Set<string>): { kind: TxKind; note?: string } {
  if (!tx.executionResult) return { kind: 'failed' }
  if (tx.to === STAKING_CONTRACT || tx.toType === AccountType.Staking) return { kind: 'staking' }
  if (own.has(tx.to)) return { kind: 'internal', note: tx.to === wallet ? 'to wallet' : 'to vault' }
  if (tx.toType === AccountType.Htlc) {
    if (isVaultCreation(tx, wallet)) return { kind: 'internal', note: 'new vault' }
    if (refunded.has(tx.to)) return { kind: 'internal', note: 'swap refunded' }
    return { kind: 'lightning' }
  }
  if (tx.value === 0) return { kind: 'fee-only' }
  return { kind: 'payment' }
}

export function toSpendEvents(classified: ClassifiedTx[], sinceMs: number): SpendEvent[] {
  return classified
    .filter((c): c is ClassifiedTx & { kind: 'payment' | 'lightning' } => (c.kind === 'payment' || c.kind === 'lightning') && c.timestamp >= sinceMs)
    .map((c) => ({ hash: c.hash, timestamp: c.timestamp, valueLuna: c.valueLuna, recipient: c.to, kind: c.kind, from: c.from }))
}

export interface SwapRecord {
  address: string
  fundedBy: string
  fundingHash: string
  createdAt: number
  hub: string
  status: SwapStatus | 'unknown'
}

export interface WalletTrace {
  wallet: string
  vaults: string[]
  vaultRecords: VaultRecord[]
  swaps: SwapRecord[]
  /** Distinct HTLC recipients of the user's vaults (mainnet: NQ32 7HKC…). */
  cosigners: string[]
  classified: ClassifiedTx[]
  spends: SpendEvent[]
  /** v1.1: every tx into the wallet or a vault in the window, classified (rewards need withRewards()). */
  incoming: IncomingTx[]
  sinceMs: number
}

/** Max foreign HTLC creation lookups per load (each is one request; results are cached forever). */
const MAX_ORIGIN_LOOKUPS = 20

/** Walk the cached rows: which HTLCs funded by own addresses are vaults, which are swaps. Pure. */
export function discover(wallet: string, data: WalletCacheData, historyCutoff: number): { vaults: VaultRecord[]; swaps: Omit<SwapRecord, 'status'>[] } {
  const vaults = new Map<string, VaultRecord>()
  const swaps = new Map<string, Omit<SwapRecord, 'status'>>()
  const queue: { address: string; depth: number }[] = [{ address: wallet, depth: 0 }]
  const visited = new Set<string>()
  while (queue.length) {
    const { address, depth } = queue.shift()!
    if (visited.has(address)) continue
    visited.add(address)
    for (const tx of data.addresses[address]?.rows ?? []) {
      // A full page reaches far past the cutoff; vaults created before it can't spend in the window.
      if (tx.from !== address || tx.toType !== AccountType.Htlc || !tx.executionResult) continue
      const createdAt = normalizeTimestamp(tx.timestamp)
      if (createdAt < historyCutoff) continue
      const d = decodeHtlcData(tx.recipientData)
      if (!d) continue
      if (isVaultCreation(tx, wallet)) {
        if (!vaults.has(tx.to) && depth < MAX_VAULT_DEPTH && vaults.size < MAX_VAULTS) {
          vaults.set(tx.to, { address: tx.to, fundedBy: address, fundingHash: tx.hash, createdAt, timeoutMs: d.timeoutMs, cosigner: d.recipient, depth: depth + 1 })
          queue.push({ address: tx.to, depth: depth + 1 })
        }
      } else if (!swaps.has(tx.to)) {
        swaps.set(tx.to, { address: tx.to, fundedBy: address, fundingHash: tx.hash, createdAt, hub: d.recipient })
      }
    }
  }
  return { vaults: [...vaults.values()], swaps: [...swaps.values()] }
}

/** Pure: everything the UI needs, from cached data alone. */
export function buildTrace(walletAddress: string, data: WalletCacheData, sinceMs: number): WalletTrace {
  const wallet = normalizeAddress(walletAddress)
  const { vaults, swaps } = discover(wallet, data, sinceMs - VAULT_LOOKBACK_MS)
  const vaultSet = new Set(vaults.map((v) => v.address))
  const swapRecords = swaps.map((s) => ({ ...s, status: data.swaps[s.address] ?? ('unknown' as const) }))
  const refundedHtlcs = swapRecords.filter((s) => s.status === 'refunded').map((s) => s.address)
  const pending = new Set(swapRecords.filter((s) => s.status === 'pending').map((s) => s.address))
  const rows = [wallet, ...vaultSet].flatMap((a) => data.addresses[a]?.rows ?? [])
  const classified = classifyTransactions(rows, { wallet, vaults: vaultSet, refundedHtlcs })
    .filter((c) => c.timestamp >= sinceMs)
    .map((c) => (c.kind === 'lightning' && pending.has(c.to) ? { ...c, note: 'swap not settled yet' } : c))
  return {
    wallet,
    vaults: [...vaultSet],
    vaultRecords: vaults,
    swaps: swapRecords,
    cosigners: [...new Set(vaults.map((v) => v.cosigner))],
    classified,
    spends: toSpendEvents(classified, sinceMs),
    incoming: classifyIncoming(rows, { wallet, vaults: vaultSet, swaps: swapRecords, htlcOrigins: data.htlcOrigins }).filter((i) => i.timestamp >= sinceMs),
    sinceMs,
  }
}

export interface TraceStats {
  requests: number
  throttled429: number
  waitedMs: number
  loadMs: number
  /** Addresses skipped because they are final. */
  skippedFinal: number
}

export interface TraceOptions {
  network?: Network
  rpc?: RpcClient
  store?: KvStore
  now?: number
}

const defaultStore = createStore()

/** Fetch only rows newer than the cached newest hash; full fetch when uncached or coverage is too short. */
async function syncAddress(rpc: RpcClient, address: string, rec: AddressRecord | undefined, cutoff: number, now: number): Promise<AddressRecord> {
  if (rec?.final) return rec
  if (rec && rec.newestHash && rec.coveredSince <= cutoff) {
    const fresh: TxRow[] = []
    let cursor: string | undefined
    for (let page = 0; page < 40; page++) {
      const batch = await rpc.getTransactionsByAddress(address, WARM_PAGE_SIZE, cursor)
      const idx = batch.findIndex((t) => t.hash === rec.newestHash)
      fresh.push(...(idx >= 0 ? batch.slice(0, idx) : batch).map(toRow))
      if (idx >= 0 || batch.length < WARM_PAGE_SIZE) break
      cursor = batch[batch.length - 1].hash
    }
    const rows = mergeRows(rec.rows, fresh)
    return { ...rec, rows, newestHash: rows[0]?.hash ?? null, fetchedAt: now }
  }
  const rows = mergeRows([], (await rpc.getTransactionsSince(address, cutoff)).map(toRow)).filter((r) => normalizeTimestamp(r.timestamp) >= cutoff)
  return { rows, newestHash: rows[0]?.hash ?? null, coveredSince: cutoff, final: false, fetchedAt: now }
}

/** Network: sync wallet + vault histories through the cache, then build the trace. */
export async function traceWallet(walletAddress: string, sinceDays = 30, opts: TraceOptions = {}): Promise<WalletTrace & { stats: TraceStats }> {
  const t0 = Date.now()
  const network = opts.network ?? 'mainnet'
  const rpc = opts.rpc ?? createRpcClient(network)
  const store = opts.store ?? defaultStore
  const before = { ...rpc.stats }
  const now = opts.now ?? Date.now()
  const wallet = normalizeAddress(walletAddress)
  const sinceMs = now - sinceDays * DAY_MS
  const historyCutoff = sinceMs - VAULT_LOOKBACK_MS
  const data = loadWalletCache(store, network, wallet)
  let skippedFinal = 0

  // Sync the wallet, then each vault as discovery reveals it (vaults can fund vaults).
  const synced = new Set<string>()
  for (;;) {
    const { vaults } = discover(wallet, data, historyCutoff)
    const todo = [wallet, ...vaults.map((v) => v.address)].filter((a) => !synced.has(a))
    if (!todo.length) break
    for (const address of todo) {
      synced.add(address)
      const rec = data.addresses[address]
      if (rec?.final) {
        skippedFinal++
        continue
      }
      data.addresses[address] = await syncAddress(rpc, address, rec, historyCutoff, now)
    }
  }

  const { vaults, swaps } = discover(wallet, data, historyCutoff)
  const own = new Set([wallet, ...vaults.map((v) => v.address)])

  // A vault past its timeout with nothing left in it can never move funds again.
  for (const v of vaults) {
    const rec = data.addresses[v.address]
    if (rec && !rec.final && v.timeoutMs < now && rec.rows.some((r) => r.hash === v.fundingHash) && balanceFromRows(v.address, rec.rows) === 0) {
      data.addresses[v.address] = { ...rec, final: true }
    }
  }

  // A swap HTLC that times out (~60h) refunds to its sender (the wallet); that money was never spent.
  for (const s of swaps) {
    if (s.createdAt < sinceMs) continue
    const known = data.swaps[s.address]
    if (known === 'claimed' || known === 'refunded') continue
    const outs = (await rpc.getTransactionsByAddress(s.address, 20)).filter((t) => t.from === s.address && t.executionResult)
    data.swaps[s.address] = outs.some((t) => own.has(t.to)) ? 'refunded' : outs.length ? 'claimed' : 'pending'
  }

  // Another Pay user's vault paying in looks like any HTLC: read its creation once to tell it from a swap claim.
  const rows = [...own].flatMap((a) => data.addresses[a]?.rows ?? [])
  const lookUp = htlcsToLookUp(rows, { wallet, vaults: own, swaps, htlcOrigins: data.htlcOrigins }, sinceMs).slice(0, MAX_ORIGIN_LOOKUPS)
  for (const address of lookUp) {
    try {
      const origin = htlcOriginFromRows(address, await rpc.getTransactionsByAddress(address, 500))
      data.htlcOrigins = { ...data.htlcOrigins, [address]: origin }
    } catch {
      /* stays unverified (not counted); retried on the next load */
    }
  }

  data.updatedAt = now
  saveWalletCache(store, network, wallet, data)
  const stats: TraceStats = {
    requests: rpc.stats.requests - before.requests,
    throttled429: rpc.stats.throttled429 - before.throttled429,
    waitedMs: rpc.stats.waitedMs - before.waitedMs,
    loadMs: Date.now() - t0,
    skippedFinal,
  }
  return { ...buildTrace(wallet, data, sinceMs), stats }
}

/** Cached view for instant render; null when nothing is cached yet. */
export function cachedTrace(walletAddress: string, sinceDays = 30, opts: { network?: Network; store?: KvStore; now?: number } = {}): WalletTrace | null {
  const wallet = normalizeAddress(walletAddress)
  const data = loadWalletCache(opts.store ?? defaultStore, opts.network ?? 'mainnet', wallet)
  if (!data.addresses[wallet]) return null
  return buildTrace(wallet, data, (opts.now ?? Date.now()) - sinceDays * DAY_MS)
}

export async function getSpending(walletAddress: string, sinceDays = 30, opts: TraceOptions = {}): Promise<SpendEvent[]> {
  return (await traceWallet(walletAddress, sinceDays, opts)).spends
}
