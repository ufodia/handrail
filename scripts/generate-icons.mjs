import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const svg = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8');
await mkdir(new URL('../extension/icons/', import.meta.url), { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<canvas></canvas>');
  for (const size of [16, 32, 48, 128]) {
    const png = await page.evaluate(
      async ({ svg, size }) => {
        const canvas = document.querySelector('canvas');
        canvas.width = size;
        canvas.height = size;
        const image = new Image();
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        try {
          image.src = url;
          await image.decode();
          canvas.getContext('2d').drawImage(image, 0, 0, size, size);
          return canvas.toDataURL('image/png').split(',')[1];
        } finally {
          URL.revokeObjectURL(url);
        }
      },
      { svg, size },
    );
    await writeFile(
      new URL(`../extension/icons/${size}.png`, import.meta.url),
      Buffer.from(png, 'base64'),
    );
  }
} finally {
  await browser.close();
}
console.log('Generated four extension icons from the tracked SVG.');
