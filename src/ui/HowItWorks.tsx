import { lang, t } from '../i18n'
import { unstakeWindowHours } from '../progress'
import { explorerTx } from './useSpare'

export const GITHUB_URL = 'https://github.com/SohamJuneja/spare'
/** Set to the hash of the first public mainnet Spare sweep once it exists. */
export const PROOF_SWEEP_TX: string | null = null

export function HowItWorks({ onBack }: { onBack: () => void }) {
  const u = unstakeWindowHours()
  return (
    <main className="app no-tabs how" lang={lang}>
      <div className="top">
        <button className="btn ghost small" onClick={onBack}>
          ← {t('common.back')}
        </button>
      </div>
      <h1 style={{ fontSize: 26, margin: '8px 0 0' }}>{t('how.title')}</h1>

      <section className="card">
        <h3>{t('how.custodyTitle')}</h3>
        <p>{t('how.custody')}</p>
        <p>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            {t('how.github')}
          </a>
        </p>
      </section>

      <section className="card">
        <h3>{t('how.findTitle')}</h3>
        <p>{t('how.find')}</p>
      </section>

      <section className="card">
        <h3>{t('how.limitsTitle')}</h3>
        <ul>
          <li>{t('how.limit1')}</li>
          <li>{t('how.limit2')}</li>
          <li>{t('how.limit3')}</li>
          <li>{t('how.limit4', { min: u.min, max: u.max })}</li>
        </ul>
      </section>

      <section className="card">
        <h3>{t('how.proofTitle')}</h3>
        {PROOF_SWEEP_TX ? (
          <p>
            <a href={explorerTx('mainnet', PROOF_SWEEP_TX)} target="_blank" rel="noreferrer">
              {t('how.proof')}
            </a>
            <br />
            <span className="mono">{PROOF_SWEEP_TX}</span>
          </p>
        ) : (
          <p className="muted">{t('how.proofPending')}</p>
        )}
      </section>
    </main>
  )
}
