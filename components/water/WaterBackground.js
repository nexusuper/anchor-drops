import { useEffect, useRef } from 'react';
import { BUBBLES, C, alpha, getScene } from './scene';

// Fixed, decorative water layer behind the homepage. Markup is static; every frame
// `applyScene` writes transform/opacity only (never width/height/top/left).
// The hero keeps an empty `[data-water-anchor]` slot; the orb is drawn here, on top of it.

const WAVES = [
  'M0,30 C150,60 350,0 600,30 C850,60 1050,0 1200,30 L1200,60 L0,60 Z',
  'M0,35 C200,15 400,55 600,35 C800,15 1000,55 1200,35 L1200,60 L0,60 Z',
  'M0,24 C120,44 300,4 600,24 C900,44 1080,4 1200,24 L1200,60 L0,60 Z',
];
const DROP = 'M50 6C50 6 18 44 18 65a32 32 0 0 0 64 0C82 44 50 6 50 6z';
const FILL = { position: 'absolute', inset: 0 };
const MOVER = { position: 'absolute', left: 0, top: 0, willChange: 'transform, opacity' };

function Wave({ id, i, color }) {
  return (
    <svg
      data-w={id}
      viewBox="0 0 1200 60"
      preserveAspectRatio="none"
      style={{ position: 'absolute', left: 0, bottom: 0, width: '200%', height: '100%', willChange: 'transform' }}
    >
      <path d={WAVES[i]} fill={color} />
    </svg>
  );
}

export function WaterMarkup({ ref, style }) {
  return (
    <div
      ref={ref}
      aria-hidden="true"
      style={{ position: 'fixed', inset: 0, zIndex: -1, overflow: 'hidden', pointerEvents: 'none', opacity: 0, ...style }}
    >
      {/* Full-page water (p ≥ 0.33). Darkest tone is clay-sky at 50% over clay-bg: text on the
          homepage background is clay-ink (≥ 5.9:1) or large clay-ink2 (≥ 3.7:1) against it. */}
      <div data-w="bg" style={{ ...FILL, willChange: 'opacity' }}>
        <div data-w="water" style={{ ...FILL, willChange: 'transform' }}>
          <div
            data-w="amp"
            style={{ position: 'absolute', left: 0, right: 0, bottom: '100%', height: 48, overflow: 'hidden', transformOrigin: 'bottom', willChange: 'transform' }}
          >
            <Wave id="bw2" i={2} color={alpha(C.sky, 0.16)} />
            <Wave id="bw0" i={0} color={alpha(C.white, 0.45)} />
            <Wave id="bw1" i={1} color={alpha(C.sky, 0.3)} />
          </div>
          <div style={{ ...FILL, background: `linear-gradient(${alpha(C.sky, 0.3)}, ${alpha(C.sky, 0.5)} 70%)` }} />
        </div>
        <svg data-w="drip" viewBox="18 6 64 91" width="20" height="28" style={MOVER}>
          <path d={DROP} fill="url(#wbDrop)" />
        </svg>
        <div
          data-w="ripple"
          style={{ ...MOVER, width: 40, height: 10, margin: '-5px 0 0 -20px', borderRadius: '50%', border: `2px solid ${alpha(C.white, 0.8)}` }}
        />
      </div>

      {/* Hero orb: saturated art over a water-tinted disc; the disc is what grows to fill the viewport. */}
      <div data-w="orb" style={{ ...MOVER, borderRadius: '50%', overflow: 'hidden' }}>
        <div style={{ ...FILL, background: `radial-gradient(circle at 35% 30%, ${alpha(C.sky, 0.25)}, ${alpha(C.sky, 0.45)} 70%)` }} />
        <div
          data-w="deep"
          style={{ ...FILL, background: `linear-gradient(145deg, ${C.sky300}, ${C.sky}, ${C.sky500}, ${C.skydeep})`, willChange: 'opacity' }}
        >
          <div
            data-w="shimmer"
            style={{
              position: 'absolute',
              inset: '-40% -10% auto',
              height: '120%',
              background: `radial-gradient(60% 50% at 30% 0%, ${alpha(C.white, 0.35)}, ${alpha(C.white, 0)} 70%)`,
              willChange: 'transform',
            }}
          />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '17%' }}>
            <Wave id="ow2" i={2} color={alpha(C.white, 0.18)} />
            <Wave id="ow0" i={0} color={alpha(C.white, 0.28)} />
            <Wave id="ow1" i={1} color={alpha(C.white, 0.45)} />
          </div>
          <svg
            data-w="bob"
            viewBox="0 0 100 100"
            style={{ position: 'absolute', left: '50%', top: '50%', width: '27%', height: '27%', willChange: 'transform' }}
          >
            <defs>
              <radialGradient id="wbDrop" cx="36%" cy="30%" r="78%">
                <stop offset="0%" stopColor={C.white} />
                <stop offset="35%" stopColor={C.foam} />
                <stop offset="70%" stopColor={C.drop} />
                <stop offset="100%" stopColor={C.skydeep} />
              </radialGradient>
            </defs>
            <path d={DROP} fill="url(#wbDrop)" />
            <ellipse cx="36" cy="48" rx="10" ry="16" fill={C.white} opacity="0.6" />
            <circle cx="62" cy="72" r="6" fill={C.white} opacity="0.25" />
          </svg>
        </div>
      </div>

      {BUBBLES.map(([, size], i) => (
        <span
          key={i}
          data-w={`b${i}`}
          style={{
            ...MOVER,
            width: size,
            height: size,
            borderRadius: '50%',
            background: `radial-gradient(circle at 35% 35%, ${C.white}, ${alpha(C.white, 0.5)} 45%, ${alpha(C.bg, 0.9)})`,
          }}
        />
      ))}
    </div>
  );
}

