import { Composition } from 'remotion'
import { DEMO_FRAMES, DemoCore } from './DemoCore'
import { FPS } from './timeline'

// v2: the composition is the demo section only. Intro/outro come as separate files (see assemble.ps1).
export function Root() {
  return <Composition id="DemoCore" component={DemoCore} durationInFrames={DEMO_FRAMES} fps={FPS} width={1920} height={1080} />
}
