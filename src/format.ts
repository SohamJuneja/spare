// Intl formatting in the host language and fiat.
import type { Lang } from './i18n'
import type { FiatCode } from './prices'

const locale = (lang: Lang, fiat?: FiatCode) => (lang === 'es' ? (fiat === 'CRC' ? 'es-CR' : 'es') : 'en')

/** Fiat amounts: normal precision, more digits for sub-cent amounts so they never read as 0. */
export function fmtFiat(amount: number, fiat: FiatCode, lang: Lang): string {
  const abs = Math.abs(amount)
  const digits = abs === 0 || abs >= 1 ? 2 : abs >= 0.01 ? 2 : 4
  return new Intl.NumberFormat(locale(lang, fiat), { style: 'currency', currency: fiat, minimumFractionDigits: Math.min(2, digits), maximumFractionDigits: digits }).format(amount)
}

/** Like fmtFiat, but a positive amount too small to show reads "<$0.0001" instead of "$0.00". */
export function fmtFiatAtLeast(amount: number, fiat: FiatCode, lang: Lang): string {
  return amount > 0 && amount < 0.0001 ? `<${fmtFiat(0.0001, fiat, lang)}` : fmtFiat(amount, fiat, lang)
}

export function fmtNim(luna: number, lang: Lang, maxDigits = 2): string {
  const nim = luna / 1e5
  const digits = nim !== 0 && Math.abs(nim) < 1 ? 5 : maxDigits
  return new Intl.NumberFormat(locale(lang), { maximumFractionDigits: digits }).format(nim)
}

export function fmtDate(ms: number, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short' }).format(ms)
}

export function fmtDateTime(ms: number, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ms)
}

export function fmtPercent(x: number, lang: Lang): string {
  return new Intl.NumberFormat(locale(lang), { style: 'percent', maximumFractionDigits: 1 }).format(x)
}
