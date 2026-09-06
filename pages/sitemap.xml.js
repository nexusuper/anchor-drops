import { canonicalFor } from '@/lib/seo';

// Static marketing/order pages only — /admin and /api are excluded via
// robots.txt and have no reason to appear in a sitemap. /order/confirmation
// and /track results are per-order/per-lookup, not indexable destinations.
const ROUTES = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/order', changefreq: 'weekly', priority: '0.9' },
  { path: '/products', changefreq: 'weekly', priority: '0.8' },
  { path: '/track', changefreq: 'monthly', priority: '0.5' },
  { path: '/rewards', changefreq: 'monthly', priority: '0.5' },
  { path: '/privacy', changefreq: 'yearly', priority: '0.2' },
];

function buildSitemap() {
  const urls = ROUTES.map(
    ({ path, changefreq, priority }) => `  <url>
    <loc>${canonicalFor(path)}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

export async function getServerSideProps({ res }) {
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
  res.write(buildSitemap());
  res.end();
  return { props: {} };
}

export default function Sitemap() {
  return null;
}
