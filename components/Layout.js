import Navbar from './Navbar';
import Footer from './Footer';
import Head from 'next/head';
import { canonicalFor } from '@/lib/seo';
import { BUSINESS_PHONE_TEL, STORE_ADDRESS_DISPLAY, STORE_LAT, STORE_LNG, PRODUCTS } from '@/lib/products';
import { STORE_HOURS_LABEL } from '@/lib/scheduling';

const DESCRIPTION = 'Order fresh purified water refills delivered to your door. No login required.';

// LocalBusiness JSON-LD — base fields same on every page on purpose. Google
// dedupes identical structured data across a site's pages; what matters is
// that it's present and consistent, not page-specific.
//
// `schemaExtra` (e.g. aggregateRating/review from lib/testimonials.js) is
// deliberately NOT baked in here — Google's review-rich-result guidelines
// require review markup to match content actually visible on that page.
// Testimonials only render on the homepage, so only pages.index.js passes
// schemaExtra; every other page gets the base schema with no rating claim.
function buildLocalBusinessSchema(schemaExtra = {}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: 'Anchor Drops',
    image: canonicalFor('/og-image.png'),
    url: canonicalFor('/'),
    telephone: BUSINESS_PHONE_TEL,
    priceRange: `₱${Math.min(...PRODUCTS.map((p) => p.refill))}-₱${Math.max(...PRODUCTS.map((p) => p.refill))}`,
    address: {
      '@type': 'PostalAddress',
      streetAddress: STORE_ADDRESS_DISPLAY,
      addressLocality: 'Cagayan de Oro',
      addressRegion: 'Misamis Oriental',
      addressCountry: 'PH',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: STORE_LAT,
      longitude: STORE_LNG,
    },
    // Mon-Sat, 8:00-12:00 and 13:00-17:00 — kept in sync with lib/scheduling.js.
    openingHoursSpecification: [
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        opens: '08:00',
        closes: '12:00',
      },
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        opens: '13:00',
        closes: '17:00',
      },
    ],
    ...schemaExtra,
  };
}

export default function Layout({ children, title = 'Anchor Drops — Pure Water Delivery', schemaExtra }) {
  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={DESCRIPTION} />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Anchor Drops" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:image" content={canonicalFor('/og-image.png')} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={DESCRIPTION} />
        <meta name="twitter:image" content={canonicalFor('/og-image.png')} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(buildLocalBusinessSchema(schemaExtra)) }}
        />
      </Head>
      <div className="min-h-screen flex flex-col bg-clay-bg">
        <a href="#main" className="skip-link">Skip to content</a>
        <Navbar />
        <main id="main" className="flex-1">{children}</main>
        <Footer />
      </div>
    </>
  );
}
