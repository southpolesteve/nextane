import Link from "nextane/link";

export async function getServerSideProps({ req }) {
  return {
    props: {
      url: req.url,
      world: "world",
      time: new Date().getTime(),
    },
  };
}

export default function Page({ world, time }) {
  return (
    <>
      <p>hello {world}</p>
      <span>time: {time}</span>
      <Link href="/non-json" id="non-json">to non-json</Link>
      <br />
      <Link href="/another" id="another">to another</Link>
      <br />
      <Link href="/something" id="something">to something</Link>
      <br />
      <Link href="/normal" id="normal">to normal</Link>
      <br />
      <Link href="/slow" id="slow">to slow</Link>
      <br />
      <Link href="/blog/[post]" as="/blog/post-1" id="post-1">to dynamic</Link>
      <Link href="/blog/[post]" as="/blog/post-100" id="broken-post">to broken</Link>
      <br />
      <Link
        href="/blog/[post]/[comment]"
        as="/blog/post-1/comment-1"
        id="comment-1"
      >
        to another dynamic
      </Link>
      <Link href="/something?another=thing" id="something-query">
        to something?another=thing
      </Link>
      <br />
      <Link href="/redirect-page">to redirect-page</Link>
      <br />
      <Link href="/rewrite-source/foo">to rewrite-source/foo</Link>
    </>
  );
}
