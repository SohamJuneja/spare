import { fmtDate, fmtDateTime, fmtFiat, fmtNim } from '../format'
import { lang, t, type StringKey } from '../i18n'
import { explorerTx, fiat, type Spare } from './useSpare'

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
                  {!!r.topUpLuna && <div className="meta">{t('sweep.topUp', { nim: fmtNim(r.topUpLuna, lang) })}</div>}
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
