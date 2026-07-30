import Link from "nextane/link";
import type { NextaneRouter } from "nextane/types";

interface AppProps {
  Component: (props: Record<string, unknown>) => unknown;
  pageProps: Record<string, unknown>;
  router: NextaneRouter;
}

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <header className="shell site-header">
        <Link className="brand" href="/">
          Nextane
        </Link>
        <nav className="nav" aria-label="Kitchen sink routes">
          <Link href="/">Static props</Link>
          <Link href="/ssr?from=nav">Server props</Link>
          <Link href="/posts/octane">Dynamic route</Link>
          <Link href="/isr">ISR</Link>
        </nav>
      </header>
      <Component {...pageProps} />
    </>
  );
}
