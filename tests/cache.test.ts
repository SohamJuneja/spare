import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createStore, loadWalletCache, mergeRows, balanceFromRows, toRow } from '../src/chain/cache'
import type { RpcClient, RpcTransaction } from '../src/chain/rpc'
import { cachedTrace, traceWallet } from '../src/chain/spending'

const txs = (name: string) =>
  (JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as { result: { data: RpcTransaction[] } }).result.data

const W04 = 'NQ04 HH5C HSLU VHGD EP4G BA1R 1MGB PT0X EY9V'
const V_4VDF = 'NQ89 4VDF DQ8Q JEGL KX8U A1HC DE6K A78Y CJR5'
const V_UUAS = 'NQ80 UUAS BU0Q 6Q5B 17C7 E245 DNST 92Q1 65NG'
const NOW = Date.parse('2026-11-10T22:00:00Z')

/** Fixture-backed RPC that honours max/startAt like the real one and logs every call. */
function fakeRpc(histories: Record<string, RpcTransaction[]>) {
  const calls: { method: string; address: string; max?: number }[] = []
  const page = (address: string, max = 500, startAt?: string) => {
    const all = histories[address] ?? []
    const from = startAt ? all.findIndex((t) => t.hash === startAt) + 1 : 0
    return all.slice(from, from + max)
  }
  const rpc = {
    url: 'fixtures',
    stats: { requests: 0, throttled429: 0, waitedMs: 0 },
    getTransactionsByAddress: async (address: string, max?: number, startAt?: string) => {
      calls.push({ method: 'getTransactionsByAddress', address, max })
      rpc.stats.requests++
      return page(address, max, startAt)
    },
    getTransactionsSince: async (address: string) => {
      calls.push({ method: 'getTransactionsSince', address })
      rpc.stats.requests++
      return page(address)
    },
    getAccountByAddress: async () => {
      throw new Error('not used')
    },
  }
  return { rpc: rpc as unknown as RpcClient, calls }
}

const fixtures = () => ({
  [W04]: txs('txs-wallet-nq04.json'),
  [V_UUAS]: txs('txs-vault-nq80.json'),
  [V_4VDF]: txs('txs-vault-nq89-4vdf.json'),
  'NQ89 V0MN CVGT 3RC9 B7PA F1YJ L564 TEMK A0TM': txs('txs-swap-nq89-v0mn.json'),
  'NQ98 LETS CC07 ERYV A425 MK1A KNJQ XTMT 3759': txs('txs-swap-nq98-lets.json'),
})

describe('store', () => {
  it('falls back to memory when localStorage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Storage
    const store = createStore(broken)
    store.set('k', { a: 1 })
    expect(store.get('k')).toEqual({ a: 1 })
  })

  it('keys wallet data by network and wallet', async () => {
    const store = createStore(null)
    const { rpc } = fakeRpc(fixtures())
    await traceWallet(W04, 30, { rpc, store, now: NOW, network: 'mainnet' })
    expect(loadWalletCache(store, 'mainnet', W04).addresses[W04]).toBeDefined()
    expect(loadWalletCache(store, 'testnet', W04).addresses[W04]).toBeUndefined()
  })
})

describe('incremental refresh', () => {
  it('warm refresh fetches only rows newer than the cached newest hash', async () => {
    const store = createStore(null)
    const h = fixtures()
    // Cold load sees the wallet without its newest tx.
    const newest = h[W04][0]
    const cold = fakeRpc({ ...h, [W04]: h[W04].slice(1) })
    await traceWallet(W04, 30, { rpc: cold.rpc, store, now: NOW })
    expect(loadWalletCache(store, 'mainnet', W04).addresses[W04].newestHash).toBe(h[W04][1].hash)

    // Warm load: the new tx has arrived.
    const warm = fakeRpc(h)
    const t = await traceWallet(W04, 30, { rpc: warm.rpc, store, now: NOW })
    const walletCalls = warm.calls.filter((c) => c.address === W04)
    expect(walletCalls).toEqual([{ method: 'getTransactionsByAddress', address: W04, max: 25 }])
    expect(warm.calls.some((c) => c.method === 'getTransactionsSince')).toBe(false)
    const rows = loadWalletCache(store, 'mainnet', W04).addresses[W04].rows
    expect(rows[0].hash).toBe(newest.hash)
    expect(new Set(rows.map((r) => r.hash)).size).toBe(rows.length)
    expect(t.spends).toHaveLength(5)
  })

  it('final vaults (timed out, zero balance) are never refetched', async () => {
    const store = createStore(null)
    // Both NQ04 vaults time out on Nov 16/17. NQ80 ends at balance 0, NQ89 4VDF still holds NIM.
    const later = Date.parse('2026-11-20T00:00:00Z')
    await traceWallet(W04, 30, { rpc: fakeRpc(fixtures()).rpc, store, now: later })
    const data = loadWalletCache(store, 'mainnet', W04)
    expect(data.addresses[V_UUAS].final).toBe(true)
    expect(data.addresses[V_4VDF].final).toBe(false)

    const warm = fakeRpc(fixtures())
    const t = await traceWallet(W04, 30, { rpc: warm.rpc, store, now: later })
    expect(warm.calls.filter((c) => c.address === V_UUAS)).toHaveLength(0)
    expect(warm.calls.filter((c) => c.address === V_4VDF)).toHaveLength(1)
    expect(t.stats.skippedFinal).toBe(1)
    // Settled swaps are cached too, so a warm load is wallet + the one live vault.
    expect(warm.calls).toHaveLength(2)
    expect(t.vaults).toContain(V_UUAS)
  })

  it('cachedTrace renders spends with no network at all', async () => {
    const store = createStore(null)
    expect(cachedTrace(W04, 30, { store, now: NOW })).toBeNull()
    await traceWallet(W04, 30, { rpc: fakeRpc(fixtures()).rpc, store, now: NOW })
    expect(cachedTrace(W04, 30, { store, now: NOW })!.spends).toHaveLength(5)
  })
})

describe('row helpers', () => {
  it('mergeRows dedupes and keeps newest first', () => {
    const rows = txs('txs-wallet-nq04.json').map(toRow)
    const merged = mergeRows(rows.slice(0, 3), rows)
    expect(merged.map((r) => r.hash)).toEqual(rows.map((r) => r.hash))
  })

  it('balanceFromRows matches the live HTLC balance', () => {
    // account-vault-htlc-nq89-4vdf.json: balance 3757761
    expect(balanceFromRows(V_4VDF, txs('txs-vault-nq89-4vdf.json'))).toBe(3_757_761)
    expect(balanceFromRows(V_UUAS, txs('txs-vault-nq80.json'))).toBe(0)
  })
})
