import { useEffect, useRef } from 'react';
import ClayCard from './ui/ClayCard';

// Scroll-driven pipeline. JS writes one custom property, --q (0..1), as the section travels
// up the viewport; CSS derives each step's own 0..1 progress from it. 9 steps in order:
// tank 1, pipe, tank 2, pipe, tank 3, pipe, tank 4, pipe, tank 5. Without JS or with
// reduced motion --q stays at its default of 1: everything shown full and still.
const STEPS = 9;
const at = (i) => `clamp(0, calc(var(--q, 1) * ${STEPS} - ${i}), 1)`;
const SILT = [[22, 62], [58, 70], [40, 80]];

function Tank({ children, uv, i, silt }) {
  return (
    <div
      className={`relative mx-auto grid place-items-center overflow-hidden rounded-[18px] ${uv ? 'purify-uv' : 'clay-raised-sm'}`}
      style={{
        width: 84,
        height: 104,
        background: uv ? 'linear-gradient(145deg,#ede9fe,#ddd6fe)' : 'linear-gradient(145deg,#eaf6ff,#d3ecfb)',
        opacity: `calc(0.55 + 0.45 * ${at(i)})`,
        transform: `scale(calc(0.94 + 0.06 * ${at(i)}))`,
      }}
    >
      <div
        className="absolute inset-x-0 bottom-0 h-[70%] origin-bottom"
        style={{
          background: uv ? 'linear-gradient(#c4b5fd,#8b5cf6)' : 'linear-gradient(#7dd3fc,#0ea5e9)',
          opacity: uv ? 0.3 : 0.35,
          transform: `scaleY(${at(i)})`,
        }}
      />
      {/* Silt: murky source water; the sediment filter settles it out as its tank fills. */}
      {silt && (
        <div
          className="absolute inset-0"
          style={silt === 'settle' ? { opacity: `calc(1 - ${at(i)})`, transform: `translateY(calc(12px * ${at(i)}))` } : undefined}
        >
          {SILT.map(([x, y]) => (
            <span key={x} className="absolute w-1.5 h-1.5 rounded-full bg-clay-muted/60" style={{ left: `${x}%`, top: `${y}%` }} />
          ))}
        </div>
      )}
      <div className="relative z-10">{children}</div>
    </div>
  );
}

const Pipe = ({ i }) => (
  <div
    className="relative hidden sm:block self-start mt-12 h-3.5 w-8 overflow-hidden rounded-lg"
    style={{ background: '#d3ecfb', boxShadow: 'inset 2px 2px 4px #bcd7e8' }}
  >
    <div className="absolute inset-0 overflow-hidden" style={{ transform: `translateX(calc((${at(i)} - 1) * 100%))` }}>
      <div className="purify-stripes" />
    </div>
  </div>
);

const Stage = ({ step, label, uv, i, silt, children }) => (
  <div className="text-center" style={{ flex: 1, minWidth: 110 }}>
    <div className="mb-3"><Tank uv={uv} i={i} silt={silt}>{children}</Tank></div>
    <div className="text-[11px] font-extrabold tracking-wide" style={{ color: uv ? '#a78bfa' : '#7dd3fc' }}>STEP {step}</div>
    <div className="font-display font-semibold text-sm" style={{ color: uv ? '#7c3aed' : '#0369a1' }}>{label}</div>
  </div>
);

export default function PurifyProcess() {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    let raf = 0;
    // 0 when the section top enters at 85% of the viewport, 1 when its centre reaches 35%.
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const q = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (vh * 0.5 + r.height * 0.5)));
      el.style.setProperty('--q', q.toFixed(3));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <section ref={ref} className="max-w-5xl mx-auto px-4 py-14">
      <h2 className="text-center text-3xl font-bold text-clay-ink mb-1">How We Purify Your Water</h2>
      <p className="text-center text-clay-ink font-semibold mb-7">Every drop passes through 5 stages before it reaches your door</p>
      <ClayCard className="p-8">
        <div className="flex flex-wrap items-end justify-center sm:justify-between gap-5">
          <Stage step="1" label="Source Water" i={0} silt="still">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="#bae6fd" stroke="#0284c7" strokeWidth="2"><path d="M12 3C12 3 6 9 6 13.5a6 6 0 0 0 12 0C18 9 12 3 12 3z" /></svg>
          </Stage>
          <Pipe i={1} />
          <Stage step="2" label="Sediment Filter" i={2} silt="settle">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="#bae6fd" stroke="#0284c7" strokeWidth="2"><rect x="6" y="3" width="12" height="18" rx="3" /><path d="M6 9h12M6 14h12" strokeDasharray="2 2" /></svg>
          </Stage>
          <Pipe i={3} />
          <Stage step="3" label="Carbon Filter" i={4}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="#bae6fd" stroke="#0284c7" strokeWidth="2"><circle cx="12" cy="12" r="8" /><circle cx="9" cy="10" r="1.4" fill="#0284c7" /><circle cx="14" cy="13" r="1.4" fill="#0284c7" /><circle cx="11" cy="15" r="1.4" fill="#0284c7" /></svg>
          </Stage>
          <Pipe i={5} />
          <Stage step="4" label="UV Sterilizer" uv i={6}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="#ddd6fe" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round"><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3" /><circle cx="12" cy="12" r="3" /></svg>
          </Stage>
          <Pipe i={7} />
          <Stage step="5" label="Pure & Ready" i={8}>
            <div className="relative" style={{ width: 52, height: 88 }}>
              <div className="absolute left-1/2 -top-1.5 -translate-x-1/2 h-2.5 w-6 rounded bg-clay-skydeep" />
              <div className="absolute inset-0 overflow-hidden rounded-[12px] border-[3px] border-clay-sky bg-clay-surface">
                <div
                  className="absolute inset-x-0 bottom-0 h-[88%] origin-bottom"
                  style={{ background: 'linear-gradient(#7dd3fc,#0ea5e9)', transform: `scaleY(${at(8)})` }}
                />
                <div className="absolute top-2 left-2 w-2 h-9 rounded bg-white/60 z-10" />
              </div>
            </div>
          </Stage>
        </div>
      </ClayCard>
    </section>
  );
}
