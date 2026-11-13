import type { Network } from '../chain/rpc'
import { fmtNim } from '../format'
import { lang, t, type StringKey } from '../i18n'
import { unstakeWindowHours } from '../progress'
import { explorerTx } from './useSpare'

export const GITHUB_URL = 'https://github.com/SohamJuneja/spare'

export interface ProofTx {
  network: Network
  kind: 'new' | 'add'
  luna: number
  hash: string
}

/**
 * Real Spare sweeps made inside Nimiq Pay (verified on chain: staking txs from vault NQ44 82E2… of wallet
 * NQ12 2H3A…, whose staker balance equals their sum). Append the first mainnet sweep here.
 */
export const PROOF_TXS: ProofTx[] = [
  { network: 'testnet', kind: 'new', luna: 26_655_895, hash: '68ae412aac302de10468fb6bbbfd489de7261b8c02a7653cb879f8d8fb44ae22' },
  { network: 'testnet', kind: 'add', luna: 74_725_669, hash: '24eadf8d4b271d94ab02d44480d796f766cf7e6e5bf7dfa7c0faf09dc9ac5461' },
]

const proofLabel = (p: ProofTx): StringKey =>
  p.network === 'testnet' ? (p.kind === 'new' ? 'how.proofTestnetNew' : 'how.proofTestnetAdd') : p.kind === 'new' ? 'how.proofMainnetNew' : 'how.proofMainnetAdd'

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
        <h3>{t('how.incomeTitle')}</h3>
        <p>{t('how.income')}</p>
      </section>

      <section className="card">
        <h3>{t('how.limitsTitle')}</h3>
        <ul>
          <li>{t('how.limit1')}</li>
          <li>{t('how.limit2')}</li>
          <li>{t('how.limit3')}</li>
          <li>{t('how.limit4', { min: u.min, max: u.max })}</li>
          <li>{t('how.limit5')}</li>
        </ul>
      </section>

      <section className="card">
        <h3>{t('how.proofTitle')}</h3>
        <ul className="list">
          {PROOF_TXS.map((p) => (
            <li key={p.hash} className="row">
              <div className="main">
                <a href={explorerTx(p.network, p.hash)} target="_blank" rel="noreferrer">
                  {t(proofLabel(p), { nim: fmtNim(p.luna, lang, 5) })}
                </a>
                <div className="mono meta">{p.hash}</div>
              </div>
            </li>
          ))}
        </ul>
        {!PROOF_TXS.some((p) => p.network === 'mainnet') && <p className="muted small-text">{t('how.proofPending')}</p>}
      </section>
    </main>
  )
}
