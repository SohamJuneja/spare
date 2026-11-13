// Persistent cache over localStorage with an in-memory fallback (private mode, WebView quirks, quota).
// Wallet data is keyed by `${network}:${walletAddress}`.

import type { Network, RpcTransaction } from './rpc'

export interface KvStore {
  get<T>(key: string): T | undefined
  set(key: string, value: unknown): void
  remove(key: string): void
}

const PREFIX = 'spare:'

/** Every access is try/catch'd; on any failure the value still lives in memory for this session. */
export function createStore(storage?: Storage | null): KvStore {
  const memory = new Map<string, string>()
  let backing: Storage | null = null
  try {
    backing = storage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : storage
  } catch {
    backing = null
  }
  return {
    get<T>(key: string): T | undefined {
      let raw = memory.get(key)
      if (raw === undefined && backing) {
        try {
          raw = backing.getItem(PREFIX + key) ?? undefined
        } catch {
          /* blocked storage */
        }
      }
      if (raw === undefined) return undefined
      try {
        return JSON.parse(raw) as T
      } catch {
        return undefined
      }
    },
    set(key, value) {
      const raw = JSON.stringify(value)
      memory.set(key, raw)
      try {
        backing?.setItem(PREFIX + key, raw)
      } catch {
        /* quota or blocked; memory copy stays */
      }
    },
    remove(key) {
      memory.delete(key)
      try {
        backing?.removeItem(PREFIX + key)
      } catch {
        /* ignore */
      }
    },
  }
}

/** The fields the classifier needs. Drops proof/relatedAddresses etc. to keep storage small. */
export type TxRow = Pick<
  RpcTransaction,
  'hash' | 'blockNumber' | 'timestamp' | 'from' | 'fromType' | 'to' | 'toType' | 'value' | 'fee' | 'recipientData' | 'flags' | 'executionResult'
>

export function toRow(tx: TxRow): TxRow {
  const { hash, blockNumber, timestamp, from, fromType, to, toType, value, fee, recipientData, flags, executionResult } = tx
  return { hash, blockNumber, timestamp, from, fromType, to, toType, value, fee, recipientData, flags, executionResult }
}

export interface VaultRecord {
  address: string
  fundedBy: string
  fundingHash: string
  createdAt: number
  timeoutMs: number
  cosigner: string
  depth: number
}

export interface AddressRecord {
  /** Newest first. */
  rows: TxRow[]
  newestHash: string | null
  /** Rows are complete back to this time (ms). */
  coveredSince: number
  /** Timed-out vault with zero balance: never fetched again. */
  final: boolean
  fetchedAt: number
}

export type SwapStatus = 'claimed' | 'refunded' | 'pending'

export interface WalletCacheData {
  v: 1
  vaults: VaultRecord[]
  addresses: Record<string, AddressRecord>
  swaps: Record<string, SwapStatus>
  /** v1.1: creation data of foreign HTLCs that paid in (immutable, so cached forever). Absent in older caches. */
  htlcOrigins?: Record<string, { sender: string; recipient: string; vault: boolean } | null>
  updatedAt: number
}

export interface SpendStatusData {
  excluded: string[]
  swept: string[]
  /** v1.1: items that are left out by default (staking rewards) but the user chose to count. */
  included?: string[]
}

export const walletKey = (network: Network, wallet: string) => `${network}:${wallet}`

export function emptyWalletCache(): WalletCacheData {
  return { v: 1, vaults: [], addresses: {}, swaps: {}, updatedAt: 0 }
}

export function loadWalletCache(store: KvStore, network: Network, wallet: string): WalletCacheData {
  const data = store.get<WalletCacheData>(`${walletKey(network, wallet)}:chain`)
  return data && data.v === 1 ? data : emptyWalletCache()
}

export function saveWalletCache(store: KvStore, network: Network, wallet: string, data: WalletCacheData): void {
  store.set(`${walletKey(network, wallet)}:chain`, data)
}

export function loadSpendStatus(store: KvStore, network: Network, wallet: string): SpendStatusData {
  return store.get<SpendStatusData>(`${walletKey(network, wallet)}:status`) ?? { excluded: [], swept: [] }
}

export function saveSpendStatus(store: KvStore, network: Network, wallet: string, data: SpendStatusData): void {
  store.set(`${walletKey(network, wallet)}:status`, data)
}

/** Merge new rows into cached ones: dedupe by hash, newest first. */
export function mergeRows(cached: TxRow[], fresh: TxRow[]): TxRow[] {
  const byHash = new Map<string, TxRow>()
  for (const r of [...fresh, ...cached]) if (!byHash.has(r.hash)) byHash.set(r.hash, r)
  return [...byHash.values()].sort((a, b) => b.timestamp - a.timestamp || b.blockNumber - a.blockNumber)
}

/** Balance from a complete history (creation tx included): in − out − fees. */
export function balanceFromRows(address: string, rows: TxRow[]): number {
  let balance = 0
  for (const r of rows) {
    if (!r.executionResult) {
      if (r.from === address) balance -= r.fee
      continue
    }
    if (r.to === address) balance += r.value
    if (r.from === address) balance -= r.value + r.fee
  }
  return balance
}
