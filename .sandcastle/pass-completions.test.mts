import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPassCompletions, recordPassCompletion } from "./pass-completions.mjs";
import type { FactoryStatus } from "./status.mjs";

function status(overrides: Partial<FactoryStatus> = {}): FactoryStatus {
  return {
    passId: "2026-11-23T10:00:00.000Z",
    phase: "finished",
    ticket: null,
    detail: "",
    startedAt: "2026-11-23T09:00:00.000Z",
    updatedAt: "2026-11-23T10:00:00.000Z",
    finishedAt: "2026-11-23T10:00:00.000Z",
    error: null,
    tickets: {},
    delivered: 2,
    ...overrides,
  };
}

function scratch(run: (dir: string, path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "pass-completions-"));
  try {
    run(dir, join(dir, "completions.jsonl"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a finished pass is recorded with its outcome and delivery count", () => {
  scratch((_dir, path) => {
    recordPassCompletion(path, status());
    assert.deepEqual(readPassCompletions(path), [
      {
        passId: "2026-11-23T10:00:00.000Z",
        finishedAt: "2026-11-23T10:00:00.000Z",
        phase: "finished",
        delivered: 2,
        error: null,
      },
    ]);
  });
});

test("a failed pass keeps its error for the retro", () => {
  scratch((_dir, path) => {
    recordPassCompletion(
      path,
      status({ phase: "failed", error: "lane timeout", finishedAt: "2026-11-23T11:00:00.000Z" }),
    );
    const [completion] = readPassCompletions(path);
    assert.equal(completion?.phase, "failed");
    assert.equal(completion?.error, "lane timeout");
  });
});

test("a repeated pass id, a partial line and a missing file do not break the reader", () => {
  scratch((_dir, path) => {
    assert.deepEqual(readPassCompletions(path), []);
    recordPassCompletion(path, status());
    recordPassCompletion(path, status());
    writeFileSync(path, '{"passId":\n', { flag: "a" });
    writeFileSync(path, `${JSON.stringify({ passId: "wrong" })}\n`, { flag: "a" });
    assert.equal(readPassCompletions(path).length, 1);
  });
});

test("completions read back oldest first", () => {
  scratch((_dir, path) => {
    recordPassCompletion(
      path,
      status({ passId: "later", finishedAt: "2026-11-23T12:00:00.000Z" }),
    );
    recordPassCompletion(path, status({ passId: "earlier", finishedAt: "2026-11-23T09:00:00.000Z" }));
    assert.deepEqual(
      readPassCompletions(path).map((completion) => completion.passId),
      ["earlier", "later"],
    );
  });
});
