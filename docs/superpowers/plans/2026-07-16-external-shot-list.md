# External screenshots — manual capture shot list

Two Tier-1 support articles walk the reader through screens that live **outside** the Mesaas CRM — Claude's connector UI and Facebook's OAuth consent flow. A Playwright script pointed at `localhost` cannot reach these, so they must be captured by hand. This is exactly where the text fails hardest (e.g. "deixe os campos de OAuth em branco"), so the screenshots matter most here.

**You capture these; I handle upload + authoring.** Drop each PNG at the path listed below (under `e2e/.shots/<slug>/`, which is gitignored), tell me, and I'll run the upload script and fill the matching image slots in the migration. The in-app steps of both articles are captured automatically; only the screens below are manual.

## Capture settings (match the automated shots)

- **Browser window ~1440 wide**, normal zoom. A retina display gives 2× density automatically, matching the in-app captures.
- **Light mode**, if the external app offers a choice.
- Capture the **relevant dialog/screen**, not the whole desktop — a browser-tab screenshot is ideal.
- PNG format.

## Redaction — check every shot before handing it over

Once published, these are visible to every customer. Blur or crop out:

- Your **account email** / avatar (Claude and Facebook both show it).
- Any **workspace name** unrelated to a clean demo.
- Any **API key** — especially a full `mesaas_sk_…` value. If a key is visible, regenerate it afterward so the published one is dead.
- Any **real client / doctor / page name** in a Facebook page picker (your real Instagram/Facebook assets will appear here — this is the highest-risk set).

---

## Article 1 — "Como conectar o Claude (MCP)" · slug `como-conectar-o-claude-mcp`

This article has two ordered lists. The **API-key list** (second `ol`) is all Mesaas screens and is captured automatically. The **connector list** (first `ol`, the recommended method) needs Claude's own UI:

| File to create | Screen | Required state |
|---|---|---|
| `e2e/.shots/como-conectar-o-claude-mcp/ext-01-claude-conectores.png` | Claude → **Configurações → Conectores** | The connectors list, with the **"Adicionar conector personalizado"** button visible. (Step 1) |
| `e2e/.shots/como-conectar-o-claude-mcp/ext-02-conector-oauth-vazio.png` | The **"Adicionar conector personalizado"** dialog | MCP URL pasted into the URL field, and the **OAuth fields visibly EMPTY**. This is the counterintuitive instruction the article can't convey in prose — the empty fields must be clearly readable. (Step 2) |
| `e2e/.shots/como-conectar-o-claude-mcp/ext-03-autorizar-workspace.png` | The **Mesaas authorization screen** (appears after clicking Add, when Claude redirects to Mesaas login → consent) | The workspace selector and the **permission/scope checkboxes**, with the **Autorizar** button visible. (Step 3) |

Notes:
- `ext-03` is technically a Mesaas page (`/oauth/consent`) but only appears mid-flow when Claude drives the OAuth handshake, so it's easiest to grab during a real connect.
- If you'd rather not expose your real MCP URL, a demo/placeholder URL in `ext-02` is fine — the point is the empty OAuth fields, not the URL value.

## Article 2 — "Como conectar o Instagram" · slug `como-conectar-o-instagram`

Steps 1–2 (open client detail → click **Conectar Instagram**) are Mesaas screens, captured automatically. Steps 3–5 are Facebook's:

| File to create | Screen | Required state |
|---|---|---|
| `e2e/.shots/como-conectar-o-instagram/ext-03-facebook-autorizar.png` | **Facebook authorization / consent** screen | The "continuar como…" / permissions grant screen Facebook shows. Redact your name/photo if you prefer. (Step 3) |
| `e2e/.shots/como-conectar-o-instagram/ext-04-selecionar-pagina.png` | Facebook's **linked-page selector** | The list where you pick which Facebook Page / Instagram account to connect — ideally showing more than one option so the "choose the right one" instruction lands. **Redact real page names** if they're not demo assets. (Step 4) |
| `e2e/.shots/como-conectar-o-instagram/ext-05-confirmar-permissoes.png` | Facebook's **permissions confirmation** | The final "you're giving Mesaas access to…" permission list with the confirm button. (Step 5) |

Notes:
- This flow only appears during a **real** Instagram connect, and the OAuth consent screen can't be revisited without disconnecting first. If you have a spare/test Facebook page, connecting that is the safest way to capture clean shots.
- The page picker (`ext-04`) is the single most useful shot in this set — "Se a conta não aparecer…" is a purely visual recognition problem the text can't solve.

---

## After you drop the files

Tell me they're in place. I'll:
1. Run `node --env-file=.env.kb-upload.local scripts/upload-kb-images.mjs` to upload them to the public bucket.
2. Fill the corresponding `NULL` image slots in the article migration (the in-app steps are already imaged; these external steps carry `NULL` until your PNGs land — the `_kb_shot*_ol_shots` helper renders a step with no image gracefully, so the articles are already usable and only get better when these arrive).
