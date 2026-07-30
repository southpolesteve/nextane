import { useEffect, useState } from "octane";
import { setState } from "../shared-module";

setState(typeof window === "undefined" ? "UPDATED" : "UPDATED CLIENT");

function Layout({ children }) {
  const [random, setRandom] = useState(false);
  useEffect(() => setRandom(Math.random()), []);

  return (
    <div>
      <p id="hello-app">Hello App</p>
      <p id="hello-hmr">Hello HMR</p>
      <p id="random-number">{random}</p>
      {children}
    </div>
  );
}

function App({ Component, pageProps }) {
  return (
    <Layout>
      <Component {...pageProps} />
    </Layout>
  );
}

App.getInitialProps = async ({ Component, ctx }) => {
  // throw _app GIP err here
  let pageProps = {};
  if (Component.getInitialProps) {
    pageProps = await Component.getInitialProps(ctx);
  }
  return { pageProps };
};

export default App;
