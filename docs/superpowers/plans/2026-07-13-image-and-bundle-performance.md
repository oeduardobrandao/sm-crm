# Image and Bundle Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop advertising image transformations that do not exist, improve cache reuse and thumbnail loading, and split Hub/Admin page bundles.

**Architecture:** Keep `OptimizedImage` as a truthful loading/placeholder component that requests the original URL only. Canonicalize ignored Worker query parameters, use already-generated thumbnails in small contexts, and dynamically import route pages while retaining each app shell in the initial chunk.

**Tech Stack:** React 19, Vite 6, React Router 7, Cloudflare Workers/R2, Vitest.

## Global Constraints

- Do not claim or emit AVIF/WebP/responsive variants unless the server actually transforms bytes.
- Do not add Cloudflare Images/Image Resizing bindings.
- Keep original media for full-card/lightbox contexts; use `thumbnail_url` only for small previews.
- Only the intended first above-the-fold media may use eager/high priority.
- Preserve year-long immutable R2 caching and range-response behavior.
- Record before/after initial chunk sizes for CRM, Hub, and Admin.
- Every production change starts with a failing focused test.

---

### Task 1: Make `OptimizedImage` Truthful

**Files:**
- Modify: `apps/crm/src/components/OptimizedImage.tsx`
- Modify: `apps/hub/src/components/OptimizedImage.tsx`
- Create: `test/optimized-image-contract.test.tsx`

**Interfaces:**
- Preserves: `src`, `alt`, intrinsic dimensions, `sizes`, `priority`, and `blurDataURL`.
- Removes: `fit`, `buildSrcSet`, `buildFormatSource`, format `<source>` elements, and transform query parameters.

- [ ] **Step 1: Write failing cross-app behavior tests**

```tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OptimizedImage as CrmImage } from "../apps/crm/src/components/OptimizedImage";
import { OptimizedImage as HubImage } from "../apps/hub/src/components/OptimizedImage";

const components = [["CRM", CrmImage], ["Hub", HubImage]] as const;
const signed = "https://media.example/contas/a/photo.jpg?exp=9999999999&sig=abc";

afterEach(() => {
  cleanup();
  document.head.querySelectorAll('link[rel="preload"][as="image"]').forEach((node) => node.remove());
});

describe.each(components)("%s OptimizedImage", (_name, ImageComponent) => {
  it("requests only the original URL", () => {
    const { container } = render(<ImageComponent src={signed} alt="Foto" width={800} height={600} />);
    const img = container.querySelector("img")!;
    expect(container.querySelector("picture")).toBeNull();
    expect(img).not.toHaveAttribute("srcset");
    expect(img.getAttribute("src")).toBe(signed);
    expect(container.innerHTML).not.toContain("&w=");
    expect(container.innerHTML).not.toContain("&f=");
  });

  it("lazy-loads normal images", () => {
    const { getByRole } = render(<ImageComponent src={signed} alt="Foto" />);
    expect(getByRole("img")).toHaveAttribute("loading", "lazy");
    expect(getByRole("img")).toHaveAttribute("decoding", "async");
  });

  it("preloads only priority images and cleans the link on unmount", () => {
    const { unmount } = render(<ImageComponent src={signed} alt="Foto" priority />);
    const link = document.head.querySelector('link[rel="preload"][as="image"]');
    expect(link).toHaveAttribute("href", signed);
    expect(link).not.toHaveAttribute("imagesrcset");
    unmount();
    expect(document.head.querySelector('link[rel="preload"][as="image"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npm run test -- test/optimized-image-contract.test.tsx
```

Expected: FAIL because both components emit `<picture>`, `srcset`, and transformed URLs.

- [ ] **Step 3: Simplify both components**

Remove `DEFAULT_WIDTHS`, proxy detection, source builders, all `useMemo` calls, `fit`, and `<picture>`. Keep the existing blur/loading state and produce one `<img>` with:

```tsx
const imgProps: ImgHTMLAttributes<HTMLImageElement> & Record<string, unknown> = {
  ref: imgRef,
  src,
  alt,
  className,
  style: mergedStyle,
  onLoad: () => setLoaded(true),
  loading: priority ? "eager" : "lazy",
  decoding: priority ? "sync" : "async",
  ...(priority ? { fetchpriority: "high" } : {}),
  ...(width != null ? { width } : {}),
  ...(height != null ? { height } : {}),
  ...(sizes ? { sizes } : {}),
  ...rest,
};

return <img {...imgProps} />;
```

