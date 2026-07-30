function App({ Component, pageProps, appProps }) {
  return <Component {...pageProps} appProps={appProps} />;
}

App.getInitialProps = async ({ Component, ctx }) => {
  const { req, query, pathname, asPath } = ctx;
  let pageProps = {};

  if (Component.getInitialProps) {
    pageProps = await Component.getInitialProps(ctx);
  }

  return {
    appProps: {
      url: (req || {}).url,
      query,
      pathname,
      asPath,
    },
    pageProps,
  };
};

export default App;
