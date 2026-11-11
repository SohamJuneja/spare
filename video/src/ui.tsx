import type { CSSProperties, ReactNode } from 'react'
import { Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { C, FONT } from './timeline'

export const ease = Easing.bezier(0.16, 1, 0.3, 1)

export function useSpring(delayFrames = 0, config = { damping: 200 }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return spring({ frame: frame - delayFrames, fps, config })
}

export function BrandBg({ children, dark = false }: { children?: ReactNode; dark?: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        fontFamily: FONT,
        background: dark
          ? `radial-gradient(1200px 700px at 50% 40%, #16231e 0%, ${C.dark} 70%)`
          : `radial-gradient(1100px 760px at 50% 38%, #fbf9f3 0%, ${C.paper} 55%, ${C.paper2} 100%)`,
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  )
}

/** Captions burned in below the phone (or at the bottom for animations). Text comes from the VO script. */
export function Caption({ text, durationFrames, dark = false }: { text: string; durationFrames: number; dark?: boolean }) {
  const frame = useCurrentFrame()
  const inO = interpolate(frame, [6, 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const outO = interpolate(frame, [durationFrames - 10, durationFrames - 2], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 34, display: 'flex', justifyContent: 'center', opacity: Math.min(inO, outO), zIndex: 50 }}>
      <div
        style={{
          maxWidth: 1380,
          padding: '14px 28px',
          borderRadius: 18,
          background: dark ? 'rgba(14,20,18,0.82)' : 'rgba(23,34,30,0.86)',
          color: '#fff',
          fontFamily: FONT,
          fontSize: 34,
          lineHeight: 1.3,
          fontWeight: 600,
          textAlign: 'center',
          boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
        }}
      >
        {text}
      </div>
    </div>
  )
}

/** App screen geometry: recordings are 390×844 CSS px captured at 2×. */
export const SCREEN_W = 372
export const SCREEN_H = Math.round((SCREEN_W * 844) / 390)
export const CSS_SCALE = SCREEN_W / 390

/** A neutral phone: rounded slab, thin bezel, no brand shapes, no notch imitation. */
export function Phone({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        width: SCREEN_W + 24,
        height: SCREEN_H + 24,
        borderRadius: 54,
        background: '#1b1f1d',
        padding: 12,
        boxShadow: '0 40px 90px rgba(23,34,30,0.28), 0 8px 24px rgba(23,34,30,0.18), inset 0 0 0 2px #2c322f',
        ...style,
      }}
    >
      <div style={{ position: 'relative', width: SCREEN_W, height: SCREEN_H, borderRadius: 42, overflow: 'hidden', background: C.paper }}>{children}</div>
    </div>
  )
}

/** Frames pre-extracted at 30 fps by video/extract-frames (the app clip already cropped to its 390×844 page). */
const FRAME_COUNT: Record<string, number> = { app: 1148, proof1: 430, proof2: 430 }

/**
 * Shows the recording at an exact clip time (seconds), so scenes can hold or slice freely.
 * Uses still frames instead of <Freeze><OffthreadVideo>, which returned wrong frames late in the clip.
 */
export function ClipFrame({ src, time }: { src: string; time: number; cornerHalf?: boolean }) {
  const name = src.replace(/^clips\//, '').replace(/\.(mp4|webm)$/, '')
  const n = Math.min(FRAME_COUNT[name] - 1, Math.max(0, Math.round(time * 30)))
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <Img src={staticFile(`clips/${name}/${String(n).padStart(5, '0')}.jpg`)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </div>
  )
}

/** Coral ring on a tapped element; box in app CSS px. */
export function TapRing({ box, atFrame }: { box: { x: number; y: number; w: number; h: number }; atFrame: number }) {
  const frame = useCurrentFrame()
  const local = frame - atFrame
  if (local < -4 || local > 34) return null
  const p = interpolate(local, [-4, 10, 34], [0, 1, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease })
  const o = interpolate(local, [-4, 4, 24, 34], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const pad = 10
  return (
    <div
      style={{
        position: 'absolute',
        left: (box.x - pad) * CSS_SCALE,
        top: (box.y - pad) * CSS_SCALE,
        width: (box.w + pad * 2) * CSS_SCALE,
        height: (box.h + pad * 2) * CSS_SCALE,
        borderRadius: 18,
        border: `4px solid ${C.coral}`,
        boxShadow: `0 0 0 ${8 * p}px rgba(226,100,63,0.22)`,
        opacity: o,
        transform: `scale(${1.15 - 0.15 * p})`,
        zIndex: 20,
      }}
    />
  )
}

/** Neutral stand-in for the host's approval sheet, which we never imitate. */
export function ApprovedChip({ atFrame, holdFrames = 50 }: { atFrame: number; holdFrames?: number }) {
  const frame = useCurrentFrame()
  const local = frame - atFrame
  if (local < 0 || local > holdFrames + 12) return null
  const s = interpolate(local, [0, 10], [0.85, 1], { extrapolateRight: 'clamp', easing: ease })
  const o = interpolate(local, [0, 6, holdFrames, holdFrames + 12], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: '42%', display: 'flex', justifyContent: 'center', zIndex: 30, opacity: o }}>
      <div
        style={{
          transform: `scale(${s})`,
          background: '#fff',
          color: C.ink,
          borderRadius: 999,
          padding: '14px 24px',
          fontSize: 22,
          fontWeight: 700,
          fontFamily: FONT,
          boxShadow: '0 18px 40px rgba(0,0,0,0.25)',
          border: `2px solid ${C.green}`,
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ color: C.green }}>✓</span> Approved in Nimiq Pay
      </div>
    </div>
  )
}

export function DemoLabel() {
  return (
    <div
      style={{
        position: 'absolute',
        top: 34,
        right: 40,
        zIndex: 60,
        fontFamily: FONT,
        fontSize: 22,
        fontWeight: 650,
        color: C.ink2,
        background: 'rgba(255,255,255,0.75)',
        border: `1px solid ${C.paper2}`,
        borderRadius: 999,
        padding: '8px 18px',
      }}
    >
      Demo · simulated wallet
    </div>
  )
}

export function SideTitle({ step, title, sub }: { step: string; title: string; sub?: string }) {
  const p = useSpring(4)
  return (
    <div style={{ position: 'absolute', left: 150, top: 300, width: 520, opacity: p, transform: `translateX(${(1 - p) * -30}px)`, fontFamily: FONT }}>
      <div style={{ color: C.coral, fontWeight: 800, fontSize: 26, letterSpacing: 2 }}>{step}</div>
      <div style={{ color: C.ink, fontWeight: 800, fontSize: 60, lineHeight: 1.05, marginTop: 10, letterSpacing: -1 }}>{title}</div>
      {sub && <div style={{ color: C.ink2, fontSize: 28, marginTop: 18, lineHeight: 1.35 }}>{sub}</div>}
    </div>
  )
}

export function Mark({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <rect width="64" height="64" rx="16" fill={C.green} />
      <circle cx="29" cy="36" r="16" fill={C.paper} />
      <circle cx="29" cy="36" r="10" fill="none" stroke={C.green} strokeWidth="3.2" />
      <circle cx="46.5" cy="17.5" r="9" fill={C.coral} />
      <path d="M46.5 12.8v9.4M41.8 17.5h9.4" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" />
    </svg>
  )
}