The preload effect sets only `rel`, `as`, `href`, `crossOrigin` in CRM where required, `fetchpriority`, and optional `imagesizes`; it never sets `imagesrcset`.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npm run test -- test/optimized-image-contract.test.tsx
git add apps/crm/src/components/OptimizedImage.tsx apps/hub/src/components/OptimizedImage.tsx test/optimized-image-contract.test.tsx
git commit -m "fix(images): remove unsupported transform sources"
```

---

### Task 2: Canonicalize Ignored Worker Transform Parameters

**Files:**
- Modify: `workers/media-proxy/src/index.ts:120-145`
- Modify: `workers/media-proxy/src/index.test.ts`

**Interfaces:**
- Produces: one cache key for signed URLs differing only by `w`, `f`, or `fit`.
- Preserves: `_origin`, object key, all meaningful query parameters, signatures, range behavior, and CORS.

- [ ] **Step 1: Write the failing cache-equivalence test**

Extend `signedUrl` to accept a query record:

```ts
async function signedUrl(key: string, params: Record<string, string> = {}): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sig = await hmacSign(SIGNING_KEY, `${key}:${exp}`);
  const url = new URL(`https://media.example/${encodeURIComponent(key)}`);
  url.searchParams.set("exp", String(exp));
  url.searchParams.set("sig", sig);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.toString();
}
```

Then add:

```ts
it("shares the original-object cache across ignored transform parameters", async () => {
  const bytes = new Uint8Array(500).fill(9);
  const bucket = makeBucket(bytes, "image/jpeg");
  const first = new Request(await signedUrl("contas/1/photo.jpg", { w: "400", f: "webp" }), {
    headers: { Origin: ORIGIN },
  });
  const second = new Request(await signedUrl("contas/1/photo.jpg", { w: "1200", f: "avif", fit: "cover" }), {
    headers: { Origin: ORIGIN },
  });

  expect((await worker.fetch(first, env(bucket), ctx)).status).toBe(200);
  expect((await worker.fetch(second, env(bucket), ctx)).status).toBe(200);
  expect(bucket.get).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npm test --prefix workers/media-proxy
```

Expected: FAIL with `bucket.get` called twice.

- [ ] **Step 3: Canonicalize the cache URL**

Immediately after deleting `exp` and `sig`, add:

```ts
cacheUrl.searchParams.delete("w");
cacheUrl.searchParams.delete("f");
cacheUrl.searchParams.delete("fit");
```

- [ ] **Step 4: Verify GREEN and commit**

```bash
npm test --prefix workers/media-proxy
git add workers/media-proxy/src/index.ts workers/media-proxy/src/index.test.ts
git commit -m "fix(media): canonicalize original image cache keys"
```

---

### Task 3: Use Existing Thumbnails and Stable Image Attributes

**Files:**
- Modify: `apps/hub/src/components/InstagramGridPreview.tsx`
- Modify: `apps/hub/src/components/PostCard.tsx`
- Modify: `apps/hub/src/components/InstagramPostCard.tsx`
- Modify: `apps/hub/src/components/StoryPostCard.tsx`
- Modify: `apps/hub/src/components/dashboard/TopPostsRow.tsx`
- Modify: `apps/hub/src/pages/IdeiasPage.tsx`
- Modify: `apps/crm/src/pages/arquivos/components/FileGrid.tsx`
- Modify: `apps/crm/src/pages/arquivos/components/FilePickerModal.tsx`
- Modify: `apps/hub/src/components/__tests__/InstagramGridPreview.test.tsx`
- Modify: `apps/hub/src/components/__tests__/TopPostsRow.test.tsx`

**Interfaces:**
- Consumes: existing `thumbnail_url`/`thumbnailUrl` fields.
- Produces: thumbnail-first small previews and lazy/async raw images.

- [ ] **Step 1: Add failing preview assertions**

In `InstagramGridPreview.test.tsx`, create image media with both URLs and assert the tile uses the thumbnail:

```ts
expect(container.querySelector('img[src="https://cdn.example/thumb.webp"]')).not.toBeNull();
expect(container.querySelector('img[src="https://cdn.example/original.jpg"]')).toBeNull();
```

In `TopPostsRow.test.tsx` capture the render container and assert:

```ts
const img = container.querySelector("img")!;
expect(img).toHaveAttribute("loading", "lazy");
expect(img).toHaveAttribute("decoding", "async");
expect(img).toHaveAttribute("width", "1");
expect(img).toHaveAttribute("height", "1");
```

- [ ] **Step 2: Run and verify RED**

```bash
npm run test -- apps/hub/src/components/__tests__/InstagramGridPreview.test.tsx apps/hub/src/components/__tests__/TopPostsRow.test.tsx
```

Expected: thumbnail selection/attribute assertions FAIL.

- [ ] **Step 3: Implement thumbnail-first small contexts**

Change Instagram grid image mapping to:

```ts
thumbnailUrl: firstMedia.thumbnail_url ?? firstMedia.url ?? null,
```

Change the 80px PostCard strip to:

```tsx
<OptimizedImage
  src={m.thumbnail_url ?? m.url}
  alt=""
  width={80}
  height={80}
  blurDataURL={m.blur_data_url ?? undefined}
  className="w-full h-full object-cover"
/>
```

Do not replace original URLs in full card media or lightboxes.

- [ ] **Step 4: Add raw-image loading metadata**

For raw images in the listed files add `loading="lazy"`, `decoding="async"`, and dimensions matching the CSS aspect ratio (`1/1`, `4/5`, or `4/3`). Keep existing first-media `priority` behavior in `InstagramPostCard`; do not add priority elsewhere.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npm run test -- apps/hub/src/components/__tests__/InstagramGridPreview.test.tsx apps/hub/src/components/__tests__/TopPostsRow.test.tsx apps/hub/src/components/__tests__/InstagramPostCard.test.tsx apps/hub/src/components/__tests__/StoryPostCard.test.tsx
git add apps/hub/src apps/crm/src/pages/arquivos
git commit -m "perf(images): use thumbnails for small previews"
```

---

### Task 4: Split Hub/Admin Routes and Reduce CRM Initial Imports

**Files:**
- Modify: `apps/hub/src/router.tsx`
- Modify: `apps/admin/src/router.tsx`
- Modify: `apps/crm/src/components/layout/AppLayout.tsx`
- Modify: `apps/crm/src/context/AuthContext.tsx`
- Modify: `apps/crm/src/hooks/useNotifications.ts`
- Modify: `apps/crm/src/hooks/useBanners.ts`
- Modify: `apps/crm/src/components/layout/GlobalSearchTrigger.tsx`
- Modify: `apps/crm/src/components/layout/GlobalBannerContainer.tsx`
- Modify: `apps/hub/src/__tests__/router.test.tsx`

**Interfaces:**
- Produces: route-level chunks for every Hub/Admin page.
- Preserves: eager Hub/Admin shells, CRM Sentry initialization, route paths, and route exports.

- [ ] **Step 1: Record the current bundle baseline**

Run all three builds and retain their initial chunk lines in the work log. Current audit baseline:

```text
CRM main:   1,225.00 kB minified / 372.54 kB gzip
Hub main:   1,240.72 kB minified / 388.88 kB gzip
Admin main: 1,118.35 kB minified / 333.25 kB gzip
```

- [ ] **Step 2: Keep the existing router tests as the behavior gate**

```bash
npm run test -- apps/hub/src/__tests__/router.test.tsx
```

Expected before refactor: PASS.

- [ ] **Step 3: Convert Hub/Admin page routes to React Router lazy modules**

Remove eager page imports. Define each static path with a lazy function such as:

```tsx
{
  path: "paginas/:pageId",
  lazy: async () => ({ Component: (await import("./pages/PaginaPage")).PaginaPage }),
}
```

For Admin default exports use:

```tsx
{
  path: "workspaces/:id",
  lazy: async () => ({ Component: (await import("./pages/WorkspaceDetailPage")).default }),
}
```

Keep `HubShell`, `AdminLayout`, and `AdminProtectedRoute` eager. Convert every page route, including Hub index/detail/report routes and Admin login/editor routes.

- [ ] **Step 4: Narrow CRM initial imports**

Change runtime imports as follows:

```ts
// AuthContext
import { initStoreRole } from "../store/core";

// useNotifications
import { dismissNotification, getNotifications, getUnreadNotificationCount,
  markAllNotificationsAsRead, markNotificationAsRead, type Notification } from "../store/notifications";

// useBanners and GlobalBannerContainer type
import { getActiveBanners, getDismissedBannerIds, dismissBanner, type GlobalBanner } from "../store/banners";
```

In `GlobalSearchTrigger`, import each function from its owning store module rather than `@/store`. In `AppLayout`, load the banner module with `lazy` and render it inside `<Suspense fallback={null}>`. Do not change `@sentry/react` imports.

- [ ] **Step 5: Verify routes and measure the new chunks**

```bash
npm run test -- apps/hub/src/__tests__/router.test.tsx apps/crm/src/components/layout/__tests__/AppLayout.test.tsx
npm run build
npm run build:hub
npm run build:admin
```

Expected: tests/builds PASS; Hub/Admin emit named page chunks and their initial chunks are smaller than baseline. Record exact before/after numbers for the audit report.

- [ ] **Step 6: Commit**

```bash
git add apps/hub/src/router.tsx apps/admin/src/router.tsx apps/crm/src/components/layout apps/crm/src/context/AuthContext.tsx apps/crm/src/hooks apps/hub/src/__tests__/router.test.tsx
git commit -m "perf(bundle): split hub and admin page routes"
```
