import Head from "nextane/head";

interface ReplacementPageProps {
  dataToken: string;
  pathToken: string;
  queryToken: string;
}

export default function ReplacementPage({
  dataToken,
  pathToken,
  queryToken,
}: ReplacementPageProps) {
  return (
    <main className="replacement-probe">
      <Head>
        <meta name="replacement-head" content={`head:${dataToken}`} />
      </Head>
      <p id="replacement-path">{pathToken}</p>
      <p id="replacement-query">{queryToken}</p>
      <p id="replacement-data">{dataToken}</p>
      <style>
        .replacement-probe::before {
          content: "$&|$`|$'";
        }
      </style>
    </main>
  );
}
