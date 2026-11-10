// Sweep spare change into the user's own NIM stake.
//
// Verified on mainnet (tests/fixtures/):
// - Nimiq Pay stakes FROM the vault, but the staker is the WALLET: tx 40a52fd5… goes vault NQ91 → staking
//   contract with CreateStaker data, and getStakerByAddress answers for wallet NQ56 R5JT, not for the vault.
// - getPolicyConstants: minimumStake 10,000,000 luna (100 NIM). core-rs staker.rs enforce_min_stake: after any
//   change, active+inactive must be 0 or >= minimum; so a new staker needs >= 100 NIM, and an existing staker
//   whose active+inactive is >= 100 NIM may add any amount.
// - Wallet error classes adapted from Kuza (swiftbotlabs/kuza, MIT): PERMISSION_DENIED/4001 = user cancelled,
//   TRANSACTION_OUTCOME_UNKNOWN/-32001 = may have been sent, hash in error.data.hash when known.

import { STAKING_CONTRACT } from './chain/address'
import type { KvStore, TxRow } from './chain/cache'
import { normalizeTimestamp, type Network, type RpcClient, type RpcStaker, type RpcTransaction } from './chain/rpc'
import type { FiatCode } from './prices'
import type { RoundUpItem } from './roundup'

export const MIN_STAKE_LUNA = 10_000_000
/** transactionValidityWindow 7200 blocks × 1 s; after this an unseen tx can no longer be included. */
export const TX_VALIDITY_MS = 7200 * 1000
const EXPIRY_MARGIN_MS = 30 * 60 * 1000

export interface StakerInfo {
  active: number
  inactive: number
  retired: number
  delegation: string | null
}

export function toStakerInfo(raw: RpcStaker | null): StakerInfo | null {
  if (!raw) return null
  return { active: raw.balance, inactive: raw.inactiveBalance, retired: raw.retiredBalance, delegation: raw.delegation }
}

export type Route = { kind: 'new' } | { kind: 'add' } | { kind: 'wait'; shortLuna: number } | { kind: 'nothing' }

/** Which staking call a sweep of `luna` needs, under the minimum-stake rule. */
export function planRoute(luna: number, staker: StakerInfo | null): Route {
  if (!Number.isSafeInteger(luna) || luna <= 0) return { kind: 'nothing' }
  // A fully retired staker still exists (so it is AddStake), but its active+inactive restarts from 0.
  const nonRetired = staker ? staker.active + staker.inactive : 0
  if (nonRetired + luna < MIN_STAKE_LUNA) return { kind: 'wait', shortLuna: MIN_STAKE_LUNA - nonRetired - luna }
  return staker ? { kind: 'add' } : { kind: 'new' }
}

export interface ValidatorRow {
  name: string
  address: string
  fee: number | null
  payoutType: string
  isListed: boolean
  score: { total: number; dataStatus: string } | null
}

/**
 * The API already returns validators by score.total, best first. Take the first one that is listed,
 * actually pays stakers (payoutType != 'none') and has current score data; else the first listed.
 */
export function pickDefaultValidator(rows: ValidatorRow[]): ValidatorRow | null {
  const listed = rows.filter((r) => r.isListed)
  return listed.find((r) => r.payoutType !== 'none' && r.score?.dataStatus === 'current') ?? listed[0] ?? null
}

/** One tx is funded from one account; Pay funds staking from the vault, the wallet only when the vault is empty. */
export function spendableLuna(balances: { wallet: number | null; htlc: number | null }): number {
  return balances.htlc && balances.htlc > 0 ? balances.htlc : (balances.wallet ?? 0)
}

const toLuna = (fiat: number, price: number) => Math.floor(Math.round((fiat / price) * 1e5 * 1e6) / 1e6)

