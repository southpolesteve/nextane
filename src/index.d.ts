import type { Plugin } from "vite";

export declare function nextane(): Plugin;
export default nextane;

export type {
  GetServerSideProps,
  GetServerSidePropsContext,
  GetServerSidePropsResult,
  GetStaticProps,
  GetStaticPropsContext,
  GetStaticPropsResult,
  GetStaticPaths,
  GetStaticPathsContext,
  GetStaticPathsResult,
  NextApiRequest,
  NextApiResponse,
  NextaneRouter,
  PageConfig,
  ParsedUrlQuery,
  Redirect,
  SizeLimit,
} from "./types";
