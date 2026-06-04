/* bridge.c — SOOB-Core-Web Lua-WASM glue.
 *
 * Compiled with Emscripten together with the vendored lua-5.1.5 sources
 * (see scripts/build-lua.sh) into public/lua/liblua.{mjs,wasm}.
 *
 * It mirrors SOOB-Core/script.h: it creates a lua_State, sandboxes io/os,
 * registers the same 25-binding surface (SOOB-Lua.md) plus the ALIGN and FLIP
 * constants, and walks assets.lua exactly like scriptLoadAssets. The only
 * difference from the native build is the body of each binding: instead of
 * calling the C engine it marshals the Lua args and calls the JS host
 * (globalThis.__SOOB.*) via EM_JS. The arg-reading logic (option tables,
 * defaults) is ported verbatim from the scr* wrappers in script.h.
 *
 * Geometry that needs texture sizes (drawRegion UV/dest math, ellipse
 * tessellation) is done JS-side in the host renderer; here we only forward
 * the raw parameters. Numeric arg bundles travel through a shared HEAPF64
 * scratch buffer (g_args) read by the host as a Float64Array view.
 */

#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <emscripten.h>

#include "lua.h"
#include "lauxlib.h"
#include "lualib.h"

static lua_State *gL = 0;
static double g_args[64];   /* scratch bundle shared with the JS host */

/* ---------------------------------------------------------------------------
 * JS host imports. Strings arrive as char* (UTF8ToString); numeric bundles as
 * a pointer read through HEAPF64.subarray. The host reads each bundle
 * synchronously during the call, before any heap growth can invalidate it.
 * ------------------------------------------------------------------------- */
EM_JS(void, js_log, (const char *s), { console.log(UTF8ToString(s)); })

EM_JS(void, js_drawRegion, (const char *name, double *a), {
  globalThis.__SOOB.drawRegion(UTF8ToString(name), HEAPF64.subarray(a >> 3, (a >> 3) + 25));
})
EM_JS(void, js_drawText, (const char *text, const char *font, double *a), {
  globalThis.__SOOB.drawText(UTF8ToString(text), UTF8ToString(font), HEAPF64.subarray(a >> 3, (a >> 3) + 8));
})
EM_JS(void, js_drawQuad, (double *a), {
  globalThis.__SOOB.drawQuad(HEAPF64.subarray(a >> 3, (a >> 3) + 8));
})
EM_JS(void, js_drawEllipse, (double *a), {
  globalThis.__SOOB.drawEllipse(HEAPF64.subarray(a >> 3, (a >> 3) + 12));
})
EM_JS(void, js_drawBg, (const char *n), { globalThis.__SOOB.drawBg(UTF8ToString(n)); })
EM_JS(void, js_drawBlur, (const char *n, double w, double a), { globalThis.__SOOB.drawBlur(UTF8ToString(n), w, a); })

EM_JS(double, js_viewW, (void), { return globalThis.__SOOB.viewW(); })
EM_JS(double, js_viewH, (void), { return globalThis.__SOOB.viewH(); })
EM_JS(double, js_regionW, (const char *n), { return globalThis.__SOOB.regionW(UTF8ToString(n)); })
EM_JS(double, js_regionH, (const char *n), { return globalThis.__SOOB.regionH(UTF8ToString(n)); })
EM_JS(int, js_regionSlice, (const char *n, double *out), {
  const s = globalThis.__SOOB.regionSlice(UTF8ToString(n));
  if (!s) return 0;
  const o = out >> 3;
  for (let i = 0; i < 6; i++) HEAPF64[o + i] = s[i];
  return 1;
})
EM_JS(double, js_textWidth, (const char *t, const char *f, double scale), {
  return globalThis.__SOOB.textWidth(UTF8ToString(t), UTF8ToString(f), scale);
})

EM_JS(int, js_keyDown, (const char *n), { return globalThis.__SOOB.keyDown(UTF8ToString(n)) ? 1 : 0; })
EM_JS(double, js_mouseX, (void), { return globalThis.__SOOB.mouseX(); })
EM_JS(double, js_mouseY, (void), { return globalThis.__SOOB.mouseY(); })
EM_JS(int, js_mouseBtn, (int b), { return globalThis.__SOOB.mouseDown(b) ? 1 : 0; })
EM_JS(int, js_keyMods, (void), { return globalThis.__SOOB.keyMods(); })

