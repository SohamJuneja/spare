import { fmtNim } from '../format'
import { lang, t } from '../i18n'
import { sweepBreakdown, type SweepRecord } from '../sweep'

/** "Round-ups: X · Slices: Y (· Starter top-up: Z)", or null for a plain round-up sweep. */
export function breakdownText(r: Pick<SweepRecord, 'luna' | 'topUpLuna' | 'sliceLuna'>): string | null {
  const b = sweepBreakdown(r)
  if (!b.sliceLuna && !b.topUpLuna) return null
  const parts = [t('sweep.roundUps', { nim: fmtNim(b.roundUpLuna, lang) })]
  if (b.sliceLuna) parts.push(t('sweep.slices', { nim: fmtNim(b.sliceLuna, lang) }))
  if (b.topUpLuna) parts.push(t('sweep.topUp', { nim: fmtNim(b.topUpLuna, lang) }))
  return parts.join(' · ')
}
