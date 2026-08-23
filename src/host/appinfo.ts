// appinfo.ts — the game's identity, read from the bundle's app.lua.
//
// A game names itself once (name / id / orientation / description) and every
// host reads that same file: SOOB-Core's app_info.h on the desktop, AppInfo.kt
// in the Android player, this here. Nothing in the web host hardcodes "Find5".
//
// It is used at two different times, which is why the parser is plain string
// work rather than a trip through the Lua VM:
//   - build time, by vite.config.ts, for the PWA manifest and the <title>
//   - run time, for document.title and the localStorage key
//
// app.lua is a flat table of string fields by contract (see SOOB-Lua.md), so a
// key = "value" scan is enough; anything fancier belongs in assets.lua.

export interface AppInfo {
  name: string
  id: string
  orientation: 'landscape' | 'portrait'
  description: string
}

/** Generic on purpose: a bundle without app.lua still runs, it just isn't named. */
export const DEFAULT_APP: AppInfo = {
  name: 'SOOB',
  id: 'soob',
  orientation: 'landscape',
  description: '',
}

export function parseAppLua(src: string): AppInfo {
  const out: AppInfo = { ...DEFAULT_APP }
  // Drop long comments first, then line comments, so a --[[ ... ]] block or a
  // commented-out field can't contribute a key.
  const body = src.replace(/--\[\[[\s\S]*?\]\]/g, '').replace(/--[^\n]*/g, '')
  const field = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = field.exec(body))) {
    const key = m[1]
    const value = m[2] !== undefined ? m[2] : m[3]
    if (key === 'name') out.name = value
    else if (key === 'id') out.id = value
    else if (key === 'orientation') out.orientation = value === 'portrait' ? 'portrait' : 'landscape'
    else if (key === 'description') out.description = value
  }
  return out
}

let current: AppInfo = { ...DEFAULT_APP }

export function appInfo(): AppInfo {
  return current
}

/** The save key — the same stem the desktop build writes as <id>.dat. */
export function optKey(): string {
  return current.id + '.dat'
}

/** Fetch and install the bundle's identity. Call before the Lua VM boots. */
export async function loadAppInfo(base = 'game/'): Promise<AppInfo> {
  try {
    const res = await fetch(base + 'app.lua')
    if (res.ok) current = parseAppLua(await res.text())
    else console.warn('app.lua missing — running unnamed')
  } catch (err) {
    console.warn('app.lua unreadable:', String(err))
  }
  document.title = current.name
  return current
}
