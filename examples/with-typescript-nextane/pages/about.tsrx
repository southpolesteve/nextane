import Link from "nextane/link";
import Layout from "../components/Layout.tsrx";

const AboutPage = () => (
  <Layout title="About | Nextane + TypeScript Example">
    <h1>About</h1>
    <p>This is the about page</p>
    <p>
      <Link href="/">Go home</Link>
    </p>
  </Layout>
);

export default AboutPage;
