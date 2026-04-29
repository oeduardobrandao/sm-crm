# i18n Language Toggle — Design Spec

## Overview

Add internationalization (i18n) infrastructure to the Mesaas CRM and Hub apps, with a language toggle allowing users to switch between Portuguese (default) and English. The system is designed to scale to additional languages in the future.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| i18n library | `react-i18next` + `i18next` | Battle-tested, namespace lazy-loading, pluralization, React 19 support |
| Language persistence | `localStorage` (both apps) | Simple, no DB migration needed, consistent across CRM and Hub |
| Translation rollout | Incremental with fallback | Untranslated strings fall back to Portuguese seamlessly |
| Toggle visibility | Always visible | No feature flag gating; fallback behavior handles partial translations gracefully |
| Toggle UI (CRM) | Flag-based selector in sidebar user dropdown | Own "Idioma" section with country flags and checkmark, scales to 3+ languages |
| Toggle UI (Hub) | Inline flag selector in HubShell header | Hub has no sidebar dropdown; HubShell wraps all pages |
| Implementation scope | Phase 1 (infrastructure) + Phase 2 (core CRM pages) | Delivers a usable English experience on high-traffic pages |

## Architecture

### Package Structure

New shared workspace package at `packages/i18n/`:

```
packages/i18n/
├── package.json              # @mesaas/i18n workspace package
├── index.ts                  # initI18n() function + re-exports
├── locales/
│   ├── pt/
│   │   ├── common.json       # Nav, buttons, status labels, months, days
│   │   ├── dashboard.json
│   │   ├── leads.json
│   │   ├── clients.json
│   │   ├── posts.json
│   │   └── hub.json
│   └── en/
│       ├── common.json
│       ├── dashboard.json
│       ├── leads.json
│       ├── clients.json
│       ├── posts.json
│       └── hub.json
```

### i18n Initialization

```ts
// packages/i18n/index.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

interface InitOptions {
  namespaces?: string[];
}

export function initI18n(options?: InitOptions) {
  const savedLang = localStorage.getItem('mesaas-language') || 'pt';
  const ns = options?.namespaces || ['common'];

  i18n.use(initReactI18next).init({
    lng: savedLang,
    fallbackLng: 'pt',
    defaultNS: 'common',
    ns,
    interpolation: { escapeValue: false },
    resources: {
      pt: { /* loaded namespaces */ },
      en: { /* loaded namespaces */ },
    },
  });

  return i18n;
}

export { i18n };
```

Both apps call `initI18n()` as a side-effect import in their `main.tsx` before rendering. No provider component needed — `react-i18next` uses React context internally after `i18n.use(initReactI18next)`.

For Phases 1+2, all translation namespaces are loaded statically via `resources` in `init()`. This is fine for the current namespace count (~6 files per language). Lazy loading via `i18next-http-backend` can be added in future phases if the namespace count grows significantly.

### localStorage Key

`mesaas-language` — shared between CRM and Hub. If a user visits both on the same browser, their preference carries over. Values: `'pt'` | `'en'`.

## Language Toggle UI

### CRM — Sidebar User Dropdown

Added as a new "Idioma" section in the existing user menu popover (in `Sidebar.tsx`), between the config items and the theme toggle:

```
┌─────────────────────────┐
│ OPÇÕES DA CONTA         │
├─────────────────────────┤
│ ⚙ Configurações        │
│ 🔒 Privacidade          │
├─────────────────────────┤
│ IDIOMA                  │
│ 🇧🇷 Português     ✓    │
│ 🇺🇸 English             │
├─────────────────────────┤
│ 🌙 Modo Escuro          │
│ 🚪 Sair                 │
└─────────────────────────┘
```

Clicking a language option calls `i18n.changeLanguage(lang)` and saves to `localStorage`. The UI re-renders immediately — no page reload needed (react-i18next triggers re-renders via its internal context).

### Hub — HubShell Header

A compact inline language selector in the Hub shell header. Same flag + checkmark pattern but rendered inline since the Hub has no dropdown menu infrastructure.

## React Integration Patterns

### Basic usage in components

```tsx
const { t } = useTranslation('leads');
<h1>{t('title')}</h1>
<button>{t('newLead')}</button>
toast.success(t('createSuccess'));
```

