import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export const ENDPOINT_FILE = process.env.CHROME_ENDPOINT_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.browser-endpoint');
let browserInstance;
let pageInstance;
let ownsBrowser = false;
const observations = new WeakMap();

export function booleanArg(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`Expected true or false, received ${JSON.stringify(value)}`);
}

export function numberArg(value, fallback, minimum = 0) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number < minimum || value === '') {
    throw new Error(`Expected a number >= ${minimum}, received ${JSON.stringify(value)}`);
  }
  return number;
}

export function buildLaunchOptions(options = {}) {
  const { args = [], viewport, reuse: _reuse, persistent: _persistent, browserUrl: _browserUrl, wsEndpoint: _wsEndpoint, ...rest } = options;
  return {
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH }
      : fs.existsSync('/usr/bin/google-chrome') ? { executablePath: '/usr/bin/google-chrome' } : {}),
    defaultViewport: viewport || { width: 1920, height: 1080 },
    ...rest,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', ...args],
  };
}

async function launchPersistent(options) {
  const worker = spawn(process.execPath, [fileURLToPath(new URL('./persistent-worker.js', import.meta.url)), JSON.stringify(buildLaunchOptions(options))], {
    detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CHROME_ENDPOINT_FILE: ENDPOINT_FILE },
  });
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { worker.kill('SIGTERM'); finish(new Error('Persistent browser startup timed out')); }, 30000);
    function finish(error, endpoint) {
      clearTimeout(timer);
      worker.removeAllListeners();
      worker.stdout.destroy();
      worker.stderr.destroy();
      worker.unref();
      if (error) reject(error); else resolve(endpoint);
    }
    worker.once('error', error => finish(error));
    worker.once('exit', code => finish(new Error(`Persistent browser exited (${code}): ${stderr}`)));
    worker.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    worker.stdout.on('data', chunk => {
      stdout += chunk;
      if (!stdout.includes('\n')) return;
      try { finish(undefined, JSON.parse(stdout.split('\n')[0]).endpoint); }
      catch (error) { worker.kill('SIGTERM'); finish(error); }
    });
  });
}

export async function getBrowser(options = {}) {
  if (browserInstance?.isConnected()) return browserInstance;
  let endpoint = options.wsEndpoint;
  if (!options.browserUrl && !endpoint && options.reuse !== false && fs.existsSync(ENDPOINT_FILE)) {
    endpoint = fs.readFileSync(ENDPOINT_FILE, 'utf8').trim();
    try {
      browserInstance = await puppeteer.connect({ browserWSEndpoint: endpoint });
      ownsBrowser = false;
      return browserInstance;
    } catch {
      fs.rmSync(ENDPOINT_FILE, { force: true });
      endpoint = undefined;
    }
  }
  if (options.browserUrl || endpoint) {
    browserInstance = await puppeteer.connect({ browserURL: options.browserUrl, browserWSEndpoint: endpoint });
    ownsBrowser = false;
  } else if (options.persistent) {
    const persistentEndpoint = await launchPersistent(options);
    browserInstance = await puppeteer.connect({ browserWSEndpoint: persistentEndpoint });
    ownsBrowser = true; // We own the detached session created for this command.
  } else {
    browserInstance = await puppeteer.launch(buildLaunchOptions(options));
    ownsBrowser = true;
  }
  return browserInstance;
}

export function observePage(page) {
  if (observations.has(page)) return observations.get(page);
  const state = { requestedUrl: undefined, pageErrors: [], consoleErrors: [], failedRequests: [] };
  const add = (list, value) => { list.push(value); if (list.length > 20) list.shift(); };
  page.on('pageerror', error => add(state.pageErrors, error.message.slice(0, 2000)));
  page.on('console', message => {
    if (message.type() === 'error') add(state.consoleErrors, message.text().slice(0, 2000));
  });
  page.on('request', request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame() && !request.redirectChain().length) {
      state.requestedUrl = request.url();
    }
  });
  page.on('requestfailed', request => add(state.failedRequests, {
    url: request.url(), error: request.failure()?.errorText,
  }));
  observations.set(page, state);
  return state;
}

export async function getPage(browser) {
  if (!pageInstance || pageInstance.isClosed()) {
    pageInstance = (await browser.pages())[0] || await browser.newPage();
  }
  observePage(pageInstance);
  return pageInstance;
}

export async function collectDiagnostics(page = pageInstance) {
  if (!page) return {};
  const state = observations.get(page) || {};
  let timer;
  try {
    const content = await Promise.race([
      page.evaluate(() => ({ title: document.title, bodyExcerpt: document.body?.innerText.slice(0, 4000) || '' })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ diagnosticError: 'Page inspection timed out' }), 1500); }),
    ]);
    return { ...state, finalUrl: page.url(), ...content };
  } catch (error) {
    return { ...state, finalUrl: page.url(), diagnosticError: error.message };
  } finally {
    clearTimeout(timer);
  }
}

/** Close browsers we launched; disconnect from externally owned sessions. */
export async function closeBrowser({ keepOpen = false } = {}) {
  const browser = browserInstance;
  if (!browser) return;
  browserInstance = undefined;
  pageInstance = undefined;
  try {
    if (keepOpen && ownsBrowser) {
      if (browser.process()) {
        await browser.close();
        throw new Error('Keeping an owned browser open requires getBrowser({ persistent: true })');
      }
      browser.disconnect();
    } else if (ownsBrowser) {
      if (fs.existsSync(ENDPOINT_FILE) && fs.readFileSync(ENDPOINT_FILE, 'utf8').trim() === browser.wsEndpoint()) {
        fs.rmSync(ENDPOINT_FILE, { force: true });
      }
      await browser.close();
    } else {
      browser.disconnect();
    }
  } finally {
    ownsBrowser = false;
  }
}

/** Supports --flag, --flag false, and --flag=false; values stay strings for CLI compatibility. */
export function parseArgs(argv) {
  const args = Object.create(null);
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
    const equals = argument.indexOf('=');
    if (equals !== -1) args[argument.slice(2, equals)] = argument.slice(equals + 1);
    else if (argv[index + 1] !== undefined && !argv[index + 1].startsWith('--')) args[argument.slice(2)] = argv[++index];
    else args[argument.slice(2)] = 'true';
  }
  return args;
}

export function outputJSON(data) {
  console.log(JSON.stringify(data, null, 2));
}
