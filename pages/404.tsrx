import Head from "nextane/head";
import Link from "nextane/link";

export default function NotFound() {
  return (
    <main className="shell page">
      <Head>
        <title>Not found — Nextane</title>
      </Head>
      <p className="eyebrow">404</p>
      <h1>That page ran out of fuel.</h1>
      <p className="lede">The custom Pages Router 404 convention handled this response.</p>
      <p>
        <Link href="/">Back to the kitchen sink →</Link>
      </p>
    </main>
  );
}
