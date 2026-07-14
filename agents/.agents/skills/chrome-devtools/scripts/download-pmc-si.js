#!/usr/bin/env bun
/**
 * Downloads the PMC supplementary info ZIP for a given PMC article
 * by solving the JS proof-of-work challenge in a real headless browser.
 *
 * Usage:
 *   bun run download-pmc-si.js --url <download-url> --output <path>
 */
import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const getArg = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};

const url = getArg('--url') || 'https://pmc.ncbi.nlm.nih.gov/articles/instance/12169459/bin/ml5c00105_si_001.zip';
const outputPath = getArg('--output') || '/tmp/pmc_si.zip';

console.error(`Downloading: ${url}`);
console.error(`Destination: ${outputPath}`);

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();

// Enable request interception so we can capture the actual binary response
await page.setRequestInterception(false);

// Set up a CDP session to handle downloads
const client = await page.createCDPSession();
await client.send('Page.setDownloadBehavior', {
  behavior: 'allow',
  downloadPath: path.dirname(outputPath),
});

// Navigate to the download URL – Puppeteer will let the JS POW solve, then redirect to the real file
const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

// If the page is an HTML challenge page, wait for the actual download redirect
// PMC POW pages self-redirect once the challenge is solved (~2-5s)
if (response && response.headers()['content-type']?.includes('text/html')) {
  console.error('POW challenge page detected – waiting for redirect...');
  // Wait for navigation away from the challenge page
  try {
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
  } catch (e) {
    // May timeout if the download triggers directly without a new page navigation
  }
}

// Try to intercept the binary via fetch inside the page context
const content = await page.evaluate(async (dlUrl) => {
  const res = await fetch(dlUrl);
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  // Convert to base64 so we can pass it through evaluate()
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}, url);

await browser.close();

if (!content) {
  console.error('Failed to download file content');
  process.exit(1);
}

const buffer = Buffer.from(content, 'base64');

// Sanity check: a real ZIP starts with PK
if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
  writeFileSync(outputPath, buffer);
  console.log(JSON.stringify({ success: true, output: outputPath, size: buffer.length }));
} else {
  // It's an HTML page, not a zip
  const preview = buffer.slice(0, 200).toString('utf8');
  console.error('Downloaded content is not a ZIP. Preview:', preview);
  // Save anyway for inspection
  writeFileSync(outputPath + '.html', buffer);
  process.exit(1);
}
