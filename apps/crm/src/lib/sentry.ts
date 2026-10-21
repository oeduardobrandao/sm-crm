import * as Sentry from '@sentry/react';

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

/**
 * Sentry stays on under legitimate interest (error reporting, tracing), so it must not carry
 * secrets in URLs. The invite token appears in two URL shapes:
 *  - the page route `/conectar/:token` (location, navigation breadcrumbs, transaction names);
 *  - the edge function calls `.../instagram-connect-link/public/:token[/start]` made by
 *    services/connectLink.ts (fetch breadcrumbs, http.client spans).
 * Both are matched on the path suffix, never the host: VITE_SUPABASE_URL differs per environment.
 * Replay is deliberately NOT installed; adding it later is a new consent decision (see the
 * cookie-consent spec).
 */
const INVITE_TOKEN_PATH = /\/conectar\/[^/?#]+/g;
const CONNECT_LINK_FN_PATH = /\/instagram-connect-link\/public\/[^/?#]+/g;

export function scrubInviteToken(value: string): string {
  return value
    .replace(INVITE_TOKEN_PATH, '/conectar/:token')
    .replace(CONNECT_LINK_FN_PATH, '/instagram-connect-link/public/:token');
}

type Data = Record<string, unknown>;

// Sentry runs `beforeSend` for error events only; transactions (browserTracingIntegration names
// them from location.pathname and attaches the URL as request.url / span data) go through
// `beforeSendTransaction`. Both hooks share this scrubber, and it walks every string in the
// free-form data bags rather than guessing key names.
interface Scrubbable {
  request?: { url?: string };
  transaction?: string;
  breadcrumbs?: Array<{ message?: string; data?: Data }>;
  spans?: Array<{ description?: string; data?: Data }>;
  contexts?: { trace?: { data?: Data } };
}

function scrubData(data: Data | undefined): void {
  if (!data) return;
  for (const key of Object.keys(data)) {
    const value = data[key];
    if (typeof value === 'string') data[key] = scrubInviteToken(value);
  }
}

export function scrubEvent<T extends Scrubbable>(event: T): T {
  if (event.request?.url) event.request.url = scrubInviteToken(event.request.url);
  if (event.transaction) event.transaction = scrubInviteToken(event.transaction);
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = scrubInviteToken(crumb.message);
    scrubData(crumb.data);
  }
  for (const span of event.spans ?? []) {
    if (span.description) span.description = scrubInviteToken(span.description);
    scrubData(span.data);
  }
  scrubData(event.contexts?.trace?.data);
  return event;
}

export function initSentry() {
  if (!DSN) return;

  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.2,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
  });
}
