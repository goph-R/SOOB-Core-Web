// bindings.ts — the host object the WASM bridge calls (globalThis.__SOOB).
//
// Each method is the web implementation of one SOOB binding. drawRegion ports
// the geometry from script.h's scrDrawRegion (align / fill / src-rect / dst /
// flip → UVs + dest rect); the rest delegate to gl / text / assets / input.
// Audio + blur are M1 stubs (see SOOB-Core-Web.md milestones).

import * as gl from './gl'
import * as assets from './assets'
import * as audio from './audio'
import { drawText as drawTextGl, measure } from './text'
import { inputState } from './input'

type Col = [number, number, number, number]

function drawRegion(name: string, a: Float64Array) {
  const rg = assets.getRegion(name)
  if (!rg) { console.warn('drawRegion: unknown region', name); return }
  const te = assets.getTexture(rg.tex)
  if (!te || !te.tex || te.w <= 0) return // texture not loaded
  const tw = te.w, th = te.h

  const x = a[0], y = a[1]
  let align = a[2] | 0
  const flip = a[3] | 0
  let fx = a[4], fy = a[5]
  const sx = a[6], sy = a[7], rot = a[8]
  const col: Col = [a[9], a[10], a[11], a[12]]
  const hasSrcX = a[13], srcX = a[14], hasSrcY = a[15], srcY = a[16]
  const hasSrcW = a[17], srcW = a[18], hasSrcH = a[19], srcH = a[20]
  const hasDstW = a[21], dstW = a[22], hasDstH = a[23], dstH = a[24]

  fx = Math.max(0, Math.min(1, fx))
  fy = Math.max(0, Math.min(1, fy))

  const effSx = rg.x + (hasSrcX ? srcX : 0)
  const effSy = rg.y + (hasSrcY ? srcY : 0)
  const effSw = hasSrcW ? srcW : rg.w
  const effSh = hasSrcH ? srcH : rg.h

  let alignH = align & 7, alignV = align & 56
  if (alignH === 0) alignH = 1   // LEFT
  if (alignV === 0) alignV = 8   // TOP

  const visSw = effSw * fx, visSh = effSh * fy

  let x0: number, x1: number
  if (alignH === 1) { x0 = effSx; x1 = effSx + visSw }
  else if (alignH === 4) { x0 = effSx + effSw - visSw; x1 = effSx + effSw }
  else { x0 = effSx + (effSw - visSw) / 2; x1 = x0 + visSw }

  let y0: number, y1: number
  if (alignV === 8) { y0 = effSy; y1 = effSy + visSh }
  else if (alignV === 32) { y0 = effSy + effSh - visSh; y1 = effSy + effSh }
  else { y0 = effSy + (effSh - visSh) / 2; y1 = y0 + visSh }

  const dw = hasDstW ? dstW : visSw * sx
  const dh = hasDstH ? dstH : visSh * sy
  let dx: number, dy: number
  if (alignH === 1) dx = x; else if (alignH === 4) dx = x - dw; else dx = x - dw / 2
  if (alignV === 8) dy = y; else if (alignV === 32) dy = y - dh; else dy = y - dh / 2

  let u0 = x0 / tw, u1 = x1 / tw, v0 = y0 / th, v1 = y1 / th
  if (flip & 1) { const t = u0; u0 = u1; u1 = t }
  if (flip & 2) { const t = v0; v0 = v1; v1 = t }

  gl.drawQuadTex(te.tex, dx, dy, dw, dh, u0, v0, u1, v1, col, rot)
}

function drawText(text: string, font: string, a: Float64Array) {
  const fe = assets.getFont(font || null)
  if (!fe || !fe.data || !fe.tex) return
  drawTextGl(fe.data, fe.tex, text, a[0], a[1], a[2], a[3] | 0, [a[4], a[5], a[6], a[7]])
}

function drawQuad(a: Float64Array) {
  gl.drawSolidQuad(a[0], a[1], a[2], a[3], [a[4], a[5], a[6], a[7]])
}

function drawEllipse(a: Float64Array) {
  gl.drawEllipseRibbon(a[0], a[1], a[2], a[3], a[4], a[5], a[6] | 0, a[7], [a[8], a[9], a[10], a[11]])
}

// Cover-fit a region to the whole view (CSS background-size: cover), cropping
// the longer axis via UV.
function drawBg(name: string) {
  const rg = assets.getRegion(name)
  if (!rg) return
  const te = assets.getTexture(rg.tex)
  if (!te || !te.tex || te.w <= 0) return
  const vw = gl.viewW(), vh = gl.viewH()
  const ra = rg.w / rg.h, va = vw / vh
  let sw = rg.w, sh = rg.h
  if (ra > va) sw = rg.h * va        // crop width
  else sh = rg.w / va                // crop height
  const sx = rg.x + (rg.w - sw) / 2, sy = rg.y + (rg.h - sh) / 2
  gl.drawQuadTex(
    te.tex, -vw / 2, -vh / 2, vw, vh,
    sx / te.w, sy / te.h, (sx + sw) / te.w, (sy + sh) / te.h, [1, 1, 1, 1],
  )
}

function drawBlur(name: string, width: number, alpha: number) {
  const rg = assets.getRegion(name)
  if (!rg) return
  const te = assets.getTexture(rg.tex)
  if (!te || !te.tex || te.w <= 0) return
  const u0 = rg.x / te.w, v0 = rg.y / te.h, u1 = (rg.x + rg.w) / te.w, v1 = (rg.y + rg.h) / te.h
  gl.drawBlur(`${name}:${width}`, te.tex, u0, v0, u1, v1, rg.w, rg.h, width, alpha)
}

export function installBindings() {
  const host = {
    drawRegion, drawText, drawQuad, drawEllipse, drawBg, drawBlur,

    viewW: () => gl.viewW(),
    viewH: () => gl.viewH(),
    regionW: (n: string) => assets.regionW(n),
    regionH: (n: string) => assets.regionH(n),
    regionSlice: (n: string) => assets.regionSlice(n),
    textWidth: (t: string, f: string, scale: number) => {
      const fe = assets.getFont(f || null)
      return fe?.data ? measure(fe.data, t, scale) : 0
    },

    keyDown: inputState.keyDown,
    mouseX: inputState.mouseX,
    mouseY: inputState.mouseY,
    mouseDown: inputState.mouseDown,
    keyMods: inputState.keyMods,

    soundPlay: (n: string) => audio.soundPlay(n),
    musicPlay: (n: string, f: number, l: boolean) => audio.musicPlay(n, f, l),
    musicStop: (f: number) => audio.musicStop(f),
    musicVolume: (g: number) => audio.musicVolume(g),

    showMessage: (t: string, _s: number) => console.log('[message]', t),
    requestQuit: () => console.log('requestQuit: no-op on web'),

    // Persistence: the bridge serializes the opts table to a `return {...}`
    // chunk; we stash it under the same name as the desktop save file.
    optSave: (s: string) => { try { localStorage.setItem('find5.dat', s) } catch { /* private mode */ } },
    optLoad: (): string | null => { try { return localStorage.getItem('find5.dat') } catch { return null } },

    registerSound: assets.registerSound,
    registerMusic: assets.registerMusic,
    registerTexture: assets.registerTexture,
    registerFont: assets.registerFont,
    registerRegion: assets.registerRegion,
  }
  ;(globalThis as unknown as { __SOOB: typeof host }).__SOOB = host
}
