import type { ReactNode } from 'react'
import { interpolate, useCurrentFrame } from 'remotion'
import markersJson from './markers.json'
import { C, FONT, FPS } from './timeline'
import { ApprovedChip, BrandBg, ClipFrame, DemoLabel, ease, Mark, Phone, SCREEN_H, SCREEN_W, SideTitle, TapRing, useSpring } from './ui'

const M = markersJson.markers as Record<string, number>
const B = markersJson.boxes as Record<string, { x: number; y: number; w: number; h: number }>
const sec = (frame: number) => frame / FPS
const clampI = (v: number, a: number[], b: number[]) => interpolate(v, a, b, { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease })

// ---------------------------------------------------------------- INTRO

const Coin = ({ label, size = 74 }: { label: string; size?: number }) => (
  <div
    style={{
      width: size * 1.6,
      height: size,
      borderRadius: 999,
      background: `linear-gradient(180deg, #f08a66, ${C.coral})`,
      color: '#fff',
      fontWeight: 800,
      fontSize: size * 0.38,
      display: 'grid',
      placeItems: 'center',
      boxShadow: '0 10px 24px rgba(226,100,63,0.35)',
      fontFamily: FONT,
    }}
  >
    {label}
  </div>
)

export function S01() {
  const f = useCurrentFrame()
  const note = useSpring(8)
  const jar = useSpring(22)
  return (
    <BrandBg dark>
      <div
        style={{
          position: 'absolute',
          left: 330,
          top: 330,
          width: 620,
          transform: `translateY(${(1 - note) * -120}px)`,
          opacity: note,
          background: '#202a26',
          borderRadius: 26,
          padding: '26px 30px',
          display: 'flex',
          gap: 22,
          alignItems: 'center',
          boxShadow: '0 30px 60px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ width: 64, height: 64, borderRadius: 18, background: C.green, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 34 }}>✓</div>
        <div>
          <div style={{ color: '#9db0a7', fontSize: 24, fontWeight: 600 }}>Payment sent</div>
          <div style={{ color: '#e9f1ed', fontSize: 40, fontWeight: 750 }}>Paid · Coffee · $3.40</div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 1230, top: 230, opacity: jar, transform: `scale(${0.9 + 0.1 * jar})`, textAlign: 'center' }}>
        <svg width="300" height="380" viewBox="0 0 300 380">
          <rect x="70" y="20" width="160" height="40" rx="12" fill="none" stroke="#3a4a43" strokeWidth="8" />
          <path d="M60 70 h180 a30 30 0 0 1 30 30 v230 a30 30 0 0 1 -30 30 h-180 a30 30 0 0 1 -30 -30 v-230 a30 30 0 0 1 30 -30z" fill="rgba(255,255,255,0.03)" stroke="#3a4a43" strokeWidth="8" />
          <rect x="85" y="160" width="130" height="70" rx="10" fill="#202a26" />
          <text x="150" y="205" textAnchor="middle" fill="#9db0a7" fontSize="26" fontFamily={FONT} fontWeight="700">
            Savings
          </text>
        </svg>
        <div style={{ color: '#e9f1ed', fontSize: 64, fontWeight: 800, marginTop: -10, fontVariantNumeric: 'tabular-nums', opacity: 0.55 + 0.45 * Math.abs(Math.sin(f / 18)) }}>$0.00</div>
      </div>
    </BrandBg>
  )
}

