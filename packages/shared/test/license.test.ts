import { describe, expect, it } from "vitest";
import {
  licenseFromCcUrl,
  normalizeOpenverseLicense,
  normalizePexelsLicense,
  normalizeWikimediaLicense,
} from "../src/index.js";

describe("license normalization", () => {
  it.each([
    ["CC0 1.0", "CC0"],
    ["Public domain", "PUBLIC_DOMAIN"],
    ["CC BY 4.0", "CC_BY"],
    ["CC BY-SA 3.0", "CC_BY_SA"],
    ["CC BY-NC 4.0", "CC_BY_NC"],
    ["CC BY-ND 4.0", "CC_BY_ND"],
    ["CC BY-NC-SA 4.0", "CC_BY_NC_SA"],
    ["CC BY-NC-ND 4.0", "CC_BY_NC_ND"],
    ["GFDL", "UNKNOWN"],
  ] as const)("maps Wikimedia %s to %s", (license, kind) => {
    const result = normalizeWikimediaLicense({
      LicenseShortName: { value: license },
      Artist: { value: "<a href='https://author.test'>Jane</a> &amp; John" },
      LicenseUrl: { value: "https://license.test" },
    });
    expect(result.kind).toBe(kind);
    expect(result.evidence).toBe("api");
    expect(result.author).toBe("Jane & John");
    expect(result.attributionRequired).toBe(kind.startsWith("CC_BY"));
  });

  it.each([
    ["cc0", "CC0"],
    ["pdm", "PUBLIC_DOMAIN"],
    ["by", "CC_BY"],
    ["by-sa", "CC_BY_SA"],
    ["by-nc", "CC_BY_NC"],
    ["by-nd", "CC_BY_ND"],
    ["by-nc-sa", "CC_BY_NC_SA"],
    ["by-nc-nd", "CC_BY_NC_ND"],
    ["custom-license", "UNKNOWN"],
  ] as const)("maps Openverse %s to %s", (license, kind) => {
    expect(normalizeOpenverseLicense({ license, attribution: "Photo by A" })).toMatchObject({
      kind,
      attributionText: "Photo by A",
      evidence: "api",
    });
  });

  it("uses the Pexels license and photographer credit without requiring attribution", () => {
    expect(normalizePexelsLicense("Alex", "https://pexels.test/alex")).toMatchObject({
      kind: "ROYALTY_FREE",
      name: "Pexels License",
      attributionRequired: false,
      attributionText: "Photo by Alex on Pexels",
      authorUrl: "https://pexels.test/alex",
    });
  });

  it("maps Creative Commons license URLs for web crawl verification", () => {
    expect(licenseFromCcUrl("https://creativecommons.org/licenses/by/4.0/", "Ada")).toMatchObject({
      verified: true,
      license: { kind: "CC_BY", evidence: "page_meta", author: "Ada" },
    });
    expect(licenseFromCcUrl("https://creativecommons.org/publicdomain/zero/1.0/")).toMatchObject({
      verified: true,
      license: { kind: "CC0" },
    });
    expect(licenseFromCcUrl("https://example.test/terms")).toBeNull();
  });
});
