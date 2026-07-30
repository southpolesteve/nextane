import { useEffect, useState } from "octane";
import Router, { withRouter } from "nextane/router";
import Link from "nextane/link";

const pages = {
  "/a": "Foo",
  "/b": "Bar",
};

function HeaderNav({ router }) {
  const [activeURL, setActiveURL] = useState(router.asPath);
  const [activeTopLevel, setActiveTopLevel] = useState(router.asPath);
  const [activeLegacy, setActiveLegacy] = useState(router.asPath);

  useEffect(() => {
    const update = (url) => setActiveURL(String(url));
    const updateTopLevel = (url) => setActiveTopLevel(String(url));
    const updateLegacy = (url) => setActiveLegacy(String(url));
    Router.onRouteChangeComplete = updateLegacy;
    Router.events.on("routeChangeComplete", updateTopLevel);
    router.events.on("routeChangeComplete", update);
    return () => {
      Router.onRouteChangeComplete = null;
      Router.events.off("routeChangeComplete", updateTopLevel);
      router.events.off("routeChangeComplete", update);
    };
  }, [router]);

  return (
    <nav>
      {Object.entries(pages).map(([url, label]) => (
        <Link
          href={url}
          key={url}
          prefetch
          className={`${activeURL === url ? "active" : ""} ${
            activeTopLevel === url ? "active-top-level-router" : ""
          } ${activeLegacy === url ? "active-top-level-router-deprecated-behavior" : ""}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

export default withRouter(HeaderNav);