export function S02() {
  const f = useCurrentFrame()
  const day = Math.min(30, 1 + Math.floor(clampI(f, [0, 80], [0, 29])))
  const noteO = clampI(f, [50, 95], [1, 0])
  const cards = [0, 1, 2]
  return (
    <BrandBg dark>
      <div style={{ position: 'absolute', left: 260, top: 250, width: 360, background: '#e9f1ed', borderRadius: 26, overflow: 'hidden', boxShadow: '0 30px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ background: C.coral, color: '#fff', fontSize: 30, fontWeight: 800, textAlign: 'center', padding: '14px 0', letterSpacing: 4 }}>NOVEMBER</div>
        <div style={{ fontSize: 170, fontWeight: 800, color: C.ink, textAlign: 'center', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>{day}</div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 520,
          top: 560,
          transform: 'rotate(-6deg)',
          background: '#f3e3a6',
          color: '#5b4a10',
          padding: '22px 26px',
          fontSize: 32,
          fontWeight: 700,
          borderRadius: 6,
          opacity: noteO,
          boxShadow: '0 16px 30px rgba(0,0,0,0.35)',
          fontFamily: "'Segoe Print', 'Comic Sans MS', cursive",
        }}
      >
        remind me to save
      </div>
      <div style={{ position: 'absolute', left: 900, top: 270, display: 'flex', gap: 34 }}>
        {cards.map((i) => {
          const grey = clampI(f, [100 + i * 30, 118 + i * 30], [0, 1])
          const enter = clampI(f, [10 + i * 8, 34 + i * 8], [0, 1])
          return (
            <div
              key={i}
              style={{
                width: 240,
                height: 360,
                borderRadius: 28,
                background: '#202a26',
                padding: 26,
                opacity: enter * (1 - 0.55 * grey),
                transform: `translateY(${(1 - enter) * 40}px)`,
                filter: `grayscale(${grey})`,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ width: 56, height: 56, borderRadius: 16, background: ['#3a7bd5', '#8e5cf7', '#2aa198'][i] }} />
                <div style={{ color: '#e9f1ed', fontSize: 28, fontWeight: 700, marginTop: 18 }}>Savings app</div>
                <div style={{ color: '#9db0a7', fontSize: 22, marginTop: 6 }}>Balance $0.00</div>
              </div>
              <div style={{ background: ['#3a7bd5', '#8e5cf7', '#2aa198'][i], color: '#fff', borderRadius: 16, textAlign: 'center', padding: '18px 0', fontSize: 28, fontWeight: 800 }}>Deposit</div>
            </div>
          )
        })}
      </div>
    </BrandBg>
  )
}

/** Example payments; the round-ups follow Spare's real rule (step sized to the payment). */
const PAYMENTS = [
  { label: 'Coffee', amount: '$3.40', coin: '+$0.60' },
  { label: 'Groceries', amount: '$12.75', coin: '+$0.25' },
  { label: 'Bus', amount: '$0.85', coin: '+$0.05' },
]

function PaymentRow({ label, amount }: { label: string; amount: string }) {
  return (
    <div style={{ width: 560, background: '#202a26', borderRadius: 22, padding: '22px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 20px 40px rgba(0,0,0,0.35)' }}>
      <span style={{ color: '#e9f1ed', fontSize: 34, fontWeight: 650 }}>{label}</span>
      <span style={{ color: '#e9f1ed', fontSize: 38, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{amount}</span>
    </div>
  )
}

export function S03() {
  const f = useCurrentFrame()
  return (
    <BrandBg dark>
      {PAYMENTS.map((p, i) => {
        const enter = clampI(f, [i * 18, i * 18 + 20], [0, 1])
        const y = 220 + i * 170 - clampI(f, [0, 220], [0, 40])
        const drop = Math.max(0, f - (40 + i * 22))
        const coinY = drop * drop * 0.09
        const coinO = clampI(drop, [0, 6, 50, 70], [0, 1, 0.8, 0])
        return (
          <div key={p.label}>
            <div style={{ position: 'absolute', left: 520, top: y, opacity: enter, transform: `translateX(${(1 - enter) * -60}px)` }}>
              <PaymentRow label={p.label} amount={p.amount} />
            </div>
            <div style={{ position: 'absolute', left: 1140, top: y + 6 + coinY, opacity: coinO * 0.85, filter: 'saturate(0.7)' }}>
              <Coin label={p.coin} />
            </div>
          </div>
        )
      })}
    </BrandBg>
  )
}

function StakeRing({ progress, pulse }: { progress: number; pulse: number }) {
  const r = 150
  const c = 2 * Math.PI * r
  return (
    <svg width="400" height="400" viewBox="0 0 400 400" style={{ transform: `scale(${1 + 0.04 * pulse})` }}>
      <defs>
        <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={C.greenLight} />
          <stop offset="100%" stopColor={C.coral} />
        </linearGradient>
      </defs>
      <circle cx="200" cy="200" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="22" />
      <circle
        cx="200"
        cy="200"
        r={r}
        fill="none"
        stroke="url(#ring)"
        strokeWidth="22"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - progress)}
        transform="rotate(-90 200 200)"
        style={{ filter: `drop-shadow(0 0 ${18 + 14 * pulse}px rgba(60,196,149,0.55))` }}
      />
    </svg>
  )
}

export function S04() {
  const f = useCurrentFrame()
  const ring = clampI(f, [30, 75], [0, 1])
  const pulse = Math.max(0, Math.sin((f - 75) / 7)) * clampI(f, [75, 90, 140, 160], [0, 1, 1, 0])
  const brand = clampI(f, [150, 185], [0, 1])
  const ringFade = clampI(f, [150, 185], [1, 0.0])
  return (
    <BrandBg dark>
      {PAYMENTS.map((p, i) => {
        // Rewind: coins come back from below and fly into the ring.
        const t = clampI(f, [i * 8, 40 + i * 8], [0, 1])
        const x = interpolate(t, [0, 1], [1140, 960 - 60])
        const y = interpolate(t, [0, 1], [1100, 500])
        return (
          <div key={p.label} style={{ position: 'absolute', left: x - 60, top: y - 37, opacity: t < 1 ? 1 : 0, transform: `scale(${1 - 0.5 * t})` }}>
            <Coin label={p.coin} />
          </div>
        )
      })}
      <div style={{ position: 'absolute', left: 760, top: 300, opacity: ringFade }}>
        <StakeRing progress={ring} pulse={pulse} />
      </div>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: brand, transform: `scale(${0.92 + 0.08 * brand})`, paddingBottom: 90 }}>
        <Mark size={170} />
        <div style={{ color: '#e9f1ed', fontSize: 110, fontWeight: 800, letterSpacing: -2, marginTop: 18 }}>Spare</div>
        <div style={{ color: '#9db0a7', fontSize: 34, marginTop: 4 }}>Round-ups into your own NIM stake</div>
      </div>
    </BrandBg>
  )
}

