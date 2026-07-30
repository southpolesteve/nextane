import { withRouter } from "nextane/router";

function PageB() {
  return (
    <div id="page-b">
      <p>Page B!</p>
    </div>
  );
}

export default withRouter(PageB);
