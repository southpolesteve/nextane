import { useState } from "octane";
import Head from "nextane/head";
import Link from "nextane/link";
import type { GetStaticProps } from "nextane";

interface HomeProps {
  generatedAt: string;
  framework: string;
}

export const getStaticProps: GetStaticProps<HomeProps> = async () => ({
  props: {
    generatedAt: new Date().toISOString(),
    framework: "Octane 0.1.21",
  },
});

export default function Home({ generatedAt, framework }: HomeProps) {
  const [count, setCount] = useState(0);

  return (
    <main className="shell page">
      <Head>
        <title>Nextane — Pages Router on Octane</title>
      </Head>
      <p className="eyebrow">The Next.js Pages Router, rebuilt on Octane</p>
      <h1>Same pages. Different engine.</h1>
      <p className="lede">
        This page was discovered from <code>pages/index.tsrx</code>, rendered on
        a Cloudflare Worker, hydrated by Octane, and wired to a Next-shaped
        client router.
      </p>
      <div className="interactive">
        <button className="button" type="button" onClick={() => setCount((value) => value + 1)}>
          Octane state: {count}
        </button>
        <Link href="/ssr?from=home">Navigate without a reload →</Link>
      </div>
      <section className="proof-grid">
        <article className="proof-card">
          <strong>getStaticProps</strong>
          <p>Generated at {generatedAt} and serialized through a familiar page-data contract.</p>
        </article>
        <article className="proof-card">
          <strong>No React</strong>
          <p>The component runtime is {framework}. Rendering and hydration are native Octane.</p>
        </article>
        <article className="proof-card">
          <strong>Pages Router shape</strong>
          <p>Filesystem routes, next-style data exports, Link, Router, API routes, and Workers.</p>
        </article>
      </section>
    </main>
  );
}
