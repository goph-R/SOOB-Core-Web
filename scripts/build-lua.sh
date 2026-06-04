#!/usr/bin/env bash
#
# Compile the vendored lua-5.1.5 + src/wasm/bridge.c to an Emscripten ES module
# at public/lua/liblua.{mjs,wasm}. Requires emcc on PATH (or emsdk beside this
# repo, which we source automatically).
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LUA_SRC="$ROOT/../SOOB-Core/vendor/lua-5.1.5/src"
EMSDK="${EMSDK_DIR:-$ROOT/../emsdk}"
OUT="$ROOT/public/lua"

if ! command -v emcc >/dev/null 2>&1; then
  if [ -f "$EMSDK/emsdk_env.sh" ]; then
    # shellcheck disable=SC1090,SC1091
    source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1
  fi
fi
command -v emcc >/dev/null 2>&1 || { echo "error: emcc not found (install Emscripten or set EMSDK_DIR)"; exit 1; }

mkdir -p "$OUT"

# Lua core: every .c except the standalone interpreter (lua.c), the bytecode
# compiler (luac.c) + its print helper (print.c), and the amalgamation
# (lua_all.c) — same exclusions as our native build.
mapfile -t LUA_C < <(ls "$LUA_SRC"/*.c | grep -v -E '/(lua|luac|print|lua_all)\.c$')

emcc -O2 -DNDEBUG \
  -I "$LUA_SRC" \
  "${LUA_C[@]}" "$ROOT/src/wasm/bridge.c" \
  -o "$OUT/liblua.mjs" \
  -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=createLua \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_RUNTIME_METHODS=ccall,cwrap,FS,UTF8ToString,stringToUTF8,stringToNewUTF8,lengthBytesUTF8 \
  -s EXPORTED_FUNCTIONS=_soob_new,_soob_doFile,_soob_doString,_soob_loadAssets,_soob_callHook0,_soob_update,_soob_render,_soob_mouseDown,_soob_mouseUp,_soob_mouseMove,_soob_keyDown,_soob_keyUp,_soob_textInput,_malloc,_free

echo "built $OUT/liblua.mjs + liblua.wasm"