EM_JS(void, js_soundPlay, (const char *n), { globalThis.__SOOB.soundPlay(UTF8ToString(n)); })
EM_JS(void, js_musicPlay, (const char *n, double f, int l), { globalThis.__SOOB.musicPlay(UTF8ToString(n), f, !!l); })
EM_JS(void, js_musicStop, (double f), { globalThis.__SOOB.musicStop(f); })
EM_JS(void, js_musicVolume, (double g), { globalThis.__SOOB.musicVolume(g); })
EM_JS(void, js_showMessage, (const char *t, double s), { globalThis.__SOOB.showMessage(UTF8ToString(t), s); })
EM_JS(void, js_requestQuit, (void), { globalThis.__SOOB.requestQuit(); })
EM_JS(void, js_imeShow, (double x, double y, double w, double h), { globalThis.__SOOB.imeShow(x, y, w, h); })
EM_JS(void, js_imeHide, (void), { globalThis.__SOOB.imeHide(); })

EM_JS(void, js_optSave, (const char *s), { globalThis.__SOOB.optSave(UTF8ToString(s)); })
EM_JS(char *, js_optLoad, (void), {
  const s = globalThis.__SOOB.optLoad();
  return (s == null) ? 0 : stringToNewUTF8(s);
})

EM_JS(void, js_regSound, (const char *n, const char *p), { globalThis.__SOOB.registerSound(UTF8ToString(n), UTF8ToString(p)); })
EM_JS(void, js_regMusic, (const char *n, const char *p), { globalThis.__SOOB.registerMusic(UTF8ToString(n), UTF8ToString(p)); })
EM_JS(void, js_regTexture, (const char *n, const char *p), { globalThis.__SOOB.registerTexture(UTF8ToString(n), UTF8ToString(p)); })
EM_JS(void, js_regFont, (const char *n, const char *p), { globalThis.__SOOB.registerFont(UTF8ToString(n), UTF8ToString(p)); })
EM_JS(void, js_regRegion, (const char *n, const char *tex, double *a), {
  globalThis.__SOOB.registerRegion(UTF8ToString(n), UTF8ToString(tex), HEAPF64.subarray(a >> 3, (a >> 3) + 9));
})

/* ---- option-table helpers (ported from script.h scrOptfield*) ---- */
static double optNum(lua_State *L, int idx, const char *k, double def) {
  lua_getfield(L, idx, k);
  double v = lua_isnil(L, -1) ? def : lua_tonumber(L, -1);
  lua_pop(L, 1);
  return v;
}
static int optInt(lua_State *L, int idx, const char *k, int def) {
  lua_getfield(L, idx, k);
  int v = lua_isnil(L, -1) ? def : (int)lua_tointeger(L, -1);
  lua_pop(L, 1);
  return v;
}
static const char *optStr(lua_State *L, int idx, const char *k, const char *def) {
  lua_getfield(L, idx, k);
  const char *v = lua_isstring(L, -1) ? lua_tostring(L, -1) : def;
  lua_pop(L, 1);
  return v;
}
static int optOvr(lua_State *L, int idx, const char *k, double *out) {
  lua_getfield(L, idx, k);
  int has = 0;
  if (!lua_isnil(L, -1)) { *out = lua_tonumber(L, -1); has = 1; }
  lua_pop(L, 1);
  return has;
}
static void optColor(lua_State *L, int idx, double *r, double *g, double *b, double *a) {
  lua_getfield(L, idx, "color");
  if (lua_istable(L, -1)) {
    lua_rawgeti(L, -1, 1); if (!lua_isnil(L, -1)) *r = lua_tonumber(L, -1); lua_pop(L, 1);
    lua_rawgeti(L, -1, 2); if (!lua_isnil(L, -1)) *g = lua_tonumber(L, -1); lua_pop(L, 1);
    lua_rawgeti(L, -1, 3); if (!lua_isnil(L, -1)) *b = lua_tonumber(L, -1); lua_pop(L, 1);
    lua_rawgeti(L, -1, 4); if (!lua_isnil(L, -1)) *a = lua_tonumber(L, -1); lua_pop(L, 1);
  }
  lua_pop(L, 1);
  lua_getfield(L, idx, "alpha");
  if (!lua_isnil(L, -1)) *a = lua_tonumber(L, -1);
  lua_pop(L, 1);
}

