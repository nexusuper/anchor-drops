import { FB_PAGE_ID } from '@/pages/_app';
import { useRouter } from 'next/router';

// Meta shut down the Customer Chat Plugin (the fb-customerchat SDK widget) on
// May 9, 2024. The sanctioned replacement is an m.me deep link. This is a plain
// floating button — no SDK, no CSP exceptions, no app review required.
export default function MessengerButton() {
  const { pathname } = useRouter();
  if (!FB_PAGE_ID) return null;

  return (
    <a
      href={`https://m.me/${FB_PAGE_ID}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with us on Messenger"
      title="Chat with us on Messenger"
      className={`fixed ${pathname === '/order' ? 'bottom-24 md:bottom-5' : 'bottom-5'} right-5 z-50 flex items-center gap-2 pl-4 pr-5 h-14 rounded-full bg-[#0084FF] shadow-lg hover:bg-[#006AFF] hover:scale-105 active:scale-95 transition-all`}
    >
      <svg viewBox="0 0 24 24" className="w-7 h-7 shrink-0" fill="white" aria-hidden="true">
        <path d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.19 5.44 3.14 7.17.16.14.26.35.27.57l.05 1.78c.03.57.61.94 1.13.71l1.99-.88c.17-.07.36-.09.54-.04 0 0 .9.27 1.81.27 5.64 0 10-4.13 10-9.7S17.64 2 12 2zm6 7.46l-2.94 4.66c-.47.74-1.47.93-2.18.4l-2.34-1.75a.6.6 0 0 0-.72 0l-3.16 2.4c-.42.32-.97-.18-.69-.63l2.94-4.66c.47-.74 1.47-.93 2.18-.4l2.34 1.75c.21.16.51.16.72 0l3.16-2.4c.42-.32.97.18.69.63z" />
      </svg>
      <span className="text-white font-semibold text-base">Message us</span>
    </a>
  );
}
