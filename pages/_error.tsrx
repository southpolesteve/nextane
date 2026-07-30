import Head from "nextane/head";
import Link from "nextane/link";

export default function ErrorPage() {
  return (
    <main className="shell page">
      <Head>
        <title>Something went wrong — Nextane</title>
      </Head>
      <p className="eyebrow">500</p>
      <h1>The renderer misfired.</h1>
      <p className="lede">Nextane caught the request error and rendered pages/_error.tsrx.</p>
      <p>
        <Link href="/">Return home →</Link>
      </p>
    </main>
  );
}
