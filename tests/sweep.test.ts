import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createStore } from '../src/chain/cache'
import type { RpcStaker, RpcTransaction } from '../src/chain/rpc'
import type { RoundUpItem } from '../src/roundup'
import {
  applyChainLookup,
  canStartSweep,
  classifyWalletError,
  earnedOnTop,
  executeSweep,
  findSweepTx,
  loadSweeps,
  lockedItemHashes,
  MIN_STAKE_LUNA,
  pickAffordable,
  pickDefaultValidator,
  planRoute,
  savedWithSpare,
  settleSweep,
  spendableLuna,
  sweptMarks,
  toStakerInfo,
  type SweepDeps,
  type SweepRecord,
  type SweepRequest,
  type ValidatorRow,
} from '../src/sweep'

const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T
const stakerNq56 = toStakerInfo(fixture<{ result: { data: RpcStaker } }>('staker-wallet-nq56.json').result.data)!
const stakingTx = fixture<{ result: { data: RpcTransaction } }>('tx-by-hash-staking.json').result.data

const W = 'NQ56 R5JT 1V5D 992A P60D 8E04 QQVN FGN7 SR3Q'
const VAULT = 'NQ91 Q6RM DEQX 0Q0S CTRM CN3A XEQR YLH2 803M'

describe('staking facts from fixtures', () => {
  it('the minimum stake is 100 NIM', () => {
    expect(fixture<{ result: { data: { minimumStake: number } } }>('policy-constants.json').result.data.minimumStake).toBe(MIN_STAKE_LUNA)
  })
  it('the staker is the wallet, not the vault that sent the tx', () => {
    expect(stakingTx.from).toBe(VAULT)
    expect(stakerNq56).toMatchObject({ active: 18_000_000, delegation: 'NQ15 HNAH YRVH DFVM YHAG BSXG 0QHK KA0Q XDR7' })
    expect(fixture<{ error: { data: string } }>('staker-none-vault-nq91.json').error.data).toMatch(/No staker/)
  })
})

describe('planRoute (new staker vs add stake, 100 NIM rule)', () => {
  it('no staker: below 100 NIM waits, 100 NIM or more creates a staker', () => {
    expect(planRoute(MIN_STAKE_LUNA - 1, null)).toEqual({ kind: 'wait', shortLuna: 1 })
    expect(planRoute(MIN_STAKE_LUNA, null)).toEqual({ kind: 'new' })
  })
  it('existing staker with >= 100 NIM active can add any amount', () => {
    expect(planRoute(1, stakerNq56)).toEqual({ kind: 'add' })
  })
  it('a fully retired staker must bring active+inactive back to 100 NIM', () => {
    const retired = { active: 0, inactive: 0, retired: 15_000_000, delegation: null }
    expect(planRoute(5_000_000, retired)).toEqual({ kind: 'wait', shortLuna: 5_000_000 })
    expect(planRoute(10_000_000, retired)).toEqual({ kind: 'add' })
  })
  it('nothing to sweep', () => {
    expect(planRoute(0, null)).toEqual({ kind: 'nothing' })
  })
})

describe('pickDefaultValidator', () => {
  it('follows the API ranking but skips pools that pay nothing or have stale scores', () => {
    const main = fixture<ValidatorRow[]>('validators-main.json')
    expect(main[0]).toMatchObject({ name: 'Nimiq Surf', payoutType: 'none' })
    expect(pickDefaultValidator(main)?.name).toBe('Garuda Pool')
    expect(pickDefaultValidator(fixture<ValidatorRow[]>('validators-test.json'))?.name).toBe('Siam Testnet Pool')
    expect(pickDefaultValidator([])).toBeNull()
  })
})

const item = (hash: string, day: number, saved: number, status: RoundUpItem['status'] = 'pending'): RoundUpItem => ({
  hash,
  timestamp: Date.UTC(2026, 10, day),
  day: `2026-11-${String(day).padStart(2, '0')}`,
  kind: 'payment',
  label: 'Payment',
  recipient: 'x',
  valueLuna: 0,
  price: 0.00025,
  priceDay: null,
  priceApproximate: false,
  fiatAtTime: saved * 2,
  step: 1,
  roundUp: saved,
  saved,
  status,
})

