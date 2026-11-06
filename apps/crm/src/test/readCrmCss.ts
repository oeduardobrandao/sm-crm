import { readFileSync } from 'node:fs';
import path from 'node:path';

const CRM = path.resolve(__dirname, '../..');

/**
 * Test helper: the CRM's hand-written stylesheet as one string, for tests that assert on rules
 * wherever they live. style.css (core, render-blocking on every page) comes first, then app.css
 * (authenticated shell only), which is the order both load in on authenticated pages and in the
 * Hub. See the header comments of both files for which side a rule belongs on.
 */
export function readCrmCss(): string {
  return [
    readFileSync(path.join(CRM, 'style.css'), 'utf8'),
    readFileSync(path.join(CRM, 'app.css'), 'utf8'),
  ].join('\n');
}
