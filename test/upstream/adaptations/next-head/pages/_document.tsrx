import { Html, Head, Main, NextScript } from "nextane/document";

export default function MyDocument() {
  return (
    <Html>
      <Head>
        <meta name="test-head-initial-props" content="hello" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}

MyDocument.getInitialProps = async (context) => context.renderPage();