const nodeCache = new WeakMap();

export function applyScene(root, { orb, bg, drip, ripple, bubbles }) {
  let n = nodeCache.get(root);
  if (!n) {
    n = {};
    root.querySelectorAll('[data-w]').forEach((el) => { n[el.dataset.w] = el.style; });
    nodeCache.set(root, n);
  }
  root.style.opacity = '1';

  n.bg.opacity = bg.opacity;
  n.water.transform = `translateY(${bg.level}px)`;
  n.amp.transform = `scaleY(${bg.amp})`;
  bg.waves.forEach((f, i) => { n[`bw${i}`].transform = `translateX(${-50 * f}%)`; });
  n.drip.transform = `translate(${drip.x - 10}px, ${drip.y}px)`;
  n.drip.opacity = drip.o;
  n.ripple.transform = `translate(${ripple.x}px, ${ripple.y}px) scale(${ripple.s})`;
  n.ripple.opacity = ripple.o;

  const d = `${orb.d}px`;
  if (n.orb.width !== d) n.orb.width = n.orb.height = d; // layout change only, never per-frame
  n.orb.transform = `translate(${orb.x}px, ${orb.y}px) scale(${orb.scale})`;
  n.orb.opacity = orb.opacity;
  n.deep.opacity = orb.deep;
  n.shimmer.transform = `translateX(${orb.shimmer}%)`;
  orb.waves.forEach((f, i) => { n[`ow${i}`].transform = `translateX(${-50 * f}%)`; });
  n.bob.transform = `translate(-50%, ${-58 + orb.bob}%) scale(${orb.bobScale})`;

  BUBBLES.forEach((_, i) => {
    const b = bubbles[i];
    const s = n[`b${i}`];
    s.display = b ? '' : 'none';
    if (b) {
      s.transform = `translate(${b.x}px, ${b.y}px) scale(${b.scale})`;
      s.opacity = b.o;
    }
  });
}

export default function WaterBackground() {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    const anchor = document.querySelector('[data-water-anchor]');
    if (!root || !anchor) return undefined;

    const reducedMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let layout;
    let y = window.scrollY;
    let raf = 0;

    const measure = () => {
      const r = anchor.getBoundingClientRect();
      const de = document.documentElement;
      layout = {
        vw: de.clientWidth,
        vh: window.innerHeight,
        scrollMax: Math.max(1, de.scrollHeight - window.innerHeight),
        anchor: { x: r.left, y: r.top + window.scrollY, d: r.width },
        reduced: reducedMq.matches,
      };
    };
    // Ambient motion keeps the loop running; reduced motion only repaints on scroll/resize.
    const frame = (now) => {
      raf = 0;
      applyScene(root, getScene(y / layout.scrollMax, now / 1000, { ...layout, scrollY: y }));
      if (!layout.reduced && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const onScroll = () => { y = window.scrollY; kick(); };
    const onResize = () => { measure(); kick(); };

    measure();
    kick();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', kick);
    reducedMq.addEventListener('change', onResize);
    const ro = new ResizeObserver(onResize); // page height changes (fonts, async content)
    ro.observe(document.body);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', kick);
      reducedMq.removeEventListener('change', onResize);
      ro.disconnect();
    };
  }, []);

  return <WaterMarkup ref={ref} />;
}
