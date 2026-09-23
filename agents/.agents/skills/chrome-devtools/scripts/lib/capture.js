import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { booleanArg, numberArg } from './browser.js';
import { elementFor, waitForReady } from './session.js';

async function compressImageIfNeeded(file, maxSizeMB) {
  const originalSize = (await fs.stat(file)).size;
  const unchanged = { compressed: false, originalSize, size: originalSize };
  if (originalSize <= maxSizeMB * 1024 * 1024) return unchanged;
  let directory;
  try {
    const command = ['magick', 'convert'].find(candidate => {
      try { execFileSync(candidate, ['-version'], { stdio: 'pipe', timeout: 5000 }); return true; }
      catch { return false; }
    });
    if (!command) return { ...unchanged, compressionWarning: 'ImageMagick is not installed' };
    directory = await fs.mkdtemp(path.join(path.dirname(file), '.screenshot-'));
    // Keep the original format, including WebP, and replace only when smaller.
    const temporary = path.join(directory, path.basename(file));
    execFileSync(command, [file, '-strip', '-resize', '90%', '-quality', '80', temporary], { stdio: 'pipe', timeout: 30000 });
    let size = (await fs.stat(temporary)).size;
    if (size > maxSizeMB * 1024 * 1024) {
      execFileSync(command, [temporary, '-resize', '75%', '-quality', '60', temporary], { stdio: 'pipe', timeout: 30000 });
      size = (await fs.stat(temporary)).size;
    }
    if (size >= originalSize) return unchanged;
    await fs.rename(temporary, file);
    return { compressed: true, originalSize, size, compressionRatio: `${((1 - size / originalSize) * 100).toFixed(2)}%` };
  } catch (error) {
    return { ...unchanged, compressionWarning: error.message };
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
}

export async function capture(page, options) {
  if (typeof options.output !== 'string' || !options.output) throw new Error('--output is required');
  const output = path.resolve(options.output);
  const extension = path.extname(output).toLowerCase();
  const format = options.format || (extension === '.jpg' || extension === '.jpeg' ? 'jpeg' : extension === '.webp' ? 'webp' : 'png');
  if (!['png', 'jpeg', 'webp'].includes(format)) throw new Error('Screenshot format must be png, jpeg, or webp');
  let quality;
  if (options.quality !== undefined) {
    quality = numberArg(options.quality, 80);
    if (!Number.isInteger(quality) || quality > 100 || format === 'png') throw new Error('Quality must be an integer 0–100, for jpeg/webp only');
  }
  const compress = !booleanArg(options['no-compress']);
  const maxSize = numberArg(options['max-size'], 5, 0.001);
  await fs.mkdir(path.dirname(output), { recursive: true });
  if (booleanArg(options['scroll-top'])) {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  await waitForReady(page, options);
  const screenshotOptions = { path: output, type: format, ...(quality === undefined ? {} : { quality }) };
  let buffer;
  if (options.selector) {
    const element = await elementFor(page, options.selector, options);
    try { buffer = await element.screenshot(screenshotOptions); }
    finally { await element.dispose(); }
  } else {
    buffer = await page.screenshot({ ...screenshotOptions, fullPage: booleanArg(options['full-page']) });
  }
  return {
    output, url: page.url(),
    ...(compress ? await compressImageIfNeeded(output, maxSize) : { compressed: false, size: buffer.length }),
  };
}
