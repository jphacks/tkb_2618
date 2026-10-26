import { interpolate, useCurrentFrame } from 'remotion'
import { Caption, Enter, Page } from '../common'
import { Settings, T, WINDOW } from '../app-ui/Settings'

/** Whole window on screen, and the close-up used while dragging (window coordinates: desk map's right half and the side panel). */
const WIDE = { scale: 1.04, top: 36 }
const CLOSE = { scale: 1.5, x: 560, y: 40 }
/** The window is clipped above the caption band. */
const VIEW_HEIGHT = 880
/** The camera moves in before the press and back out after the drop. */
const ZOOM_IN = [T.enter + 6, T.press - 4] as const, ZOOM_OUT = [T.drop + 26, T.drop + 56] as const
export const SETTINGS_FRAMES = ZOOM_OUT[1] + 36

function camera(frame: number) {
  const ease = { easing: (t: number) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
  const t = interpolate(frame, ZOOM_IN, [0, 1], ease) - interpolate(frame, ZOOM_OUT, [0, 1], ease)
  const wide = { scale: WIDE.scale, x: (1920 - WINDOW.width * WIDE.scale) / 2, y: WIDE.top }
  // Close-up: the window from CLOSE.x to its right edge, centered; CLOSE.y at the top of the screen.
  const close = { scale: CLOSE.scale, x: (1920 - (WINDOW.width - CLOSE.x) * CLOSE.scale) / 2 - CLOSE.x * CLOSE.scale, y: -CLOSE.y * CLOSE.scale }
  return { scale: wide.scale + (close.scale - wide.scale) * t, x: wide.x + (close.x - wide.x) * t, y: wide.y + (close.y - wide.y) * t }
}

export function SettingsScene({ still = false }: { still?: boolean }) {
  const current = useCurrentFrame()
  const frame = still ? ZOOM_OUT[1] : current
  const cam = still ? camera(0) : camera(frame)
  return <Page>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: VIEW_HEIGHT, overflow: 'hidden' }}>
      <Enter frame={frame} style={{ position: 'absolute', left: cam.x, top: cam.y, transformOrigin: 'top left' }}>
        <div style={{ transform: `scale(${cam.scale})`, transformOrigin: 'top left' }}><Settings frame={frame} /></div>
      </Enter>
    </div>
    {!still && <Caption>キーごとに、操作をドラッグで割り当てる</Caption>}
  </Page>
}
