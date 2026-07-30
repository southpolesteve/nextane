import Link from "nextane/link";
import Layout from "../components/Layout.tsrx";

const IndexPage = () => (
  <Layout title="Home | Nextane + TypeScript Example">
    <h1>Hello Nextane 👋</h1>
    <p>
      <Link href="/about">About</Link>
    </p>
  </Layout>
);

export default IndexPage;