/* ---- rendering bindings ---- */
static int scrDrawRegion(lua_State *L) {
  const char *name = luaL_checkstring(L, 1);
  double x = luaL_checknumber(L, 2), y = luaL_checknumber(L, 3);
  double align = 0, flip = 0, fillX = 1, fillY = 1, sx = 1, sy = 1, rot = 0;
  double r = 1, g = 1, b = 1, a = 1;
  int hsx = 0, hsy = 0, hsw = 0, hsh = 0, hdw = 0, hdh = 0;
  double srcX = 0, srcY = 0, srcW = 0, srcH = 0, dstW = 0, dstH = 0;

  if (lua_istable(L, 4)) {
    align = optInt(L, 4, "align", 0);
    flip  = optInt(L, 4, "flip", 0);
    fillX = optNum(L, 4, "fillX", 1);
    fillY = optNum(L, 4, "fillY", 1);
    double uni = optNum(L, 4, "scale", 1);
    sx = optNum(L, 4, "scaleX", uni);
    sy = optNum(L, 4, "scaleY", uni);
    rot = optNum(L, 4, "rotation", 0);
    optColor(L, 4, &r, &g, &b, &a);
    hsx = optOvr(L, 4, "srcX", &srcX);
    hsy = optOvr(L, 4, "srcY", &srcY);
    hsw = optOvr(L, 4, "srcW", &srcW);
    hsh = optOvr(L, 4, "srcH", &srcH);
    hdw = optOvr(L, 4, "dstW", &dstW);
    hdh = optOvr(L, 4, "dstH", &dstH);
  } else {
    align = luaL_optinteger(L, 4, 0);
    flip  = luaL_optinteger(L, 5, 0);
    fillX = luaL_optnumber(L, 6, 1);
    fillY = luaL_optnumber(L, 7, 1);
  }

  double *A = g_args;
  A[0] = x; A[1] = y; A[2] = align; A[3] = flip; A[4] = fillX; A[5] = fillY;
  A[6] = sx; A[7] = sy; A[8] = rot; A[9] = r; A[10] = g; A[11] = b; A[12] = a;
  A[13] = hsx; A[14] = srcX; A[15] = hsy; A[16] = srcY;
  A[17] = hsw; A[18] = srcW; A[19] = hsh; A[20] = srcH;
  A[21] = hdw; A[22] = dstW; A[23] = hdh; A[24] = dstH;
  js_drawRegion(name, g_args);
  return 0;
}

static int scrDrawText(lua_State *L) {
  const char *text = luaL_checkstring(L, 1);
  double x = luaL_checknumber(L, 2), y = luaL_checknumber(L, 3);
  double scale = 1, align = 0, r = 1, g = 1, b = 1, a = 1;
  const char *font = "";
  if (lua_istable(L, 4)) {
    scale = optNum(L, 4, "scale", 1);
    font  = optStr(L, 4, "font", "");
    align = optInt(L, 4, "align", 0);
    optColor(L, 4, &r, &g, &b, &a);
  } else {
    scale = luaL_optnumber(L, 4, 1);
    font  = lua_isstring(L, 5) ? lua_tostring(L, 5) : "";
  }
  double *A = g_args;
  A[0] = x; A[1] = y; A[2] = scale; A[3] = align; A[4] = r; A[5] = g; A[6] = b; A[7] = a;
  js_drawText(text, font, g_args);
  return 0;
}

static int scrDrawQuad(lua_State *L) {
  double x = luaL_checknumber(L, 1), y = luaL_checknumber(L, 2);
  double w = luaL_checknumber(L, 3), h = luaL_checknumber(L, 4);
  double r = 1, g = 1, b = 1, a = 1;
  if (lua_istable(L, 5)) optColor(L, 5, &r, &g, &b, &a);
  double *A = g_args;
  A[0] = x; A[1] = y; A[2] = w; A[3] = h; A[4] = r; A[5] = g; A[6] = b; A[7] = a;
  js_drawQuad(g_args);
  return 0;
}

