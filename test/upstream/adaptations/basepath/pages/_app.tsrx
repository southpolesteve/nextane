import { useEffect } from "octane";
import { useRouter } from "nextane/router";

// Functional port of the upstream event-log _app. The upstream version uses a
// custom hook with an optional function parameter; octane's compiled hook
// calls append a slot sentinel argument, which lands in that optional
// parameter. The subscriptions below are the same real router.events hooks
// with the same serialization, just without the optional-parameter hook.
const EVENT_LOG_KEY = "router-event-log";

function getEventLog() {
  const data = sessionStorage.getItem(EVENT_LOG_KEY);
  return data ? JSON.parse(data) : [];
}

function clearEventLog() {
  sessionStorage.removeItem(EVENT_LOG_KEY);
}

function addEvent(data: unknown[]) {
  const eventLog = getEventLog();
  eventLog.push(data);
  sessionStorage.setItem(EVENT_LOG_KEY, JSON.stringify(eventLog));
}

if (typeof window !== "undefined") {
  // global functions introduced to interface with the test infrastructure
  (window as unknown as Record<string, unknown>)._clearEventLog =
    clearEventLog;
  (window as unknown as Record<string, unknown>)._getEventLog = getEventLog;
}

const serializeArgs = (...args: unknown[]) => args;

const serializeErrorEventArgs = (
  err: { message: string; cancelled?: boolean },
  url: unknown,
  properties: unknown,
) => [err.message, err.cancelled, url, properties];

const LOGGED_EVENTS: Array<[string, (...args: never[]) => unknown[]]> = [
  ["routeChangeStart", serializeArgs],
  ["routeChangeComplete", serializeArgs],
  ["routeChangeError", serializeErrorEventArgs as (...args: never[]) => unknown[]],
  ["beforeHistoryChange", serializeArgs],
  ["hashChangeStart", serializeArgs],
  ["hashChangeComplete", serializeArgs],
];

export default function MyApp({
  Component,
  pageProps,
}: {
  Component: (props: Record<string, unknown>) => unknown;
  pageProps: Record<string, unknown>;
}) {
  const router = useRouter();
  useEffect(() => {
    const subscriptions = LOGGED_EVENTS.map(([event, serialize]) => {
      const logEvent = (...args: unknown[]) =>
        addEvent([event, ...serialize(...(args as never[]))]);
      (router.events as {
        on(event: string, handler: (...args: unknown[]) => void): void;
      }).on(event, logEvent);
      return [event, logEvent] as const;
    });
    return () => {
      for (const [event, logEvent] of subscriptions) {
        (router.events as {
          off(event: string, handler: (...args: unknown[]) => void): void;
        }).off(event, logEvent);
      }
    };
  }, [router.events]);
  return <Component {...pageProps} />;
}