/** Oldest first, take every pending item that still fits in `spendable`. */
export function pickAffordable(items: RoundUpItem[], spendable: number, price: number): { items: RoundUpItem[]; luna: number; fiat: number } {
  const picked: RoundUpItem[] = []
  let fiat = 0
  for (const item of [...items].sort((a, b) => a.timestamp - b.timestamp)) {
    if (item.status !== 'pending' || item.saved <= 0) continue
    if (toLuna(fiat + item.saved, price) > spendable) continue
    picked.push(item)
    fiat += item.saved
  }
  return { items: picked, luna: toLuna(fiat, price), fiat: Math.round(fiat * 1e8) / 1e8 }
}

export type SweepStatus = 'sending' | 'submitted' | 'checking' | 'confirmed' | 'failed'

export interface SweepRecord {
  id: string
  createdAt: number
  status: SweepStatus
  route: 'new' | 'add'
  delegation: string | null
  luna: number
  fiat: number
  fiatCode: FiatCode
  price: number
  priceTime: number | null
  itemHashes: string[]
  /** Staker total (active+inactive+retired) right before this sweep was sent. */
  stakeBefore: number
  txHash: string | null
  confirmedAt?: number
  error?: string
}

const IN_FLIGHT: SweepStatus[] = ['sending', 'submitted', 'checking']

/** Items that belong to a sweep that has not failed: never quoted again. */
export function lockedItemHashes(history: SweepRecord[]): Set<string> {
  return new Set(history.filter((r) => r.status !== 'failed').flatMap((r) => r.itemHashes))
}

/** A new sweep may only start once every earlier one is settled on chain. */
export function canStartSweep(history: SweepRecord[]): { ok: true } | { ok: false; reason: string } {
  const open = history.find((r) => IN_FLIGHT.includes(r.status))
  if (!open) return { ok: true }
  return { ok: false, reason: open.status === 'checking' ? 'An earlier sweep had an unknown outcome; checking the chain first.' : 'An earlier sweep is still confirming.' }
}

/** Only confirmed sweeps mark items swept. */
export function sweptMarks(history: SweepRecord[]): Map<string, { sweepHash: string; at: number }> {
  const out = new Map<string, { sweepHash: string; at: number }>()
  for (const r of history) {
    if (r.status !== 'confirmed' || !r.txHash) continue
    for (const h of r.itemHashes) out.set(h, { sweepHash: r.txHash, at: r.confirmedAt ?? r.createdAt })
  }
  return out
}

/** Fold a chain lookup into a record. `tx` null means not found (yet). */
export function applyChainLookup(record: SweepRecord, tx: Pick<RpcTransaction, 'hash' | 'executionResult' | 'timestamp'> | null, now: number): SweepRecord {
  if (record.status === 'confirmed' || record.status === 'failed') return record
  if (tx) {
    return tx.executionResult
      ? { ...record, status: 'confirmed', txHash: tx.hash, confirmedAt: normalizeTimestamp(tx.timestamp) }
      : { ...record, status: 'failed', txHash: tx.hash, error: 'Transaction failed on chain' }
  }
  // Never seen and past its validity window: it can no longer land, so the items are free again.
  if (now > record.createdAt + TX_VALIDITY_MS + EXPIRY_MARGIN_MS) return { ...record, status: 'failed', error: 'Never included on chain (expired)' }
  return record
}

/** For an unknown outcome without a hash: an own address paying exactly this amount into staking after we started. */
export function findSweepTx(rows: TxRow[], record: SweepRecord, own: Set<string>): TxRow | null {
  return (
    rows.find((r) => own.has(r.from) && r.to === STAKING_CONTRACT && r.value === record.luna && normalizeTimestamp(r.timestamp) >= record.createdAt - 120_000) ?? null
  )
}

export function savedWithSpare(history: SweepRecord[]): { luna: number; fiatByCode: Partial<Record<FiatCode, number>> } {
  let luna = 0
  const fiatByCode: Partial<Record<FiatCode, number>> = {}
  for (const r of history) {
    if (r.status !== 'confirmed') continue
    luna += r.luna
    fiatByCode[r.fiatCode] = (fiatByCode[r.fiatCode] ?? 0) + r.fiat
  }
  return { luna, fiatByCode }
}

