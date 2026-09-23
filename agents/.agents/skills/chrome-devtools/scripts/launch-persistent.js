#!/usr/bin/env bun
import { ENDPOINT_FILE, booleanArg } from './lib/browser.js';
import { runCommand, navigate, waitForReady } from './lib/session.js';

await runCommand(async (page, args) => {
  await navigate(page, args);
  await waitForReady(page, args);
  return { url: page.url(), persistent: !booleanArg(args.close, true), endpointFile: ENDPOINT_FILE };
}, { defaults: { close: 'false', fresh: 'true' } });
