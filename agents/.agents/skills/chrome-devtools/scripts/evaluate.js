#!/usr/bin/env bun
import { runCommand, navigate, waitForReady, evaluate } from './lib/session.js';

await runCommand(async (page, args) => {
  await navigate(page, args);
  await waitForReady(page, args);
  return { result: await evaluate(page, args.script), url: page.url() };
}, { required: ['script'] });
