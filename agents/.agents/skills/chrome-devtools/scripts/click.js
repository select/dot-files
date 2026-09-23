#!/usr/bin/env bun
import { runCommand, navigate, click } from './lib/session.js';

await runCommand(async (page, args) => {
  await navigate(page, args);
  await click(page, args);
  return { url: page.url(), title: await page.title() };
}, { required: ['selector'] });
