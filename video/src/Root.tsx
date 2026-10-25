import type { ComponentType } from 'react'
import { AbsoluteFill, Composition, Series, Still, interpolate, useCurrentFrame } from 'remotion'
import { ACTS, DEFAULT_CONFIG, REGIONS } from '../../app/src/shared/constants'
import { BG, Fonts } from './common'
import { Answer } from './scenes/Answer'
import { Calibration } from './scenes/Calibration'
import { Demo } from './scenes/Demo'
import { How } from './scenes/How'
import { Keys } from './scenes/Keys'
import { Problem } from './scenes/Problem'
import { SettingsScene } from './scenes/Settings'
import { End, Title } from './scenes/Title'
import './base.css'

const SCENES: { component: ComponentType; frames: number }[] = [
  { component: Title, frames: 120 },
  { component: Problem, frames: 210 },
  { component: Answer, frames: 120 },
  { component: Keys, frames: 180 },
  { component: Demo, frames: 570 },
  { component: How, frames: 270 },
  { component: SettingsScene, frames: 270 },
  { component: Calibration, frames: 180 },
  { component: End, frames: 120 }
]
/** Scenes overlap by this many frames: the outgoing one fades out over the first half, the incoming one fades in over the second. */
const FADE = 8
const TOTAL = SCENES.reduce((sum, s) => sum + s.frames, 0)
/** Every string on screen, so the fonts for all of them are loaded before the first frame. */
const TEXT = [
  'DaaS ふだんの机を入力デバイスに。 github.com/jphacks/tkb_2618',
  '手がふさがっている作業中でもデバイスを操作したい！ 勉強 ペンを持ったまま、参考資料をめくりたい 料理中 手が汚れたまま、レシピの次を見たい 電子工作 こてを持ったまま、回路図を参照したい',
  '机をノックして、PC を操作する。 DaaS = Desktop as a Service 4 か所 × 1 回 / 2 回 = 8 つの操作',
  '机をたたくデモ 机を叩くと、割り当てたアプリが開く',
  'ピエゾ × 4 XIAO ESP32S3 PC アプリ 操作 左上 · 1 回 机の裏の 4 か所に貼ったピエゾが、叩いた振動を拾う マイコンは、4 ch の波形をそのまま PC に送る アプリが 4 ch の振れ方から、叩いた場所と回数を見分ける',
  'キーごとに、操作をドラッグで割り当てる POST https://[YOUR WEBHOOK URL] はじめに 4 か所を 3 回ずつ叩いて、机に合わせる',
  ...REGIONS, ...ACTS.map(a => a.name), ...DEFAULT_CONFIG.profiles.map(p => p.name)
].join(' ')

function Fade({ component: Scene, duration, first, last }: { component: ComponentType; duration: number; first: boolean; last: boolean }) {
  const frame = useCurrentFrame()
  const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
  const fadeIn = first ? 1 : interpolate(frame, [FADE / 2, FADE], [0, 1], clamp)
  const fadeOut = last ? 1 : interpolate(frame, [duration - FADE, duration - FADE / 2], [1, 0], clamp)
  return <AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut) }}><Scene /></AbsoluteFill>
}

function Movie() {
  return <Fonts text={TEXT}><AbsoluteFill style={{ background: BG }}><Series>
    {SCENES.map((scene, i) => {
      const last = i === SCENES.length - 1, duration = scene.frames + (last ? 0 : FADE)
      return <Series.Sequence key={i} durationInFrames={duration} offset={i === 0 ? 0 : -FADE}>
        <Fade component={scene.component} duration={duration} first={i === 0} last={last} />
      </Series.Sequence>
    })}
  </Series></AbsoluteFill></Fonts>
}

/** README images: the same scenes, frozen once their animation has settled. */
const STILLS: [string, ComponentType<{ still?: boolean }>][] = [
  ['readme-hero', Title], ['readme-problem', Problem], ['readme-keys', Keys], ['readme-how', How], ['readme-settings', SettingsScene]
]

export function Root() {
  return <>
    <Composition id="DaaS" component={Movie} durationInFrames={TOTAL} fps={30} width={1920} height={1080} />
    {STILLS.map(([id, Scene]) => <Still key={id} id={id} width={1920} height={1080} component={() => <Fonts text={TEXT}><Scene still /></Fonts>} />)}
  </>
}
