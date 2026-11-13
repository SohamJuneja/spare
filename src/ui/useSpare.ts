// One controller for the whole app: data loading, derived numbers, and wallet actions.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createStore, loadSpendStatus, saveSpendStatus, type SpendStatusData } from '../chain/cache'
import { withRewards } from '../chain/income'
import { createRpcClient, type Network, type RpcClient } from '../chain/rpc'
import { cachedTrace, traceWallet, type WalletTrace } from '../chain/spending'
import { updateDiag } from '../diagnostics'
import { buildIncomeItems, isIncomePct, nextIncomeRule, previewSlices, RULE_OFF, SUGGESTED_PCT, toggleCounted, type IncomePct, type IncomeRule } from '../income-rule'
import { connect, getBalances, getHost, getProvider, onAccountsChanged, type ConnectedAccounts } from '../nimiq/host'
import { dayKey, getPriceTable, type FiatCode, type PriceTable } from '../prices'
import { minimumProgress, newSinceLastSweep, weekStreak } from '../progress'
import { buildRoundUps, DEFAULT_STEP, getSweepQuote, type Multiplier } from '../roundup'
import {
  canStartSweep,
  earnedOnTop,
  executeSweep,
  fetchValidators,
  loadSweeps,
  lockedItemHashes,
  pickAffordable,
  pickDefaultValidator,
  planRoute,
  savedWithSpare,
  settleSweep,
  spendableLuna,
  splitItemsLuna,
  sweptMarks,
  toStakerInfo,
  type StakerInfo,
  type SweepDeps,
  type SweepRecord,
  type ValidatorRow,
} from '../sweep'

export const host = getHost()
export const store = createStore()
export const FIATS: FiatCode[] = ['USD', 'EUR', 'CRC', 'GMD']
export const fiat: FiatCode = (FIATS as string[]).includes(host.fiat) ? (host.fiat as FiatCode) : 'USD'
export const WINDOW_DAYS = 30
/**
 * Real, public Nimiq Pay wallets on mainnet, best first (picked by scripts/find-sample.ts). Shown only as
 * "Sample", never as a person. If one has no payments in the window, the next one is used.
 */
export const SAMPLE_WALLETS = [
  // 22 ordinary payments of 100–300 NIM + 1 Lightning/swap in the 30 days to Nov 11 2026; quote ≈ 1,117 NIM.
  'NQ45 57M8 9VMC 16NL 31D0 99M1 YX9Y HC1D NVKU',
  // 9 payments + 2 Lightning/swap; quote ≈ 1,623 NIM.
  'NQ20 MJRQ T2E8 3218 9XY3 QAS3 3LGG D7KE 69MU',
  // Original sample (Lightning/swap only), kept as the last fallback.
  'NQ51 DE7S FX74 A8BL L7GK EYGB YVPF UK6C 8DXT',
]
export const SAMPLE_NETWORK: Network = 'mainnet'

export type Mode = { kind: 'welcome' } | { kind: 'connected'; accounts: ConnectedAccounts } | { kind: 'sample' }

export interface Settings {
  maxStep: number
  multiplier: Multiplier
  pool: string | null
}

export type SweepPhase =
  | { phase: 'idle' }
  | { phase: 'approval' }
  | { phase: 'confirming'; record: SweepRecord }
  | { phase: 'checking'; record: SweepRecord }
  | { phase: 'success'; record: SweepRecord }
  | { phase: 'failed'; record: SweepRecord }
  | { phase: 'rejected' }
  | { phase: 'blocked' }

export interface ChainInfo {
  balances: { wallet: number | null; htlc: number | null; supported: boolean }
  staker: StakerInfo | null
}

let setThrottledGlobal: (t: boolean) => void = () => {}
const rpcs: Partial<Record<Network, RpcClient>> = {}
export function rpcFor(network: Network): RpcClient {
  rpcs[network] ??= createRpcClient(network, { onThrottle: (t) => setThrottledGlobal(t) })
  return rpcs[network]!
}

const settingsKey = `settings:${fiat}`
const incomeRuleKey = (network: Network, wallet: string) => `${network}:${wallet}:incomeRule`
/** Per-device UI flags (not per wallet). */
const WHATS_NEW_KEY = 'device:whatsNew:v1.1:dismissed'
const INCOME_PROMPT_KEY = 'device:incomePrompt:dismissed'

