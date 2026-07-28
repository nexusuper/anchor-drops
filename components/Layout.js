import Navbar from './Navbar';
import Footer from './Footer';
import Head from 'next/head';

// og:image must be absolute. Set NEXT_PUBLIC_SITE_URL in Vercel; the fallback is
// the production host.
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://anchor-drops.vercel.app').replace(/\/$/, '');
const DESCRIPTION = 'Order fresh purified water refills delivered to your door. No login required.';

export default function Layout({ children, title = 'Anchor Drops — Pure Water Delivery' }) {
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
        <meta property="og:image" content={`${SITE_URL}/og-image.png`} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={DESCRIPTION} />
        <meta name="twitter:image" content={`${SITE_URL}/og-image.png`} />
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
