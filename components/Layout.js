import Navbar from './Navbar';
import Footer from './Footer';
import Head from 'next/head';

export default function Layout({ children, title = 'Anchor Drops — Pure Water Delivery' }) {
  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content="Order fresh purified water refills delivered to your door. No login required." />
        <link rel="icon" href="/favicon.ico" />
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
