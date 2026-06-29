import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyExistingUser } from "../invite-user/onboarding.ts";

Deno.test("classifyExistingUser: fully onboarded user is added to the workspace directly", () => {
  assertEquals(
    classifyExistingUser({ emailConfirmed: true, hasProfile: true, onboardingComplete: true }),
    "add-direct",
  );
});

Deno.test("classifyExistingUser: onboardingComplete wins even if profile lookup is anomalous", () => {
  // The flag is authoritative: never wipe a user we know completed onboarding.
  assertEquals(
    classifyExistingUser({ emailConfirmed: true, hasProfile: false, onboardingComplete: true }),
    "add-direct",
  );
});

Deno.test("classifyExistingUser: confirmed-but-passwordless user (with profile) is re-invited (the wrong-password trap)", () => {
  // Clicked the invite link (email confirmed) but never set a password.
  assertEquals(
    classifyExistingUser({ emailConfirmed: true, hasProfile: true, onboardingComplete: false }),
    "reinvite",
  );
});

Deno.test("classifyExistingUser: never-confirmed stale invitee is re-invited", () => {
  assertEquals(
    classifyExistingUser({ emailConfirmed: false, hasProfile: true, onboardingComplete: false }),
    "reinvite",
  );
});

Deno.test("classifyExistingUser: never-confirmed user without a profile is re-invited", () => {
  assertEquals(
    classifyExistingUser({ emailConfirmed: false, hasProfile: false, onboardingComplete: false }),
    "reinvite",
  );
});

Deno.test("classifyExistingUser: confirmed user with NO profile row is anomalous — never auto-deleted", () => {
  // Safety guard: a confirmed auth user with no profile is an impossible-by-design
  // state (the trigger always creates a profile). Refuse to wipe it rather than
  // risk deleting a real account.
  assertEquals(
    classifyExistingUser({ emailConfirmed: true, hasProfile: false, onboardingComplete: false }),
    "blocked-anomalous",
  );
});
