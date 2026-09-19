// sync-game.mjs — copy a game bundle into public/game/ and emit a manifest of
// the .lua files to preload into MEMFS.
//
// The game repo stays the single source of truth: this only copies, never
// forks. Which game is resolved by game-path.mjs (SOOB_GAME env, else the
// "soobGame" field in package.json). Run automatically by the npm
// predev/prebuild hooks.

import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, relative, join } from 'node:path'
import { enginePath, gamePath, repoRoot } from './game-path.mjs'

const game = gamePath()
const engine = enginePath()
const dst = resolve(repoRoot, 'public/game')

if (!existsSync(game)) {
  console.error(`sync-game: game bundle not found at ${game}`)
  console.error('Set "soobGame" in package.json, or SOOB_GAME in the environment.')
  process.exit(1)
}

if (!existsSync(engine)) {
  console.error(`sync-game: engine modules not found at ${engine}`)
  console.error('Check SOOB-Core out as a sibling of this repo.')
  process.exit(1)
}

// Wipe first: a plain copy leaves files behind that the game has since renamed
// or deleted, and a stale asset that still loads is a confusing bug. public/
// game/ is generated and gitignored, so there is nothing here to preserve.
rmSync(dst, { recursive: true, force: true })
mkdirSync(dst, { recursive: true })

// Everything is optional — a half-built game should still boot and tell you
// what's missing, rather than dying inside cpSync.
const copyDir = (name) => {
  if (existsSync(join(game, name))) cpSync(join(game, name), join(dst, name), { recursive: true })
  else console.warn(`sync-game: no ${name}/ in the bundle`)
}
const copyFile = (name) => {
  if (existsSync(join(game, name))) cpSync(join(game, name), join(dst, name))
  else console.warn(`sync-game: no ${name} in the bundle`)
}

copyDir('scripts')
copyDir('assets')
copyFile('assets.lua')

// scripts/engine is generated everywhere: SOOB-Core owns it, and every desktop
// build copies it into the game folder (soob.mk's `scripts/engine` rule,
// soob.cmake's copy step) where it is gitignored. A freshly cloned game has no
// engine modules at all until something copies them, so `require "engine.scene"`
// would throw at boot after a perfectly successful build.
//
// Copy it here too, after the bundle's own scripts/ so SOOB-Core wins if a
// desktop build already left a stale copy behind. Straight into public/game
// rather than into the game folder: this repo never writes to the game's.
// The twin of the Gradle player's engineDir `from`.
cpSync(engine, join(dst, 'scripts', 'engine'), { recursive: true })
// app.lua names the game for every host — the tab title, the PWA manifest, the
// theme colour and the localStorage key all come from it.
copyFile('app.lua')

// NOTE: config.lua is deliberately NOT copied. Every field in it (width,
// height, fullscreen, vsync, render, depth) is desktop-only by construction —
// the web canvas sizes to the viewport and there is no software backend in
// WASM. It used to be copied and preloaded, and nothing ever read it.

// The game's web icon, if it ships one. Falls back to the tracked default so a
// bundle without art still builds.
const icon = join(game, 'web', 'icon.svg')
cpSync(existsSync(icon) ? icon : resolve(repoRoot, 'public/icon.default.svg'),
       resolve(repoRoot, 'public/icon.svg'))

// .lua files to write into MEMFS at boot: assets.lua + everything under
// scripts/, as paths relative to public/game/.
const lua = existsSync(join(dst, 'assets.lua')) ? ['assets.lua'] : []
if (existsSync(join(dst, 'scripts'))) {
  ;(function walk(dir) {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (e.endsWith('.lua')) lua.push(relative(dst, p).split(/[\\/]/).join('/'))
    }
  })(join(dst, 'scripts'))
}

writeFileSync(join(dst, 'manifest.json'), JSON.stringify({ lua }, null, 2))
console.log(`sync-game: copied ${relative(repoRoot, game)} + engine → public/game (${lua.length} lua files)`)
