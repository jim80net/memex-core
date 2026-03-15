// ---------------------------------------------------------------------------
// Embedding provider interface + implementations
// ---------------------------------------------------------------------------

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

// ---------------------------------------------------------------------------
// OpenAI API provider
// ---------------------------------------------------------------------------

type OpenAIEmbeddingResponse = {
  data: Array<{ embedding: number[]; index: number }>;
};

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private model: string,
    private apiKey: string,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const BATCH_SIZE = 2048;
    const results: number[][] = new Array(texts.length);

    for (let offset = 0; offset < texts.length; offset += BATCH_SIZE) {
      const batch = texts.slice(offset, offset + BATCH_SIZE);
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: batch }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenAI embeddings API error ${response.status}: ${text}`);
      }

      const json = (await response.json()) as OpenAIEmbeddingResponse;
      for (const item of json.data) {
        results[offset + item.index] = item.embedding;
      }
    }

    return results;
  }
}

// ---------------------------------------------------------------------------
// Local ONNX provider (requires @huggingface/transformers as optional dep)
// ---------------------------------------------------------------------------

export class LocalEmbeddingProvider implements EmbeddingProvider {
  private model: string;
  private cacheDir?: string;
  private extractorPromise: Promise<unknown> | null = null;

  constructor(model: string = "Xenova/all-MiniLM-L6-v2", cacheDir?: string) {
    this.model = model;
    this.cacheDir = cacheDir;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const extractor = await this.getExtractor();

    const output = await (extractor as CallableFunction)(texts, {
      pooling: "mean",
      normalize: true,
    });

    const data = (output as { data: Float32Array; dims: number[] }).data;
    const dims = (output as { data: Float32Array; dims: number[] }).dims;
    const dim = dims[dims.length - 1];
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      results.push(Array.from(data.slice(i * dim, (i + 1) * dim)));
    }

    return results;
  }

  private async getExtractor(): Promise<unknown> {
    if (!this.extractorPromise) {
      this.extractorPromise = this.initExtractor();
    }
    return this.extractorPromise;
  }

  private async initExtractor(): Promise<unknown> {
    let transformers: { pipeline: any; env: { cacheDir: string } };

    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    // Dynamic import for createRequire — types may not expose it on the namespace
    const moduleMod = await import("node:module");
    const createRequire = (moduleMod as any).createRequire || (moduleMod as any).default?.createRequire;

    let pluginDir: string;
    try {
      pluginDir = dirname(fileURLToPath(import.meta.url));
    } catch {
      pluginDir = typeof __dirname !== "undefined" ? __dirname : process.cwd();
    }

    try {
      transformers = (await import("@huggingface/transformers")) as typeof transformers;
    } catch {
      try {
        const require = createRequire(join(pluginDir, "package.json"));
        const resolvedPath = require.resolve("@huggingface/transformers");
        transformers = (await import(resolvedPath)) as typeof transformers;
      } catch {
        try {
          const absolutePath = join(
            pluginDir,
            "..",
            "node_modules",
            "@huggingface",
            "transformers",
            "src",
            "transformers.js",
          );
          transformers = (await import(absolutePath)) as typeof transformers;
        } catch {
          throw new Error(
            "Local embedding backend requires @huggingface/transformers. " +
              "Install it: npm install @huggingface/transformers",
          );
        }
      }
    }

    if (this.cacheDir) {
      transformers.env.cacheDir = this.cacheDir;
    }

    return transformers.pipeline("feature-extraction", this.model, {
      dtype: "q8",
    });
  }
}

// ---------------------------------------------------------------------------
// Cosine similarity (shared utility)
// ---------------------------------------------------------------------------

/**
 * Cosine similarity between two vectors.
 * Optimized: detects pre-normalized vectors (norm ≈ 1.0) and uses dot product directly.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }

  // Fast path: normalized vectors (norm ≈ 1.0) — just return dot product.
  let normSqA = 0;
  let normSqB = 0;
  for (let i = 0; i < a.length; i++) {
    normSqA += a[i] * a[i];
    normSqB += b[i] * b[i];
  }

  if (Math.abs(normSqA - 1.0) < 1e-6 && Math.abs(normSqB - 1.0) < 1e-6) {
    return dot;
  }

  const denom = Math.sqrt(normSqA) * Math.sqrt(normSqB);
  if (denom === 0) return 0;
  return dot / denom;
}
