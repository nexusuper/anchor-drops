import Layout from '@/components/Layout';
import ClayButton from '@/components/ui/ClayButton';

export default function NotFound() {
  return (
    <Layout title="Page Not Found — Anchor Drops">
      <section className="max-w-lg mx-auto px-4 pt-20 pb-16 text-center">
        <p className="font-editorial text-6xl font-bold text-clay-skydeep mb-3">404</p>
        <h1 className="font-editorial text-3xl font-bold leading-[1.08] tracking-tight text-clay-ink">
          We couldn&apos;t find that page.
        </h1>
        <p className="text-clay-muted font-semibold mt-3">
          The link may be old or mistyped. Here&apos;s the way back.
        </p>
        <div className="flex flex-col gap-3 mt-8">
          <ClayButton href="/" className="w-full">Back to Home</ClayButton>
          <ClayButton href="/track" variant="outline" className="w-full">Track an Order</ClayButton>
        </div>
      </section>
    </Layout>
  );
}
