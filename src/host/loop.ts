// loop.ts — requestAnimationFrame driver, mirroring the native frame loop
// (main.cpp:264–284) minus uiUpdateMessage/uiDrawMessage: the HUD message is a
// console.log on web, so there's no overlay to tick or draw.

import * as lua from './lua'
import { beginFrame, flush } from './gl'

let last = 0

function frame(now: number) {
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 0
  last = now
  lua.update(dt)        // onUpdate(dt)
  beginFrame()          // clear + reset batch  (uiBegin equivalent)
  lua.render()          // onRender() — all draw* calls
  flush()               // submit the last batch (uiEnd + swap)
  requestAnimationFrame(frame)
}

export function startLoop() {
  requestAnimationFrame(frame)
}
