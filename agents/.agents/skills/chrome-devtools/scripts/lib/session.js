import {
  booleanArg, numberArg, getBrowser, getPage, closeBrowser, observePage,
  collectDiagnostics, outputJSON, parseArgs,
} from './browser.js';
import { parseSelector, waitForElement, getElement } from './selector.js';

export const timeoutFor = options => numberArg(options.timeout, 30000, 1);
export const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function navigate(page, options) {
  const timeout = timeoutFor(options);
  page.setDefaultTimeout(timeout);
  page.setDefaultNavigationTimeout(timeout);
  if (options.url) {
    observePage(page).requestedUrl = options.url;
    await page.goto(options.url, { waitUntil: options['wait-until'] || 'load', timeout });
  }
}

export async function waitForReady(page, options) {
  if (options['wait-for']) {
    await waitForElement(page, parseSelector(options['wait-for']), { visible: true, timeout: timeoutFor(options) });
  }
  // A settling delay supplements readiness rather than replacing it.
  if (options.delay !== undefined) await pause(numberArg(options.delay, 0));
}

export async function preparePage(page, options) {
  if (booleanArg(options['clear-storage'])) {
    await page.evaluateOnNewDocument(() => {
      try { localStorage.clear(); sessionStorage.clear(); } catch { /* opaque origins */ }
    });
    await page.evaluate(() => {
      try { localStorage.clear(); sessionStorage.clear(); } catch { /* opaque origins */ }
    });
  }
}

export async function elementFor(page, selector, options = {}) {
  const parsed = parseSelector(selector);
  await waitForElement(page, parsed, { visible: true, timeout: timeoutFor(options) });
  const element = await getElement(page, parsed);
  if (!element) throw new Error(`Element not found: ${selector}`);
  return element;
}

export async function click(page, options) {
  const element = await elementFor(page, options.selector, options);
  try {
    if (booleanArg(options['wait-navigation'])) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: options['wait-until'] || 'load', timeout: timeoutFor(options) }),
        element.click(),
      ]);
    } else await element.click();
    await waitForReady(page, options);
  } finally {
    await element.dispose();
  }
}

export async function fill(page, options) {
  if (typeof options.value !== 'string') throw new Error('--value must be a string (an empty string is allowed)');
  const element = await elementFor(page, options.selector, options);
  try {
    if (booleanArg(options.clear, true)) {
      await element.evaluate(element => {
        if (element.isContentEditable) element.textContent = '';
        else element.value = '';
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    await element.type(options.value, { delay: numberArg(options['type-delay'], 0) });
    await waitForReady(page, options);
  } finally {
    await element.dispose();
  }
}

/** Only execute trusted, user-authored code. Convert Vue proxies before crossing CDP. */
export function evaluate(page, script) {
  if (typeof script !== 'string') throw new Error('--script must be a JavaScript expression');
  return page.evaluate(async expression => {
    const value = await (0, eval)(expression);
    return value === undefined ? null : JSON.parse(JSON.stringify(value));
  }, script);
}

/** One lifecycle for all core CLIs: diagnostics before cleanup, cleanup before output. */
export async function runCommand(action, { required = [], defaults = {} } = {}) {
  let args;
  let page;
  let result;
  let failed = false;
  let keepOpen = false;
  try {
    args = { ...defaults, ...parseArgs(process.argv.slice(2)) };
    for (const key of required) {
      if (typeof args[key] !== 'string' || !args[key]) throw new Error(`--${key} is required`);
    }
    const timeout = timeoutFor(args);
    keepOpen = !booleanArg(args.close, true);
    const browser = await getBrowser({
      headless: booleanArg(args.headless, true),
      reuse: !booleanArg(args.fresh),
      persistent: keepOpen,
      browserUrl: args['browser-url'],
      wsEndpoint: args['ws-endpoint'],
      ...(args.executable ? { executablePath: args.executable } : {}),
      args: booleanArg(args['software-webgl']) ? ['--enable-unsafe-swiftshader'] : [],
    });
    page = await getPage(browser);
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout);
    await preparePage(page, args);
    result = { success: true, ...await action(page, args), pageErrors: observePage(page).pageErrors };
  } catch (error) {
    failed = true;
    result = { success: false, error: error.message, stack: error.stack, diagnostics: await collectDiagnostics(page) };
  } finally {
    try {
      await closeBrowser({ keepOpen: !failed && keepOpen });
    } catch (error) {
      failed = true;
      result = { ...result, success: false, cleanupError: error.message };
    }
  }
  if (failed) {
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } else outputJSON(result);
}
