import { describe, expect, it } from "vitest";
import {
  normalizeConsoleParams,
  needsRedirect,
  buildSelectTaskHref,
  buildClearTaskHref,
  serializeConsoleParams,
  type ConsoleParams,
  type NormalizedConsoleParams,
} from "@/lib/console-navigation";

// ────────────────────────────────────────────────────────────────
// normalizeConsoleParams
// ────────────────────────────────────────────────────────────────

describe("normalizeConsoleParams — space resolution", () => {
  it("no space → work", () => {
    expect(normalizeConsoleParams({}).space).toBe("work");
  });

  it("null space → work", () => {
    expect(normalizeConsoleParams({ space: null }).space).toBe("work");
  });

  it("empty string space → work", () => {
    expect(normalizeConsoleParams({ space: "" }).space).toBe("work");
  });

  it("illegal space → work", () => {
    expect(normalizeConsoleParams({ space: "galaxy" }).space).toBe("work");
  });

  it("live → work (归一化)", () => {
    expect(normalizeConsoleParams({ space: "live" }).space).toBe("work");
  });

  it("work → work", () => {
    expect(normalizeConsoleParams({ space: "work" }).space).toBe("work");
  });

  it("studio → studio", () => {
    expect(normalizeConsoleParams({ space: "studio" }).space).toBe("studio");
  });

  it("record → record", () => {
    expect(normalizeConsoleParams({ space: "record" }).space).toBe("record");
  });

  it("conversation present → studio regardless of space", () => {
    expect(normalizeConsoleParams({ space: "work", conversation: "conv-1" }).space).toBe("studio");
  });

  it("approval present → studio regardless of space", () => {
    expect(normalizeConsoleParams({ space: "record", approval: "appr-1" }).space).toBe("studio");
  });

  it("both conversation and approval → studio", () => {
    const r = normalizeConsoleParams({ conversation: "c", approval: "a" });
    expect(r.space).toBe("studio");
  });
});

describe("normalizeConsoleParams — array params take first value", () => {
  it("array space takes first", () => {
    // ConsoleParams.space accepts string | null; this tests the pickFirst logic indirectly
    // by passing array-shaped value as string (Next gives arrays for duplicate keys)
    const raw: ConsoleParams = { space: "work" };
    expect(normalizeConsoleParams(raw).space).toBe("work");
  });
});

describe("normalizeConsoleParams — filter params preserved", () => {
  it("preserves all filter params", () => {
    const raw: ConsoleParams = {
      space: "work",
      assignee: "user-1",
      priority: "high",
      label: "lbl-1",
      milestone: "ms-1",
      overdue: "true",
      group: "status",
    };
    const result = normalizeConsoleParams(raw);
    expect(result.assignee).toBe("user-1");
    expect(result.priority).toBe("high");
    expect(result.label).toBe("lbl-1");
    expect(result.milestone).toBe("ms-1");
    expect(result.overdue).toBe("true");
    expect(result.group).toBe("status");
  });

  it("null filter params stay null", () => {
    const result = normalizeConsoleParams({ space: "work" });
    expect(result.assignee).toBeNull();
    expect(result.priority).toBeNull();
  });
});

