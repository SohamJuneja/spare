// Spending engine: find a Nimiq Pay wallet's vault HTLCs and classify outgoing txs.
//
// Verified on mainnet (see tests/fixtures/):
// - A vault is an HTLC whose creation data has sender (= refund address) = the wallet,
//   recipient = the Nimiq Pay cosigner, and an all-zero blake2b hashRoot (no preimage path;
//   it is only ever spent with both signatures).
// - Lightning/swap HTLCs funded from a vault ALSO have sender = the wallet, but carry a real
//   sha256 hashRoot and a swap-service recipient. Those are spends unless refunded.
// - Expired HTLC accounts are pruned (getAccountByAddress returns basic/0), so ownership is
//   read from the creation tx's recipientData, never from account state.

import { addressFromHex, normalizeAddress, STAKING_CONTRACT } from './address'
import { AccountType, createRpcClient, normalizeTimestamp, type Network, type RpcClient, type RpcTransaction } from './rpc'

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
/** Vaults time out after 14 days, so one created before the window can still spend inside it. */
const VAULT_LOOKBACK_MS = 15 * 24 * 3600 * 1000

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
export function isVaultCreation(tx: RpcTransaction, wallet: string): boolean {
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
export function classifyTransactions(txs: RpcTransaction[], ctx: ClassifyContext): ClassifiedTx[] {
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

function classifyOne(tx: RpcTransaction, wallet: string, own: Set<string>, refunded: Set<string>): { kind: TxKind; note?: string } {
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

export interface WalletTrace {
  wallet: string
  vaults: string[]
  classified: ClassifiedTx[]
  spends: SpendEvent[]
  sinceMs: number
}

export interface TraceOptions {
  network?: Network
  rpc?: RpcClient
  now?: number
}

/** Network: discover vaults (recursive, deduped, depth-guarded), read histories, classify. */
export async function traceWallet(walletAddress: string, sinceDays = 30, opts: TraceOptions = {}): Promise<WalletTrace> {
  const rpc = opts.rpc ?? createRpcClient(opts.network ?? 'mainnet')
  const wallet = normalizeAddress(walletAddress)
  const sinceMs = (opts.now ?? Date.now()) - sinceDays * 24 * 3600 * 1000
  const historyCutoff = sinceMs - VAULT_LOOKBACK_MS

  const histories = new Map<string, RpcTransaction[]>()
  const vaults = new Set<string>()
  const swapHtlcs = new Set<string>()
  const queue: { address: string; depth: number }[] = [{ address: wallet, depth: 0 }]

  while (queue.length) {
    const { address, depth } = queue.shift()!
    if (histories.has(address)) continue
    const history = await rpc.getTransactionsSince(address, historyCutoff)
    histories.set(address, history)
    for (const tx of history) {
      // A full page reaches far past the cutoff; vaults created before it can't spend in the window.
      if (tx.from !== address || tx.toType !== AccountType.Htlc || !tx.executionResult) continue
      if (normalizeTimestamp(tx.timestamp) < historyCutoff) continue
      if (isVaultCreation(tx, wallet)) {
        if (!vaults.has(tx.to) && depth < MAX_VAULT_DEPTH && vaults.size < MAX_VAULTS) {
          vaults.add(tx.to)
          queue.push({ address: tx.to, depth: depth + 1 })
        }
      } else if (normalizeTimestamp(tx.timestamp) >= sinceMs) {
        swapHtlcs.add(tx.to)
      }
    }
  }

  // A swap HTLC that times out (~60h) refunds to its sender (the wallet); that money was never spent.
  const own = new Set([wallet, ...vaults])
  const refundedHtlcs = new Set<string>()
  const pendingHtlcs = new Set<string>()
  await Promise.all(
    [...swapHtlcs].map(async (htlc) => {
      const outs = (await rpc.getTransactionsByAddress(htlc, 20)).filter((t) => t.from === htlc && t.executionResult)
      if (outs.some((t) => own.has(t.to))) refundedHtlcs.add(htlc)
      else if (!outs.length) pendingHtlcs.add(htlc)
    }),
  )

  const classified = classifyTransactions([...histories.values()].flat(), { wallet, vaults, refundedHtlcs })
    .filter((c) => c.timestamp >= sinceMs)
    .map((c) => (c.kind === 'lightning' && pendingHtlcs.has(c.to) ? { ...c, note: 'swap not settled yet' } : c))
  return { wallet, vaults: [...vaults], classified, spends: toSpendEvents(classified, sinceMs), sinceMs }
}

export async function getSpending(walletAddress: string, sinceDays = 30, opts: TraceOptions = {}): Promise<SpendEvent[]> {
  return (await traceWallet(walletAddress, sinceDays, opts)).spends
}