/**
 * Current stake minus what Spare put in, floored at 0. Approximate when the user had stake before Spare's first
 * confirmed sweep (their own stake and its rewards are mixed in).
 */
export function earnedOnTop(staker: StakerInfo | null, history: SweepRecord[]): { luna: number; approximate: boolean } {
  const confirmed = history.filter((r) => r.status === 'confirmed').sort((a, b) => a.createdAt - b.createdAt)
  if (!staker || !confirmed.length) return { luna: 0, approximate: false }
  const total = staker.active + staker.inactive + staker.retired
  const putIn = confirmed.reduce((s, r) => s + r.luna, 0)
  return { luna: Math.max(0, total - putIn), approximate: confirmed[0].stakeBefore > 0 }
}

export type WalletErrorKind = 'rejected' | 'unknown' | 'other'

export function classifyWalletError(err: unknown): { kind: WalletErrorKind; hash: string | null; message: string } {
  const e = (err ?? {}) as { type?: string; code?: number; message?: string; data?: { hash?: unknown } }
  const hash = typeof e.data?.hash === 'string' && /^[0-9a-f]{64}$/i.test(e.data.hash) ? e.data.hash : null
  const message = `${e.type ?? 'Error'}: ${e.message ?? String(err)}`
  if (e.type === 'PERMISSION_DENIED' || e.code === 4001) return { kind: 'rejected', hash, message }
  if (e.type === 'TRANSACTION_OUTCOME_UNKNOWN' || e.code === -32001 || /timed? ?out/i.test(e.message ?? '')) return { kind: 'unknown', hash, message }
  return { kind: 'other', hash, message }
}

// ---- persistence + effects ----

const VALIDATORS_URL: Record<Network, string> = {
  mainnet: 'https://validators-api-main.je-cf9.workers.dev/api/v1/validators',
  testnet: 'https://validators-api-test.je-cf9.workers.dev/api/v1/validators',
}

/** Validators in the API's own order (score.total, best first). Cached 1h; a stale copy beats none. */
export async function fetchValidators(network: Network, store: KvStore, now = Date.now()): Promise<ValidatorRow[]> {
  const key = `validators:${network}`
  const cached = store.get<{ at: number; rows: ValidatorRow[] }>(key)
  if (cached && now - cached.at < 3600_000) return cached.rows
  try {
    const res = await fetch(VALIDATORS_URL[network])
    if (!res.ok) throw new Error(`validators API HTTP ${res.status}`)
    const rows = ((await res.json()) as (ValidatorRow & { logo?: string })[]).map(({ logo: _logo, ...r }) => r)
    store.set(key, { at: now, rows })
    return rows
  } catch (e) {
    if (cached) return cached.rows
    throw e
  }
}

const historyKey = (network: Network, wallet: string) => `${network}:${wallet}:sweeps`

export function loadSweeps(store: KvStore, network: Network, wallet: string): SweepRecord[] {
  return store.get<SweepRecord[]>(historyKey(network, wallet)) ?? []
}

function saveRecord(store: KvStore, network: Network, wallet: string, record: SweepRecord): SweepRecord[] {
  const history = loadSweeps(store, network, wallet).filter((r) => r.id !== record.id)
  history.push(record)
  history.sort((a, b) => a.createdAt - b.createdAt)
  store.set(historyKey(network, wallet), history)
  return history
}

function removeRecord(store: KvStore, network: Network, wallet: string, id: string) {
  store.set(
    historyKey(network, wallet),
    loadSweeps(store, network, wallet).filter((r) => r.id !== id),
  )
}

export interface StakingProvider {
  sendNewStakerTransaction(tx: { delegation: string; value: number }): Promise<string>
  sendStakeTransaction(tx: { value: number }): Promise<string>
}

