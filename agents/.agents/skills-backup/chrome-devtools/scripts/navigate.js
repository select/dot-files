#!/usr/bin/env bun
import { runCommand, navigate, waitForReady } from './lib/session.js';

await runCommand(async (page, args) => {
  await navigate(page, args);
  await waitForReady(page, args);
  return { url: page.url(), title: await page.title() };
}, { required: ['url'] });