static int scrDrawEllipse(lua_State *L) {
  double cx = luaL_checknumber(L, 1), cy = luaL_checknumber(L, 2);
  double rx = luaL_checknumber(L, 3), ry = luaL_checknumber(L, 4);
  double start = 0, finish = 1, seg = 64, th = 2, r = 1, g = 1, b = 1, a = 1;
  if (lua_istable(L, 5)) {
    start  = optNum(L, 5, "start", 0);
    finish = optNum(L, 5, "finish", 1);
    seg    = optInt(L, 5, "segments", 64);
    th     = optNum(L, 5, "thickness", 2);
    optColor(L, 5, &r, &g, &b, &a);
  }
  double *A = g_args;
  A[0] = cx; A[1] = cy; A[2] = rx; A[3] = ry; A[4] = start; A[5] = finish;
  A[6] = seg; A[7] = th; A[8] = r; A[9] = g; A[10] = b; A[11] = a;
  js_drawEllipse(g_args);
  return 0;
}

static int scrDrawBg(lua_State *L) { js_drawBg(luaL_checkstring(L, 1)); return 0; }
static int scrDrawBlur(lua_State *L) {
  const char *n = luaL_checkstring(L, 1);
  double w = 16, a = 0.6;
  if (lua_istable(L, 2)) { w = optInt(L, 2, "width", 16); a = optNum(L, 2, "alpha", 0.6); }
  js_drawBlur(n, w, a);
  return 0;
}

/* ---- queries ---- */
static int scrViewSize(lua_State *L) {
  lua_pushnumber(L, js_viewW());
  lua_pushnumber(L, js_viewH());
  return 2;
}
static int scrRegionSize(lua_State *L) {
  const char *n = luaL_checkstring(L, 1);
  double w = js_regionW(n);
  if (w < 0) return 0;
  lua_pushinteger(L, (int)w);
  lua_pushinteger(L, (int)js_regionH(n));
  return 2;
}
static int scrRegionSlice(lua_State *L) {
  const char *n = luaL_checkstring(L, 1);
  if (!js_regionSlice(n, g_args)) return 0;
  for (int i = 0; i < 6; i++) lua_pushinteger(L, (int)g_args[i]);
  return 6;
}
static int scrTextWidth(lua_State *L) {
  const char *t = luaL_checkstring(L, 1);
  double scale = luaL_optnumber(L, 2, 1);
  const char *f = lua_isstring(L, 3) ? lua_tostring(L, 3) : "";
  lua_pushnumber(L, js_textWidth(t, f, scale));
  return 1;
}

/* ---- input polling ---- */
static int scrKeyDown(lua_State *L) { lua_pushboolean(L, js_keyDown(luaL_checkstring(L, 1))); return 1; }
static int scrMousePos(lua_State *L) { lua_pushnumber(L, js_mouseX()); lua_pushnumber(L, js_mouseY()); return 2; }
static int scrMouseDown(lua_State *L) { lua_pushboolean(L, js_mouseBtn((int)luaL_checkinteger(L, 1))); return 1; }
static int scrKeyModifiers(lua_State *L) {
  int m = js_keyMods();
  lua_pushboolean(L, m & 1);
  lua_pushboolean(L, m & 2);
  lua_pushboolean(L, m & 4);
  return 3;
}

/* ---- audio / misc ---- */
static int scrSoundPlay(lua_State *L) { js_soundPlay(luaL_checkstring(L, 1)); return 0; }
static int scrMusicPlay(lua_State *L) {
  const char *n = luaL_checkstring(L, 1);
  double fade = luaL_optnumber(L, 2, 0.5);
  int loop = lua_isnoneornil(L, 3) ? 1 : lua_toboolean(L, 3);
  js_musicPlay(n, fade, loop);
  return 0;
}
static int scrMusicStop(lua_State *L) { js_musicStop(luaL_optnumber(L, 1, 0.5)); return 0; }
static int scrMusicVolume(lua_State *L) { js_musicVolume(luaL_checknumber(L, 1)); return 0; }
static int scrUiShowMessage(lua_State *L) {
  const char *t = luaL_checkstring(L, 1);
  double s = luaL_optnumber(L, 2, 3.0);
  js_showMessage(t, s);
  return 0;
}
static int scrRequestQuit(lua_State *L) { (void)L; js_requestQuit(); return 0; }
static int scrImeShow(lua_State *L) {
  js_imeShow(luaL_checknumber(L, 1), luaL_checknumber(L, 2),
             luaL_checknumber(L, 3), luaL_checknumber(L, 4));
  return 0;
}
static int scrImeHide(lua_State *L) { (void)L; js_imeHide(); return 0; }

