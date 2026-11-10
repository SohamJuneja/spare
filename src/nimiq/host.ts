// Thin wrapper over @nimiq/mini-app-sdk. Never throws outside Nimiq Pay; callers get typed results.
import { Fiat, getHostFiat, getHostLanguage, getHostNetwork, init, NimiqProviderError, type NimiqProvider } from '@nimiq/mini-app-sdk'
import { normalizeAddress } from '../chain/address'
import type { Network } from '../chain/rpc'
import { updateDiag } from '../diagnostics'
import { classifyWalletError } from '../sweep'

export interface HostInfo {
  insideNimiqPay: boolean
  network: Network
  fiat: string
  language: string
}

export interface ConnectedAccounts {
  walletAddress: string
  /** Current vault. Null for a fresh wallet that never received NIM. */
  htlcAddress: string | null
}

export type ConnectResult =
  | { ok: true; accounts: ConnectedAccounts }
  | { ok: false; reason: 'not-in-nimiq-pay' | 'rejected' | 'no-accounts' | 'error'; message: string }

/** Nimiq Pay seeds window.nimiqPay before page scripts run, so this is reliable synchronously. */
export function getHost(): HostInfo {
  const insideNimiqPay = typeof window !== 'undefined' && (!!window.nimiqPay || !!window.nimiq)
  return {
    insideNimiqPay,
    network: getHostNetwork() ?? 'mainnet',
    fiat: getHostFiat() ?? Fiat.USD,
    language: getHostLanguage() ?? 'en',
  }
}

type AccountsListener = (accounts: ConnectedAccounts) => void
const listeners = new Set<AccountsListener>()
let provider: NimiqProvider | null = null

/** Subscribe to vault rotations (Nimiq Pay replaces the HTLC about every 7 days). Returns an unsubscribe fn. */
export function onAccountsChanged(listener: AccountsListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function toAccounts(list: string[]): ConnectedAccounts | null {
  const [wallet, htlc] = list
  if (!wallet) return null
  return { walletAddress: normalizeAddress(wallet), htlcAddress: htlc ? normalizeAddress(htlc) : null }
}

/** Waits for the host provider and asks for account access (shows a native approval dialog). Call from a user action. */
export async function connect(): Promise<ConnectResult> {
  if (!getHost().insideNimiqPay) {
    return { ok: false, reason: 'not-in-nimiq-pay', message: 'Open Spare in Nimiq Pay to connect your wallet.' }
  }
  try {
    if (!provider) {
      const t0 = performance.now()
      try {
        provider = await init({ timeout: 10_000 })
      } catch (error) {
        updateDiag((d) => (d.sdkInitError = error instanceof Error ? error.message : String(error)))
        throw error
      } finally {
        updateDiag((d) => (d.sdkInitMs = Math.round(performance.now() - t0)))
      }
      provider.on('accountsChanged', (list: string[]) => {
        updateDiag((d) => d.accountsChanged.push({ at: Date.now(), accounts: list }))
        const accounts = toAccounts(list)
        if (accounts) for (const l of listeners) l(accounts)
      })
    }
    let list: string[]
    try {
      list = await provider.listAccounts()
      updateDiag((d) => (d.listAccounts = { at: Date.now(), result: list }))
    } catch (error) {
      updateDiag((d) => (d.listAccounts = { at: Date.now(), error: NimiqProviderError.is(error) ? `${error.type}: ${error.message}` : String(error) }))
      throw error
    }
    const accounts = toAccounts(list)
    if (!accounts) return { ok: false, reason: 'no-accounts', message: 'Nimiq Pay returned no accounts.' }
    return { ok: true, accounts }
  } catch (error) {
    if (NimiqProviderError.is(error)) {
      const rejected = classifyWalletError(error).kind === 'rejected'
      return { ok: false, reason: rejected ? 'rejected' : 'error', message: `${error.type}: ${error.message}` }
    }
    // init() rejects with a plain Error when the provider never appears within the timeout.
    return { ok: false, reason: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}

/** The provider after a successful connect(); null before. */
export function getProvider(): NimiqProvider | null {
  return provider
}

/**
 * Read-only balances through the host (no approval dialog, no public-RPC budget). A failed read is null,
 * never 0. Older hosts lack getBalance.
 */
export async function getBalances(accounts: ConnectedAccounts): Promise<{ wallet: number | null; htlc: number | null; supported: boolean }> {
  const p = provider
  if (!p || typeof (p as { getBalance?: unknown }).getBalance !== 'function') return { wallet: null, htlc: null, supported: false }
  const read = (a: string | null) =>
    a
      ? p.getBalance(a).then(
          (n) => (Number.isSafeInteger(n) && n >= 0 ? n : null),
          () => null,
        )
      : Promise.resolve(null)
  const [wallet, htlc] = await Promise.all([read(accounts.walletAddress), read(accounts.htlcAddress)])
  return { wallet, htlc, supported: true }
}
