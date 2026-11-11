// Demo section only (v2): punchy VO, scene length = VO length, recordings sped up to match.
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from 'remotion'
import durations from './durations-v2.json'
import { B, BrowserWindow, DemoScene, M, play } from './Scenes'
import { FPS } from './timeline'
import { BrandBg, Caption } from './ui'

/** Each line starts this long after its scene starts (the mp3 itself has 250 ms of silence in front). */
export const VO_OFFSET = 0.15
/** Only the last scene holds after its line: nothing follows it, so no gap is created. */
const FINAL_HOLD = 2.6

interface Line {
  id: string
  text: string
  duration: number
}

let acc = 0
export const SCENES_V2 = (durations as Line[]).map((d, i, all) => {
  const duration = VO_OFFSET + d.duration + (i === all.length - 1 ? FINAL_HOLD : 0)
  const s = { ...d, start: acc, from: Math.round(acc * FPS), frames: Math.round(duration * FPS) }
  acc += s.frames / FPS
  return s
})
export const DEMO_FRAMES = SCENES_V2.reduce((n, s) => n + s.frames, 0)

const sec = (f: number) => f / FPS

function D1() {
  const tap = 2.9
  return (
    <DemoScene
      step="01 · CONNECT"
      title="Live inside Nimiq Pay"
      sub="Spare only sees your addresses."
      // "Tap Connect" lands at ~2.9 s; the connect wait plays at half speed so there is no dead hold.
      clipAt={(t) => (t < tap ? 1.0 : Math.min(M.home_loading - 0.05, M.connect_tap - 0.1 + (t - tap) * 0.45))}
      taps={[{ box: 'connect', at: tap - 0.05 }]}
      approvedAt={tap + 0.55}
      camera={[
        [0, 1, 460],
        [1.2, 1.15, 560],
        [8.7, 1.15, 560],
      ]}
    />
  )
}

function D2() {
  return (
    <DemoScene
      step="02 · YOUR PAYMENTS"
      title="Spare change, found"
      sub="Every payment, even through the hidden vaults."
      clipAt={play(M.home_loading, M.home_ready + 0.8, 0)}
      camera={[
        [0, 1, 422],
        [3.6, 1, 422],
        [4.6, 1.45, 210],
        [10.2, 1.45, 210],
      ]}
    />
  )
}

function D3() {
  const start = 0.2
  const rate = 0.84
  const a = M.activity
  const tap = start + (M.not_purchase_tap - a) / rate
  return (
    <DemoScene
      step="03 · ACTIVITY"
      title="Fair round-ups"
      sub="Sized to the payment, never more than half."
      clipAt={play(a, M.home_again - 0.25, start, rate)}
      taps={[{ box: 'notPurchase', at: tap - 0.05 }]}
      camera={[
        [0, 1.25, 330],
        [tap - 0.8, 1.3, 330],
        [tap, 1.45, B.notPurchase.y],
        [8.2, 1.45, B.notPurchase.y],
      ]}
    />
  )
}

function D4() {
  const start = 0.2
  const toTap = 1.7 // "One tap." lands here
  const toDone = 1.7 // then approval → "Done."
  const a = M.home_again
  const tap = start + toTap
  const r1 = (M.sweep_tap - a) / toTap
  const r2 = (M.success - M.sweep_tap) / toDone
  return (
    <DemoScene
      step="04 · SAVE"
      title="One tap into your own stake"
      sub="No custody. No backend."
      clipAt={(t) => {
        if (t < start) return a
        if (t < tap) return a + (t - start) * r1
        if (t < tap + toDone) return M.sweep_tap + (t - tap) * r2
        return Math.min(M.success + 2.2, M.success + (t - tap - toDone) * 0.5)
      }}
      taps={[{ box: 'sweep', at: tap - 0.1 }]}
      approvedAt={tap + 0.45}
      camera={[
        [0, 1.15, B.sweep.y],
        [tap + 1.2, 1.15, B.sweep.y],
        [tap + 2.2, 1.28, 640],
        [10, 1.28, 640],
      ]}
    />
  )
}

function D5() {
  const start = 0.2
  const rate = 0.85
  const a = M.settings
  return (
    <DemoScene
      step="05 · SETTINGS"
      title="Save faster"
      sub="Raise the round-up, or ×2 / ×3."
      clipAt={play(a, M.home_x3 - 0.15, start, rate)}
      taps={[
        { box: 'x2', at: start + (M.mult_x2 - a) / rate - 0.05 },
        { box: 'x3', at: start + (M.mult_x3 - a) / rate - 0.05 },
      ]}
      camera={[[0, 1.3, 330]]}
    />
  )
}

function D6() {
  const f = useCurrentFrame()
  const t = sec(f)
  const p1 = 1.8 // after "And it works for real."
  const p2 = 5.7 // at "then a top-up"
  if (t < p1) {
    return (
      <DemoScene
        step="06 · PROOF"
        title="It works for real"
        sub="Open source. English and Spanish."
        clipAt={play(M.how + 1.2, M.end - 0.2, 0, 1.8)}
        camera={[[0, 1.05, 520]]}
      />
    )
  }
  const second = t >= p2
  return (
    <BrandBg>
      <BrowserWindow
        src={second ? 'clips/proof2.mp4' : 'clips/proof1.mp4'}
        time={9 + (t - (second ? p2 : p1)) * 0.25}
        local={t - (second ? p2 : p1)}
        label={second ? 'Real sweep #2 · add to stake · 747.25669 NIM' : 'Real sweep #1 · new stake · 266.55895 NIM'}
      />
    </BrandBg>
  )
}

const VIEWS: Record<string, () => React.JSX.Element> = { D1, D2, D3, D4, D5, D6 }

export function DemoCore() {
  return (
    <AbsoluteFill style={{ background: '#f5f2ea' }}>
      {SCENES_V2.map((s) => {
        const View = VIEWS[s.id]
        return (
          <Sequence key={s.id} from={s.from} durationInFrames={s.frames} name={`Scene ${s.id}`}>
            <View />
            {/* No premount, no transitions, no startFrom: the whole mp3 (with its 250 ms lead) plays. */}
            <Sequence from={Math.round(VO_OFFSET * FPS)} name={`VO ${s.id}`}>
              <Audio src={staticFile(`vo/${s.id}.mp3`)} />
            </Sequence>
            <Caption text={s.text} durationFrames={s.frames} />
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}
