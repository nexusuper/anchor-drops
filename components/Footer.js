import Link from 'next/link';
import ClayIcon from './ui/ClayIcon';
import { BUSINESS_PHONE_DISPLAY, BUSINESS_PHONE_TEL, BUSINESS_EMAIL } from '@/lib/products';
import { STORE_HOURS_LABEL } from '@/lib/scheduling';

const QUICK_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/products', label: 'Products & Pricing' },
  { href: '/rewards', label: 'Rewards' },
  { href: '/order', label: 'Order Now' },
  { href: '/track', label: 'Track Order' },
];

export default function Footer() {
  return (
    <footer className="mt-auto px-4 pb-4">
      <div className="max-w-6xl mx-auto rounded-[2rem] px-8 py-12 clay-raised">
        <div className="grid grid-cols-1 md:grid-cols-[1.6fr_1fr_1fr] gap-10">
          {/* Brand column */}
          <div>
            <Link href="/" className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 mb-5 clay-raised-sm">
              <ClayIcon name="drop" className="w-4 h-4" fill="#38bdf8" stroke="none" />
              <span className="font-editorial font-bold text-sm tracking-tight text-clay-ink">
                Anchor <span className="text-clay-skydeep">Drops</span>
              </span>
            </Link>
            <p className="text-sm font-semibold leading-relaxed max-w-[26ch] text-clay-muted">
              Fresh, clean water delivered to your doorstep. No account needed — just order and we deliver.
            </p>
          </div>

          {/* Quick links */}
          <div>
            <h4 className="font-editorial font-semibold text-xs uppercase tracking-widest mb-4 text-clay-muted">
              Quick Links
            </h4>
            <ul className="space-y-2.5">
              {QUICK_LINKS.map(({ href, label }) => (
                <li key={href}>
                  <Link href={href} className="text-sm font-semibold text-clay-muted hover:text-clay-skydeep transition-colors">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="font-editorial font-semibold text-xs uppercase tracking-widest mb-4 text-clay-muted">
              Contact
            </h4>
            <ul className="space-y-3">
              <li>
                <a href={`tel:${BUSINESS_PHONE_TEL}`} className="flex items-center gap-2.5 text-base font-bold text-clay-skydeep hover:underline">
                  <ClayIcon name="phone" className="w-4 h-4 text-clay-sky shrink-0" /> {BUSINESS_PHONE_DISPLAY}
                </a>
              </li>
              <li>
                <a href={`mailto:${BUSINESS_EMAIL}`} className="flex items-center gap-2.5 text-sm font-semibold text-clay-muted hover:text-clay-skydeep transition-colors break-all">
                  <ClayIcon name="chat" className="w-4 h-4 text-clay-sky shrink-0" /> {BUSINESS_EMAIL}
                </a>
              </li>
              <li className="flex items-center gap-2.5 text-sm font-semibold text-clay-muted">
                <ClayIcon name="info" className="w-4 h-4 text-clay-sky shrink-0" /> {STORE_HOURS_LABEL}
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-sky-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-semibold text-clay-muted">
          <span>© {new Date().getFullYear()} Anchor Drops. All rights reserved.</span>
          <span className="flex items-center gap-1.5">
            <ClayIcon name="chat" className="w-4 h-4 text-clay-sky shrink-0" />
            Chat with us on Facebook anytime
          </span>
        </div>
      </div>
    </footer>
  );
}