/* ---- options (in-memory for M1; localStorage persistence lands in M2) ----
 * Kept as a Lua table in the registry so values (incl. nested tables) round-
 * trip with zero JS marshalling. optSave/optLoad are no-ops that report
 * success for now. */
static void pushOpts(lua_State *L) {
  lua_getfield(L, LUA_REGISTRYINDEX, "__opts");
  if (!lua_istable(L, -1)) {
    lua_pop(L, 1);
    lua_newtable(L);
    lua_pushvalue(L, -1);
    lua_setfield(L, LUA_REGISTRYINDEX, "__opts");
  }
}
static int scrOptSet(lua_State *L) {
  const char *k = luaL_checkstring(L, 1);
  pushOpts(L);
  lua_pushvalue(L, 2);
  lua_setfield(L, -2, k);
  lua_pop(L, 1);
  return 0;
}
static int scrOptGet(lua_State *L) {
  const char *k = luaL_checkstring(L, 1);
  pushOpts(L);
  lua_getfield(L, -1, k);
  if (lua_isnil(L, -1)) {
    lua_pop(L, 1);
    if (lua_isnoneornil(L, 2)) lua_pushnil(L); else lua_pushvalue(L, 2);
  }
  return 1;   /* top is the value; the opts table beneath is ignored */
}
/* Serialize the opts table to a `return { ... }` string (via the embedded
   __soobSerialize Lua fn, registered in registerAll) and hand it to the host,
   which writes it to localStorage. Same file format as the desktop find5.dat. */
static int scrOptSave(lua_State *L) {
  lua_getglobal(L, "__soobSerialize");
  if (!lua_isfunction(L, -1)) { lua_pop(L, 1); lua_pushboolean(L, 0); return 1; }
  pushOpts(L);
  if (lua_pcall(L, 1, 1, 0)) { js_log(lua_tostring(L, -1)); lua_pop(L, 1); lua_pushboolean(L, 0); return 1; }
  const char *str = lua_tostring(L, -1);
  js_optSave(str ? str : "return {}");
  lua_pop(L, 1);
  lua_pushboolean(L, 1);
  return 1;
}

/* Pull the saved string from the host (localStorage), load it as a chunk, and
   install the resulting table as the opts store. No-op if nothing is saved. */
static void loadOpts(lua_State *L) {
  char *str = js_optLoad();
  if (!str) return;
  if (luaL_loadstring(L, str) == 0 && lua_pcall(L, 0, 1, 0) == 0 && lua_istable(L, -1)) {
    lua_setfield(L, LUA_REGISTRYINDEX, "__opts");
  } else {
    lua_pop(L, 1);
  }
  free(str);
}
static int scrOptLoad(lua_State *L) { loadOpts(L); lua_pushboolean(L, 1); return 1; }

/* ---- print -> console (tab-joined, like stock print) ---- */
static int scrPrint(lua_State *L) {
  int n = lua_gettop(L), pos = 0;
  char buf[512];
  lua_getglobal(L, "tostring");
  for (int i = 1; i <= n; i++) {
    lua_pushvalue(L, -1);
    lua_pushvalue(L, i);
    lua_call(L, 1, 1);
    const char *s = lua_tostring(L, -1);
    if (!s) s = "(nil)";
    if (pos > 0 && pos < (int)sizeof(buf) - 1) buf[pos++] = '\t';
    while (*s && pos < (int)sizeof(buf) - 1) buf[pos++] = *s++;
    lua_pop(L, 1);
  }
  lua_pop(L, 1);
  buf[pos] = '\0';
  js_log(buf);
  return 0;
}

/* ---- error traceback (ported from script.h) ---- */
static int scrTraceback(lua_State *L) {
  if (!lua_isstring(L, 1)) return 1;
  lua_getfield(L, LUA_GLOBALSINDEX, "debug");
  if (!lua_istable(L, -1)) { lua_pop(L, 1); return 1; }
  lua_getfield(L, -1, "traceback");
  if (!lua_isfunction(L, -1)) { lua_pop(L, 2); return 1; }
  lua_pushvalue(L, 1);
  lua_pushinteger(L, 2);
  lua_call(L, 2, 1);
  return 1;
}

