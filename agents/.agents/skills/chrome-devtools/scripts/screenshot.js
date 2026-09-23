#!/usr/bin/env bun
import { runCommand, navigate } from './lib/session.js';
import { capture } from './lib/capture.js';

await runCommand(async (page, args) => {
  await navigate(page, args);
  return capture(page, args);
}, { required: ['output'] });
