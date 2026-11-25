import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { defineConfig, type Plugin } from 'vite';
import { createSkinInitScript } from '@moonwitness/ui/themes';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const boardRoot = path.resolve(__dirname, '../../board');
const assetsFontsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.resolve('@moonwitness/assets/fonts.css'))),
  'fonts'
);
const distBoardDir = path.resolve(__dirname, '../dist-board');

function skinPrepaintPlugin(): Plugin {
  return {
    name: 'mw-skin-prepaint',
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          children: createSkinInitScript(),
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

function copyBoardRouteHtmlPlugin(): Plugin {
  return {
    name: 'mw-copy-board-route-html',
    closeBundle() {
      const srcHtml = path.join(distBoardDir, 'index.html');
      if (fs.existsSync(srcHtml)) {
        const targetDir = path.join(distBoardDir, 'board');
        fs.mkdirSync(targetDir, { recursive: true });
        fs.copyFileSync(srcHtml, path.join(targetDir, 'index.html'));
      }

      const fontTargetDir = path.join(distBoardDir, 'assets', 'fonts');
      const fontSourceDirs = [path.join(boardRoot, 'public', 'fonts'), assetsFontsDir];
      for (const sourceDir of fontSourceDirs) {
        if (!fs.existsSync(sourceDir)) continue;
        const woff2Files = fs
          .readdirSync(sourceDir)
          .filter((entry) => entry.toLowerCase().endsWith('.woff2'));
        if (woff2Files.length === 0) continue;
        fs.mkdirSync(fontTargetDir, { recursive: true });
        for (const fontFile of woff2Files) {
          fs.copyFileSync(path.join(sourceDir, fontFile), path.join(fontTargetDir, fontFile));
        }
      }
    },
  };
}

export default defineConfig({
  root: __dirname,
  base: '/',
  publicDir: path.join(boardRoot, 'public'),
  plugins: [react(), skinPrepaintPlugin(), copyBoardRouteHtmlPlugin()],
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
