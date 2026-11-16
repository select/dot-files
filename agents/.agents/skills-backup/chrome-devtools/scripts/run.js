#!/usr/bin/env bun
import fs from 'node:fs/promises';
import path from 'node:path';
import { runCommand } from './lib/session.js';
import { runFlow } from './lib/flow.js';

// Flow files contain trusted JavaScript expressions. Never execute a downloaded,
// unreviewed flow or expressions supplied by the page under test.
await runCommand(async (page, args) => {
  const file = path.resolve(args.flow);
  const flow = JSON.parse(await fs.readFile(file, 'utf8'));
  return runFlow(page, flow, { ...args, directory: path.dirname(file) });
}, { required: ['flow'], defaults: { fresh: 'true' } });
