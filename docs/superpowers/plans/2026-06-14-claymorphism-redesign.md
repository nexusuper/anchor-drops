# Claymorphism 3D Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign every Anchor Drops page (and the admin panel) in a claymorphism "3D clay" visual language with an animated hero and an animated water-purification pipeline, while keeping it accessible and easy to navigate.

**Architecture:** A foundation layer (self-hosted Google fonts via `next/font`, Tailwind v4 `@theme` tokens, and clay CSS utility classes in `globals.css`) feeds a small set of reusable presentational components (`ClayIcon`, `ClayCard`, `ClayButton`, `AnimatedHero`, `PurifyProcess`). Each page is then rebuilt by composing those components. No backend, data, or business-logic changes.

**Tech Stack:** Next.js 16.2.7 (pages router), React 19, Tailwind CSS v4 (CSS-first config), `next/font/google` (Fredoka + Nunito). No new runtime dependencies.

---

## Verification model (read first)

This is a **presentation-layer** redesign with no testable business logic, and the
project has **no test runner installed**. Adding Jest/RTL purely to assert
`box-shadow` strings would be low-value scope creep. Therefore each task is
verified by:

1. `npm run lint` — clean (no new errors).
2. `npm run build` — succeeds (catches bad imports/JSX) at integration milestones.
3. **Visual check**: `npm run dev`, open the affected page, confirm the described
   result at widths 375px / 768px / 1024px / 1440px, and with
   DevTools → Rendering → "Emulate prefers-reduced-motion: reduce" (animations
   must stop, content stays readable).

Behavioral guarantee: existing flows (place order, track, admin login, status
update, notify, delete/bulk-delete) must still work — the redesign only changes
markup/classes, never fetch calls, state, or handler logic. Where a task edits a
file that contains logic, **keep all `useState`/`fetch`/handler code identical**;
change only JSX and `className`.

Commit after every task.

---

## File structure

**Create:**
- `components/ui/ClayIcon.js` — named SVG icon set (replaces all emoji).
- `components/ui/ClayCard.js` — puffy clay surface wrapper.
- `components/ui/ClayButton.js` — clay button / link with variants + states.
- `components/AnimatedHero.js` — homepage animated hero.
- `components/PurifyProcess.js` — animated 5-stage purification pipeline.

**Modify:**
- `styles/globals.css` — tokens, clay utilities, keyframes, reduced-motion.
- `pages/_app.js` — load fonts, expose font CSS variables.
- `components/Navbar.js`, `components/Footer.js`, `components/Layout.js`.
- `pages/index.js`, `pages/products.js`, `pages/order.js`, `pages/track.js`,
  `pages/order/confirmation.js`.
- `components/AdminPanel.js`.

---

## Task 1: Foundation — fonts, tokens, clay utilities

**Files:**
- Modify: `pages/_app.js`
- Modify: `styles/globals.css`

- [ ] **Step 1: Load fonts and expose CSS variables in `_app.js`**

Add the font imports at the top of `pages/_app.js` (after the existing imports)
and wrap the returned tree in a `<div>` carrying the font variables. Keep every
existing line (Pixel scripts, MessengerButton, route tracking) unchanged.

At the top, add:

```js
import { Fredoka, Nunito } from 'next/font/google';

const fredoka = Fredoka({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-fredoka',
  display: 'swap',
});
const nunito = Nunito({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  variable: '--font-nunito',
  display: 'swap',
});
```

Then change the `return (` block so the outer fragment becomes a `<div>` that
applies the variables (the Pixel `<Script>` can stay where it is inside it):

```jsx
  return (
    <div className={`${fredoka.variable} ${nunito.variable}`}>
      {/* Meta Pixel */}
      {FB_PIXEL_ID && (
        <Script
          id="fb-pixel"
          strategy="afterInteractive"
          src="https://connect.facebook.net/en_US/fbevents.js"
          onLoad={() => {
            window.fbq('init', FB_PIXEL_ID);
            window.fbq('track', 'PageView');
          }}
        />
      )}
      <MessengerButton />
      <Component {...pageProps} />
    </div>
  );
```

- [ ] **Step 2: Replace `styles/globals.css` with the full foundation**

Overwrite the file with:

