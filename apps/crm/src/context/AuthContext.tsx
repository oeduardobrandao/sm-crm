import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from '@supabase/supabase-js';
import {
  supabase,
  getCurrentProfile,
  clearProfileCache,
  signOut as supabaseSignOut,
  healPendingInvite,
} from '../lib/supabase';
import { getMyMembership, type MyMembership } from '../store/workspace';
import { deriveFinancialAccess, type FinancialAccess } from '../lib/financialAccess';
import {
  computePermissionTransitions,
  derivePermission,
  type PermissionAction,
  type PermissionCheck,
  type PermissionModule,
} from '../lib/permissions';
import { identifyWorkspaceUser, resetAnalytics } from '../lib/analytics';
import { clearPopupSession } from '../hooks/popupSession';

interface Profile {
  id: string;
  nome: string;
  role: 'owner' | 'admin' | 'agent';
  conta_id: string;
  active_workspace_id?: string;
  [key: string]: unknown;
}

/**
 * Caches holding financial values, purged on live revocation (true -> false).
 *
 * Deliberately excludes `portfolioSummary`: that query is Instagram accounts,
 * top/worst posts and growth counters (services/analytics.ts) — no monetary
 * field. Purging it would refetch a large payload for nothing.
 */
export const FINANCIAL_QUERY_KEYS = [
  'cliente',
  'clientes',
  'membros',
  'transacoes',
  'contratos',
  'dashboardStats',
];

/**
 * Query-cache keys to purge (downgrade) or invalidate (upgrade) per module on
 * a live permission transition — the generalized, per-module counterpart of
 * FINANCIAL_QUERY_KEYS above, which stays module-specific to `financeiro` and
 * keeps covering the already-tested financial block untouched (see the
 * comment on its own purge in applyMembership below).
 *
 * Keys are the real first-array-element query keys used across the CRM
 * (verified with `grep -rn "queryKey: \['" apps/crm/src --include='*.ts*'`,
 * not the placeholder list from the original task brief, which included keys
 * that don't exist anywhere in the codebase — e.g. a literal `'workflow'` or
 * `'posts'` key. TanStack Query's removeQueries/invalidateQueries match by
 * exact positional equality of the leading key segments, so a key that is
 * merely a *substring* of a real one (`'workflow'` vs. the real
 * `'workflow-templates'`) never matches anything and would have been a
 * silent no-op purge.
 *
 * Deliberately NOT exhaustive down to every parameterized per-item key in the
 * app (e.g. every `workflow-posts-with-props` variant) — this is
 * defense-in-depth over an in-memory cache for a tab that never refetches on
 * its own, not the enforcement boundary (RLS + has_permission_for already
 * deny the underlying read). Covers each module's primary/list-level
 * queries, the same level of care FINANCIAL_QUERY_KEYS already applies to
 * `financeiro`.
 *
 * `aprovacoes` and `configuracoes` are intentionally `[]`: `aprovacoes` has
 * no CRM route mounted yet (see routePermissions.ts's own comment on the
 * same module) and `configuracoes` never holds module-scoped list data of
 * its own.
 */
