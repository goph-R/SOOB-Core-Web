// gl.ts — WebGL1 sprite batcher for the SOOB-Core virtual canvas.
//
// Virtual canvas: 480 units tall, center origin, Y growing DOWN, width scaling
// with the window aspect (matches viewSize() on the desktop build). One shader
// draws textured quads with a per-vertex RGBA tint; flat quads use a 1x1 white
// texture so everything goes through the same path. Quads are batched by
// texture (consecutive same-texture draws coalesce into one drawArrays).

export const VIRTUAL_H = 480

let gl: WebGLRenderingContext
let canvas: HTMLCanvasElement
let prog: WebGLProgram
let aPos: number, aUV: number, aCol: number
let uScale: WebGLUniformLocation | null
let buf: WebGLBuffer
let white: WebGLTexture

let vw = 640, vh = 480 // current virtual size
const FLOATS_PER_VERT = 8 // x,y,u,v,r,g,b,a
let verts: number[] = []
let curTex: WebGLTexture | null = null

const VS = `
attribute vec2 a_pos; attribute vec2 a_uv; attribute vec4 a_col;
uniform vec2 u_scale; varying vec2 v_uv; varying vec4 v_col;
void main() {
  gl_Position = vec4(a_pos.x * u_scale.x, a_pos.y * u_scale.y, 0.0, 1.0);
  v_uv = a_uv; v_col = a_col;
}`

const FS = `
precision mediump float;
varying vec2 v_uv; varying vec4 v_col; uniform sampler2D u_tex;
void main() { gl_FragColor = texture2D(u_tex, v_uv) * v_col; }`

function compile(type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error('shader: ' + gl.getShaderInfoLog(s))
  return s
}

export function initGL(cv: HTMLCanvasElement) {
  canvas = cv
  const ctx = cv.getContext('webgl', { alpha: false, premultipliedAlpha: false, antialias: true })
  if (!ctx) throw new Error('WebGL1 not available')
  gl = ctx

  prog = gl.createProgram()!
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS))
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw new Error('link: ' + gl.getProgramInfoLog(prog))
  gl.useProgram(prog)
  aPos = gl.getAttribLocation(prog, 'a_pos')
  aUV = gl.getAttribLocation(prog, 'a_uv')
  aCol = gl.getAttribLocation(prog, 'a_col')
  uScale = gl.getUniformLocation(prog, 'u_scale')
  buf = gl.createBuffer()!

  white = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, white)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]))
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

  gl.disable(gl.DEPTH_TEST)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

  resize()
}

// Upload an ImageBitmap/canvas as a GL texture; returns the handle + size.
export function makeTexture(img: TexImageSource, w: number, h: number): { tex: WebGLTexture; w: number; h: number } {
  const t = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  return { tex: t, w, h }
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const cssW = window.innerWidth, cssH = window.innerHeight
  const pxW = Math.max(1, Math.round(cssW * dpr))
  const pxH = Math.max(1, Math.round(cssH * dpr))
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW; canvas.height = pxH
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px'
  }
  vh = VIRTUAL_H
  vw = VIRTUAL_H * (cssW / cssH)
  gl.viewport(0, 0, pxW, pxH)
}

export function viewW() { return vw }
export function viewH() { return vh }

export function beginFrame() {
  resize()
  gl.useProgram(prog)
  gl.uniform2f(uScale, 2 / vw, -2 / vh) // center origin, Y-down
  gl.clearColor(0.08, 0.08, 0.12, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  verts.length = 0
  curTex = null
}

export function flush() {
  if (verts.length === 0) return
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STREAM_DRAW)
  const stride = FLOATS_PER_VERT * 4
  gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0)
  gl.enableVertexAttribArray(aUV); gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, stride, 8)
  gl.enableVertexAttribArray(aCol); gl.vertexAttribPointer(aCol, 4, gl.FLOAT, false, stride, 16)
  gl.bindTexture(gl.TEXTURE_2D, curTex || white)
  gl.drawArrays(gl.TRIANGLES, 0, verts.length / FLOATS_PER_VERT)
  verts.length = 0
}

type Pt = { x: number; y: number }
type Col = [number, number, number, number]

// Lowest-level quad push: four explicit corners (TL, TR, BR, BL order) with
// their UVs and a shared color. Batches by texture.
function pushQuadPts(tex: WebGLTexture, p: Pt[], uv: Pt[], c: Col) {
  if (tex !== curTex) { flush(); curTex = tex }
  const idx = [0, 1, 2, 0, 2, 3]
  for (const i of idx) {
    verts.push(p[i].x, p[i].y, uv[i].x, uv[i].y, c[0], c[1], c[2], c[3])
  }
}

// Axis-aligned (optionally rotated) textured quad in virtual coords.
export function drawQuadTex(
  tex: WebGLTexture, dx: number, dy: number, dw: number, dh: number,
  u0: number, v0: number, u1: number, v1: number, c: Col, rot = 0,
) {
  let p: Pt[] = [
    { x: dx, y: dy }, { x: dx + dw, y: dy }, { x: dx + dw, y: dy + dh }, { x: dx, y: dy + dh },
  ]
  if (rot !== 0) {
    const cx = dx + dw / 2, cy = dy + dh / 2
    const s = Math.sin(rot), co = Math.cos(rot)
    p = p.map(q => {
      const ox = q.x - cx, oy = q.y - cy
      return { x: cx + ox * co - oy * s, y: cy + ox * s + oy * co }
    })
  }
  const uv: Pt[] = [{ x: u0, y: v0 }, { x: u1, y: v0 }, { x: u1, y: v1 }, { x: u0, y: v1 }]
  pushQuadPts(tex, p, uv, c)
}

