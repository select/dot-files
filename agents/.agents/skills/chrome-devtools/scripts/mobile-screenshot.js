import { getBrowser, getPage, closeBrowser, outputJSON } from './lib/browser.js';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
	options: {
		url: { type: 'string' },
		output: { type: 'string' },
		'wait-for': { type: 'string' },
		'clear-storage': { type: 'boolean', default: false },
		'full-page': { type: 'boolean', default: true },
		width: { type: 'string', default: '390' },
		height: { type: 'string', default: '844' },
		timeout: { type: 'string', default: '10000' },
	},
});

if (!values.url || !values.output) {
	console.error('Usage: bun run mobile-screenshot.js --url <url> --output <path> [--wait-for <selector>] [--clear-storage] [--full-page] [--width 390] [--height 844]');
	process.exit(1);
}

const width = parseInt(values.width, 10);
const height = parseInt(values.height, 10);
const timeout = parseInt(values.timeout, 10);

const browser = await getBrowser({
	viewport: { width, height, isMobile: true, hasTouch: true },
});
const page = await getPage(browser);

if (values['clear-storage']) {
	const client = await page.createCDPSession();
	const origin = new URL(values.url).origin;
	await client.send('Storage.clearDataForOrigin', {
		origin,
		storageTypes: 'all',
	});
}

await page.goto(values.url, { waitUntil: 'domcontentloaded' });

if (values['wait-for']) {
	await page.waitForSelector(values['wait-for'], { timeout });
} else {
	await new Promise((r) => setTimeout(r, 6000));
}

// Hide Nuxt DevTools widget
await page.addStyleTag({ content: '#nuxt-devtools-container { display: none !important; }' });

await page.screenshot({
	path: values.output,
	fullPage: values['full-page'],
});

await closeBrowser();

outputJSON({
	success: true,
	output: values.output,
	viewport: { width, height },
	url: values.url,
});
