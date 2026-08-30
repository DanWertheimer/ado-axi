import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/client.js", () => ({ request: vi.fn() }));

import { pipelineCommand } from "../src/commands/pipeline.js";
import { request } from "../src/lib/client.js";

const mockRequest = vi.mocked(request);
const context = ["--org", "test-org", "--project", "Project"];

const timeline = {
  records: [
    { id: "s1", type: "Stage", name: "Build", state: "completed", result: "failed", order: 1 },
    { id: "j1", parentId: "s1", type: "Job", name: "Compile", state: "completed", result: "failed" },
    {
      id: "t1",
      parentId: "j1",
      type: "Task",
      name: "dotnet build",
      state: "completed",
      result: "failed",
      startTime: "2026-01-01T10:00:00Z",
      finishTime: "2026-01-01T10:00:30Z",
      errorCount: 2,
      log: { id: 7 },
      issues: [{ type: "error", message: "CS1002:\n  ; expected" }],
    },
    {
      id: "t2",
      parentId: "j1",
      type: "Task",
      name: "dotnet test",
      state: "completed",
      result: "failed",
      startTime: "2026-01-01T10:01:00Z",
      log: { id: 9 },
      issues: [],
    },
    { id: "t3", parentId: "j1", type: "Task", name: "restore", state: "completed", result: "succeeded" },
  ],
};

beforeEach(() => mockRequest.mockReset());

describe("pipeline timeline", () => {
  it("summarizes stages and failing steps with their log ids", async () => {
    mockRequest.mockResolvedValueOnce(timeline);
    const result = (await pipelineCommand(["timeline", "42", ...context])) as Record<string, any>;

    expect(mockRequest.mock.calls[0]?.[1]).toMatchObject({ path: "_apis/build/builds/42/timeline" });
    expect(result.run).toMatchObject({ id: 42, failed: 2, errors: 2 });
    expect(result.stages).toEqual([
      { name: "Build", state: "completed", result: "failed", seconds: "" },
    ]);
    expect(result.failures).toEqual([
      {
        step: "dotnet build",
        in: "Build / Compile",
        type: "Task",
        result: "failed",
        log: 7,
        issue: "CS1002: ; expected",
      },
      { step: "dotnet test", in: "Build / Compile", type: "Task", result: "failed", log: 9, issue: "" },
    ]);
    expect(result.help?.[0]).toContain("--log 7");
  });

  it("reports a definitive empty state for a run without failures or records", async () => {
    mockRequest.mockResolvedValueOnce({
      records: [{ id: "s1", type: "Stage", name: "Build", state: "completed", result: "succeeded" }],
    });
    const passed = (await pipelineCommand(["timeline", "42", ...context])) as Record<string, any>;
    expect(passed.failures).toBe("0 failed steps on run 42");
    expect(passed.help).toBeUndefined();

    mockRequest.mockResolvedValueOnce(null);
    const queued = (await pipelineCommand(["timeline", "42", ...context])) as Record<string, any>;
    expect(queued.timeline).toContain("0 timeline records for run 42");
  });

  it("bounds failures with --limit and expands every record with --full", async () => {
    mockRequest.mockResolvedValueOnce(timeline);
    const bounded = (await pipelineCommand([
      "timeline",
      "42",
      "--limit",
      "1",
      ...context,
    ])) as Record<string, any>;
    expect(bounded.failures).toHaveLength(1);
    expect(bounded.help).toContain("Showing 1 of 2 failed steps — pass --limit 2 or --full");

    mockRequest.mockResolvedValueOnce(timeline);
    const full = (await pipelineCommand(["timeline", "42", "--full", ...context])) as Record<string, any>;
    expect(full.records).toHaveLength(5);
  });
});

describe("pipeline timeline log ids", () => {
  it("treats `log.id: 0` as no log at all", async () => {
    const manual = {
      records: [
        {
          id: "t1",
          type: "Task",
          name: "ManualValidation",
          state: "completed",
          result: "failed",
          log: { id: 0 },
        },
      ],
    };
    mockRequest.mockResolvedValueOnce(manual);
    const result = (await pipelineCommand(["timeline", "42", ...context])) as Record<string, any>;
    expect(result.failures).toEqual([
      { step: "ManualValidation", in: "", type: "Task", result: "failed", log: "", issue: "" },
    ]);
    expect(result.help?.some((line: string) => line.includes("--log"))).toBe(false);

    mockRequest.mockResolvedValueOnce({ value: [{ id: 5 }] }).mockResolvedValueOnce(manual);
    const logs = (await pipelineCommand(["logs", "42", "--failed-only", ...context])) as Record<string, any>;
    expect(logs.logs).toBe("0 failed steps with logs on run 42");
  });
});

describe("pipeline logs --failed-only", () => {
  it("reads the first failing step's log and names the remaining failures", async () => {
    mockRequest
      .mockResolvedValueOnce({ value: [{ id: 5 }, { id: 7 }, { id: 9 }] })
      .mockResolvedValueOnce(timeline)
      .mockResolvedValueOnce("line one\nline two\n");

    const result = (await pipelineCommand([
      "logs",
      "42",
      "--failed-only",
      ...context,
    ])) as Record<string, any>;

    expect(mockRequest.mock.calls[2]?.[1]).toMatchObject({
      path: "_apis/build/builds/42/logs/7",
      accept: "text/plain",
      raw: true,
    });
    expect(result.log).toMatchObject({ id: 7, step: "dotnet build", result: "failed" });
    expect(result.help?.[0]).toContain("dotnet test (--log 9)");
  });

  it("returns a definitive empty state when nothing failed", async () => {
    mockRequest
      .mockResolvedValueOnce({ value: [{ id: 5 }] })
      .mockResolvedValueOnce({ records: [{ id: "t1", type: "Task", result: "succeeded", log: { id: 5 } }] });

    const result = (await pipelineCommand(["logs", "42", "--failed-only", ...context])) as Record<string, any>;
    expect(result.logs).toBe("0 failed steps with logs on run 42");
    expect(result.help?.[0]).toContain("pipeline timeline 42");
  });
});
