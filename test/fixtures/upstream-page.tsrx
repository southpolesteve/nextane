export default function UpstreamPage({
  requestUrl,
  resolvedUrl,
  query,
  appRequestUrl,
}: {
  requestUrl?: string;
  resolvedUrl?: string;
  query?: Record<string, unknown>;
  appRequestUrl?: string;
}) {
  return (
    <main>
      <p id="request-url">{requestUrl}</p>
      <p id="resolved-url">{resolvedUrl}</p>
      <p id="query">{JSON.stringify(query)}</p>
      <p id="app-request-url">{appRequestUrl}</p>
    </main>
  );
}
