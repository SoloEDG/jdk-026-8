import type { GameDocument, Mark, Puzzle } from "../../../shared/types";
import { clueSet } from "../../../shared/clues";
import { sameMarks } from "../../../shared/marks";
import { puzzleVersion } from "../../../shared/version";
import { buildPlan, type WorkbookPlan } from "./layout";
import { loadWorkbooks } from "../lib/storage";
import {
  normalizeConfig,
  type WorkbookConfig,
  type WorkbookPuzzle,
  type PrintedWorkbook,
} from "./types";

export interface WorkbookCandidate {
  puzzle: Puzzle;
  ordinal: number;
}

/** Build the printable payload from selected catalog puzzles. */
export function workbookPuzzles(
  candidates: WorkbookCandidate[],
  document: GameDocument,
): WorkbookPuzzle[] {
  return candidates.map(({ puzzle, ordinal }) => {
    const session = document.sessions[puzzle.id];
    const solved = !!session?.solved;
    const all = clueSet(puzzle.size, puzzle.solution);
    return {
      puzzleId: puzzle.id,
      version: puzzleVersion(puzzle),
      ordinal,
      // Unsolved titles stay hidden so the header/cover cannot spoil them.
      label: solved ? puzzle.title : `图案 ${pad(ordinal)}`,
      title: solved ? puzzle.title : null,
      size: puzzle.size,
      solution: puzzle.solution,
      clues: {
        rows: all.slice(0, puzzle.size),
        cols: all.slice(puzzle.size),
      },
      snapshot: session
        ? [...session.marks]
        : Array(puzzle.size ** 2).fill("unknown"),
    };
  });
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

/** Deterministic, human-typeable workbook id derived from its contents. */
export function workbookCode(
  puzzles: WorkbookPuzzle[],
  config: WorkbookConfig,
): string {
  const text = [
    config.paper,
    config.orientation,
    config.columns,
    config.strategy,
    config.minCell,
    config.customCell,
    config.includeAnswers ? "a" : "-",
    config.includeMarks ? "m" : "-",
    // No timestamp: the same selection, layout and board snapshot always gets
    // the same code, so a reprint cannot silently become a different book.
    ...puzzles.map(
      (puzzle) => `${puzzle.puzzleId}:${puzzle.version}:${puzzle.snapshot.join("")}`,
    ),
  ].join("|");

  let hash = 1469598103934665603n;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * 1099511628211n) & 0xffffffffffffffffn;
  }
  const base = Number(hash & 0xffffffffn);
  return "GJ-" + base.toString(32).toUpperCase().padStart(7, "0").slice(-7);
}

export function makeWorkbook(
  configInput: WorkbookConfig,
  candidates: WorkbookCandidate[],
  document: GameDocument,
): { workbook: PrintedWorkbook; plan: WorkbookPlan } {
  const config = normalizeConfig(configInput);
  const puzzles = workbookPuzzles(candidates, document);
  const plan = buildPlan(config, puzzles);
  const createdAt = Date.now();
  const code = workbookCode(puzzles, config);
  const workbook: PrintedWorkbook = {
    code,
    // Re-using a code keeps the original print date and its saved snapshot.
    createdAt:
      loadWorkbooks().find((book) => book.code === code)?.createdAt ??
      createdAt,
    printedAt: createdAt,
    config,
    cell: plan.cell,
    columns: plan.columns,
    totalPages: plan.pages.length,
    puzzlePages: plan.puzzlePages,
    answerPages: plan.answerPages,
    answerStartPage: plan.answerStartPage,
    utilization: plan.utilization,
    puzzles,
    labels: Object.fromEntries(puzzles.map((p) => [p.puzzleId, p.label])),
  };
  return { workbook, plan };
}

/** Rebuild the exact printable layout for a saved snapshot. */
export function planForWorkbook(workbook: PrintedWorkbook): WorkbookPlan {
  return buildPlan(workbook.config, workbook.puzzles);
}

/* ------------------------------ reconciliation ---------------------------- */

export interface Conflict {
  puzzleId: string;
  label: string;
  changedCells: number;
  /** Cells where paper and the newer screen board contradict each other. */
  collisions: number;
  /** The cell index of the first real collision, for a readable hint. */
  first: { index: number; paper: string; snapshot: string; current: string } | null;
  /** The reviewer's decision, or null while undecided. */
  chosen: "paper" | "screen" | null;
}

export interface PaperBatch {
  puzzleId: string;
  label: string;
  version: string;
  expectedMarks: import("../../../shared/types").Mark[];
  marks: import("../../../shared/types").Mark[];
}

