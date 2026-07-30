import { CLIENT_VISIBLE_MARKER } from "../visible";
import {
  CLIENT_MIXED_VISIBLE_MARKER,
  SERVER_MIXED_CANARY_f0198c,
} from "../mixed";
import {
  SERVER_DEPENDENCY_CANARY_8d071b,
  invokeServerOnlySideEffect,
} from "../server-only";

const SERVER_LOCAL_CANARY_35ddc2 = invokeServerOnlySideEffect(
  SERVER_DEPENDENCY_CANARY_8d071b,
);

export async function getServerSideProps() {
  return {
    props: {
      secret: SERVER_LOCAL_CANARY_35ddc2,
      mixedSecret: SERVER_MIXED_CANARY_f0198c,
      inline: "SERVER_EXPORT_CANARY_a1e944",
    },
  };
}

export default function SecurityFixture() {
  return (
    <p>
      {CLIENT_VISIBLE_MARKER} {CLIENT_MIXED_VISIBLE_MARKER}
    </p>
  );
}
