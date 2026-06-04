// assets.ts — asset registries + async loaders.
//
// register*() are called synchronously by the WASM bridge while it walks
// assets.lua (just metadata: names, paths, region rects). loadAll() then does
// the actual async fetch/decode/upload and must finish BEFORE the game's
// main.lua runs (the sync→async boundary): the desktop scriptLoadAssets is
// synchronous, so the web host front-loads everything to keep drawRegion/
// drawText synchronous at render time.

import { makeTexture } from './gl'
import { parseFnt, type FontData } from './text'

const BASE = 'game/' // public/game/** served under /game/ (vite base './')

interface TexEntry { path: string; tex?: WebGLTexture; w: number; h: number }
interface RegionEntry { tex: string; x: number; y: number; w: number; h: number; slice?: [number, number, number, number] }
interface FontEntry { path: string; data?: FontData; tex?: WebGLTexture }

const textures = new Map<string, TexEntry>()
const regions = new Map<string, RegionEntry>()
const fonts = new Map<string, FontEntry>()
const sounds = new Map<string, string[]>()
const music = new Map<string, string>()

let defaultFont: string | null = null

// ---- registration (from the bridge) ----
export function registerTexture(name: string, path: string) { textures.set(name, { path, w: 0, h: 0 }) }
export function registerFont(name: string, path: string) {
  fonts.set(name, { path })
  if (!defaultFont || name === 'default') defaultFont = name
}
export function registerSound(name: string, path: string) {
  const a = sounds.get(name) || []
  a.push(path); sounds.set(name, a)
}
export function registerMusic(name: string, path: string) { music.set(name, path) }
export function registerRegion(name: string, tex: string, a: Float64Array) {
  const e: RegionEntry = { tex, x: a[0], y: a[1], w: a[2], h: a[3] }
  if (a[4]) e.slice = [a[5], a[6], a[7], a[8]]
  regions.set(name, e)
}

// ---- async loading ----
async function loadImage(url: string): Promise<ImageBitmap> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return createImageBitmap(await res.blob())
}

function dir(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i + 1)
}

export async function loadAll(): Promise<void> {
  const jobs: Promise<void>[] = []

  for (const [, e] of textures) {
    jobs.push((async () => {
      try {
        const img = await loadImage(BASE + e.path)
        const t = makeTexture(img, img.width, img.height)
        e.tex = t.tex; e.w = t.w; e.h = t.h
      } catch (err) {
        console.warn('texture skipped:', e.path, String(err))
      }
    })())
  }

  for (const [, f] of fonts) {
    jobs.push((async () => {
      try {
        const res = await fetch(BASE + f.path)
        if (!res.ok) throw new Error(`${res.status} ${f.path}`)
        f.data = parseFnt(await res.text())
        const page = dir(f.path) + f.data.pageFile
        const img = await loadImage(BASE + page)
        f.tex = makeTexture(img, img.width, img.height).tex
      } catch (err) {
        console.warn('font skipped:', f.path, String(err))
      }
    })())
  }

  await Promise.all(jobs)
}

// ---- queries (for the bindings / renderer) ----
export function getRegion(name: string) { return regions.get(name) }
export function getTexture(name: string) { return textures.get(name) }
export function getSound(name: string) { return sounds.get(name) }
export function getMusic(name: string) { return music.get(name) }

export function getFont(name: string | null): FontEntry | undefined {
  if (name && fonts.has(name)) return fonts.get(name)
  return defaultFont ? fonts.get(defaultFont) : undefined
}

export function regionW(name: string): number { return regions.get(name)?.w ?? -1 }
export function regionH(name: string): number { return regions.get(name)?.h ?? -1 }
export function regionSlice(name: string): number[] | null {
  const r = regions.get(name)
  if (!r || !r.slice) return null
  return [r.slice[0], r.slice[1], r.slice[2], r.slice[3], r.w, r.h]
}
