import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { LocalEmbeddingProvider } from "../src/embeddings.js";

describe("LocalEmbeddingProvider dependency security", () => {
  it("fails closed before loading a vulnerable sharp native module", async () => {
    const require = createRequire(import.meta.url);
    const sharpModulesBefore = new Set(
      Object.keys(require.cache).filter((path) => /(?:sharp|@img)[/\\]/.test(path)),
    );

    const provider = new LocalEmbeddingProvider();
    await expect(provider.embed(["security probe"])).rejects.toThrow(
      /vulnerable sharp 0\.34\.5.*sharp >=0\.35\.0.*GHSA-f88m-g3jw-g9cj/,
    );

    const newlyLoadedSharpModules = Object.keys(require.cache).filter(
      (path) =>
        /(?:sharp|@img)[/\\]/.test(path) &&
        !path.endsWith("sharp/package.json") &&
        !sharpModulesBefore.has(path),
    );
    expect(newlyLoadedSharpModules).toEqual([]);
  });

  it("rejects a vulnerable bundler runtime before invoking its loader", async () => {
    let loaderCalls = 0;
    const provider = new LocalEmbeddingProvider("test-model", undefined, {
      resolveSharpVersion: () => "0.34.5",
      loadTransformers: async () => {
        loaderCalls += 1;
        throw new Error("must not load");
      },
    });

    await expect(provider.embed(["security probe"])).rejects.toThrow(
      /vulnerable sharp 0\.34\.5.*GHSA-f88m-g3jw-g9cj/,
    );
    expect(loaderCalls).toBe(0);
  });

  it("accepts a patched bundler runtime and uses its lazy Transformers loader", async () => {
    let loaderCalls = 0;
    const provider = new LocalEmbeddingProvider("test-model", "/tmp/memex-models", {
      resolveSharpVersion: () => "0.35.3",
      loadTransformers: async () => {
        loaderCalls += 1;
        return {
          env: { cacheDir: "" },
          pipeline: async () => {
            return async () => ({
              data: new Float32Array([0.5, 1]),
              dims: [1, 2],
            });
          },
        };
      },
    });

    await expect(provider.embed(["security probe"])).resolves.toEqual([[0.5, 1]]);
    expect(loaderCalls).toBe(1);
  });
});
