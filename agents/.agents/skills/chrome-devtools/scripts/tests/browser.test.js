import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { booleanArg, numberArg, parseArgs, buildLaunchOptions } from '../lib/browser.js';
import { capture } from '../lib/capture.js';

const execute = promisify(execFile);
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let temporary;
let server;
let origin;
const sockets = new Set();

before(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-skill-test-'));
  server = http.createServer((request, response) => {
    if (request.url === '/redirect') { response.writeHead(302, { Location: '/home' }); response.end(); return; }
    if (request.url === '/never') return;
    if (request.url?.startsWith('/stream')) { response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write('data: connected\n\n'); return; }
    if (request.url === '/config.json') { response.setHeader('Content-Type', 'application/json'); response.end('{"enabled":false}'); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><title>Fixture</title><style>body{height:1800px} canvas{display:block;width:200px;height:200px;margin-top:600px} header{position:fixed;top:0}</style>
      <header>Fixed header</header><h1>Fixture home</h1><input id="input" value="old"><button id="button" onclick="document.querySelector('h1').textContent='Clicked'">Click</button>
      <canvas id="matrix" width="100" height="100"></canvas><div id="selection"></div>
      <script>
      window.proxy = new Proxy({ diagonal: new Proxy({ start: 10, end: 20 }, {}) }, {});
      fetch('/config.json').then(r=>r.json()).then(data=>window.config=data);
      for(let index=0;index<3;index++) fetch('/stream?'+index);
      document.querySelector('#matrix').getContext('2d').fillRect(0,0,50,50);
      document.querySelector('#matrix').onmousedown=()=>window.dragging=true;
      document.onmouseup=()=>{if(window.dragging){document.querySelector('#selection').textContent='Selected';window.dragging=false;}};
      setTimeout(()=>{const ready=document.createElement('div');ready.dataset.test='ready';ready.textContent='Ready';document.body.append(ready);},120);
      ${request.url === '/errors' ? "setTimeout(()=>{throw new Error('fixture error')},10);console.error('fixture console error');" : ''}
      </script>`);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
  await fs.rm(temporary, { recursive: true, force: true });
});

async function cli(script, args = [], options = {}) {
  const env = { ...process.env, CHROME_ENDPOINT_FILE: path.join(temporary, 'endpoint'), ...options.env };
  try {
    const { stdout, stderr } = await execute(process.execPath, [path.join(directory, script), ...args], { cwd: temporary, env, timeout: 20000 });
    return { code: 0, data: JSON.parse(stdout), stderr };
  } catch (error) {
    if (error.killed || error.signal) throw error;
    return { code: error.code, data: JSON.parse(error.stderr) };
  }
}

async function flowFile(flow, name = 'flow.json') {
  const file = path.join(temporary, name);
  await fs.writeFile(file, JSON.stringify(flow));
  return file;
}

// Pure helper regressions do not launch Chrome.
test('normalizes bare, separated, and equals-form flags without losing false or empty values', () => {
  const args = parseArgs(['--no-compress', '--close=false', '--headless', 'false', '--value=']);
  assert.equal(booleanArg(args['no-compress']), true);
  assert.equal(booleanArg(args.close, true), false);
  assert.equal(booleanArg(args.headless, true), false);
  assert.equal(args.value, '');
  assert.equal(booleanArg('false'), false);
  assert.equal(numberArg('0', 10), 0);
  assert.throws(() => booleanArg('no'));
  assert.throws(() => numberArg('NaN', 10));
  assert.throws(() => parseArgs(['unexpected']));
});

test('custom Chrome arguments preserve default flags and viewport options', () => {
  const options = buildLaunchOptions({ args: ['--enable-unsafe-swiftshader'], viewport: { width: 400, height: 800 }, headless: false, reuse: false });
  assert.deepEqual(options.args, ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader']);
  assert.deepEqual(options.defaultViewport, { width: 400, height: 800 });
  assert.equal(options.headless, false);
  assert.equal('reuse' in options, false);
});

test('evaluate waits for SPA readiness without waiting for persistent network connections', async () => {
  const result = await cli('evaluate.js', ['--fresh', '--url', origin, '--wait-for', '[data-test="ready"]', '--timeout=3000', '--script', 'window.proxy']);
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.deepEqual(result.data.result, { diagonal: { start: 10, end: 20 } });
});

test('screenshots create nested directories, accept bare no-compress, and combine readiness with delay', async () => {
  const output = path.join(temporary, 'nested', 'desktop.png');
  const started = Date.now();
  const result = await cli('screenshot.js', ['--fresh', '--url', origin, '--wait-for', '[data-test="ready"]', '--delay=400', '--timeout=3000', '--no-compress', '--full-page', '--scroll-top', '--output', output]);
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal(result.data.compressed, false);
  assert.ok(Date.now() - started >= 520);
  const png = await fs.readFile(output);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.ok(png.readUInt32BE(20) >= 1800);
  const mobile = await cli('mobile-screenshot.js', ['--fresh', '--url', origin, '--wait-for', '[data-test="ready"]', '--full-page=false', '--no-compress=true', '--width=390', '--height=844', '--output', path.join(temporary, 'mobile', 'shot.png')]);
  assert.equal(mobile.code, 0, JSON.stringify(mobile));
  assert.deepEqual(mobile.data.viewport, { width: 390, height: 844 });
});

test('capture waits for the selector AND the settling delay, with explicit false compression flag', async () => {
  let readyAt;
  let capturedAt;
  const output = path.join(temporary, 'mock-capture', 'shot.png');
  const page = {
    waitForSelector: async selector => { assert.equal(selector, '#ready'); readyAt = Date.now(); },
    screenshot: async options => { capturedAt = Date.now(); await fs.writeFile(options.path, 'fake-image'); return Buffer.from('fake-image'); },
    url: () => origin,
  };
  const result = await capture(page, { output, 'wait-for': '#ready', delay: 100, 'no-compress': 'false' });
  assert.ok(capturedAt - readyAt >= 90);
  assert.equal(result.originalSize, 10); // Compression path ran; the tiny file needs no compression.
});

test('monitoring and snapshot commands share readiness, timeouts, and output-directory creation', async () => {
  for (const script of ['console.js', 'network.js', 'snapshot.js', 'performance.js']) {
    const args = ['--fresh', '--url', origin, '--wait-for', '[data-test="ready"]', '--timeout=3000'];
    if (script === 'network.js' || script === 'snapshot.js') args.push('--output', path.join(temporary, 'reports', script + '.json'));
    const result = await cli(script, args);
    assert.equal(result.code, 0, `${script}: ${JSON.stringify(result)}`);
  }
});

test('reports redirected URL, body, and page errors when a readiness selector times out', async () => {
  const redirect = await cli('screenshot.js', ['--fresh', '--url', `${origin}/redirect`, '--wait-for', '#missing', '--timeout=400', '--output', path.join(temporary, 'missing.png')]);
  assert.equal(redirect.code, 1);
  assert.equal(redirect.data.diagnostics.requestedUrl, `${origin}/redirect`);
  assert.equal(redirect.data.diagnostics.finalUrl, `${origin}/home`);
  assert.equal(redirect.data.diagnostics.title, 'Fixture');
  assert.match(redirect.data.diagnostics.bodyExcerpt, /Fixture home/);
  const errors = await cli('evaluate.js', ['--fresh', '--url', `${origin}/errors`, '--wait-for', '#missing', '--timeout=400', '--script', 'true']);
  assert.equal(errors.code, 1);
  assert.match(errors.data.diagnostics.pageErrors.join(), /fixture error/);
  assert.match(errors.data.diagnostics.consoleErrors.join(), /fixture console error/);
});

test('applies the requested timeout to navigation as well as selectors', async () => {
  const started = Date.now();
  const result = await cli('navigate.js', ['--fresh', '--url', `${origin}/never`, '--timeout=300']);
  assert.equal(result.code, 1);
  assert.match(result.data.error, /300 ms/);
  assert.ok(Date.now() - started < 10000);
});

test('single-session flow overrides only the specified request, fills, clicks, drags, asserts, and captures', async () => {
  const flow = await flowFile({
    overrides: [{ url: `${origin}/config.json`, body: '{"enabled":true}' }],
    steps: [
      { action: 'navigate', url: origin, 'wait-for': '[data-test="ready"]' },
      { action: 'assert', expression: 'window.config?.enabled === true' },
      { action: 'fill', selector: '#input', value: 'new value' },
      { action: 'assert', expression: 'document.querySelector("#input").value === "new value"' },
      { action: 'fill', selector: '#input', value: '' },
      { action: 'assert', expression: 'document.querySelector("#input").value === ""' },
      { action: 'click', selector: '//button[@id="button"]' },
      { action: 'assert', expression: 'document.querySelector("h1").textContent === "Clicked"' },
      { action: 'drag', selector: '#matrix', from: [0.2, 0.1], to: [0.4, 0.7] },
      { action: 'assert', expression: 'document.querySelector("#selection").textContent === "Selected"' },
      { action: 'screenshot', output: 'flow-images/selected.png', 'scroll-top': true, 'full-page': true, 'no-compress': true },
      { action: 'assert', expression: 'window.scrollY === 0' },
      { action: 'evaluate', script: '({config:window.config, selection:window.proxy})' },
    ],
  });
  const result = await cli('run.js', ['--flow', flow, '--allow-overrides', '--timeout=3000']);
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal(result.data.overrides[0].hits, 1);
  assert.equal(result.data.steps.length, 13);
  assert.deepEqual(result.data.steps.at(-1).result.selection, { diagonal: { start: 10, end: 20 } });
  assert.ok((await fs.stat(path.join(temporary, 'flow-images/selected.png'))).size > 1000);
});

test('flow rejects unapproved overrides and identifies a failing step', async () => {
  const blocked = await flowFile({ overrides: [{ url: `${origin}/config.json`, body: '{}' }], steps: [{ action: 'navigate', url: origin }] });
  const denied = await cli('run.js', ['--flow', blocked]);
  assert.equal(denied.code, 1);
  assert.match(denied.data.error, /allow-overrides/);
  const failed = await flowFile({ steps: [{ action: 'navigate', url: origin }, { action: 'assert', name: 'Expected chain', expression: 'false', timeout: 200 }] });
  const result = await cli('run.js', ['--flow', failed]);
  assert.equal(result.code, 1);
  assert.match(result.data.error, /Step 2 \(Expected chain\)/);
  assert.equal(result.data.diagnostics.finalUrl, `${origin}/`);
});

test('flow fails on JavaScript page errors and on invalid drag coordinates', async () => {
  const errors = await flowFile({ steps: [{ action: 'navigate', url: `${origin}/errors`, 'wait-for': '[data-test="ready"]' }] });
  const result = await cli('run.js', ['--flow', errors]);
  assert.equal(result.code, 1);
  assert.match(result.data.error, /Page errors: fixture error/);
  const invalid = await flowFile({ steps: [{ action: 'drag', selector: '#matrix', from: [-1, 0], to: [1, 1] }] });
  const badDrag = await cli('run.js', ['--flow', invalid]);
  assert.equal(badDrag.code, 1);
  assert.match(badDrag.data.error, /fractions between 0 and 1/);
});

test('close=false persists a session, later commands disconnect safely, and failure cleans up owned Chrome', async () => {
  const endpoint = path.join(temporary, 'persistent-endpoint');
  let connection;
  try {
    const started = await cli('navigate.js', ['--url', origin, '--close=false', '--fresh'], { env: { CHROME_ENDPOINT_FILE: endpoint } });
    assert.equal(started.code, 0, JSON.stringify(started));
    connection = await puppeteer.connect({ browserWSEndpoint: await fs.readFile(endpoint, 'utf8') });
    const queried = await cli('evaluate.js', ['--script', 'document.title'], { env: { CHROME_ENDPOINT_FILE: endpoint } });
    assert.equal(queried.code, 0, JSON.stringify(queried));
    assert.equal(queried.data.result, 'Fixture');
    assert.equal(connection.isConnected(), true);
    const failure = await cli('evaluate.js', ['--script', '(() => { throw new Error("owned test") })()'], { env: { CHROME_ENDPOINT_FILE: endpoint } });
    assert.equal(failure.code, 1);
    assert.equal(connection.isConnected(), true);
  } finally {
    await connection?.close();
    await fs.rm(endpoint, { force: true });
  }
  const ownedEndpoint = path.join(temporary, 'must-not-persist');
  const failed = await cli('run.js', ['--flow', await flowFile({ steps: [{ action: 'assert', expression: 'false', timeout: 100 }] }), '--close=false'], { env: { CHROME_ENDPOINT_FILE: ownedEndpoint } });
  assert.equal(failed.code, 1);
  await assert.rejects(fs.stat(ownedEndpoint), { code: 'ENOENT' });
});
