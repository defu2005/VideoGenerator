import { describe, expect, it } from "vitest";
import { candidateKey, dedupeCandidates, normalizedImageUrl } from "../src/index.js";

describe("visual candidate deduplication", () => {
  it("normalizes URL query strings and Wikimedia thumbnail URLs", () => {
    expect(normalizedImageUrl("https://commons.wikimedia.org/wiki/Special:FilePath/Image.jpg?width=640"))
      .toBe(normalizedImageUrl("https://commons.wikimedia.org/wiki/Special:FilePath/Image.jpg"));
    expect(normalizedImageUrl("https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Foo.jpg/640px-Foo.jpg"))
      .toBe(normalizedImageUrl("https://upload.wikimedia.org/wikipedia/commons/a/a0/Foo.jpg"));
  });

  it("dedupes provider IDs, URL variants and cross-provider Wikimedia files, retaining richer license data", () => {
    const wikimedia = {
      provider: "wikimedia",
      providerItemId: "1",
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/a/a0/Foo.jpg",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Foo.jpg",
      title: "Foo.jpg",
      license: { kind: "CC_BY", evidence: "api", author: "A" },
    };
    const openverse = {
      provider: "openverse",
      providerItemId: "2",
      sourceProvider: "wikimedia",
      imageUrl: "https://images.test/Foo.jpg?size=large",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Foo.jpg",
      title: "Foo.jpg",
      license: { kind: "UNKNOWN", evidence: "none", author: null },
    };
    expect(candidateKey(wikimedia)).toBe("wikimedia:1");
    expect(dedupeCandidates([openverse, wikimedia])).toEqual([wikimedia]);
  });
});
