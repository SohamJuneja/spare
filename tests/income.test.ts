import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createStore, type TxRow, type WalletCacheData } from '../src/chain/cache'
import { classifyIncoming, decodeMessage, htlcOriginFromRows, htlcsToLookUp, withRewards, type IncomingTx } from '../src/chain/income'
import type { Network, RpcClient, RpcTransaction } from '../src/chain/rpc'
import { buildTrace, traceWallet } from '../src/chain/spending'

const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T
interface IncomeFixture {
  wallet: string
  network: Network
  now: number
  days: number
  validators: string[]
  data: WalletCacheData
}
const DAY = 24 * 3600 * 1000
/** Real wallet caches captured by scripts/trace-income.ts. */
function load(name: string) {
  const f = fixture<IncomeFixture>(`income-${name}.json`)
  const trace = buildTrace(f.wallet, f.data, f.now - f.days * DAY)
  return { f, trace, incoming: withRewards(trace.incoming, f.validators) }
}
const get = (list: IncomingTx[], prefix: string) => {
  const hit = list.find((i) => i.hash.startsWith(prefix))
  if (!hit) throw new Error(`no tx ${prefix}`)
  return hit
}
const count = (list: IncomingTx[]) => list.reduce<Record<string, number>>((m, i) => ({ ...m, [i.kind]: (m[i.kind] ?? 0) + 1 }), {})

describe('classifyIncoming on real wallets', () => {
  it('NQ45: friends, apps and other Pay users count; own rotations and unstaking do not', () => {
    const { incoming } = load('nq45')
    expect(count(incoming)).toEqual({ own: 11, received: 12, unstake: 1 })
    // Paid from NQ20's vault NQ64 HRDD (zero hash root, sender NQ20): a Pay-to-Pay payment.
    expect(get(incoming, '7ed0d15d7e')).toMatchObject({ kind: 'received', note: 'from a Nimiq Pay user', valueLuna: 180_512_675 })
    expect(get(incoming, 'f1881bf9bb')).toMatchObject({ kind: 'received', note: 'from a Nimiq Pay user' })
    // Old vault → wallet at rotation, then wallet → new vault.
    expect(get(incoming, 'f4f12108f7')).toMatchObject({ kind: 'own', note: 'vault rotation' })
    expect(get(incoming, 'b27ed9c7f7')).toMatchObject({ kind: 'own', note: 'own transfer' })
    expect(get(incoming, '3c05566dce')).toMatchObject({ kind: 'unstake', valueLuna: 2_211_400_000 })
    expect(get(incoming, '996c6ebe99')).toMatchObject({ kind: 'received', message: 'Thanks for joining Cinima! - Creator' })
    expect(get(incoming, 'ed9078b34f').message).toBe('You mined NIM on Nimiq.Space!')
  })

  it('NQ20: a pool payout from the validator address is a reward, not received', () => {
    const { f, trace, incoming } = load('nq20')
    expect(count(incoming)).toEqual({ own: 19, unstake: 3, received: 6, reward: 1 })
    const payout = get(incoming, '1ae5f8a248')
    expect(payout).toMatchObject({ kind: 'reward', from: 'NQ15 HNAH YRVH DFVM YHAG BSXG 0QHK KA0Q XDR7', valueLuna: 3119 })
    expect(f.validators).toContain(payout.from)
    // Before the validator list arrives it would read as received: that is why the app waits for it.
    expect(get(trace.incoming, '1ae5f8a248').kind).toBe('received')
    // NQ45's vault NQ43 FBKY paid NQ20 twice.
    expect(get(incoming, '6d9445aaf0')).toMatchObject({ kind: 'received', note: 'from a Nimiq Pay user', valueLuna: 20_000_000 })
    expect(get(incoming, '79865a7ca5')).toMatchObject({ kind: 'received', valueLuna: 30_000_000 })
  })

  it('NQ51: a swap HTLC refunded to the wallet is not income', () => {
    const { incoming } = load('nq51')
    expect(count(incoming)).toEqual({ own: 6, received: 2, swap: 1 })
    expect(get(incoming, '709c813fd1')).toMatchObject({ kind: 'swap', note: 'swap refund', from: 'NQ52 X3HN HGCX 2075 HEKC 5EM2 SPJV PRU8 CN3H' })
    // Vault → vault rotation that lands in a vault.
    expect(get(incoming, '4a60c31680')).toMatchObject({ kind: 'own', note: 'vault rotation' })
  })

  it('NQ12 (testnet): the faucet counts; funding the vault does not', () => {
    const { incoming } = load('nq12-testnet')
    expect(count(incoming)).toEqual({ own: 1, received: 1 })
    expect(get(incoming, '92553bba3a')).toMatchObject({ kind: 'received', valueLuna: 11_000_000_000 })
  })

  it('never includes an outgoing tx, and the same hash only once', () => {
    const { f, trace } = load('nq45')
    const own = new Set([f.wallet, ...trace.vaults])
    const rows = trace.vaults.flatMap((v) => f.data.addresses[v]?.rows ?? [])
    const twice = classifyIncoming([...rows, ...rows, ...(f.data.addresses[f.wallet]?.rows ?? [])], { wallet: f.wallet, vaults: trace.vaults, htlcOrigins: f.data.htlcOrigins })
    expect(twice.every((i) => own.has(i.to))).toBe(true)
    expect(new Set(twice.map((i) => i.hash)).size).toBe(twice.length)
  })
})

