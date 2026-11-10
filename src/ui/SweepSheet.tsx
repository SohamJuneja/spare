import { fmtFiat, fmtNim } from '../format'
import { lang, t } from '../i18n'
import { AlertIcon, CheckIcon } from './Icons'
import { explorerTx, type Spare } from './useSpare'

export function SweepSheet({ s }: { s: Spare }) {
  const ui = s.sweepUi
  if (ui.phase === 'idle') return null
  // Waiting states can't be dismissed: the wallet or chain still has the last word.
  const closable = ui.phase !== 'approval' && ui.phase !== 'confirming'
  const record = 'record' in ui ? ui.record : null
  const txLink = record?.txHash ? (
    <a className="btn secondary" href={explorerTx(s.network, record.txHash)} target="_blank" rel="noreferrer">
      {t('sweep.viewTx')}
    </a>
  ) : null

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-live="assertive">
      <div className="sheet">
        {ui.phase === 'approval' && (
          <>
            <div className="spinner" />
            <h2>{t('sweep.approval')}</h2>
          </>
        )}
        {ui.phase === 'confirming' && (
          <>
            <div className="spinner" />
            <h2>{t('sweep.confirming')}</h2>
            <p className="muted">
              {fmtNim(ui.record.luna, lang)} NIM · {fmtFiat(ui.record.fiat, ui.record.fiatCode, lang)}
            </p>
            {txLink}
          </>
        )}
        {ui.phase === 'checking' && (
          <>
            <AlertIcon color="var(--warn)" />
            <h2>{t('sweep.checkingTitle')}</h2>
            <p>{t('sweep.checking')}</p>
            {txLink}
          </>
        )}
        {ui.phase === 'success' && (
          <>
            <CheckIcon />
            <h2>{t('sweep.successTitle')}</h2>
            <div className="amount">{fmtNim(ui.record.luna, lang)} NIM</div>
            <p className="muted">{t('sweep.success', { nim: fmtNim(ui.record.luna, lang), fiat: fmtFiat(ui.record.fiat, ui.record.fiatCode, lang) })}</p>
            {!!ui.record.topUpLuna && (
              <p className="breakdown">
                {t('sweep.roundUps', { nim: fmtNim(ui.record.luna - ui.record.topUpLuna, lang) })}
                <br />
                {t('sweep.topUp', { nim: fmtNim(ui.record.topUpLuna, lang) })}
              </p>
            )}
            {txLink}
          </>
        )}
        {ui.phase === 'failed' && (
          <>
            <AlertIcon />
            <h2>{t('sweep.failedTitle')}</h2>
            <p>{t('sweep.failed')}</p>
            {txLink}
          </>
        )}
        {ui.phase === 'rejected' && <h2>{t('sweep.rejected')}</h2>}
        {ui.phase === 'blocked' && <h2>{t('sweep.blocked')}</h2>}
        {closable && (
          <button className="btn" onClick={s.closeSweep} style={{ marginTop: 14 }}>
            {ui.phase === 'success' ? t('sweep.done') : t('sweep.close')}
          </button>
        )}
      </div>
    </div>
  )
}
