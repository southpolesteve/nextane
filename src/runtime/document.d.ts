export interface ElementProps {
  children?: unknown;
  [key: string]: unknown;
}

export declare function Html(props: ElementProps): unknown;
export declare function Head(props: ElementProps): unknown;
export declare function Main(): unknown;
export declare function serializeInlineNextData(value: unknown): string;
export declare const NextScript: ((props: ElementProps) => unknown) & {
  getInlineScriptSource(props: {
    __NEXT_DATA__?: unknown;
    nextData?: unknown;
  }): string;
};
export default function Document(): unknown;
