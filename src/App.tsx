import { useState } from 'react'
import { lang, t, type StringKey } from './i18n'
import { Activity } from './ui/Activity'
import { Home } from './ui/Home'
import { HowItWorks } from './ui/HowItWorks'
import { GearIcon, HomeIcon, ListIcon, Mark } from './ui/Icons'
import { Settings } from './ui/Settings'
import { SweepSheet } from './ui/SweepSheet'
import { useSpare } from './ui/useSpare'
import { Welcome } from './ui/Welcome'

type Tab = 'home' | 'activity' | 'settings'
const TABS: { id: Tab; label: StringKey; Icon: () => React.JSX.Element }[] = [
  { id: 'home', label: 'tabs.home', Icon: HomeIcon },
  { id: 'activity', label: 'tabs.activity', Icon: ListIcon },
  { id: 'settings', label: 'tabs.settings', Icon: GearIcon },
]

export default function App() {
  const s = useSpare()
  const [tab, setTab] = useState<Tab>('home')
  const [showHow, setShowHow] = useState(false)

  if (showHow) return <HowItWorks onBack={() => setShowHow(false)} />
  if (s.mode.kind === 'welcome') return <Welcome s={s} onHow={() => setShowHow(true)} />

  const sample = s.mode.kind === 'sample'
  return (
    <>
      <main className="app" lang={lang}>
        <header className="top">
          <Mark />
          <h1>{t('app.name')}</h1>
          {sample && <span className="chip sample">{t('sample.badge')}</span>}
          {s.network === 'testnet' && <span className="chip testnet">{t('network.testnet')}</span>}
          <span className="spacer" />
          {sample && (
            <button className="btn ghost small" onClick={() => s.setMode({ kind: 'welcome' })}>
              {t('sample.exit')}
            </button>
          )}
        </header>
        {sample && <p className="small-text muted">{t('sample.note')}</p>}

        {tab === 'home' && <Home s={s} onHow={() => setShowHow(true)} />}
        {tab === 'activity' && <Activity s={s} />}
        {tab === 'settings' && <Settings s={s} />}
      </main>

      <div className="tabs">
        <nav>
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
              <Icon />
              {t(label)}
            </button>
          ))}
        </nav>
      </div>
      <SweepSheet s={s} />
    </>
  )
}
