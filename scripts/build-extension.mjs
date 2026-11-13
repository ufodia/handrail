import { build } from 'esbuild';
import { zipSync } from 'fflate';
import { copyFile, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const output = resolve(root, 'extension-dist');
if (relative(root, output) !== 'extension-dist' || dirname(output) !== root)
  throw new Error('Unexpected extension output path.');
try {
  const info = await lstat(output);
  if (info.isSymbolicLink() || !info.isDirectory() || (await realpath(output)) !== output)
    throw new Error('Refusing linked extension output.');
  await rm(output, { recursive: true });
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
await mkdir(output);
await Promise.all(
  ['background', 'content', 'popup'].map((name) =>
    build({
      entryPoints: [join(root, `src/${name}.ts`)],
      outfile: join(output, `${name}.js`),
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'chrome120',
      minify: true,
      legalComments: 'inline',
      sourcemap: false,
    }),
  ),
);
const staticFiles = [
  'manifest.json',
  'popup.html',
  'popup.css',
  'INSTALL.txt',
  'icons/16.png',
  'icons/32.png',
  'icons/48.png',
  'icons/128.png',
];
for (const name of staticFiles) {
  await mkdir(dirname(join(output, name)), { recursive: true });
  await copyFile(join(root, 'extension', name), join(output, name));
}
await copyFile(join(root, 'LICENSE'), join(output, 'LICENSE'));
const names = [...staticFiles, 'background.js', 'content.js', 'popup.js', 'LICENSE'];
const files = Object.fromEntries(
  await Promise.all(
    names.map(async (name) => [name, new Uint8Array(await readFile(join(output, name)))]),
  ),
);
const downloads = join(root, 'public/downloads');
await mkdir(downloads, { recursive: true });
await writeFile(join(downloads, 'handrail.zip'), zipSync(files, { level: 6 }));
console.log(`Built ${names.length} reviewed extension files and public/downloads/handrail.zip.`);
