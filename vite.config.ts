import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Vite normally rejects importing files from public/ as source modules.
 * ONNX Runtime Web dynamically imports its Emscripten .mjs with ?import in dev;
 * serve exactly the copied, version-matched runtime module as raw JS instead.
 * This middleware is DEV ONLY; production Vite serves public/ort statically.
 */
const serveOnnxWasmRuntime = () => ({
  name: 'visionqc-raw-onnx-mjs',
  configureServer(server: import('vite').ViteDevServer) {
    server.middlewares.use((req, res, next) => {
      const match = /^\/ort\/(ort-wasm-[a-zA-Z0-9.-]+\.mjs)\?import(?:&|$)/.exec(req.url ?? '');
      if (!match) { next(); return; }
      const filePath = fileURLToPath(new URL(`./public/ort/${match[1]}`, import.meta.url));
      if (!existsSync(filePath)) { next(); return; }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      createReadStream(filePath).on('error', error => { console.error('ONNX WASM module stream failed', error); res.destroy(error); }).pipe(res);
    });
  },
});

export default defineConfig({
  plugins: [serveOnnxWasmRuntime(), react()],
  server: { host: '127.0.0.1' },
});
