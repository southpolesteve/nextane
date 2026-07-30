import { createElement } from "octane";

interface ElementProps {
  children?: unknown;
  [key: string]: unknown;
}

/**
 * Server-only document primitives. The custom document is rendered to a shell
 * first; Nextane replaces these sentinel elements with the page render,
 * collected head content, serialized data, and Vite's client entry.
 */
export function Html({ children, ...props }: ElementProps) {
  return createElement("html", props, children);
}

export function Head({ children, ...props }: ElementProps) {
  return createElement(
    "head",
    props,
    children,
    createElement("nextane-head", props),
  );
}

export function Main() {
  return createElement("nextane-main", {});
}

export function NextScript(props: ElementProps) {
  return createElement("nextane-script", props);
}

NextScript.getInlineScriptSource = (props: {
  __NEXT_DATA__?: unknown;
  nextData?: unknown;
}) => JSON.stringify(props.__NEXT_DATA__ ?? props.nextData ?? {});

export default function Document() {
  return (
    <Html>
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
