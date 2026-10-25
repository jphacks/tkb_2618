import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { AbsoluteFill, Img, cancelRender, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame } from 'remotion'
import { Icon } from '../../app/src/renderer/src/Icon'
import { colorOf } from '../../app/src/shared/constants'
import type { ColorId, DeskKey, IconId } from '../../app/src/shared/types'

export { Icon }
export const FPS = 30
export const BG = '#121212', FG = '#EDEDED', MUTED = '#8A8A8A', SURFACE = '#1A1A1A', FIELD = '#262626'
export const FONT = '"LINE Seed JP", sans-serif'
/** Center line of the caption band shared by every explanatory scene. */
export const CAPTION_Y = 930

/** Holds the render until LINE Seed JP has every glyph of `text`, so no frame falls back to another font. */
export function Fonts({ text, children }: { text: string; children: ReactNode }) {
  const [handle] = useState(() => delayRender(`LINE Seed JP: ${text.slice(0, 20)}`))
  useEffect(() => {
    Promise.all([400, 700, 800].map(weight => document.fonts.load(`${weight} 40px "LINE Seed JP"`, text)))
      .then(() => continueRender(handle)).catch(cancelRender)
  }, [handle, text])
  return <>{children}</>
}

export function Page({ children, logo = true }: { children: ReactNode; logo?: boolean }) {
  return <AbsoluteFill style={{ background: BG, color: FG, fontFamily: FONT, fontWeight: 700 }}>
    {children}
    {logo && <Logo />}
  </AbsoluteFill>
}

export function Logo({ height = 100, style }: { height?: number; style?: CSSProperties }) {
  return <Img src={staticFile('brand/gtm-logo.png')} style={{ position: 'absolute', left: 40, bottom: 32, height, ...style }} />
}

/** 0 → 1 with the flat spring every element uses to enter. */
export function useEnter(at = 0, frame?: number): number {
  const current = useCurrentFrame()
  const t = (frame ?? current) - at
  return t < 0 ? 0 : spring({ frame: t, fps: FPS, config: { damping: 18 } })
}

export function Enter({ children, at = 0, frame, style }: { children: ReactNode; at?: number; frame?: number; style?: CSSProperties }) {
  const s = useEnter(at, frame)
  return <div style={{ opacity: Math.min(1, s), transform: `scale(${0.85 + 0.15 * s})`, ...style }}>{children}</div>
}

export function Caption({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return <div style={{ position: 'absolute', left: 240, right: 240, top: CAPTION_Y - 28, textAlign: 'center' }}>
    <div style={{ fontSize: 40, lineHeight: '56px' }}>{children}</div>
    {sub && <div style={{ fontSize: 24, color: MUTED, marginTop: 14 }}>{sub}</div>}
  </div>
}

/** The ring a key throws when it fires (`dk-ripple` in the app: 0.6 s, scale 1 → 1.35). */
export function Ripple({ age, color = FG, width = 3, radius = 'inherit' }: { age: number; color?: string; width?: number; radius?: CSSProperties['borderRadius'] }) {
  if (age < 0 || age >= 18) return null
  const t = interpolate(age, [0, 18], [0, 1], { easing: t => 1 - (1 - t) ** 2 })
  return <span style={{ position: 'absolute', inset: -width, border: `${width}px solid ${color}`, borderRadius: radius, transform: `scale(${1 + 0.35 * t})`, opacity: 0.95 * (1 - t), pointerEvents: 'none' }} />
}

/** `dk-bump` in the app: scale 1 → 0.9 → 1 over 0.32 s. */
export function bump(age: number): number {
  if (age < 0 || age >= 10) return 1
  return age < 3.5 ? interpolate(age, [0, 3.5], [1, 0.9]) : interpolate(age, [3.5, 10], [0.9, 1])
}

export const key = (icon: IconId, color: ColorId, slash = false): DeskKey => ({ icon, color, slash, action: { type: 'lock' } })

/**
 * A key exactly as the app draws it (`.dk-key`, `.bracket`, `KeyFace`), scaled from the 96 px original.
 * `age` is frames since the key fired; it bumps and throws a ring in its own color. `iconPath` draws an icon the app lacks.
 */
export function Key({ value, size = 96, age = -1, selected = false, iconPath, style }: { value: DeskKey | null; size?: number; age?: number; selected?: boolean; iconPath?: string; style?: CSSProperties }) {
  const u = size / 96
  const [, bg, fg] = value ? colorOf(value.color) : [null, 'transparent', '#3A3A3A']
  const bracket: CSSProperties = { position: 'absolute', width: 24 * u, height: 24 * u, opacity: 0.6, borderColor: 'currentColor', borderStyle: 'solid', borderWidth: 0 }
  return <div style={{
    width: size, height: size, borderRadius: 24 * u, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    background: bg, color: fg, border: value ? 0 : `${Math.max(2, 2 * u)}px dashed #2E2E2E`, transform: `scale(${bump(age)})`, ...style
  }}>
    {selected && <span style={{ position: 'absolute', inset: -5 * u, border: `${2 * u}px solid ${FG}`, borderRadius: 29 * u }} />}
    {value && <>
      <span style={{ ...bracket, left: 9 * u, top: 9 * u, borderTopWidth: 2 * u, borderLeftWidth: 2 * u, borderTopLeftRadius: 14 * u }} />
      <span style={{ ...bracket, right: 9 * u, bottom: 9 * u, borderBottomWidth: 2 * u, borderRightWidth: 2 * u, borderBottomRightRadius: 14 * u }} />
    </>}
    {iconPath
      ? <svg width={44 * u} height={44 * u} viewBox="0 0 24 24" aria-hidden="true"><path d={iconPath} fill="currentColor" /></svg>
      : <Icon name={value?.icon ?? 'plus'} size={(value ? 44 : 22) * u} slash={value?.slash} bg={bg} />}
    <Ripple age={age} color={value ? bg : FG} width={3 * u} />
  </div>
}
