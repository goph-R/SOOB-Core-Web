// ime.ts — soft-keyboard bridge for touch devices.
//
// The lineEdit widget renders its own text + caret; this only summons the OS
// keyboard and captures characters. A hidden <input> is focused (from inside
// the tap gesture — see widget.lua:mouseDown) so iOS/Android open the keyboard;
// its edits are diffed and forwarded to the Lua hooks (onTextInput /
// onKeyDown "backspace"/"return"). Desktop is untouched: imeShow no-ops on
// fine pointers, and the physical keyboard flows through input.ts as before.

import * as lua from './lua'

const isTouch = () => matchMedia('(pointer: coarse)').matches

let input: HTMLInputElement | null = null
let active = false
let prev = ''

function ensureInput(): HTMLInputElement {
  if (input) return input
  const el = document.createElement('input')
  el.type = 'text'
  el.autocapitalize = 'off'
  el.autocomplete = 'off'
  el.setAttribute('autocorrect', 'off')
  el.setAttribute('spellcheck', 'false')
  el.setAttribute('aria-hidden', 'true')
  el.tabIndex = -1
  // Invisible but in-viewport so iOS shows the keyboard without page-scrolling
  // to it; font-size >= 16px stops iOS auto-zooming on focus.
  el.style.cssText =
    'position:fixed;left:50%;top:50%;width:1px;height:1px;opacity:0;' +
    'border:0;padding:0;margin:0;background:transparent;color:transparent;' +
    'caret-color:transparent;font-size:16px;z-index:-1;'

  // Diff the field on every edit — robust across iOS/Android where keydown for
  // printable keys is unreliable. Caret assumed at end (single-line name).
  el.addEventListener('input', () => {
    const v = el.value
    let i = 0
    const min = Math.min(v.length, prev.length)
    while (i < min && v[i] === prev[i]) i++
    for (let k = 0; k < prev.length - i; k++) lua.keyDown('backspace')
    for (let k = i; k < v.length; k++) lua.textInput(v[k])
    prev = v
  })
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') { lua.keyDown('return'); imeHide() }
  })
  el.addEventListener('blur', () => { active = false })

  document.body.appendChild(el)
  input = el
  return el
}

export function imeShow(_x: number, _y: number, _w: number, _h: number) {
  if (!isTouch()) return // desktop: physical keyboard via input.ts
  const el = ensureInput()
  prev = ''
  el.value = ''
  active = true
  el.focus() // must be on the gesture call stack (it is — see widget.lua)
}

export function imeHide() {
  active = false
  if (input) { input.blur(); input.value = ''; prev = '' }
}

export function imeActive() { return active }
