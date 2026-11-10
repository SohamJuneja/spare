// Debug page for task 1: host info, accounts, and the spending list. Deliberately plain.
import { useEffect, useState } from 'react'
import { isValidAddress, normalizeAddress } from './chain/address'
import { traceWallet, type WalletTrace } from './chain/spending'
import { connect, getHost, onAccountsChanged, type ConnectedAccounts } from './nimiq/host'

const host = getHost()
const nim = (luna: number) => (luna / 1e5).toLocaleString(host.language, { maximumFractionDigits: 5 })

type Load = { state: 'idle' } | { state: 'loading' } | { state: 'error'; message: string } | { state: 'done'; trace: WalletTrace }

export default function App() {
  const [accounts, setAccounts] = useState<ConnectedAccounts | null>(null)
  const [connectMsg, setConnectMsg] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [pasted, setPasted] = useState('')
  const [days, setDays] = useState(30)
  const [load, setLoad] = useState<Load>({ state: 'idle' })

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
    setLoad({ state: 'loading' })
    try {
      setLoad({ state: 'done', trace: await traceWallet(address, days, { network: host.network }) })
    } catch (e) {
      setLoad({ state: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  const pastedValid = isValidAddress(pasted)

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
            <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value) || 30)} />
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
        {load.state === 'loading' && <p>Reading chain history… (the public RPC is rate-limited, busy wallets can take a while)</p>}
        {load.state === 'error' && <p className="error">Could not read history: {load.message}</p>}
        {load.state === 'done' && <SpendingView trace={load.trace} />}
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
      <details>
        <summary>Vaults</summary>
        <ul>
          {trace.vaults.map((v) => (
            <li key={v}>{v}</li>
          ))}
        </ul>
      </details>
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
