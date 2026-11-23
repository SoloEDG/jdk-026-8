import type { Puzzle } from "./types";

/**
 * Content fingerprint of a puzzle version. Marks a printed workbook so paper
 * entry can only ever be merged back into the exact puzzle it was printed
 * from. A same-titled replacement with different content will not match.
 */
export function puzzleVersion(
  puzzle: Pick<Puzzle, "id" | "size" | "solution">,
): string {
  const text = `${puzzle.id}|${puzzle.size}|${puzzle.solution.join("")}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return "v1-" + (hash >>> 0).toString(36);
}

export function samePuzzleVersion(
  puzzle: Pick<Puzzle, "id" | "size" | "solution">,
  expected: string,
): boolean {
  return puzzleVersion(puzzle) === expected;
}
