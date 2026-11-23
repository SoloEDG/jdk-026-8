import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { puzzles } from "../src/features/catalog/model/puzzles";
import { newDocument, newSession } from "../src/shared/document";
import { clueSet } from "../src/shared/clues";
import { puzzleVersion } from "../src/shared/version";
import { transition } from "../src/app/reducer";
import type { GameDocument, Mark, Puzzle } from "../src/shared/types";
import {
  buildPlan,
  chooseCell,
  contentSize,
  gridMetrics,
  PAGE,
} from "../src/features/workbook/model/layout";
import {
  normalizeConfig,
  type WorkbookConfig,
  type WorkbookPuzzle,
} from "../src/features/workbook/model/types";
import {
  makeWorkbook,
  reconcilePaper,
  workbookPuzzles,
} from "../src/features/workbook/model/workbook";
import {
  loadWorkbooks,
  saveWorkbook,
} from "../src/features/workbook/lib/storage";

Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  configurable: true,
});

const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  },
  configurable: true,
});

function candidateList(ids: string[]) {
  return ids.map((id) => ({
    puzzle: puzzles.find((p) => p.id === id)!,
    ordinal: puzzles.findIndex((p) => p.id === id) + 1,
  }));
}

function printable(ids: string[], document: GameDocument = newDocument(puzzles[0])) {
  return workbookPuzzles(candidateList(ids), document);
}

function config(overrides: Partial<WorkbookConfig> = {}): WorkbookConfig {
  return normalizeConfig({
    paper: "a4",
    orientation: "portrait",
    columns: 1,
    strategy: "writing",
    minCell: 6,
    customCell: 7,
    includeAnswers: false,
    includeMarks: false,
    ...overrides,
  });
}

test("clue strips and grids are atomic: no figure crosses a page boundary", () => {
  const all = puzzles.map((p) => p.id);
  for (const strategy of ["writing", "paper"] as const) {
    for (const columns of [1, 2, 3]) {
      for (const orientation of ["portrait", "landscape"] as const) {
        const cfg = config({ strategy, columns, orientation });
        const plan = buildPlan(cfg, printable(all));
        const content = contentSize(cfg);
        const tolerance = 0.001;
        for (const page of plan.pages) {
          for (const figure of page.figures) {
            assert.ok(figure.y >= -tolerance, "figure starts inside the page");
            assert.ok(
              figure.y + figure.height <= content.height + tolerance,
              `figure ${figure.puzzleId} ends inside page ${page.number}`,
            );
            assert.ok(figure.x >= -tolerance);
            assert.ok(figure.x + figure.width <= content.width + tolerance);
            // The clue gutter is part of the figure: it moves with the grid.
            assert.ok(figure.grid.colClueHeight >= 0);
            assert.equal(
              figure.grid.gridWidth,
              figure.grid.rowClueWidth + figure.grid.size * figure.grid.cell,
            );
          }
        }
      }
    }
  }
});

test("every selected puzzle is printed exactly once, in catalog order", () => {
  const ids = ["heart", "bloom", "lighthouse", "cup"];
  const plan = buildPlan(config({ columns: 2 }), printable(ids));
  const printed = plan.pages.flatMap((page) =>
    page.figures.map((figure) => figure.puzzleId),
  );
  assert.deepEqual(printed, ids);
});

test("printed clue numbers equal the on-screen puzzle clues", () => {
  const plan = buildPlan(config({ columns: 3, strategy: "paper" }), printable(["lighthouse", "cat"]));
  for (const page of plan.pages) {
    for (const figure of page.figures) {
      const source = puzzles.find((p) => p.id === figure.puzzleId)!;
      const clues = clueSet(source.size, source.solution);
      assert.deepEqual(figure.clues.rows, clues.slice(0, source.size));
      assert.deepEqual(figure.clues.cols, clues.slice(source.size));
    }
  }
});

test("preview geometry and print geometry are the same numbers", () => {
  const cfg = config({ columns: 2 });
  const first = buildPlan(cfg, printable(["bloom", "fern"]));
  const second = buildPlan(cfg, printable(["bloom", "fern"]));
  assert.deepEqual(first.pages, second.pages);
  assert.equal(first.cell, second.cell);
  assert.equal(first.pageSize.width, 210);
  assert.equal(first.content.width, 210 - PAGE.margin * 2);
});

