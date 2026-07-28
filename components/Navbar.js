import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import ClayIcon from './ui/ClayIcon';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/products', label: 'Products' },
  { href: '/rewards', label: 'Rewards' },
  { href: '/track', label: 'Track Order' },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const { pathname } = useRouter();
  const isActive = (href) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <nav className="sticky top-0 z-40 px-4 pt-4">
      <div className="max-w-6xl mx-auto flex items-center justify-between rounded-3xl px-5 py-3 nav-glass shadow-sm">
        {/* Pill logo */}
        <Link href="/" className="flex items-center">
          <span className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 clay-raised-sm">
            <ClayIcon name="drop" className="w-4 h-4" fill="#38bdf8" stroke="none" />
            <span className="font-editorial font-bold text-sm tracking-tight text-clay-ink">
              Anchor <span className="text-clay-skydeep">Drops</span>
            </span>
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-7">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(l.href) ? 'page' : undefined}
              className="relative font-semibold text-sm transition-colors"
              style={{ color: isActive(l.href) ? '#0284c7' : '#5b7c91' }}
            >
              {l.label}
              {isActive(l.href) && (
                <span
                  className="absolute -bottom-0.5 left-0 right-0 h-[2px] rounded-full"
                  style={{ background: '#38bdf8' }}
                />
              )}
            </Link>
          ))}
          <Link
            href="/order"
            className="rounded-full px-5 py-2 font-editorial font-semibold text-sm text-white clay-btn-primary clay-pressable"
          >
            Order Now
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden text-clay-ink2 clay-raised-sm rounded-full w-11 h-11 grid place-items-center"
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
        >
          <ClayIcon name={open ? 'close' : 'menu'} className="w-7 h-7" />
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden max-w-6xl mx-auto mt-2 rounded-3xl p-4 flex flex-col gap-2 clay-raised">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(l.href) ? 'page' : undefined}
              className="py-2 font-semibold text-sm"
              style={{ color: isActive(l.href) ? '#0284c7' : '#5b7c91' }}
              onClick={() => setOpen(false)}
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/order"
            className="text-center rounded-full px-5 py-2.5 font-editorial font-semibold text-sm text-white clay-btn-primary"
            onClick={() => setOpen(false)}
          >
            Order Now
          </Link>
        </div>
      )}
    </nav>
  );
}