/** Off for anyone who hasn't chosen: no back-dated surprises for existing users. */
function loadIncomeRule(network: Network, wallet: string): IncomeRule {
  const r = store.get<Partial<IncomeRule>>(incomeRuleKey(network, wallet))
  return r && isIncomePct(r.pct) && r.pct > 0 && typeof r.since === 'number' ? { pct: r.pct, since: r.since } : RULE_OFF
}
function loadSettings(): Settings {
  return { maxStep: DEFAULT_STEP[fiat], multiplier: 1, pool: null, ...store.get<Partial<Settings>>(settingsKey) }
}

export function explorerTx(network: Network, hash: string): string {
  return `${network === 'testnet' ? 'https://test.nimiq.watch' : 'https://nimiq.watch'}/#${hash}`
}

export function openInPayLink(): string {
  return `https://nimpay.app/miniapps/open/${location.host}`
}

export function useSpare() {
  const [mode, setMode] = useState<Mode>({ kind: 'welcome' })
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<{ rejected: boolean; message: string } | null>(null)
  const [trace, setTrace] = useState<WalletTrace | null>(null)
  const [historyState, setHistoryState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [throttled, setThrottled] = useState(false)
  const [table, setTable] = useState<PriceTable | null>(null)
  const [priceError, setPriceError] = useState(false)
  const [info, setInfo] = useState<ChainInfo | null>(null)
  const [infoError, setInfoError] = useState(false)
  const [validators, setValidators] = useState<ValidatorRow[]>([])
  const [settings, setSettingsState] = useState<Settings>(loadSettings)
  const [status, setStatus] = useState<SpendStatusData>({ excluded: [], swept: [] })
  const [sweeps, setSweeps] = useState<SweepRecord[]>([])
  const [sweepUi, setSweepUi] = useState<SweepPhase>({ phase: 'idle' })
  const [sampleIndex, setSampleIndex] = useState(0)
  const [validatorsError, setValidatorsError] = useState(false)
  const [incomeRule, setIncomeRuleState] = useState<IncomeRule>(RULE_OFF)
  /** The sample never stores anything: its % only changes the "would have saved" view. */
  const [samplePct, setSamplePct] = useState<IncomePct>(SUGGESTED_PCT)
  const [whatsNewDismissed, setWhatsNewDismissed] = useState(() => !!store.get<boolean>(WHATS_NEW_KEY))
  const [incomePromptDismissed, setIncomePromptDismissed] = useState(() => !!store.get<boolean>(INCOME_PROMPT_KEY))
  setThrottledGlobal = setThrottled

  const wallet = mode.kind === 'connected' ? mode.accounts.walletAddress : mode.kind === 'sample' ? SAMPLE_WALLETS[sampleIndex] : null
  const network: Network = mode.kind === 'sample' ? SAMPLE_NETWORK : host.network
  const rpc = rpcFor(network)
  const runId = useRef(0)

  // ---- history ----
  const loadHistory = useCallback(async () => {
    if (!wallet) return
    const id = ++runId.current
    const cached = cachedTrace(wallet, WINDOW_DAYS, { network, store })
    if (cached) setTrace(cached)
    setHistoryState('loading')
    updateDiag((d) => {
      d.rpcUrl = rpc.url
      d.network = network
    })
    try {
      const t = await traceWallet(wallet, WINDOW_DAYS, { network, rpc, store })
      if (id !== runId.current) return
      setTrace(t)
      setHistoryState('ready')
      updateDiag((d) => {
        d.trace = {
          wallet: t.wallet,
          at: Date.now(),
          vaults: t.vaultRecords,
          swaps: t.swaps,
          cosigners: t.cosigners,
          stats: t.stats,
          incoming: t.incoming.map(({ hash, from, kind, note, valueLuna }) => ({ hash, from, kind, note, valueLuna })),
        }
        d.rpcTotals = { ...rpc.stats }
      })
    } catch (e) {
      if (id !== runId.current) return
      setHistoryState('error')
      updateDiag((d) => {
        d.errors.push({ at: Date.now(), message: `history: ${e instanceof Error ? e.message : String(e)}` })
        d.rpcTotals = { ...rpc.stats }
      })
    }
  }, [wallet, network, rpc])

  useEffect(() => {
    setTrace(null)
    setTable(null)
    setInfo(null)
    if (!wallet) {
      setHistoryState('idle')
      return
    }
    setStatus(loadSpendStatus(store, network, wallet))
    setIncomeRuleState(loadIncomeRule(network, wallet))
    setSweeps(loadSweeps(store, network, wallet))
    void loadHistory()
  }, [wallet, network, loadHistory])

  // An empty sample would explain nothing: fall back to the next sample wallet.
  useEffect(() => {
    if (mode.kind === 'sample' && historyState === 'ready' && trace?.spends.length === 0 && sampleIndex < SAMPLE_WALLETS.length - 1) setSampleIndex((i) => i + 1)
  }, [mode.kind, historyState, trace, sampleIndex])

  // ---- prices (need the spend days, and the days of payments received) ----
  const dayList = useMemo(
    () =>
      trace
        ? [...new Set([...trace.spends, ...trace.incoming.filter((i) => i.kind === 'received' || i.kind === 'reward')].map((s) => dayKey(s.timestamp)))].sort().join(',')
        : null,
    [trace],
  )
  const loadPrices = useCallback(async () => {
    if (dayList === null) return
    setPriceError(false)
    try {
      const tbl = await getPriceTable(fiat, dayList ? dayList.split(',') : [], { store })
      setTable(tbl)
      updateDiag((d) => (d.priceSources = tbl.sources))
    } catch (e) {
      setPriceError(true)
      updateDiag((d) => d.errors.push({ at: Date.now(), message: `prices: ${e instanceof Error ? e.message : String(e)}` }))
    }
  }, [dayList])
  useEffect(() => {
    void loadPrices()
  }, [loadPrices])

  // ---- validators (pool list; also shown in the sample) ----
  useEffect(() => {
    if (!wallet) return
    // Retry a few times: the validators API can be slow or briefly down, and a first stake needs a pool.
    let alive = true
    setValidatorsError(false)
    void (async () => {
      for (let attempt = 0; attempt < 4 && alive; attempt++) {
        try {
          const rows = await fetchValidators(network, store)
          if (!alive) return
          setValidators(rows)
          setSettingsState((s) => (s.pool && rows.some((r) => r.address === s.pool) ? s : { ...s, pool: pickDefaultValidator(rows)?.address ?? null }))
          return
        } catch (e) {
          updateDiag((d) => d.errors.push({ at: Date.now(), message: `validators (attempt ${attempt + 1}): ${String(e)}` }))
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
        }
      }
      if (alive) setValidatorsError(true)
    })()
    return () => {
      alive = false
    }
  }, [wallet, network])

  // ---- balance + staker (connected only; read-only, no dialog) ----
  const accounts = mode.kind === 'connected' ? mode.accounts : null
  const loadInfo = useCallback(async () => {
    if (!wallet) return
    setInfoError(false)
    try {
      const [balances, staker] = await Promise.all([
        accounts ? getBalances(accounts) : Promise.resolve({ wallet: null, htlc: null, supported: false }),
        rpc.getStakerByAddress(wallet).then(toStakerInfo),
      ])
      setInfo({ balances, staker })
    } catch (e) {
      setInfoError(true)
      updateDiag((d) => d.errors.push({ at: Date.now(), message: `balance/staker: ${String(e)}` }))
    }
  }, [wallet, accounts?.walletAddress, accounts?.htlcAddress, rpc])
  useEffect(() => {
    void loadInfo()
  }, [loadInfo])

  useEffect(
    () =>
      onAccountsChanged((a) => {
        setMode((m) => (m.kind === 'connected' ? { kind: 'connected', accounts: a } : m))
      }),
    [],
  )

  // ---- sweeps ----
  const deps = useCallback(
    (): SweepDeps | null =>
      wallet && mode.kind === 'connected'
        ? {
            provider: getProvider() ?? {
              sendNewStakerTransaction: () => Promise.reject(new Error('Not connected')),
              sendStakeTransaction: () => Promise.reject(new Error('Not connected')),
            },
            rpc,
            store,
            network,
            wallet,
            ownAddresses: [...new Set([wallet, ...(trace?.vaults ?? []), ...(accounts?.htlcAddress ? [accounts.htlcAddress] : [])])],
            onUpdate: (r) => {
              setSweeps(loadSweeps(store, network, wallet))
              setSweepUi((ui) => (ui.phase === 'idle' ? ui : phaseFor(r)))
              updateDiag((d) => d.errors.push({ at: Date.now(), message: `sweep ${r.id}: ${r.status}${r.txHash ? ` ${r.txHash}` : ''}${r.error ? ` (${r.error})` : ''}` }))
            },
          }
        : null,
    [wallet, mode.kind, rpc, network, trace?.vaults, accounts?.htlcAddress],
  )

  // Resume unsettled sweeps from an earlier session (chain reads only).
  useEffect(() => {
    const d = deps()
    if (!d || !wallet) return
    for (const r of loadSweeps(store, network, wallet)) {
      if (r.status === 'sending' || r.status === 'submitted' || r.status === 'checking') void settleSweep(d, r).then(() => setSweeps(loadSweeps(store, network, wallet)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, mode.kind])

  // ---- derived ----
  const marks = useMemo(() => sweptMarks(sweeps), [sweeps])
  const locked = useMemo(() => lockedItemHashes(sweeps), [sweeps])
  const items = useMemo(
    () => (trace && table ? buildRoundUps(trace.spends, table, { maxStep: settings.maxStep, multiplier: settings.multiplier }, { excluded: status.excluded, swept: [...marks.keys(), ...locked] }) : null),
    [trace, table, settings.maxStep, settings.multiplier, status.excluded, marks, locked],
  )
  // Pool payouts are only told apart once the validator list is in; until then no slices (never a reward counted by mistake).
  const incomeReady = validators.length > 0 || validatorsError
  const sample = mode.kind === 'sample'
  const ruleSince = sample ? (trace?.sinceMs ?? null) : incomeRule.since
  const rulePct: IncomePct = sample ? samplePct : incomeRule.pct
  const rule = useMemo<IncomeRule>(() => (rulePct > 0 && ruleSince !== null ? { pct: rulePct, since: ruleSince } : RULE_OFF), [rulePct, ruleSince])
  const incoming = useMemo(() => (trace ? withRewards(trace.incoming, validators.map((v) => v.address)) : null), [trace, validators])
  const incomeItems = useMemo(
    () =>
      rule.pct === 0
        ? []
        : incoming && table && incomeReady
          ? buildIncomeItems(incoming, table, rule, { excluded: status.excluded, included: status.included, swept: [...marks.keys(), ...locked] })
          : null,
    [incoming, table, incomeReady, rule, status.excluded, status.included, marks, locked],
  )
  /** Connected only, preview only: totals over the whole window, never items, so never in the quote. */
  const incomePreview = useCallback(
    (pct: IncomePct) =>
      mode.kind === 'connected' && incoming && table && incomeReady && trace
        ? previewSlices(incoming, table, pct, trace.sinceMs, { excluded: status.excluded, included: status.included })
        : null,
    [mode.kind, incoming, table, incomeReady, trace, status.excluded, status.included],
  )
  // The sample's slices are hypothetical ("would have saved"), so they never join its quote.
  const quoteItems = useMemo(() => (items ? [...items, ...(sample ? [] : (incomeItems ?? []))] : null), [items, incomeItems, sample])
  const quote = useMemo(() => (quoteItems && table ? getSweepQuote(fiat, quoteItems, table.current) : null), [quoteItems, table])
  const spendable = info && accounts ? spendableLuna(info.balances) : null
  const partial = quote && spendable !== null && table?.current && quote.luna > spendable ? pickAffordable(quote.items, spendable, table.current.price) : null
  const plan = quote ? (partial ?? { items: quote.items, luna: quote.luna, fiat: quote.fiatTotal }) : null
  const route = plan ? planRoute(plan.luna, info?.staker ?? null) : null
  // Connected: wait for the staker read, or a staker would briefly look like a first-timer.
  const minimum = !quote ? null : mode.kind === 'sample' ? minimumProgress(quote.luna, null) : info ? minimumProgress(quote.luna, info.staker) : null
  const canAffordMinimum = minimum ? spendable !== null && spendable >= minimum.startLuna : false
  const saved = savedWithSpare(sweeps)
  const earned = earnedOnTop(info?.staker ?? null, sweeps)
  // Read from the chain, so it is right on any device (unlike the local sweep history).
  const stakeLuna = info?.staker ? info.staker.active + info.staker.inactive + info.staker.retired : info ? 0 : null
  const stakeFiat = stakeLuna !== null && table?.current ? (stakeLuna / 1e5) * table.current.price : null
  const hasLocalHistory = sweeps.some((r) => r.status === 'confirmed')
  const streak = weekStreak(sweeps, Date.now())
  const fresh = trace ? newSinceLastSweep(trace.spends, sweeps) : null
  const gate = canStartSweep(sweeps)
  const pool = validators.find((v) => v.address === (info?.staker?.delegation ?? settings.pool)) ?? null

  // ---- actions ----
  async function doConnect() {
    setConnecting(true)
    setConnectError(null)
    const res = await connect()
    setConnecting(false)
    if (res.ok) setMode({ kind: 'connected', accounts: res.accounts })
    else setConnectError({ rejected: res.reason === 'rejected', message: res.message })
  }

  function setSettings(patch: Partial<Settings>) {
    setSettingsState((s) => {
      const next = { ...s, ...patch }
      store.set(settingsKey, next)
      return next
    })
  }

  /** "Not counted" toggle. Rewards start out not counted, so for them the toggle opts in instead. */
  function toggleExcluded(hash: string, defaultExcluded = false) {
    if (!wallet) return
    const next = toggleCounted(status, hash, defaultExcluded)
    saveSpendStatus(store, network, wallet, next)
    setStatus(next)
  }

  function setIncomePct(pct: IncomePct) {
    if (sample) return setSamplePct(pct)
    if (!wallet) return
    const next = nextIncomeRule(incomeRule, pct, Date.now())
    store.set(incomeRuleKey(network, wallet), next)
    setIncomeRuleState(next)
  }

  function dismissWhatsNew() {
    store.set(WHATS_NEW_KEY, true)
    setWhatsNewDismissed(true)
  }

  function dismissIncomePrompt() {
    store.set(INCOME_PROMPT_KEY, true)
    setIncomePromptDismissed(true)
  }

  /** `kind: 'min'` tops a first stake up to 100 NIM. Only ever called from a button press. */
  async function sweep(kind: 'quote' | 'min') {
    const d = deps()
    if (!d || !plan || !table?.current || !info) return
    const luna = kind === 'min' && minimum ? minimum.startLuna : plan.luna
    const r = planRoute(luna, info.staker)
    if (r.kind !== 'new' && r.kind !== 'add') return
    const delegation = r.kind === 'new' ? settings.pool : null
    if (r.kind === 'new' && !delegation) return
    // A starter sweep tops the round-ups up to 100 NIM; the extra is recorded apart, never as savings.
    const topUpLuna = kind === 'min' && quote ? Math.max(0, luna - quote.luna) : 0
    const swept = kind === 'min' && quote ? quote.items : plan.items
    // One tx for both: the part that came from slices is recorded so History can show the split.
    const { sliceLuna } = splitItemsLuna(luna - topUpLuna, swept)
    setSweepUi({ phase: 'approval' })
    const out = await executeSweep(d, {
      route: r.kind,
      delegation,
      luna,
      topUpLuna,
      sliceLuna,
      fiat: kind === 'min' && quote ? quote.fiatTotal : plan.fiat,
      fiatCode: fiat,
      price: table.current.price,
      priceTime: table.current.time,
      itemHashes: swept.map((i) => i.hash),
      stakeBefore: info.staker ? info.staker.active + info.staker.inactive + info.staker.retired : 0,
    })
    setSweeps(loadSweeps(store, network, wallet!))
    if (out.kind === 'rejected') setSweepUi({ phase: 'rejected' })
    else if (out.kind === 'blocked') setSweepUi({ phase: 'blocked' })
    else setSweepUi(phaseFor(out.record))
    void loadInfo()
  }

  return {
    mode,
    setMode,
    connecting,
    connectError,
    doConnect,
    wallet,
    network,
    trace,
    historyState,
    throttled,
    retryHistory: loadHistory,
    table,
    priceError,
    retryPrices: loadPrices,
    info,
    infoError,
    retryInfo: loadInfo,
    validators,
    validatorsError,
    pool,
    settings,
    setSettings,
    items,
    incomeItems,
    incomeRule: rule,
    incomePreview,
    setIncomePct,
    whatsNewDismissed,
    dismissWhatsNew,
    incomePromptDismissed,
    dismissIncomePrompt,
    quote,
    plan,
    partial,
    route,
    minimum,
    canAffordMinimum,
    spendable,
    saved,
    earned,
    stakeLuna,
    stakeFiat,
    hasLocalHistory,
    streak,
    fresh,
    gate,
    marks,
    locked,
    sweeps,
    toggleExcluded,
    sweep,
    sweepUi,
    closeSweep: () => setSweepUi({ phase: 'idle' }),
  }
}

function phaseFor(r: SweepRecord): SweepPhase {
  switch (r.status) {
    case 'sending':
      return { phase: 'approval' }
    case 'submitted':
      return { phase: 'confirming', record: r }
    case 'checking':
      return { phase: 'checking', record: r }
    case 'confirmed':
      return { phase: 'success', record: r }
    case 'failed':
      return { phase: 'failed', record: r }
  }
}

export type Spare = ReturnType<typeof useSpare>
