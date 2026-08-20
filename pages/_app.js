import "@/styles/globals.css";
import Head from 'next/head';
import Script from 'next/script';
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import MessengerButton from '@/components/MessengerButton';
import { canonicalFor } from '@/lib/seo';
import { Fredoka, Nunito, Space_Grotesk } from 'next/font/google';

const fredoka = Fredoka({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-fredoka',
  display: 'swap',
});
const nunito = Nunito({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  variable: '--font-nunito',
  display: 'swap',
});
// Bold grotesk for the Nova-style homepage redesign.
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-grotesk',
  display: 'swap',
});

// Facebook Pixel helper
export const FB_PIXEL_ID = process.env.NEXT_PUBLIC_FB_PIXEL_ID;
// Sanitize to digits only — prevents script injection if env var is ever misset
export const FB_PAGE_ID = (process.env.NEXT_PUBLIC_FB_PAGE_ID || '1210958972092166').replace(/[^0-9]/g, '');

export const pageview = () => {
  if (typeof window !== 'undefined' && window.fbq) {
    window.fbq('track', 'PageView');
  }
};

export const trackPurchase = (value, currency = 'PHP') => {
  if (typeof window !== 'undefined' && window.fbq) {
    window.fbq('track', 'Purchase', { value, currency });
  }
};

export const trackLead = () => {
  if (typeof window !== 'undefined' && window.fbq) {
    window.fbq('track', 'Lead');
  }
};

export default function App({ Component, pageProps }) {
  const router = useRouter();

  useEffect(() => {
    const handleRouteChange = () => pageview();
    router.events.on('routeChangeComplete', handleRouteChange);
    return () => router.events.off('routeChangeComplete', handleRouteChange);
  }, [router.events]);

  // Scroll-reveal: add .is-visible to .reveal elements as they enter the viewport
  useEffect(() => {
    let obs;
    const attach = () => {
      obs = new IntersectionObserver(
        (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add('is-visible'); }),
        { threshold: 0.1 }
      );
      document.querySelectorAll('.reveal').forEach((el) => obs.observe(el));
    };
    attach();
    const onRoute = () => { obs?.disconnect(); setTimeout(attach, 80); };
    router.events.on('routeChangeComplete', onRoute);
    return () => { obs?.disconnect(); router.events.off('routeChangeComplete', onRoute); };
  }, [router.events]);


  return (
    <div className={`${fredoka.variable} ${nunito.variable} ${spaceGrotesk.variable}`}>
      <Head>
        {/* Query string stripped: ?ref=, ?fbclid= etc. must not generate distinct canonicals. */}
        <link rel="canonical" href={canonicalFor(router.asPath.split('?')[0])} />
      </Head>

      {/* Meta Pixel */}
      {FB_PIXEL_ID && (
        <Script
          id="fb-pixel"
          strategy="afterInteractive"
          src="https://connect.facebook.net/en_US/fbevents.js"
          onLoad={() => {
            window.fbq('init', FB_PIXEL_ID);
            window.fbq('track', 'PageView');
          }}
        />
      )}

      {/* Floating Messenger button.
          Meta shut down the Customer Chat Plugin (the fb-customerchat SDK widget)
          on May 9, 2024, so the old SDK approach can never render. m.me deep links
          are Meta's sanctioned replacement. */}
      <MessengerButton />

      <Component {...pageProps} />
    </div>
  );
}
