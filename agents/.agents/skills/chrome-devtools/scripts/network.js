#!/usr/bin/env bun
/**
 * Monitor network requests
 * Usage: node network.js --url https://example.com [--types xhr,fetch] [--output requests.json]
 */
import { runCommand, navigate, waitForReady } from './lib/session.js';
import fs from 'node:fs/promises';
import path from 'node:path';

await runCommand(async (page, args) => {

    const requests = [];
    const filterTypes = args.types ? args.types.split(',').map(t => t.toLowerCase()) : null;

    // Monitor requests
    page.on('request', (request) => {
      const resourceType = request.resourceType().toLowerCase();

      if (!filterTypes || filterTypes.includes(resourceType)) {
        requests.push({
          id: request._requestId || requests.length,
          url: request.url(),
          method: request.method(),
          resourceType: resourceType,
          headers: request.headers(),
          postData: request.postData(),
          timestamp: Date.now()
        });
      }
    });

    // Monitor responses
    const responses = new Map();
    page.on('response', async (response) => {
      const request = response.request();
      const resourceType = request.resourceType().toLowerCase();

      if (!filterTypes || filterTypes.includes(resourceType)) {
        try {
          responses.set(request._requestId || request.url(), {
            status: response.status(),
            statusText: response.statusText(),
            headers: response.headers(),
            fromCache: response.fromCache(),
            timing: response.timing()
          });
        } catch (e) {
          // Ignore errors for some response types
        }
      }
    });

    // Navigate
    await navigate(page, args);
    await waitForReady(page, args);

    // Merge requests with responses
    const combined = requests.map(req => ({
      ...req,
      response: responses.get(req.id) || responses.get(req.url) || null
    }));

    const result = {
      success: true,
      url: page.url(),
      requestCount: combined.length,
      requests: combined
    };

    if (args.output) {
      await fs.mkdir(path.dirname(path.resolve(args.output)), { recursive: true });
      await fs.writeFile(args.output, JSON.stringify(result, null, 2));
      return {
        success: true,
        output: args.output,
        requestCount: combined.length
      };
    }
    return result;
}, { required: ['url'] });
