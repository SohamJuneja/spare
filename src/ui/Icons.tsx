// Inline icons. The mark matches public/icon.svg.
export function Mark({ className = 'mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#0f6e55" />
      <circle cx="29" cy="36" r="16" fill="#f5f2ea" />
      <circle cx="29" cy="36" r="10" fill="none" stroke="#0f6e55" strokeWidth="3.2" />
      <circle cx="46.5" cy="17.5" r="9" fill="#e2643f" />
      <path d="M46.5 12.8v9.4M41.8 17.5h9.4" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" />
    </svg>
  )
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

export const HomeIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path {...stroke} d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />
  </svg>
)
export const ListIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path {...stroke} d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </svg>
)
export const GearIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle {...stroke} cx="12" cy="12" r="3" />
    <path
      {...stroke}
      d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
    />
  </svg>
)
export const CheckIcon = () => (
  <svg className="icon" viewBox="0 0 56 56" aria-hidden="true">
    <circle cx="28" cy="28" r="28" fill="var(--ok)" />
    <path d="M17 29l7 7 15-15" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
export const AlertIcon = ({ color = 'var(--bad)' }: { color?: string }) => (
  <svg className="icon" viewBox="0 0 56 56" aria-hidden="true">
    <circle cx="28" cy="28" r="28" fill={color} />
    <path d="M28 15v17M28 40v.5" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" />
  </svg>
)
