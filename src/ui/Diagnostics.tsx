import { useMemo, useState, useSyncExternalStore } from 'react'
import { diag, diagnosticsText, onDiagnostics } from '../diagnostics'
import { t } from '../i18n'
import { host } from './useSpare'

export function Diagnostics() {
  const rev = useSyncExternalStore(onDiagnostics, () => diag.rev)
  const [copyMsg, setCopyMsg] = useState<string | null>(null)
  const text = useMemo(() => diagnosticsText(host), [rev])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopyMsg(t('settings.copied'))
      return
    } catch {
      /* WebViews over plain http often block the async clipboard */
    }
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    setCopyMsg(ok ? t('settings.copied') : t('settings.copyBlocked'))
  }

  return (
    <details className="diag">
      <summary>{t('settings.diagnostics')}</summary>
      <button className="btn secondary" onClick={() => void copy()}>
        {t('settings.copy')}
      </button>
      {copyMsg && <p className="small-text">{copyMsg}</p>}
      <textarea readOnly value={text} aria-label={t('settings.diagnostics')} />
    </details>
  )
}
