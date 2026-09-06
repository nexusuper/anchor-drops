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

// The exact placeholder quote text above. Kept as a sentinel so the schema
// builder can tell a swapped-in real testimonial from one nobody's edited
// yet — no separate flag to remember to flip, and it self-corrects the
// moment a real quote replaces this string.
const PLACEHOLDER_QUOTE = TESTIMONIALS[0].quote;

// Builds the aggregateRating + review fields for LocalBusiness JSON-LD,
// computed from TESTIMONIALS rather than hardcoded — there is no code path
// that lets the schema claim a rating unbacked by an actual visible entry.
// Placeholder entries (still carrying PLACEHOLDER_QUOTE) are excluded
// entirely: this can never tell Google a real review exists until someone
// has actually replaced the quote text with real customer words.
export function testimonialsSchema(testimonials) {
  const real = testimonials.filter((t) => t.quote !== PLACEHOLDER_QUOTE);
  if (!real.length) return {};
  const ratingValue = real.reduce((sum, t) => sum + t.rating, 0) / real.length;
  return {
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: Number(ratingValue.toFixed(1)),
      reviewCount: real.length,
    },
    review: real.map((t) => ({
      '@type': 'Review',
      author: { '@type': 'Person', name: t.name },
      reviewRating: { '@type': 'Rating', ratingValue: t.rating, bestRating: 5 },
      reviewBody: t.quote,
    })),
  };
}
