import type { ParsedUrlQuery } from "../types";

export declare function useSelectedLayoutSegment(): string | null;
export declare function useSelectedLayoutSegments(): string[];
export declare function usePathname(): string | null;
export declare function useSearchParams(): URLSearchParams;
export declare function useParams(): ParsedUrlQuery | null;

export interface AppRouterInstance {
  back(): void;
  forward(): void;
  refresh(): void;
  push(href: string, options?: { scroll?: boolean }): void;
  replace(href: string, options?: { scroll?: boolean }): void;
  prefetch(href: string): void;
}

export declare function useRouter(): AppRouterInstance;
