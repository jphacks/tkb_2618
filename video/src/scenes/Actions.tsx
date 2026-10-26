import { useCurrentFrame } from 'remotion'
import { ACTS } from '../../../app/src/shared/constants'
import { Caption, Enter, Key, MUTED, Page, key } from '../common'

/** The 7 kinds of action a key can run, with the app's own icon and color for each, and what it does (README's table). */
export const ACTIONS_FRAMES = 210
const CAPTION = 'キーに割り当てられる操作は 7 種類'
const EXAMPLES = ['Ctrl+C など', 'アプリ・URL を開く', '再生・音量・ミュート', 'コマンドを実行', 'URL に POST', '割り当てを切り替える', '入力を止める']
export const ACTIONS_TEXT = [CAPTION, ...EXAMPLES].join(' ')
const COLUMN = 240, GAP = 12, KEY = 140, TOP = 320
const LEFT = (1920 - ACTS.length * COLUMN - (ACTS.length - 1) * GAP) / 2

export function Actions() {
  const frame = useCurrentFrame()
  return <Page>
    {ACTS.map((act, i) => <Enter key={act.type} at={6 + i * 6} frame={frame} style={{ position: 'absolute', left: LEFT + i * (COLUMN + GAP), top: TOP, width: COLUMN, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
      <Key value={key(act.icon, act.color)} size={KEY} />
      <span style={{ fontSize: 32 }}>{act.name}</span>
      <span style={{ fontSize: 22, color: MUTED, textAlign: 'center', lineHeight: '32px' }}>{EXAMPLES[i]}</span>
    </Enter>)}
    <Caption>{CAPTION}</Caption>
  </Page>
}
