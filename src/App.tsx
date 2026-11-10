// Debug page for tasks 1–2: host info, accounts, spending, round-ups and diagnostics. Deliberately plain.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { isValidAddress, normalizeAddress } from './chain/address'
import { createStore, loadSpendStatus, saveSpendStatus, type SpendStatusData } from './chain/cache'
import { createRpcClient } from './chain/rpc'
import { cachedTrace, traceWallet, type WalletTrace } from './chain/spending'
import { diag, diagnosticsText, onDiagnostics, rawNimiqPay, updateDiag, vaultReason } from './diagnostics'
import { connect, getBalances, getHost, getProvider, onAccountsChanged, type ConnectedAccounts } from './nimiq/host'
import { dayKey, getPriceTable, type FiatCode, type PriceTable } from './prices'
import { buildRoundUps, DEFAULT_STEP, getSweepQuote, STEPS, type Multiplier, type RoundUpItem, type SweepQuote } from './roundup'
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
  sweptMarks,
  toStakerInfo,
  type StakerInfo,
  type SweepDeps,
  type SweepRecord,
  type ValidatorRow,
} from './sweep'

const host = getHost()
const store = createStore()
const FIATS: FiatCode[] = ['USD', 'EUR', 'CRC', 'GMD']
const hostFiat: FiatCode = (FIATS as string[]).includes(host.fiat) ? (host.fiat as FiatCode) : 'USD'
const nim = (luna: number) => (luna / 1e5).toLocaleString(host.language, { maximumFractionDigits: 5 })
const money = (x: number, fiat: FiatCode) => x.toLocaleString(host.language, { maximumFractionDigits: fiat === 'CRC' || fiat === 'GMD' ? 2 : 4 })

let setThrottled: (t: boolean) => void = () => {}
const rpc = createRpcClient(host.network, { onThrottle: (t) => setThrottled(t) })
updateDiag((d) => {
  d.rpcUrl = rpc.url
  d.network = host.network
})

type Load =
  | { state: 'idle' }
  | { state: 'loading'; cached: WalletTrace | null }
  | { state: 'error'; message: string; cached: WalletTrace | null }
  | { state: 'done'; trace: WalletTrace }

const shown = (l: Load) => (l.state === 'done' ? l.trace : l.state === 'idle' ? null : l.cached)

export default function App() {
  const [accounts, setAccounts] = useState<ConnectedAccounts | null>(null)
  const [connectMsg, setConnectMsg] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [pasted, setPasted] = useState('')
  const [days, setDays] = useState(30)
  const [load, setLoad] = useState<Load>({ state: 'idle' })
  const [throttled, setThrottledState] = useState(false)
  setThrottled = setThrottledState

  useEffect(() => onAccountsChanged(setAccounts), [])

  async function onConnect() {
    setConnecting(true)
    const res = await connect()
    setConnecting(false)
    if (res.ok) {
      setAccounts(res.accounts)
      setConnectMsg(null)
      void run(res.accounts.walletAddress)
    } else {
      setConnectMsg(res.message)
    }
  }

  async function run(address: string) {
    const cached = cachedTrace(address, days, { network: host.network, store })
    setLoad({ state: 'loading', cached })
    try {
      const t = await traceWallet(address, days, { network: host.network, rpc, store })
      updateDiag((d) => {
        d.trace = { wallet: t.wallet, at: Date.now(), vaults: t.vaultRecords, swaps: t.swaps, cosigners: t.cosigners, stats: t.stats }
        d.rpcTotals = { ...rpc.stats }
      })
      setLoad({ state: 'done', trace: t })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      updateDiag((d) => {
        d.errors.push({ at: Date.now(), message: `trace: ${message}` })
        d.rpcTotals = { ...rpc.stats }
      })
      setLoad({ state: 'error', message, cached })
    }
  }

  const pastedValid = isValidAddress(pasted)
  const trace = shown(load)

  return (
    <main>
      <h1>Spare · debug</h1>

      <section>
        <h2>Host</h2>
        <pre>{JSON.stringify(host, null, 2)}</pre>
      </section>

      <section>
        <h2>Accounts</h2>
        {host.insideNimiqPay ? (
          <button onClick={onConnect} disabled={connecting}>
            {connecting ? 'Connecting…' : accounts ? 'Reconnect' : 'Connect wallet'}
          </button>
        ) : (
          <p className="notice">Open in Nimiq Pay to use your own wallet. You can still paste an address below (read-only).</p>
        )}
        {connectMsg && <p className="error">{connectMsg}</p>}
        {accounts && <pre>{JSON.stringify(accounts, null, 2)}</pre>}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (pastedValid) void run(normalizeAddress(pasted))
          }}
        >
          <label>
            Paste an NQ wallet address (read-only)
            <input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="NQ.. .... ...." spellCheck={false} />
          </label>
          <label>
            Days
            <input type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value) || 30)} />
          </label>
          <button type="submit" disabled={!pastedValid || load.state === 'loading'}>
            Read spending
          </button>
          {pasted && !pastedValid && <p className="error">Not a valid Nimiq address.</p>}
        </form>
      </section>

      <section>
        <h2>Spending</h2>
        {load.state === 'idle' && <p>Connect or paste an address.</p>}
        {load.state === 'loading' && <p>{throttled ? 'Loading more history…' : load.cached ? 'Showing saved history, checking for new payments…' : 'Reading chain history…'}</p>}
        {load.state === 'error' && <p className="error">Could not refresh history: {load.message}</p>}
        {trace && <SpendingView trace={trace} />}
      </section>

      {trace && (
        <section>
          <h2>Round-ups</h2>
          <RoundUps trace={trace} accounts={accounts && accounts.walletAddress === trace.wallet ? accounts : null} />
        </section>
      )}

      <section>
        <DiagnosticsPanel />
      </section>
    </main>
  )
}

