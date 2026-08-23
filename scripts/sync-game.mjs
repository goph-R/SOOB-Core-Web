// sync-game.mjs — copy the Find5 game bundle into public/game/ and emit a
// manifest of the .lua files to preload into MEMFS.
//
// Find5 stays the single source of truth: this only copies, never forks. Run
// automatically by the npm predev/prebuild hooks.

import { cpSync, mkdirSync, existsSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const find5 = resolve(root, '../Find5')
const dst = resolve(root, 'public/game')

if (!existsSync(find5)) {
  console.error(`sync-game: ../Find5 not found at ${find5}`)
  process.exit(1)
}

mkdirSync(dst, { recursive: true })
cpSync(join(find5, 'scripts'), join(dst, 'scripts'), { recursive: true })
cpSync(join(find5, 'assets'), join(dst, 'assets'), { recursive: true })
cpSync(join(find5, 'assets.lua'), join(dst, 'assets.lua'))
if (existsSync(join(find5, 'config.lua'))) cpSync(join(find5, 'config.lua'), join(dst, 'config.lua'))
// app.lua names the game for every host — the tab title, the PWA manifest and
// the localStorage key all come from it.
if (existsSync(join(find5, 'app.lua'))) cpSync(join(find5, 'app.lua'), join(dst, 'app.lua'))

// .lua files to write into MEMFS at boot: assets.lua, config.lua (if present),
// + everything under scripts/. config.lua sits at the game root (mirrors the
// desktop layout) so the host can luaL_loadfile '/game/config.lua' if needed.
const lua = ['assets.lua']
if (existsSync(join(dst, 'config.lua'))) lua.push('config.lua')
;(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p)
    else if (e.endsWith('.lua')) lua.push(relative(dst, p).split(/[\\/]/).join('/'))
  }
})(join(dst, 'scripts'))

writeFileSync(join(dst, 'manifest.json'), JSON.stringify({ lua }, null, 2))
console.log(`sync-game: copied Find5 → public/game (${lua.length} lua files)`)
