import Head from "nextane/head";
import Link from "nextane/link";
import type { GetStaticProps } from "nextane";

interface IsrProps {
  generatedAt: string;
  revalidate: number;
}

export const getStaticProps: GetStaticProps<IsrProps> = async () => ({
  props: {
    generatedAt: new Date().toISOString(),
    revalidate: 10,
  },
  revalidate: 10,
});

export default function IsrPage({ generatedAt, revalidate }: IsrProps) {
  return (
    <main className="shell page">
      <Head>
        <title>ISR — Nextane</title>
      </Head>
      <p className="eyebrow">Incremental static regeneration</p>
      <h1>Cache the render, not the Worker.</h1>
      <p className="lede">
        This route declares <code>revalidate: {revalidate}</code>. The first
        request generates a combined HTML and page-data artifact; stale
        responses regenerate in the background.
      </p>
      <div className="data-card">
        <pre>{JSON.stringify({ generatedAt, revalidate }, null, 2)}</pre>
      </div>
      <p>
        <Link href="/">Return home →</Link>
      </p>
    </main>
  );
}
