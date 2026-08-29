// Replaces the upstream page's next/error import; preserves the copy the
// basepath error tests assert on.
export default function NotFound() {
  return (
    <div>
      <h1>404</h1>
      <div>This page could not be found.</div>
    </div>
  );
}
