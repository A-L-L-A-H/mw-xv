import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { defineConfig, type Plugin } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const boardRoot = path.resolve(__dirname, '../../board');
const distBoardDir = path.resolve(__dirname, '../dist-board');

function copyBoardRouteHtmlPlugin(): Plugin {
  return {
    name: 'mw-copy-board-route-html',
    closeBundle() {
      const srcHtml = path.join(distBoardDir, 'index.html');
      if (!fs.existsSync(srcHtml)) return;
      const targetDir = path.join(distBoardDir, 'board');
      fs.mkdirSync(targetDir, { recursive: true });
      fs.copyFileSync(srcHtml, path.join(targetDir, 'index.html'));
    },
  };
}

export default defineConfig({
  root: __dirname,
  base: '/',
  publicDir: path.join(boardRoot, 'public'),
  plugins: [react(), copyBoardRouteHtmlPlugin()],
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  },
  define: {
    'process.env.NEXT_PUBLIC_API_URL': JSON.stringify(''),
    'process.env.NEXT_PUBLIC_SITE_URL': JSON.stringify(''),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  resolve: {
    alias: {
      '@': path.join(boardRoot, 'src'),
      'next/link': path.resolve(__dirname, './shims/next-link.tsx'),
      'next/navigation': path.resolve(__dirname, './shims/next-navigation.ts'),
      'next/image': path.resolve(__dirname, './shims/next-image.tsx'),
      'next/dynamic': path.resolve(__dirname, './shims/next-dynamic.tsx'),
    },
  },
  build: {
    outDir: distBoardDir,
    emptyOutDir: true,
    sourcemap: false,
  },
});
