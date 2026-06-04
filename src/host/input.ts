// input.ts — DOM events → engine hooks (onMouse*/onKey*/onTextInput) plus the
// held-state the polling bindings (keyDown/mousePos/mouseDown/keyModifiers)
// read. Pointer coords are converted to the virtual canvas with the same
// center-origin / Y-down transform the desktop host uses.

import * as lua from './lua'
import { viewW, viewH } from './gl'

let canvas: HTMLCanvasElement
let mvx = 0, mvy = 0
const buttons = new Set<number>()
const held = new Set<string>()
let mShift = false, mCtrl = false, mAlt = false

function toVirtual(clientX: number, clientY: number): [number, number] {
  const r = canvas.getBoundingClientRect()
  const nx = (clientX - r.left) / r.width
  const ny = (clientY - r.top) / r.height
  return [(nx - 0.5) * viewW(), (ny - 0.5) * viewH()]
}

function pointerButton(e: PointerEvent): number {
  return e.button === 1 ? 2 : e.button === 2 ? 3 : 1 // 0→left(1), 1→middle(2), 2→right(3)
}

// Map a KeyboardEvent to SDL_GetKeyName's lowercase form (the convention the
// Lua code expects: "space", "escape", "left", "a", "1", "f1", "return", …).
function keyName(e: KeyboardEvent): string {
  const k = e.key
  if (k.length === 1) {
    if (k === ' ') return 'space'
    return k.toLowerCase()
  }
  switch (k) {
    case 'Enter': return 'return'
    case 'Escape': return 'escape'
    case 'Backspace': return 'backspace'
    case 'Delete': return 'delete'
    case 'Tab': return 'tab'
    case 'ArrowLeft': return 'left'
    case 'ArrowRight': return 'right'
    case 'ArrowUp': return 'up'
    case 'ArrowDown': return 'down'
    case 'Home': return 'home'
    case 'End': return 'end'
    default: return k.toLowerCase()
  }
}

// Keys whose browser default we suppress (navigation / scroll / focus).
const CONSUME = new Set(['backspace', 'tab', 'space', 'left', 'right', 'up', 'down'])

// Park the virtual cursor off-canvas so hover/highlight state clears — touch
// has no pointer-leave, so a tapped button would otherwise stay lit.
function clearHover() {
  mvx = -1e5; mvy = -1e5
  lua.mouseMove(mvx, mvy, 0, 0)
}

export function attachInput(cv: HTMLCanvasElement) {
  canvas = cv

  cv.addEventListener('contextmenu', e => e.preventDefault())

  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture?.(e.pointerId)
    const [x, y] = toVirtual(e.clientX, e.clientY)
    mvx = x; mvy = y
    const b = pointerButton(e)
    buttons.add(b)
    lua.mouseDown(x, y, b)
  })
  cv.addEventListener('pointerup', e => {
    const [x, y] = toVirtual(e.clientX, e.clientY)
    mvx = x; mvy = y
    const b = pointerButton(e)
    buttons.delete(b)
    lua.mouseUp(x, y, b)
    if (e.pointerType === 'touch') clearHover() // no hover on touch — don't leave a button lit
  })
  cv.addEventListener('pointercancel', e => {
    const b = pointerButton(e)
    buttons.delete(b)
    lua.mouseUp(mvx, mvy, b)
    clearHover()
  })
  cv.addEventListener('pointermove', e => {
    const [x, y] = toVirtual(e.clientX, e.clientY)
    const r = cv.getBoundingClientRect()
    const dx = (e.movementX || 0) / r.width * viewW()
    const dy = (e.movementY || 0) / r.height * viewH()
    mvx = x; mvy = y
    lua.mouseMove(x, y, dx, dy)
  })
  cv.addEventListener('wheel', e => {
    e.preventDefault()
    const [x, y] = toVirtual(e.clientX, e.clientY)
    lua.mouseDown(x, y, e.deltaY < 0 ? 4 : 5)
  }, { passive: false })

  window.addEventListener('keydown', e => {
    mShift = e.shiftKey; mCtrl = e.ctrlKey; mAlt = e.altKey
    const name = keyName(e)
    // Stop the browser acting on keys the game uses: Backspace navigates back
    // in older browsers (Mypal!), Space/arrows scroll, Tab moves focus off the
    // canvas. Leave modifier chords (Ctrl/Meta) alone so F5/devtools still work.
    if (!e.ctrlKey && !e.metaKey && CONSUME.has(name)) e.preventDefault()
    held.add(name)
    lua.keyDown(name)
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      lua.textInput(e.key)
    }
  })
  window.addEventListener('keyup', e => {
    mShift = e.shiftKey; mCtrl = e.ctrlKey; mAlt = e.altKey
    const name = keyName(e)
    held.delete(name)
    lua.keyUp(name)
  })
}

// ---- polling state (read by the bindings) ----
export const inputState = {
  keyDown: (name: string) => held.has(name),
  mouseX: () => mvx,
  mouseY: () => mvy,
  mouseDown: (b: number) => buttons.has(b),
  keyMods: () => (mShift ? 1 : 0) | (mCtrl ? 2 : 0) | (mAlt ? 4 : 0),
}
