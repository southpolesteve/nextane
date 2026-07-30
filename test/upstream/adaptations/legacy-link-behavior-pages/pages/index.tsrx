import Link from "nextane/link";

export default function Page() {
  return (
    <>
      <h1>Home Page</h1>
      <Link href="/about" legacyBehavior>About</Link>
    </>
  );
}
