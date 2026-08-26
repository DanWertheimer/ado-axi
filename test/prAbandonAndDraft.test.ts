import { beforeEach, describe, expect, it, vi } from "vitest";
import { AxiError } from "axi-sdk-js";

vi.mock("../src/lib/client.js", () => ({ request: vi.fn() }));
vi.mock("../src/lib/stdin.js", () => ({ readStdinIfPiped: vi.fn(async () => undefined) }));

import { prCommand } from "../src/commands/pr.js";
import { request } from "../src/lib/client.js";

const mockRequest = vi.mocked(request);
const context = ["--org", "test-org", "--project", "Project"];
const pr = {
  pullRequestId: 42,
  title: "Add a thing",
  description: "Body",
  status: "active",
  isDraft: false,
  mergeStatus: "succeeded",
  sourceRefName: "refs/heads/feature/x",
  lastMergeSourceCommit: { commitId: "a".repeat(40) },
  repository: { name: "Repo", project: { id: "project-id", name: "Project" } },
  reviewers: [],
};

beforeEach(() => {
  mockRequest.mockReset();
  process.exitCode = undefined;
});

describe("pr abandon", () => {
  it("patches status to abandoned and returns the browser url", async () => {
    mockRequest.mockResolvedValueOnce(pr).mockResolvedValueOnce({ ...pr, status: "abandoned" });

    const result = await prCommand(["abandon", "42", ...context]);

    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockRequest.mock.calls[1]?.[1]).toMatchObject({
      method: "PATCH",
      path: "_apis/git/repositories/Repo/pullrequests/42",
      body: { status: "abandoned" },
    });
    expect(result.abandoned).toMatchObject({
      id: 42,
      repo: "Repo",
      status: "abandoned",
      source: "feature/x",
      url: "https://dev.azure.com/test-org/Project/_git/Repo/pullrequest/42",
    });
  });

  it("reports an already-abandoned pull request as a no-op without patching", async () => {
    mockRequest.mockResolvedValueOnce({ ...pr, status: "abandoned" });

    const result = await prCommand(["abandon", "42", ...context]);

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(String(result["pull-request"])).toContain("no-op");
    expect(result.outcome).toBe("abandoned");
  });

  it("refuses to abandon a completed pull request", async () => {
    mockRequest.mockResolvedValueOnce({ ...pr, status: "completed" });

    await expect(prCommand(["abandon", "42", ...context])).rejects.toBeInstanceOf(AxiError);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});

describe("pr list --status draft", () => {
  it("queries active and keeps only drafts", async () => {
    mockRequest.mockResolvedValueOnce({
      value: [
        { ...pr, pullRequestId: 1, isDraft: true },
        { ...pr, pullRequestId: 2, isDraft: false },
      ],
      count: 2,
    });

    const result = await prCommand(["list", "--status", "draft", ...context]);

    expect(mockRequest.mock.calls[0]?.[1]).toMatchObject({
      query: { "searchCriteria.status": "active" },
    });
    const rows = result["pull-requests"] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1, status: "draft" });
  });

  it("counts only the drafts it kept, not the active total", async () => {
    mockRequest.mockResolvedValueOnce({
      value: [
        { ...pr, pullRequestId: 1, isDraft: true },
        { ...pr, pullRequestId: 2, isDraft: false },
        { ...pr, pullRequestId: 3, isDraft: false },
      ],
      count: 3,
    });

    const result = await prCommand(["list", "--status", "draft", ...context]);

    expect(result.count).toBe("1 draft pull requests");
  });

  it("reports a definitive empty state when no drafts are open", async () => {
    mockRequest.mockResolvedValueOnce({ value: [{ ...pr, isDraft: false }], count: 1 });

    const result = await prCommand(["list", "--status", "draft", ...context]);

    expect(String(result["pull-requests"])).toContain("0 draft pull requests");
  });

  it("rejects a status Azure DevOps does not accept", async () => {
    await expect(prCommand(["list", "--status", "merged", ...context])).rejects.toBeInstanceOf(AxiError);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("passes a real Azure DevOps status straight through", async () => {
    mockRequest.mockResolvedValueOnce({ value: [{ ...pr, status: "completed" }], count: 1 });

    await prCommand(["list", "--status", "completed", ...context]);

    expect(mockRequest.mock.calls[0]?.[1]).toMatchObject({
      query: { "searchCriteria.status": "completed" },
    });
  });
});

describe("pr web url", () => {
  it("derives the url from the repository webUrl when Azure DevOps supplies one", async () => {
    mockRequest.mockResolvedValueOnce({
      ...pr,
      repository: { name: "Repo", webUrl: "https://dev.azure.com/test-org/Project/_git/Repo" },
    });

    const result = await prCommand(["get", "42", ...context]);

    expect(result["pull-request"]).toMatchObject({
      url: "https://dev.azure.com/test-org/Project/_git/Repo/pullrequest/42",
    });
  });

  it("prefers an explicit _links.web.href when present", async () => {
    mockRequest.mockResolvedValueOnce({
      ...pr,
      _links: { web: { href: "https://example.invalid/pr/42" } },
    });

    const result = await prCommand(["get", "42", ...context]);

    expect(result["pull-request"]).toMatchObject({ url: "https://example.invalid/pr/42" });
  });
});
