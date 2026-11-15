import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { OriginalityCard } from "./OriginalityCard";

const projectId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";
const closestProjectId = "33333333-3333-4333-8333-333333333333";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OriginalityCard", () => {
  it("shows visual sameness row with score, closest video link, and style tab link", async () => {
    const reportData = {
      projectId,
      renderId: "r1",
      profileId,
      manifest: {
        script: { sources: [], narrationWordCount: 50, hasAnalysis: true, analysisSectionIds: ["s1"] },
        assets: [],
        voice: [{ sceneId: "s1", provider: "mock", voice: "v1" }],
        contribution: {
          ownShare: 1,
          narratedAnalysisShare: 1,
          templateShare: 1,
          thirdPartySourceCount: 0,
          aiGeneratedShare: 0,
          unknownLicenseShare: 0,
        },
        history: [],
        timelineHash: "h1",
        renderTimelineHash: "h1",
        renderedAssets: [],
      },
      scores: {
        script: null,
        title: null,
        reusedImages: 0,
        imageMatches: [],
        comparedProjects: 2,
        visualSameness: {
          channelScore: 0.88,
          crossChannelScore: null,
          parts: { combos: 0.9, frames: 0.85, kinds: 1.0, style: 1.0 },
          closestVideo: {
            projectId: closestProjectId,
            videoId: "v0",
            title: "Video Đã Dựng Trước",
            similarity: 0.88,
          },
          drivingPart: "cùng tổ hợp biến thể với 3/5 video gần nhất",
          comparedVideos: 5,
        },
      },
      visualSameness: {
        channelScore: 0.88,
        crossChannelScore: null,
        parts: { combos: 0.9, frames: 0.85, kinds: 1.0, style: 1.0 },
        closestVideo: {
          projectId: closestProjectId,
          videoId: "v0",
          title: "Video Đã Dựng Trước",
          similarity: 0.88,
        },
        drivingPart: "cùng tổ hợp biến thể với 3/5 video gần nhất",
        comparedVideos: 5,
      },
      verdict: "OK",
      settings: {
        maxScriptSimilarity: 0.5,
        maxReusedImages: 3,
        minOwnContributionShare: 0.3,
        requireNarration: true,
        previousVideoLimit: 30,
        visualSameness: {
          maxChannelSameness: 0.85,
          maxCrossChannelSameness: 0.7,
          window: 10,
          level: "warn",
        },
      },
      findings: [],
      updatedAt: "2026-11-13T00:00:00.000Z",
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/projects/${projectId}/originality`)) {
        return jsonResponse(reportData);
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<OriginalityCard projectId={projectId} />);

    // Row exists
    const row = await screen.findByText(/Độ giống video trước/);
    expect(row).toBeInTheDocument();
    expect(row.textContent).toContain("88.0%");
    expect(row.textContent).toContain("cùng tổ hợp biến thể với 3/5 video gần nhất");

    // Link to closest video
    const videoLink = screen.getByRole("link", { name: "Video Đã Dựng Trước" });
    expect(videoLink).toHaveAttribute("href", `/projects/${closestProjectId}/render`);

    // Link to style tab
    const styleTabLink = screen.getByRole("link", { name: "tab Phong cách" });
    expect(styleTabLink).toHaveAttribute("href", `/profiles/${profileId}/style`);
  });
});
