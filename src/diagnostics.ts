// In-memory diagnostics for on-device testing. Rendered by the debug page and copied as plain text.
import type { VaultRecord } from './chain/cache'
import type { SwapRecord, TraceStats } from './chain/spending'

export interface Diagnostics {
  sdkInitMs: number | null
  sdkInitError: string | null
  listAccounts: { at: number; result?: string[]; error?: string } | null
  accountsChanged: { at: number; accounts: string[] }[]
  rpcUrl: string | null
  network: string | null
  trace: {
    wallet: string
    at: number
    vaults: VaultRecord[]
    swaps: SwapRecord[]
    cosigners: string[]
    stats: TraceStats
  } | null
  /** Cumulative over the session, from the RPC client. */
  rpcTotals: { requests: number; throttled429: number; waitedMs: number }
  priceSources: string[]
  errors: { at: number; message: string }[]
}

export const diag: Diagnostics = {
  sdkInitMs: null,
  sdkInitError: null,
  listAccounts: null,
  accountsChanged: [],
  rpcUrl: null,
  network: null,
  trace: null,
  rpcTotals: { requests: 0, throttled429: 0, waitedMs: 0 },
  priceSources: [],
  errors: [],
}

const listeners = new Set<() => void>()
export function onDiagnostics(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function updateDiag(patch: (d: Diagnostics) => void) {
  patch(diag)
  for (const l of listeners) l()
}

const iso = (ms: number) => new Date(ms).toISOString()
const short = (h: string) => `${h.slice(0, 12)}…`

/** window.nimiqPay as plain fields; functions are listed by name only. */
export function rawNimiqPay(): Record<string, unknown> | null {
  if (typeof window === 'undefined' || !window.nimiqPay) return null
  const out: Record<string, unknown> = {}
  const src = window.nimiqPay as unknown as Record<string, unknown>
  for (const key of Object.keys(src)) out[key] = typeof src[key] === 'function' ? '[function]' : src[key]
  return out
}

export function vaultReason(v: VaultRecord): string {
  return (
    `funded by ${v.fundedBy} in ${short(v.fundingHash)} at ${iso(v.createdAt)}; ` +
    `HTLC sender = wallet, hashRoot = 32 zero bytes; cosigner ${v.cosigner}; timeout ${iso(v.timeoutMs)}; depth ${v.depth}`
  )
}

export function diagnosticsText(host: object): string {
  const d = diag
  const lines: string[] = []
  lines.push(`Spare diagnostics @ ${iso(Date.now())}`)
  lines.push(`userAgent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'}`)
  lines.push(`location: ${typeof location !== 'undefined' ? location.href : 'n/a'}`)
  lines.push(`getHost(): ${JSON.stringify(host)}`)
  lines.push(`window.nimiqPay: ${JSON.stringify(rawNimiqPay())}`)
  lines.push(`window.nimiq present: ${typeof window !== 'undefined' && !!window.nimiq}`)
  lines.push(`SDK init: ${d.sdkInitMs !== null ? `${d.sdkInitMs}ms` : 'not run'}${d.sdkInitError ? ` (error: ${d.sdkInitError})` : ''}`)
  lines.push(
    `listAccounts: ${d.listAccounts ? `${iso(d.listAccounts.at)} ${d.listAccounts.error ? `ERROR ${d.listAccounts.error}` : JSON.stringify(d.listAccounts.result)}` : 'not called'}`,
  )
  lines.push(`accountsChanged events: ${d.accountsChanged.length}`)
  for (const e of d.accountsChanged) lines.push(`  ${iso(e.at)} ${JSON.stringify(e.accounts)}`)
  lines.push(`RPC: ${d.rpcUrl ?? 'n/a'} (${d.network ?? '?'})`)
  lines.push(`RPC session totals: ${d.rpcTotals.requests} requests, ${d.rpcTotals.throttled429}×429, waited ${d.rpcTotals.waitedMs}ms`)
  if (d.trace) {
    const t = d.trace
    lines.push(`Last trace: ${t.wallet} @ ${iso(t.at)}`)
    lines.push(`  requests ${t.stats.requests}, 429s ${t.stats.throttled429}, waited ${t.stats.waitedMs}ms, load ${t.stats.loadMs}ms, final vaults skipped ${t.stats.skippedFinal}`)
    lines.push(`  cosigner(s) seen on ${d.network}: ${t.cosigners.join(', ') || 'none'}`)
    lines.push(`  vaults (${t.vaults.length}):`)
    for (const v of t.vaults) lines.push(`    ${v.address}: ${vaultReason(v)}`)
    lines.push(`  swap HTLCs (${t.swaps.length}) — sender = wallet but real hash lock:`)
    for (const s of t.swaps) lines.push(`    ${s.address}: hub ${s.hub}, funded by ${s.fundedBy} in ${short(s.fundingHash)}, status ${s.status}`)
  } else {
    lines.push('Last trace: none')
  }
  lines.push(`Prices: ${d.priceSources.join('; ') || 'not loaded'}`)
  lines.push(`Errors (${d.errors.length}):`)
  for (const e of d.errors) lines.push(`  ${iso(e.at)} ${e.message}`)
  return lines.join('\n')
}
