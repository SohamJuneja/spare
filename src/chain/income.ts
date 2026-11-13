// Incoming payments: classify every tx INTO the wallet or one of its vaults. Pure, except `htlcOrigin*` helpers
// which only read rows.
//
// Verified on mainnet + testnet (tests/fixtures/income-*.json, scripts/trace-income.ts):
// - Nimiq Pay receives into the WALLET (basic account); Pay then moves it wallet → new vault (own, excluded).
// - Old vault → wallet when a vault is rotated (fromType 2, own): excluded.
// - Another Pay user paying you sends from THEIR vault, so the sender is an HTLC we don't own. Its creation data
//   tells it apart: a vault has an all-zero hashRoot and a sender that isn't you (NQ20's vault NQ64 HRDD → NQ45,
//   NQ45's vault NQ43 FBKY → NQ20). A swap HTLC has a real sha256 root (NQ51's NQ52 X3HN, refunded to NQ51).
// - Unstaking releases come from the staking contract (NQ77 0000…0001, fromType 3): excluded.
// - Pool payouts that reach a wallet come from the validator address (Garuda NQ15 HNAH → NQ20). Restake pools
//   pay through the staking contract and never show up here. Rewards are already in "Earned on top".
// - Third-party basic transfers are income: friends, apps ("Thanks for joining Cinima!"), the testnet faucet.

import { STAKING_CONTRACT, normalizeAddress } from './address'
import type { TxRow } from './cache'
import { AccountType, normalizeTimestamp } from './rpc'
import { decodeHtlcData } from './spending'

/** Nimiq Pay's swap service; also learned per wallet from its own swap HTLCs. Verified in tests/fixtures. */
export const KNOWN_SWAP_HUBS = ['NQ56 VE9K PV0Y TK4T QBMY 8E9G B85J QR6M MSHL']

export type IncomingKind =
  /** A basic transfer or a Pay vault payment from someone else: counts. */
  | 'received'
  /** Staking pool payout: shown, not counted unless the user says so. */
  | 'reward'
  /** From the wallet or one of its vaults (rotation, own vault older than the window). */
  | 'own'
  /** Swap HTLC refund or claim, or the swap service itself. */
  | 'swap'
  /** Released stake from the staking contract. */
  | 'unstake'
  | 'failed'
  | 'zero'
  /** From a contract whose creation we haven't read (yet): left out to be safe. */
  | 'unverified'

export interface IncomingTx {
  hash: string
  timestamp: number
  valueLuna: number
  from: string
  to: string
  kind: IncomingKind
  /** Why, in a few words (diagnostics and the trace script). */
  note: string
  /** The sender's message, when it is printable text. */
  message?: string
}

/** What an HTLC's creation tx says about it. null = creation not in the fetched history. */
export interface HtlcOrigin {
  sender: string
  recipient: string
  /** All-zero hash root: a Nimiq Pay vault, only ever spent with both signatures. */
  vault: boolean
}

export interface IncomeContext {
  wallet: string
  vaults: Iterable<string>
  /** Swap HTLCs funded by the wallet or its vaults, with the hub they pay. */
  swaps?: Iterable<{ address: string; hub: string }>
  /** Validator addresses on this network (validators API). */
  validators?: Iterable<string>
  /** Creation data of foreign HTLCs that paid in; missing = not looked up yet. */
  htlcOrigins?: Record<string, HtlcOrigin | null>
}

/** Pure: read an HTLC's origin from its own history (the creation tx is the one INTO it with the contract flag). */
export function htlcOriginFromRows(address: string, rows: Pick<TxRow, 'to' | 'toType' | 'flags' | 'recipientData'>[]): HtlcOrigin | null {
  const creation = rows.find((r) => r.to === address && r.toType === AccountType.Htlc && (r.flags & 1) === 1)
  const d = creation && decodeHtlcData(creation.recipientData)
  return d ? { sender: d.sender, recipient: d.recipient, vault: /^0+$/.test(d.hashRoot) } : null
}

/** Printable UTF-8 message from recipientData, or undefined (binary data, contract creation data, empty). */
export function decodeMessage(hex: string): string | undefined {
  if (!hex || hex.length % 2 || !/^[0-9a-f]+$/i.test(hex)) return undefined
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
  // Control characters mean binary data that happened to be valid UTF-8.
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u0008\u000e-\u001f\u007f]/.test(text) ? undefined : text.trim() || undefined
}

