import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{js,jsx}'],
    exclude: ['node_modules', 'dist'],
    transformMode: {
      web: [/\.jsx?$/],
      ssr: [/\.jsx?$/]
    }
  },
  esbuild: {
    loader: 'jsx',
    include: [/\.jsx?$/],
    exclude: [],
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment'
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx'
      }
    }
  }
});
