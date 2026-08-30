import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/client.js", () => ({ request: vi.fn() }));

import { repoCommand } from "../src/commands/repo.js";
import { request } from "../src/lib/client.js";

const mockRequest = vi.mocked(request);
const context = ["--org", "test-org", "--project", "Project", "--repo", "Web"];

beforeEach(() => mockRequest.mockReset());

describe("repo file", () => {
  it("reads a file at the default branch", async () => {
    mockRequest.mockResolvedValueOnce({
      path: "/src/Program.cs",
      commitId: "a".repeat(40),
      content: "line1\nline2\n",
      latestProcessedChange: { committer: { date: "2026-01-01T10:00:00Z" } },
    });

    const result = (await repoCommand(["file", "/src/Program.cs", ...context])) as Record<string, any>;

    expect(mockRequest.mock.calls[0]?.[1]).toMatchObject({
      path: "_apis/git/repositories/Web/items",
      query: { path: "/src/Program.cs", includeContent: true, $format: "json" },
    });
    expect(mockRequest.mock.calls[0]?.[1].query).not.toHaveProperty("versionDescriptor.version");
    expect(result.file).toMatchObject({
      repo: "Web",
      path: "/src/Program.cs",
      ref: "(default branch)",
      commit: "aaaaaaaa",
      lines: 3,
      showing: "all",
    });
    expect(result.content).toBe("line1\nline2\n");
  });

  it("selects a branch or an exact commit and rejects both at once", async () => {
    mockRequest.mockResolvedValueOnce({ content: "x" });
    await repoCommand(["file", "/a.txt", "--ref", "refs/heads/main", ...context]);
    expect(mockRequest.mock.calls[0]?.[1].query).toMatchObject({
      "versionDescriptor.version": "main",
      "versionDescriptor.versionType": "branch",
    });

    mockRequest.mockResolvedValueOnce({ content: "x" });
    await repoCommand(["file", "/a.txt", "--commit", "b".repeat(40), ...context]);
    expect(mockRequest.mock.calls[1]?.[1].query).toMatchObject({
      "versionDescriptor.version": "b".repeat(40),
      "versionDescriptor.versionType": "commit",
    });

    await expect(
      repoCommand(["file", "/a.txt", "--ref", "main", "--commit", "b".repeat(40), ...context]),
    ).rejects.toThrow(/mutually exclusive/);
  });

  it("bounds output with --limit and points at --full", async () => {
    mockRequest.mockResolvedValueOnce({ content: "a\nb\nc\nd\n" });
    const result = (await repoCommand(["file", "/a.txt", "--limit", "2", ...context])) as Record<string, any>;
    expect(result.content).toBe("a\nb");
    expect(result.file).toMatchObject({ lines: 5, showing: "first 2" });
    expect(result.help?.[0]).toContain("--full");
  });

  it("refuses folders, binaries, and missing arguments", async () => {
    mockRequest.mockResolvedValueOnce({ isFolder: true, path: "/src" });
    await expect(repoCommand(["file", "/src", ...context])).rejects.toThrow(/is a folder/);

    mockRequest.mockResolvedValueOnce({ content: "PK\u0000\u0000binary" });
    const binary = (await repoCommand(["file", "/a.zip", ...context])) as Record<string, any>;
    expect(binary.file).toMatchObject({ content: "binary" });

    await expect(repoCommand(["file", "--org", "o", "--project", "p"])).rejects.toThrow(
      /--repo <name> and a file path are required/,
    );
    await expect(repoCommand(["file", "C:/src/App.cs", ...context])).rejects.toThrow(/Windows path/);
  });
});
