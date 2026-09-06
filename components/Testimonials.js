import ClayCard from '@/components/ui/ClayCard';
import ClayIcon from '@/components/ui/ClayIcon';

// PLACEHOLDER CONTENT — replace every entry with a real customer's name,
// barangay, and actual words before this ships. A fabricated testimonial is
// worse than none: no proof of trust today, but a screenshot of a made-up
// person tomorrow if anyone checks. Swap `name`/`area`/`quote` per entry;
// keep the shape the same.
const TESTIMONIALS = [
  {
    name: 'Add a real customer name',
    area: 'Barangay, CDO',
    quote: 'Replace with an actual quote from a real order — copy it verbatim from a Messenger review, Facebook comment, or ask a regular customer directly.',
    rating: 5,
  },
  {
    name: 'Add a real customer name',
    area: 'Barangay, CDO',
    quote: 'Replace with an actual quote from a real order — copy it verbatim from a Messenger review, Facebook comment, or ask a regular customer directly.',
    rating: 5,
  },
  {
    name: 'Add a real customer name',
    area: 'Barangay, CDO',
    quote: 'Replace with an actual quote from a real order — copy it verbatim from a Messenger review, Facebook comment, or ask a regular customer directly.',
    rating: 5,
  },
];

function Stars({ count }) {
  return (
    <div className="flex gap-0.5 mb-3" aria-label={`${count} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <ClayIcon
          key={i}
          name="star"
          className="w-4 h-4"
          fill={i < count ? '#38bdf8' : 'none'}
          stroke={i < count ? '#38bdf8' : 'currentColor'}
        />
      ))}
    </div>
  );
}

export default function Testimonials() {
  return (
    <section className="max-w-6xl mx-auto px-4 py-16">
      <div className="reveal text-center mb-10">
        <span className="section-pill mb-4 inline-block">What Customers Say</span>
        <h2 className="font-editorial text-4xl md:text-5xl font-bold text-clay-ink leading-[1.08]">
          Trusted by households across CDO.
        </h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {TESTIMONIALS.map((t, i) => (
          <ClayCard key={i} className={`p-6 reveal reveal-d${i}`}>
            <Stars count={t.rating} />
            <p className="text-clay-ink2 font-semibold text-sm leading-relaxed mb-4">&ldquo;{t.quote}&rdquo;</p>
            <p className="font-editorial font-bold text-clay-ink text-sm">{t.name}</p>
            <p className="text-clay-muted text-xs font-semibold">{t.area}</p>
          </ClayCard>
        ))}
      </div>
    </section>
  );
}
