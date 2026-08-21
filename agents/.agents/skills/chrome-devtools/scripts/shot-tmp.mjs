import { getBrowser, getPage, closeBrowser, outputJSON } from './lib/browser.js';
const [url, output, ...clicks] = process.argv.slice(2);
const browser = await getBrowser({ headless: true });
const page = await getPage(browser);
await page.setViewport({ width: 1600, height: 950 });
await page.goto(url, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 2500));
for (const selector of clicks) {
	await page.waitForSelector(selector, { timeout: 10000 });
	await page.click(selector);
	await new Promise((r) => setTimeout(r, 500));
}
await page.screenshot({ path: output });
await closeBrowser();
outputJSON({ success: true, output });