```css
@import "tailwindcss";

@theme {
  /* Typography */
  --font-sans: var(--font-nunito), ui-sans-serif, system-ui, sans-serif;
  --font-display: var(--font-fredoka), var(--font-nunito), sans-serif;

  /* Clay palette (extends Tailwind's color utilities: bg-clay-bg, text-clay-ink, ...) */
  --color-clay-bg: #e3f1fb;
  --color-clay-surface: #f2faff;
  --color-clay-ink: #0c4a6e;
  --color-clay-ink2: #0369a1;
  --color-clay-muted: #5b7c91;
  --color-clay-sky: #38bdf8;
  --color-clay-skydeep: #0284c7;
  --color-clay-uv: #7c3aed;
}

body {
  font-family: var(--font-sans);
  background-color: var(--color-clay-bg);
  color: var(--color-clay-ink);
}

h1, h2, h3, .font-display {
  font-family: var(--font-display);
}

/* ---------- Clay surfaces ---------- */
.clay-raised {
  background: var(--color-clay-surface);
  box-shadow: 9px 9px 20px #bcd7e8, -9px -9px 20px #ffffff;
}
.clay-raised-sm {
  background: var(--color-clay-surface);
  box-shadow: 6px 6px 13px #c2dbeb, -6px -6px 13px #ffffff;
}
.clay-inset {
  background: var(--color-clay-surface);
  box-shadow: inset 4px 4px 8px #bcd7e8, inset -4px -4px 8px #ffffff;
}

/* ---------- Clay buttons / pressables ---------- */
.clay-pressable { transition: transform 0.15s ease; }
.clay-pressable:active { transform: scale(0.95); }
@media (prefers-reduced-motion: reduce) {
  .clay-pressable { transition: none; }
  .clay-pressable:active { transform: none; }
}
.clay-btn-primary {
  background: linear-gradient(145deg, #38bdf8, #0284c7);
  color: #fff;
  box-shadow: 5px 5px 12px #b3d4e6, -3px -3px 8px #ffffff;
}
.clay-btn-white {
  background: var(--color-clay-surface);
  color: var(--color-clay-skydeep);
  box-shadow: 6px 6px 14px rgba(2, 80, 120, 0.25), inset 2px 2px 4px #ffffff;
}

/* ---------- Clay form controls ---------- */
.clay-input {
  width: 100%;
  background: var(--color-clay-surface);
  border-radius: 14px;
  padding: 0.75rem 1rem;
  color: var(--color-clay-ink);
  box-shadow: inset 4px 4px 8px #cfe3f0, inset -4px -4px 8px #ffffff;
  outline: none;
}
.clay-input::placeholder { color: #9bb6c7; }
.clay-input:focus-visible {
  box-shadow: inset 4px 4px 8px #cfe3f0, inset -4px -4px 8px #ffffff,
    0 0 0 3px rgba(56, 189, 248, 0.55);
}

/* selectable option tile (product / payment pickers) */
.clay-tile {
  background: var(--color-clay-surface);
  border-radius: 16px;
  box-shadow: 5px 5px 11px #c8def0, -5px -5px 11px #ffffff;
  transition: box-shadow 0.15s ease;
}
.clay-tile-selected {
  box-shadow: inset 4px 4px 8px #bcd7e8, inset -4px -4px 8px #ffffff,
    0 0 0 2px var(--color-clay-sky);
}

/* ---------- Hero animations ---------- */
.hero-shimmer {
  position: absolute;
  inset: -40% -10% auto;
  height: 120%;
  pointer-events: none;
  background: radial-gradient(60% 50% at 30% 0%, rgba(255,255,255,0.35), transparent 70%);
  animation: shimmer 7s ease-in-out infinite;
}
@keyframes shimmer { 0%,100% { transform: translateX(-6%); } 50% { transform: translateX(6%); } }

.hero-drop { animation: bob 3.2s ease-in-out infinite; filter: drop-shadow(0 12px 16px rgba(2,80,120,0.4)); }
@keyframes bob { 0%,100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-12px) scale(1.04); } }

.hero-droplet {
  position: absolute; left: 50%; top: 96px; width: 9px; height: 13px; margin-left: -4.5px;
  border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
  background: linear-gradient(#eaf9ff, #bae6fd);
  animation: fall 3.2s ease-in infinite; opacity: 0;
}
@keyframes fall { 0%,60% { transform: translateY(0); opacity: 0; } 70% { opacity: 1; } 100% { transform: translateY(70px); opacity: 0; } }

.hero-ripple {
  position: absolute; left: 50%; top: 168px; width: 30px; height: 9px; margin-left: -15px;
  border: 2px solid rgba(255,255,255,0.6); border-radius: 50%; transform: scale(0);
  animation: rip 3.2s ease-out infinite;
}
@keyframes rip { 0%,72% { transform: scale(0); opacity: 0; } 78% { opacity: 0.9; } 100% { transform: scale(2.4); opacity: 0; } }

.hero-bubble {
  position: absolute; bottom: 30px; border-radius: 50%;
  background: rgba(255,255,255,0.45); box-shadow: inset 2px 2px 3px rgba(255,255,255,0.8);
  animation: rise linear infinite;
}
@keyframes rise { 0% { transform: translateY(0); opacity: 0; } 10% { opacity: 0.7; } 100% { transform: translateY(-260px); opacity: 0; } }

.hero-wave { position: absolute; bottom: 0; width: 200%; height: 100%; }
.hero-wave-1 { animation: waveslide 9s linear infinite; opacity: 0.5; }
.hero-wave-2 { animation: waveslide 6s linear infinite reverse; opacity: 0.7; }
@keyframes waveslide { from { transform: translateX(0); } to { transform: translateX(-50%); } }

/* ---------- Purification pipeline animations ---------- */
.purify-fill {
  position: absolute; left: 0; right: 0; bottom: 0; height: 64%;
  background: linear-gradient(#7dd3fc, #0ea5e9); opacity: 0.35; z-index: 1;
  animation: slosh 3s ease-in-out infinite;
}
@keyframes slosh { 0%,100% { height: 60%; } 50% { height: 70%; } }
.purify-pipe::after {
  content: ""; position: absolute; inset: 0;
  background: repeating-linear-gradient(90deg, #38bdf8 0 8px, transparent 8px 16px);
  animation: flow 0.7s linear infinite; opacity: 0.85;
}
@keyframes flow { from { background-position: 0 0; } to { background-position: 16px 0; } }
.purify-uv { animation: uvpulse 1.6s ease-in-out infinite; }
@keyframes uvpulse {
  0%,100% { box-shadow: 6px 6px 13px #c2dbeb, -6px -6px 13px #fff, inset 0 0 8px #a78bfa; }
  50% { box-shadow: 6px 6px 13px #c2dbeb, -6px -6px 13px #fff, inset 0 0 22px #8b5cf6; }
}
.purify-bottlefill { animation: fillup 4s ease-in-out infinite; }
@keyframes fillup { 0% { height: 8%; } 45% { height: 88%; } 55% { height: 88%; } 100% { height: 8%; } }

@media (prefers-reduced-motion: reduce) {
  .hero-shimmer, .hero-drop, .hero-droplet, .hero-ripple, .hero-bubble,
  .hero-wave-1, .hero-wave-2, .purify-fill, .purify-pipe::after, .purify-uv {
    animation: none;
  }
  .hero-droplet, .hero-ripple { opacity: 0; }
  .purify-bottlefill { animation: none; height: 80%; }
}
```

- [ ] **Step 3: Verify lint + build**

Run: `npm run lint`
Expected: no errors.

Run: `npm run build`
Expected: build completes; fonts download succeeds (Fredoka, Nunito).

- [ ] **Step 4: Visual smoke check**

Run: `npm run dev`, open `http://localhost:3000`. The page background should be
pale blue and body text should now render in Nunito (rounded), headings in
Fredoka. Layout is otherwise unchanged (pages not yet rebuilt). No console errors.

- [ ] **Step 5: Commit**

```bash
git add pages/_app.js styles/globals.css
git commit -m "feat(ui): add claymorphism foundation — fonts, tokens, clay utilities"
```

---

## Task 2: `ClayIcon` component (SVG icon set)

**Files:**
- Create: `components/ui/ClayIcon.js`

- [ ] **Step 1: Create the icon component**

```jsx
// Named SVG icons replacing all emoji. Decorative by default (aria-hidden).
// Pass `title` to make an icon meaningful to screen readers.
const PATHS = {
  drop: <path d="M12 2.5C12 2.5 5 11 5 15.5a7 7 0 0 0 14 0C19 11 12 2.5 12 2.5z" />,
  lock: <><rect x="4" y="11" width="16" height="10" rx="2.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  bolt: <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z" />,
  filter: <><path d="M12 3C12 3 6 9 6 13.5a6 6 0 0 0 12 0C18 9 12 3 12 3z" /><path d="M10 13.5a2 2 0 0 0 2 2" /></>,
  jug: <><rect x="8" y="2" width="8" height="3.5" rx="1" /><path d="M6 7q0-1.5 2-1.5h8q2 0 2 1.5v13q0 2-2 2H8q-2 0-2-2z" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  phone: <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 5 5L16 13l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
  cash: <><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><circle cx="12" cy="12" r="2.5" /></>,
  mobile: <><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18h2" /></>,
  card: <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19" /></>,
  truck: <><path d="M2 6h11v9H2z" /><path d="M13 9h4l3 3v3h-7z" /><circle cx="6" cy="18" r="1.8" /><circle cx="17" cy="18" r="1.8" /></>,
  clipboard: <><rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="M9 4V3h6v1" /><path d="M9 10h6M9 14h4" /></>,
  check: <path d="m5 13 4 4 10-11" />,
  party: <><path d="M4 20 9 8l7 7z" /><path d="M14 4l1 2M18 6l2-1M17 10l2 1" /></>,
  trash: <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /></>,
  refresh: <><path d="M4 12a8 8 0 0 1 14-5l2 2" /><path d="M20 4v5h-5" /><path d="M20 12a8 8 0 0 1-14 5l-2-2" /><path d="M4 20v-5h5" /></>,
  chat: <path d="M4 5h16v11H9l-5 4z" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  cancel: <><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></>,
};

export default function ClayIcon({ name, title, className = 'w-6 h-6', fill = 'none', stroke = 'currentColor', strokeWidth = 2 }) {
  const node = PATHS[name];
  if (!node) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title || undefined}
    >
      {title ? <title>{title}</title> : null}
      {node}
    </svg>
  );
}
```