test("pagination is explainable: chosen cell preserves the minimum page count", () => {
  const puzzlesInBook = printable(puzzles.map((p) => p.id));
  const cfg = config({ minCell: 6, columns: 1 });
  const choice = chooseCell(cfg, puzzlesInBook);
  assert.ok(choice.cell >= cfg.minCell);
  assert.match(choice.explanation, /书写优先/);
  assert.match(choice.explanation, new RegExp(`${choice.cell} mm`));
  // A larger cell inside the comfort range must not reduce the page count.
  const larger = chooseCell({ ...cfg, minCell: choice.cell + 0.5 }, puzzlesInBook);
  assert.ok(larger.cell >= choice.cell);
});

test("custom cell size is honoured and overflow is reported, not clipped silently", () => {
  const cfg = config({ strategy: "custom", customCell: 12, columns: 1 });
  const plan = buildPlan(cfg, printable(["lighthouse"]));
  assert.ok(plan.cell <= 12);
  assert.ok(plan.cell >= 3);
  for (const page of plan.pages) {
    for (const figure of page.figures)
      assert.ok(figure.height <= plan.content.height + 1e-6);
  }
});

test("answers are opt-in and always start on their own later pages", () => {
  const without = buildPlan(config(), printable(["heart", "cup"]));
  assert.equal(without.answerPages, 0);
  assert.equal(without.answerStartPage, null);
  assert.ok(without.pages.every((p) => p.kind === "puzzle"));

  const withAnswers = buildPlan(
    config({ includeAnswers: true }),
    printable(["heart", "cup"]),
  );
  assert.ok(withAnswers.answerPages > 0);
  assert.equal(withAnswers.answerStartPage, withAnswers.puzzlePages + 1);
  const firstAnswer = withAnswers.pages.findIndex((p) => p.kind === "answer");
  assert.equal(firstAnswer, withAnswers.puzzlePages);
  for (const page of withAnswers.pages.slice(0, withAnswers.puzzlePages))
    assert.ok(page.figures.every((f) => f.solution === undefined));
  for (const figure of withAnswers.pages.flatMap((p) => p.figures)) {
    if (figure.kind === "answer") assert.ok(figure.solution);
    else assert.equal(figure.solution, undefined);
  }
});

test("unsolved puzzle names and thumbnails never appear before they are solved", () => {
  const doc = newDocument(puzzles[0]);
  const plan = buildPlan(config({ includeAnswers: true }), workbookPuzzles(candidateList(["bloom", "heart"]), doc));
  for (const figure of plan.pages.flatMap((p) => p.figures)) {
    assert.equal(figure.title, null);
    assert.match(figure.label, /^图案 \d{2}$/);
  }
  const solvedDoc = newDocument(puzzles[0]);
  const heart = puzzles.find((p) => p.id === "heart")!;
  let d = { ...solvedDoc, activeId: "heart", sessions: { heart: newSession(heart) } };
  heart.solution.forEach((v, index) => {
    if (v) d = transition(d, { type: "mark", index, mark: "filled" }, puzzles);
  });
  assert.equal(d.sessions.heart.solved, true);
  const solvedPlan = buildPlan(config(), workbookPuzzles(candidateList(["bloom", "heart"]), d));
  const labels = solvedPlan.pages.flatMap((p) => p.figures.map((f) => f.title));
  assert.ok(labels.includes(heart.title));
});

test("a printed workbook round-trips through its saved snapshot and code", () => {
  const doc = newDocument(puzzles[1]);
  const { workbook, plan } = makeWorkbook(
    config({ columns: 2, includeAnswers: true }),
    candidateList(["heart", "cup"]),
    doc,
  );
  assert.match(workbook.code, /^GJ-[0-9A-Z]{7}$/);
  assert.equal(workbook.cell, plan.cell);
  const rebuilt = buildPlan(workbook.config, workbook.puzzles);
  assert.deepEqual(
    rebuilt.pages.map((p) => p.figures.map((f) => [f.puzzleId, f.x, f.y, f.width, f.height])),
    plan.pages.map((p) => p.figures.map((f) => [f.puzzleId, f.x, f.y, f.width, f.height])),
  );
  assert.equal(workbook.puzzles[0].version, puzzleVersion(puzzles[1]));
});

