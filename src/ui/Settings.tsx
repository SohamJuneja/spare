import { fmtFiat, fmtPercent } from '../format'
import { lang, t, type StringKey } from '../i18n'
import { STEPS, type Multiplier } from '../roundup'
import { Diagnostics } from './Diagnostics'
import { fiat, type Spare } from './useSpare'

export function Settings({ s }: { s: Spare }) {
  const staked = s.info?.staker?.delegation ?? null
  const currentPool = staked ? (s.validators.find((v) => v.address === staked)?.name ?? staked) : null
  return (
    <>
      <h2>{t('tabs.settings')}</h2>
      <section className="card">
        <h3>{t('settings.roundTo')}</h3>
        <div className="seg" role="group" aria-label={t('settings.roundTo')}>
          {STEPS[fiat].map((step) => (
            <button key={step} aria-pressed={s.settings.maxStep === step} onClick={() => s.setSettings({ maxStep: step })}>
              {fmtFiat(step, fiat, lang)}
            </button>
          ))}
        </div>
        <p className="small-text muted">{t('settings.roundHint')}</p>
      </section>

      <section className="card">
        <h3>{t('settings.multiplier')}</h3>
        <div className="seg" role="group" aria-label={t('settings.multiplier')}>
          {([1, 2, 3] as Multiplier[]).map((m) => (
            <button key={m} aria-pressed={s.settings.multiplier === m} onClick={() => s.setSettings({ multiplier: m })}>
              ×{m}
            </button>
          ))}
        </div>
        <p className="small-text muted">{t('settings.multiplierHint')}</p>
      </section>

      <section className="card">
        <h3>{t('settings.pool')}</h3>
        {currentPool ? (
          <p className="small-text">{t('settings.poolCurrent', { pool: currentPool })}</p>
        ) : (
          <>
            <select className="input" value={s.settings.pool ?? ''} onChange={(e) => s.setSettings({ pool: e.target.value })} aria-label={t('settings.pool')}>
              {s.validators
                .filter((v) => v.isListed)
                .map((v) => (
                  <option key={v.address} value={v.address}>
                    {v.name} · {v.fee === null ? '?' : t('settings.fee', { fee: fmtPercent(v.fee, lang) })}
                    {v.payoutType === 'none' ? ` · ${t('settings.noPayout')}` : v.payoutSchedule ? ` · ${v.payoutSchedule}` : ''}
                  </option>
                ))}
            </select>
            <p className="small-text muted">{t('settings.poolHint')}</p>
          </>
        )}
      </section>

      <section className="card">
        <div className="row" style={{ padding: 0 }}>
          <div className="main title">{t('settings.network')}</div>
          <span className={`chip ${s.network === 'testnet' ? 'testnet' : ''}`}>{t(`network.${s.network}` as StringKey)}</span>
        </div>
      </section>

      <Diagnostics />
    </>
  )
}