- [ ] **Step 2: Verify lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/ui/ClayIcon.js
git commit -m "feat(ui): add ClayIcon SVG icon set"
```

---

## Task 3: `ClayCard` component

**Files:**
- Create: `components/ui/ClayCard.js`

- [ ] **Step 1: Create the component**

```jsx
const VARIANTS = {
  raised: 'clay-raised',
  raisedSm: 'clay-raised-sm',
  inset: 'clay-inset',
  flat: 'bg-clay-surface',
};

export default function ClayCard({ as: Tag = 'div', variant = 'raised', className = '', children, ...rest }) {
  return (
    <Tag className={`rounded-3xl ${VARIANTS[variant] || VARIANTS.raised} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
```

- [ ] **Step 2: Verify lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/ui/ClayCard.js
git commit -m "feat(ui): add ClayCard surface component"
```

---

## Task 4: `ClayButton` component

**Files:**
- Create: `components/ui/ClayButton.js`

- [ ] **Step 1: Create the component**

Renders a `next/link` when `href` is provided, otherwise a `<button>`. Variants
map to the clay button classes from Task 1. Includes `loading` + `disabled`.

```jsx
import Link from 'next/link';

const VARIANTS = {
  primary: 'clay-btn-primary',
  white: 'clay-btn-white',
  ghost: 'bg-white/20 text-white border-2 border-white/60',
  outline: 'bg-clay-surface text-clay-skydeep ring-1 ring-clay-sky/40 clay-raised-sm',
};

const SIZES = {
  md: 'px-6 py-3 text-base',
  lg: 'px-8 py-4 text-lg',
  sm: 'px-4 py-2 text-sm',
};

export default function ClayButton({
  href,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  className = '',
  children,
  ...rest
}) {
  const classes = `inline-flex items-center justify-center gap-2 rounded-full font-display font-semibold clay-pressable ${SIZES[size]} ${VARIANTS[variant]} ${disabled || loading ? 'opacity-60 pointer-events-none' : ''} ${className}`;

  if (href && !disabled && !loading) {
    return (
      <Link href={href} className={classes} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading ? 'Please wait…' : children}
    </button>
  );
}
```

- [ ] **Step 2: Verify lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/ui/ClayButton.js
git commit -m "feat(ui): add ClayButton component"
```

---

## Task 5: `AnimatedHero` component

**Files:**
- Create: `components/AnimatedHero.js`

- [ ] **Step 1: Create the component**

All animation classes are already defined in `globals.css` (Task 1). This file
is pure markup composition. CTAs use `ClayButton`.

```jsx
import ClayButton from './ui/ClayButton';

export default function AnimatedHero() {
  return (
    <section className="px-4 pt-8 pb-4">
      <div className="relative max-w-5xl mx-auto overflow-hidden rounded-[34px] px-6 py-12 text-center text-white clay-raised"
           style={{ background: 'linear-gradient(160deg,#7dd3fc,#0ea5e9)' }}>
        <div className="hero-shimmer" />

        {/* rising bubbles */}
        <span className="hero-bubble" style={{ left: '12%', width: 10, height: 10, animationDuration: '6s' }} />
        <span className="hero-bubble" style={{ left: '24%', width: 6, height: 6, animationDuration: '5s', animationDelay: '1.5s' }} />
        <span className="hero-bubble" style={{ left: '78%', width: 12, height: 12, animationDuration: '7s', animationDelay: '.8s' }} />
        <span className="hero-bubble" style={{ left: '88%', width: 7, height: 7, animationDuration: '5.5s', animationDelay: '2.2s' }} />
        <span className="hero-bubble" style={{ left: '60%', width: 8, height: 8, animationDuration: '6.5s', animationDelay: '3s' }} />

        {/* 3D drop + drip + ripple */}
        <div className="relative z-10 mx-auto" style={{ width: 120, height: 150 }}>
          <svg className="hero-drop mx-auto" style={{ width: 104, height: 104 }} viewBox="0 0 100 100">
            <defs>
              <radialGradient id="heroDrop" cx="36%" cy="30%" r="78%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="35%" stopColor="#cdefff" />
                <stop offset="70%" stopColor="#7dd3fc" />
                <stop offset="100%" stopColor="#0284c7" />
              </radialGradient>
            </defs>
            <path d="M50 6C50 6 18 44 18 65a32 32 0 0 0 64 0C82 44 50 6 50 6z" fill="url(#heroDrop)" />
            <ellipse cx="36" cy="48" rx="10" ry="16" fill="#ffffff" opacity="0.6" />
            <circle cx="62" cy="72" r="6" fill="#ffffff" opacity="0.25" />
          </svg>
          <span className="hero-droplet" />
          <span className="hero-ripple" />
        </div>

        <h1 className="relative z-10 text-4xl md:text-6xl font-bold leading-tight mb-3"
            style={{ textShadow: '0 3px 8px rgba(2,80,120,.25)' }}>
          Fresh Water,<br />Delivered to Your Door
        </h1>
        <p className="relative z-10 max-w-xl mx-auto mb-6 font-semibold text-sky-50">
          Order purified water refills in minutes. No account needed — just fill the form and we deliver.
        </p>
        <div className="relative z-10 flex flex-col sm:flex-row gap-4 justify-center">
          <ClayButton href="/order" variant="white" size="lg">Order Now</ClayButton>
          <ClayButton href="/products" variant="ghost" size="lg">See Pricing</ClayButton>
        </div>

        {/* rolling waves */}
        <div className="absolute left-0 right-0 -bottom-0.5 h-14 z-0">
          <svg className="hero-wave hero-wave-1" viewBox="0 0 1200 60" preserveAspectRatio="none">
            <path d="M0,30 C150,60 350,0 600,30 C850,60 1050,0 1200,30 L1200,60 L0,60 Z" fill="rgba(255,255,255,.35)" />
          </svg>
          <svg className="hero-wave hero-wave-2" viewBox="0 0 1200 60" preserveAspectRatio="none">
            <path d="M0,35 C200,5 400,55 600,35 C800,15 1000,55 1200,35 L1200,60 L0,60 Z" fill="rgba(255,255,255,.55)" />
          </svg>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/AnimatedHero.js
git commit -m "feat(ui): add AnimatedHero component"
```

---

## Task 6: `PurifyProcess` component

**Files:**
- Create: `components/PurifyProcess.js`

- [ ] **Step 1: Create the component**

Animation classes (`purify-*`) come from `globals.css`. Five stages; pipes hide
on mobile (Tailwind `hidden sm:block`).

```jsx
import ClayCard from './ui/ClayCard';

function Tank({ children, uv }) {
  return (
    <div className={`relative mx-auto grid place-items-center overflow-hidden rounded-[18px] ${uv ? 'purify-uv' : 'clay-raised-sm'}`}
         style={{ width: 84, height: 104, background: uv ? 'linear-gradient(145deg,#ede9fe,#ddd6fe)' : 'linear-gradient(145deg,#eaf6ff,#d3ecfb)' }}>
      <div className="purify-fill" style={uv ? { background: 'linear-gradient(#c4b5fd,#8b5cf6)', opacity: 0.3 } : undefined} />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

const Pipe = () => <div className="purify-pipe relative hidden sm:block self-start mt-12 h-3.5 w-8 overflow-hidden rounded-lg" style={{ background: '#d3ecfb', boxShadow: 'inset 2px 2px 4px #bcd7e8' }} />;

const Stage = ({ step, label, uv, children }) => (
  <div className="text-center" style={{ flex: 1, minWidth: 110 }}>
    <div className="mb-3"><Tank uv={uv}>{children}</Tank></div>
    <div className="text-[11px] font-extrabold tracking-wide" style={{ color: uv ? '#a78bfa' : '#7dd3fc' }}>STEP {step}</div>
    <div className="font-display font-semibold text-sm" style={{ color: uv ? '#7c3aed' : '#0369a1' }}>{label}</div>
  </div>
);

export default function PurifyProcess() {
  return (
    <section className="max-w-5xl mx-auto px-4 py-14">
      <h2 className="text-center text-3xl font-bold text-clay-ink mb-1">How We Purify Your Water</h2>
      <p className="text-center text-clay-muted font-semibold mb-7">Every drop passes through 5 stages before it reaches your door</p>
      <ClayCard className="p-8">
        <div className="flex flex-wrap items-end justify-center sm:justify-between gap-5">
          <Stage step="1" label="Source Water">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="#bae6fd" stroke="#0284c7" strokeWidth="2"><path d="M12 3C12 3 6 9 6 13.5a6 6 0 0 0 12 0C18 9 12 3 12 3z" /></svg>
          </Stage>
          <Pipe />
          <Stage step="2" label="Sediment Filter">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="#bae6fd" stroke="#0284c7" strokeWidth="2"><rect x="6" y="3" width="12" height="18" rx="3" /><path d="M6 9h12M6 14h12" strokeDasharray="2 2" /></svg>
          </Stage>
          <Pipe />
          <Stage step="3" label="Carbon Filter">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="#bae6fd" stroke="#0284c7" strokeWidth="2"><circle cx="12" cy="12" r="8" /><circle cx="9" cy="10" r="1.4" fill="#0284c7" /><circle cx="14" cy="13" r="1.4" fill="#0284c7" /><circle cx="11" cy="15" r="1.4" fill="#0284c7" /></svg>
          </Stage>
          <Pipe />
          <Stage step="4" label="UV Sterilizer" uv>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="#ddd6fe" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round"><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3" /><circle cx="12" cy="12" r="3" /></svg>
          </Stage>
          <Pipe />
          <Stage step="5" label="Pure & Ready">
            <div className="relative" style={{ width: 52, height: 88 }}>
              <div className="absolute left-1/2 -top-1.5 -translate-x-1/2 h-2.5 w-6 rounded bg-clay-skydeep" />
              <div className="absolute inset-0 overflow-hidden rounded-[12px] border-[3px] border-clay-sky bg-clay-surface">
                <div className="purify-bottlefill absolute inset-x-0 bottom-0" style={{ background: 'linear-gradient(#7dd3fc,#0ea5e9)' }} />
                <div className="absolute top-2 left-2 w-2 h-9 rounded bg-white/60 z-10" />
              </div>
            </div>
          </Stage>
        </div>
      </ClayCard>
    </section>
  );
}
```

- [ ] **Step 2: Verify lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/PurifyProcess.js
git commit -m "feat(ui): add animated PurifyProcess pipeline"
```

---

## Task 7: Navbar redesign

**Files:**
- Modify: `components/Navbar.js`

- [ ] **Step 1: Replace the file**

Keep the `useState(open)` logic. Replace emoji logo with `ClayIcon`, restyle as a
clay pill bar, mark the mobile menu as a clay sheet.

```jsx
import Link from 'next/link';
import { useState } from 'react';
import ClayIcon from './ui/ClayIcon';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/products', label: 'Products' },
  { href: '/track', label: 'Track Order' },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <nav className="sticky top-0 z-40 px-4 pt-4">
      <div className="max-w-6xl mx-auto flex items-center justify-between rounded-3xl px-5 py-3 clay-raised">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid place-items-center w-9 h-9 rounded-[13px] text-white clay-raised-sm"
                style={{ background: 'linear-gradient(145deg,#7dd3fc,#0ea5e9)' }}>
            <ClayIcon name="drop" className="w-5 h-5" fill="#fff" stroke="none" />
          </span>
          <span className="font-display text-xl font-bold text-clay-ink2">Anchor Drops</span>
        </Link>

        <div className="hidden md:flex items-center gap-6">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="font-semibold text-clay-muted hover:text-clay-skydeep transition-colors">{l.label}</Link>
          ))}
          <Link href="/order" className="rounded-full px-5 py-2 font-display font-semibold text-white clay-btn-primary clay-pressable">Order Now</Link>
        </div>

        <button className="md:hidden text-clay-ink2" onClick={() => setOpen(!open)} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
          <ClayIcon name={open ? 'close' : 'info'} className="w-7 h-7" />
        </button>
      </div>

      {open && (
        <div className="md:hidden max-w-6xl mx-auto mt-2 rounded-3xl p-4 flex flex-col gap-2 clay-raised">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="py-2 font-semibold text-clay-muted hover:text-clay-skydeep" onClick={() => setOpen(false)}>{l.label}</Link>
          ))}
          <Link href="/order" className="text-center rounded-full px-5 py-2.5 font-display font-semibold text-white clay-btn-primary" onClick={() => setOpen(false)}>Order Now</Link>
        </div>
      )}
    </nav>
  );
}
```

> Note: the mobile toggle uses the `info`/`close` icons as a stand-in hamburger.
> If a dedicated "menu" (three-line) glyph is wanted, add a `menu` path to
> `ClayIcon` PATHS: `<path d="M4 7h16M4 12h16M4 17h16" />` and use `name={open ? 'close' : 'menu'}`.

- [ ] **Step 2: Add the `menu` icon referenced above**

In `components/ui/ClayIcon.js`, add to the `PATHS` object:

```js
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
```

Then in `Navbar.js` change the toggle to `name={open ? 'close' : 'menu'}`.

- [ ] **Step 3: Verify lint + visual**

Run: `npm run lint` → no errors.
`npm run dev` → navbar is a floating clay pill; mobile (375px) shows the clay
dropdown sheet; logo drop icon renders (no emoji).

- [ ] **Step 4: Commit**

```bash
git add components/Navbar.js components/ui/ClayIcon.js
git commit -m "feat(ui): redesign Navbar as clay pill bar"
```

---

## Task 8: Footer redesign

**Files:**
- Modify: `components/Footer.js`

- [ ] **Step 1: Replace the file** (emoji → ClayIcon, keep links/content)

```jsx
import Link from 'next/link';
import ClayIcon from './ui/ClayIcon';