describe('foreign HTLC senders', () => {
  const { f, trace } = load('nq45')
  const rows = [f.wallet, ...trace.vaults].flatMap((a) => f.data.addresses[a]?.rows ?? [])
  const ctx = { wallet: f.wallet, vaults: trace.vaults, swaps: trace.swaps }

  it('are left out until their creation data has been read', () => {
    const c = classifyIncoming(rows, ctx)
    expect(get(c, 'f1881bf9bb')).toMatchObject({ kind: 'unverified' })
    expect(htlcsToLookUp(rows, ctx, trace.sinceMs).sort()).toEqual(['NQ64 HRDD J1SH SBD4 KF6B 0EP0 RJ0V MU1A 75CX', 'NQ85 3G69 L1H9 40Y9 MYGA YFJF 0R2C SX3U PGC4'])
    expect(htlcsToLookUp(rows, { ...ctx, htlcOrigins: f.data.htlcOrigins }, trace.sinceMs)).toEqual([])
  })

  it('tell another user’s vault, an own older vault, a swap claim and a missing creation apart', () => {
    const htlc = 'NQ85 3G69 L1H9 40Y9 MYGA YFJF 0R2C SX3U PGC4'
    const kindWith = (origin: { sender: string; recipient: string; vault: boolean } | null) => get(classifyIncoming(rows, { ...ctx, htlcOrigins: { [htlc]: origin } }), 'f1881bf9bb')
    const cosigner = 'NQ32 7HKC C30M X9NJ AURD EDSG 98H5 UX0R UEQB'
    const hub = 'NQ56 VE9K PV0Y TK4T QBMY 8E9G B85J QR6M MSHL'
    expect(kindWith({ sender: 'NQ20 MJRQ T2E8 3218 9XY3 QAS3 3LGG D7KE 69MU', recipient: cosigner, vault: true }).kind).toBe('received')
    expect(kindWith({ sender: f.wallet, recipient: cosigner, vault: true })).toMatchObject({ kind: 'own', note: 'own older vault' })
    expect(kindWith({ sender: hub, recipient: f.wallet, vault: false })).toMatchObject({ kind: 'swap', note: 'swap claim' })
    expect(kindWith(null)).toMatchObject({ kind: 'unverified', note: 'contract creation not found' })
  })

  it('htlcOriginFromRows reads vaults and swaps from real histories', () => {
    const txs = (name: string) => fixture<{ result: { data: RpcTransaction[] } }>(name).result.data
    expect(htlcOriginFromRows('NQ89 4VDF DQ8Q JEGL KX8U A1HC DE6K A78Y CJR5', txs('txs-wallet-nq04.json'))).toEqual({
      sender: 'NQ04 HH5C HSLU VHGD EP4G BA1R 1MGB PT0X EY9V',
      recipient: 'NQ32 7HKC C30M X9NJ AURD EDSG 98H5 UX0R UEQB',
      vault: true,
    })
    expect(htlcOriginFromRows('NQ89 V0MN CVGT 3RC9 B7PA F1YJ L564 TEMK A0TM', txs('txs-swap-nq89-v0mn.json'))).toMatchObject({ vault: false, recipient: 'NQ56 VE9K PV0Y TK4T QBMY 8E9G B85J QR6M MSHL' })
    expect(htlcOriginFromRows('NQ89 V0MN CVGT 3RC9 B7PA F1YJ L564 TEMK A0TM', [])).toBeNull()
  })

  it('traceWallet looks each one up once, then answers from the cache', async () => {
    const histories: Record<string, TxRow[]> = Object.fromEntries(Object.entries(f.data.addresses).map(([a, r]) => [a, r.rows]))
    // The two foreign vaults are NQ20's: their real creation txs are in the NQ20 fixture (no cached origins used).
    const nq20Rows = Object.values(fixture<IncomeFixture>('income-nq20.json').data.addresses).flatMap((r) => r.rows)
    for (const htlc of ['NQ64 HRDD J1SH SBD4 KF6B 0EP0 RJ0V MU1A 75CX', 'NQ85 3G69 L1H9 40Y9 MYGA YFJF 0R2C SX3U PGC4']) {
      // The same creation tx sits in NQ20's wallet history and in the vault's own: keep one.
      histories[htlc] = nq20Rows.filter((r, i, all) => r.to === htlc && r.flags === 1 && all.findIndex((x) => x.hash === r.hash) === i)
      expect(histories[htlc], htlc).toHaveLength(1)
    }
    const calls: string[] = []
    const rpc = {
      url: 'fixtures',
      stats: { requests: 0, throttled429: 0, waitedMs: 0 },
      getTransactionsByAddress: async (a: string) => {
        calls.push(a)
        return histories[a] ?? []
      },
      getTransactionsSince: async (a: string) => histories[a] ?? [],
    } as unknown as RpcClient
    const store = createStore(null)
    const t = await traceWallet(f.wallet, f.days, { rpc, store, now: f.now })
    expect(get(t.incoming, 'f1881bf9bb').kind).toBe('received')
    expect(get(t.incoming, '7ed0d15d7e').kind).toBe('received')
    const lookups = calls.filter((a) => a.startsWith('NQ85 3G69') || a.startsWith('NQ64 HRDD')).length
    expect(lookups).toBe(2)
    calls.length = 0
    await traceWallet(f.wallet, f.days, { rpc, store, now: f.now })
    expect(calls.filter((a) => a.startsWith('NQ85 3G69') || a.startsWith('NQ64 HRDD'))).toEqual([])
  })
})

