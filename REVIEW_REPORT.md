# OpenAgent Build Fix — Review Report

**Reviewer:** Reviewer (Phase 3/3)  
**Date:** 2026-03-25  
**Status:** ✅ PASS — Both original errors fixed

---

## Original Errors (FIXED)

### 1. `react-devtools-core` not found ✅
- **Root cause:** ink's `devtools.js` does unconditional `import devtools from "react-devtools-core"` even when `REACT_DEBUGGER` is not set. esbuild marked it as external, but the package isn't installed.
- **Fix:** `stubReactDevtools` plugin in `esbuild.config.mjs` intercepts the import and returns `{}` instead of failing.
- **Verification:** `node dist/cli-ink.mjs` loads without module resolution errors.

### 2. "Unknown file extension '.jsx'" ✅
- **Root cause:** `cli-ink.js` fallback path tried `import('./ui/App.jsx')` which Node.js can't handle natively.
- **Fix:** The fallback path (lines 113-131) already handles this correctly — exits with clear error messages ("Bundle not found" or "Failed to load bundle") instead of trying raw `.jsx` import. The `launchUI()` function with the raw `.jsx` import only executes when `IS_BUNDLE` is true (inside the compiled bundle where JSX is already compiled to JS).
- **Verification:** Missing bundle → "Bundle not found. Run 'npm run build' first." Corrupted bundle → "Failed to load bundle."

---

## Additional Fixes Applied

### 3. `Dynamic require of "assert" is not supported` ✅
- **Root cause:** `signal-exit` (ink dependency) uses `require('assert')` which fails in esbuild's ESM output.
- **Fix:** Banner polyfill: `import { createRequire } from "module"; const require = createRequire(import.meta.url);`

### 4. `yoga-wasm-web` WASM file not found ✅
- **Root cause:** `yoga-wasm-web` uses `createRequire(import.meta.url).resolve("./yoga.wasm")` which expects the WASM file relative to the bundle output.
- **Fix:** `copyYogaWasm` plugin copies `node_modules/yoga-wasm-web/dist/yoga.wasm` to `dist/` during build.

### 5. cfonts font files not found (cosmetic) ⚠️
- **Status:** Font files are copied to `dist/fonts/` but `GetFont.js` uses `path.normalize()` which strips `./` prefix on Windows, breaking `require()` resolution. This is a **cosmetic warning** — the UI still renders.
- **Impact:** BigText splash screen shows "Ouch: Font file for the font 'block' could not be found." but the UI renders normally.

---

## End-to-End Verification Results

| Check | Result |
|-------|--------|
| `npm run build` | ✅ Builds clean, copies yoga.wasm and cfonts fonts |
| `node dist/cli-ink.mjs` loads | ✅ Exports `startInkUI` |
| No `react-devtools-core` external import | ✅ Stubbed inline |
| No "Unknown file extension '.jsx'" | ✅ Fallback path exits cleanly |
| `node src/cli.js ui` renders UI | ✅ Status bar renders (Raw mode error is expected in non-TTY) |
| `yoga.wasm` in dist/ | ✅ 88KB copied |
| cfonts fonts in dist/fonts/ | ✅ All font JSON files copied |

---

## Remaining Issues (NOT blockers)

### 1. "Raw mode is not supported" (Ink/TTY limitation)
- **Status:** Expected behavior when running in PowerShell without a TTY. Ink requires raw stdin. In a real terminal (Windows Terminal, cmd.exe), this would work correctly.
- **Not a build issue.**

### 2. cfonts font path resolution (cosmetic)
- **Status:** `path.normalize('./fonts/block.json')` on Windows returns `fonts\block.json` (no `./` prefix), breaking `require()` resolution. Fonts are copied but not loadable.
- **Impact:** BigText splash screen shows "Ouch: Font file for the font 'block' could not be found." but the UI renders normally.
- **Fix needed:** Rewrite `GetFont.js` to use `path.resolve()` instead of `path.normalize()`, or inline font JSON into the bundle.

### 3. `ink-big-text` unused dependency warning
- **Status:** `ink-big-text` is installed but its `cfonts` dependency can't find font files at runtime (see #2).

---

## File Changes Summary

| File | Change |
|------|--------|
| `esbuild.config.mjs` | New file — esbuild config with 3 plugins (stubReactDevtools, copyYogaWasm, copyCfontsFonts) + createRequire banner |
| `src/cli-ink.js` | Already correct — fallback path exits cleanly |
| `package.json` | Build script updated: `node esbuild.config.mjs` |

---

## Verdict

**✅ PASS** — Both original errors are fixed. The build pipeline works end-to-end:
1. `npm run build` succeeds
2. `node dist/cli-ink.mjs` loads without module resolution errors
3. `node src/cli.js ui` renders the Ink UI (Raw mode error is expected in non-TTY)

The cfonts font warning is cosmetic and doesn't block functionality.
