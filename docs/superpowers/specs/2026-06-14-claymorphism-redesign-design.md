# Anchor Drops — Claymorphism 3D Redesign

**Date:** 2026-06-14
**Status:** Approved design, ready for implementation plan

## Goal

Redesign the entire Anchor Drops UI in a **claymorphism** ("3D clay") visual
language that feels lively and tactile while staying **easy to navigate and
accessible**. Add two signature animated set-pieces: a living hero and an
animated water-purification pipeline.

## Scope

All user-facing pages **and** the admin panel:

- `pages/index.js` (Home)
- `pages/products.js` (Products & Pricing)
- `pages/order.js` (Order form)
- `pages/track.js` (Track Order)
- `pages/order/confirmation.js` (Confirmation)
- `components/Navbar.js`, `components/Footer.js`, `components/Layout.js`
- `components/AdminPanel.js` + `pages/admin/index.js` (login + dashboard)

Out of scope: API routes, data model, business logic, Messenger integration.
This is a presentation-layer redesign only.

## Design System

### Style: Claymorphism (sky-blue, deepened)

- **Surfaces** are puffy clay cards: large radii (20–34px) and the signature
  dual shadow — a dark shadow below-right plus a white highlight above-left —
  so elements read as gently extruded.
- **Buttons** use sky gradients with an inner top highlight and a press-in
  `scale(0.95)` on `:active`.
- **Palette** (keep existing sky-blue, enrich with pastel tints):
  - Background base: `#e3f1fb`
  - Surface: `#f2faff`
  - Primary sky: `#38bdf8` → deep `#0284c7` (gradient)
  - Ink / headings: `#0c4a6e`; secondary ink `#0369a1`; muted `#5b7c91`
  - UV accent (purification stage only): violet `#7c3aed` / `#8b5cf6`
  - Status colors (admin) keep existing semantic yellow/blue/orange/green/red.

### Accessibility safeguard (critical for claymorphism)

Claymorphism's usual failure is low-contrast gray-on-gray text. We avoid it:

- Body/label text is always dark ink (`#0c4a6e`/`#0369a1`) on light surfaces,
  or white on the gradient hero — never tinted gray-on-tinted-bg below 4.5:1.
- Buttons are solid gradient with white text (not extruded same-color clay).
- All interactive elements keep visible focus rings.
- Every animation is wrapped so `prefers-reduced-motion: reduce` disables it.
- Custom icons get `aria-hidden` when decorative; icon-only buttons keep labels.

### Typography

- Headings: **Fredoka** (rounded, friendly — matches the puffy shapes).
- Body: **Nunito** (clean, legible, rounded character).
- Loaded via `next/font/google` (self-hosted, `display: swap`) to avoid layout
  shift and the FOIT problem — not a raw `<link>` tag.
- Replaces the current `Arial` in `globals.css`.

### Icons: custom clay SVG set (no emoji)

Replace **all** emoji icons with a small hand-built SVG icon component set with
soft gradients + inner highlights so they read as 3D. Needed icons (from audit
of current emoji usage):

- Water drop, water jug/bottle, lock (no-login), lightning bolt (same-day),
  filtration drop, search, phone, cash, GCash/mobile, card, truck/scooter,
  clipboard, check, party/delivered, lock (admin), trash, refresh, chat,
  cancel/X, info.
- Delivered as a single `components/ui/ClayIcon.js` (named SVG paths) so usage
  is `<ClayIcon name="drop" />` and sizing is token-driven (sm/md/lg).

### Reusable component layer

Create `components/ui/`:

- `ClayCard.js` — puffy surface wrapper (variants: raised, inset, flat).
- `ClayButton.js` — gradient/white/ghost variants, press-in animation, loading
  + disabled states, renders as `<button>` or `next/link`.
- `ClayIcon.js` — the SVG icon set described above.
- `ClayInput.js` — inset clay text input/select with visible label + focus ring.

Shared clay shadow values live as CSS utilities/custom properties in
`globals.css` (Tailwind v4 `@theme` + a few custom utility classes), so the
design language has one source of truth rather than repeated inline shadows.

