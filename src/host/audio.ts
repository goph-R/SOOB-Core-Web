// audio.ts — Web Audio implementation of the SOOB audio bindings.
//
// Sounds: decoded AudioBuffers (random non-repeating variant per group, like
// the desktop SoundLibrary), played as one-shots. Music: lazily decoded,
// crossfaded between two tracks via gain ramps, looped, with a global music
// gain (musicVolume). Browsers block audio until a user gesture, so the
// AudioContext is resumed on the first pointer/key event and any music
// requested before then (the onStart title track) is started on unlock.

const BASE = 'game/'

let ctx: AudioContext | null = null
let musicBus: GainNode | null = null
let musicVol = 1

const sounds = new Map<string, AudioBuffer[]>()
const lastVariant = new Map<string, number>()
const musicBuffers = new Map<string, AudioBuffer>()

let current: { src: AudioBufferSourceNode; gain: GainNode } | null = null
let pending: { name: string; fade: number; loop: boolean } | null = null
let desiredName: string | null = null // the track we want playing (dedupe key)
let musicGen = 0 // cancels in-flight async music starts

// path lookup is injected by assets to avoid a circular import
let musicPath: (name: string) => string | undefined = () => undefined
export function setMusicResolver(fn: (name: string) => string | undefined) { musicPath = fn }

export function initAudio() {
  const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
  if (!AC) { console.warn('Web Audio unavailable'); return }
  ctx = new AC()
  musicBus = ctx.createGain()
  musicBus.gain.value = musicVol
  musicBus.connect(ctx.destination)

  const unlock = () => {
    if (!ctx) return
    ctx.resume().then(() => {
      if (pending) { const p = pending; pending = null; startMusic(p.name, p.fade, p.loop) }
    })
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}

// Decode and register one sound variant (called by assets.loadAll).
export async function addSound(name: string, path: string) {
  if (!ctx) return
  try {
    const res = await fetch(BASE + path)
    if (!res.ok) throw new Error(`${res.status} ${path}`)
    const buf = await ctx.decodeAudioData(await res.arrayBuffer())
    const arr = sounds.get(name) || []
    arr.push(buf); sounds.set(name, arr)
  } catch (err) {
    console.warn('sound skipped:', path, String(err))
  }
}

export function soundPlay(name: string) {
  if (!ctx || ctx.state !== 'running') return
  const arr = sounds.get(name)
  if (!arr || arr.length === 0) return
  let i = 0
  if (arr.length > 1) {
    // uniformly random, avoid immediate repeat (matches desktop SoundLibrary)
    const prev = lastVariant.get(name)
    do { i = Math.floor(Math.random() * arr.length) } while (i === prev)
    lastVariant.set(name, i)
  }
  const src = ctx.createBufferSource()
  src.buffer = arr[i]
  src.connect(ctx.destination)
  src.start()
}

let oggOk: boolean | null = null
function canPlayOgg(): boolean {
  if (oggOk === null) {
    const a = document.createElement('audio')
    oggOk = !!a.canPlayType && a.canPlayType('audio/ogg; codecs="vorbis"') !== ''
  }
  return oggOk
}

async function getMusic(name: string): Promise<AudioBuffer | null> {
  if (musicBuffers.has(name)) return musicBuffers.get(name)!
  const path = musicPath(name)
  if (!path || !ctx) return null
  // iOS/Safari can't decode Ogg Vorbis — fall back to the AAC (.m4a) sibling.
  const url = BASE + (canPlayOgg() ? path : path.replace(/\.ogg$/i, '.m4a'))
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${res.status} ${path}`)
    const buf = await ctx.decodeAudioData(await res.arrayBuffer())
    musicBuffers.set(name, buf)
    return buf
  } catch (err) {
    console.warn('music skipped (codec?):', path, String(err))
    return null
  }
}

async function startMusic(name: string, fade: number, loop: boolean) {
  if (!ctx || !musicBus) return
  const gen = ++musicGen
  const buf = await getMusic(name)
  if (!buf) { if (desiredName === name) desiredName = null; return } // allow a later retry
  if (gen !== musicGen || ctx.state !== 'running') return

  const now = ctx.currentTime
  const gain = ctx.createGain()
  gain.gain.value = 0
  gain.connect(musicBus)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = loop
  src.connect(gain)
  src.start()
  gain.gain.linearRampToValueAtTime(1, now + Math.max(0.001, fade))

  if (current) {
    const old = current
    old.gain.gain.cancelScheduledValues(now)
    old.gain.gain.setValueAtTime(old.gain.gain.value, now)
    old.gain.gain.linearRampToValueAtTime(0, now + Math.max(0.001, fade))
    try { old.src.stop(now + fade + 0.05) } catch { /* already stopped */ }
  }
  current = { src, gain }
}

export function musicPlay(name: string, fade: number, loop: boolean) {
  if (!ctx) return
  // Same track already playing / requested → no-op, so re-entering a scene
  // (e.g. back to the menu) doesn't restart the loop. Matches native music.h.
  if (name === desiredName) return
  desiredName = name
  if (ctx.state !== 'running') { pending = { name, fade, loop }; return } // play on unlock
  startMusic(name, fade, loop)
}

export function musicStop(fade: number) {
  pending = null
  desiredName = null
  musicGen++ // cancel any in-flight start
  if (!ctx || !current) return
  const now = ctx.currentTime
  const old = current
  current = null
  old.gain.gain.cancelScheduledValues(now)
  old.gain.gain.setValueAtTime(old.gain.gain.value, now)
  old.gain.gain.linearRampToValueAtTime(0, now + Math.max(0.001, fade))
  try { old.src.stop(now + fade + 0.05) } catch { /* already stopped */ }
}

export function musicVolume(g: number) {
  musicVol = Math.max(0, Math.min(1, g))
  if (ctx && musicBus) musicBus.gain.setValueAtTime(musicVol, ctx.currentTime)
}
