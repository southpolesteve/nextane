import {
  Head,
  Html,
  Main,
  NextScript,
} from "nextane/document";

interface ReplacementDocumentProps {
  documentToken?: string;
}

function ReplacementDocument({
  documentToken,
}: ReplacementDocumentProps) {
  return (
    <Html>
      <Head />
      <body>
        <p id="replacement-document">{documentToken}</p>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}

ReplacementDocument.getInitialProps = async ({
  query,
  renderPage,
}: {
  query: Record<string, unknown>;
  renderPage(): Promise<Record<string, unknown>>;
}) => ({
  ...(await renderPage()),
  documentToken: String(query.documentToken ?? ""),
});

export default ReplacementDocument;
