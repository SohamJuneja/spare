import { fmtDate, fmtFiat, fmtNim } from '../format'
import { lang, t, tn } from '../i18n'
import { unstakeWindowHours } from '../progress'
import { fiat, host, openInPayLink, WINDOW_DAYS, type Spare } from './useSpare'

const unstake = unstakeWindowHours()

export function Home({ s, onHow }: { s: Spare; onHow: () => void }) {
  const sample = s.mode.kind === 'sample'
  const pending = s.quote?.items ?? []
  const oldest = pending.length ? Math.min(...pending.map((i) => i.timestamp)) : null
  const noPayments = s.trace && s.trace.spends.length === 0
  const loadingFirst = !s.trace && s.historyState !== 'error'

  return (
    <>
      {s.historyState === 'error' && (
        <ErrorNotice text={t('error.history')} action={t('action.retry')} onAction={() => void s.retryHistory()} />
      )}

      {noPayments ? (
        <div className="card">
          <h3>{t('empty.title', { days: WINDOW_DAYS })}</h3>
          <p className="muted">{t('empty.body')}</p>
          {!sample && (
            <button className="btn secondary" onClick={() => s.setMode({ kind: 'sample' })}>
              {t('welcome.preview')}
            </button>
          )}
        </div>
      ) : (
        <section className="card hero" aria-live="polite">
          <div className="label">{t('home.waiting')}</div>
          {loadingFirst || !s.quote ? (
            s.priceError && s.trace ? (
              <p>{t('error.prices', { fiat })}</p>
            ) : (
              <>
                <div className="skeleton" style={{ height: 48, width: '70%', margin: '8px 0' }} />
                <div className="skeleton" style={{ height: 16, width: '40%' }} />
              </>
            )
          ) : (
            <>
              <div className="big">{fmtFiat(s.quote.fiatTotal, fiat, lang)}</div>
              <div className="small">{fmtNim(s.quote.luna, lang)} NIM</div>
              {oldest !== null && <div className="sub">{tn('home.fromPayments', pending.length, { date: fmtDate(oldest, lang) })}</div>}
              <SweepAction s={s} />
            </>
          )}
        </section>
      )}

      {s.priceError && s.trace && (
        <ErrorNotice text={t('error.prices', { fiat })} action={t('action.retry')} onAction={() => void s.retryPrices()} />
      )}
      {s.infoError && <ErrorNotice text={t('error.balance')} action={t('action.retry')} onAction={() => void s.retryInfo()} />}

      {s.minimum && s.quote && s.quote.luna > 0 && <MinimumCard s={s} />}

      {/* Primary stat comes from the chain, so it is right on any device. */}
      <section className="card stake-card">
        <div className="k">{sample ? t('home.sampleStake') : t('home.yourStake')}</div>
        {s.stakeLuna === null ? (
          <div className="skeleton" style={{ height: 30, width: '50%', marginTop: 6 }} />
        ) : s.stakeLuna === 0 ? (
          <div className="v">{t('home.noStake')}</div>
        ) : (
          <>
            <div className="v">{s.stakeFiat !== null ? fmtFiat(s.stakeFiat, fiat, lang) : `${fmtNim(s.stakeLuna, lang)} NIM`}</div>
            {s.stakeFiat !== null && <div className="f">{fmtNim(s.stakeLuna, lang)} NIM</div>}
          </>
        )}
      </section>

      {/* Local sweep history: only on this device, so labelled that way and hidden while empty. */}
      {s.hasLocalHistory && (
        <div className="stats">
          <div className="stat">
            <div className="k">{t('home.saved')}</div>
            <div className="v">{fmtNim(s.saved.luna, lang)} NIM</div>
            <div className="f">{t('home.thisDevice')}</div>
          </div>
          <div className="stat">
            <div className="k">{t('home.earned')}</div>
            <div className="v">{fmtNim(s.earned.luna, lang)} NIM</div>
            {s.earned.approximate && <div className="f">{t('home.approx')}</div>}
          </div>
          <div className="stat">
            <div className="k">{t('home.streak')}</div>
            <div className="v">{tn('home.streakValue', s.streak)}</div>
            <div className="f">{t('home.thisDevice')}</div>
          </div>
        </div>
      )}

      {!sample && s.fresh && s.trace && s.trace.spends.length > 0 && (
        <div className="notice">
          <span className="grow">
            {s.fresh.count === 0 ? t('home.caughtUp') : s.fresh.since === null ? tn('home.readyFirst', s.fresh.count) : tn('home.newSince', s.fresh.count)}
          </span>
        </div>
      )}

      <p className="status-line" aria-live="polite">
        {s.historyState === 'loading' ? (s.throttled ? t('loading.more') : s.trace ? t('loading.checking') : t('loading.reading')) : ''}
      </p>

      <button className="btn ghost" onClick={onHow}>
        {t('home.how')}
      </button>
    </>
  )
}