export default function Footer() {
  return (
    <footer className="mt-auto px-4 pb-4">
      <div className="max-w-6xl mx-auto rounded-3xl px-8 py-10 text-clay-ink2 clay-raised">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <h3 className="font-display text-lg font-bold text-clay-ink mb-2">Anchor Drops</h3>
            <p className="text-sm text-clay-muted">Fresh, clean water delivered to your doorstep. No account needed — just order and we deliver.</p>
          </div>
          <div>
            <h4 className="font-display font-semibold text-clay-ink mb-2">Quick Links</h4>
            <ul className="space-y-1 text-sm">
              <li><Link href="/" className="text-clay-muted hover:text-clay-skydeep transition-colors">Home</Link></li>
              <li><Link href="/products" className="text-clay-muted hover:text-clay-skydeep transition-colors">Products &amp; Pricing</Link></li>
              <li><Link href="/order" className="text-clay-muted hover:text-clay-skydeep transition-colors">Order Now</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-display font-semibold text-clay-ink mb-2">Contact</h4>
            <ul className="space-y-2 text-sm text-clay-muted">
              <li className="flex items-center gap-2"><ClayIcon name="phone" className="w-4 h-4 text-clay-sky" /> 0912-345-6789</li>
              <li className="flex items-center gap-2"><ClayIcon name="chat" className="w-4 h-4 text-clay-sky" /> anchordrops@email.com</li>
              <li className="flex items-center gap-2"><ClayIcon name="info" className="w-4 h-4 text-clay-sky" /> Mon–Sat, 7AM–6PM</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-sky-100 text-center text-clay-muted text-xs pt-5 mt-6">
          © {new Date().getFullYear()} Anchor Drops. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: Verify lint** → `npm run lint` → no errors.

- [ ] **Step 3: Commit**

```bash
git add components/Footer.js
git commit -m "feat(ui): redesign Footer in clay style"
```

---

## Task 9: Layout background

**Files:**
- Modify: `components/Layout.js`

- [ ] **Step 1: Update the wrapper background**

Change the wrapper `div` className from `bg-sky-50` to `bg-clay-bg` (the token).
Keep everything else identical.

```jsx
      <div className="min-h-screen flex flex-col bg-clay-bg">
```

- [ ] **Step 2: Verify + commit**

Run: `npm run lint` → no errors.

```bash
git add components/Layout.js
git commit -m "feat(ui): use clay background token in Layout"
```

---

## Task 10: Home page

**Files:**
- Modify: `pages/index.js`

- [ ] **Step 1: Replace the file**

Use `AnimatedHero`, `PurifyProcess` (replacing the old "How It Works" steps),
`ClayCard`, `ClayButton`, `ClayIcon`. Keep product/feature data arrays.

```jsx
import Layout from '@/components/Layout';
import AnimatedHero from '@/components/AnimatedHero';
import PurifyProcess from '@/components/PurifyProcess';
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import ClayIcon from '@/components/ui/ClayIcon';

const features = [
  { icon: 'lock', title: 'No Login Required', desc: 'Order as a guest. We just need your name, address, and phone number.' },
  { icon: 'bolt', title: 'Same-Day Delivery', desc: 'Order before 2PM and get your water delivered today within your area.' },
  { icon: 'filter', title: 'Pure & Safe Water', desc: 'Multi-stage filtration and UV sterilization for the cleanest water.' },
];

const products = [
  { name: '5-Gal Slim Refill', price: 30, tag: 'Most Popular', id: 'slim5' },
  { name: '5-Gal Round Refill', price: 35, tag: 'Standard', id: 'round5' },
  { name: '3-Gal Refill', price: 20, tag: 'Compact', id: 'round3' },
];

function Jug() {
  return (
    <svg className="mx-auto" width="62" height="78" viewBox="0 0 60 78">
      <rect x="20" y="2" width="20" height="8" rx="2" fill="#7dd3fc" />
      <path d="M12 16 Q12 12 18 12 H42 Q48 12 48 16 V70 Q48 76 42 76 H18 Q12 76 12 70 Z" fill="#bae6fd" stroke="#38bdf8" strokeWidth="2" />
      <rect x="18" y="30" width="24" height="34" rx="4" fill="#7dd3fc" opacity="0.6" />
      <ellipse cx="24" cy="40" rx="3" ry="7" fill="#fff" opacity="0.7" />
    </svg>
  );
}

export default function Home() {
  return (
    <Layout title="Anchor Drops — Pure Water Delivery">
      <AnimatedHero />

      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-center text-clay-ink mb-10">Why Choose Anchor Drops?</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((f) => (
            <ClayCard key={f.title} className="p-7 text-center">
              <div className="mx-auto mb-4 grid place-items-center w-[74px] h-[74px] rounded-[22px] clay-raised-sm"
                   style={{ background: 'linear-gradient(145deg,#e9f6ff,#d3ecfb)' }}>
                <ClayIcon name={f.icon} className="w-9 h-9 text-clay-sky" />
              </div>
              <h3 className="text-xl font-display font-semibold text-clay-ink2 mb-2">{f.title}</h3>
              <p className="text-clay-muted text-sm font-semibold">{f.desc}</p>
            </ClayCard>
          ))}
        </div>
      </section>

      <PurifyProcess />

      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-center text-clay-ink mb-2">Our Products</h2>
        <p className="text-center text-clay-muted font-semibold mb-10">Affordable prices, premium quality</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {products.map((p) => (
            <ClayCard key={p.name} className="p-7 text-center">
              <span className="inline-block text-xs font-extrabold text-white rounded-full px-3 py-1 mb-1 clay-btn-primary">{p.tag}</span>
              <Jug />
              <h3 className="text-lg font-display font-semibold text-clay-ink2 mt-2 mb-1">{p.name}</h3>
              <p className="font-display text-3xl font-bold text-clay-skydeep mb-4">₱{p.price}</p>
              <ClayButton href={`/order?product=${p.id}`} className="w-full">Order This</ClayButton>
            </ClayCard>
          ))}
        </div>
        <div className="text-center">
          <ClayButton href="/products" variant="outline">View All Products &amp; Pricing →</ClayButton>
        </div>
      </section>

      <section className="px-4 pb-16">
        <ClayCard className="max-w-3xl mx-auto p-12 text-center text-white" style={{ background: 'linear-gradient(160deg,#38bdf8,#0284c7)' }}>
          <h2 className="text-3xl font-bold mb-3">Ready to Order?</h2>
          <p className="text-sky-50 font-semibold mb-7">It takes less than 2 minutes. No account, no hassle.</p>
          <ClayButton href="/order" variant="white" size="lg">Place Your Order</ClayButton>
        </ClayCard>
      </section>
    </Layout>
  );
}
```

- [ ] **Step 2: Verify build + visual**

Run: `npm run build` → succeeds.
`npm run dev` → home shows animated hero, clay feature cards with icons, animated
purify pipeline, clay product cards, gradient CTA. Check 375/768/1024/1440 and
reduced-motion (animations freeze, content readable).

- [ ] **Step 3: Commit**

```bash
git add pages/index.js
git commit -m "feat(ui): rebuild home page in clay style with animated hero + pipeline"
```

---

## Task 11: Products page

**Files:**
- Modify: `pages/products.js`

- [ ] **Step 1: Replace the file**

Keep the `products`, `deliveryRules` arrays. Convert header, product cards,
delivery table, payment cards, CTA to clay; add `PurifyProcess`; emoji → ClayIcon.

```jsx
import Layout from '@/components/Layout';
import PurifyProcess from '@/components/PurifyProcess';
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import ClayIcon from '@/components/ui/ClayIcon';

const products = [
  { id: 'slim5', name: '5-Gallon Slim', description: 'Slim-type 5-gallon container refill. Fits most standard dispensers.', refillPrice: 30, containerPrice: 150, size: '5-Gal', tag: 'Most Popular' },
  { id: 'round5', name: '5-Gallon Round', description: 'Round-type 5-gallon container refill. Standard round bottom dispenser.', refillPrice: 35, containerPrice: 170, size: '5-Gal', tag: 'Standard' },
  { id: 'round3', name: '3-Gallon Round', description: 'Compact 3-gallon round container. Great for small families or offices.', refillPrice: 20, containerPrice: 100, size: '3-Gal', tag: 'Compact' },
];

const deliveryRules = [
  { label: '1 container', fee: '₱20' },
  { label: '2–4 containers', fee: '₱15' },
  { label: '5+ containers', fee: 'FREE' },
];

const payments = [
  { icon: 'cash', name: 'Cash on Delivery', desc: 'Pay when your water arrives.' },
  { icon: 'mobile', name: 'GCash', desc: 'Send via GCash before delivery.' },
  { icon: 'card', name: 'PayMaya', desc: 'Send via PayMaya before delivery.' },
];

export default function Products() {
  return (
    <Layout title="Products & Pricing — Anchor Drops">
      <section className="px-4 pt-8">
        <ClayCard className="max-w-6xl mx-auto py-12 text-center text-white" style={{ background: 'linear-gradient(160deg,#7dd3fc,#0ea5e9)' }}>
          <h1 className="text-4xl font-extrabold mb-2">Products &amp; Pricing</h1>
          <p className="text-sky-50 font-semibold text-lg">Transparent pricing. No hidden fees.</p>
        </ClayCard>
      </section>

      <section className="max-w-6xl mx-auto px-4 py-14">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {products.map((p) => (
            <ClayCard key={p.id} className="p-7 flex flex-col">
              <span className="self-center text-xs font-extrabold text-white rounded-full px-4 py-1.5 mb-4 clay-btn-primary">{p.tag}</span>
              <h2 className="text-xl font-display font-semibold text-clay-ink text-center mb-1">{p.name}</h2>
              <p className="text-clay-muted text-sm text-center mb-6 font-semibold">{p.description}</p>
              <div className="space-y-3 mb-6">
                <div className="flex justify-between items-center clay-inset rounded-xl px-4 py-2.5">
                  <span className="text-clay-muted text-sm font-semibold">Refill only</span>
                  <span className="font-display text-clay-skydeep font-bold text-lg">₱{p.refillPrice}</span>
                </div>
                <div className="flex justify-between items-center clay-inset rounded-xl px-4 py-2.5">
                  <span className="text-clay-muted text-sm font-semibold">Container + refill</span>
                  <span className="font-display text-clay-skydeep font-bold text-lg">₱{p.containerPrice}</span>
                </div>
              </div>
              <ClayButton href={`/order?product=${p.id}`} className="mt-auto w-full">Order Now</ClayButton>
            </ClayCard>
          ))}
        </div>
      </section>

      <PurifyProcess />

      <section className="max-w-2xl mx-auto px-4 py-12">
        <h2 className="text-2xl font-bold text-clay-ink text-center mb-6">Delivery Fees</h2>
        <ClayCard className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="clay-inset">
              <tr>
                <th className="text-left px-5 py-3 text-clay-ink2 font-display">Order Size</th>
                <th className="text-right px-5 py-3 text-clay-ink2 font-display">Delivery Fee</th>
              </tr>
            </thead>
            <tbody>
              {deliveryRules.map((r, i) => (
                <tr key={i}>
                  <td className="px-5 py-3 text-clay-ink font-semibold">{r.label}</td>
                  <td className="px-5 py-3 text-right font-display font-bold text-clay-skydeep">{r.fee}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ClayCard>
        <p className="text-clay-muted text-xs text-center mt-3">Delivery available Mon–Sat, 7AM–6PM within service area.</p>
      </section>

      <section className="max-w-4xl mx-auto px-4 py-12">
        <h2 className="text-2xl font-bold text-clay-ink text-center mb-6">Accepted Payments</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {payments.map((m) => (
            <ClayCard key={m.name} className="p-5 text-center">
              <div className="mx-auto mb-3 grid place-items-center w-14 h-14 rounded-2xl clay-raised-sm" style={{ background: 'linear-gradient(145deg,#e9f6ff,#d3ecfb)' }}>
                <ClayIcon name={m.icon} className="w-7 h-7 text-clay-sky" />
              </div>
              <h3 className="font-display font-semibold text-clay-ink2 mb-1">{m.name}</h3>
              <p className="text-clay-muted text-sm">{m.desc}</p>
            </ClayCard>
          ))}
        </div>
      </section>

      <section className="px-4 pb-16">
        <ClayCard className="max-w-3xl mx-auto p-12 text-center text-white" style={{ background: 'linear-gradient(160deg,#38bdf8,#0284c7)' }}>
          <h2 className="text-2xl font-bold mb-4">Like what you see?</h2>
          <ClayButton href="/order" variant="white" size="lg">Place an Order</ClayButton>
        </ClayCard>
      </section>
    </Layout>
  );
}
```

- [ ] **Step 2: Verify build + visual** → `npm run build` succeeds; products page renders clay cards, pipeline, table, payments.

- [ ] **Step 3: Commit**

```bash
git add pages/products.js
git commit -m "feat(ui): rebuild products page in clay style"
```

---

## Task 12: Order page

**Files:**
- Modify: `pages/order.js`

- [ ] **Step 1: Keep all logic, restyle the markup**

Do **not** touch: `PRODUCTS`, `deliveryFee`, all `useState`, `useEffect`,
`handleSubmit`, the computed totals, or `set()`. Change only the returned JSX:

1. Header `<section>` → wrap in `ClayCard` gradient (like products header).
2. Each white section card → `ClayCard` with `p-6`.
3. Every `<input>`/`<textarea>` → keep all props, change `className` to
   `"clay-input"` (drop the old border/ring classes).
4. Product radio rows and payment rows → use `.clay-tile` and add
   `.clay-tile-selected` when selected (replace the old
   `border-sky-500 bg-sky-50` / `border-gray-200` logic). Payment emoji labels →
   text only (remove 💵/📱/💳; the surrounding tile is enough).
5. Order Summary block → `ClayCard` with `clay-inset` rows.
6. Submit `<button>` → keep `type`, `disabled`, text; className becomes
   `"w-full clay-btn-primary clay-pressable rounded-full py-4 text-lg font-display font-semibold disabled:opacity-60"`.

Concretely, the product picker label becomes:

```jsx
<label
  key={p.id}
  className={`flex items-center justify-between rounded-2xl px-4 py-3 cursor-pointer clay-tile ${form.product_type === p.id ? 'clay-tile-selected' : ''}`}
>
  <div className="flex items-center gap-3">
    <input type="radio" name="product_type" value={p.id} checked={form.product_type === p.id} onChange={() => set('product_type', p.id)} className="accent-clay-sky" />
    <span className="font-semibold text-clay-ink">{p.name}</span>
  </div>
  <span className="font-display text-clay-skydeep font-bold">₱{p.refill}/refill</span>
</label>
```

And the payment options array changes to label text only:

```jsx
{[
  { id: 'cod', label: 'Cash on Delivery' },
  { id: 'gcash', label: 'GCash' },
  { id: 'paymaya', label: 'PayMaya' },
].map((m) => (
  <label key={m.id} className={`flex items-center gap-3 rounded-2xl px-4 py-3 cursor-pointer clay-tile ${form.payment_method === m.id ? 'clay-tile-selected' : ''}`}>
    <input type="radio" name="payment_method" value={m.id} checked={form.payment_method === m.id} onChange={() => set('payment_method', m.id)} className="accent-clay-sky" />
    <span className="font-semibold text-clay-ink">{m.label}</span>
  </label>
))}
```

Replace the import line `import Layout ...` block top with:

```jsx
import Layout from '@/components/Layout';
import ClayCard from '@/components/ui/ClayCard';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
```

(Keep `PRODUCTS`, `deliveryFee`, and the whole component body; only section
wrappers `<div className="bg-white rounded-2xl p-6 shadow-sm border border-sky-100">`
become `<ClayCard className="p-6">`, and the summary
`<div className="bg-sky-50 ...">` becomes `<ClayCard className="p-6">`.)

- [ ] **Step 2: Verify the order flow still works**

`npm run dev` → go to `/order`, fill the form, submit a test order. It must POST
and redirect to `/order/confirmation?id=...` exactly as before. Inputs show inset
clay styling; selected product/payment tiles show the pressed-in selected state.

- [ ] **Step 3: Verify build** → `npm run build` succeeds.

- [ ] **Step 4: Commit**

```bash
git add pages/order.js
git commit -m "feat(ui): restyle order form in clay style (logic unchanged)"
```

---

## Task 13: Track page

**Files:**
- Modify: `pages/track.js`

- [ ] **Step 1: Keep all logic, restyle markup + stepper icons**

Do **not** touch: `STATUS_ORDER`, `Track` state/effects, `fetchOrder`,
`handleSubmit`, auto-refresh. Changes:

1. In `STEPS`, replace emoji `icon` strings with ClayIcon names:
   `pending→'clipboard'`, `confirmed→'check'`, `out_for_delivery→'truck'`,
   `delivered→'party'`. Update the render in `StatusStepper` so the circle shows
   `done ? <ClayIcon name="check" .../> : <ClayIcon name={step.icon} .../>`.
2. Cancelled block ❌ → `<ClayIcon name="cancel" className="w-10 h-10 mx-auto text-red-500" />`.
3. Header 🔍 → `<ClayIcon name="search" className="w-10 h-10 mx-auto" />`.
4. Search form card, order card, help card → `ClayCard`. Search `<input>` →
   `className="clay-input flex-1 font-mono uppercase"`. Track button →
   `clay-btn-primary clay-pressable`.
5. The 📞 help line → prefix with `<ClayIcon name="phone" .../>`.
6. Action links → `ClayButton` (primary for "Place Another Order", outline for
   "Back to Home").

Add to imports:

```jsx
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import ClayIcon from '@/components/ui/ClayIcon';
```

The stepper circle becomes:

```jsx
<div className={`w-10 h-10 rounded-full grid place-items-center shrink-0 ${done || active ? 'clay-btn-primary text-white' : 'clay-inset text-clay-muted'} ${active ? 'ring-4 ring-sky-100' : ''}`}>
  <ClayIcon name={done ? 'check' : step.icon} className="w-5 h-5" fill="none" stroke="currentColor" />
</div>
```

- [ ] **Step 2: Verify tracking still works**

`npm run dev` → `/track`, enter a real order ID from a test order, confirm it
loads, the stepper renders clay circles with icons, and auto-refresh still runs
for in-progress orders.

- [ ] **Step 3: Verify build** → `npm run build` succeeds.

- [ ] **Step 4: Commit**

```bash
git add pages/track.js
git commit -m "feat(ui): restyle track page + status stepper in clay style"
```

---

## Task 14: Confirmation page

**Files:**
- Modify: `pages/order/confirmation.js`

- [ ] **Step 1: Keep all logic, restyle markup**

Do **not** touch the `useEffect` fetch, `trackPurchase` call, or `STATUS_LABELS`
logic. Changes:

1. Header ✅ → `<ClayIcon name="check" className="w-12 h-12 mx-auto" stroke="#fff" />`
   inside the gradient header wrapped in `ClayCard`.
2. Order-ID card, details card, "we will call you" card → `ClayCard`
   (the info card uses `clay-inset`).
3. 📞 line → prefix `<ClayIcon name="phone" .../>`.
4. Action links → `ClayButton`: "Track My Order" (primary, with
   `<ClayIcon name="search" .../>`), "Place Another Order" (outline), "Back to
   Home" (plain text link kept).

Add imports:

```jsx
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import ClayIcon from '@/components/ui/ClayIcon';
```

- [ ] **Step 2: Verify** — `npm run dev`, finish a test order → confirmation shows
  clay cards, the order ID, and a working "Track My Order" link. `npm run build`
  succeeds.

- [ ] **Step 3: Commit**

```bash
git add pages/order/confirmation.js
git commit -m "feat(ui): restyle confirmation page in clay style"
```

---

## Task 15: Admin panel (login + dashboard)

**Files:**
- Modify: `components/AdminPanel.js`

- [ ] **Step 1: Keep ALL logic, restyle markup only**

Do **not** touch any of: the constants (`NOTIFIABLE_STATUSES`,
`DELETABLE_STATUSES`, `STATUS_OPTIONS`, `STATUS_COLORS`, `SORT_OPTIONS`), the
helper functions (`getSortValue`, `applySort`, `applyFilter`), any `useState`,
`fetchOrders`, `updateStatus`, `notifyCustomer`, `notifyViaMessenger`,
`deleteOrder`, `bulkDelete`, `toggleSelectAll`, `toggleOne`, or the data flow.
Admin keeps a tighter density than marketing pages (it is a work tool) but uses
the same tokens. Changes:

1. Add `import ClayIcon from './ui/ClayIcon';` at top.
2. **LoginScreen:** outer bg → `bg-clay-bg`; card → `clay-raised rounded-3xl`;
   🔒 → `<ClayIcon name="lock" className="w-10 h-10 mx-auto text-clay-sky" />`;
   password `<input>` → `className="clay-input"`; submit button →
   `clay-btn-primary clay-pressable rounded-full`.
3. **Dashboard header** bar (`bg-sky-600`) → keep as a solid gradient bar:
   `style={{ background: 'linear-gradient(160deg,#38bdf8,#0284c7)' }}`; Refresh
   button gets `<ClayIcon name="refresh" className="w-4 h-4" />` + text.
4. **Stat tiles:** each filter button → `clay-raised-sm rounded-2xl` and
   `clay-tile-selected` ring when active (replace the
   `border-2 border-sky-500 bg-sky-50` logic).
5. **Search/sort:** `<input>` and `<select>` → `className="clay-input"`.
6. **Modals (notify, bulk delete, single delete):** keep `fixed inset-0
   bg-black/40` scrim (already ≥40% — meets the legibility requirement); inner
   panel → `clay-raised rounded-3xl`. Replace 📋/🗑️ headings with
   `<ClayIcon name="clipboard"/>` / `<ClayIcon name="trash"/>`. Keep destructive
   buttons red (`bg-red-500`) — danger stays semantic, visually separated.
7. **Messenger toast:** keep `bg-green-500/bg-red-500`; replace ✅/❌ with
   `<ClayIcon name="check"/>` / `<ClayIcon name="cancel"/>`, and the ✕ close with
   `<ClayIcon name="close" className="w-4 h-4" />`. Remove `animate-pulse`
   (distracting); keep the toast static.
8. **Orders table:** wrap in `ClayCard`-style container
   (`clay-raised rounded-3xl overflow-hidden`); keep it a real `<table>` for
   scannability. Status `<select>` keeps `STATUS_COLORS`. Action buttons: replace
   emoji 📱/💬/🗑️ with `<ClayIcon name="mobile"/>` / `<ClayIcon name="chat"/>` /
   `<ClayIcon name="trash"/>` (keep `title` attrs for a11y). The "linked"
   💬 indicator next to a name → `<ClayIcon name="chat" className="w-4 h-4 text-blue-500" title="Messenger linked" />`.

> Note: `ClayCard` is optional inside admin; using the raw `clay-raised rounded-3xl`
> classes is fine and avoids importing it. Use `ClayIcon` for all glyphs.

- [ ] **Step 2: Verify the full admin flow**

`npm run dev` → `/admin`, log in with the real admin password. Confirm: stat
tiles filter, search/sort work, status change persists, notify modal opens and
copies, delete + bulk-delete still work, Messenger button still posts. No emoji
remain. Tables remain readable; modals have a strong scrim.

- [ ] **Step 3: Verify build** → `npm run build` succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/AdminPanel.js
git commit -m "feat(ui): restyle admin panel in clay style (logic unchanged)"
```

---

## Task 16: Final cross-cutting verification

**Files:** none (review only)

- [ ] **Step 1: Full build + lint**

Run: `npm run build` → succeeds with no errors.
Run: `npm run lint` → clean.

- [ ] **Step 2: Emoji audit**

Run: `git grep -nP "[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}]" -- "pages/**" "components/**"`
Expected: no matches (all emoji replaced by ClayIcon). The only acceptable
remaining non-ASCII are `₱`, `–`, `→`, `×`, `©`.

- [ ] **Step 3: Responsive + motion + contrast pass**

For each page (`/`, `/products`, `/order`, `/track`, `/order/confirmation`,
`/admin`):
- Check 375 / 768 / 1024 / 1440px — no horizontal scroll, no overlap, touch
  targets comfortable.
- Toggle DevTools "prefers-reduced-motion: reduce" — hero + pipeline freeze,
  bottle settles filled, everything readable.
- Spot-check text contrast: clay-ink/clay-ink2 on clay-surface and white on the
  gradients should all read ≥ 4.5:1.

- [ ] **Step 4: Behavior regression pass**

Confirm end-to-end with a test order: place order → confirmation → track →
admin sees it → change status → notify → delete. All must work unchanged.

- [ ] **Step 5: Final commit (if any review tweaks were made)**

```bash
git add -A
git commit -m "fix(ui): final clay redesign polish from verification pass"
```

---

## Self-review notes (author)

- **Spec coverage:** claymorphism tokens + safeguards (Task 1), no-emoji custom
  SVG icons (Task 2, used everywhere), Fredoka/Nunito via `next/font` (Task 1),
  reusable layer ClayCard/ClayButton/ClayIcon + `.clay-input`/`.clay-tile` for
  inputs (Tasks 1–4), animated hero (Task 5), animated purification pipeline on
  home + products (Tasks 6, 10, 11), all pages incl. admin (Tasks 7–15),
  verification incl. reduced-motion/responsive/contrast and behavior regression
  (Task 16). The spec's "ClayInput" component was intentionally collapsed into a
  `.clay-input` CSS class (simpler, one less file, same result) — noted here as a
  deliberate deviation.
- **No placeholders:** every code step shows real code; restyle tasks (12–15)
  enumerate exact class swaps rather than vague "make it clay."
- **Name consistency:** `ClayIcon` names referenced in pages (`drop`, `lock`,
  `bolt`, `filter`, `cash`, `mobile`, `card`, `truck`, `clipboard`, `check`,
  `party`, `trash`, `refresh`, `chat`, `close`, `cancel`, `info`, `search`,
  `phone`, `menu`) all exist in the Task 2 + Task 7 PATHS map. `ClayButton`
  variants (`primary`, `white`, `ghost`, `outline`) and `ClayCard` variants
  (`raised`, `raisedSm`, `inset`, `flat`) match their definitions.
