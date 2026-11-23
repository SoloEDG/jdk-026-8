import type {
  GameAction,
  GameDocument,
  Mark,
  Puzzle,
  Session,
} from "../shared/types";
import { isSolved, newSession } from "../shared/document";
import { isValidMarks, sameMarks } from "../shared/marks";
import { puzzleVersion } from "../shared/version";
import { applyMark, undoMark } from "../features/board";
import { HINT_LIMIT } from "../features/assist";
import { registerSolve } from "../features/journal";

function diffMoves(
  before: readonly Mark[],
  after: readonly Mark[],
): Session["moves"] {
  const moves: Session["moves"] = [];
  for (let i = 0; i < after.length; i++) {
    if (before[i] !== after[i])
      moves.push({ index: i, before: before[i], after: after[i] });
  }
  return moves.slice(-500);
}

/**
 * Paper transcription is all-or-nothing for one puzzle: the target version
 * must still be the printed one, and the live board must be exactly what the
 * user reconciled against. Otherwise nothing is written, so a renamed or
 * replaced puzzle can never inherit the paper marks or a false completion.
 */
function paperSession(
  current: Session,
  action: {
    version: string;
    expectedMarks: Mark[];
    marks: Mark[];
  },
  puzzle: Puzzle,
): Session | null {
  if (current.solved) return null;
  if (puzzleVersion(puzzle) !== action.version) return null;
  const cellCount = puzzle.size ** 2;
  if (!isValidMarks(action.marks, cellCount)) return null;
  if (!isValidMarks(action.expectedMarks, cellCount)) return null;
  if (!sameMarks(current.marks, action.expectedMarks)) return null;
  if (sameMarks(current.marks, action.marks)) return null;

  const moves = diffMoves(current.marks, action.marks);
  const next: Session = {
    ...current,
    marks: [...action.marks],
    moves: [...current.moves, ...moves].slice(-500),
    updatedAt: Date.now(),
  };
  return { ...next, solved: isSolved(puzzle, next) };
}

function applyPaperBatch(
  document: GameDocument,
  batches: Extract<GameAction, { type: "paperBatch" }>["batches"],
  puzzles: Puzzle[],
): GameDocument {
  const staged: { puzzle: Puzzle; session: Session }[] = [];
  const seen = new Set<string>();
  for (const batch of batches) {
    if (seen.has(batch.puzzleId)) return document;
    seen.add(batch.puzzleId);
    const puzzle = puzzles.find((p) => p.id === batch.puzzleId);
    if (!puzzle) return document;
    // Never-opened puzzles legitimately have no session; start from blank.
    const current = document.sessions[batch.puzzleId] ?? newSession(puzzle);
    const next = paperSession(current, batch, puzzle);
    if (!next) return document;
    staged.push({ puzzle, session: next });
  }
  if (!staged.length) return document;
  let result = document;
  for (const { puzzle, session } of staged) {
    // Record against the pre-batch document so an already-solved puzzle still
    // cannot earn a second record.
    result = registerSolve(result, puzzle, session);
    result = {
      ...result,
      sessions: { ...result.sessions, [puzzle.id]: session },
    };
  }
  return result;
}

export function transition(
  document: GameDocument,
  action: GameAction,
  puzzles: Puzzle[],
): GameDocument {
  if (action.type === "paper")
    return applyPaperBatch(document, [action], puzzles);
  if (action.type === "paperBatch")
    return applyPaperBatch(document, action.batches, puzzles);
  const puzzle = puzzles.find((p) => p.id === document.activeId)!;
  const current = document.sessions[puzzle.id];
  if (action.type === "open") {
    const target = puzzles.find((p) => p.id === action.id);
    return target
      ? {
          ...document,
          activeId: target.id,
          sessions: {
            ...document.sessions,
            [target.id]: document.sessions[target.id] ?? newSession(target),
          },
        }
      : document;
  }
  let next = current;
  if (action.type === "mark")
    next = applyMark(current, action.index, action.mark);
  if (action.type === "undo") next = undoMark(current);
  if (action.type === "hint" && current.hints < HINT_LIMIT && !current.solved) {
    const marked = applyMark(current, action.index, action.mark);
    if (marked !== current) next = { ...marked, hints: current.hints + 1 };
  }
  if (action.type === "check" && !current.solved)
    next = { ...current, checks: current.checks + 1 };
  if (action.type === "tick" && !current.solved)
    next = { ...current, seconds: current.seconds + 1 };
  if (action.type === "reset") next = newSession(puzzle);
  if (next === current) return document;
  next = { ...next, solved: isSolved(puzzle, next) };
  const withRecord = registerSolve(document, puzzle, next);
  return {
    ...withRecord,
    sessions: { ...withRecord.sessions, [puzzle.id]: next },
  };
}
