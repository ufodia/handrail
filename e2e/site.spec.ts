import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

test('installation site offers a real limited-permission extension ZIP and readable mobile practice links', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Show it once.');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download extension ZIP', exact: false }).click();
  const download = await downloadPromise;
  const filename = await download.path();
  expect(filename).toBeTruthy();
  const files = unzipSync(new Uint8Array(await readFile(filename!)));
  expect(Object.keys(files).sort()).toEqual(
    [
      'INSTALL.txt',
      'LICENSE',
      'background.js',
      'content.js',
      'icons/128.png',
      'icons/16.png',
      'icons/32.png',
      'icons/48.png',
      'manifest.json',
      'popup.css',
      'popup.html',
      'popup.js',
    ].sort(),
  );
  const manifest = JSON.parse(strFromU8(files['manifest.json']!));
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions).toEqual(['storage', 'activeTab', 'scripting']);
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.externally_connectable).toBeUndefined();
  expect(manifest.content_scripts).toBeUndefined();
  expect(strFromU8(files['INSTALL.txt']!)).toContain('manual installation');
  await expect(
    page.getByRole('link', { name: 'Open practice page', exact: false }).first(),
  ).toHaveAttribute('href', '/practice.html');
  await expect(page.getByRole('link', { name: /coffee/i }).first()).toHaveAttribute(
    'href',
    'https://buymeacoffee.com/ufodia',
  );
  await mkdir(path.resolve('docs/assets'), { recursive: true });
  await page.screenshot({ path: path.resolve('docs/assets/site.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.goto('/practice.html');
  await page.getByRole('button', { name: 'Open preferences', exact: true }).click();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Nothing was sent');
  expect(errors).toEqual([]);
});
