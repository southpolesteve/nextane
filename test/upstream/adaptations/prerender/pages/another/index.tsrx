import Link from "nextane/link";
import worldText from "../../world.txt?raw";

export async function getStaticProps() {
  return {
    props: {
      world: worldText.trim(),
      time: new Date().getTime(),
    },
    revalidate: true,
  };
}

export default function Another({ world, time }) {
  return (
    <>
      <p>hello {world}</p>
      <span id="anotherTime">time: {time}</span>
      <Link href="/" id="home">
        to home
      </Link>
      <br />
      <Link href="/something" id="something">
        to something
      </Link>
    </>
  );
}
