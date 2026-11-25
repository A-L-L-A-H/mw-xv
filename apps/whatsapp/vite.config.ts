import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import viteFastify from '@fastify/vite/plugin';

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'client'),
  plugins: [viteFastify({ spa: true }), react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
