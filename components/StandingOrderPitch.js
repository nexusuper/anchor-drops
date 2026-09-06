import ClayCard from '@/components/ui/ClayCard';
import ClayIcon from '@/components/ui/ClayIcon';
import { FB_PAGE_ID } from '@/pages/_app';
import { GALLONS_PER_VOUCHER } from '@/lib/loyalty';

// No self-serve subscription exists in this app — no recurring billing, no
// saved payment method, no cron. This pitches a real thing staff already do
// manually: a customer messages once, staff remembers the schedule, and
// every delivery (standing or one-off) counts the same toward the loyalty
// voucher — computeRewards() in lib/loyalty.js sums all delivered orders for
// a phone number regardless of how the order was placed. Nothing here is a
// promise the backend can't keep.
export default function StandingOrderPitch() {
  return (
    <section className="max-w-6xl mx-auto px-4 py-16">
      <ClayCard className="reveal p-8 md:p-12 grid grid-cols-1 md:grid-cols-[auto_1fr_auto] items-center gap-8 text-center md:text-left">
        <div className="mx-auto md:mx-0 grid place-items-center w-16 h-16 rounded-[20px] clay-raised-sm clay-tile-sky shrink-0">
          <ClayIcon name="refresh" className="w-8 h-8 text-clay-sky" />
        </div>
        <div>
          <span className="section-pill mb-3 inline-block">Never Run Out</span>
          <h2 className="font-editorial text-2xl md:text-3xl font-bold text-clay-ink leading-[1.15] mb-2">
            Set a standing order, skip the reminders.
          </h2>
          <p className="text-clay-muted font-semibold text-sm md:text-base leading-relaxed max-w-xl">
            Message us once to set a weekly or biweekly delivery day — we&apos;ll remember your
            address, product, and schedule so you don&apos;t have to reorder every time. Every
            delivery still counts toward your free refill after {GALLONS_PER_VOUCHER} gallons, same
            as any other order.
          </p>
        </div>
        {FB_PAGE_ID && (
          <a
            href={`https://m.me/${FB_PAGE_ID}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 font-editorial font-semibold text-white clay-pressable clay-tile-blue-shadow whitespace-nowrap shrink-0"
          >
            <ClayIcon name="chat" className="w-5 h-5" /> Set Up a Standing Order
          </a>
        )}
      </ClayCard>
    </section>
  );
}
