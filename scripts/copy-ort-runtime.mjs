import { mkdir, readdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

const source = new URL('../node_modules/onnxruntime-web/dist/', import.meta.url);
const destination = new URL('../public/ort/', import.meta.url);
try {
  await mkdir(destination, { recursive: true });
  const files = await readdir(source);
  const assets = files.filter(file => /^ort-wasm-.*\.(wasm|mjs)$/.test(file));
  if (assets.length === 0) throw new Error('ONNX Runtime WebAssembly files not found');
  for (const file of assets) {
    await copyFile(new URL(file, source), new URL(file, destination));
  }
  console.log(`Copied ${assets.length} ONNX Runtime WASM assets to public/ort`);
} catch (error) {
  console.error('ONNX Runtime static asset preparation failed:', error);
  process.exitCode = 1;
}