export interface SweepDeps {
  provider: StakingProvider
  rpc: Pick<RpcClient, 'getTransactionByHash' | 'getTransactionsByAddress'>
  store: KvStore
  network: Network
  wallet: string
  /** Wallet + vault addresses, to find a hash-less unknown outcome. */
  ownAddresses: string[]
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  pollMs?: number
  /** Give up polling (status stays submitted/checking, resumed later) after this long. */
  maxPollMs?: number
  onUpdate?: (record: SweepRecord) => void
}

export interface SweepRequest {
  route: 'new' | 'add'
  delegation: string | null
  luna: number
  fiat: number
  fiatCode: FiatCode
  price: number
  priceTime: number | null
  itemHashes: string[]
  stakeBefore: number
}

export type SweepOutcome = { kind: 'rejected' } | { kind: 'blocked'; reason: string } | { kind: 'record'; record: SweepRecord }

/** Send the staking tx (one wallet dialog) and follow it to a final state. Call only from a button press. */
export async function executeSweep(deps: SweepDeps, req: SweepRequest): Promise<SweepOutcome> {
  const now = deps.now ?? Date.now
  const gate = canStartSweep(loadSweeps(deps.store, deps.network, deps.wallet))
  if (!gate.ok) return { kind: 'blocked', reason: gate.reason }
  if (req.route === 'new' && !req.delegation) return { kind: 'blocked', reason: 'Pick a staking pool first.' }

  // Persist before the dialog opens: if the app dies mid-call, the lock survives and we check the chain.
  let record: SweepRecord = { ...req, id: `${now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: now(), status: 'sending', txHash: null }
  const persist = (r: SweepRecord) => {
    saveRecord(deps.store, deps.network, deps.wallet, r)
    deps.onUpdate?.(r)
    return r
  }
  persist(record)

  try {
    const hash =
      req.route === 'new'
        ? await deps.provider.sendNewStakerTransaction({ delegation: req.delegation!, value: req.luna })
        : await deps.provider.sendStakeTransaction({ value: req.luna })
    record = persist({ ...record, status: 'submitted', txHash: hash })
  } catch (err) {
    const e = classifyWalletError(err)
    if (e.kind === 'rejected') {
      removeRecord(deps.store, deps.network, deps.wallet, record.id)
      return { kind: 'rejected' }
    }
    record = persist(e.kind === 'unknown' ? { ...record, status: 'checking', txHash: e.hash, error: e.message } : { ...record, status: 'failed', error: e.message })
    if (record.status === 'failed') return { kind: 'record', record }
  }
  return { kind: 'record', record: await settleSweep(deps, record) }
}

/** Poll the chain for a submitted/checking sweep. Read-only, safe to call on page load. */
export async function settleSweep(deps: SweepDeps, start: SweepRecord): Promise<SweepRecord> {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const pollMs = deps.pollMs ?? 3000
  const deadline = now() + (deps.maxPollMs ?? 90_000)
  const own = new Set(deps.ownAddresses)
  let record = start
  // 'sending' found on load means the app died during the dialog: same as an unknown outcome.
  if (record.status === 'sending') {
    record = { ...record, status: 'checking' }
    saveRecord(deps.store, deps.network, deps.wallet, record)
    deps.onUpdate?.(record)
  }

  for (;;) {
    let tx: Pick<RpcTransaction, 'hash' | 'executionResult' | 'timestamp'> | null = null
    try {
      if (record.txHash) tx = await deps.rpc.getTransactionByHash(record.txHash)
      else {
        for (const address of own) {
          tx = findSweepTx(await deps.rpc.getTransactionsByAddress(address, 25), record, own)
          if (tx) break
        }
      }
    } catch {
      /* network trouble: keep the current status and try again */
    }
    const next = applyChainLookup(record, tx, now())
    if (next !== record) {
      record = next
      saveRecord(deps.store, deps.network, deps.wallet, record)
      deps.onUpdate?.(record)
    }
    if (record.status === 'confirmed' || record.status === 'failed' || now() >= deadline) return record
    await sleep(pollMs)
  }
}