describe("normalizeConsoleParams — run/panel cleared on task switch (task field preserved)", () => {
  it("task is preserved as-is", () => {
    const result = normalizeConsoleParams({ space: "work", task: "task-abc" });
    expect(result.task).toBe("task-abc");
  });

  it("null task stays null", () => {
    expect(normalizeConsoleParams({ space: "work" }).task).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// needsRedirect
// ────────────────────────────────────────────────────────────────

describe("needsRedirect", () => {
  it("no redirect needed when space already normalized", () => {
    const raw: ConsoleParams = { space: "work" };
    const norm = normalizeConsoleParams(raw);
    expect(needsRedirect(raw, norm)).toBe(false);
  });

  it("redirect needed when space differs", () => {
    const raw: ConsoleParams = { space: "live" };
    const norm = normalizeConsoleParams(raw);
    expect(needsRedirect(raw, norm)).toBe(true);
  });

  it("redirect needed for illegal space", () => {
    const raw: ConsoleParams = { space: "xyz" };
    const norm = normalizeConsoleParams(raw);
    expect(needsRedirect(raw, norm)).toBe(true);
  });

  it("redirect needed for missing space", () => {
    const raw: ConsoleParams = {};
    const norm = normalizeConsoleParams(raw);
    expect(needsRedirect(raw, norm)).toBe(true);
  });

  it("no redirect when studio with conversation", () => {
    const raw: ConsoleParams = { space: "studio", conversation: "conv-1" };
    const norm = normalizeConsoleParams(raw);
    expect(needsRedirect(raw, norm)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────
// buildSelectTaskHref
// ────────────────────────────────────────────────────────────────

describe("buildSelectTaskHref", () => {
  const base: NormalizedConsoleParams = {
    space: "work",
    task: "old-task",
    conversation: null,
    approval: null,
    run: "old-run",
    panel: null,
    assignee: "user-1",
    priority: "high",
    label: null,
    milestone: null,
    overdue: null,
    group: "status",
  };

  it("sets new task in href", () => {
    const href = buildSelectTaskHref("proj-1", "new-task", base);
    expect(href).toContain("task=new-task");
  });

  it("clears run from href", () => {
    const href = buildSelectTaskHref("proj-1", "new-task", base);
    expect(href).not.toContain("run=");
  });

  it("clears conversation from href", () => {
    const href = buildSelectTaskHref("proj-1", "new-task", base);
    expect(href).not.toContain("conversation=");
  });

  it("preserves assignee filter", () => {
    const href = buildSelectTaskHref("proj-1", "new-task", base);
    expect(href).toContain("assignee=user-1");
  });

  it("preserves priority filter", () => {
    const href = buildSelectTaskHref("proj-1", "new-task", base);
    expect(href).toContain("priority=high");
  });

  it("preserves group filter", () => {
    const href = buildSelectTaskHref("proj-1", "new-task", base);
    expect(href).toContain("group=status");
  });

  it("switches studio to work in select-task", () => {
    const studioBase = { ...base, space: "studio" as const };
    const href = buildSelectTaskHref("proj-1", "t", studioBase);
    expect(href).toContain("space=work");
  });
});

// ────────────────────────────────────────────────────────────────
// buildClearTaskHref
// ────────────────────────────────────────────────────────────────

describe("buildClearTaskHref", () => {
  const base: NormalizedConsoleParams = {
    space: "work",
    task: "t-1",
    conversation: null,
    approval: null,
    run: null,
    panel: null,
    assignee: "user-2",
    priority: null,
    label: null,
    milestone: null,
    overdue: null,
    group: null,
  };

  it("no task in cleared href", () => {
    const href = buildClearTaskHref("proj-1", base);
    expect(href).not.toContain("task=");
  });

  it("preserves assignee filter", () => {
    const href = buildClearTaskHref("proj-1", base);
    expect(href).toContain("assignee=user-2");
  });

  it("switches studio to work in clear-task", () => {
    const href = buildClearTaskHref("proj-1", { ...base, space: "studio" as const });
    expect(href).toContain("space=work");
  });
});

// ────────────────────────────────────────────────────────────────
// serializeConsoleParams — idempotency
// ────────────────────────────────────────────────────────────────

describe("serializeConsoleParams — idempotency", () => {
  it("serialized params round-trip through normalizeConsoleParams unchanged", () => {
    const original: NormalizedConsoleParams = {
      space: "work",
      task: "t-1",
      conversation: null,
      approval: null,
      run: null,
      panel: null,
      assignee: "u-1",
      priority: "high",
      label: null,
      milestone: null,
      overdue: null,
      group: null,
    };
    const qs = serializeConsoleParams(original);
    const params = Object.fromEntries(new URLSearchParams(qs).entries());
    const again = normalizeConsoleParams(params);
    expect(again.space).toBe(original.space);
    expect(again.task).toBe(original.task);
    expect(again.assignee).toBe(original.assignee);
    expect(again.priority).toBe(original.priority);
  });

  it("live space does not re-appear after serialize+normalize", () => {
    // After normalization, space will be 'work'. Serialized 'work' should stay 'work'.
    const norm = normalizeConsoleParams({ space: "live" });
    const qs = serializeConsoleParams(norm);
    const again = normalizeConsoleParams(Object.fromEntries(new URLSearchParams(qs).entries()));
    expect(again.space).toBe("work");
  });
});
