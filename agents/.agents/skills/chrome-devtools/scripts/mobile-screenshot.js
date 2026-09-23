#!/usr/bin/env bun
import { runCommand, navigate } from './lib/session.js';
import { numberArg } from './lib/browser.js';
import { capture } from './lib/capture.js';

await runCommand(async (page, args) => {
  const width = numberArg(args.width, 390, 1);
  const height = numberArg(args.height, 844, 1);
  await page.setViewport({ width, height, isMobile: true, hasTouch: true });
  await navigate(page, args);
  await page.addStyleTag({ content: '#nuxt-devtools-container { display: none !important; }' });
  return { ...await capture(page, args), viewport: { width, height } };
}, { required: ['url', 'output'], defaults: { 'full-page': 'true', 'wait-until': 'domcontentloaded' } });
