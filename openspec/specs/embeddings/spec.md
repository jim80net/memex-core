## Requirements

### Requirement: Embedding providers implement a shared batch embedding contract

`EmbeddingProvider` SHALL expose a single `embed(texts: string[]): Promise<number[][]>` method. Both built-in providers SHALL accept an array of input strings and return an array of embedding vectors in matching order. When `texts` is empty, both providers SHALL return an empty array without performing backend work.

#### Scenario: Empty input short-circuits

- **WHEN** `embed([])` is called on either `LocalEmbeddingProvider` or `OpenAIEmbeddingProvider`
- **THEN** the provider returns `[]`

### Requirement: LocalEmbeddingProvider lazily initializes a local ONNX feature-extraction pipeline

`LocalEmbeddingProvider` SHALL default its model name to `"Xenova/all-MiniLM-L6-v2"`, optionally accept a `cacheDir`, and lazily initialize its extractor on the first non-empty `embed()` call by memoizing a single `extractorPromise`. Initialization SHALL resolve `@huggingface/transformers` through this fallback chain: direct `import("@huggingface/transformers")`, then `createRequire(...).resolve("@huggingface/transformers")` followed by dynamic import of the resolved path, then dynamic import of an absolute `../node_modules/@huggingface/transformers/src/transformers.js` path relative to the module directory. If all three resolution paths fail, initialization SHALL throw an install guidance error. When a `cacheDir` is provided, it SHALL be assigned to `transformers.env.cacheDir`. The created pipeline SHALL use task `"feature-extraction"`, the configured model name, and `dtype: "q8"`.

#### Scenario: First embed call initializes the extractor once

- **WHEN** `embed(texts)` is called for the first time on a `LocalEmbeddingProvider`
- **THEN** the provider initializes and memoizes a single feature-extraction pipeline before generating embeddings

#### Scenario: Optional cache directory is propagated

- **WHEN** a `LocalEmbeddingProvider` is constructed with a `cacheDir`
- **THEN** extractor initialization sets `transformers.env.cacheDir` to that directory before creating the pipeline

### Requirement: OpenAIEmbeddingProvider batches requests to the embeddings API

`OpenAIEmbeddingProvider` SHALL be constructed with a model name and API key. For non-empty inputs, it SHALL call `https://api.openai.com/v1/embeddings` with bearer-token authorization, sending inputs in batches of 2048 strings and placing each returned embedding into the original result order using the response item's `index`. If any HTTP response is non-OK, the provider SHALL read the response body text and throw `Error("OpenAI embeddings API error <status>: <body>")`.

#### Scenario: Large input is split into 2048-item batches

- **WHEN** `embed(texts)` is called with more than 2048 input strings
- **THEN** the provider submits multiple sequential requests, each containing at most 2048 strings

#### Scenario: Non-200 API response raises a descriptive error

- **WHEN** the OpenAI embeddings endpoint responds with a non-OK status
- **THEN** the provider throws an error containing the HTTP status code and response body text

### Requirement: cosineSimilarity optimizes for pre-normalized vectors and falls back safely

`cosineSimilarity(a, b)` SHALL return `0` when the vectors have different lengths. It SHALL compute the dot product for all equal-length vectors, then use a fast path that returns the dot product directly when both squared norms are within `1e-6` of `1.0`. Otherwise it SHALL compute the full cosine similarity formula `dot / (|a| * |b|)`. If the denominator is zero, it SHALL return `0`.

#### Scenario: Mismatched vector lengths return zero

- **WHEN** `cosineSimilarity(a, b)` is called with vectors of different lengths
- **THEN** the result is `0`

#### Scenario: Normalized vectors use the fast path

- **WHEN** `cosineSimilarity(a, b)` is called with vectors whose squared norms are both within `1e-6` of `1.0`
- **THEN** the result is the raw dot product

#### Scenario: Non-normalized vectors use the full cosine formula

- **WHEN** `cosineSimilarity(a, b)` is called with equal-length vectors that are not both pre-normalized
- **THEN** the result is `dot / (sqrt(normSqA) * sqrt(normSqB))`, or `0` if that denominator is zero