/* ---- sandbox + registration ---- */
static void scriptSandbox(lua_State *L) {
  const char *banned[] = { "os", "io", "dofile", "loadfile", "load", "loadstring", "module", 0 };
  for (int i = 0; banned[i]; i++) { lua_pushnil(L); lua_setglobal(L, banned[i]); }
  /* Scripts live in MEMFS under /game/scripts (engine modules in engine/, so
     require "engine.scene" -> /game/scripts/engine/scene.lua). cpath empty:
     require never reaches a native lib. luaL_dostring is C-level, unaffected
     by nil'ing the load* globals above. */
  luaL_dostring(L,
    "package.path='/game/scripts/?.lua;/game/scripts/?/init.lua'\n"
    "package.cpath=''\n");
}

static void setconst(lua_State *L, const char *n, int v) { lua_pushinteger(L, v); lua_setglobal(L, n); }

static void registerAll(lua_State *L) {
  lua_register(L, "uiShowMessage", scrUiShowMessage);
  lua_register(L, "soundPlay", scrSoundPlay);
  lua_register(L, "musicPlay", scrMusicPlay);
  lua_register(L, "musicStop", scrMusicStop);
  lua_register(L, "musicVolume", scrMusicVolume);
  lua_register(L, "keyDown", scrKeyDown);
  lua_register(L, "mousePos", scrMousePos);
  lua_register(L, "mouseDown", scrMouseDown);
  lua_register(L, "keyModifiers", scrKeyModifiers);
  lua_register(L, "drawRegion", scrDrawRegion);
  lua_register(L, "drawText", scrDrawText);
  lua_register(L, "textWidth", scrTextWidth);
  lua_register(L, "drawEllipse", scrDrawEllipse);
  lua_register(L, "drawQuad", scrDrawQuad);
  lua_register(L, "drawBg", scrDrawBg);
  lua_register(L, "drawBlur", scrDrawBlur);
  lua_register(L, "viewSize", scrViewSize);
  lua_register(L, "regionSlice", scrRegionSlice);
  lua_register(L, "regionSize", scrRegionSize);
  lua_register(L, "optSet", scrOptSet);
  lua_register(L, "optGet", scrOptGet);
  lua_register(L, "optSave", scrOptSave);
  lua_register(L, "optLoad", scrOptLoad);
  lua_register(L, "requestQuit", scrRequestQuit);
  lua_register(L, "imeShow", scrImeShow);
  lua_register(L, "imeHide", scrImeHide);
  lua_register(L, "print", scrPrint);

  setconst(L, "ALIGN_LEFT", 1);   setconst(L, "ALIGN_CENTER", 2);  setconst(L, "ALIGN_RIGHT", 4);
  setconst(L, "ALIGN_TOP", 8);    setconst(L, "ALIGN_MIDDLE", 16); setconst(L, "ALIGN_BOTTOM", 32);
  setconst(L, "FLIP_H", 1);       setconst(L, "FLIP_V", 2);

  /* Options serializer used by optSave — produces a `return { ... }` chunk in
     the same format as the desktop find5.dat (array part + bracketed keys,
     %q-escaped strings, depth-capped). string/math/table are not sandboxed. */
  luaL_dostring(L,
    "function __soobSerialize(opts)\n"
    "  local function s(v, d)\n"
    "    local t = type(v)\n"
    "    if t == 'number' then return tostring(v)\n"
    "    elseif t == 'boolean' then return v and 'true' or 'false'\n"
    "    elseif t == 'string' then return string.format('%q', v)\n"
    "    elseif t == 'table' and d < 16 then\n"
    "      local o = {'{'}\n"
    "      local n = #v\n"
    "      for i = 1, n do o[#o+1] = s(v[i], d+1) .. ',' end\n"
    "      for k, val in pairs(v) do\n"
    "        local isArr = (type(k) == 'number' and k == math.floor(k) and k >= 1 and k <= n)\n"
    "        if not isArr then\n"
    "          local ks\n"
    "          if type(k) == 'string' then ks = '[' .. string.format('%q', k) .. ']'\n"
    "          elseif type(k) == 'number' then ks = '[' .. tostring(k) .. ']' end\n"
    "          if ks then o[#o+1] = ks .. '=' .. s(val, d+1) .. ',' end\n"
    "        end\n"
    "      end\n"
    "      o[#o+1] = '}'\n"
    "      return table.concat(o)\n"
    "    else return 'nil' end\n"
    "  end\n"
    "  return 'return ' .. s(opts or {}, 0)\n"
    "end\n");
}

