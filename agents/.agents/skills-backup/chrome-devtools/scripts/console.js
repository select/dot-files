#!/usr/bin/env bun
/**
 * Monitor console messages
 * Usage: node console.js --url https://example.com [--types error,warn] [--duration 5000]
 */
import { runCommand, navigate, waitForReady } from './lib/session.js';

await runCommand(async (page, args) => {

    const messages = [];
    const filterTypes = args.types ? args.types.split(',') : null;

    // Listen for console messages
    page.on('console', (msg) => {
      const type = msg.type();

      if (!filterTypes || filterTypes.includes(type)) {
        messages.push({
          type: type,
          text: msg.text(),
          location: msg.location(),
          timestamp: Date.now()
        });
      }
    });

    // Listen for page errors
    page.on('pageerror', (error) => {
      messages.push({
        type: 'pageerror',
        text: error.message,
        stack: error.stack,
        timestamp: Date.now()
      });
    });

    // Navigate
    await navigate(page, args);
    await waitForReady(page, args);

    // Wait for additional time if specified
    if (args.duration) {
      await new Promise(resolve => setTimeout(resolve, parseInt(args.duration)));
    }

    return {
      url: page.url(),
      messageCount: messages.length,
      messages: messages
    };
}, { required: ['url'] });