export const MODULE_QUERY_KEYS: Record<PermissionModule, string[]> = {
  financeiro: ['transacoes', 'dashboardStats'],
  contratos: ['contratos'],
  clientes: ['cliente', 'clientes', 'clientePosts', 'clienteDatas'],
  equipe: ['membros', 'workspace-users', 'invites'],
  leads: ['leads'],
  entregas: [
    'workflows',
    'workflow-templates',
    'workflow-grid',
    'workflow-posts-with-props',
    'workflow-posts-counts',
    'active-posts',
    'scheduled-posts',
    'concluded-workflows',
    'concluded-summaries',
    'standalone-post',
    'post-approvals',
    'post-media',
    'post-preview',
  ],
  calendario: ['calendar-deadlines', 'allClienteDatas'],
  aprovacoes: [],
  arquivos: ['folder-contents', 'folder-tree', 'folder-info'],
  ideias: ['ideias', 'hub-ideias-all', 'ideia-images'],
  tarefas: ['tarefas', 'subtarefas', 'tarefa-tags'],
  analytics: [
    'portfolio-summary',
    'analytics-overview',
    'analytics-history',
    'analytics-posts',
    'analytics-times',
    'analytics-reports',
    'stories-analytics',
    'report-docs',
    'report-templates',
  ],
  automacoes: [
    'instagram-automations',
    'instagram-automations-count',
    'instagram-automation-sends',
    'ig-automation-ready-account',
    'automation-production-covers',
  ],
  configuracoes: [],
};

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  role: 'owner' | 'admin' | 'agent';
  /**
   * Role from workspace_members for the ACTIVE workspace. Prefer this over
   * `role` for anything permission-bearing; `role` comes from profiles and goes
   * stale on workspace switch. `null` while unresolved.
   */
  workspaceRole: 'owner' | 'admin' | 'agent' | null;
  /**
   * Whether the membership lookup behind `workspaceRole` has actually
   * settled, and how: `true` means it ran to completion (whether or not it
   * found a row); `'error'` means it threw (network/RLS blip) without ever
   * determining membership one way or the other; `false` means it hasn't
   * run yet for the current identity. `workspaceRole === null` alone is
   * ambiguous between "removed from the workspace" and "could not
   * determine" — this disambiguates. Consumers should treat only
   * `workspaceRole === null && membershipResolved === true` as a genuine
   * "no longer a member".
   */
  membershipResolved: boolean | 'error';
  canSeeFinancials: FinancialAccess;
  /**
   * Permission check for the active workspace membership. `'unknown'` while
   * membership hasn't resolved yet (same tri-state reasoning as
   * `canSeeFinancials`) — mirrors `derivePermission` from `lib/permissions.ts`
   * 1:1, never re-implements the role/preset semantics here.
   */
  can: (module: PermissionModule, action?: PermissionAction) => PermissionCheck;
  loading: boolean;
  refetchProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [workspaceRole, setWorkspaceRole] = useState<'owner' | 'admin' | 'agent' | null>(null);
  const [membershipResolved, setMembershipResolved] = useState<boolean | 'error'>(false);
  const [canSeeFinancials, setCanSeeFinancials] = useState<FinancialAccess>('unknown');
  /**
   * Full membership row (role + can_see_financials + role_id + permissions)
   * for the active workspace. `workspaceRole`/`canSeeFinancials` above are
   * derived from this same source and reset together with it everywhere —
   * this is purely additive state powering `can()`, not a second source of
   * truth. `null` while unresolved, same as `workspaceRole`.
   */
  const [membership, setMembership] = useState<MyMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const authGeneration = useRef(0);
  /**
   * Counts CRISP IDENTITY RESETS only — bumped at exactly the two places that
   * push `['do', 'session:reset']` (the user-change branch of
   * onAuthStateChange, and signOut) and nowhere else.
   *
   * Deliberately NOT `authGeneration`, which the Crisp identify effect used to
   * compare against. `authGeneration` moves on EVERY onAuthStateChange event —
   * INITIAL_SESSION, TOKEN_REFRESHED, USER_UPDATED, SIGNED_IN — so a routine
   * token refresh landing inside the crisp-identity invoke window (likely at
   * app start, where the invoke can take seconds against a cold edge function)
   * made the post-await guard reject a perfectly valid push. The effect's deps
   * are [userId, user?.email], neither of which a refresh changes, so it never
   * re-ran and the user went UNIDENTIFIED in Crisp for the whole mount —
   * exactly the "suppress identification entirely, worse than the unsigned
   * fallback" outcome the invoke timeout exists to prevent. This ref fires
   * when, and only when, an identity reset actually happened.
   */
  const crispResetGeneration = useRef(0);
  const profileRequestId = useRef(0);
  const activeUserId = useRef<string | null>(null);
  const userId = user?.id;

  useEffect(() => {
    let active = true;
    const initialAuthGeneration = authGeneration.current;

    // Resolve only the session here. Profile hydration belongs to the user
    // effect below so every session transition has exactly one request owner.
    void supabase.auth.getSession().then(
      ({ data }) => {
        if (!active || authGeneration.current !== initialAuthGeneration) return;
        const sessionUser = data.session?.user ?? null;
        activeUserId.current = sessionUser?.id ?? null;
        setUser(sessionUser);
        setSessionReady(true);
      },
      () => {
        if (!active || authGeneration.current !== initialAuthGeneration) return;
        setUser(null);
        setSessionReady(true);
        setLoading(false);
      },
    );

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      authGeneration.current += 1;

      const nextUser = session?.user ?? null;
      const nextUserId = nextUser?.id ?? null;
      // Any identity change — including A -> B with both non-null, e.g.
      // another tab signing in against shared storage — must reset every
      // per-user value below. Gating this on `!nextUser` alone left B
      // rendering with A's profile/canSeeFinancials/query cache until B's
      // membership resolved: a brief cross-account exposure. Match `signOut`
      // below (clearProfileCache, all four resets, queryClient.clear()).
      const userChanged = activeUserId.current !== nextUserId;
      if (userChanged) profileRequestId.current += 1;
      activeUserId.current = nextUserId;
      setUser(nextUser);
      setSessionReady(true);
      if (userChanged) {
        clearProfileCache();
        setProfile(null);
        setWorkspaceRole(null);
        setCanSeeFinancials('unknown');
        setMembership(null);
        setMembershipResolved(false);
        // Without this, posthog-js keeps A's distinct_id: it never switches
        // identity on a second identify() call without an explicit reset()
        // first. Skipping this let B's events and person-properties land on
        // A's PostHog profile -- the same cross-account bleed the resets
        // above exist to close, one layer over. Mirrors `signOut` below.
        resetAnalytics();
        // Same shared-machine reasoning as resetAnalytics() above, but for
        // Crisp: without this, B's chat messages land on A's identified
        // Crisp contact (A's email/nickname), since Crisp persists the
        // identity in the browser until told otherwise. Guarded because a
        // support-tooling failure must never break an auth transition.
        //
        // Bumped immediately before the push, synchronously and outside the
        // try, so an in-flight crisp-identity response for the OUTGOING
        // identity can never land after this reset (see the identify effect).
        crispResetGeneration.current += 1;
        try {
          window.$crisp?.push(['do', 'session:reset']);
        } catch {
          // Never let a support-tooling nicety break auth.
        }
        queryClient.clear();
        // Same shared-machine reasoning as resetAnalytics()/Crisp above: B
        // must not inherit A's popup shown/skipped/closed state
        // (sessionStorage, per-tab). Mirrors `signOut` below.
        clearPopupSession();
        // A non-null nextUser still has hydration ahead of it (the
        // profile-fetch effect below, keyed on userId, takes over `loading`
        // from here). Raising it back to true -- rather than leaving it at
        // whatever value A's completed hydration left it at -- closes the
        // window where a render sees `loading: false` with `profile: null`:
        // `role` falls back to 'agent' there (see the derivation below), and
        // consumers gating on `loading` (ProtectedRoute, ConfiguracaoLayout)
        // must not be allowed to act on that fallback before B's real role
        // resolves.
        if (nextUser) setLoading(true);
        else setLoading(false);
      }
    });

    return () => {
      active = false;
      authGeneration.current += 1;
      profileRequestId.current += 1;
      activeUserId.current = null;
      subscription.unsubscribe();
    };
    // queryClient is a stable module-level singleton (see App.tsx), so listing
    // it here satisfies exhaustive-deps without causing extra effect runs.
  }, [queryClient]);

  // Fetch profile whenever user changes
  useEffect(() => {
    if (!sessionReady) return;

    if (!userId) {
      profileRequestId.current += 1;
      setProfile(null);
      setWorkspaceRole(null);
      setMembershipResolved(false);
      setCanSeeFinancials('unknown');
      setMembership(null);
      setLoading(false);
      return;
    }

    let active = true;
    const requestId = ++profileRequestId.current;
    setLoading(true);

    void (async () => {
      try {
        const nextProfile = await getCurrentProfile(true);
        if (!active || profileRequestId.current !== requestId) return;

        setProfile(nextProfile as Profile | null);
        if (nextProfile) {
          // plan_id is null here on purpose: AuthContext resolves before entitlements load, and
          // blocking identify on a second request would delay every event behind it. Cohorting by
          // plan is a follow-up — enrich the `workspace` group where useEntitlements already has it.
          identifyWorkspaceUser(userId, {
            workspace_id: (nextProfile as Profile).conta_id,
            plan_id: null,
            role: (nextProfile as Profile).role,
          });
        }
        if (!active || profileRequestId.current !== requestId) return;

        // Joins the existing guarded hydration flow so `loading` covers it too.
        // On failure resolve to 'unknown', NEVER to a boolean.
        try {
          const membershipRow = await getMyMembership();
          if (!active || profileRequestId.current !== requestId) return;
          setWorkspaceRole(membershipRow?.role ?? null);
          setCanSeeFinancials(deriveFinancialAccess(membershipRow));
          setMembership(membershipRow);
          // The lookup ran to completion -- `membership === null` here means
          // it genuinely found no row, not that it failed. Either way this
          // is a real, resolved answer about membership.
          setMembershipResolved(true);
        } catch {
          if (!active || profileRequestId.current !== requestId) return;
          setWorkspaceRole(null);
          setCanSeeFinancials('unknown');
          setMembership(null);
          // The lookup THREW (network/RLS blip) -- membership was never
          // actually determined. Must stay distinguishable from a genuine
          // "no row found" (`true`, above) so callers don't tell a real
          // member they've been removed over a transient error.
          setMembershipResolved('error');
        }

        void healPendingInvite();
      } catch {
        if (active && profileRequestId.current === requestId) {
          setProfile(null);
          // getCurrentProfile() threw before the membership lookup ever ran
          // -- nothing about membership is known.
          setMembershipResolved('error');
        }
      } finally {
        if (active && profileRequestId.current === requestId) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [sessionReady, userId]);

  // Crisp identification, split out from the profile-hydration effect above
  // on purpose: that effect is keyed on [sessionReady, userId] so an email or
  // name change alone never re-triggers the profile/membership fetch, but
  // Crisp still needs to learn about exactly those changes. Without its own
  // effect, a Supabase USER_UPDATED event (e.g. after an email change) would
  // update `user.email` in state while `userId` stays the same -- the
  // hydration effect wouldn't re-run, and Crisp would stay identified with
  // the stale email for the rest of the session.
  //
  // Crisp is loaded anonymously in index.html, so the inbox otherwise shows
  // no identity. Email + name only: client count is not available from any
  // existing hook, and the spec explicitly says not to build a data path for
  // it. Guarded because Crisp's script may not have loaded yet, and each push
  // gets its own try/catch so one throwing (e.g. Crisp rejecting an
  // unexpected value) can never suppress the other.
  //
  // Ordering vs. session:reset: reset is pushed synchronously -- inside the
  // onAuthStateChange handler for a user change, and inside signOut() --
  // while `userId` still holds the OUTGOING identity. The identify push below
  // is NOT synchronous: it awaits a network round trip to crisp-identity, so a
  // sign-out's synchronous reset can fire while a signing request started by
  // the JUST-reset session is still in flight. `active` alone does not close
  // that window: it is only cleared later, by React's passive-effect cleanup
  // once it commits the render for the new userId, which is strictly after the
  // in-flight response could already have resolved and pushed the outgoing
  // user's email into the freshly reset (anonymous, or next-user) session -- a
  // cross-customer attribution bug on a shared machine, exactly what
  // session:reset exists to prevent.
  //
  // The ordering IS resolved, by re-checking `crispResetGeneration` (captured
  // at effect start) after the await, in addition to `active`: that ref moves
  // synchronously, in the same turn as every session:reset push, so unlike
  // `active` it can never still read as "current" once a reset for this
  // identity has already happened.
  //
  // It is `crispResetGeneration` and NOT `authGeneration` on purpose. See that
  // ref's declaration: authGeneration counts every auth event, so a
  // TOKEN_REFRESHED arriving mid-invoke made this guard drop a valid push and,
  // because the deps below do not change on a refresh, left the user
  // unidentified in Crisp for the entire mount.
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const initialCrispResetGeneration = crispResetGeneration.current;

    (async () => {
      if (!user?.email) return;
      let signature: string | undefined;
      try {
        // Explicit timeout: browser fetch has no default one, and
        // functions-js resolves rather than throws on genuine errors -- but
        // a HANG is neither. Without a bound, a stalled edge function would
        // suppress identification indefinitely (user:email never pushed at
        // all), which is worse than the unsigned fallback this catch block
        // exists for. This repo has been bitten before by unbounded I/O in
        // state-setting handlers (R2 presign) -- same fix here.
        const { data } = await supabase.functions.invoke('crisp-identity', { timeout: 5000 });
        signature = (data as { signature?: string } | null)?.signature;
      } catch {
        // Signing is best-effort. A failure means the session shows as
        // Unverified in the inbox, which is the pre-existing behaviour and is
        // strictly better than blocking support access entirely.
      }
      // Both checks matter: `active` closes the ordinary effect-re-run/
      // unmount race, `crispResetGeneration` closes the session:reset race
      // (see the comment above this effect) that `active` cannot, because it
      // is only cleared asynchronously by React's own cleanup.
      if (!active || crispResetGeneration.current !== initialCrispResetGeneration) return;

      try {
        // Second element is the identity signature. Crisp marks the session
        // Verified only when it validates; unsigned sessions still work.
        window.$crisp?.push(
          signature
            ? ['set', 'user:email', [user.email, signature]]
            : ['set', 'user:email', [user.email]],
        );
      } catch {
        // Never let a support-tooling nicety break auth.
      }
    })();

    return () => {
      active = false;
    };
  }, [userId, user?.email]);

  useEffect(() => {
    if (!userId) return;
    if (profile?.nome) {
      try {
        window.$crisp?.push(['set', 'user:nickname', [profile.nome]]);
      } catch {
        // Never let a support-tooling nicety break auth.
      }
    }
  }, [userId, profile?.nome]);

  // Backstop mirror: keeps the ref in sync with every OTHER setCanSeeFinancials
  // call site (the userChanged reset, both branches of the hydration effect,
  // and signOut) that sets React state directly and never goes through
  // applyMembership below, so nothing else can update the ref for it.
  // applyMembership itself assigns the ref synchronously and reads it back
  // BEFORE this effect gets a chance to run -- see its comment -- so this
  // passive effect must not be the only writer, or a hydration/sign-out write
  // in between two applyMembership calls would leave the ref one step behind
  // rendered state, and a later real transition would compare against that
  // stale value and wrongly look like a no-op.
  const canSeeFinancialsRef = useRef<FinancialAccess>('unknown');
  useEffect(() => {
    canSeeFinancialsRef.current = canSeeFinancials;
  }, [canSeeFinancials]);

  // Same backstop-mirror pattern as canSeeFinancialsRef immediately above,
  // for the same reason: applyMembership below (the realtime handler) needs
  // to compare the INCOMING payload's role_id against the membership this
  // context already has, and it needs that comparison to be correct even
  // when two applyMembership calls land in the same commit (no render, and
  // so no chance for this passive effect to run, in between them) -- see
  // applyMembership's own comment for exactly that race. Every other
  // setMembership call site (the userChanged reset, both branches of the
  // hydration effect, fetchProfile's no-session reset, and signOut) sets
  // React state directly and never goes through applyMembership, so nothing
  // else keeps this ref current for those -- this passive effect is what
  // catches up on the next render.
  const membershipRef = useRef<MyMembership | null>(null);
  useEffect(() => {
    membershipRef.current = membership;
  }, [membership]);

  // Live revocation.
  //
  // Severity, stated precisely: this is a correctness/UX concern, not a
  // disclosure boundary. After Migration B the database denies the read
  // regardless of what this client believes, so a stale cache cannot survive
  // a refetch and no new financial data can be obtained either way. This
  // effect is defence-in-depth over values already sitting in memory (query
  // cache, open dialogs) for a tab that never refetches on its own — it must
  // never be described or relied upon as the enforcement boundary.
  //
  // Keyed on [userId, profile?.conta_id] rather than [sessionReady, userId]
  // (the hydration effect above): that effect never re-runs on a workspace
  // switch, which is safe today only because the sole switch path
  // (Sidebar.tsx) does a full window.location.reload(). Keying here on the
  // workspace id too means this subscription still re-points itself at the
  // new workspace if that assumption ever changes.
  useEffect(() => {
    const workspaceId = profile?.conta_id;
    if (!userId || !workspaceId) return;

    // Ordering + teardown guard for every getMyMembership() round trip this
    // effect instance starts (the channel's role_id-transition refetch below
    // AND the 60s poll). Bumped before each such call, and the value at call
    // time is captured by fetchAndApplyMembership()'s closure; its `.then`
    // only calls applyMembership if the captured value still matches when
    // the request resolves. Closes two races neither getMyMembership() nor
    // applyMembership() can see on their own:
    //  1. Ordering: two refetches can be in flight at once (e.g. a role_id
    //     transition immediately followed by another one, or a channel
    //     refetch racing the 60s poll) and resolve out of order over the
    //     network — without this, an OLDER response landing AFTER a NEWER
    //     one would silently overwrite the correct, more recent state with
    //     stale data.
    //  2. Teardown: bumped again in this effect's own cleanup below, so a
    //     refetch still in flight when the effect tears down (workspace
    //     switch, sign-out, unmount) can never reach applyMembership
    //     afterwards. Without this, a late resolution to `null` (e.g. the
    //     user was already removed from the OLD workspace right as they
    //     switched away from it) would fake a "genuinely removed" state for
    //     whatever identity/workspace the NEXT effect run is now tracking.
    // A plain closure-scoped counter, not a component-level useRef: its
    // lifetime is exactly this effect instance's, same as `channel`/`poll`
    // below, so it needs no separate reset logic — a fresh one is created,
    // and the old one stops mattering, every time this effect re-runs.
    let membershipFetchSeq = 0;

    const applyMembership = (next: MyMembership | null) => {
      // Captured before ANY state/ref mutation below (including
      // `membershipRef.current = next` a few lines down) — feeds the
      // generalized per-module purge at the bottom of this function via
      // computePermissionTransitions(previousMembership, next). Same
      // read-before-overwrite discipline as `canSeeFinancialsRef` below, and
      // for the identical reason: two applyMembership calls can land
      // back-to-back with no render in between (see that block's comment),
      // so this must be the last value THIS handler itself applied, never a
      // lagging render-committed one.
      const previousMembership = membershipRef.current;

      setWorkspaceRole(next?.role ?? null);
      // Both callers of applyMembership (the realtime UPDATE payload and the
      // poll's getMyMembership() result) only ever invoke it with a genuine,
      // resolved answer -- the poll's own `.catch(() => {})` below swallows
      // lookup errors before they would reach here. So every call is a real
      // resolution, whether membership is present or (`next === null`) gone.
      setMembershipResolved(true);
      // Same derivation as hydration — never re-implement the role semantics
      // here. Two copies drift; this bug already shipped once on this branch
      // (a raw can_see_financials assignment gave agents access and denied
      // restricted owners). `next === null` — membership row gone, which is
      // exactly what a deletion resolves to via getMyMembership() — derives
      // to 'unknown' here too: it masks financial values and fails the route
      // guard neutral instead of keeping a stale role/grant alive.
      const nowAllowed = deriveFinancialAccess(next);
      setCanSeeFinancials(nowAllowed);
      setMembership(next);
      // Mirrors canSeeFinancialsRef's own synchronous assignment just below —
      // the channel handler's role_id comparison (see its comment) needs
      // membershipRef.current to already reflect THIS call, not last render's
      // value, the moment the next payload arrives.
      membershipRef.current = next;

      // Read the ref BEFORE overwriting it, then overwrite it synchronously
      // (not via the passive mirror effect above). The ref must lead the
      // render, never lag it: setCanSeeFinancials above only takes effect on
      // the next render, and the mirror effect that copies it into the ref
      // runs even later, after React flushes. Two applyMembership calls can
      // land back-to-back with no render in between (e.g. a live grant event
      // immediately followed by a live revoke event) — with a lagging ref,
      // BOTH calls would read the same pre-render value, so a grant
      // (false -> true) and the revoke right behind it (true -> false) both
      // compare against the original `false` and the revoke looks like a
      // no-op (false !== false), silently skipping its purge while the
      // grant's in-flight refetch goes on to repopulate the cache with
      // authorised data after access was already revoked. Assigning here
      // makes `previous` the last value this handler itself applied, so the
      // second call always sees what the first one just set.
      const previous = canSeeFinancialsRef.current;
      canSeeFinancialsRef.current = nowAllowed;

      // Purge on ANY transition INTO a non-authorised state, not only a
      // transition FROM a definitely-granted one. A `wasAllowed` boolean
      // (`ref === true`) cannot see this: hydration starts the ref at
      // 'unknown', so a restricted admin's very first resolution is
      // `'unknown' -> false` — `wasAllowed` is `false` going in, so the old
      // `wasAllowed && nowAllowed !== true` check never fires for it, even
      // though that is exactly the transition that must purge (a prior fetch
      // could already have populated the cache with real rows while access
      // was still unresolved). Comparing the ref's actual value instead of
      // collapsing it to a boolean catches that case too, while `previous !==
      // nowAllowed` still skips a same-state repeat from the 60s poll
      // (e.g. false -> false), which is not a transition and must not
      // re-purge or re-trigger a refetch storm every tick.
      if (previous !== nowAllowed) {
        // Revocation (transition INTO a non-authorised state): the cache may
        // hold real, unmasked values from before access was lost, so it must
        // be wiped outright — merely invalidating could still serve a stale
        // authorised value to someone who just lost access before the
        // refetch lands. No follow-up refetchQueries() call is needed (or
        // even useful) here: removeQueries() deletes the query from the
        // QueryCache's map outright, so a refetchQueries() call made right
        // after — scoped or not — finds nothing left to match and is a
        // no-op for these keys (verified against @tanstack/query-core
        // 5.91.0's source: removeQueries -> queryCache.remove() ->
        // #queries.delete(queryHash), then refetchQueries -> findAll() reads
        // that same now-empty map). What actually clears a currently-
        // mounted observer's stale render is TanStack Query's own
        // optimistic-result rebuild the next time it re-renders
        // (getOptimisticResult -> queryCache.build(), which recreates the
        // query with empty state since it's gone from the cache) — and the
        // setCanSeeFinancials() call above already forces that re-render for
        // every component gating financial data on `canSeeFinancials`.
        //
        // Grant (transition TO true): the cached rows came from the masking
        // views (clientes_v / membros_v) with financial columns NULLed, so
        // nothing sensitive leaks by keeping them a moment longer. Only
        // invalidate — removeQueries here would blank the UI (Clientes/
        // Equipe rows disappearing) until the refetch lands, a worse
        // experience than briefly showing masked values. No separate
        // refetchQueries() call is needed either: invalidateQueries()
        // defaults to refetchType: 'active', so it already refetches each
        // key's active queries on its own. An additional unscoped
        // refetchQueries({ type: 'active' }) would only cancel and restart
        // that just-started refetch, and — being unfiltered — also blast
        // every other unrelated active query on the page (workflows,
        // integrations, Instagram, …) on every grant.
        for (const key of FINANCIAL_QUERY_KEYS) {
          if (nowAllowed !== true) {
            queryClient.removeQueries({ queryKey: [key] });
          } else {
            queryClient.invalidateQueries({ queryKey: [key] });
          }
        }
      }

      // Generalized, per-module counterpart of the financial-only block just
      // above — that block stays exactly as-is (it purges a broader,
      // hand-picked key set for a subtly different signal: financial columns
      // masked INSIDE clientes/membros rows, not just standalone
      // financeiro/contratos data) and keeps covering the scenarios already
      // tested for it. This one is additive: it fires for EVERY
      // PermissionModule, financeiro/contratos included, so a transition on
      // ANY module (not only the financial one) purges or invalidates that
      // module's own query-cache keys too. Running both for financeiro/
      // contratos is intentional and harmless — removeQueries/
      // invalidateQueries are idempotent for a key with no matching queries.
      //
      // Uses `previousMembership`, captured at the very top of this function
      // BEFORE `membershipRef.current` was overwritten a few lines up — the
      // exact same back-to-back-calls-in-one-commit race the ref reads above
      // exist to close (see this function's opening comment).
      const { downgraded, upgraded } = computePermissionTransitions(previousMembership, next);
      for (const module of downgraded) {
        for (const key of MODULE_QUERY_KEYS[module]) {
          queryClient.removeQueries({ queryKey: [key] });
        }
      }
      for (const module of upgraded) {
        for (const key of MODULE_QUERY_KEYS[module]) {
          queryClient.invalidateQueries({ queryKey: [key] });
        }
      }
    };

    // Shared by both getMyMembership() call sites below (the channel's
    // role_id-transition refetch and the 60s poll) so the ordering/teardown
    // guard above is implemented exactly once, not duplicated and liable to
    // drift between the two.
    const fetchAndApplyMembership = () => {
      const seq = ++membershipFetchSeq;
      void getMyMembership()
        .then((next) => {
          // Stale (superseded by a later fetch) or this effect instance has
          // already torn down (see the cleanup below) — either way, dropping
          // silently is correct: a fresher call already applied the current
          // truth, or there is no current subscription left to apply it to.
          if (seq !== membershipFetchSeq) return;
          applyMembership(next);
        })
        .catch(() => {});
    };

    // wm_select_same_workspace (migration 20260612120000) lets this user read
    // their membership row in EVERY workspace they belong to, not just the
    // active one, so a `user_id=eq.<uid>` filter alone lets Realtime deliver
    // UPDATEs from other workspaces too. Without the workspace_id guard below,
    // a row from a different workspace would overwrite workspaceRole/
    // canSeeFinancials for the active one — a spurious revocation or grant.
    //
    // Migration A adds workspace_members to the realtime publication under
    // the DEFAULT replica identity, so DELETE events carry only the primary
    // key. A filter on user_id=eq.<uid> matches no DELETE payload, so being
    // removed from the workspace entirely would look "subscribed and
    // healthy" while silently going unnoticed. Subscribe to UPDATE only (it
    // carries the full new row) — the bounded poll below is what actually
    // covers deletion (see its comment for how).
    // Do NOT add REPLICA IDENTITY FULL to make DELETE usable here: that
    // costs write amplification on every update to this table and is a
    // deliberate trade to leave for later, not to slip in.
    const channel = supabase
      .channel(`wm:${userId}:${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'workspace_members',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as {
            workspace_id?: string;
            role?: string;
            can_see_financials?: boolean;
            role_id?: string | null;
          };
          if (row.workspace_id !== workspaceId) return;
          // The realtime UPDATE payload is the raw workspace_members row — it
          // never carries the joined workspace_roles.permissions the way
          // getMyMembership() does. Applying it directly is only correct for
          // a member whose custom-role assignment did NOT just change
          // (role_id null before and after, the plain legacy path). A row
          // that now points at a custom role, or that just stopped pointing
          // at one, needs the full embed to know its `permissions` — re-fetch
          // through getMyMembership() rather than guess at that here.
          if (row.role_id != null || row.role_id !== (membershipRef.current?.role_id ?? null)) {
            fetchAndApplyMembership();
          } else {
            // Bump the shared seq FIRST: this direct apply never goes through
            // fetchAndApplyMembership(), so without this an OLDER refetch the
            // wr: channel (or the 60s poll) already had in flight would still
            // see its captured `seq === membershipFetchSeq` when it resolves
            // afterwards, and overwrite this newer, already-applied raw row
            // with its stale result.
            membershipFetchSeq += 1;
            applyMembership({ ...row, role_id: null, permissions: null } as MyMembership);
          }
        },
      )
      .subscribe();

    // Companion subscription: an owner/admin editing a CUSTOM ROLE's
    // `permissions` (Configurações → Papéis) changes what every member
    // assigned to that role can do, but writes NO row in workspace_members —
    // the channel above, filtered on `workspace_members`, never fires for it.
    // Without this, a role edit would sit invisible until the 60s poll (the
    // one below) happens to catch it.
    //
    // Filtered on `conta_id=eq.${workspaceId}` (not the edited role's id,
    // which this client doesn't know ahead of time) — any role edit in the
    // workspace triggers a refetch. Routed through fetchAndApplyMembership(),
    // never applied directly from the payload: this table's row IS
    // `workspace_roles`, not this member's `workspace_members` row, so there
    // is no "raw row" to apply here even for the plain case — only
    // getMyMembership()'s embed can say whether THIS member's `role_id`
    // actually points at the role that just changed. An edit to a role this
    // member does NOT hold produces a harmless refetch that resolves to the
    // same membership (computePermissionTransitions sees no transition,
    // financeiro's own ref comparison sees no change either) — the seq guard
    // above (shared with the wm: channel and the poll) still applies here, so
    // an in-flight refetch from this channel can never race the others out of
    // order or survive this effect's teardown.
    const rolesChannel = supabase
      .channel(`wr:${userId}:${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'workspace_roles',
          filter: `conta_id=eq.${workspaceId}`,
        },
        () => {
          fetchAndApplyMembership();
        },
      )
      .subscribe();

    // Bounded polling fallback. Refetch-on-focus alone is insufficient: focus
    // events never fire for a tab that stays foregrounded, which is precisely
    // the indefinite-cache case this exists to address. It is also the only
    // path that covers revocation-by-deletion: getMyMembership() resolves to
    // `null` once the row is gone (filtered by both user_id AND workspace_id,
    // so it is immune to the cross-workspace bleed above), and applyMembership
    // now lets that `null` flow through instead of early-returning — see its
    // comment for what that derives to.
    const poll = setInterval(() => {
      fetchAndApplyMembership();
    }, 60_000);

    return () => {
      // Bumped BEFORE clearInterval/removeChannel below, not after: it only
      // needs to happen before this closure is torn down, and doing it first
      // makes the invalidation unconditional on cleanup even if a future
      // edit made either of the lines below throw. Any getMyMembership()
      // call fetchAndApplyMembership() started that is still in flight now
      // has a `seq` that can never match `membershipFetchSeq` again, so its
      // `.then` drops the result instead of calling applyMembership() after
      // this effect (and whatever workspace/identity it was tracking) is
      // gone.
      membershipFetchSeq += 1;
      clearInterval(poll);
      void supabase.removeChannel(channel);
      void supabase.removeChannel(rolesChannel);
    };
  }, [userId, profile?.conta_id, queryClient]);

  const fetchProfile = async () => {
    if (!sessionReady || !user) {
      profileRequestId.current += 1;
      setProfile(null);
      setWorkspaceRole(null);
      setMembershipResolved(false);
      setCanSeeFinancials('unknown');
      // Mirrors workspaceRole/canSeeFinancials above -- this is a 5th
      // no-session reset site beyond the four the rest of this file's
      // comments call out (userChanged, the hydration effect's own
      // no-userId branch, its getMyMembership() catch, and signOut).
      // Leaving it out would let a stale membership answer survive a
      // refetchProfile() call made with no active session, so `can()`
      // and canSeeFinancials/workspaceRole could disagree about whether
      // the caller has ANY membership at all.
      setMembership(null);
      setLoading(false);
      return;
    }

    const requestId = ++profileRequestId.current;
    setLoading(true);
    try {
      const nextProfile = await getCurrentProfile(true);
      if (profileRequestId.current !== requestId) return;

      setProfile(nextProfile as Profile | null);
    } catch {
      if (profileRequestId.current === requestId) setProfile(null);
    } finally {
      if (profileRequestId.current === requestId) setLoading(false);
    }
  };

  const role: 'owner' | 'admin' | 'agent' =
    (profile?.role as 'owner' | 'admin' | 'agent') ?? 'agent';

  const signOut = async () => {
    authGeneration.current += 1;
    // Paired with the `['do', 'session:reset']` push below, but bumped HERE,
    // before the first await: an in-flight crisp-identity response for the
    // outgoing user can resolve during `await supabaseSignOut()`, so the
    // counter has to have moved already for the identify effect's post-await
    // guard to see it. Same reasoning as authGeneration on the line above.
    crispResetGeneration.current += 1;
    profileRequestId.current += 1;
    await supabaseSignOut();
    // Prevent the next user on a shared machine from being merged into this identity.
    resetAnalytics();
    // Same shared-machine reasoning as resetAnalytics() above, but for Crisp:
    // without this, the next person on this browser inherits the outgoing
    // user's identified Crisp contact (their email/nickname) and their
    // support messages land on it. Guarded because a support-tooling failure
    // must never break sign-out, a security-relevant path.
    try {
      window.$crisp?.push(['do', 'session:reset']);
    } catch {
      // Never let a support-tooling nicety break auth.
    }
    clearProfileCache();
    activeUserId.current = null;
    setUser(null);
    setSessionReady(true);
    setProfile(null);
    setWorkspaceRole(null);
    setMembershipResolved(false);
    setCanSeeFinancials('unknown');
    setMembership(null);
    setLoading(false);
    // Drop all cached per-user data (entitlements, notifications, …) so the next
    // account that logs in never sees the previous user's plan/limits.
    queryClient.clear();
    // Same shared-machine reasoning: the next user in this tab must not inherit
    // this user's popup shown/skipped/closed state (sessionStorage, per-tab).
    clearPopupSession();
  };

  const can = useCallback(
    (module: PermissionModule, action: PermissionAction = 'ver') =>
      derivePermission(membership, module, action),
    [membership],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        role,
        workspaceRole,
        membershipResolved,
        canSeeFinancials,
        can,
        loading,
        refetchProfile: fetchProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