export interface ReconcileResult {
  batches: PaperBatch[];
  conflicts: Conflict[];
  /** Labels whose original version is no longer in the catalog. */
  missing: string[];
  /** Puzzles already solved on screen; paper is not merged over them. */
  solved: string[];
  /** Total cells that differ between paper and print-time snapshot. */
  changedCells: number;
}

export type PaperEntryDraft = Record<string, Mark[]>;

export interface ReconcileContext {
  document: GameDocument;
  catalog: Puzzle[];
}

/**
 * Compare transcribed paper marks with the print-time snapshot and the
 * current live session.
 *
 * - Missing original puzzle (or a different version under the same id) is
 *   reported as `missing`, never merged into a namesake.
 * - Paper equals snapshot -> nothing to write, skip.
 * - Paper equals current live board -> already up to date, skip.
 * - Live board changed since printing and paper disagrees with both -> conflict.
 */
export function reconcilePaper(
  workbook: PrintedWorkbook,
  draft: PaperEntryDraft,
  context: ReconcileContext,
  resolve: Record<string, "paper" | "screen"> = {},
): ReconcileResult {
  const batches: PaperBatch[] = [];
  const conflicts: Conflict[] = [];
  const missing: string[] = [];
  const solved: string[] = [];
  let changedCells = 0;

  for (const puzzle of workbook.puzzles) {
    const paper = draft[puzzle.puzzleId];
    if (!paper) continue;
    const catalogEntry = context.catalog.find(
      (entry) => entry.id === puzzle.puzzleId,
    );
    if (!catalogEntry || puzzleVersion(catalogEntry) !== puzzle.version) {
      // The exact printed version is gone: keep the draft, never apply it to
      // a same-id replacement or a same-titled new puzzle.
      missing.push(puzzle.label);
      continue;
    }
    if (paper.length !== puzzle.size ** 2) {
      missing.push(puzzle.label);
      continue;
    }
    const stored = context.document.sessions[puzzle.puzzleId];
    if (stored?.solved) {
      solved.push(puzzle.label);
      continue;
    }
    // An unstarted puzzle has no session yet: treat it as a blank board.
    const currentMarks =
      stored?.marks ?? (Array(puzzle.size ** 2).fill("unknown") as Mark[]);

    const changed = paper.filter(
      (mark, i) => mark !== puzzle.snapshot[i],
    ).length;
    changedCells += changed;
    if (changed === 0) continue;
    if (sameMarks(paper, currentMarks)) continue;

    const decision = resolve[puzzle.puzzleId] ?? null;
    if (decision === "screen") {
      // Explicitly keep the newer screen progress; paper is not merged.
      continue;
    }
    // A conflict is only possible if the screen board moved after printing.
    if (sameMarks(currentMarks, puzzle.snapshot)) {
      batches.push({
        puzzleId: puzzle.puzzleId,
        label: puzzle.label,
        version: puzzle.version,
        expectedMarks: [...currentMarks],
        marks: [...paper],
      });
      continue;
    }

    // A conflict exists only where the paper and the newer screen board
    // disagree about the same cell. Cells the paper left at its snapshot
    // value can always inherit the newer screen mark.
    const collisions: number[] = [];
    for (let i = 0; i < paper.length; i++) {
      if (paper[i] !== puzzle.snapshot[i] && paper[i] !== currentMarks[i])
        collisions.push(i);
    }
    if (collisions.length && decision !== "paper") {
      const firstIndex = collisions[0];
      conflicts.push({
        puzzleId: puzzle.puzzleId,
        label: puzzle.label,
        changedCells: changed,
        collisions: collisions.length,
        first: {
          index: firstIndex,
          paper: paper[firstIndex],
          snapshot: puzzle.snapshot[firstIndex],
          current: currentMarks[firstIndex],
        },
        chosen: null,
      });
      continue;
    }
    if (collisions.length) {
      // Reviewer accepted paper over the newer screen work; keep the
      // conflict visible for the session, but allow the merge.
      const firstIndex = collisions[0];
      conflicts.push({
        puzzleId: puzzle.puzzleId,
        label: puzzle.label,
        changedCells: changed,
        collisions: collisions.length,
        first: {
          index: firstIndex,
          paper: paper[firstIndex],
          snapshot: puzzle.snapshot[firstIndex],
          current: currentMarks[firstIndex],
        },
        chosen: "paper",
      });
    }

    // Merge paper marks over the print-time snapshot, but keep any live
    // cells the solver changed after printing when they do not collide.
    const marks = paper.map((mark, i) => {
      if (mark !== puzzle.snapshot[i]) return mark;
      return currentMarks[i];
    });
    batches.push({
      puzzleId: puzzle.puzzleId,
      label: puzzle.label,
      version: puzzle.version,
      expectedMarks: [...currentMarks],
      marks,
    });
  }

  return { batches, conflicts, missing, solved, changedCells };
}