function SweepAction({ s }: { s: Spare }) {
  if (s.mode.kind === 'sample') {
    return (
      <>
        <p className="explainer">{t('sample.noSweep')}</p>
        {!host.insideNimiqPay && (
          <a className="btn" href={openInPayLink()}>
            {t('welcome.openInPay')}
          </a>
        )}
      </>
    )
  }
  if (!s.plan || !s.route) return null
  if (!s.info) return <div className="skeleton" style={{ height: 52, marginTop: 16 }} />
  // An unsettled sweep locks its items, so the quote can read 0: say why instead of "nothing waiting".
  if (!s.gate.ok) return <p className="explainer">{t('sweep.blocked')}</p>
  // Nothing pending (device bug: this used to read "Sweep 0 NIM into a new stake"). Say what the next sweep will do.
  if (s.route.kind === 'nothing') {
    // A just-confirmed Spare sweep counts as a stake even before the staker read catches up.
    const lastSweep = [...s.sweeps].reverse().find((r) => r.status === 'confirmed')
    const stakedWith = s.info.staker?.delegation ?? lastSweep?.delegation ?? null
    const hasStake = !!s.info.staker || !!lastSweep
    const poolName = (stakedWith && s.validators.find((v) => v.address === stakedWith)?.name) ?? s.pool?.name ?? '—'
    return (
      <p className="explainer">
        {t('home.nothingWaiting')} {hasStake ? t('home.nextAdds', { pool: poolName }) : t('home.nextNew')}
      </p>
    )
  }
  if (s.route.kind === 'wait') return null
  if (s.spendable !== null && s.plan.luna === 0) return <p className="explainer">{t('balance.low')}</p>

  const poolName = s.pool?.name ?? '—'
  const label = s.partial
    ? t('home.sweepPartial', { nim: fmtNim(s.plan.luna, lang) })
    : s.route.kind === 'new'
      ? t('home.sweepNew', { pool: poolName })
      : t('home.sweepAdd')
  const disabled = !s.gate.ok || (s.route.kind === 'new' && !s.pool)
  return (
    <>
      <button className="btn" onClick={() => void s.sweep('quote')} disabled={disabled}>
        {label}
      </button>
      {s.route.kind === 'new' && !s.pool && <p className="explainer">{t('error.noPool')}</p>}
      {!s.gate.ok && <p className="explainer">{t('sweep.blocked')}</p>}
      {s.partial && <p className="explainer">{t('partial.note', { n: s.partial.items.length, total: s.quote?.items.length ?? 0 })}</p>}
      <p className="explainer">{t('home.explainer', { min: unstake.min, max: unstake.max })}</p>
    </>
  )
}

function MinimumCard({ s }: { s: Spare }) {
  const m = s.minimum!
  const sample = s.mode.kind === 'sample'
  return (
    <section className="card">
      <h3>{t('min.title')}</h3>
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(m.fraction * 100)}>
        <span style={{ width: `${Math.max(3, m.fraction * 100)}%` }} />
      </div>
      <div className="small-text muted">{t('min.progress', { have: fmtNim(s.quote!.luna, lang) })}</div>
      <p className="small-text">{t('min.wait')}</p>
      {!sample && (
        <>
          <button className="btn" onClick={() => void s.sweep('min')} disabled={!s.canAffordMinimum || !s.gate.ok || !s.pool}>
            {t('min.start', { amount: fmtNim(m.startLuna, lang) })}
          </button>
          <p className="small-text muted">{s.canAffordMinimum ? t('min.extra', { extra: fmtNim(m.extraLuna, lang) }) : t('min.cantAfford')}</p>
        </>
      )}
    </section>
  )
}

export function ErrorNotice({ text, action, onAction }: { text: string; action: string; onAction: () => void }) {
  return (
    <div className="notice bad" role="alert">
      <span className="grow">{text}</span>
      <button className="btn small secondary" onClick={onAction}>
        {action}
      </button>
    </div>
  )
}
