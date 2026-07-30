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

const INLINE_JSON_ESCAPE: Record<string, string> = {
  "&": "\\u0026",
  "<": "\\u003c",
  ">": "\\u003e",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

export function serializeInlineNextData(value: unknown): string {
  return (JSON.stringify(value) ?? "null").replace(
    /[&<>\u2028\u2029]/g,
    (character) => INLINE_JSON_ESCAPE[character],
  );
}

NextScript.getInlineScriptSource = (props: {
  __NEXT_DATA__?: unknown;
  nextData?: unknown;
}) => serializeInlineNextData(props.__NEXT_DATA__ ?? props.nextData ?? {});

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
