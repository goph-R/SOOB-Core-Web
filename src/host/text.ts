// text.ts — AngelCode BMFont (.fnt text format) parsing + drawing.
//
// Mirrors the desktop uiText: a single-line text block is anchored at (x, y)
// per the ALIGN_* bitmask, glyphs laid out by xadvance with per-glyph
// x/yoffset, sized by `scale` (a multiplier of the font's native lineHeight).

import { drawQuadTex } from './gl'

type Glyph = { x: number; y: number; w: number; h: number; xo: number; yo: number; xadv: number }

export interface FontData {
  lineHeight: number
  base: number
  scaleW: number
  scaleH: number
  pageFile: string // page texture filename (relative to the .fnt)
  glyphs: Map<number, Glyph>
}

function kv(line: string): Record<string, string> {
  const out: Record<string, string> = {}
  // tokens are key=value, value may be "quoted"
  const re = /(\w+)=("[^"]*"|\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) out[m[1]] = m[2].replace(/^"|"$/g, '')
  return out
}

export function parseFnt(text: string): FontData {
  const f: FontData = { lineHeight: 16, base: 12, scaleW: 256, scaleH: 256, pageFile: '', glyphs: new Map() }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('common ')) {
      const a = kv(line)
      f.lineHeight = +a.lineHeight || f.lineHeight
      f.base = +a.base || f.base
      f.scaleW = +a.scaleW || f.scaleW
      f.scaleH = +a.scaleH || f.scaleH
    } else if (line.startsWith('page ')) {
      const a = kv(line)
      if (a.file) f.pageFile = a.file
    } else if (line.startsWith('char ')) {
      const a = kv(line)
      f.glyphs.set(+a.id, {
        x: +a.x, y: +a.y, w: +a.width, h: +a.height,
        xo: +a.xoffset, yo: +a.yoffset, xadv: +a.xadvance,
      })
    }
  }
  return f
}

// Native lineHeight in virtual units = font.lineHeight (1 source px = 1 vpx),
// times the caller's scale.
export function measure(font: FontData, text: string, scale: number): number {
  let max = 0, cur = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    if (ch === 10) { if (cur > max) max = cur; cur = 0; continue }
    const g = font.glyphs.get(ch)
    if (g) cur += g.xadv * scale
  }
  return Math.max(max, cur)
}

type Col = [number, number, number, number]

// align bits: LEFT=1 CENTER=2 RIGHT=4 | TOP=8 MIDDLE=16 BOTTOM=32 (0 => TOP/LEFT)
export function drawText(
  font: FontData, tex: WebGLTexture, text: string,
  x: number, y: number, scale: number, align: number, col: Col,
) {
  const lines = text.split('\n')
  const lh = font.lineHeight * scale
  const blockH = lh * lines.length

  const av = align & 56
  let top = y
  if (av === 16) top = y - blockH / 2
  else if (av === 32) top = y - blockH

  const ah = align & 7
  const sw = font.scaleW, sh = font.scaleH

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const w = measure(font, line, scale)
    let penX = x
    if (ah === 2) penX = x - w / 2
    else if (ah === 4) penX = x - w
    const lineTop = top + li * lh

    for (let i = 0; i < line.length; i++) {
      const g = font.glyphs.get(line.charCodeAt(i))
      if (!g) continue
      if (g.w > 0 && g.h > 0) {
        const dx = penX + g.xo * scale
        const dy = lineTop + g.yo * scale
        drawQuadTex(
          tex, dx, dy, g.w * scale, g.h * scale,
          g.x / sw, g.y / sh, (g.x + g.w) / sw, (g.y + g.h) / sh, col,
        )
      }
      penX += g.xadv * scale
    }
  }
}
