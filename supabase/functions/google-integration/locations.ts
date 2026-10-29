// Google Meu Negócio location listing for the picker (spec §4.4): Account Management
// `accounts.list`, then each account's Business Information `locations.list`, walked in
// sequence (GMN quotas are per minute and low), de-duplicated by location name keeping the
// first account that lists it. Every call goes through googleFetch (timeouts + error mapping).

import { googleFetch } from "../_shared/google.ts";

export interface GbpLocationOption {
  locationName: string;
  accountName: string;
  title: string;
  addressLine: string | null;
  website: string | null;
  hasVoiceOfMerchant: boolean;
}

const ACCOUNTS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
const BUSINESS_INFO_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";
const READ_MASK = "name,title,storefrontAddress,websiteUri,metadata";
/** Guard against a pagination loop from a misbehaving upstream. */
const MAX_PAGES = 50;
/** Bounds on one listing: an agency account with hundreds of GBP accounts must not hold the
 * request (and the GMN per-minute quota) hostage. Past either bound the result is truncated. */
export const MAX_ACCOUNTS_PER_LISTING = 25;
export const LISTING_BUDGET_MS = 20_000;

export interface ListLocationsOptions {
  maxAccounts?: number;
  budgetMs?: number;
  /** Clock override for tests. */
  now?: () => number;
}

interface GoogleAccount {
  name?: string;
}

interface GoogleLocation {
  name?: string;
  title?: string;
  storefrontAddress?: { addressLines?: string[]; locality?: string };
  websiteUri?: string;
  metadata?: { hasVoiceOfMerchant?: boolean };
}

async function listAccounts(
  token: string,
  maxAccounts: number,
  overBudget: () => boolean,
): Promise<{ names: string[]; truncated: boolean }> {
  const names: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0 && overBudget()) return { names, truncated: true };
    const url = pageToken ? `${ACCOUNTS_URL}?pageToken=${encodeURIComponent(pageToken)}` : ACCOUNTS_URL;
    const body = (await googleFetch(url, token)) as { accounts?: GoogleAccount[]; nextPageToken?: string } | null;
    for (const account of body?.accounts ?? []) {
      if (account?.name) names.push(account.name);
    }
    pageToken = body?.nextPageToken || undefined;
    if (names.length > maxAccounts) return { names: names.slice(0, maxAccounts), truncated: true };
    if (!pageToken) break;
    if (names.length === maxAccounts) return { names, truncated: true };
  }
  return { names, truncated: false };
}

function addressLineOf(address: GoogleLocation["storefrontAddress"]): string | null {
  const parts = [address?.addressLines?.[0], address?.locality].filter((p): p is string => !!p && p.trim() !== "");
  return parts.length ? parts.join(", ") : null;
}

/** Same as listGbpLocations, options only (the brief's interface). */
export async function listEligibleLocations(token: string): Promise<GbpLocationOption[]> {
  return (await listGbpLocations(token)).options;
}

/**
 * Walks at most `maxAccounts` accounts (default 25) within `budgetMs` (default 20 s); when a
 * bound stops the walk, returns what was gathered with `truncated: true`.
 */
export async function listGbpLocations(
  token: string,
  opts: ListLocationsOptions = {},
): Promise<{ options: GbpLocationOption[]; truncated: boolean }> {
  const now = opts.now ?? Date.now;
  const started = now();
  const budgetMs = opts.budgetMs ?? LISTING_BUDGET_MS;
  const overBudget = () => now() - started >= budgetMs;

  const listed = await listAccounts(token, opts.maxAccounts ?? MAX_ACCOUNTS_PER_LISTING, overBudget);
  let truncated = listed.truncated;
  const byName = new Map<string, GbpLocationOption>();

  walk: for (const accountName of listed.names) {
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      if (overBudget()) {
        truncated = true;
        break walk;
      }
      const url = new URL(`${BUSINESS_INFO_BASE}/${accountName}/locations`);
      url.searchParams.set("readMask", READ_MASK);
      url.searchParams.set("pageSize", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const body = (await googleFetch(url.toString(), token)) as
        | { locations?: GoogleLocation[]; nextPageToken?: string }
        | null;
      for (const location of body?.locations ?? []) {
        if (!location?.name || byName.has(location.name)) continue;
        byName.set(location.name, {
          locationName: location.name,
          accountName,
          title: location.title || location.name,
          addressLine: addressLineOf(location.storefrontAddress),
          website: location.websiteUri || null,
          hasVoiceOfMerchant: location.metadata?.hasVoiceOfMerchant === true,
        });
      }
      pageToken = body?.nextPageToken || undefined;
      if (!pageToken) break;
    }
  }

  return { options: [...byName.values()], truncated };
}