describe('spendable + partial sweep', () => {
  it('uses the vault balance, the wallet only when the vault is empty', () => {
    expect(spendableLuna({ wallet: 5, htlc: 100 })).toBe(100)
    expect(spendableLuna({ wallet: 5, htlc: 0 })).toBe(5)
    expect(spendableLuna({ wallet: null, htlc: null })).toBe(0)
  })

  it('covers the most items it can afford, oldest first', () => {
    // $0.025 = 100 NIM at $0.00025
    const items = [item('newest', 9, 0.025), item('oldest', 1, 0.025), item('big', 5, 0.05), item('done', 2, 0.01, 'swept')]
    // 250 NIM available: oldest (100) fits, big (+200 = 300) does not, newest (+100 = 200) does.
    const p = pickAffordable(items, 25_000_000, 0.00025)
    expect(p.items.map((i) => i.hash)).toEqual(['oldest', 'newest'])
    expect(p.luna).toBe(20_000_000)
    // Skips one that doesn't fit and keeps going.
    const q = pickAffordable([item('a', 1, 0.05), item('b', 2, 0.05), item('c', 3, 0.0125)], 26_000_000, 0.00025)
    // 260 NIM: a (200) fits, b (+200) does not, c (+50 = 250) does.
    expect(q.items.map((i) => i.hash)).toEqual(['a', 'c'])
    expect(q.luna).toBe(25_000_000)
    expect(Number.isInteger(q.luna)).toBe(true)
  })
})

describe('earned on top', () => {
  const confirmed = (luna: number, stakeBefore: number, at = 1): SweepRecord => ({ ...baseRecord, id: String(at), createdAt: at, status: 'confirmed', luna, stakeBefore, txHash: 'h' })
  it('is current stake minus what Spare put in', () => {
    expect(earnedOnTop({ active: 18_100_000, inactive: 0, retired: 0, delegation: null }, [confirmed(18_000_000, 0)])).toEqual({ luna: 100_000, approximate: false })
  })
  it('is never negative', () => {
    expect(earnedOnTop({ active: 10_000_000, inactive: 0, retired: 0, delegation: null }, [confirmed(12_000_000, 0)]).luna).toBe(0)
  })
  it('is approximate when the user had stake before Spare', () => {
    expect(earnedOnTop(stakerNq56, [confirmed(1_000_000, 18_000_000)])).toEqual({ luna: 17_000_000, approximate: true })
  })
  it('is 0 with no confirmed sweep', () => {
    expect(earnedOnTop(stakerNq56, [])).toEqual({ luna: 0, approximate: false })
  })
})

const baseRecord: SweepRecord = {
  id: 'r1',
  createdAt: stakingTx.timestamp - 10_000,
  status: 'submitted',
  route: 'new',
  delegation: 'NQ15 HNAH YRVH DFVM YHAG BSXG 0QHK KA0Q XDR7',
  luna: 18_000_000,
  fiat: 4.5,
  fiatCode: 'USD',
  price: 0.00025,
  priceTime: null,
  itemHashes: ['a', 'b'],
  stakeBefore: 0,
  txHash: stakingTx.hash,
}

