import { lang, t } from '../i18n'
import { Mark } from './Icons'
import { host, openInPayLink, type Spare } from './useSpare'

export function Welcome({ s, onHow }: { s: Spare; onHow: () => void }) {
  return (
    <main className="app no-tabs welcome" lang={lang}>
      <Mark className="mark-big" />
      <h1>{t('welcome.promise')}</h1>
      <ol className="steps">
        <li>
          <span className="n">1</span>
          {t('welcome.step1')}
        </li>
        <li>
          <span className="n">2</span>
          {t('welcome.step2')}
        </li>
        <li>
          <span className="n">3</span>
          {t('welcome.step3')}
        </li>
      </ol>

      {host.insideNimiqPay ? (
        <>
          {/* Connect opens the account dialog, so it only ever runs on this press. */}
          <button className="btn" onClick={() => void s.doConnect()} disabled={s.connecting}>
            {s.connecting ? t('welcome.connecting') : t('welcome.connect')}
          </button>
          <p className="muted small-text center">{t('welcome.connectHint')}</p>
          {s.connectError && (
            <div className="notice bad" role="alert">
              <span className="grow">{s.connectError.rejected ? t('error.connectRejected') : t('error.connect')}</span>
            </div>
          )}
        </>
      ) : (
        <>
          <a className="btn" href={openInPayLink()}>
            {t('welcome.openInPay')}
          </a>
          <p className="muted small-text center">{t('welcome.outside')}</p>
        </>
      )}
      <button className="btn secondary" onClick={() => s.setMode({ kind: 'sample' })}>
        {t('welcome.preview')}
      </button>
      <button className="btn ghost" onClick={onHow}>
        {t('home.how')}
      </button>
    </main>
  )
}
