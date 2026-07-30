import {
  cloneElement,
  createElement,
  isValidElement,
  type ElementDescriptor,
  useEffect,
} from "octane";
import Router, { formatRouterHref } from "./router";
import { isSafeClientNavigationTarget } from "./navigation";
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

export default function Link(props: LinkProps) {
  const {
    href,
    as,
    replace,
    scroll,
    shallow,
    prefetch: _prefetch,
    legacyBehavior,
    passHref,
    children,
    ...anchorProps
  } = props;
  const resolvedHref = formatRouterHref(href);
  const destination = as ? formatRouterHref(as) : resolvedHref;
  const dataHref = resolvedHref.includes("[") ? destination : resolvedHref;
  const safeDestination =
    isSafeClientNavigationTarget(resolvedHref) &&
    isSafeClientNavigationTarget(destination);
  const anchorHref = safeDestination ? destination : "#";
  const shouldPrefetch =
    _prefetch === true || (as !== undefined && dataHref !== destination);
  const userOnClick = anchorProps.onClick;
  const external = /^(?:[a-z]+:)?\/\//i.test(destination);

  useEffect(() => {
    if (!shouldPrefetch || external || !safeDestination) return;
    void Router.prefetch(dataHref);
  }, [dataHref, external, safeDestination, shouldPrefetch]);

  function navigate(event: MouseEvent, childOnClick?: unknown) {
    if (typeof childOnClick === "function") childOnClick(event);
    if (typeof userOnClick === "function") userOnClick(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (event.currentTarget instanceof HTMLAnchorElement &&
        event.currentTarget.target &&
        event.currentTarget.target !== "_self")
    ) {
      return;
    }
    if (!safeDestination) {
      event.preventDefault();
      return;
    }
    if (external) return;
    event.preventDefault();
    const options = { scroll, shallow };
    if (replace) void Router.replace(resolvedHref, destination, options);
    else void Router.push(resolvedHref, destination, options);
  }

  if (legacyBehavior && isValidElement(children)) {
    const child = children as ElementDescriptor<Record<string, unknown>>;
    const childProps = child.props ?? {};
    const hrefProps =
      passHref || child.type === "a" || childProps.href === undefined
        ? { href: anchorHref }
        : {};
    return cloneElement(child, {
      ...hrefProps,
      onClick(event: MouseEvent) {
        navigate(event, childProps.onClick);
      },
    });
  }

  return createElement("a", {
    ...anchorProps,
    href: anchorHref,
    onClick(event: MouseEvent) {
      navigate(event);
    },
    children,
  });
}
