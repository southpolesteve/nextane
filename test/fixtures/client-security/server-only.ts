export const SERVER_DEPENDENCY_CANARY_8d071b = "never ship this";

(
  globalThis as typeof globalThis & {
    __SERVER_TOP_LEVEL_SIDE_EFFECT_CANARY_6fd312__?: string;
  }
).__SERVER_TOP_LEVEL_SIDE_EFFECT_CANARY_6fd312__ =
  SERVER_DEPENDENCY_CANARY_8d071b;

export function invokeServerOnlySideEffect(value: string) {
  (
    globalThis as typeof globalThis & {
      __SERVER_SIDE_EFFECT_CANARY_99111a__?: string;
    }
  ).__SERVER_SIDE_EFFECT_CANARY_99111a__ = value;
  return value;
}
