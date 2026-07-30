interface AppProps {
  Component: (props: Record<string, unknown>) => unknown;
  pageProps: Record<string, unknown>;
  appRequestUrl?: string;
}

function UpstreamApp({
  Component,
  pageProps,
  appRequestUrl,
}: AppProps) {
  return (
    <section id="app-shell">
      <Component {...pageProps} appRequestUrl={appRequestUrl} />
    </section>
  );
}

UpstreamApp.getInitialProps = async ({
  ctx,
}: {
  ctx: { req: { url: string } };
}) => ({
  appRequestUrl: ctx.req.url,
  pageProps: {},
});

export default UpstreamApp;
