import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/client.js", () => ({ request: vi.fn() }));

import { prCommand } from "../src/commands/pr.js";
import { request } from "../src/lib/client.js";

const mockRequest = vi.mocked(request);
const context = ["--org", "test-org", "--project", "Project"];

beforeEach(() => mockRequest.mockReset());

describe("pr list", () => {
  it("filters draft pull requests after querying active ones", async () => {
    mockRequest.mockResolvedValueOnce({
      count: 2,
      value: [
        { pullRequestId: 1, title: "Active", status: "active", isDraft: false },
        { pullRequestId: 2, title: "Draft", status: "active", isDraft: true },
      ],
    });

    const result = await prCommand(["list", "--status", "draft", ...context]);

    expect(mockRequest.mock.calls[0]?.[1]).toMatchObject({
      query: { "searchCriteria.status": "active", $top: 30, $skip: 0 },
    });
    expect(result.count).toBe("1 draft pull requests");
    expect(result["pull-requests"]).toEqual([expect.objectContaining({ id: 2, status: "draft" })]);
  });

  it("continues past active PRs until it finds drafts", async () => {
    mockRequest
      .mockResolvedValueOnce({
        count: 30,
        value: Array.from({ length: 30 }, (_, index) => ({
          pullRequestId: index + 1,
          status: "active",
          isDraft: false,
        })),
      })
      .mockResolvedValueOnce({
        count: 1,
        value: [{ pullRequestId: 31, title: "Draft", status: "active", isDraft: true }],
      });

    const result = await prCommand(["list", "--status", "draft", ...context]);

    expect(mockRequest.mock.calls[1]?.[1]).toMatchObject({
      query: { "searchCriteria.status": "active", $top: 30, $skip: 30 },
    });
    expect(result["pull-requests"]).toEqual([expect.objectContaining({ id: 31, status: "draft" })]);
  });
});

describe("pr URLs", () => {
  it("returns the API URL when retrieving a pull request", async () => {
    mockRequest.mockResolvedValueOnce({
      pullRequestId: 42,
      title: "Title",
      status: "active",
      repository: { name: "Repo" },
      url: "https://dev.azure.com/test-org/Project/_apis/git/repositories/Repo/pullrequests/42",
    });

    const result = await prCommand(["get", "42", ...context]);

    expect((result["pull-request"] as { url: string }).url).toBe(
      "https://dev.azure.com/test-org/Project/_apis/git/repositories/Repo/pullrequests/42",
    );
  });

  it("returns the API URL when creating a pull request", async () => {
    mockRequest.mockResolvedValueOnce({
      pullRequestId: 42,
      title: "Title",
      status: "active",
      sourceRefName: "refs/heads/feature",
      targetRefName: "refs/heads/main",
      url: "https://dev.azure.com/test-org/Project/_apis/git/repositories/Repo/pullrequests/42",
    });

    const result = await prCommand([
      "create", "--repo", "Repo", "--source", "feature", "--title", "Title", ...context,
    ]);

    expect((result.created as { url: string }).url).toBe(
      "https://dev.azure.com/test-org/Project/_apis/git/repositories/Repo/pullrequests/42",
    );
  });
});