// ---------------------------------------------------------------- DEMO

interface DemoProps {
  step: string
  title: string
  sub?: string
  /** Scene seconds → app clip seconds. */
  clipAt: (t: number) => number
  /** Camera: [sceneSec, scale, focusY (css px in app)] keyframes. */
  camera?: [number, number, number][]
  taps?: { box: string; at: number }[]
  approvedAt?: number
  children?: ReactNode
}

export function DemoScene({ step, title, sub, clipAt, camera = [[0, 1, 422]], taps = [], approvedAt, children }: DemoProps) {
  const f = useCurrentFrame()
  const t = sec(f)
  const enter = useSpring(0)
  const ks = camera.map((k) => k[0])
  const scale = camera.length > 1 ? interpolate(t, ks, camera.map((k) => k[1]), { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease }) : camera[0][1]
  const focusY = camera.length > 1 ? interpolate(t, ks, camera.map((k) => k[2]), { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease }) : camera[0][2]
  const phoneH = SCREEN_H + 24
  // Keep the zoom target near the vertical middle of the phone area; never push the phone into the caption band.
  const originY = 12 + (focusY / 844) * SCREEN_H
  return (
    <BrandBg>
      <DemoLabel />
      <SideTitle step={step} title={title} sub={sub} />
      <div style={{ position: 'absolute', left: 960 - (SCREEN_W + 24) / 2 + 120, top: 40, width: SCREEN_W + 24, height: phoneH, opacity: enter, transform: `translateY(${(1 - enter) * 30}px)` }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: `50% ${originY}px` }}>
          <Phone>
            <ClipFrame src="clips/app.webm" time={clipAt(t)} cornerHalf />
            {taps.map((tp, i) => (
              <TapRing key={i} box={B[tp.box]} atFrame={Math.round(tp.at * FPS)} />
            ))}
            {approvedAt !== undefined && <ApprovedChip atFrame={Math.round(approvedAt * FPS)} />}
          </Phone>
        </div>
      </div>
      {children}
    </BrandBg>
  )
}

