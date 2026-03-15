/** Compile-time version, injected via --define. Defaults to "dev" for tsx/vitest runs. */
export const VERSION: string = process.env.MEMEX_CORE_VERSION || "dev";
