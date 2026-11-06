# iOS native module D1–D3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Capacitor app (apps/mobile, PR #668) usable for release: hide sign-up and billing inside the app (D1), keep the Supabase session in the iOS Keychain (D2), and register the device for push with a pre-prompt, tap routing, mark-read, a "Celular" prefs column and unregister on logout (D3).

**Architecture:** The app's web view loads the live CRM (`server.url`, DECISIONS.md D3), so every web-side change ships with the CRM deploy and the native side only adds plugins. A dependency-free `apps/crm/src/native/platform.ts` answers "am I inside the app" by reading the `window.Capacitor` bridge the shell injects. All Capacitor JS (`@capacitor/core`, plugins) is reached through dynamic `import()` from code that runs only when `isNativeApp()` is true, so the web and landing bundles don't grow and the SSR prerender never evaluates it. One local Swift plugin, `MesaasNative`, in the App target provides Keychain access, the APNs environment and app version, and "open Settings".

**Tech Stack:** React 19 + TanStack Query (CRM), Supabase JS v2, Capacitor 8.5.3 (`@capacitor/core` 8.5.3, `@capacitor/push-notifications` 8.1.3), Swift (iOS 16.2 target, SPM), Vitest.

**Spec:** `apps/mobile/PLAN.md` (Phase D rows D1–D3) and `apps/mobile/DECISIONS.md` (D3, D5, D10–D15, D22). Push payload contract: `supabase/functions/notification-push-cron/handler.ts` `buildPushMessage` + `supabase/functions/_shared/apns.ts` (custom keys sit at the payload's top level next to `aps`).

## Global Constraints

- Branch `feat/ios-native-d1-d3` from `origin/main` **after #668 is merged** (the native half edits files that only exist on #668's tree).
- Version line: `@capacitor/core` **8.5.3** in both the root `package.json` (where the CRM's dependencies live) and `apps/mobile/package.json`; `@capacitor/push-notifications` **8.1.3** in both (the CRM needs the JS, `cap sync` discovers native plugins from `apps/mobile`'s deps). One lockfile.
- Nothing under `apps/crm/src/native/` may touch `window`, `document`, `localStorage` or import `@capacitor/*` at module scope. Every Capacitor import is a dynamic `import()` inside a function that first checked `isNativeApp()`. The SSR prerender bundle is single-file and runs every module's top level in Node (`landing-prerender-smoke`).
- The landing render stays hydration-stable: no `isNativeApp()` branch during render of a prerendered page; in-app redirects run in `useEffect`.
- Keep CSS class-name string literals out of `native/platform.ts` and anything public code imports (`cssSplitBoundary.test.ts`).
- Copy (pt-BR, no em-dashes): prefs columns **Sino / E-mail / Celular** (D22); plan limits and locked features in the app state the fact and offer **"Entendi"**, never a link or a mention of plans or the website (see Copy decisions; Task 5 records this as DECISIONS.md D33, superseding D5's "Gerencie seu plano pelo site").
- Push environment comes from the native build (`#if DEBUG` → `sandbox`, else `production`), never guessed in JS.
- No new migration except Task 6's CHECK widening.
- Deploy order: Task 6's migration (staging, then prod with the user) → merge. No edge function changes.

## Review Focus

1. **Older app binary, newer web (version skew).** A web deploy reaches installed apps before an App Store update. If `MesaasNative` is missing from the running binary, auth storage must fall back to `localStorage`, never throw (a throw logs everyone out). Test in Task 3.
2. **Existing session at first launch of the Keychain build.** A user already signed in (token in WKWebView `localStorage`) must stay signed in: the first `getItem` moves the value into the Keychain and deletes it from `localStorage`. Test in Task 3.
3. **Tap on a push whose `link` is not a CRM path** (null for summary pushes, or an absolute URL). Null opens the app where it was; anything not starting with a single `/` is ignored (no open redirect). Test in Task 5.
4. **Logout on a device, then another user logs in.** The token must be unregistered for the first user before `signOut` (the RPC needs the session), and registered for the second on their login; a failed unregister must not block logout. Test in Task 5.
5. **Pre-prompt never nags.** "Agora não" snoozes for 7 days; once iOS permission is `denied` the sheet never shows again and the prefs screen offers "Abrir Ajustes" instead. Test in Task 7.
6. **Plugin actually reachable.** `SceneDelegate` must show `MainViewController`, or `isPluginAvailable('MesaasNative')` is false and D2 silently ships as localStorage (every unit test still green). Runtime check in Task 2 and Task 8.
7. **User switch on one phone.** If unregister fails or the next user never grants permission, the token must still move to the current user on login, or user A's notifications reach user B's phone. Test in Task 7.

---

## Copy decisions (pt-BR, both `pt` and `en` locales)

The approved mockups (canvas "Mesaas iOS App Screens", boards `PlanLimit` and `NotificationPrefs`) supersede D5's "Gerencie seu plano pelo site": inside the app, nothing mentions buying, plans for sale or the website's billing. A locked feature or a hit limit states the fact and offers **"Entendi"**.

| Key (new, under `common.native`) | pt |
|---|---|
| `lockedTitle` | `{{feature}} não está disponível na sua conta` |
| `lockedBody` | `Fale com o dono do workspace se precisar deste recurso.` |
| `limitBody` | `Você atingiu o limite da sua conta.` |
| `ok` | `Entendi` |
| `pushPromptTitle` | `Receber avisos no celular?` |
| `pushPromptBody` | `Avisamos quando um cliente aprovar um post, pedir correção ou mandar mensagem, e quando um prazo estiver perto.` |
| `pushPromptAllow` | `Ativar notificações` |
| `pushPromptLater` | `Agora não` |
| `pushOffTitle` | `Notificações desligadas neste iPhone` |
| `pushOffEnable` | `Ativar` |
| `pushOffSettings` | `Abrir Ajustes` |

`settings.json` `inApp` changes from "No app" to **"Sino"** everywhere (in the app "No app" reads as "in this app"), and the push column header is **"Celular"** (D22).

## File map

| File | Responsibility | Task |
|---|---|---|
| `apps/crm/src/native/platform.ts` | `isNativeApp()`, `nativePlatform()`; no imports | 1 |
| `apps/crm/src/native/mesaasNative.ts` | lazy loader + TS interface of the `MesaasNative` plugin | 1 |
| `apps/crm/src/native/blockedPaths.ts` | which CRM paths the app never shows | 4 |
| `apps/mobile/ios/App/App/MesaasNativePlugin.swift` | Keychain, device info, open Settings/URL | 2 |
| `apps/crm/src/native/authStorage.ts` | Supabase storage adapter over the Keychain | 3 |
| `apps/crm/src/native/useNativePathGuard.ts` | redirect blocked paths to `/dashboard` | 4 |
| `apps/crm/src/native/push.ts` | permission, register, unregister, tap handling | 7 |
| `apps/crm/src/native/NativeBridge.tsx` | mounts push listeners + pre-prompt in the signed-in shell | 7 |
| `apps/crm/src/native/PushPrePromptSheet.tsx`, `PushPermissionRow.tsx` | pre-prompt sheet; prefs row when permission is off | 7 |
| `supabase/migrations/20261121000001_push_prefs_linha_editorial.sql` | widen `notification_push_prefs_type_check` | 6 |

## Execution order

Task 1 first (it adds every dependency, so no later task touches the lockfile). Then Tasks 2, 3, 4, 5 and 6 in parallel: they touch disjoint files, except `App.tsx`, which Task 3 changes at lines 38-45 and Task 4 in the routes component (different hunks; the second to land rebases). Task 7 runs after 2, 3, 5 and 6 (its copy keys come from Task 5). Task 8 last.

---

### Task 1: Platform detection, plugin wrapper, dependencies

**Files:**
- Create: `apps/crm/src/native/platform.ts`, `apps/crm/src/native/mesaasNative.ts`
- Modify: `package.json` (root), `apps/mobile/package.json`, `package-lock.json`
- Test: `apps/crm/src/native/__tests__/platform.test.ts`, `apps/crm/src/native/__tests__/mesaasNative.test.ts`

**Interfaces:**
- Produces:
  - `isNativeApp(): boolean`: `true` only when `globalThis.window?.Capacitor?.isNativePlatform?.() === true`. Safe in Node (no `window`).
  - `nativePlatform(): 'ios' | 'android' | null`: from `window.Capacitor.getPlatform()` when native, else `null`.
  - `interface MesaasNativePlugin { keychainGet(o: { key: string }): Promise<{ value: string | null }>; keychainSet(o: { key: string; value: string }): Promise<void>; keychainRemove(o: { key: string }): Promise<void>; deviceInfo(): Promise<{ pushEnvironment: 'sandbox' | 'production'; appVersion: string }>; openSettings(): Promise<void>; openUrl(o: { url: string }): Promise<void> }`
  - `getMesaasNative(): MesaasNativePlugin | null`: synchronous, no import. `null` unless `isNativeApp()` and `window.Capacitor.isPluginAvailable('MesaasNative')`; then `window.Capacitor.Plugins.MesaasNative` (the shell's bridge injects plugin proxies at document start, so the session read never waits on a network chunk). Older binary without the plugin → `null`. `@capacitor/core` and `@capacitor/push-notifications` are imported dynamically only by Task 7's push code.

- [ ] **Step 1: Write failing tests.** `platform.test.ts`: no `window.Capacitor` → `isNativeApp() === false`, `nativePlatform() === null`; stub `window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' }` → `true` / `'ios'`; stub `isNativePlatform: () => false` → `false`. `mesaasNative.test.ts` (stub `window.Capacitor`): not native → `null`; native + `isPluginAvailable('MesaasNative')` false → `null`; native + available → `window.Capacitor.Plugins.MesaasNative`.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/native` → FAIL (modules missing).
- [ ] **Step 3: Implement both modules.** `platform.ts` has no imports and no module-scope reads.
- [ ] **Step 4: Dependencies.** `npm install --save-exact @capacitor/core@8.5.3 @capacitor/push-notifications@8.1.3` (the CRM's dependencies live in the root `package.json`) and `npm install -w apps/mobile @capacitor/push-notifications@8.1.3 --save-exact`. Check `git diff package-lock.json` adds only `@capacitor/push-notifications` and workspace links (no unrelated bumps).
- [ ] **Step 5: Run** `npx vitest run apps/crm/src/native` → PASS; `npx tsc -p apps/crm/tsconfig.json --noEmit` → clean.
- [ ] **Step 6: Bundle and prerender check.** `npm run build && npm run prerender` (the SSR bundle is single-file with `noExternal`, so a module-scope `registerPlugin` would run in Node), then `grep -l "registerPlugin" dist/assets/index-*.js` → no match.
- [ ] **Step 7: Commit** `feat(native): detecção do app e wrapper do plugin MesaasNative`.

### Task 2: `MesaasNative` Swift plugin and push wiring in the shell

**Files:**
- Create: `apps/mobile/ios/App/App/MesaasNativePlugin.swift`, `apps/mobile/ios/App/App/App.entitlements`
- Modify: `apps/mobile/ios/App/App/SceneDelegate.swift` (`rootViewController = MainViewController()`: today it builds a bare `CAPBridgeViewController()`, so the storyboard's `MainViewController` and its shell polish never run), `apps/mobile/ios/App/App/MainViewController.swift`, `AppDelegate.swift`, `App.xcodeproj/project.pbxproj` (add the Swift file to the App target's Sources; `CODE_SIGN_ENTITLEMENTS = App/App.entitlements` in Debug and Release), `apps/mobile/capacitor.config.ts`, `apps/mobile/ios/App/CapApp-SPM/Package.swift` (regenerated by `cap sync`, not by hand)

**Interfaces:**
- Consumes: the `MesaasNativePlugin` method names and shapes from Task 1 (jsName `MesaasNative`).
- Produces: native implementations of those methods.

- [ ] **Step 1: Plugin.** `MesaasNativePlugin: CAPPlugin, CAPBridgedPlugin`, `identifier = "MesaasNativePlugin"`, `jsName = "MesaasNative"`, six `CAPPluginMethod`s returning promises. Keychain: `kSecClassGenericPassword`, `kSecAttrService = "br.com.mesaas.app"`, `kSecAttrAccount = key`, `kSecAttrAccessible = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (no iCloud sync, not in backups); set = delete-then-add; get of a missing item resolves `{ value: null }`; any other `OSStatus` rejects with the code. `deviceInfo`: `#if DEBUG` → `"sandbox"` else `"production"` (TestFlight and App Store use production APNs); `appVersion` = `CFBundleShortVersionString` + `(CFBundleVersion)`. `openSettings` → `UIApplication.openSettingsURLString`. `openUrl` accepts only `https` URLs, opens with `UIApplication.shared.open`. Keychain items survive uninstall, so on the first launch after an install (no `UserDefaults` flag `mesaas.installed`) delete every item of the service, then set the flag: reinstalling must not restore a session.
- [ ] **Step 2: Register** in `MainViewController.capacitorDidLoad()`: `bridge?.registerPluginInstance(MesaasNativePlugin())`, and make `SceneDelegate` show `MainViewController()`. If Task 8 finds a cold-start tap is lost, forward `connectionOptions.notificationResponse` from `SceneDelegate` to the push plugin.
- [ ] **Step 3: APNs forwarding** in `AppDelegate`: `didRegisterForRemoteNotificationsWithDeviceToken` posts `.capacitorDidRegisterForRemoteNotifications` with the token; `didFailToRegisterForRemoteNotificationsWithError` posts `.capacitorDidFailToRegisterForRemoteNotifications`.
- [ ] **Step 4: Entitlements** file with `aps-environment = development` (an App Store distribution export rewrites it to `production`).
- [ ] **Step 5: Config.** `plugins.PushNotifications.presentationOptions = ['badge', 'sound', 'banner', 'list']` (`alert` is deprecated in 8.1.3). Then `npm run sync -w apps/mobile` and confirm `Package.swift` gained `CapacitorPushNotifications`.
- [ ] **Step 6: Build.** `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/mobile/ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build` → `BUILD SUCCEEDED`. Then run it in the Simulator against `http://localhost:5173` and in Safari's Web Inspector check `window.Capacitor.PluginHeaders.some(h => h.name === 'MesaasNative')` → `true`, and that a link long-press shows no preview (the shell polish now applies).
- [ ] **Step 7: Commit** `feat(mobile): plugin MesaasNative (Keychain, ambiente APNs) e registro de push`.

### Task 3: Supabase session in the Keychain (D2)

**Files:**
- Create: `apps/crm/src/native/authStorage.ts`
- Modify: `apps/crm/src/lib/supabase.ts:14`, `apps/crm/src/App.tsx:38-45`
- Test: `apps/crm/src/native/__tests__/authStorage.test.ts`

**Interfaces:**
- Consumes: `isNativeApp`, `getMesaasNative`, `MesaasNativePlugin` (Task 1).
- Produces: `createNativeAuthStorage(getKeychain: () => Pick<MesaasNativePlugin, 'keychainGet' | 'keychainSet' | 'keychainRemove'> | null, legacy: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> }`

Behaviour: `getKeychain()` returning `null` (or throwing) means every call goes to `legacy`. `getItem` returns the Keychain value; when that is `null` and `legacy` has one, copy it into the Keychain, remove it from `legacy` **only after `keychainSet` resolved**, and return it. `setItem` writes the Keychain and removes the `legacy` key; if the Keychain write rejects, write `legacy` instead. `removeItem` clears both. No method ever rejects.

- [ ] **Step 1: Failing tests**, one per behaviour: `falls back to localStorage when the plugin is missing`; `migrates an existing localStorage session on first read` (Keychain then holds it, `legacy.getItem` → null); `keeps the localStorage copy when the migration's keychainSet rejects`; `prefers the Keychain over a stale localStorage value`; `setItem removes the localStorage copy`; `setItem falls back to localStorage when the Keychain rejects`; `removeItem clears both`; `getItem resolves null instead of rejecting when keychainGet rejects`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**, then in `lib/supabase.ts`: `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, isNativeApp() ? { auth: { storage: createNativeAuthStorage(getMesaasNative, window.localStorage) } } : undefined)`. The web keeps today's defaults. Also `App.tsx:38-45` (warms the shell chunk when a `sb-*` key exists in `localStorage`): add `|| isNativeApp()`, since the Keychain build removes that key.
- [ ] **Step 4: Run** the tests and `npx tsc -p apps/crm/tsconfig.json --noEmit` → PASS.
- [ ] **Step 5: Commit** `feat(native): sessão do Supabase no Keychain do iOS`.

### Task 4: Routes, redirects, login and nav in the app (D1, part 1)

**Files:**
- Create: `apps/crm/src/native/blockedPaths.ts`, `apps/crm/src/native/useNativePathGuard.ts`
- Modify: `apps/crm/src/App.tsx` (call the guard in the component that renders the routes), `components/layout/ProtectedRoute.tsx:30,125-135`, `components/layout/useTrialOfferRedirect.ts`, `pages/login/LoginPage.tsx` (`initialTab` :60-63, `tabItems` :245-248, logo :256, post-login `/comecar` :119/:155), `pages/workspace-setup/WorkspaceSetupPage.tsx:54`, `pages/configuracao/configTabs.ts:142-147`, `components/layout/nav-data.ts:120,210-224,409`, `components/layout/MobileNav.tsx:262`, `pages/not-found/NotFoundPage.tsx:28`, `components/layout/GlobalPopupHost.tsx:154-170`, `components/layout/GlobalBannerContainer.tsx:78-125`
- Test: `apps/crm/src/native/__tests__/blockedPaths.test.ts`, `useNativePathGuard.test.tsx`, and new cases in the existing tests of `LoginPage`, `ProtectedRoute`/`useTrialOfferRedirect`, `configTabs` and `GlobalPopupHost`

**Interfaces:**
- Consumes: `isNativeApp`, `getMesaasNative` (Task 1).
- Produces: `isBlockedInNativeApp(pathOrUrl: string): boolean`; `useNativePathGuard(): void`.

Blocked (prefix match on the pathname; an absolute URL counts only when its host is `www.mesaas.com.br` or `mesaas.com.br`): `/` exactly, `/precos`, `/comecar`, `/configuracao/cobranca`, `/sobre`, `/aprovacao-de-post`, `/portal-do-cliente`, `/agente-de-conteudo-ia`, `/afiliados`, `/blog`, `/novidades`. Not blocked: `/politica-de-privacidade`, `/termos-de-uso`, `/lgpd` (App Review wants the privacy policy reachable), but inside the app the nav opens them with `MesaasNative.openUrl` on `https://www.mesaas.com.br/...` so the marketing chrome never renders in the web view.

- [ ] **Step 1: Failing tests.**
  - `isBlockedInNativeApp`: `'/'`, `'/precos'`, `'/comecar?plan=pro'`, `'/configuracao/cobranca'`, `'/blog/x'`, `'https://www.mesaas.com.br/precos'` → true. `'/dashboard'`, `'/configuracao/notificacoes'`, `'/politica-de-privacidade'`, `'https://example.com/precos'` → false.
  - Guard: native + at `/precos` → `navigate('/dashboard', { replace: true })`; web → no call.
  - Trial redirect: native → never redirects to `/comecar`.
  - Login: native → no "Criar Conta" tab, `?tab=register` still opens login, logo not a link.
  - `cobranca` absent from the visible config tabs when native.
  - Popup: native + `cta_url` `/precos` → popup not rendered. Banner: native + markdown body linking `https://www.mesaas.com.br/precos` → banner not rendered.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** The guard is a `useEffect` on `location.pathname` (never a render branch: `/` is prerendered and hydrated). Native-only branches elsewhere may be render-time (those pages are not hydrated). Nav: drop `showLockedWhenGated` items, the Novidades item, and route Privacidade through `openUrl`. Popups and banners: when native, hide the whole popup or banner if its CTA or any inline link `isBlockedInNativeApp` (its text would still sell).
- [ ] **Step 4: Run** the tests, `npx tsc -p apps/crm/tsconfig.json --noEmit`, and `npm run test -- cssSplitBoundary` → PASS.
- [ ] **Step 5: Commit** `feat(native): app sem cadastro, preços e cobrança (rotas e login)`.

### Task 5: Paywalls, upgrade CTAs and upsell copy in the app (D1, part 2)

**Files:**
- Modify (choke points): `components/paywall/UpgradeLockedScreen.tsx`, `components/paywall/FeatureGate.tsx`, `lib/entitlement-toast.tsx:30-43`, `components/usage/UsageMeter.tsx:77-90`, `components/entity-list-phone/PhoneUsageLine.tsx:50-55`, `components/billing/TrialNudgeCard.tsx`, `components/billing/DunningBanner.tsx`, `pages/analytics-conta/AnalyticsStateCards.tsx:40-70`
- Modify (one-offs): `pages/analytics-conta/{google/GoogleAnalyticsTab.tsx:187, google/GoogleAnalyticsTabPhone.tsx:77, youtube/YouTubeAnalyticsTabPhone.tsx:106, tiktok/TikTokAnalyticsTab.tsx:154, tiktok/TikTokAnalyticsTabPhone.tsx:129,489,695}`, `pages/cliente-detalhe/hub/AcessoPage.tsx:305-318,565-580`, `pages/clientes/phone/ClientesPhone.tsx:196-206`, `pages/leads/phone/LeadsPhone.tsx:196-206`, `pages/analytics-fluxos/AnalyticsFluxosPage.tsx:205,316`, `pages/equipe/InviteSection.tsx:264,286`, `pages/arquivos/ArquivosPage.tsx:309,335`, `pages/ajuda/categoryConfig.ts:15`
- Modify (copy): `packages/i18n/locales/{pt,en}/common.json` (the whole `native.*` table above, including the push keys Task 7 uses)
- Modify: `apps/mobile/DECISIONS.md` (new D33: in-app copy never mentions plans, purchases or the website, superseding D5's "Gerencie seu plano pelo site")
- Test: new native cases in each choke point's existing test file

**Interfaces:**
- Consumes: `isNativeApp` (Task 1).

Rules when native: `UpgradeLockedScreen` shows `native.lockedTitle` + `native.lockedBody`, no button. `FeatureGate` drops its upgrade button and uses `native.lockedBody`. `handleEntitlementMutationError` shows the error toast without `action`. `UsageMeter` and `PhoneUsageLine` never render the upgrade link (inside the component, not at the 9 call sites). `TrialNudgeCard` and `DunningBanner` return `null`. `LockedCard` and every raw `<Link to={BILLING_PATH}>` render no link. The AcessoPage portal upsell and the locked "Importar CSV" items are hidden. The upsell sentences (seats full, copy quota, analytics-fluxos) switch to `native.limitBody`. The "Cobrança & Plano" help category is filtered out. `reportPaywallHit` keeps firing (signal only).

- [ ] **Step 1: Failing tests**, at least: `UpgradeLockedScreen` native → no button, text `native.lockedTitle`; `FeatureGate` native → no upgrade button; entitlement toast native → no action; `UsageMeter` with `showUpgradeCta` + native → no link; `TrialNudgeCard`/`DunningBanner` native → render nothing; a source-scan test that every non-test file under `apps/crm/src` containing `BILLING_PATH` or the literals `'/configuracao/cobranca'`, `'/comecar'` or `'/precos'` also imports `isNativeApp`, so a future CTA can't silently ship in the app. Allowlist (public-only, or behind Task 4's guard): `configTabs.ts`, `CobrancaPage.tsx`, `CobrancaPhone.tsx`, `blockedPaths.ts`, `pages/analytics-conta/tiktok/tiktokTabFormat.ts` (re-export), `pages/landing/**`, `pages/precos/**`, `pages/comecar/**`, `pages/blog/**`, `pages/marketing/**`, `content/**`, and the files Task 4 gates (`LoginPage.tsx`, `ProtectedRoute.tsx`, `useTrialOfferRedirect.ts`, `WorkspaceSetupPage.tsx`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the changed suites, `notification-catalog.i18n.test.ts`-style key parity (both locales), and the CRM `tsc` → PASS.
- [ ] **Step 5: Commit** `feat(native): paywalls sem upgrade dentro do app`.

### Task 6: Push prefs ("Celular" column) and the linha editorial CHECK

**Files:**
- Create: `supabase/migrations/20261121000001_push_prefs_linha_editorial.sql`
- Modify: `apps/crm/src/lib/notification-catalog.ts` (`pushEligible` per entry + `isPushEligibleType`), `apps/crm/src/store/notificationPrefs.ts`, `pages/configuracao/tabs/notificacoes/useSuasNotificacoes.ts`, `SuasNotificacoesSection.tsx`, `tabs/phone/NotificacoesPhone.tsx`, `packages/i18n/locales/{pt,en}/settings.json`
- Test: `apps/crm/src/lib/__tests__/notification-catalog.push-parity.test.ts`, existing tests of the two prefs UIs

**Interfaces:**
- Produces: `getNotificationPushPrefs(): Promise<Record<string, boolean>>`, `setNotificationPushPref(type: NotificationPushType | typeof MASTER_PAUSE_TYPE, enabled: boolean): Promise<void>` (table `notification_push_prefs`, same shape as the e-mail pair), `hasActivePushDevice(): Promise<boolean>` (`push_devices` own rows with `disabled_at is null`, `limit 1`), `isPushEligibleType(type: string): type is NotificationPushType`, and from `useSuasNotificacoes`: `pushPrefs`, `pushPaused`, `savePush`, `pushVisible` (`isNativeApp() || hasActivePushDevice`).

- [ ] **Step 1: Migration.** Drop and re-add `notification_push_prefs_type_check` with the 20261015000001 list plus `'linha_editorial_aprovada','linha_editorial_ajustes'` (the claim allowlist since 20261120000001). Header comment says why.
- [ ] **Step 2: Failing tests.** Parity: the set of catalog types with `pushEligible: true` equals the type array parsed from `claim_notification_pushes` in `supabase/migrations/20261120000001_push_acesso_por_cliente.sql`, and every one of them appears in the new CHECK (read the files from disk). Desktop section: with `pushVisible` the header row reads `Sino`, `E-mail`, `Celular`, a non-eligible type shows `·` in the Celular column, and toggling calls `setNotificationPushPref`. Without `pushVisible` → two columns only. Phone: the channel switcher gains `Celular` only when `pushVisible`.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement** (copy `inApp` → "Sino" in pt; matching en). **Step 5: Run** → PASS.
- [ ] **Step 6: Commit** `feat(notificacoes): coluna Celular nas preferências`.

### Task 7: Push registration, pre-prompt, tap routing, unregister (D3)

**Files:**
- Create: `apps/crm/src/native/push.ts`, `NativeBridge.tsx`, `PushPrePromptSheet.tsx`, `PushPermissionRow.tsx`
- Modify: `components/layout/AppLayout.tsx` (render `<NativeBridge />` when `isNativeApp()`), `context/AuthContext.tsx:1070-1101` (unregister before `supabaseSignOut`), the two prefs UIs (render `<PushPermissionRow />` above the table when native). Copy keys come from Task 5.
- Test: `apps/crm/src/native/__tests__/push.test.ts`, `NativeBridge.test.tsx`, an AuthContext sign-out case

**Interfaces:**
- Consumes: `getMesaasNative` (keychain key `mesaas.pushToken`, `deviceInfo`, `openSettings`), `markNotificationAsRead(id)` (`store/notifications.ts:85`), RPCs `register_push_device(p_token, p_platform, p_environment, p_app_version)` and `unregister_push_device(p_token)`.
- Produces:
  - `getPushPermission(): Promise<'granted' | 'denied' | 'prompt'>`
  - `enableNativePush(): Promise<'granted' | 'denied'>`: request permission and, if granted, `PushNotifications.register()`
  - `syncNativePush(): Promise<void>`: on every launch and every user change, first, if the Keychain holds `mesaas.pushToken`, call `register_push_device` with it for the current user **regardless of permission** (moves a token a previous user left behind); then, if permission is granted, `register()` (refreshes the token and `last_seen_at`). Listeners are attached before any `register()` (the `registration` event is not retained)
  - `onRegistration(token: string): Promise<void>`: save to the Keychain, call `register_push_device` with `p_platform: 'ios'`, `p_environment`/`p_app_version` from `deviceInfo()`
  - `unregisterNativePush(): Promise<void>`: read the token, call `unregister_push_device`, and remove the Keychain key **only if the RPC succeeded** (so the next login can still move it); never rejects; AuthContext awaits it with a 3 s timeout
  - `handlePushTap(data: { link?: unknown; notification_id?: unknown }, deps: { navigate(path: string): void; markRead(id: string): Promise<void>; refreshNotifications(): void }): void`: marks read then calls `refreshNotifications` (NativeBridge passes an invalidation of the bell's TanStack queries); navigates only to a single-`/` path that is not `'/'` and not `isBlockedInNativeApp` (the renderer defaults a missing link to `'/'`)
  - `shouldShowPrePrompt(permission: 'granted' | 'denied' | 'prompt', snoozedUntil: number | null, now: number): boolean`; snooze key `mesaas.pushPrePrompt.snoozedUntil` in `localStorage`, 7 days

- [ ] **Step 1: Failing tests.**
  - `handlePushTap`: `{ link: '/entregas?post=1', notification_id: 'n1' }` → `markRead('n1')`, `refreshNotifications()` and `navigate('/entregas?post=1')`. `{ link: null, notification_id: null }` → neither. `{ link: '/' }` and `{ link: '/precos' }` → no navigate. `'//evil.com'`, `'https://evil.com'`, `'javascript:x'` → no navigate. A `markRead` rejection doesn't throw.
  - `shouldShowPrePrompt`: `'denied'` → false; `'granted'` → false; `'prompt'` with a future snooze → false; `'prompt'` with no or past snooze → true.
  - `onRegistration` calls the RPC with `p_environment: 'sandbox'` when `deviceInfo` says sandbox.
  - `unregisterNativePush` resolves when the RPC rejects and keeps the Keychain token.
  - `syncNativePush` with a stored token and permission `'prompt'` still calls `register_push_device` with that token and never calls `register()`; with `'granted'` the listeners are added before `register()`.
  - Sign-out: native → `unregisterNativePush` runs before `supabase.auth.signOut`; a hung unregister doesn't block sign-out past the timeout.
  - `NativeBridge`: adds the three listeners once per mount and removes them on unmount; user change re-runs `syncNativePush`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** The `PushNotifications` import is dynamic inside `push.ts` functions. The pre-prompt is a bottom sheet on the kit's `Dialog` (D28 renders it as a sheet below 768px). `PushPermissionRow` shows `pushOffTitle` with `pushOffEnable` (`'prompt'`) or `pushOffSettings` (`'denied'` → `openSettings()`), and hides when `'granted'`. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(native): registro de push, pré-pergunta e toque na notificação`.

### Task 7b: Devices follow their session (added after a security review of Task 7)

**Files:** Create `supabase/migrations/20261121000002_push_devices_session.sql`, `supabase/tests/entitlements/105_push_devices_session.sql`.

`push_devices.session_id` is set by `register_push_device` from `auth.jwt() ->> 'session_id'`; an `AFTER DELETE` trigger on `auth.sessions` disables that session's devices. Covers sign-outs the app could not report (timeout, offline unregister failure, password reset, revoked or expired session). The claim and the cron already skip disabled devices, so neither changes. Fully offline logout stays uncovered (documented in the migration). Gate: CI `entitlement-tests`.

### Task 8: End-to-end check in the Simulator, gates, PR

- [ ] **Step 1: Gates.** `npm run lint`, `npm run format:check`, the five `tsc` commands, `npm run test`, `npm run check:functions`, and `npm run build && npm run prerender` (landing still has `data-ssr="landing"`).
- [ ] **Step 2: Simulator** with `MESAAS_APP_URL=http://localhost:5173 npm run sync -w apps/mobile` and `npm run dev:env`.
  - Log in. Kill and relaunch the app: still logged in, and `localStorage` has no `sb-*-auth-token` (Keychain only).
  - Pre-prompt appears, "Ativar notificações" → iOS dialog → a `push_devices` row with `environment = 'sandbox'` for the test user (read-only query on prod, since dev:env talks to prod; use the user's own account).
  - Web Inspector: `window.Capacitor.PluginHeaders.some(h => h.name === 'MesaasNative')` → `true`.
  - Delete and reinstall the app: it opens on login (Keychain wiped on first launch).
  - `xcrun simctl push booted br.com.mesaas.app payload.json`, once with the app in the background and once with it **killed**, with `{"aps":{"alert":{"title":"t"}},"link":"/entregas","notification_id":"<a real unread id>"}` → tapping opens Entregas and the bell count drops by one.
  - `/precos`, `/comecar` and `/configuracao/cobranca` typed into the URL redirect to the dashboard. Login has no "Criar Conta". A Free-plan feature shows the neutral locked screen.
  - Logout removes the `push_devices` row.
  - Mobile Safari at the same URL still shows sign-up and billing (web unchanged).
- [ ] **Step 3: Rebuild** the Simulator against production (`npm run sync -w apps/mobile` without `MESAAS_APP_URL`) so the committed `capacitor.config` state is the release one.
- [ ] **Step 4: PR** to `main`. The description states push delivery is unverified until the `APNS_*` secrets exist, and gives the deploy order: migrations `20261121000001` and `20261121000002` (staging, then prod) → merge.
