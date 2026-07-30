import { Html, Head, Main, NextScript } from "nextane/document";

const docValue = await Promise.resolve("doc value");

export default function MyDocument() {
  return (
    <Html>
      <Head />
      <body>
        <div id="doc-value">{docValue}</div>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}

MyDocument.getInitialProps = async (context) => context.renderPage();