function SpendingView({ trace }: { trace: WalletTrace }) {
  const total = trace.spends.reduce((s, e) => s + e.valueLuna, 0)
  return (
    <>
      <p>
        Wallet {trace.wallet} · {trace.vaults.length} vault(s) · {trace.spends.length} spend(s) · total <strong>{nim(total)} NIM</strong>
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Kind</th>
              <th>NIM</th>
              <th>To</th>
            </tr>
          </thead>
          <tbody>
            {trace.classified.map((c) => (
              <tr key={c.hash} className={c.kind === 'payment' || c.kind === 'lightning' ? 'spend' : 'muted'}>
                <td>{new Date(c.timestamp).toLocaleDateString(host.language)}</td>
                <td>
                  {c.kind}
                  {c.note ? ` (${c.note})` : ''}
                </td>
                <td>{nim(c.valueLuna)}</td>
                <td title={c.to}>{c.to.slice(0, 14)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function RoundUps({ trace, accounts }: { trace: WalletTrace; accounts: ConnectedAccounts | null }) {
  const [fiat, setFiat] = useState<FiatCode>(hostFiat)
  const [step, setStep] = useState(DEFAULT_STEP[hostFiat])
  const [multiplier, setMultiplier] = useState<Multiplier>(1)
  const [table, setTable] = useState<PriceTable | null>(null)
  const [priceError, setPriceError] = useState<string | null>(null)
  const [status, setStatus] = useState<SpendStatusData>(() => loadSpendStatus(store, host.network, trace.wallet))
  const [sweeps, setSweeps] = useState<SweepRecord[]>(() => loadSweeps(store, host.network, trace.wallet))
  useEffect(() => setSweeps(loadSweeps(store, host.network, trace.wallet)), [trace.wallet])

  const dayList = useMemo(() => [...new Set(trace.spends.map((s) => dayKey(s.timestamp)))].join(','), [trace.spends])
  useEffect(() => {
    let alive = true
    setPriceError(null)
    getPriceTable(fiat, dayList ? dayList.split(',') : [], { store })
      .then((t) => {
        if (!alive) return
        setTable(t)
        updateDiag((d) => (d.priceSources = t.sources))
      })
      .catch((e) => {
        if (!alive) return
        const message = e instanceof Error ? e.message : String(e)
        setPriceError(message)
        updateDiag((d) => d.errors.push({ at: Date.now(), message: `prices: ${message}` }))
      })
    return () => {
      alive = false
    }
  }, [fiat, dayList])

  useEffect(() => setStatus(loadSpendStatus(store, host.network, trace.wallet)), [trace.wallet])

  function toggleExcluded(hash: string) {
    const excluded = status.excluded.includes(hash) ? status.excluded.filter((h) => h !== hash) : [...status.excluded, hash]
    const next = { ...status, excluded }
    saveSpendStatus(store, host.network, trace.wallet, next)
    setStatus(next)
  }

  if (priceError && !table) return <p className="error">Could not load prices: {priceError}</p>
  if (!table || table.fiat !== fiat) return <p>Loading prices…</p>

  const marks = sweptMarks(sweeps)
  const locked = lockedItemHashes(sweeps)
  // Items in an unsettled sweep are kept out of the quote (never double-sweep) but are not "swept" yet.
  const items = buildRoundUps(trace.spends, table, { maxStep: step, multiplier }, { excluded: status.excluded, swept: [...marks.keys(), ...locked] })
  const quote = getSweepQuote(fiat, items, table.current)
  const statusLabel = (i: RoundUpItem) => (i.status === 'swept' && !marks.has(i.hash) ? 'sweeping…' : i.status)

  return (
    <>
      <div className="controls">
        <label>
          Fiat
          <select
            value={fiat}
            onChange={(e) => {
              const f = e.target.value as FiatCode
              setFiat(f)
              setStep(DEFAULT_STEP[f])
            }}
          >
            {FIATS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label>
          Max step
          <select value={step} onChange={(e) => setStep(Number(e.target.value))}>
            {STEPS[fiat].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Multiplier
          <select value={multiplier} onChange={(e) => setMultiplier(Number(e.target.value) as Multiplier)}>
            {[1, 2, 3].map((m) => (
              <option key={m} value={m}>
                ×{m}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>NIM</th>
              <th>{fiat}</th>
              <th>Round-up</th>
              <th>Saved</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.hash} className={i.status === 'pending' ? '' : 'muted'}>
                <td>{i.day}</td>
                <td>{i.label}</td>
                <td>{nim(i.valueLuna)}</td>
                <td title={i.price ? `${i.price} ${fiat}/NIM on ${i.priceDay}` : 'no price'}>
                  {money(i.fiatAtTime, fiat)}
                  {i.priceApproximate ? '*' : ''}
                </td>
                <td>{money(i.roundUp, fiat)}</td>
                <td>{money(i.saved, fiat)}</td>
                <td title={marks.get(i.hash)?.sweepHash}>{statusLabel(i)}</td>
                <td>
                  {i.status !== 'swept' && !locked.has(i.hash) && (
                    <button className="small" onClick={() => toggleExcluded(i.hash)}>
                      {i.status === 'excluded' ? 'Include' : 'Not a purchase'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">* price from the nearest day, or FX from another day</p>
      <h3>Sweep quote</h3>
      <pre>
        {JSON.stringify(
          { ...quote, priceTime: quote.priceTime && new Date(quote.priceTime).toISOString(), items: quote.items.map((i) => `${i.day} ${i.label} ${money(i.saved, fiat)} ${fiat}`) },
          null,
          2,
        )}
      </pre>
      <SweepPanel trace={trace} accounts={accounts} quote={quote} current={table.current} sweeps={sweeps} setSweeps={setSweeps} />
    </>
  )
}

interface ChainInfo {
  balances: { wallet: number | null; htlc: number | null; supported: boolean }
  staker: StakerInfo | null
  validators: ValidatorRow[]
}

function SweepPanel(props: {
  trace: WalletTrace
  accounts: ConnectedAccounts | null
  quote: SweepQuote
  current: { price: number; time: number } | null
  sweeps: SweepRecord[]
  setSweeps: (s: SweepRecord[]) => void
}) {
  const { trace, accounts, quote, current, sweeps, setSweeps } = props
  const [info, setInfo] = useState<ChainInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [pool, setPool] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const deps = (): SweepDeps => ({
    // Settling never sends; only executeSweep (button press) reaches the wallet.
    provider: getProvider() ?? {
      sendNewStakerTransaction: () => Promise.reject(new Error('Not connected')),
      sendStakeTransaction: () => Promise.reject(new Error('Not connected')),
    },
    rpc,
    store,
    network: host.network,
    wallet: trace.wallet,
    ownAddresses: [...new Set([trace.wallet, ...trace.vaults, ...(accounts?.htlcAddress ? [accounts.htlcAddress] : [])])],
    onUpdate: (r) => {
      setSweeps(loadSweeps(store, host.network, trace.wallet))
      updateDiag((d) => d.errors.push({ at: Date.now(), message: `sweep ${r.id}: ${r.status}${r.txHash ? ` ${r.txHash}` : ''}${r.error ? ` (${r.error})` : ''}` }))
    },
  })

  async function refreshInfo() {
    if (!accounts) return
    setInfoError(null)
    try {
      const [balances, staker, validators] = await Promise.all([
        getBalances(accounts),
        rpc.getStakerByAddress(trace.wallet).then(toStakerInfo),
        fetchValidators(host.network, store),
      ])
      setInfo({ balances, staker, validators })
      setPool((p) => p ?? pickDefaultValidator(validators)?.address ?? null)
    } catch (e) {
      setInfoError(e instanceof Error ? e.message : String(e))
    }
  }

  // Read-only on load: balances (host, no dialog), staker + validators (public APIs).
  useEffect(() => {
    void refreshInfo()
  }, [accounts?.walletAddress, accounts?.htlcAddress])

  // Resume any sweep left unsettled by an earlier session. Chain reads only.
  useEffect(() => {
    for (const r of loadSweeps(store, host.network, trace.wallet)) {
      if (r.status === 'sending' || r.status === 'submitted' || r.status === 'checking') void settleSweep(deps(), r)
    }
  }, [trace.wallet])

  const saved = savedWithSpare(sweeps)
  const earned = earnedOnTop(info?.staker ?? null, sweeps)
  const gate = canStartSweep(sweeps)
  const spendable = info ? spendableLuna(info.balances) : null
  const partial = spendable !== null && current && quote.luna > spendable ? pickAffordable(quote.items, spendable, current.price) : null
  const plan = partial ?? { items: quote.items, luna: quote.luna, fiat: quote.fiatTotal }
  const route = planRoute(plan.luna, info?.staker ?? null)

  async function onSweep() {
    if (!info || !current || (route.kind !== 'new' && route.kind !== 'add')) return
    setBusy(true)
    setMessage(null)
    const out = await executeSweep(deps(), {
      route: route.kind,
      delegation: route.kind === 'new' ? pool : null,
      luna: plan.luna,
      fiat: plan.fiat,
      fiatCode: quote.fiat,
      price: current.price,
      priceTime: current.time,
      itemHashes: plan.items.map((i) => i.hash),
      stakeBefore: info.staker ? info.staker.active + info.staker.inactive + info.staker.retired : 0,
    })
    setBusy(false)
    setSweeps(loadSweeps(store, host.network, trace.wallet))
    if (out.kind === 'rejected') setMessage('Cancelled. Nothing was sent.')
    else if (out.kind === 'blocked') setMessage(out.reason)
    else if (out.record.status === 'confirmed') setMessage(`Staked ${nim(out.record.luna)} NIM.`)
    else if (out.record.status === 'failed') setMessage(`Sweep failed: ${out.record.error ?? 'unknown error'}. Your round-ups stay pending.`)
    else setMessage('Sent. Waiting for the chain to confirm; this page will keep checking.')
    void refreshInfo()
  }

  const canSweep = !busy && !!info && !!current && gate.ok && (route.kind === 'add' || (route.kind === 'new' && !!pool))

  return (
    <>
      <h3>Sweep into stake</h3>
      <p>
        Saved with Spare: <strong>{nim(saved.luna)} NIM</strong>
        {Object.entries(saved.fiatByCode).map(([c, v]) => ` · ${money(v ?? 0, c as FiatCode)} ${c}`)}
        {' · '}Earned on top: <strong>{nim(earned.luna)} NIM</strong>
        {earned.approximate ? ' (approximate: you also staked outside Spare)' : ''}
      </p>
      {!accounts ? (
        <p className="notice">Read-only mode. Open Spare in Nimiq Pay and connect to sweep.</p>
      ) : (
        <>
          {infoError && <p className="error">Could not read balance or staking state: {infoError}</p>}
          {info && (
            <pre>
              {JSON.stringify(
                {
                  walletBalance: info.balances.wallet,
                  vaultBalance: info.balances.htlc,
                  getBalanceSupported: info.balances.supported,
                  spendableLuna: spendable,
                  staker: info.staker,
                  route,
                  partial: partial ? { items: partial.items.length, of: quote.items.length, luna: partial.luna } : null,
                },
                null,
                2,
              )}
            </pre>
          )}
          {route.kind === 'new' && info && (
            <label>
              Staking pool (ranked by the validators API)
              <select value={pool ?? ''} onChange={(e) => setPool(e.target.value)}>
                {info.validators
                  .filter((v) => v.isListed)
                  .map((v) => (
                    <option key={v.address} value={v.address}>
                      {v.name} · fee {v.fee === null ? '?' : `${(v.fee * 100).toFixed(1)}%`} · score {v.score?.total.toFixed(3) ?? '?'}
                      {v.payoutType === 'none' ? ' · no payouts' : ''}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {route.kind === 'wait' && <p>Spare change waits until it reaches 100 NIM ({nim(route.shortLuna)} NIM to go).</p>}
          {partial && (
            <p>
              Your balance covers {partial.items.length} of {quote.items.length} round-ups (oldest first).
            </p>
          )}
          {!gate.ok && <p>{gate.reason}</p>}
          <button onClick={onSweep} disabled={!canSweep}>
            {busy ? 'Waiting for Nimiq Pay…' : `Sweep ${nim(plan.luna)} NIM into ${route.kind === 'add' ? 'your stake' : 'a new stake'}`}
          </button>
          <button className="small" onClick={() => void refreshInfo()}>
            Refresh balance
          </button>
          {message && <p>{message}</p>}
        </>
      )}
      {sweeps.length > 0 && (
        <>
          <h3>Sweep history</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Status</th>
                  <th>NIM</th>
                  <th>Fiat</th>
                  <th>Price</th>
                  <th>Tx</th>
                  <th>Items</th>
                </tr>
              </thead>
              <tbody>
                {[...sweeps].reverse().map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.createdAt).toLocaleString(host.language)}</td>
                    <td title={r.error}>{r.status}</td>
                    <td>{nim(r.luna)}</td>
                    <td>
                      {money(r.fiat, r.fiatCode)} {r.fiatCode}
                    </td>
                    <td>{r.price.toPrecision(4)}</td>
                    <td title={r.txHash ?? ''}>{r.txHash ? `${r.txHash.slice(0, 10)}…` : '—'}</td>
                    <td>{r.itemHashes.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}

function DiagnosticsPanel() {
  const version = useSyncExternalStore(
    (cb) => onDiagnostics(cb),
    () => diag.accountsChanged.length + (diag.trace?.at ?? 0) + diag.errors.length + (diag.listAccounts?.at ?? 0) + (diag.sdkInitMs ?? 0),
  )
  const [copyMsg, setCopyMsg] = useState<string | null>(null)
  const text = useMemo(() => diagnosticsText(host), [version])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopyMsg('Copied.')
      return
    } catch {
      /* WebViews over plain http often block the async clipboard */
    }
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    setCopyMsg(ok ? 'Copied.' : 'Copy blocked here. Long-press the text box below and copy manually.')
  }

  return (
    <details>
      <summary>Diagnostics</summary>
      <button onClick={copy}>Copy diagnostics</button>
      {copyMsg && <p>{copyMsg}</p>}
      <h3>window.nimiqPay</h3>
      <pre>{JSON.stringify(rawNimiqPay(), null, 2) ?? 'null'}</pre>
      <p>
        SDK init: {diag.sdkInitMs ?? '—'} ms · RPC {diag.rpcUrl} · requests {diag.rpcTotals.requests} · 429s {diag.rpcTotals.throttled429}
        {diag.trace && ` · last load ${diag.trace.stats.loadMs} ms`}
      </p>
      {diag.trace && (
        <>
          <h3>Vault discovery</h3>
          <ul>
            {diag.trace.vaults.map((v) => (
              <li key={v.address}>
                <strong>{v.address}</strong>: {vaultReason(v)}
              </li>
            ))}
          </ul>
        </>
      )}
      <textarea readOnly value={text} rows={16} />
    </details>
  )
}
