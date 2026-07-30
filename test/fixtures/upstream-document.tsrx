import {
  Head,
  Html,
  Main,
  NextScript,
} from "nextane/document";

interface DocumentProps {
  customProperty?: string;
  renderedTextCount?: number;
}

function UpstreamDocument({
  customProperty,
  renderedTextCount,
}: DocumentProps) {
  return (
    <Html className="test-html-props">
      <Head nonce="test-nonce" crossOrigin="anonymous">
        <style>
          body {
            margin: 0;
          }
        </style>
      </Head>
      <body className="custom-body">
        <p id="custom-property">{customProperty}</p>
        <p id="rendered-count">{renderedTextCount}</p>
        <Main />
        <NextScript nonce="test-nonce" crossOrigin="anonymous" />
      </body>
    </Html>
  );
}

UpstreamDocument.getInitialProps = async ({
  renderPage,
  query,
}: {
  renderPage(options?: {
    enhanceComponent?: (
      Component: (props: Record<string, unknown>) => unknown,
    ) => (props: Record<string, unknown>) => unknown;
  }): Promise<{ html: string }>;
  query: Record<string, unknown>;
}) => {
  const enhanceComponent = (
    Component: (props: Record<string, unknown>) => unknown,
  ) =>
    function EnhancedComponent(props: Record<string, unknown>) {
      return (
        <div>
          <span id="render-page-enhance-component">RENDERED</span>
          <Component {...props} />
        </div>
      );
    };
  const result = await renderPage(
    query.enhance ? { enhanceComponent } : undefined,
  );
  return {
    ...result,
    customProperty: "Hello Document",
    renderedTextCount: (result.html.match(/request-url/g) ?? []).length,
  };
};

export default UpstreamDocument;