describe('edge cases', () => {
  const W = 'NQ45 57M8 9VMC 16NL 31D0 99M1 YX9Y HC1D NVKU'
  const row = (over: Partial<TxRow>): TxRow => ({
    hash: 'h',
    blockNumber: 1,
    timestamp: 1_700_000_000_000,
    from: 'NQ80 T3YA BNDD 2JGX JQD6 LM5P QCE0 XH98 VC38',
    fromType: 0,
    to: W,
    toType: 0,
    value: 100_000,
    fee: 0,
    recipientData: '',
    flags: 0,
    executionResult: true,
    ...over,
  })
  const one = (r: TxRow, extra = {}) => classifyIncoming([r], { wallet: W, vaults: [], ...extra })[0]

  it('failed, zero-value, unstake, swap-hub and validator senders', () => {
    expect(one(row({ executionResult: false })).kind).toBe('failed')
    expect(one(row({ value: 0 })).kind).toBe('zero')
    expect(one(row({ from: 'NQ77 0000 0000 0000 0000 0000 0000 0000 0001', fromType: 3 })).kind).toBe('unstake')
    expect(one(row({ from: 'NQ56 VE9K PV0Y TK4T QBMY 8E9G B85J QR6M MSHL' })).kind).toBe('swap')
    expect(one(row({}), { validators: ['NQ80 T3YA BNDD 2JGX JQD6 LM5P QCE0 XH98 VC38'] }).kind).toBe('reward')
    expect(one(row({})).kind).toBe('received')
  })

  it('decodeMessage keeps text and drops binary', () => {
    expect(decodeMessage(Buffer.from('SAHHA YASSOU').toString('hex'))).toBe('SAHHA YASSOU')
    expect(decodeMessage('')).toBeUndefined()
    expect(decodeMessage('00ff10')).toBeUndefined()
    expect(decodeMessage('0102')).toBeUndefined()
  })
})
