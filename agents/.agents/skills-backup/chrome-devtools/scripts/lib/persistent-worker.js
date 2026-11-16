// Internal detached owner for --close=false. Puppeteer kills its child Chrome on
// process exit, so simply disconnecting in a short-lived CLI cannot persist it.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const endpointFile = process.env.CHROME_ENDPOINT_FILE;
let browser;
let endpoint;
function removeEndpoint() {
  if (endpoint && fs.existsSync(endpointFile) && fs.readFileSync(endpointFile, 'utf8').trim() === endpoint) {
    fs.rmSync(endpointFile, { force: true });
  }
}
try {
  if (!endpointFile) throw new Error('CHROME_ENDPOINT_FILE is required');
  browser = await puppeteer.launch(JSON.parse(process.argv[2]));
  endpoint = browser.wsEndpoint();
  fs.mkdirSync(path.dirname(endpointFile), { recursive: true });
  fs.writeFileSync(endpointFile, endpoint, { mode: 0o600, flag: 'wx' });
  browser.on('disconnected', () => { removeEndpoint(); process.exit(0); });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, async () => { removeEndpoint(); await browser.close(); process.exit(0); });
  }
  console.log(JSON.stringify({ endpoint }));
} catch (error) {
  removeEndpoint();
  await browser?.close();
  console.error(error.message);
  process.exitCode = 1;
}