/** Hold `holdUntil` scene-seconds on clip `a`, then play realtime (×rate) from a to b, then hold b. */
const play =
  (a: number, b: number, startAt = 0, rate = 1) =>
  (t: number) =>
    t < startAt ? a : Math.min(b, a + (t - startAt) * rate)

export function S05() {
  const tapAt = 2.6
  return (
    <DemoScene
      step="01 · CONNECT"
      title="Inside Nimiq Pay"
      sub="Connecting shares your addresses. Nothing moves without your approval."
      clipAt={(t) => (t < tapAt ? 1.2 : Math.min(M.home_loading - 0.05, M.connect_tap + (t - tapAt) * 0.6))}
      taps={[{ box: 'connect', at: tapAt - 0.15 }]}
      approvedAt={tapAt + 0.6}
      camera={[
        [0, 1, 500],
        [1.6, 1.12, 560],
        [6, 1.12, 560],
        [8, 1, 422],
      ]}
    />
  )
}

export function S06() {
  return (
    <DemoScene
      step="02 · YOUR PAYMENTS"
      title="Spare change, found"
      sub="Read from the chain, across the vaults Nimiq Pay pays from."
      clipAt={play(M.home_loading, M.home_ready + 2.5, 0.2)}
      camera={[
        [0, 1, 422],
        [4.2, 1, 422],
        [5.6, 1.42, 220],
        [13.5, 1.42, 220],
        [15, 1, 422],
      ]}
    />
  )
}

export function S07() {
  const start = 1
  const a = M.activity
  return (
    <DemoScene
      step="03 · ACTIVITY"
      title="Every round-up, visible"
      sub="Sized to each payment and never more than half of it."
      clipAt={play(a, M.home_again - 0.25, start)}
      taps={[{ box: 'notPurchase', at: start + (M.not_purchase_tap - a) - 0.1 }]}
      camera={[
        [0, 1, 422],
        [1.6, 1.3, 330],
        [start + (M.not_purchase_tap - a) - 1, 1.3, 330],
        [start + (M.not_purchase_tap - a), 1.45, B.notPurchase.y],
        [12.5, 1.45, B.notPurchase.y],
        [14, 1, 422],
      ]}
    />
  )
}

export function S08() {
  const start = 0.6
  const a = M.home_again
  const tap = start + (M.sweep_tap - a)
  return (
    <DemoScene
      step="04 · SAVE"
      title="One tap into your own stake"
      sub="Spare never holds your money. No backend at all."
      clipAt={(t) => {
        // Slow down through the approval so the chip reads; then realtime to the success sheet.
        if (t < start) return a
        if (t < tap) return a + (t - start)
        if (t < tap + 2) return M.sweep_tap + (t - tap) * 0.25
        return Math.min(M.success + 3.4, M.sweep_tap + 0.5 + (t - tap - 2))
      }}
      taps={[{ box: 'sweep', at: tap - 0.1 }]}
      approvedAt={tap + 0.3}
      camera={[
        [0, 1, 422],
        [tap - 1, 1.18, B.sweep.y],
        [tap + 2.4, 1.18, B.sweep.y],
        [tap + 4.5, 1.25, 640],
        [16.5, 1.25, 640],
        [18, 1, 422],
      ]}
    />
  )
}