/** Foreign HTLC senders of incoming rows that still need their creation data read. */
export function htlcsToLookUp(rows: TxRow[], ctx: IncomeContext, sinceMs: number): string[] {
  const own = ownSet(ctx)
  const swaps = new Set([...(ctx.swaps ?? [])].map((s) => s.address))
  const known = ctx.htlcOrigins ?? {}
  const out = new Set<string>()
  for (const r of rows) {
    if (!own.has(r.to) || own.has(r.from) || r.fromType !== AccountType.Htlc || !r.executionResult) continue
    if (normalizeTimestamp(r.timestamp) < sinceMs || swaps.has(r.from) || r.from in known) continue
    out.add(r.from)
  }
  return [...out]
}

const ownSet = (ctx: IncomeContext) => new Set([normalizeAddress(ctx.wallet), ...[...ctx.vaults].map(normalizeAddress)])

/** Pure: every tx INTO the wallet or a vault, newest first, deduped by hash. Outgoing txs are dropped. */
export function classifyIncoming(rows: TxRow[], ctx: IncomeContext): IncomingTx[] {
  const wallet = normalizeAddress(ctx.wallet)
  const own = ownSet(ctx)
  const swaps = new Set([...(ctx.swaps ?? [])].map((s) => s.address))
  const hubs = new Set([...KNOWN_SWAP_HUBS, ...[...(ctx.swaps ?? [])].map((s) => s.hub)])
  const validators = new Set([...(ctx.validators ?? [])].map(normalizeAddress))
  const origins = ctx.htlcOrigins ?? {}
  const seen = new Set<string>()
  const out: IncomingTx[] = []

  for (const r of rows) {
    if (!own.has(r.to) || seen.has(r.hash)) continue
    seen.add(r.hash)
    const { kind, note } = classifyOne(r, { wallet, own, swaps, hubs, validators, origins })
    out.push({ hash: r.hash, timestamp: normalizeTimestamp(r.timestamp), valueLuna: r.value, from: r.from, to: r.to, kind, note, message: decodeMessage(r.recipientData) })
  }
  return out.sort((a, b) => b.timestamp - a.timestamp)
}

interface Sets {
  wallet: string
  own: Set<string>
  swaps: Set<string>
  hubs: Set<string>
  validators: Set<string>
  origins: Record<string, HtlcOrigin | null>
}

function classifyOne(r: TxRow, s: Sets): { kind: IncomingKind; note: string } {
  if (!r.executionResult) return { kind: 'failed', note: 'failed on chain' }
  if (s.own.has(r.from)) return { kind: 'own', note: r.fromType === AccountType.Htlc ? 'vault rotation' : 'own transfer' }
  if (r.from === STAKING_CONTRACT || r.fromType === AccountType.Staking) return { kind: 'unstake', note: 'released from staking' }
  if (s.swaps.has(r.from)) return { kind: 'swap', note: 'swap refund' }
  if (s.hubs.has(r.from)) return { kind: 'swap', note: 'from the swap service' }
  if (r.value === 0) return { kind: 'zero', note: 'no value' }
  if (r.fromType === AccountType.Htlc) {
    if (!(r.from in s.origins)) return { kind: 'unverified', note: 'contract not checked yet' }
    const o = s.origins[r.from]
    if (!o) return { kind: 'unverified', note: 'contract creation not found' }
    if (o.sender === s.wallet) return { kind: 'own', note: o.vault ? 'own older vault' : 'own swap refund' }
    if (o.vault) return { kind: 'received', note: 'from a Nimiq Pay user' }
    return { kind: 'swap', note: 'swap claim' }
  }
  if (s.validators.has(r.from)) return { kind: 'reward', note: 'staking pool payout' }
  return { kind: 'received', note: 'transfer' }
}

/** Relabel received payments from a validator address as rewards (validators load after the trace). */
export function withRewards(incoming: IncomingTx[], validators: Iterable<string>): IncomingTx[] {
  const v = new Set([...validators].map(normalizeAddress))
  if (!v.size) return incoming
  return incoming.map((i) => (i.kind === 'received' && v.has(i.from) ? { ...i, kind: 'reward', note: 'staking pool payout' } : i))
}