/* ---- asset manifest walk (ported from scriptLoadAssets) ---- */
static int walkStrings(lua_State *L, int t, const char *field,
                       void (*reg)(const char *, const char *)) {
  int count = 0;
  lua_getfield(L, t, field);
  if (lua_istable(L, -1)) {
    int st = lua_gettop(L);
    lua_pushnil(L);
    while (lua_next(L, st)) {
      const char *k = lua_tostring(L, -2);
      if (k && lua_isstring(L, -1)) { reg(k, lua_tostring(L, -1)); count++; }
      else if (k && lua_istable(L, -1)) {           /* random-pick group */
        int vt = lua_gettop(L), n = (int)lua_objlen(L, vt);
        for (int i = 1; i <= n; i++) {
          lua_rawgeti(L, vt, i);
          if (lua_isstring(L, -1)) { reg(k, lua_tostring(L, -1)); count++; }
          lua_pop(L, 1);
        }
      }
      lua_pop(L, 1);
    }
  }
  lua_pop(L, 1);
  return count;
}

/* ---------------------------------------------------------------------------
 * Exported entry points (called from src/host/lua.ts via Module.ccall).
 * ------------------------------------------------------------------------- */
EMSCRIPTEN_KEEPALIVE void soob_new(void) {
  gL = luaL_newstate();
  luaL_openlibs(gL);
  scriptSandbox(gL);
  registerAll(gL);
  loadOpts(gL);   /* auto-load persisted options (mirrors desktop scriptInit) */
}

EMSCRIPTEN_KEEPALIVE int soob_doFile(const char *path) {
  lua_State *L = gL;
  lua_pushcfunction(L, scrTraceback);
  int tb = lua_gettop(L);
  if (luaL_loadfile(L, path)) { js_log(lua_tostring(L, -1)); lua_pop(L, 2); return 0; }
  if (lua_pcall(L, 0, 0, tb)) { js_log(lua_tostring(L, -1)); lua_pop(L, 2); return 0; }
  lua_pop(L, 1);
  return 1;
}

EMSCRIPTEN_KEEPALIVE int soob_doString(const char *src) {
  lua_State *L = gL;
  lua_pushcfunction(L, scrTraceback);
  int tb = lua_gettop(L);
  if (luaL_loadstring(L, src)) { js_log(lua_tostring(L, -1)); lua_pop(L, 2); return 0; }
  if (lua_pcall(L, 0, 0, tb)) { js_log(lua_tostring(L, -1)); lua_pop(L, 2); return 0; }
  lua_pop(L, 1);
  return 1;
}

