import puppeteer from './node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

const OUT = '/home/linux-falko/Dev/hub/ui/docs/screenshots/EN-5299';
const URL = 'http://localhost:8081/predict?demo&agree-tou';

// Queries from the issue that demonstrated broken behaviour
const QUERIES = ['pr', 'pro', 'prot', 'prote', 'proten', 'proteni', 'protenix', 'openfold', 'openfold3'];

const browser = await puppeteer.launch({
	headless: true,
	executablePath: '/home/linux-falko/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome',
	args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 820 });

// Clear localStorage so demo mode is picked up cleanly
await page.evaluateOnNewDocument(() => localStorage.clear());
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForSelector("[data-test='version-weights-selector-button']", { timeout: 10000 });

// Open the dropdown once so we have the input visible
await page.click("[data-test='version-weights-selector-button']");
await page.waitForSelector("[data-test='version-weights-input']", { timeout: 5000 });

for (const query of QUERIES) {
	// Clear the input and type the new query
	await page.click("[data-test='version-weights-input']", { clickCount: 3 });
	await page.keyboard.down('Control');
	await page.keyboard.press('a');
	await page.keyboard.up('Control');
	await page.keyboard.press('Backspace');
	await page.type("[data-test='version-weights-input']", query, { delay: 40 });

	// Wait for Fuse to filter
	await new Promise(r => setTimeout(r, 400));

	// Capture widget + dropdown area
	const btn = await page.$("[data-test='version-weights-selector-button']");
	const box = await btn.boundingBox();

	const clip = {
		x: Math.max(0, box.x - 10),
		y: Math.max(0, box.y - 60),
		width: box.width + 20,
		height: 480,
	};

	const slug = query.replace(/[^a-z0-9]/gi, '-');
	const file = `${OUT}/search-${slug}.png`;
	await page.screenshot({ path: file, clip });
	console.log(`✓ "${query}" → ${file}`);
}

await browser.close();
console.log('All done.');
