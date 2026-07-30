import Head from "nextane/head";
import Link from "nextane/link";
import type { GetServerSideProps } from "nextane";

interface PostProps {
  slug: string;
  title: string;
}

export const getServerSideProps: GetServerSideProps<PostProps> = async ({ params }) => {
  const slug = String(params?.slug ?? "unknown");
  return {
    props: {
      slug,
      title: slug
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
    },
  };
};

export default function Post({ slug, title }: PostProps) {
  return (
    <main className="shell page">
      <Head>
        <title>{title} — Nextane dynamic route</title>
      </Head>
      <p className="eyebrow">Dynamic filesystem route</p>
      <h1>{title}</h1>
      <p className="lede">
        The URL parameter <code>{slug}</code> was matched from{" "}
        <code>pages/posts/[slug].tsrx</code> and supplied to
        getServerSideProps.
      </p>
      <p className="route-pill">/posts/[slug]</p>
      <p>
        <Link href="/isr">Continue to ISR →</Link>
      </p>
    </main>
  );
}
