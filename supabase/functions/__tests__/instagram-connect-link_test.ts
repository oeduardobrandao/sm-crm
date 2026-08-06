import { assertEquals } from "./assert.ts";
import {
  buildConnectUrl,
  connectLinkLive,
  connectLinkStatus,
  isValidEmail,
} from "../_shared/instagram-connect-link.ts";

const NOW = "2026-08-06T12:00:00.000Z";
const FUTURE = "2026-09-05T12:00:00.000Z";
const PAST = "2026-08-01T12:00:00.000Z";

Deno.test("connectLinkStatus: live when not revoked and not expired", () => {
  assertEquals(connectLinkStatus({ expires_at: FUTURE, revoked_at: null }, NOW), "live");
});

Deno.test("connectLinkStatus: revoked wins over expiry", () => {
  assertEquals(connectLinkStatus({ expires_at: FUTURE, revoked_at: PAST }, NOW), "revoked");
  assertEquals(connectLinkStatus({ expires_at: PAST, revoked_at: PAST }, NOW), "revoked");
});

Deno.test("connectLinkStatus: expired when past expires_at", () => {
  assertEquals(connectLinkStatus({ expires_at: PAST, revoked_at: null }, NOW), "expired");
});

Deno.test("connectLinkStatus: expiry boundary is exclusive", () => {
  // expires_at == now is already expired: the SQL gate uses `expires_at > now()`,
  // and the two must not disagree about the boundary.
  assertEquals(connectLinkStatus({ expires_at: NOW, revoked_at: null }, NOW), "expired");
});

Deno.test("connectLinkLive: true only for live", () => {
  assertEquals(connectLinkLive({ expires_at: FUTURE, revoked_at: null }, NOW), true);
  assertEquals(connectLinkLive({ expires_at: PAST, revoked_at: null }, NOW), false);
  assertEquals(connectLinkLive({ expires_at: FUTURE, revoked_at: PAST }, NOW), false);
});

Deno.test("buildConnectUrl: joins without double slash", () => {
  assertEquals(buildConnectUrl("https://app.mesaas.com.br", "abc"), "https://app.mesaas.com.br/conectar/abc");
  assertEquals(buildConnectUrl("https://app.mesaas.com.br/", "abc"), "https://app.mesaas.com.br/conectar/abc");
  assertEquals(buildConnectUrl("https://app.mesaas.com.br///", "abc"), "https://app.mesaas.com.br/conectar/abc");
});

Deno.test("isValidEmail: accepts ordinary addresses, rejects junk", () => {
  assertEquals(isValidEmail("cliente@exemplo.com.br"), true);
  assertEquals(isValidEmail("a+tag@b.co"), true);
  assertEquals(isValidEmail("sem-arroba.com"), false);
  assertEquals(isValidEmail("dois@@b.com"), false);
  assertEquals(isValidEmail("espaco @b.com"), false);
  assertEquals(isValidEmail(""), false);
  assertEquals(isValidEmail("a@b"), false);
});
