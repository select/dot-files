#!/usr/bin/env bun
import { runCommand, navigate, fill } from './lib/session.js';

await runCommand(async (page, args) => {
  await navigate(page, args);
  await fill(page, args);
  return { selector: args.selector, value: args.value, url: page.url() };
}, { required: ['selector'] });
