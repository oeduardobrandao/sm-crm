# PostEditor: BubbleMenu & Text Colors

## Summary

Improve the PostEditor component with two features:
1. A floating BubbleMenu toolbar that appears on text selection, replacing the fixed top bar for inline formatting
2. Notion-like text color and background highlight options with a muted 8-color palette that adapts to light/dark mode

## Motivation

The current fixed toolbar requires users to scroll up to format text in long posts. Moving inline formatting into a BubbleMenu solves this by placing tools right where the user is working. Adding text color and highlights gives users more expressive control over post content.

## Design

### BubbleMenu (floating toolbar on text selection)

When the user selects text, a floating toolbar appears above the selection:

```
[ B ] [ I ] [ U ] [ Link ] [ | ] [ A▾ text color ] [ A▾ highlight ]
```

- **Bold, Italic, Underline, Link** — same functionality as current toolbar, relocated to the bubble
- **Text Color button** — an "A" icon with a colored underline showing the current color. Click opens a color dropdown
- **Highlight button** — an icon with a background-colored indicator. Click opens a highlight dropdown
- **Link popover** — same inline input behavior as today, positioned relative to the bubble menu
- TipTap's BubbleMenu handles auto-positioning above the selection

### Fixed top bar (simplified)

The top bar retains only block-level controls and metadata:

```
[ ≡ bullet list ] [ 1. ordered list ]                    2755 / 2200
```

These are block-level operations that don't require text selection, plus the character count.

### Color palette

8 colors with separate text and highlight variants for light and dark mode:

| Color  | Light text | Dark text | Light highlight bg | Dark highlight bg |
|--------|-----------|-----------|-------------------|------------------|
| Gray   | `#787774` | `#9B9A97` | `#E3E2E0`         | `#373737`         |
| Brown  | `#9F6B53` | `#BA856F` | `#EEE0DA`         | `#4C3228`         |
| Orange | `#D9730D` | `#E78A3D` | `#FADEC9`         | `#5C3B1E`         |
| Yellow | `#CB912F` | `#DFB342` | `#FBF3DB`         | `#564328`         |
| Green  | `#448361` | `#5B9E7C` | `#DBEDDB`         | `#2B4632`         |
| Blue   | `#337EA9` | `#5B9BD5` | `#D3E5EF`         | `#28456C`         |
| Purple | `#9065B0` | `#A882C9` | `#E8DEEE`         | `#412F5A`         |
| Pink   | `#C14C8A` | `#D46FA8` | `#F4DFEB`         | `#5C2746`         |

Plus **"Default"** (resets to inherit) for text color and **"None"** (removes highlight) for background.

### Color dropdown UI

Each color button opens a small popover with:
- A label: "Cor do texto" or "Cor de fundo"
- A grid of circular swatches: 8 colors + default/none, arranged in a row or compact grid
- Each swatch is ~20px diameter with a subtle border
- Active color shows a checkmark overlay
- Clicking a swatch applies immediately and closes the dropdown
- Clicking outside closes the dropdown

### Dark mode rendering

Text colors and highlight backgrounds use CSS custom properties scoped to `[data-theme="dark"]` so that stored color values map to appropriate dark-mode tones. Since TipTap stores inline styles with literal color values, we use the light-mode text colors as canonical values and override highlight backgrounds via CSS attribute selectors in dark mode.

For highlights, we configure TipTap's Highlight extension to use `data-color` attributes instead of inline styles, so dark mode can remap via CSS.

For text colors, TipTap Color extension applies inline `color` styles. These light-mode values are readable in dark mode (they're muted tones), so they work as-is. The dark-mode text variants are used only in the swatch UI to preview how the color looks in dark mode.

## Technical details

### New npm dependencies

- `@tiptap/extension-color` — `setColor()` / `unsetColor()` commands
- `@tiptap/extension-text-style` — required peer dependency for Color
- `@tiptap/extension-highlight` — `setHighlight()` / `unsetHighlight()`, configured with `multicolor: true`

### Existing dependencies (no install needed)

- `BubbleMenu` from `@tiptap/react/menus` — already available via `@tiptap/react`

### Files to modify

1. **`apps/crm/src/pages/entregas/components/PostEditor.tsx`**
   - Add BubbleMenu with inline formatting buttons (bold, italic, underline, link)
   - Add color and highlight dropdown buttons in the BubbleMenu
   - Remove inline formatting buttons from the fixed top bar (keep only lists + char count)
   - Register Color, TextStyle, and Highlight extensions on the editor
   - Add state management for color/highlight dropdown visibility

2. **`apps/crm/style.css`**
   - Add `.bubble-menu` styles (dark surface, rounded corners, shadow, flex layout)
   - Add `.color-dropdown` styles (popover with swatch grid)
   - Add `.color-swatch` styles (circular buttons with checkmark)
   - Simplify `.post-editor-toolbar` (fewer items)
   - Add ProseMirror content styles for `mark[data-color]` highlight rendering
   - Add `[data-theme="dark"]` overrides for highlight background colors

### Color constants

Define the palette as a TypeScript constant array in PostEditor.tsx:

```ts
const TEXT_COLORS = [
  { name: 'Padrão', color: null },
  { name: 'Cinza', color: '#787774' },
  { name: 'Marrom', color: '#9F6B53' },
  { name: 'Laranja', color: '#D9730D' },
  { name: 'Amarelo', color: '#CB912F' },
  { name: 'Verde', color: '#448361' },
  { name: 'Azul', color: '#337EA9' },
  { name: 'Roxo', color: '#9065B0' },
  { name: 'Rosa', color: '#C14C8A' },
];

const HIGHLIGHT_COLORS = [
  { name: 'Nenhum', color: null },
  { name: 'Cinza', color: '#E3E2E0', darkColor: '#373737' },
  { name: 'Marrom', color: '#EEE0DA', darkColor: '#4C3228' },
  { name: 'Laranja', color: '#FADEC9', darkColor: '#5C3B1E' },
  { name: 'Amarelo', color: '#FBF3DB', darkColor: '#564328' },
  { name: 'Verde', color: '#DBEDDB', darkColor: '#2B4632' },
  { name: 'Azul', color: '#D3E5EF', darkColor: '#28456C' },
  { name: 'Roxo', color: '#E8DEEE', darkColor: '#412F5A' },
  { name: 'Rosa', color: '#F4DFEB', darkColor: '#5C2746' },
];
```

### Highlight dark mode strategy

Configure Highlight extension with `HTMLAttributes` that add a `data-highlight-color` attribute. In CSS, use `[data-theme="dark"] mark[data-highlight-color="..."]` selectors to override the inline background-color with the dark variant. This keeps ProseMirror content portable while supporting theme switching.

## Testing

- Verify BubbleMenu appears on text selection and disappears on deselection
- Verify all inline formatting buttons work in the BubbleMenu
- Verify text color applies and renders correctly in both light and dark mode
- Verify highlight applies and renders correctly in both light and dark mode
- Verify color dropdowns open/close properly and show checkmark on active color
- Verify link popover still works from the BubbleMenu
- Verify fixed top bar only shows lists + char count
- Verify disabled/readonly mode hides the BubbleMenu
- Run `npm run build` to typecheck
- Run `npm run test` to verify no regressions
