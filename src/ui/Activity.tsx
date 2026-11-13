import { fmtDate, fmtDateTime, fmtFiat, fmtFiatAtLeast, fmtNim, fmtPercent } from '../format'
import { lang, t, type StringKey } from '../i18n'
import { breakdownText } from './breakdown'
import { explorerTx, fiat, WINDOW_DAYS, type Spare } from './useSpare'


export function Activity({ s }: { s: Spare }) {
  const items = s.items ?? []
  const hasLightning = items.some((i) => i.kind === 'lightning')
  const sample = s.mode.kind === 'sample'
  return (
    <>
      <h2>{t('activity.payments')}</h2>
      {hasLightning && <p className="small-text muted">{t('activity.lightningHint')}</p>}
      <div className="card">
        {!s.items ? (
          [0, 1, 2].map((k) => <div key={k} className="skeleton" style={{ height: 44, margin: '10px 0' }} />)
        ) : items.length === 0 ? (
          <p className="muted">{t('empty.title', { days: 30 })}</p>
        ) : (
          <ul className="list">
            {[...items]
              .sort((a, b) => b.timestamp - a.timestamp)
              .map((i) => {
                const sweeping = s.locked.has(i.hash) && !s.marks.has(i.hash)
                const statusKey: StringKey = sweeping ? 'status.sweeping' : (`status.${i.status}` as StringKey)
                return (
                  <li key={i.hash} className={`row${i.status === 'excluded' ? ' dim' : ''}`}>
                    <div className="main">
                      <div className="title">
                        {i.kind === 'lightning' ? t('activity.lightning') : t('activity.payment')}
                        {i.kind === 'lightning' && <span className="tag lightning">⚡</span>}
                      </div>
                      <div className="meta">
                        {fmtDate(i.timestamp, lang)} · {fmtNim(i.valueLuna, lang)} NIM · {fmtFiat(i.fiatAtTime, fiat, lang)}
                        {i.priceApproximate ? ` · ${t('activity.approx')}` : ''}
                      </div>
                      <div className="meta">{t(statusKey)}</div>
                    </div>
                    <div className="amt">
                      <div className="ru">+{fmtFiat(i.saved, fiat, lang)}</div>
                      {!sample && i.status !== 'swept' && !s.locked.has(i.hash) && (
                        <button className="toggle" onClick={() => s.toggleExcluded(i.hash)} aria-pressed={i.status === 'excluded'}>
                          {i.status === 'excluded' ? t('activity.include') : t('activity.notPurchase')}
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
          </ul>
        )}
      </div>

      <Received s={s} />

      <h2>{t('activity.sweeps')}</h2>
      <div className="card">
        {s.sweeps.length === 0 ? (
          <p className="muted">{t('activity.noSweeps')}</p>
        ) : (
          <ul className="list">
            {[...s.sweeps].reverse().map((r) => (
              <li key={r.id} className="row">
                <div className="main">
                  <div className="title">
                    {fmtNim(r.luna, lang)} NIM · {fmtFiat(r.fiat, r.fiatCode, lang)}
                  </div>
                  <div className="meta">
                    {fmtDateTime(r.createdAt, lang)} · {t(`sweepStatus.${r.status}` as StringKey)}
                  </div>
                  {breakdownText(r) && <div className="meta">{breakdownText(r)}</div>}
                </div>
                {r.txHash && (
                  <a className="btn small secondary" href={explorerTx(s.network, r.txHash)} target="_blank" rel="noreferrer">
                    {t('activity.viewTx')}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

function Received({ s }: { s: Spare }) {
  const sample = s.mode.kind === 'sample'
  const off = s.incomeRule.pct === 0
  const items = s.incomeItems
  return (
    <>
      <h2>{t('activity.received')}</h2>
      {!sample && !off && s.incomeRule.since !== null && (
        <p className="small-text muted">{t('income.onSince', { pct: fmtPercent(s.incomeRule.pct, lang), date: fmtDate(s.incomeRule.since, lang) })}</p>
      )}
      {items?.some((i) => i.source === 'reward') && <p className="small-text muted">{t('activity.rewardHint')}</p>}
      <div className="card">
        {off ? (
          <p className="muted">{t('activity.receivedOff')}</p>
        ) : !items ? (
          [0, 1].map((k) => <div key={k} className="skeleton" style={{ height: 44, margin: '10px 0' }} />)
        ) : items.length === 0 ? (
          <p className="muted">{sample ? t('activity.receivedNoneSample', { days: WINDOW_DAYS }) : t('activity.receivedNone')}</p>
        ) : (
          <ul className="list">
            {[...items]
              .sort((a, b) => b.timestamp - a.timestamp)
              .map((i) => {
                const sweeping = s.locked.has(i.hash) && !s.marks.has(i.hash)
                const statusText = sample ? t('activity.wouldHave') : t(sweeping ? 'status.sweeping' : (`status.${i.status}` as StringKey))
                return (
                  <li key={i.hash} className={`row${i.status === 'excluded' ? ' dim' : ''}`}>
                    <div className="main">
                      <div className="title">{i.source === 'reward' ? t('activity.reward') : t('activity.receivedPayment')}</div>
                      <div className="meta">
                        {fmtDate(i.timestamp, lang)} · {fmtNim(i.valueLuna, lang)} NIM · {fmtFiatAtLeast(i.fiatAtTime, fiat, lang)}
                        {i.priceApproximate ? ` · ${t('activity.approx')}` : ''}
                      </div>
                      {i.message && <div className="meta message">“{i.message}”</div>}
                      <div className="meta">
                        {t('activity.slice', { pct: fmtPercent(i.pct, lang) })} · {statusText}
                      </div>
                    </div>
                    <div className="amt">
                      <div className="ru">+{fmtFiatAtLeast(i.saved, fiat, lang)}</div>
                      {!sample && i.status !== 'swept' && !s.locked.has(i.hash) && (
                        <button className="toggle" onClick={() => s.toggleExcluded(i.hash, i.source === 'reward')} aria-pressed={i.status === 'excluded'}>
                          {i.status === 'excluded' ? t('activity.include') : t('activity.notCounted')}
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
          </ul>
        )}
      </div>
    </>
  )
}
