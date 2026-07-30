import type { UrlObject } from "../types";

export interface LinkProps {
  href: string | UrlObject;
  as?: string | UrlObject;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  prefetch?: boolean;
  legacyBehavior?: boolean;
  passHref?: boolean;
  target?: string;
  className?: string;
  id?: string;
  children?: unknown;
  [key: string]: unknown;
}

export default function Link(props: LinkProps): unknown;
