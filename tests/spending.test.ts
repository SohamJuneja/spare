import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { addressFromHex, isValidAddress, normalizeAddress } from '../src/chain/address'
import type { RpcClient, RpcHtlcAccount, RpcTransaction } from '../src/chain/rpc'
import { classifyTransactions, decodeHtlcData, isVaultCreation, toSpendEvents, traceWallet } from '../src/chain/spending'

const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T
const txs = (name: string) => fixture<{ result: { data: RpcTransaction[] } }>(name).result.data
const byHash = <T extends { hash: string }>(list: T[], prefix: string): T => list.find((t) => t.hash.startsWith(prefix))!

// Real mainnet addresses (see tests/fixtures/)
const W04 = 'NQ04 HH5C HSLU VHGD EP4G BA1R 1MGB PT0X EY9V' // wallet behind Kuza's README address
const V_4VDF = 'NQ89 4VDF DQ8Q JEGL KX8U A1HC DE6K A78Y CJR5'
const V_UUAS = 'NQ80 UUAS BU0Q 6Q5B 17C7 E245 DNST 92Q1 65NG'
const KUZA_ADDR = 'NQ89 V0MN CVGT 3RC9 B7PA F1YJ L564 TEMK A0TM'
const COSIGNER = 'NQ32 7HKC C30M X9NJ AURD EDSG 98H5 UX0R UEQB'
const SWAP_HUB = 'NQ56 VE9K PV0Y TK4T QBMY 8E9G B85J QR6M MSHL'
const W51 = 'NQ51 DE7S FX74 A8BL L7GK EYGB YVPF UK6C 8DXT'
const V_RKPU = 'NQ33 RKPU NQM5 N19R 8MK3 6BUS 70VV 8PQ0 GGD0'
const V_6D6X = 'NQ22 6D6X JBMX 8GLY 6F3K VXTS DCMG KAFG SXKG'
const W_STAKER = 'NQ56 R5JT 1V5D 992A P60D 8E04 QQVN FGN7 SR3Q'
const V_STAKER = 'NQ91 Q6RM DEQX 0Q0S CTRM CN3A XEQR YLH2 803M'

const nq04All = () => [...txs('txs-wallet-nq04.json'), ...txs('txs-vault-nq80.json'), ...txs('txs-vault-nq89-4vdf.json')]

describe('address codec', () => {
  it('validates and encodes real addresses', () => {
    expect(isValidAddress(KUZA_ADDR)).toBe(true)
    expect(isValidAddress('NQ89 V0MN CVGT 3RC9 B7PA F1YJ L564 TEMK A0TX')).toBe(false)
    expect(addressFromHex('8c4ac8ea9cec60d75c905a8390d60bbec1e77d3d')).toBe(W04)
    expect(normalizeAddress('nq04hh5chsluvhgdep4gba1r1mgbpt0xey9v')).toBe(W04)
  })
})

describe('HTLC data', () => {
  it('decodes a vault creation and agrees with the live HTLC account state', () => {
    const funding = byHash(txs('txs-wallet-nq04.json'), '1f4f1717')
    const account = fixture<{ result: { data: RpcHtlcAccount } }>('account-vault-htlc-nq89-4vdf.json').result.data
    const d = decodeHtlcData(funding.recipientData)!
    expect(d.sender).toBe(account.sender)
    expect(d.recipient).toBe(account.recipient)
    expect(d.recipient).toBe(COSIGNER)
    expect(d.timeoutMs).toBe(account.timeout)
    expect(d.hashRoot).toBe(account.hashRoot.hash)
    expect(isVaultCreation(funding, W04)).toBe(true)
  })

  it("Kuza's README address is a swap HTLC, not a vault (and its account is pruned now)", () => {
    const creation = byHash(txs('txs-swap-nq89-v0mn.json'), '87d87021')
    const d = decodeHtlcData(creation.recipientData)!
    expect(d.sender).toBe(W04)
    expect(d.recipient).toBe(SWAP_HUB)
    expect(d.hashAlgorithm).toBe(3) // sha256, real hash lock
    expect(isVaultCreation(creation, W04)).toBe(false)
    expect(fixture<{ result: { data: { type: string } } }>('account-pruned-htlc-nq89-v0mn.json').result.data.type).toBe('basic')
  })
})