// Flat-color quad (white texture). (x,y) top-left.
export function drawSolidQuad(x: number, y: number, w: number, h: number, c: Col) {
  drawQuadTex(white, x, y, w, h, 0, 0, 1, 1, c)
}

// Triangle-strip-style ribbon arc, emitted as quads (one per segment) so it
// rides the same batcher. Matches the native uiEllipse ribbon (thickness in
// virtual units, centered on the perimeter).
export function drawEllipseRibbon(
  cx: number, cy: number, rx: number, ry: number,
  startPct: number, endPct: number, segments: number, thickness: number, c: Col,
) {
  if (endPct <= startPct || rx < 0.0001 || ry < 0.0001) return
  startPct = Math.max(0, startPct); endPct = Math.min(1, endPct)
  const TAU = Math.PI * 2
  const a0 = startPct * TAU, range = (endPct - startPct) * TAU
  let n = Math.floor(segments * (endPct - startPct)) + 1
  if (n < 2) n = 2
  const half = thickness * 0.5
  const pt = (ang: number, off: number): Pt => {
    const co = Math.cos(ang), si = Math.sin(ang)
    let nx = co / rx, ny = si / ry
    const nl = Math.hypot(nx, ny)
    if (nl > 1e-4) { nx /= nl; ny /= nl }
    return { x: cx + rx * co + nx * off, y: cy + ry * si + ny * off }
  }
  const uv0: Pt = { x: 0, y: 0 }
  for (let i = 0; i < n; i++) {
    const ai = a0 + range * (i / n), aj = a0 + range * ((i + 1) / n)
    const quad = [pt(ai, half), pt(aj, half), pt(aj, -half), pt(ai, -half)]
    pushQuadPts(white, quad, [uv0, uv0, uv0, uv0], c)
  }
}

// ---- blur (downsample to a tiny FBO, then upscale to fill the view) --------
//
// Matches the desktop drawBlur "color summary": render the region into a small
// off-screen texture (default 16 px wide), then stretch it over the whole view
// — the GPU's bilinear upscale does the blurring. The small texture is cached
// per (name, width) since the source art is static; only the per-frame upscale
// draw (and its alpha) changes.

const blurCache = new Map<string, WebGLTexture>()
let blurFbo: WebGLFramebuffer | null = null

function buildBlur(
  key: string, srcTex: WebGLTexture,
  u0: number, v0: number, u1: number, v1: number, pxW: number, pxH: number, targetW: number,
): WebGLTexture {
  const cached = blurCache.get(key)
  if (cached) return cached

  const tw = Math.max(2, Math.min(64, Math.round(targetW)))
  const th = Math.max(2, Math.round((tw * pxH) / pxW))

  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

  flush() // emit any pending main-canvas draws before switching target
  if (!blurFbo) blurFbo = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, blurFbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  gl.viewport(0, 0, tw, th)
  gl.uniform2f(uScale, 1, 1) // a_pos given directly in NDC below

  // Fullscreen NDC quad. Pair NDC-bottom with source-TOP so the FBO texture
  // ends up upright under our top-left v convention (no flip on upscale).
  const q = [
    -1, -1, u0, v0, 1, 1, 1, 1, 1, -1, u1, v0, 1, 1, 1, 1, 1, 1, u1, v1, 1, 1, 1, 1,
    -1, -1, u0, v0, 1, 1, 1, 1, 1, 1, u1, v1, 1, 1, 1, 1, -1, 1, u0, v1, 1, 1, 1, 1,
  ]
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(q), gl.STREAM_DRAW)
  const stride = FLOATS_PER_VERT * 4
  gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0)
  gl.enableVertexAttribArray(aUV); gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, stride, 8)
  gl.enableVertexAttribArray(aCol); gl.vertexAttribPointer(aCol, 4, gl.FLOAT, false, stride, 16)
  gl.bindTexture(gl.TEXTURE_2D, srcTex)
  gl.drawArrays(gl.TRIANGLES, 0, 6)

  // restore main-canvas render target + projection
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, canvas.width, canvas.height)
  gl.uniform2f(uScale, 2 / vw, -2 / vh)
  curTex = null

  blurCache.set(key, tex)
  return tex
}

export function drawBlur(
  key: string, srcTex: WebGLTexture,
  u0: number, v0: number, u1: number, v1: number,
  pxW: number, pxH: number, targetW: number, alpha: number,
) {
  const tex = buildBlur(key, srcTex, u0, v0, u1, v1, pxW, pxH, targetW)
  // Cover-fit (preserve the source aspect, crop the overflow) rather than
  // stretch to the view — avoids a smeared backdrop on non-4:3 / mobile.
  const ra = pxW / pxH, va = vw / vh
  let uw = 1, uh = 1
  if (ra > va) uw = va / ra
  else uh = ra / va
  const ux = (1 - uw) / 2, uy = (1 - uh) / 2
  drawQuadTex(tex, -vw / 2, -vh / 2, vw, vh, ux, uy, ux + uw, uy + uh, [1, 1, 1, alpha])
}
