import { defineConfig } from 'vite';
import type { OutputBundle } from 'rollup';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('./package.json') as { version: string };

const userscriptHeader = `// ==UserScript==
// @name         YouTube PiP
// @namespace    https://github.com/dmitroderkach/youtube-pip
// @version      ${pkg.version}
// @description  Smart Picture-in-Picture mode with all YouTube controls and functions
// @author       Dmytro Derkach
// @match        https://www.youtube.com/*
// @grant        none
// @homepageURL  https://github.com/dmitroderkach/youtube-pip
// @supportURL   https://github.com/dmitroderkach/youtube-pip/issues
// @updateURL    https://github.com/dmitroderkach/youtube-pip/releases/latest/download/youtube-pip.user.js
// @downloadURL  https://github.com/dmitroderkach/youtube-pip/releases/latest/download/youtube-pip.user.js
// @license      MIT
// ==/UserScript==

`;

const headerLineCount = (userscriptHeader.match(/\n/g) ?? []).length;

/**
 * Tampermonkey wraps the userscript in a wrapper function, adding lines before our code.
 * The source map must offset generated lines by this amount so DevTools resolve correctly.
 * @see https://github.com/Tampermonkey/tampermonkey/issues/1621
 * Tune via env: TAMPERMONKEY_SOURCEMAP_OFFSET=3 npm run build
 */
const TAMPERMONKEY_SOURCEMAP_OFFSET = Number(process.env.TAMPERMONKEY_SOURCEMAP_OFFSET) || 1;

const INLINE_SOURCEMAP_RE =
  /(\/\/# sourceMappingURL=data:application\/json;charset=utf-8;base64,)([A-Za-z0-9+/=]+)\s*$/m;

function shiftInlineSourceMap(code: string, extraLines: number): string {
  const match = code.match(INLINE_SOURCEMAP_RE);
  if (!match || extraLines <= 0) return code;
  try {
    const raw = Buffer.from(match[2], 'base64').toString('utf-8');
    const map = JSON.parse(raw) as { mappings: string };
    map.mappings = ';'.repeat(extraLines) + map.mappings;
    const b64 = Buffer.from(JSON.stringify(map), 'utf-8').toString('base64');
    return code.replace(INLINE_SOURCEMAP_RE, `$1${b64}\n`);
  } catch {
    return code;
  }
}

/** Prepends userscript header in debug build and shifts source map. Vite output.banner is unreliable. */
function userscriptHeaderDebugPlugin() {
  return {
    name: 'userscript-header-debug',
    enforce: 'post' as const,
    generateBundle(_, bundle: OutputBundle) {
      const items = Object.values(bundle);
      for (const item of items) {
        if (item.type !== 'chunk' || item.fileName !== 'userscript.js') continue;
        const chunk = item;
        chunk.code = userscriptHeader + chunk.code;
        chunk.code = shiftInlineSourceMap(chunk.code, headerLineCount);
      }
    },
  };
}

function tampermonkeySourceMapOffsetPlugin(offset: number) {
  return {
    name: 'tampermonkey-sourcemap-offset',
    enforce: 'post' as const,
    generateBundle(_, bundle: OutputBundle) {
      const items = Object.values(bundle);
      for (const item of items) {
        if (item.type !== 'chunk' || item.fileName !== 'userscript.js') continue;
        const chunk = item;
        chunk.code = shiftInlineSourceMap(chunk.code, offset);
      }
    },
  };
}

const isDebug = process.env.BUILD_DEBUG === '1';

export default defineConfig({
  define: {
    SCRIPT_VERSION: JSON.stringify(pkg.version),
  },
  build: {
    sourcemap: 'inline',
    minify: isDebug ? false : 'terser',
    ...(isDebug
      ? {}
      : {
          terserOptions: {
            format: { preamble: userscriptHeader },
          },
        }),
    rollupOptions: {
      input: 'src/main.ts',
      output: {
        format: 'iife',
        entryFileNames: 'userscript.js',
        inlineDynamicImports: true,
      },
      plugins: [
        ...(isDebug ? [userscriptHeaderDebugPlugin()] : []),
        tampermonkeySourceMapOffsetPlugin(TAMPERMONKEY_SOURCEMAP_OFFSET),
      ],
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
});
