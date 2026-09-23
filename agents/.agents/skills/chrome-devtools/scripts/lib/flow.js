import fs from 'node:fs/promises';
import path from 'node:path';
import { booleanArg, numberArg, observePage } from './browser.js';
import { navigate, waitForReady, click, fill, elementFor, evaluate, timeoutFor } from './session.js';
import { capture } from './capture.js';

function point(value) {
  if (!Array.isArray(value) || value.length !== 2 || value.some(number => !Number.isFinite(number) || number < 0 || number > 1)) {
    throw new Error('Drag points must be [x, y] fractions between 0 and 1');
  }
  return value;
}

export async function drag(page, options) {
  const from = point(options.from);
  const to = point(options.to);
  const steps = numberArg(options.steps, 20, 1);
  if (!Number.isInteger(steps)) throw new Error('Drag steps must be an integer');
  const source = await elementFor(page, options.selector, options);
  let target;
  try {
    target = options.toSelector ? await elementFor(page, options.toSelector, options) : source;
    await source.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    // Measure after scroll/layout, not before. Both endpoints must be in the viewport.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    if (!sourceBox || !targetBox) throw new Error('Drag target is not visible');
    const start = { x: sourceBox.x + sourceBox.width * from[0], y: sourceBox.y + sourceBox.height * from[1] };
    const end = { x: targetBox.x + targetBox.width * to[0], y: targetBox.y + targetBox.height * to[1] };
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    for (const position of [start, end]) {
      if (position.x < 0 || position.y < 0 || position.x >= viewport.width || position.y >= viewport.height) {
        throw new Error('Drag endpoint is outside the viewport; adjust viewport or selectors');
      }
    }
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    try { await page.mouse.move(end.x, end.y, { steps }); }
    finally { await page.mouse.up(); }
    await waitForReady(page, options);
    return { from: start, to: end };
  } finally {
    if (target && target !== source) await target.dispose();
    await source.dispose();
  }
}

async function installOverrides(page, overrides, directory) {
  if (!Array.isArray(overrides)) throw new Error('overrides must be an array');
  const rules = await Promise.all(overrides.map(async rule => {
    if (!rule || typeof rule.url !== 'string' || !/^https?:\/\//.test(rule.url)) throw new Error('Overrides require an exact absolute HTTP(S) URL');
    const url = new URL(rule.url);
    if (url.hash || url.username || url.password) throw new Error('Override URLs must not include fragments or credentials');
    const status = numberArg(rule.status, 200, 100);
    if (!Number.isInteger(status) || status > 599) throw new Error('Invalid override status');
    const body = rule.bodyFile ? await fs.readFile(path.resolve(directory, rule.bodyFile)) : rule.body ?? '';
    if (typeof body !== 'string' && !Buffer.isBuffer(body)) throw new Error('Override body must be a string; JSON must be serialized');
    return { url: url.href, method: (rule.method || 'GET').toUpperCase(), hits: 0,
      response: { status, body, contentType: rule.contentType || 'application/json', headers: rule.headers } };
  }));
  const errors = [];
  if (!rules.length) return { rules, errors, dispose: async () => {} };
  await page.setRequestInterception(true);
  const listener = request => {
    const rule = rules.find(rule => rule.url === request.url() && rule.method === request.method());
    if (rule) rule.hits++;
    const operation = rule ? request.respond(rule.response) : request.continue();
    operation.catch(error => errors.push(error.message));
  };
  page.on('request', listener);
  return { rules, errors, dispose: async () => { page.off('request', listener); await page.setRequestInterception(false); } };
}

export async function runFlow(page, flow, options = {}) {
  if (!Array.isArray(flow.steps) || !flow.steps.length) throw new Error('Flow requires a non-empty steps array');
  if (flow.overrides?.length && !booleanArg(options['allow-overrides'])) throw new Error('Test-only overrides require --allow-overrides');
  const directory = options.directory || process.cwd();
  const outputDirectory = options['output-dir'] ? path.resolve(options['output-dir']) : directory;
  observePage(page);
  const interception = await installOverrides(page, flow.overrides || [], directory);
  const results = [];
  try {
    for (const [index, step] of flow.steps.entries()) {
      const settings = { timeout: options.timeout, 'wait-until': options['wait-until'], ...step };
      try {
        let result;
        switch (step.action) {
          case 'navigate':
            if (typeof step.url !== 'string' || !step.url) throw new Error('navigate requires url');
            await navigate(page, settings);
            await waitForReady(page, settings);
            result = { url: page.url() };
            break;
          case 'click': await click(page, settings); break;
          case 'fill': await fill(page, settings); break;
          case 'drag': result = await drag(page, settings); break;
          case 'wait': await waitForReady(page, settings); break;
          case 'assert': {
            if (typeof step.expression !== 'string') throw new Error('assert requires expression');
            const handle = await page.waitForFunction(async expression => (await (0, eval)(expression)) === true, { timeout: timeoutFor(settings) }, step.expression);
            await handle.dispose();
            break;
          }
          case 'evaluate': result = await evaluate(page, step.script); break;
          case 'screenshot':
            if (typeof step.output !== 'string' || !step.output) throw new Error('screenshot requires output');
            result = await capture(page, { ...settings, output: path.resolve(outputDirectory, step.output) });
            break;
          default: throw new Error(`Unknown flow action: ${step.action}`);
        }
        if (interception.errors.length) throw new Error(`Request interception failed: ${interception.errors.join('; ')}`);
        results.push({ index, action: step.action, name: step.name, result });
      } catch (error) {
        throw new Error(`Step ${index + 1} (${step.name || step.action}): ${error.message}`, { cause: error });
      }
    }
    if (booleanArg(options['fail-on-page-error'], true) && observePage(page).pageErrors.length) {
      throw new Error(`Page errors: ${observePage(page).pageErrors.join('; ')}`);
    }
    return { url: page.url(), steps: results, overrides: interception.rules.map(({ url, method, hits }) => ({ url, method, hits })) };
  } finally {
    await interception.dispose();
  }
}