## Signature Animations

### 1. Animated hero (Home)

Pure CSS/SVG, no WebGL. A `<Hero>`-style block containing:

- A 3D water drop (radial-gradient SVG) that **bobs** with a breathing scale.
- A **droplet that drips** from the drop and a **ripple** when it lands.
- **Rising bubbles** in the background.
- A **light shimmer** sweeping the top.
- **Two layered waves** rolling along the bottom edge.
- Headline, subcopy, and the two CTAs (Order Now / See Pricing) on top.
- Entire set frozen under `prefers-reduced-motion`.

### 2. Animated purification pipeline

New section `components/PurifyProcess.js`, placed on **Home** (replacing the
current "How It Works" 1-2-3 steps) **and** on the **Products** page.

- 5 clay tanks: Source Water → Sediment Filter → Carbon Filter → UV Sterilizer
  → Pure & Ready.
- Water **sloshes** inside each tank; **flows** through connecting pipes
  (animated dashes); **Step 4 UV** glows/pulses violet; the **final bottle
  fills** with pure water on a loop.
- Responsive: pipes hide and stages stack/wrap on mobile (<720px).
- Frozen under `prefers-reduced-motion` (bottle settles to filled state).

The current homepage "How It Works" 1-2-3 steps is **replaced** by this pipeline
on Home; Products page gets the pipeline as an added trust section.

## Per-page application

- **Navbar:** clay pill bar, gradient logo blob with drop icon, gradient
  "Order Now" pill; mobile hamburger menu restyled as clay sheet. Active link
  state highlighted.
- **Home:** animated hero → feature clay cards (custom icons) → purification
  pipeline → product clay cards → clay CTA banner.
- **Products:** clay header → product clay cards with clay price rows →
  purification pipeline → delivery-fee clay table → payment clay cards → CTA.
- **Order:** clay section cards; `ClayInput` fields; product/payment selectors as
  selectable clay tiles (clear selected state, contrast-safe); puffy submit
  button with loading state; clay order-summary card.
- **Track:** clay search card; clay status stepper (custom icons, animated
  "current" pulse); clay order card.
- **Confirmation:** clay success header (animated check), clay order-ID card,
  clay detail card, clay action buttons.
- **Admin:** clay login card; clay dashboard — stat tiles as clay buttons,
  search/sort as clay inputs, modals as clay sheets with strong scrim. Table
  stays a real table for scannability but gets clay container, clearer status
  pills, and accessible row controls. Density kept tighter than marketing pages
  (it's a work tool), but same token system.

## Implementation Approach

**Chosen:** Tailwind v4 design tokens + a small reusable clay component layer +
custom shadow utilities in `globals.css`. No new runtime dependencies beyond the
two Google fonts via `next/font`.

Rejected: (a) inline utilities everywhere — inconsistent, unmaintainable;
(b) three.js/WebGL real 3D — heavy, hurts load time and navigation, contradicts
the "easy to access" goal.

### Important implementation constraint

Per `AGENTS.md`, this project's Next.js has breaking changes from common
knowledge. **Before writing code, read the relevant guides in
`node_modules/next/dist/docs/`** — specifically for `next/font` usage, global
CSS, and the pages-router conventions — and heed deprecation notices.

## Testing / Verification

- Visual check on 375px (small phone), 768px, 1024px, 1440px; portrait +
  landscape; no horizontal scroll.
- Verify with `prefers-reduced-motion: reduce` — all animations stop, content
  fully readable.
- Contrast spot-check key text/background pairs ≥ 4.5:1.
- Confirm all existing flows still work: place order, track order, admin login,
  status update, notify, delete/bulk-delete (redesign must not change behavior).
- Keyboard nav: tab order matches visual order; focus rings visible; modals have
  escape/close.
- `npm run build` succeeds; `npm run lint` clean.

## Non-goals / YAGNI

- No dark mode (not requested).
- No new pages or features.
- No backend/API/data changes.
- No real 3D engine.
