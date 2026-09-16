// game-path.mjs — which game this checkout builds.
//
// One resolver, imported by both sync-game.mjs and vite.config.ts, so the
// path is stated once. Two inputs, highest priority first:
//
//   1. SOOB_GAME=../MyGame npm run dev    one-off / CI override
//   2. "soobGame" in package.json          the tracked default
//
// Deliberately symmetric with the Android player's `soobGame` Gradle property.
// Relative paths resolve against this repo's root, not the cwd.

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function gamePath() {
  const fromEnv = process.env.SOOB_GAME
  if (fromEnv) return resolve(repoRoot, fromEnv)

  const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
  if (pkg.soobGame) return resolve(repoRoot, pkg.soobGame)

  throw new Error(
    'No game configured: set "soobGame" in package.json or SOOB_GAME in the environment.')
}