export function S09() {
  const start = 0.5
  const a = M.settings
  return (
    <DemoScene
      step="05 · SETTINGS"
      title="Save faster"
      sub="Raise the round-up, or turn on ×2 / ×3."
      // End on Settings with ×3 chosen; Home is empty right after the sweep, so cutting back would show nothing.
      clipAt={play(a, M.home_x3 - 0.15, start)}
      taps={[
        { box: 'x2', at: start + (M.mult_x2 - a) - 0.1 },
        { box: 'x3', at: start + (M.mult_x3 - a) - 0.1 },
      ]}
      camera={[
        [0, 1, 422],
        [0.8, 1.3, 330],
        [9, 1.3, 330],
      ]}
    />
  )
}

function BrowserWindow({ src, time, label, local }: { src: string; time: number; label: string; local: number }) {
  const enter = clampI(local, [0, 0.5], [0, 1])
  // Zoomed from the first frame so the explorer's own header logo is never on screen; a slow push-in only.
  const zoom = clampI(local, [0, 8], [1.42, 1.5])
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: enter }}>
      <div style={{ position: 'absolute', left: 300, top: 118, width: 1320, height: 760, borderRadius: 20, overflow: 'hidden', background: '#fff', boxShadow: '0 40px 90px rgba(23,34,30,0.28)' }}>
        <div style={{ height: 44, background: C.paper2, display: 'flex', alignItems: 'center', gap: 8, padding: '0 18px' }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 13, height: 13, borderRadius: 999, background: '#cfc7b6' }} />
          ))}
          <span style={{ marginLeft: 18, fontSize: 18, color: C.ink2, fontFamily: FONT }}>test.nimiq.watch · real testnet transaction</span>
        </div>
        <div style={{ width: 1320, height: 716, overflow: 'hidden' }}>
          {/* Zoom onto the Transaction Info card (page coords ≈ x 315–965, y 100–615 of 1280×800). */}
          <div style={{ width: 1280, height: 800, transform: `scale(${(1320 / 1280) * zoom})`, transformOrigin: '640px 230px' }}>
            <ClipFrame src={src} time={time} />
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 36, display: 'flex', justifyContent: 'center' }}>
        <div style={{ background: C.green, color: '#fff', fontFamily: FONT, fontSize: 30, fontWeight: 750, padding: '10px 26px', borderRadius: 999 }}>{label}</div>
      </div>
    </div>
  )
}

export function S10() {
  const f = useCurrentFrame()
  const t = sec(f)
  const p1 = 4.4
  const p2 = 13.8
  if (t < p1) {
    return (
      <DemoScene
        step="06 · PROOF"
        title="It's real"
        sub="Open source. English and Spanish."
        clipAt={play(M.how, M.end - 0.2, 0.2)}
        camera={[
          [0, 1, 422],
          [3, 1.05, 500],
        ]}
      />
    )
  }
  const second = t >= p2
  return (
    <BrandBg>
      <BrowserWindow
        src={second ? 'clips/proof2.webm' : 'clips/proof1.webm'}
        time={9 + (t - (second ? p2 : p1)) * 0.25}
        local={t - (second ? p2 : p1)}
        label={second ? 'Real sweep #2 · add to stake · 747.25669 NIM' : 'Real sweep #1 · new stake · 266.55895 NIM'}
      />
    </BrandBg>
  )
}

// ---------------------------------------------------------------- OUTRO

const RAIN = ['$2.40', '$7.10', '$0.85', '$4.25', '$12.75', '$1.30', '$3.40', '$9.60']
/** Round-ups under Spare's rule (per-payment step) for the amounts above, summed for the counter. */
const RAIN_COINS = [0.6, 0.9, 0.05, 0.75, 0.25, 0.65, 0.6, 0.4]