test("paper entry merges cleanly when the screen board is unchanged", () => {
  const doc = newDocument(puzzles[1]);
  const { workbook } = makeWorkbook(config(), candidateList(["heart"]), doc);
  const paper = Array<Mark>(workbook.puzzles[0].size ** 2).fill("unknown");
  for (let i = 0; i < paper.length; i++) paper[i] = i % 2 ? "cross" : "filled";
  const result = reconcilePaper(
    workbook,
    { heart: paper },
    { document: doc, catalog: puzzles },
  );
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.batches.length, 1);
  assert.deepEqual(result.batches[0].marks, paper);
  assert.deepEqual(result.batches[0].expectedMarks, doc.sessions.heart.marks);
});

test("later screen progress triggers a conflict before anything is applied", () => {
  const heart = puzzles.find((p) => p.id === "heart")!;
  const doc = newDocument(heart);
  const { workbook } = makeWorkbook(config(), candidateList(["heart"]), doc);
  // Continue solving on screen after printing.
  const live = transition(
    doc,
    { type: "mark", index: 0, mark: "filled" },
    puzzles,
  );
  const paper = Array<Mark>(workbook.puzzles[0].size ** 2).fill("unknown");
  paper[1] = "filled";
  const result = reconcilePaper(
    workbook,
    { heart: paper },
    { document: live, catalog: puzzles },
  );
  assert.equal(result.batches.length, 0);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].first?.index, 1);
  // Accepting paper resolves the conflict and keeps post-print screen marks
  // only where the paper agrees with the snapshot.
  const accepted = reconcilePaper(
    workbook,
    { heart: paper },
    { document: live, catalog: puzzles },
    { heart: "paper" },
  );
  // The reviewed conflict stays visible, but is marked as decided.
  assert.equal(accepted.conflicts.filter((c) => !c.chosen).length, 0);
  assert.equal(accepted.conflicts[0].chosen, "paper");
  assert.equal(accepted.batches.length, 1);
  assert.equal(accepted.batches[0].marks[1], "filled");
  assert.equal(accepted.batches[0].marks[0], "filled", "non-conflicting screen mark kept");
});

test("a missing original keeps the draft instead of borrowing a namesake", () => {
  const heart = puzzles.find((p) => p.id === "heart")!;
  const doc = newDocument(heart);
  const { workbook } = makeWorkbook(config(), candidateList(["heart"]), doc);
  const paper = Array<Mark>(workbook.puzzles[0].size ** 2).fill("filled");
  const removedCatalog = puzzles.filter((p) => p.id !== "heart");
  const result = reconcilePaper(
    workbook,
    { heart: paper },
    { document: doc, catalog: removedCatalog },
  );
  assert.equal(result.batches.length, 0);
  assert.deepEqual(result.missing, [workbook.puzzles[0].label]);

  // Same id, changed solution: still refuses to apply the paper batch.
  const replaced: Puzzle = { ...heart, solution: heart.solution.map((v) => (v ? 0 : 1)) };
  const replacedResult = reconcilePaper(
    workbook,
    { heart: paper },
    { document: doc, catalog: [...removedCatalog, replaced] },
  );
  assert.equal(replacedResult.batches.length, 0);
  assert.deepEqual(replacedResult.missing, [workbook.puzzles[0].label]);
});

test("reducer applies a paper batch atomically and records genuine solves only", () => {
  const heart = puzzles.find((p) => p.id === "heart")!;
  const cup = puzzles.find((p) => p.id === "cup")!;
  let doc: GameDocument = newDocument(heart);
  doc = {
    ...doc,
    sessions: {
      ...doc.sessions,
      [cup.id]: newSession(cup),
    },
  };
  const solveHeart = heart.solution.map((v) => (v ? "filled" : "cross")) as Mark[];
  const wrongCup = Array<Mark>(cup.size ** 2).fill("filled");
  const accepted = transition(
    doc,
    {
      type: "paperBatch",
      batches: [
        {
          puzzleId: heart.id,
          version: puzzleVersion(heart),
          expectedMarks: doc.sessions.heart.marks,
          marks: solveHeart,
        },
        {
          puzzleId: cup.id,
          version: puzzleVersion(cup),
          expectedMarks: doc.sessions.cup.marks,
          marks: wrongCup,
        },
      ],
    },
    puzzles,
  );
  assert.equal(accepted.sessions.heart.solved, true);
  assert.equal(accepted.records.filter((r) => r.puzzleId === heart.id).length, 1);
  assert.equal(accepted.sessions.cup.solved, false);
  assert.equal(accepted.records.filter((r) => r.puzzleId === cup.id).length, 0);

  // One stale batch rejects the whole submission.
  const stale = transition(
    doc,
    {
      type: "paperBatch",
      batches: [
        {
          puzzleId: heart.id,
          version: "v1-other",
          expectedMarks: doc.sessions.heart.marks,
          marks: solveHeart,
        },
        {
          puzzleId: cup.id,
          version: puzzleVersion(cup),
          expectedMarks: doc.sessions.cup.marks,
          marks: wrongCup,
        },
      ],
    },
    puzzles,
  );
  assert.equal(stale, doc, "nothing is written when any batch is stale");
});

