import { createElement } from "octane";

export function DefaultNotFound() {
  return createElement(
    "main",
    {
      style: {
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        height: "100vh",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      },
    },
    createElement(
      "div",
      {},
      createElement(
        "h1",
        {
          style: {
            display: "inline-block",
            margin: "0 20px 0 0",
            padding: "0 23px 0 0",
            fontSize: "24px",
            fontWeight: 500,
            verticalAlign: "top",
            lineHeight: "49px",
            borderRight: "1px solid rgba(0,0,0,.3)",
          },
        },
        "404",
      ),
      createElement(
        "div",
        { style: { display: "inline-block" } },
        createElement(
          "h2",
          {
            style: {
              fontSize: "14px",
              fontWeight: 400,
              lineHeight: "49px",
              margin: 0,
            },
          },
          "This page could not be found.",
        ),
      ),
    ),
  );
}

export function DefaultServerError() {
  return createElement(
    "main",
    {},
    createElement("h1", {}, "500"),
    createElement("p", {}, "Internal Server Error"),
  );
}
