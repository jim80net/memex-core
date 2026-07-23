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
});