describe('classifyTransactions', () => {
  const ctx04 = { wallet: W04, vaults: [V_4VDF, V_UUAS] }

  it('a payment from a vault counts', () => {
    const c = classifyTransactions(nq04All(), ctx04)
    expect(byHash(c, '43dd84c6').kind).toBe('payment')
    expect(byHash(c, '99dfdcce').kind).toBe('payment')
    expect(toSpendEvents(c, 0).map((s) => s.hash)).toContain(byHash(c, '43dd84c6').hash)
  })

  it('vault rotation through the wallet is internal (old vault -> wallet -> new vault)', () => {
    const c = classifyTransactions(nq04All(), ctx04)
    expect(byHash(c, '1386d587')).toMatchObject({ kind: 'internal', from: V_UUAS, to: W04 })
    expect(byHash(c, '1f4f1717')).toMatchObject({ kind: 'internal', from: W04, to: V_4VDF })
  })

  it('a direct vault-to-vault rotation is internal', () => {
    const c = classifyTransactions(txs('txs-vault-nq22.json'), { wallet: W51, vaults: [V_RKPU, V_6D6X] })
    expect(byHash(c, '4a60c316')).toMatchObject({ kind: 'internal', from: V_RKPU, to: V_6D6X })
  })

  it('a rotation into a not-yet-discovered vault is still internal, via its creation data', () => {
    const c = classifyTransactions(txs('txs-vault-nq22.json'), { wallet: W51, vaults: [V_RKPU] })
    expect(byHash(c, '4a60c316')).toMatchObject({ kind: 'internal', note: 'new vault' })
  })

  it('staking from a Pay vault is excluded', () => {
    const c = classifyTransactions(txs('txs-vault-nq91-staker.json'), { wallet: W_STAKER, vaults: [V_STAKER] })
    expect(byHash(c, '40a52fd5').kind).toBe('staking')
    expect(toSpendEvents(c, 0)).toHaveLength(0)
  })

  it('funding a swap HTLC is lightning, unless it was refunded', () => {
    const c = classifyTransactions(nq04All(), ctx04)
    expect(byHash(c, '87d87021').kind).toBe('lightning')
    expect(byHash(c, 'a492f05d').kind).toBe('lightning')
    const refunded = classifyTransactions(nq04All(), { ...ctx04, refundedHtlcs: [KUZA_ADDR] })
    expect(byHash(refunded, '87d87021')).toMatchObject({ kind: 'internal', note: 'swap refunded' })
  })

  it('a duplicate hash counts once', () => {
    // 1f4f… and 1386… each appear in two histories; feed everything twice on top.
    const all = [...nq04All(), ...nq04All()]
    const c = classifyTransactions(all, ctx04)
    expect(new Set(c.map((x) => x.hash)).size).toBe(c.length)
    expect(c.filter((x) => x.hash.startsWith('1f4f1717'))).toHaveLength(1)
    const spends = toSpendEvents(c, 0)
    expect(spends).toHaveLength(5)
  })

  it('a failed tx is excluded (derived fixture: real tx with executionResult=false)', () => {
    const { tx } = fixture<{ tx: RpcTransaction }>('derived-failed-tx.json')
    const c = classifyTransactions([tx], ctx04)
    expect(c[0].kind).toBe('failed')
    expect(toSpendEvents(c, 0)).toHaveLength(0)
  })

  it('ignores incoming txs and gives the expected NQ04 totals', () => {
    const c = classifyTransactions(nq04All(), ctx04)
    expect(c.every((x) => x.from === W04 || x.from === V_4VDF || x.from === V_UUAS)).toBe(true)
    const spends = toSpendEvents(c, 0)
    expect(spends.filter((s) => s.kind === 'payment')).toHaveLength(3)
    expect(spends.filter((s) => s.kind === 'lightning')).toHaveLength(2)
    expect(spends.reduce((s, e) => s + e.valueLuna, 0)).toBe(66_242_239) // 662.42239 NIM
  })
})

describe('traceWallet (offline, fixture-backed RPC)', () => {
  const histories: Record<string, RpcTransaction[]> = {
    [W04]: txs('txs-wallet-nq04.json'),
    [V_UUAS]: txs('txs-vault-nq80.json'),
    [V_4VDF]: txs('txs-vault-nq89-4vdf.json'),
    [KUZA_ADDR]: txs('txs-swap-nq89-v0mn.json'),
    'NQ98 LETS CC07 ERYV A425 MK1A KNJQ XTMT 3759': txs('txs-swap-nq98-lets.json'),
  }
  const fakeRpc = {
    url: 'fixtures',
    getTransactionsByAddress: async (a: string) => histories[a] ?? [],
    getTransactionsSince: async (a: string) => histories[a] ?? [],
    getAccountByAddress: async () => {
      throw new Error('not used')
    },
  } as unknown as RpcClient

  it('discovers both vaults recursively and returns only real spends', async () => {
    const now = Date.parse('2026-11-10T22:00:00Z')
    const t = await traceWallet(W04, 30, { rpc: fakeRpc, now })
    expect(new Set(t.vaults)).toEqual(new Set([V_4VDF, V_UUAS]))
    expect(t.vaults).not.toContain(KUZA_ADDR)
    expect(t.spends.map((s) => s.kind).sort()).toEqual(['lightning', 'lightning', 'payment', 'payment', 'payment'])
  })

  it('respects the window', async () => {
    const now = Date.parse('2026-11-10T22:00:00Z')
    const t = await traceWallet(W04, 5, { rpc: fakeRpc, now }) // since Nov 5 22:00
    expect(t.spends.map((s) => s.hash.slice(0, 8)).sort()).toEqual(['87d87021', '99dfdcce'])
  })
})