### Constant maps (status labels, etc.)

Status label maps are very common in the codebase. Instead of defining them as constants with hardcoded Portuguese, translate at render time:

```tsx
const { t } = useTranslation('leads');
const getStatusLabel = (status: string) => t(`status.${status}`);
```

### Zod validation schemas

Zod schemas are defined outside React components. They need a factory function that receives the `t` function:

```tsx
const createLeadSchema = (t: TFunction) => z.object({
  nome: z.string().min(1, t('validation.nameRequired')),
});

// Inside component:
const { t } = useTranslation('leads');
const schema = useMemo(() => createLeadSchema(t), [t]);
```

### Date formatting

Replace hardcoded `ptBR` locale with dynamic locale based on current language:

```tsx
import { ptBR, enUS } from 'date-fns/locale';

const DATE_LOCALES = { pt: ptBR, en: enUS };
const { i18n } = useTranslation();
format(date, 'PPP', { locale: DATE_LOCALES[i18n.language] });
```

### Pluralization

Uses i18next's built-in plural rules:

```json
{
  "leadCount": "{{count}} lead",
  "leadCount_other": "{{count}} leads"
}
```

```tsx
t('leadCount', { count: 5 }); // "5 leads"
```

### Interpolation

```json
{ "greeting": "Olá, {{name}}" }
```
```tsx
t('greeting', { name: user.firstName }); // "Olá, Eduardo"
```

## Translation Key Conventions

- **Flat, camelCase keys** within namespace JSON files
- `status.*` — status label maps
- `validation.*` — form validation messages
- `table.*` — table column headers
- `form.*` — form labels and placeholders
- Descriptive names for toasts: `createSuccess`, `deleteError`, `updateSuccess`
- Interpolation: `{{variable}}` syntax
- Plurals: `key` (singular) + `key_other` (plural)

Example namespace file:
```json
{
  "title": "Leads",
  "newLead": "Novo Lead",
  "importCsv": "Importar CSV",
  "createSuccess": "Lead criado com sucesso",
  "deleteConfirm": "Tem certeza que deseja excluir este lead?",
  "status.novo": "Novo",
  "status.contatado": "Contatado",
  "status.qualificado": "Qualificado",
  "validation.nameRequired": "Nome é obrigatório",
  "table.name": "Nome",
  "table.status": "Status",
  "table.canal": "Canal"
}
```

## Implementation Scope

### Phase 1 — Infrastructure + Core

- Install `i18next` + `react-i18next` at root workspace
- Create `packages/i18n/` shared package with `initI18n()`
- Create `common.json` for both `pt` and `en` (nav labels, generic buttons, months, days, status labels)
- Wire `initI18n()` into CRM `main.tsx` and Hub `main.tsx`
- Add language toggle to CRM sidebar user dropdown
- Add language toggle to Hub shell header
- Translate Sidebar and layout strings

### Phase 2 — High-Traffic CRM Pages

- Dashboard page
- Clients list + client detail page
- Leads page
- Posts / Express Post pages

Each page: extract all hardcoded Portuguese strings into namespace JSON files, create corresponding English translations, replace inline strings with `t()` calls.

### Future Phases (out of scope)

- Phase 3: Remaining CRM pages (Financeiro, Contratos, Equipe, Configurações, Calendar)
- Phase 4: Hub pages (Home, Aprovações, Postagens, Marca, Páginas, Briefing, Ideias)

## Edge Cases

- **Partial translation:** Untranslated English keys fall back to Portuguese via `fallbackLng: 'pt'`. No broken keys or visual artifacts.
- **First visit:** Defaults to Portuguese (`'pt'`). No browser language detection — the app is Brazilian-first.
- **Hub language sync:** Uses same `mesaas-language` localStorage key as CRM. If a user has set English in CRM and then opens a Hub link in the same browser, Hub will also be in English.
- **date-fns locale:** Must be swapped dynamically wherever date formatting occurs. The `DATE_LOCALES` map handles this.
- **Zod schemas:** Must be wrapped in factory functions to receive the current `t`. Memoized with `useMemo` keyed on `t` to avoid re-creating on every render.
