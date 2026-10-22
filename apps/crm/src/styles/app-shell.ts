// Styles only the authenticated shell renders, imported (side effect) by ProtectedRoute alone so
// they ride its lazy chunk instead of the entry's render-blocking stylesheet, which the public
// landing pages download. Vite's preload helper waits for this CSS before the chunk's module
// runs, so the shell never paints unstyled.
//
// Phosphor icon font, self-hosted (was the unpkg loader in index.html). Only the three weights
// the app uses; the fonts get hashed /assets/ names and load on first use.
import '@phosphor-icons/web/regular';
import '@phosphor-icons/web/bold';
import '@phosphor-icons/web/fill';
// App-only rules split out of style.css (core stays in the entry).
import '../../app.css';
// Vidro look: every rule is scoped to html[data-look="vidro"], which only signed-in desktop
// users get. Same order they had in main.tsx; vidroContracts pins it.
import './vidro.css';
import './vidro-body/tokens.css';
import './vidro-body/buttons.css';
import './vidro-body/tables.css';
import './vidro-body/cards.css';
import './vidro-body/badges.css';
import './vidro-body/forms.css';
import './vidro-body/controls.css';
import './vidro-body/boards.css';
import './vidro-body/overlays.css';
import './vidro-body/chat.css';
import './vidro-body/compositions.css';
