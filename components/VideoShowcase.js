import { useEffect, useRef, useState } from 'react';

export default function VideoShowcase() {
  const videoRef = useRef(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.muted = true;
    const p = el.play();
    if (p?.catch) p.catch(() => {});
  }, []);

  const toggleMute = () => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  };

  return (
    <section className="max-w-6xl mx-auto px-4 py-16">

      {/* Editorial header — left-aligned, offset from video */}
      <div className="reveal flex items-end justify-between gap-4 mb-6 flex-wrap">
        <div>
          <span className="section-pill mb-3 inline-block">Our Process</span>
          <h2 className="font-editorial text-3xl md:text-4xl font-bold text-clay-ink leading-tight tracking-tight">
            Water made clean.<br className="hidden md:block" /> Delivered to your door.
          </h2>
        </div>
        <p className="text-clay-muted font-semibold text-sm max-w-[38ch] self-end pb-1">
          From source to your 5-gallon container — every drop goes through our purification line before it leaves the station.
        </p>
      </div>

      {/* Video block — cinematic, no browser chrome */}
      <div className="reveal reveal-d1 relative overflow-hidden rounded-[2rem] clay-raised group">

        {/* 16:9 aspect ratio shell */}
        <div className="relative" style={{ paddingTop: '56.25%' }}>

          <video
            ref={videoRef}
            src="/brand-video.mp4"
            muted
            loop
            playsInline
            preload="metadata"
            className="absolute inset-0 w-full h-full object-cover"
            aria-label="Anchor Drops water purification and delivery process"
          />

          {/* Gradient scrim — bottom third only, ink-tinted */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'linear-gradient(to top, rgba(12,74,110,0.72) 0%, rgba(12,74,110,0.18) 36%, transparent 62%)',
            }}
          />

          {/* Bottom-left copy — asymmetric per DESIGN_VARIANCE 8 */}
          <div className="absolute bottom-6 left-7 pointer-events-none select-none">
            <p
              className="text-[10px] font-bold tracking-[0.22em] uppercase mb-1.5"
              style={{ color: 'rgba(186,230,253,0.9)' }}
            >
              Anchor Drops — Purified Water
            </p>
            <h3
              className="font-editorial text-white text-xl md:text-2xl font-bold leading-snug tracking-tight"
              style={{ textShadow: '0 1px 8px rgba(0,0,0,0.35)', maxWidth: '32ch' }}
            >
              Pure water, prepared fresh for every order
            </h3>
          </div>

          {/* Mute toggle — liquid glass pill, bottom-right */}
          <button
            onClick={toggleMute}
            className="absolute bottom-6 right-6 flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold text-white clay-pressable"
            style={{
              background: 'rgba(255,255,255,0.12)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(255,255,255,0.18)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14)',
              transition: 'background 0.2s cubic-bezier(0.16,1,0.3,1)',
            }}
            aria-label={muted ? 'Unmute video' : 'Mute video'}
          >
            {muted ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            )}
            <span>{muted ? 'Tap for sound' : 'Mute'}</span>
          </button>

          {/* Hairline accent strip at the very bottom */}
          <div
            className="absolute bottom-0 left-0 right-0 h-[2px] pointer-events-none"
            style={{ background: 'linear-gradient(90deg, #38bdf8, #0284c7, #38bdf8)' }}
          />

        </div>
      </div>
    </section>
  );
}