export function S11() {
  const f = useCurrentFrame()
  const landed = RAIN.map((_, i) => f > 26 + i * 16)
  const total = RAIN_COINS.reduce((s, c, i) => s + (landed[i] ? c : 0), 0)
  const morph = clampI(f, [170, 215], [0, 1])
  return (
    <BrandBg>
      {RAIN.map((amt, i) => {
        const local = f - i * 16
        const y = interpolate(local, [0, 40], [-120, 380 + (i % 3) * 70], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease })
        const o = clampI(local, [0, 8, 50, 70], [0, 1, 1, 0]) * (1 - morph)
        return (
          <div
            key={i}
            style={{ position: 'absolute', left: 240 + (i % 4) * 190, top: y, opacity: o, background: '#fff', borderRadius: 18, padding: '14px 22px', fontSize: 30, fontWeight: 750, color: C.ink, boxShadow: '0 14px 30px rgba(23,34,30,0.15)', fontFamily: FONT }}
          >
            {amt}
          </div>
        )
      })}
      {/* Tower: one coin per landed payment. */}
      <div style={{ position: 'absolute', left: 1240, bottom: 260, width: 220, opacity: 1 - morph, transform: `scale(${1 - 0.4 * morph})` }}>
        {RAIN_COINS.map((_, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 20,
              bottom: i * 38,
              width: 180,
              height: 44,
              borderRadius: 999,
              background: `linear-gradient(180deg, #f08a66, ${C.coral})`,
              boxShadow: '0 6px 12px rgba(226,100,63,0.25)',
              opacity: landed[i] ? 1 : 0,
              transform: `translateY(${landed[i] ? 0 : -40}px)`,
            }}
          />
        ))}
      </div>
      <div style={{ position: 'absolute', left: 1180, top: 210, width: 340, textAlign: 'center', fontFamily: FONT, opacity: 1 - morph }}>
        <div style={{ fontSize: 26, color: C.ink2, fontWeight: 650 }}>Spare change</div>
        <div style={{ fontSize: 72, color: C.green, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>${total.toFixed(2)}</div>
      </div>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 90, opacity: morph, transform: `scale(${0.85 + 0.15 * morph})` }}>
        <div style={{ position: 'relative', width: 400, height: 400, display: 'grid', placeItems: 'center' }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <StakeRing progress={1} pulse={0.3} />
          </div>
          <Mark size={150} />
        </div>
      </div>
    </BrandBg>
  )
}

export function S12() {
  const a = useSpring(0)
  const b = useSpring(14)
  const c = useSpring(28)
  return (
    <BrandBg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingBottom: 110, fontFamily: FONT }}>
        <div style={{ opacity: a, transform: `scale(${0.9 + 0.1 * a})` }}>
          <Mark size={150} />
        </div>
        <div style={{ opacity: a, fontSize: 76, fontWeight: 800, color: C.ink, letterSpacing: -1.5, marginTop: 22 }}>Spare: round-ups for Nimiq Pay</div>
        <div style={{ opacity: b, transform: `translateY(${(1 - b) * 14}px)`, marginTop: 26, display: 'flex', gap: 22 }}>
          <span style={{ background: C.green, color: '#fff', fontSize: 36, fontWeight: 750, padding: '12px 28px', borderRadius: 999 }}>spare-dun.vercel.app</span>
          <span style={{ background: '#fff', color: C.ink, fontSize: 36, fontWeight: 650, padding: '12px 28px', borderRadius: 999, border: `2px solid ${C.paper2}` }}>github.com/SohamJuneja/spare</span>
        </div>
        <div style={{ opacity: c, marginTop: 30, fontSize: 26, color: C.ink2, fontWeight: 600 }}>Nimiq Mini Apps Competition · Cycle III · Save</div>
      </div>
    </BrandBg>
  )
}
