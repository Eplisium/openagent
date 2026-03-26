import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const stubReactDevtools = {
  name: 'stub-react-devtools-core',
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: 'react-devtools-core',
      namespace: 'stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export default {}',
      loader: 'js',
    }));
  },
};

// Copy cfonts fonts — GetFont.js does require('../fonts/X.json') which resolves
// relative to the bundle at dist/cli-ink.mjs → <project-root>/fonts/X.json
const copyCfontsFonts = {
  name: 'copy-cfonts-fonts',
  setup(build) {
    build.onEnd(() => {
      const srcDir = path.join('node_modules', 'cfonts', 'fonts');
      // ../fonts from dist/ = project root /fonts
      const destDir = path.join('fonts');
      if (fs.existsSync(srcDir)) {
        fs.mkdirSync(destDir, { recursive: true });
        for (const file of fs.readdirSync(srcDir)) {
          fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
        }
        console.log('Copied cfonts fonts to fonts/');
      }
    });
  },
};

// Copy yoga.wasm to dist/ so the bundled yoga-wasm-web can find it at runtime
const copyYogaWasm = {
  name: 'copy-yoga-wasm',
  setup(build) {
    build.onEnd(() => {
      const src = path.join('node_modules', 'yoga-wasm-web', 'dist', 'yoga.wasm');
      const dest = path.join('dist', 'yoga.wasm');
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log('Copied yoga.wasm to dist/');
      }
    });
  },
};

await esbuild.build({
  entryPoints: ['src/cli-ink.js'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/cli-ink.mjs',
  jsx: 'automatic',
  loader: { '.jsx': 'jsx' },
  plugins: [stubReactDevtools, copyYogaWasm, copyCfontsFonts],
  // Externalize Node.js builtins that esbuild can't resolve in ESM context
  external: [
    'readline/promises',
    'node:*',
  ],
  banner: {
    js: [
      // Polyfill require() for ESM bundles — esbuild's __require throws on
      // built-in modules. This shim lets CJS deps resolve Node core modules.
      'import { createRequire } from "module";',
      'const require = createRequire(import.meta.url);',
    ].join('\n'),
  },
});
