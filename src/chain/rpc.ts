// JSON-RPC client for the public nimiqwatch Albatross RPC.
// Types derived from real responses saved in tests/fixtures/ (see scripts/capture-fixtures.ts).

export type Network = 'mainnet' | 'testnet'

export const RPC_URLS: Record<Network, string> = {
  mainnet: 'https://rpc.nimiqwatch.com',
  testnet: 'https://rpc.testnet.nimiqwatch.com',
}

/** Account type codes used in fromType/toType. */
export const AccountType = { Basic: 0, Vesting: 1, Htlc: 2, Staking: 3 } as const

/** One item of getTransactionsByAddress `result.data`. Values in luna, timestamp in ms (see normalizeTimestamp). */
export interface RpcTransaction {
  hash: string
  blockNumber: number
  timestamp: number
  confirmations: number
  size: number
  relatedAddresses: string[]
  from: string
  fromType: number
  to: string
  toType: number
  value: number
  fee: number
  senderData: string
  /** For HTLC creation (toType 2, flags 1): 82-byte hex of sender|recipient|algo|root|count|timeout. */
  recipientData: string
  /** 1 = contract creation */
  flags: number
  validityStartHeight: number
  proof: string
  networkId: number
  /** false = included in a block but failed; only the fee was charged. */
  executionResult: boolean
}

export interface RpcBasicAccount {
  address: string
  balance: number
  type: 'basic'
}

export interface RpcHtlcAccount {
  address: string
  balance: number
  type: 'htlc'
  sender: string
  recipient: string
  hashRoot: { algorithm: string; hash: string }
  hashCount: number
  timeout: number
  totalAmount: number
}

/** Pruned/expired HTLCs come back as `basic` with balance 0. */
export type RpcAccount = RpcBasicAccount | RpcHtlcAccount | { address: string; balance: number; type: string; [k: string]: unknown }

interface RpcEnvelope<T> {
  jsonrpc: '2.0'
  id: number
  result?: { data: T; metadata: unknown }
  error?: { code: number; message: string; data?: unknown }
}

export class RpcError extends Error {
  readonly method: string
  readonly code?: number
  constructor(message: string, method: string, code?: number) {
    super(message)
    this.name = 'RpcError'
    this.method = method
    this.code = code
  }
}

/** Some migrated pre-Albatross txs carry second-resolution timestamps. */
export function normalizeTimestamp(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts
}

const MAX_RATE_LIMIT_WAIT_MS = 65_000

export interface RpcClientOptions {
  timeoutMs?: number
  /** The public endpoint drops parallel bursts; keep this low. */
  maxConcurrent?: number
  fetchImpl?: typeof fetch
}

export function createRpcClient(network: Network, opts: RpcClientOptions = {}) {
  const url = RPC_URLS[network]
  const timeoutMs = opts.timeoutMs ?? 15_000
  const maxConcurrent = opts.maxConcurrent ?? 2
  const doFetch = opts.fetchImpl ?? fetch.bind(globalThis)
  let active = 0
  const waiting: (() => void)[] = []
  let nextId = 1
  // nimiqwatch allows ~20 requests per window and reports X-Ratelimit-Remaining/-Reset (epoch s).
  // Browsers may hide these headers (CORS), in which case we only react to 429s.
  let pausedUntil = 0

  function noteRateLimit(res: Response) {
    const remaining = Number(res.headers.get('x-ratelimit-remaining'))
    const reset = Number(res.headers.get('x-ratelimit-reset'))
    if (res.headers.has('x-ratelimit-remaining') && remaining <= 0 && reset > 0) pausedUntil = Math.max(pausedUntil, reset * 1000 + 250)
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after'))
      const until = reset > 0 ? reset * 1000 + 250 : Date.now() + (retryAfter > 0 ? retryAfter * 1000 : 15_000)
      pausedUntil = Math.max(pausedUntil, Math.min(until, Date.now() + MAX_RATE_LIMIT_WAIT_MS))
    }
  }

  async function waitForRateLimit() {
    const ms = pausedUntil - Date.now()
    if (ms > 0) await new Promise((r) => setTimeout(r, ms))
  }

  async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) await new Promise<void>((r) => waiting.push(r))
    active++
    try {
      return await fn()
    } finally {
      active--
      waiting.shift()?.()
    }
  }

  async function once<T>(method: string, params: unknown[]): Promise<T> {
    await waitForRateLimit()
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
        signal: ctrl.signal,
      })
      noteRateLimit(res)
      if (res.status === 429) throw new RpcError(`Rate limited by ${url}`, method, 429)
      if (!res.ok) throw new RpcError(`HTTP ${res.status} from ${url}`, method, res.status)
      const body = (await res.json()) as RpcEnvelope<T>
      if (body.error) throw new RpcError(`${body.error.message}${body.error.data ? `: ${String(body.error.data)}` : ''}`, method, body.error.code)
      if (!body.result) throw new RpcError('Empty RPC result', method)
      return body.result.data
    } catch (e) {
      if (e instanceof RpcError) throw e
      if (e instanceof Error && e.name === 'AbortError') throw new RpcError(`Timed out after ${timeoutMs}ms`, method)
      throw new RpcError(e instanceof Error ? e.message : String(e), method)
    } finally {
      clearTimeout(timer)
    }
  }

  async function call<T>(method: string, params: unknown[]): Promise<T> {
    return withSlot(async () => {
      try {
        return await once<T>(method, params)
      } catch (e) {
        // JSON-RPC param errors are deterministic; don't retry those.
        if (e instanceof RpcError && e.code === -32602) throw e
        // once() waits out a 429 pause itself; otherwise a short backoff.
        if (!(e instanceof RpcError && e.code === 429)) await new Promise((r) => setTimeout(r, 750))
        return once<T>(method, params)
      }
    })
  }

  /** One page, newest first. `startAt` is an exclusive tx hash cursor. */
  function getTransactionsByAddress(address: string, max = 500, startAt?: string): Promise<RpcTransaction[]> {
    return call<RpcTransaction[]>('getTransactionsByAddress', [address, max, startAt ?? null])
  }

  /** Pages back until a tx is older than `sinceMs` (or history ends). */
  async function getTransactionsSince(address: string, sinceMs: number, pageSize = 500, maxPages = 20): Promise<RpcTransaction[]> {
    const all: RpcTransaction[] = []
    let cursor: string | undefined
    for (let page = 0; page < maxPages; page++) {
      const batch = await getTransactionsByAddress(address, pageSize, cursor)
      all.push(...batch)
      if (batch.length < pageSize) break
      const last = batch[batch.length - 1]
      if (normalizeTimestamp(last.timestamp) < sinceMs) break
      cursor = last.hash
    }
    return all
  }

  function getAccountByAddress(address: string): Promise<RpcAccount> {
    return call<RpcAccount>('getAccountByAddress', [address])
  }

  return { url, getTransactionsByAddress, getTransactionsSince, getAccountByAddress }
}

export type RpcClient = ReturnType<typeof createRpcClient>