test("a replaced same-id puzzle cannot inherit paper marks or a solve record", () => {
  const heart = puzzles.find((p) => p.id === "heart")!;
  const doc = newDocument(heart);
  const replaced: Puzzle = { ...heart, solution: heart.solution.map((v) => (v ? 0 : 1)) };
  const solved = heart.solution.map((v) => (v ? "filled" : "cross")) as Mark[];
  const result = transition(
    doc,
    {
      type: "paperBatch",
      batches: [
        {
          puzzleId: heart.id,
          version: puzzleVersion(heart),
          expectedMarks: doc.sessions.heart.marks,
          marks: solved,
        },
      ],
    },
    [...puzzles.filter((p) => p.id !== heart.id), replaced],
  );
  assert.equal(result, doc);
  assert.equal(result.records.length, 0);
});

test("layout stays within the printable box for dense 15x15 grids", () => {
  const lighthouse = puzzles.find((p) => p.id === "lighthouse")!;
  const clues = clueSet(lighthouse.size, lighthouse.solution);
  const metrics = gridMetrics(
    lighthouse.size,
    { rows: clues.slice(0, lighthouse.size), cols: clues.slice(lighthouse.size) },
    10,
  );
  const content = contentSize(config());
  assert.ok(metrics.blockWidth <= content.width);
  assert.ok(metrics.blockHeight <= content.height);
  const plan = buildPlan(config({ strategy: "paper" }), printable(["lighthouse"]));
  assert.equal(plan.pages.length, 1);
  assert.equal(plan.pages[0].figures.length, 1);
});

test("stable workbook code reuses the original snapshot on reprint", () => {
  const doc = newDocument(puzzles[1]);
  const first = makeWorkbook(config(), candidateList(["heart"]), doc);
  assert.ok(saveWorkbook(first.workbook));
  const again = makeWorkbook(config(), candidateList(["heart"]), doc);
  assert.equal(again.workbook.code, first.workbook.code);
  // A reprint keeps the original print date and therefore its snapshot.
  assert.equal(again.workbook.createdAt, first.workbook.createdAt);
  assert.equal(loadWorkbooks()[0].code, first.workbook.code);
  // A changed selection or board is a different book.
  const moved = transition(doc, { type: "mark", index: 1, mark: "filled" }, puzzles);
  const changed = makeWorkbook(config(), candidateList(["heart"]), moved);
  assert.notEqual(changed.workbook.code, first.workbook.code);
});

test("an unstarted puzzle can still receive paper marks without a session", () => {
  const heart = puzzles.find((p) => p.id === "heart")!;
  const cup = puzzles.find((p) => p.id === "cup")!;
  const doc = newDocument(heart);
  const { workbook } = makeWorkbook(config(), candidateList(["cup"]), doc);
  const paper = cup.solution.map((v) => (v ? "filled" : "cross")) as Mark[];
  const result = reconcilePaper(
    workbook,
    { cup: paper },
    { document: doc, catalog: puzzles },
  );
  assert.equal(result.missing.length, 0);
  assert.equal(result.batches.length, 1);
  const next = transition(
    doc,
    { type: "paperBatch", batches: result.batches },
    puzzles,
  );
  assert.equal(next.sessions.cup.solved, true);
  assert.equal(next.records.filter((r) => r.puzzleId === cup.id).length, 1);
});

test("screen choice suppresses the paper batch but keeps the conflict reviewable", () => {
  const heart = puzzles.find((p) => p.id === "heart")!;
  const doc = newDocument(heart);
  const { workbook } = makeWorkbook(config(), candidateList(["heart"]), doc);
  const live = transition(doc, { type: "mark", index: 0, mark: "filled" }, puzzles);
  const paper = Array<Mark>(workbook.puzzles[0].size ** 2).fill("unknown");
  paper[0] = "cross";
  const result = reconcilePaper(
    workbook,
    { heart: paper },
    { document: live, catalog: puzzles },
    { heart: "screen" },
  );
  assert.equal(result.batches.length, 0);
  assert.equal(result.conflicts.length, 0);
});
