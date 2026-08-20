import Layout from '@/components/Layout';
import { BUSINESS_PHONE_DISPLAY } from '@/lib/products';

// Boilerplate privacy policy for the water-refill service. Not legal advice —
// the owner should review and adjust to their actual practices before relying on it.
const EFFECTIVE_DATE = 'July 24, 2026';

function Section({ title, children }) {
  return (
    <section className="space-y-2">
      <h2 className="font-editorial text-xl font-bold text-clay-ink">{title}</h2>
      <div className="space-y-2 text-clay-ink2">{children}</div>
    </section>
  );
}

export default function Privacy() {
  return (
    <Layout title="Privacy Policy — Anchor Drops">
      <section className="max-w-2xl mx-auto px-4 pt-14 pb-4 reveal">
        <span className="section-pill mb-5 inline-block">Privacy Policy</span>
        <h1 className="font-editorial text-4xl font-bold leading-[1.08] tracking-tight text-clay-ink">
          Your privacy <span style={{ color: '#0ea5e9' }}>matters.</span>
        </h1>
        <p className="text-clay-muted font-semibold mt-3">Last updated {EFFECTIVE_DATE}</p>
      </section>

      <div className="max-w-2xl mx-auto px-4 py-10 space-y-7 leading-relaxed">
        <p className="text-clay-ink2">
          Anchor Drops (&ldquo;we,&rdquo; &ldquo;us,&rdquo; &ldquo;our&rdquo;) is a purified-water refill and
          delivery service in Bugo, Cagayan de Oro, Philippines. This policy explains what information we
          collect when you order from us, how we use it, and the choices you have. By placing an order or
          messaging us, you agree to this policy.
        </p>

        <Section title="Information we collect">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Order details</strong> — your name, phone number, delivery address, an optional map
              pin (GPS location) you choose to share, and the products and quantities you order.</li>
            <li><strong>Payment information</strong> — your chosen payment method (Cash on Delivery, or
              GCash/Bank Transfer). For GCash/Bank Transfer payments you may optionally upload a payment screenshot and
              reference number. We do <strong>not</strong> collect card numbers, bank logins, or GCash passwords.</li>
            <li><strong>Facebook Messenger</strong> — if you tap &ldquo;link Messenger&rdquo; or message our
              Facebook Page, we receive your Messenger ID so we can send order updates and free-refill reward
              codes. Your use of Messenger is also governed by Meta&rsquo;s own privacy policy.</li>
            <li><strong>Website analytics</strong> — our website uses the Meta (Facebook) Pixel to understand
              visits and orders and to measure our advertising.</li>
          </ul>
        </Section>

        <Section title="How we use your information">
          <ul className="list-disc pl-5 space-y-1">
            <li>Prepare, route, and deliver your water orders.</li>
            <li>Let you track an order by Order ID or by the phone number you ordered with.</li>
            <li>Run our loyalty program (free refills) and confirm reward redemptions.</li>
            <li>Send order status updates and reward codes via Facebook Messenger — and by SMS if you opt in.</li>
            <li>Provide customer support and keep records of your orders.</li>
          </ul>
        </Section>

        <Section title="How we share your information">
          <p>We do <strong>not</strong> sell your personal information. We share it only:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>With our own delivery staff, so they can fulfill and deliver your order.</li>
            <li>With service providers that run our system on our behalf: <strong>Supabase</strong> (secure
              database and file storage), <strong>Meta / Facebook</strong> (Messenger messages and the Pixel),
              and our SMS provider if SMS updates are enabled.</li>
            <li>When required by law.</li>
          </ul>
        </Section>

        <Section title="How we store and protect it">
          <p>
            Your information is stored in our Supabase database. Payment screenshots are kept in private
            storage and are only viewable by our staff through short-lived, secure links — they are never
            posted publicly.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p>
            We keep your order and reward information for as long as needed to serve you and to keep accurate
            business records. You can ask us to delete your information at any time (see below).
          </p>
        </Section>

        <Section title="Your choices and rights">
          <ul className="list-disc pl-5 space-y-1">
            <li>Request a copy of, a correction to, or deletion of your personal information by contacting us.</li>
            <li>Stop receiving Messenger updates by unlinking or messaging our Facebook Page.</li>
            <li>Choose not to share a map pin — a written address works fine.</li>
          </ul>
        </Section>

        <Section title="Children">
          <p>
            Anchor Drops is intended for adults arranging household water delivery. It is not directed to
            children under 13, and we do not knowingly collect their information.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            We may update this policy from time to time. The &ldquo;last updated&rdquo; date above shows when
            it last changed.
          </p>
        </Section>

        <Section title="Contact us">
          <p>
            Questions about your privacy or a request about your data? Message us on our Facebook Page, or call
            us at <strong>{BUSINESS_PHONE_DISPLAY}</strong>. Anchor Drops — Bugo, Cagayan de Oro City, Philippines.
          </p>
        </Section>
      </div>
    </Layout>
  );
}
