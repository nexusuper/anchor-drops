import "@/styles/globals.css";
import Head from 'next/head';
import Script from 'next/script';
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import MessengerButton from '@/components/MessengerButton';
import { canonicalFor } from '@/lib/seo';
import { reportError } from '@/lib/reportError';
import { trackPageview, initClickTracking } from '@/lib/track';
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
    const onError = (e) => reportError(e.error || e.message, { type: 'window.onerror' });
    const onRejection = (e) => reportError(e.reason, { type: 'unhandledrejection' });
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  useEffect(() => {
    const handleRouteChange = () => pageview();
    router.events.on('routeChangeComplete', handleRouteChange);
    return () => router.events.off('routeChangeComplete', handleRouteChange);
  }, [router.events]);

  // First-party visitor tracking — skip /admin so staff using the panel never
  // count as site traffic.
  useEffect(() => {
    initClickTracking();
    const track = (url) => { if (!url.startsWith('/admin')) trackPageview(url); };
    track(router.asPath);
    router.events.on('routeChangeComplete', track);
    return () => router.events.off('routeChangeComplete', track);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll-reveal: add .is-visible to .reveal elements as they enter the viewport
  useEffect(() => {
    const selector = '.reveal:not(.is-visible)';
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.1 });
    const visit = (node, callback) => {
      if (!(node instanceof Element)) return;
      if (node.matches(selector)) callback(node);
      node.querySelectorAll(selector).forEach(callback);
    };
    const mutations = new MutationObserver((records) => {
      for (const { addedNodes, removedNodes } of records) {
        removedNodes.forEach((node) => visit(node, (el) => observer.unobserve(el)));
        addedNodes.forEach((node) => visit(node, (el) => observer.observe(el)));
      }
    });
    visit(document.body, (el) => observer.observe(el));
    mutations.observe(document.body, { childList: true, subtree: true });
    return () => {
      mutations.disconnect();
      observer.disconnect();
    };
  }, []);


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
