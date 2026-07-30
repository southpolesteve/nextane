import Head from "next/head";
import { useState } from "react";

interface BenchmarkProps {
  renderedAt: string;
  rows: string[];
}

export async function getServerSideProps() {
  return {
    props: {
      renderedAt: "2026-07-29T00:00:00.000Z",
      rows: Array.from({ length: 20 }, (_, index) => `Rendered row ${index + 1}`),
    },
  };
}

export default function BenchmarkPage({ renderedAt, rows }: BenchmarkProps) {
  const [count, setCount] = useState(0);

  return (
    <>
      <Head>
        <title>Pages rendering benchmark</title>
      </Head>
      <main>
        <h1>Pages rendering benchmark</h1>
        <p data-rendered-at={renderedAt}>Server-rendered at {renderedAt}</p>
        <button type="button" onClick={() => setCount((value) => value + 1)}>
          Count: {count}
        </button>
        <ul>
          {rows.map((row) => (
            <li key={row}>{row}</li>
          ))}
        </ul>
      </main>
    </>
  );
}