EMSCRIPTEN_KEEPALIVE int soob_loadAssets(const char *path) {
  lua_State *L = gL;
  lua_pushcfunction(L, scrTraceback);
  int tb = lua_gettop(L);
  if (luaL_loadfile(L, path)) { js_log(lua_tostring(L, -1)); lua_pop(L, 2); return 0; }
  if (lua_pcall(L, 0, 1, tb)) { js_log(lua_tostring(L, -1)); lua_pop(L, 2); return 0; }
  if (!lua_istable(L, -1)) { js_log("assets.lua must return a table"); lua_pop(L, 2); return 0; }

  int t = lua_gettop(L);
  int ns = walkStrings(L, t, "sounds", js_regSound);
  int nm = walkStrings(L, t, "music", js_regMusic);
  int nt = walkStrings(L, t, "textures", js_regTexture);
  int nf = walkStrings(L, t, "fonts", js_regFont);
  int nr = 0;

  lua_getfield(L, t, "regions");
  if (lua_istable(L, -1)) {
    int rt = lua_gettop(L);
    lua_pushnil(L);
    while (lua_next(L, rt)) {
      const char *k = lua_tostring(L, -2);
      if (k && lua_istable(L, -1)) {
        int vt = lua_gettop(L);
        lua_getfield(L, vt, "tex");
        const char *tex = lua_isstring(L, -1) ? lua_tostring(L, -1) : "";
        double *A = g_args;
        A[0] = optNum(L, vt, "x", 0);
        A[1] = optNum(L, vt, "y", 0);
        A[2] = optNum(L, vt, "w", 0);
        A[3] = optNum(L, vt, "h", 0);
        A[4] = 0; A[5] = A[6] = A[7] = A[8] = 0;
        lua_getfield(L, vt, "slice");
        if (lua_istable(L, -1)) {
          int sl = lua_gettop(L);
          A[4] = 1;
          A[5] = optNum(L, sl, "x1", 0);
          A[6] = optNum(L, sl, "x2", 0);
          A[7] = optNum(L, sl, "y1", 0);
          A[8] = optNum(L, sl, "y2", 0);
        }
        lua_pop(L, 1);            /* slice */
        js_regRegion(k, tex, g_args);
        nr++;
        lua_pop(L, 1);           /* tex */
      }
      lua_pop(L, 1);             /* value */
    }
  }
  lua_pop(L, 1);                 /* regions */

  lua_pop(L, 2);                 /* assets table + traceback */
  char buf[192];
  snprintf(buf, sizeof buf,
           "assets: %d sound(s), %d music, %d texture(s), %d font(s), %d region(s)",
           ns, nm, nt, nf, nr);
  js_log(buf);
  return 1;
}

/* ---- hook dispatch ---- */
static int beginHook(const char *name) {           /* returns traceback index, or 0 */
  lua_pushcfunction(gL, scrTraceback);
  int tb = lua_gettop(gL);
  lua_getglobal(gL, name);
  if (!lua_isfunction(gL, -1)) { lua_pop(gL, 2); return 0; }
  return tb;
}
static void endHook(int tb, int nargs) {
  if (lua_pcall(gL, nargs, 0, tb)) { js_log(lua_tostring(gL, -1)); lua_pop(gL, 1); }
  lua_remove(gL, tb);
}

EMSCRIPTEN_KEEPALIVE void soob_callHook0(const char *name) {
  int tb = beginHook(name);
  if (tb) endHook(tb, 0);
}
EMSCRIPTEN_KEEPALIVE void soob_update(double dt) {
  int tb = beginHook("onUpdate");
  if (!tb) return;
  lua_pushnumber(gL, dt);
  endHook(tb, 1);
}
EMSCRIPTEN_KEEPALIVE void soob_render(void) { soob_callHook0("onRender"); }
EMSCRIPTEN_KEEPALIVE void soob_mouseDown(double x, double y, int b) {
  int tb = beginHook("onMouseDown");
  if (!tb) return;
  lua_pushnumber(gL, x); lua_pushnumber(gL, y); lua_pushinteger(gL, b);
  endHook(tb, 3);
}
EMSCRIPTEN_KEEPALIVE void soob_mouseUp(double x, double y, int b) {
  int tb = beginHook("onMouseUp");
  if (!tb) return;
  lua_pushnumber(gL, x); lua_pushnumber(gL, y); lua_pushinteger(gL, b);
  endHook(tb, 3);
}
EMSCRIPTEN_KEEPALIVE void soob_mouseMove(double x, double y, double dx, double dy) {
  int tb = beginHook("onMouseMove");
  if (!tb) return;
  lua_pushnumber(gL, x); lua_pushnumber(gL, y); lua_pushnumber(gL, dx); lua_pushnumber(gL, dy);
  endHook(tb, 4);
}
EMSCRIPTEN_KEEPALIVE void soob_keyDown(const char *name) {
  int tb = beginHook("onKeyDown");
  if (!tb) return;
  lua_pushstring(gL, name);
  endHook(tb, 1);
}
EMSCRIPTEN_KEEPALIVE void soob_keyUp(const char *name) {
  int tb = beginHook("onKeyUp");
  if (!tb) return;
  lua_pushstring(gL, name);
  endHook(tb, 1);
}
EMSCRIPTEN_KEEPALIVE void soob_textInput(const char *ch) {
  int tb = beginHook("onTextInput");
  if (!tb) return;
  lua_pushstring(gL, ch);
  endHook(tb, 1);
}