describe('record state machine', () => {
  it('marks items swept only once the tx is confirmed', () => {
    expect(sweptMarks([baseRecord]).size).toBe(0)
    const pending = applyChainLookup(baseRecord, null, baseRecord.createdAt + 5000)
    expect(pending.status).toBe('submitted')
    const done = applyChainLookup(baseRecord, stakingTx, baseRecord.createdAt + 5000)
    expect(done.status).toBe('confirmed')
    expect(sweptMarks([done]).get('a')).toEqual({ sweepHash: stakingTx.hash, at: stakingTx.timestamp })
  })

  it('a failed tx leaves the items pending', () => {
    const failed = applyChainLookup(baseRecord, { ...stakingTx, executionResult: false }, baseRecord.createdAt)
    expect(failed.status).toBe('failed')
    expect(sweptMarks([failed]).size).toBe(0)
    expect(lockedItemHashes([failed]).size).toBe(0)
    expect(canStartSweep([failed]).ok).toBe(true)
  })

  it('an unknown outcome locks the items and blocks new sweeps until the chain answers', () => {
    const checking = { ...baseRecord, status: 'checking' as const, txHash: null }
    expect(canStartSweep([checking]).ok).toBe(false)
    expect([...lockedItemHashes([checking])]).toEqual(['a', 'b'])
    // Still unseen within the validity window: stays checking.
    expect(applyChainLookup(checking, null, checking.createdAt + 60 * 60 * 1000).status).toBe('checking')
    // Unseen long after the window: it can no longer land.
    expect(applyChainLookup(checking, null, checking.createdAt + 3 * 60 * 60 * 1000).status).toBe('failed')
  })

  it('finds a hash-less unknown sweep by amount, sender and destination', () => {
    const rows = fixture<{ result: { data: RpcTransaction[] } }>('txs-vault-nq91-staker.json').result.data
    expect(findSweepTx(rows, baseRecord, new Set([W, VAULT]))?.hash).toBe(stakingTx.hash)
    expect(findSweepTx(rows, { ...baseRecord, luna: 18_000_001 }, new Set([W, VAULT]))).toBeNull()
    expect(findSweepTx(rows, { ...baseRecord, createdAt: stakingTx.timestamp + 10 * 60_000 }, new Set([W, VAULT]))).toBeNull()
  })

  it('savedWithSpare sums confirmed sweeps only', () => {
    const s = savedWithSpare([{ ...baseRecord, status: 'confirmed' }, { ...baseRecord, id: 'x', status: 'failed' }, { ...baseRecord, id: 'y', status: 'checking' }])
    expect(s).toEqual({ luna: 18_000_000, topUpLuna: 0, fiatByCode: { USD: 4.5 } })
  })

  it('a starter top-up is stake but not savings: excluded from Saved with Spare, included in what Spare put in', () => {
    // 30 NIM of round-ups topped up to the 100 NIM minimum.
    const starter: SweepRecord = { ...baseRecord, status: 'confirmed', luna: 10_000_000, topUpLuna: 7_000_000, fiat: 0.0075 }
    expect(savedWithSpare([starter])).toEqual({ luna: 3_000_000, topUpLuna: 7_000_000, fiatByCode: { USD: 0.0075 } })
    // Earned on top subtracts everything Spare staked, top-up included.
    expect(earnedOnTop({ active: 10_050_000, inactive: 0, retired: 0, delegation: null }, [starter])).toEqual({ luna: 50_000, approximate: false })
  })
})

describe('classifyWalletError', () => {
  it('sorts Nimiq Pay errors', () => {
    expect(classifyWalletError({ type: 'PERMISSION_DENIED', message: 'User rejected' }).kind).toBe('rejected')
    expect(classifyWalletError({ code: 4001, message: 'x' }).kind).toBe('rejected')
    expect(classifyWalletError({ type: 'TRANSACTION_OUTCOME_UNKNOWN', message: 'x', data: { hash: stakingTx.hash } })).toMatchObject({ kind: 'unknown', hash: stakingTx.hash })
    expect(classifyWalletError({ type: 'INVALID_TRANSACTION', message: 'x' }).kind).toBe('other')
  })
})

