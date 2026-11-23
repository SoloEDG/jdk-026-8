import type { GameDocument, Puzzle, Session } from "../../../shared/types";
export function registerSolve(
  document: GameDocument,
  puzzle: Puzzle,
  session: Session,
): GameDocument {
  if (!session.solved || document.sessions[puzzle.id]?.solved) return document;
  return {
    ...document,
    records: [
      {
        id: crypto.randomUUID(),
        puzzleId: puzzle.id,
        seconds: session.seconds,
        hints: session.hints,
        checks: session.checks,
        finishedAt: Date.now(),
      },
      ...document.records,
    ],
  };
}

/** Read-only predicate so callers can report what a batch would solve. */
export function wouldRegisterSolve(
  document: GameDocument,
  puzzle: Puzzle,
  session: Session,
): boolean {
  return session.solved && !document.sessions[puzzle.id]?.solved;
}
