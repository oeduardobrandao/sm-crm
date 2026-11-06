import './landing.css';

// Fraunces/Instrument Sans are only used below the fold (testimonial + Hub mockup). They used to
// be an @import at the top of landing.css, which was harmless while that CSS arrived through JS.
// The prerendered `/` now links the landing CSS from <head> (scripts/seo/prerender.tsx), where
// an @import would chain a render-blocking request to fonts.googleapis.com before first paint.
// So they load as a non-blocking stylesheet instead, once, with whichever page imports this.
const EDITORIAL_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Instrument+Sans:wght@400;500;600;700&display=swap';

if (
  typeof document !== 'undefined' &&
  !document.querySelector(`link[href="${EDITORIAL_FONTS_HREF}"]`)
) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = EDITORIAL_FONTS_HREF;
  link.media = 'print';
  link.onload = () => {
    link.media = 'all';
  };
  document.head.appendChild(link);
}
