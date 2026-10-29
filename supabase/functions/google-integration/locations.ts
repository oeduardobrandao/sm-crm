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

async function listAccounts(token: string): Promise<string[]> {
  const names: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = pageToken ? `${ACCOUNTS_URL}?pageToken=${encodeURIComponent(pageToken)}` : ACCOUNTS_URL;
    const body = (await googleFetch(url, token)) as { accounts?: GoogleAccount[]; nextPageToken?: string } | null;
    for (const account of body?.accounts ?? []) {
      if (account?.name) names.push(account.name);
    }
    pageToken = body?.nextPageToken || undefined;
    if (!pageToken) break;
  }
  return names;
}

function addressLineOf(address: GoogleLocation["storefrontAddress"]): string | null {
  const parts = [address?.addressLines?.[0], address?.locality].filter((p): p is string => !!p && p.trim() !== "");
  return parts.length ? parts.join(", ") : null;
}

export async function listEligibleLocations(token: string): Promise<GbpLocationOption[]> {
  const accounts = await listAccounts(token);
  const byName = new Map<string, GbpLocationOption>();

  for (const accountName of accounts) {
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
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

  return [...byName.values()];
}
