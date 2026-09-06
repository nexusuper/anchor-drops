// Single source of truth for customer testimonials — both the visible cards
// in components/Testimonials.js and the Review/AggregateRating JSON-LD in
// pages/index.js read from this same array. That's deliberate: Google's
// review-rich-result guidelines require structured data to match what's
// actually visible on the page, so the rating shown to search engines can
// never drift from the rating shown to people without both being edited
// here, together, in one place.
//
// PLACEHOLDER CONTENT — replace every entry with a real customer's name,
// barangay, and actual words before this ships. A fabricated testimonial
// (and the fabricated schema it would produce) is worse than none: no proof
// of trust today, but a manual action from Google — or a screenshot of a
// made-up person — tomorrow if anyone checks.
export const TESTIMONIALS = [
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

// Builds the aggregateRating + review fields for LocalBusiness JSON-LD,
// computed from TESTIMONIALS rather than hardcoded — there is no code path
// that lets the schema claim a rating unbacked by an actual visible entry.
export function testimonialsSchema(testimonials) {
  if (!testimonials.length) return {};
  const ratingValue = testimonials.reduce((sum, t) => sum + t.rating, 0) / testimonials.length;
  return {
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: Number(ratingValue.toFixed(1)),
      reviewCount: testimonials.length,
    },
    review: testimonials.map((t) => ({
      '@type': 'Review',
      author: { '@type': 'Person', name: t.name },
      reviewRating: { '@type': 'Rating', ratingValue: t.rating, bestRating: 5 },
      reviewBody: t.quote,
    })),
  };
}
