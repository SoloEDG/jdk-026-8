export type Mark = "unknown" | "filled" | "cross";
export type Tool = "filled" | "cross" | "unknown";
export interface Puzzle {
  id: string;
  title: string;
  collection: string;
  level: "入门" | "进阶" | "挑战";
  size: number;
  solution: number[];
  color: string;
}
export interface Move {
  index: number;
  before: Mark;
  after: Mark;
}
export interface Session {
  puzzleId: string;
  marks: Mark[];
  moves: Move[];
  hints: number;
  checks: number;
  seconds: number;
  solved: boolean;
  updatedAt: number;
}
export interface SolveRecord {
  id: string;
  puzzleId: string;
  seconds: number;
  hints: number;
  checks: number;
  finishedAt: number;
}
export interface GameDocument {
  version: 1;
  activeId: string;
  sessions: Record<string, Session>;
  records: SolveRecord[];
}
export type GameAction =
  | { type: "open"; id: string }
  | { type: "mark"; index: number; mark: Mark }
  | { type: "undo" }
  | { type: "hint"; index: number; mark: Mark }
  | { type: "check" }
  | { type: "tick" }
  | { type: "reset" }
  | {
      /**
       * Atomic paper-to-screen transcription. `version` pins the workbook to
       * the exact printed puzzle, `expectedMarks` is the live board the user
       * reconciled against. The reducer refuses the batch if either changed,
       * so a same-titled replacement can never receive the marks.
       */
      type: "paper";
      puzzleId: string;
      version: string;
      expectedMarks: Mark[];
      marks: Mark[];
    }
  | {
      /**
       * All-or-nothing transcription for a whole workbook. Every batch is
       * validated before any is applied.
       */
      type: "paperBatch";
      batches: {
        puzzleId: string;
        version: string;
        expectedMarks: Mark[];
        marks: Mark[];
      }[];
    };
