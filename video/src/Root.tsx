import { AbsoluteFill, Audio, Composition, Sequence, staticFile } from 'remotion'
import { S01, S02, S03, S04, S05, S06, S07, S08, S09, S10, S11, S12 } from './Scenes'
import { FPS, LEAD_IN, SCENES, TOTAL_FRAMES } from './timeline'
import { Caption } from './ui'

const VIEWS: Record<string, () => React.JSX.Element> = { '01': S01, '02': S02, '03': S03, '04': S04, '05': S05, '06': S06, '07': S07, '08': S08, '09': S09, '10': S10, '11': S11, '12': S12 }
const DARK = new Set(['01', '02', '03', '04'])

function SpareDemo() {
  return (
    <AbsoluteFill style={{ background: '#0e1412' }}>
      {SCENES.map((s) => {
        const View = VIEWS[s.id]
        return (
          <Sequence key={s.id} from={s.from} durationInFrames={s.frames} name={`Scene ${s.id}`}>
            <View />
            <Sequence from={Math.round(LEAD_IN * FPS)}>
              <Audio src={staticFile(`vo/${s.id}.mp3`)} />
            </Sequence>
            <Caption text={s.text} durationFrames={s.frames} dark={DARK.has(s.id)} />
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}

export function Root() {
  return <Composition id="SpareDemo" component={SpareDemo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />
}