describe('executeSweep (fake wallet + fake chain)', () => {
  const req: SweepRequest = {
    route: 'new',
    delegation: baseRecord.delegation,
    luna: 18_000_000,
    fiat: 4.5,
    fiatCode: 'USD',
    price: 0.00025,
    priceTime: null,
    itemHashes: ['a', 'b'],
    stakeBefore: 0,
  }

  function setup(opts: { send: () => Promise<string>; chain: (RpcTransaction | null)[]; history?: RpcTransaction[] }) {
    const store = createStore(null)
    const calls: string[] = []
    let clock = stakingTx.timestamp - 10_000
    const chain = [...opts.chain]
    const snapshots: SweepRecord[] = []
    const deps: SweepDeps = {
      provider: {
        sendNewStakerTransaction: async () => {
          calls.push('new')
          return opts.send()
        },
        sendStakeTransaction: async () => {
          calls.push('add')
          return opts.send()
        },
      },
      rpc: {
        getTransactionByHash: async () => (chain.length > 1 ? chain.shift()! : (chain[0] ?? null)),
        getTransactionsByAddress: async () => opts.history ?? [],
      },
      store,
      network: 'mainnet',
      wallet: W,
      ownAddresses: [W, VAULT],
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
      },
      pollMs: 3000,
      maxPollMs: 30_000,
      onUpdate: (r) => snapshots.push(r),
    }
    return { deps, store, calls, snapshots }
  }

  it('confirmed: items are marked swept only after the chain confirms', async () => {
    const { deps, store, snapshots } = setup({ send: async () => stakingTx.hash, chain: [null, null, stakingTx] })
    const out = await executeSweep(deps, req)
    expect(out).toMatchObject({ kind: 'record', record: { status: 'confirmed', txHash: stakingTx.hash } })
    expect(snapshots.map((s) => s.status)).toEqual(['sending', 'submitted', 'confirmed'])
    expect(sweptMarks(loadSweeps(store, 'mainnet', W)).get('a')?.sweepHash).toBe(stakingTx.hash)
  })

  it('keeps the starter top-up on the record', async () => {
    const { deps, store } = setup({ send: async () => stakingTx.hash, chain: [stakingTx] })
    await executeSweep(deps, { ...req, luna: 18_000_000, topUpLuna: 5_000_000 })
    expect(loadSweeps(store, 'mainnet', W)[0]).toMatchObject({ status: 'confirmed', luna: 18_000_000, topUpLuna: 5_000_000 })
  })

  it('user rejected: nothing changes', async () => {
    const { deps, store } = setup({ send: () => Promise.reject({ type: 'PERMISSION_DENIED', code: 4001, message: 'User rejected' }), chain: [] })
    expect(await executeSweep(deps, req)).toEqual({ kind: 'rejected' })
    expect(loadSweeps(store, 'mainnet', W)).toEqual([])
  })

  it('unknown outcome: never double-sweeps, and settles from the chain', async () => {
    const unknown = { type: 'TRANSACTION_OUTCOME_UNKNOWN', code: -32001, message: 'maybe', data: {} }
    const { deps, store, calls } = setup({ send: () => Promise.reject(unknown), chain: [], history: [] })
    deps.maxPollMs = 6000
    const first = await executeSweep(deps, req)
    expect(first).toMatchObject({ kind: 'record', record: { status: 'checking', txHash: null } })
    // A retry is refused while the first is unresolved; the wallet is not asked again.
    expect(await executeSweep(deps, req)).toMatchObject({ kind: 'blocked' })
    expect(calls).toEqual(['new'])
    // Later the tx shows up in the vault history: the sweep confirms without a second send.
    const settled = await settleSweep({ ...deps, rpc: { ...deps.rpc, getTransactionsByAddress: async () => [stakingTx] } }, loadSweeps(store, 'mainnet', W)[0])
    expect(settled).toMatchObject({ status: 'confirmed', txHash: stakingTx.hash })
    expect(calls).toEqual(['new'])
  })

  it('failed on chain: items stay pending and a new sweep may start', async () => {
    const { deps, store } = setup({ send: async () => stakingTx.hash, chain: [{ ...stakingTx, executionResult: false }] })
    const out = await executeSweep(deps, req)
    expect(out).toMatchObject({ kind: 'record', record: { status: 'failed' } })
    const history = loadSweeps(store, 'mainnet', W)
    expect(sweptMarks(history).size).toBe(0)
    expect(canStartSweep(history).ok).toBe(true)
  })

  it('a crash during the dialog (left in "sending") is treated as unknown on resume', async () => {
    const { deps, store } = setup({ send: async () => stakingTx.hash, chain: [] })
    const stuck: SweepRecord = { ...baseRecord, status: 'sending', txHash: null }
    store.set(`mainnet:${W}:sweeps`, [stuck])
    expect(canStartSweep(loadSweeps(store, 'mainnet', W)).ok).toBe(false)
    const r = await settleSweep({ ...deps, rpc: { ...deps.rpc, getTransactionsByAddress: async () => [stakingTx] } }, stuck)
    expect(r.status).toBe('confirmed')
  })
})
