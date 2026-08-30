import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/client.js", () => ({ request: vi.fn(), requestList: vi.fn() }));

import { workItemCommand } from "../src/commands/workItem.js";
import { request } from "../src/lib/client.js";

const mockRequest = vi.mocked(request);
const context = ["--org", "test-org", "--project", "Project"];
const projectId = "11111111-1111-1111-1111-111111111111";
const repoId = "22222222-2222-2222-2222-222222222222";
const sha = "c".repeat(40);

beforeEach(() => mockRequest.mockReset());

describe("work-item link list", () => {
  it("resolves hierarchy and artifact links to readable targets", async () => {
    mockRequest.mockResolvedValueOnce({
      id: 4211,
      rev: 7,
      relations: [
        { rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/o/_apis/wit/workItems/4200" },
        {
          rel: "ArtifactLink",
          url: `vstfs:///Git/PullRequestId/${projectId}%2F${repoId}%2F812`,
          attributes: { name: "Pull Request", comment: "implements" },
        },
        {
          rel: "ArtifactLink",
          url: `vstfs:///Git/Commit/${projectId}%2F${repoId}%2F${sha}`,
          attributes: { name: "Fixed in Commit" },
        },
      ],
    });

    const result = (await workItemCommand(["link", "list", "4211", ...context])) as Record<string, any>;

    expect(mockRequest.mock.calls[0]?.[1]).toMatchObject({
      path: "_apis/wit/workitems/4211",
      query: { $expand: "relations" },
    });
    expect(result.links).toEqual([
      { type: "parent", target: 4200, comment: "" },
      { type: "pull-request", target: "812", comment: "implements" },
      { type: "commit", target: "cccccccc", comment: "" },
    ]);
  });

  it("reports a definitive empty state", async () => {
    mockRequest.mockResolvedValueOnce({ id: 4211, rev: 2, relations: [] });
    const result = (await workItemCommand(["link", "4211", ...context])) as Record<string, any>;
    expect(result.links).toBe("0 links on work item 4211");
    expect(result.help?.[1]).toContain("--pr <pull-request-id>");
  });
});

describe("work-item link add", () => {
  it("adds a hierarchy link with an optional compare-and-swap", async () => {
    mockRequest.mockResolvedValueOnce({ id: 4211, rev: 7, relations: [] }).mockResolvedValueOnce({ id: 4211, rev: 8 });

    const result = (await workItemCommand([
      "link", "add", "4211", "--parent", "4200", "--if-rev", "7", ...context,
    ])) as Record<string, any>;

    expect(mockRequest.mock.calls[1]?.[1]).toMatchObject({
      method: "PATCH",
      contentType: "application/json-patch+json",
      body: [
        { op: "test", path: "/rev", value: 7 },
        {
          op: "add",
          path: "/relations/-",
          value: {
            rel: "System.LinkTypes.Hierarchy-Reverse",
            url: "https://dev.azure.com/test-org/_apis/wit/workItems/4200",
            attributes: {},
          },
        },
      ],
    });
    expect(result.linked).toMatchObject({ type: "parent", target: "4200", rev: 8 });
  });

  it("builds a pull request artifact link from the pull request id", async () => {
    mockRequest
      .mockResolvedValueOnce({ repository: { id: repoId, project: { id: projectId } } })
      .mockResolvedValueOnce({ id: 4211, rev: 7, relations: [] })
      .mockResolvedValueOnce({ id: 4211, rev: 8 });

    const result = (await workItemCommand(["link", "add", "4211", "--pr", "812", ...context])) as Record<
      string,
      any
    >;

    expect(mockRequest.mock.calls[0]?.[1]).toMatchObject({ path: "_apis/git/pullrequests/812" });
    expect((mockRequest.mock.calls[2]?.[1].body as any[])[0]).toMatchObject({
      value: {
        rel: "ArtifactLink",
        url: `vstfs:///Git/PullRequestId/${projectId}%2F${repoId}%2F812`,
        attributes: { name: "Pull Request" },
      },
    });
    expect(result.linked).toMatchObject({ type: "pull-request", target: "812" });
  });

  it("treats an existing link as a no-op", async () => {
    mockRequest.mockResolvedValueOnce({
      id: 4211,
      rev: 7,
      relations: [
        { rel: "System.LinkTypes.Related", url: "https://dev.azure.com/test-org/_apis/wit/workItems/4300" },
      ],
    });

    const result = (await workItemCommand(["link", "add", "4211", "--related", "4300", ...context])) as Record<
      string,
      any
    >;
    expect(result.link).toBe("#4211 already links to 4300 as related (no-op)");
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it("detects an existing link even when Azure DevOps rewrote the url with the project guid", async () => {
    mockRequest.mockResolvedValueOnce({
      id: 4211,
      rev: 3,
      relations: [
        {
          rel: "System.LinkTypes.Related",
          url: `https://dev.azure.com/test-org/${projectId}/_apis/wit/workItems/4300`,
        },
      ],
    });
    const result = (await workItemCommand(["link", "add", "4211", "--related", "4300", ...context])) as Record<
      string,
      any
    >;
    expect(result.link).toBe("#4211 already links to 4300 as related (no-op)");
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it("keeps the full branch name of a Git ref artifact link", async () => {
    mockRequest.mockResolvedValueOnce({
      id: 4211,
      rev: 3,
      relations: [
        {
          rel: "ArtifactLink",
          url: `vstfs:///Git/Ref/${projectId}%2F${repoId}%2FGBfeature%2Flogin`,
          attributes: { name: "Branch" },
        },
      ],
    });
    const result = (await workItemCommand(["link", "list", "4211", ...context])) as Record<string, any>;
    expect(result.links).toEqual([{ type: "branch", target: "feature/login", comment: "" }]);
  });

  it("validates the target selection", async () => {
    await expect(workItemCommand(["link", "add", "4211", ...context])).rejects.toThrow(
      /a link target is required/,
    );
    await expect(
      workItemCommand(["link", "add", "4211", "--parent", "1", "--pr", "2", ...context]),
    ).rejects.toThrow(/exactly one link target/);
    await expect(
      workItemCommand(["link", "add", "4211", "--parent", "4211", ...context]),
    ).rejects.toThrow(/cannot link to itself/);
    await expect(
      workItemCommand(["link", "add", "4211", "--commit", "abc", "--repo", "Web", ...context]),
    ).rejects.toThrow(/40-character commit id/);
    await expect(
      workItemCommand(["link", "add", "4211", "--commit", sha, ...context]),
    ).rejects.toThrow(/--repo <name> is required/);
  });
});
