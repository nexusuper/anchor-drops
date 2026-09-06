import ClayButton from './ui/ClayButton';

export default function AnimatedHero() {
  return (
    <section className="min-h-[88dvh] flex items-center px-4 py-10">
      <div className="max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-12 lg:gap-16 items-center">

        {/* Left — editorial content */}
        <div className="flex flex-col gap-6">
          <div>
            <span className="section-pill">Pure Water Delivery · Bugo, Cagayan de Oro</span>
          </div>

          <h1 className="font-editorial text-5xl md:text-[4.5rem] font-bold leading-[1.04] tracking-tight text-clay-ink">
            Fresh Water,{' '}
            <span style={{ color: '#0ea5e9' }}>Delivered</span>
            <br />to Your Door.
          </h1>

          <p className="text-clay-muted text-lg font-semibold leading-relaxed max-w-[50ch]">
            Order purified water refills in minutes. No account needed — fill the form and we deliver the same day.
          </p>

          <div className="flex flex-wrap gap-3">
            <ClayButton href="/order" size="lg">Order Now</ClayButton>
            <ClayButton href="/products" variant="outline" size="lg">See Pricing</ClayButton>
          </div>

        </div>

        {/* Right — animated water orb */}
        <div className="flex justify-center lg:justify-end">
          <div className="relative w-[300px] h-[300px] sm:w-[380px] sm:h-[380px]">
            {/* Gradient orb — clips all children */}
            <div
              className="absolute inset-0 rounded-full overflow-hidden"
              style={{ background: 'linear-gradient(145deg, #93c5fd, #38bdf8, #0ea5e9, #0284c7)' }}
            >
              <div className="hero-shimmer" />

              {/* Rising bubbles */}
              <span className="hero-bubble" style={{ left: '12%', width: 10, height: 10, animationDuration: '6s' }} />
              <span className="hero-bubble" style={{ left: '24%', width: 6,  height: 6,  animationDuration: '5s',   animationDelay: '1.5s' }} />
              <span className="hero-bubble" style={{ left: '78%', width: 12, height: 12, animationDuration: '7s',   animationDelay: '.8s'  }} />
              <span className="hero-bubble" style={{ left: '88%', width: 7,  height: 7,  animationDuration: '5.5s', animationDelay: '2.2s' }} />
              <span className="hero-bubble" style={{ left: '60%', width: 8,  height: 8,  animationDuration: '6.5s', animationDelay: '3s'   }} />

              {/* Wave band at the bottom of the orb */}
              <div className="absolute left-0 right-0 bottom-0 h-16">
                <svg
                  className="hero-wave hero-wave-1"
                  viewBox="0 0 1200 60"
                  preserveAspectRatio="none"
                  style={{ position: 'absolute', bottom: 0, width: '200%', height: '100%' }}
                >
                  <path d="M0,30 C150,60 350,0 600,30 C850,60 1050,0 1200,30 L1200,60 L0,60 Z" fill="rgba(255,255,255,.28)" />
                </svg>
                <svg
                  className="hero-wave hero-wave-2"
                  viewBox="0 0 1200 60"
                  preserveAspectRatio="none"
                  style={{ position: 'absolute', bottom: 0, width: '200%', height: '100%' }}
                >
                  <path d="M0,35 C200,5 400,55 600,35 C800,15 1000,55 1200,35 L1200,60 L0,60 Z" fill="rgba(255,255,255,.45)" />
                </svg>
              </div>
            </div>

            {/* 3D drop + drip + ripple — centered over the orb */}
            <div className="absolute inset-0 flex items-center justify-center" style={{ paddingBottom: '20px' }}>
              <div className="relative" style={{ width: 120, height: 150 }}>
                <svg className="hero-drop mx-auto" style={{ width: 104, height: 104 }} viewBox="0 0 100 100">
                  <defs>
                    <radialGradient id="heroDrop2" cx="36%" cy="30%" r="78%">
                      <stop offset="0%"   stopColor="#ffffff" />
                      <stop offset="35%"  stopColor="#cdefff" />
                      <stop offset="70%"  stopColor="#7dd3fc" />
                      <stop offset="100%" stopColor="#0284c7" />
                    </radialGradient>
                  </defs>
                  <path d="M50 6C50 6 18 44 18 65a32 32 0 0 0 64 0C82 44 50 6 50 6z" fill="url(#heroDrop2)" />
                  <ellipse cx="36" cy="48" rx="10" ry="16" fill="#ffffff" opacity="0.6" />
                  <circle cx="62" cy="72" r="6" fill="#ffffff" opacity="0.25" />
                </svg>
                <span className="hero-droplet" />
                <span className="hero-ripple" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
