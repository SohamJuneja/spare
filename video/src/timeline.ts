// Scene timing is driven by the measured VO durations (vo/durations.json), never the other way round.
import durations from './durations.json'

export const FPS = 30
export const LEAD_IN = 0.4

/** Seconds of visuals after each VO line ends (room for the animation / screen action to land). */
const PAD: Record<string, number> = {
  '01': 2.4,
  '02': 1.7,
  '03': 2.6,
  '04': 3.2,
  '05': 3.8,
  '06': 3.3,
  '07': 5.8,
  '08': 7.6,
  '09': 5.0,
  '10': 11.0,
  '11': 5.4,
  '12': 4.6,
}

export interface Scene {
  id: string
  text: string
  vo: number
  start: number
  duration: number
  from: number
  frames: number
}

let t = 0
export const SCENES: Scene[] = (durations as { id: string; text: string; duration: number }[]).map((d) => {
  const duration = LEAD_IN + d.duration + PAD[d.id]
  const s = { id: d.id, text: d.text, vo: d.duration, start: t, duration, from: Math.round(t * FPS), frames: Math.round(duration * FPS) }
  t += duration
  return s
})

export const TOTAL_FRAMES = SCENES.reduce((n, s) => n + s.frames, 0)
export const scene = (id: string) => SCENES.find((s) => s.id === id)!

export const C = {
  paper: '#f5f2ea',
  paper2: '#ece7db',
  ink: '#17221e',
  ink2: '#55625c',
  green: '#0f6e55',
  greenLight: '#3cc495',
  coral: '#e2643f',
  dark: '#0e1412',
  dark2: '#17201c',
}
export const FONT = "'Segoe UI', ui-rounded, system-ui, -apple-system, Roboto, sans-serif"
