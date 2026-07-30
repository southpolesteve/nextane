import Head from "nextane/head";
import Link from "nextane/link";
import type { GetServerSideProps } from "nextane";

interface ServerProps {
  renderedAt: string;
  query: Record<string, string | string[] | undefined>;
  colo: string;
}

export const getServerSideProps: GetServerSideProps<ServerProps> = async ({
  req,
  query,
}) => ({
  props: {
    renderedAt: new Date().toISOString(),
    query,
    colo: req.headers.get("cf-ray")?.split("-").at(-1) ?? "local workerd",
  },
});

export default function ServerPage({ renderedAt, query, colo }: ServerProps) {
  return (
    <main className="shell page">
      <Head>
        <title>Server-side props — Nextane</title>
      </Head>
      <p className="eyebrow">getServerSideProps</p>
      <h1>Fresh on every request.</h1>
      <p className="lede">
        The Worker executed a Next-shaped server data function before Octane
        rendered this route. Client navigation fetched the same page-data
        protocol without downloading another document.
      </p>
      <div className="data-card">
        <pre>{JSON.stringify({ renderedAt, query, colo }, null, 2)}</pre>
      </div>
      <p className="route-pill">pages/ssr.tsrx</p>
      <p>
        <Link href="/posts/compiler-native">Try a dynamic route →</Link>
      </p>
    </main>
  );
}
