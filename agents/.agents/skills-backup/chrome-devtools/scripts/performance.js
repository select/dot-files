#!/usr/bin/env bun
/**
 * Measure performance metrics and record trace
 * Usage: node performance.js --url https://example.com [--trace trace.json] [--metrics]
 */
import { runCommand, navigate, waitForReady } from './lib/session.js';
import fs from 'node:fs/promises';
import path from 'node:path';

await runCommand(async (page, args) => {

    // Start tracing if requested
    if (args.trace) {
      await fs.mkdir(path.dirname(path.resolve(args.trace)), { recursive: true });
      await page.tracing.start({
        path: args.trace,
        categories: [
          'devtools.timeline',
          'disabled-by-default-devtools.timeline',
          'disabled-by-default-devtools.timeline.frame'
        ]
      });
    }

    // Navigate
    try {
      await navigate(page, args);
      await waitForReady(page, args);
    } finally {
      if (args.trace) await page.tracing.stop();
    }

    // Get performance metrics
    const metrics = await page.metrics();

    // Get Core Web Vitals
    const vitals = await page.evaluate(() => {
      return new Promise((resolve) => {
        const vitals = {
          LCP: null,
          FID: null,
          CLS: 0,
          FCP: null,
          TTFB: null
        };

        // LCP
        try {
          new PerformanceObserver((list) => {
            const entries = list.getEntries();
            if (entries.length > 0) {
              const lastEntry = entries[entries.length - 1];
              vitals.LCP = lastEntry.renderTime || lastEntry.loadTime;
            }
          }).observe({ entryTypes: ['largest-contentful-paint'], buffered: true });
        } catch (e) {}

        // CLS
        try {
          new PerformanceObserver((list) => {
            list.getEntries().forEach((entry) => {
              if (!entry.hadRecentInput) {
                vitals.CLS += entry.value;
              }
            });
          }).observe({ entryTypes: ['layout-shift'], buffered: true });
        } catch (e) {}

        // FCP
        try {
          const paintEntries = performance.getEntriesByType('paint');
          const fcpEntry = paintEntries.find(e => e.name === 'first-contentful-paint');
          if (fcpEntry) {
            vitals.FCP = fcpEntry.startTime;
          }
        } catch (e) {}

        // TTFB
        try {
          const [navigationEntry] = performance.getEntriesByType('navigation');
          if (navigationEntry) {
            vitals.TTFB = navigationEntry.responseStart - navigationEntry.requestStart;
          }
        } catch (e) {}

        // Wait a bit for metrics to stabilize
        setTimeout(() => resolve(vitals), 1000);
      });
    });

    // Get resource timing
    const resources = await page.evaluate(() => {
      return performance.getEntriesByType('resource').map(r => ({
        name: r.name,
        type: r.initiatorType,
        duration: r.duration,
        size: r.transferSize,
        startTime: r.startTime
      }));
    });

    const result = {
      success: true,
      url: page.url(),
      metrics: {
        ...metrics,
        JSHeapUsedSizeMB: (metrics.JSHeapUsedSize / 1024 / 1024).toFixed(2),
        JSHeapTotalSizeMB: (metrics.JSHeapTotalSize / 1024 / 1024).toFixed(2)
      },
      vitals: vitals,
      resources: {
        count: resources.length,
        totalDuration: resources.reduce((sum, r) => sum + r.duration, 0),
        items: args.resources === 'true' ? resources : undefined
      }
    };

    if (args.trace) {
      result.trace = args.trace;
    }

    return result;
}, { required: ['url'] });
