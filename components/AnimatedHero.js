import ClayButton from './ui/ClayButton';

export default function AnimatedHero() {
  return (
    <section className="min-h-[88dvh] flex items-center px-4 py-10">
      <div className="max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-12 lg:gap-16 items-center">

        {/* Left — editorial content */}
        <div className="flex flex-col gap-6">
          <div>
            <span className="section-pill text-clay-ink!">Pure Water Delivery · Bugo, Cagayan de Oro</span>
          </div>

          <h1 className="font-editorial text-5xl md:text-[4.5rem] font-bold leading-[1.04] tracking-tight text-clay-ink">
            Skip the Call.
            <br />
            <span className="text-clay-ink2">Order Water Online.</span>
          </h1>

          <p className="text-clay-ink text-lg font-semibold leading-relaxed max-w-[50ch]">
            Need water? We&apos;ve got you. Order a refill in under two minutes — no account, no phone call. Pick it up at the store or have it delivered.
          </p>

          <div className="flex flex-wrap gap-3">
            <ClayButton href="/order" size="lg">ORDER WATER</ClayButton>
            <ClayButton href="/products" variant="outline" size="lg">VIEW PRICES</ClayButton>
          </div>

        </div>

        {/* Right — slot for the water orb. The orb itself is drawn by the fixed
            <WaterBackground> layer (components/water), which tracks this box. */}
        <div className="flex justify-center lg:justify-end">
          <div data-water-anchor aria-hidden="true" className="w-[300px] h-[300px] sm:w-[380px] sm:h-[380px]" />
        </div>
      </div>
    </section>
  );
}
