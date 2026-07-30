import { withRouter } from "nextane/router";

function PageA({ router }) {
  return (
    <div id="page-a">
      <button onClick={() => router.push("/b")}>Go to B</button>
    </div>
  );
}

export default withRouter(PageA);
