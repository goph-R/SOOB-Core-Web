// mobile.ts — touch-device polish: a rotate-to-<orientation> prompt, an optional
// fullscreen toggle (with orientation lock where supported), and guards
// against the browser zoom/scroll gestures that interfere with play.
//
// Desktop is unaffected: the overlay and button only appear on coarse
// pointers, and the gesture guards are no-ops without touch input.

import { appInfo } from './appinfo'

const isTouch = () => matchMedia('(pointer: coarse)').matches
const isPortrait = () => window.innerHeight > window.innerWidth

// The game says which way up it wants to be (app.lua's `orientation`); the
// prompt appears whenever the device disagrees. initMobile therefore has to
// run AFTER loadAppInfo, or this reads the default.
const wantPortrait = () => appInfo().orientation === 'portrait'

// Element.requestFullscreen exists on Android Chrome etc.; iOS Safari lacks it
// (only <video> goes fullscreen there), so we hide the button when unsupported.
function fsSupported(): boolean {
  return !!(document.documentElement.requestFullscreen || (document.documentElement as unknown as
    { webkitRequestFullscreen?: unknown }).webkitRequestFullscreen)
}
function inFullscreen(): boolean {
  return !!(document.fullscreenElement || (document as unknown as { webkitFullscreenElement?: unknown }).webkitFullscreenElement)
}

function setupOrientationOverlay() {
  const overlay = document.getElementById('rotate')
  if (!overlay) return
  const label = document.getElementById('rotate-text')
  // Not localised — a game that needs other languages should set this itself.
  if (label) label.textContent = `Please rotate to ${appInfo().orientation}`
  const update = () => {
    overlay.style.display = (isTouch() && isPortrait() !== wantPortrait()) ? 'flex' : 'none'
  }
  update()
  window.addEventListener('resize', update)
  window.addEventListener('orientationchange', update)
}

function setupFullscreenButton() {
  const btn = document.getElementById('fs') as HTMLButtonElement | null
  if (!btn || !isTouch() || !fsSupported()) return
  btn.style.display = 'block'

  btn.addEventListener('click', async () => {
    try {
      const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }
      if (!inFullscreen()) {
        await (el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.())
        // Lock to the game's orientation once fullscreen (only allowed in
        // fullscreen / PWA).
        const orient = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined
        await orient?.lock?.(appInfo().orientation).catch(() => {})
      } else {
        await document.exitFullscreen?.()
      }
    } catch { /* user gesture / permission issues — ignore */ }
  })
  const sync = () => { btn.textContent = inFullscreen() ? '⤢' : '⛶' }
  document.addEventListener('fullscreenchange', sync)
}

function setupGestureGuards() {
  // iOS pinch-zoom
  document.addEventListener('gesturestart', e => e.preventDefault())
  document.addEventListener('gesturechange', e => e.preventDefault())
  // double-tap-to-zoom (belt-and-braces alongside touch-action: none)
  let lastTouch = 0
  document.addEventListener('touchend', e => {
    const now = e.timeStamp
    if (now - lastTouch < 300) e.preventDefault()
    lastTouch = now
  }, { passive: false })
}

export function initMobile() {
  setupGestureGuards()
  setupOrientationOverlay()
  setupFullscreenButton()
}
