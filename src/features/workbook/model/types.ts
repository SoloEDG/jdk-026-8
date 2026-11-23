import type { Mark } from "../../../shared/types";

export type PaperKind = "a4" | "letter";
export type Orientation = "portrait" | "landscape";
export type CellStrategy = "writing" | "paper" | "custom";

export interface WorkbookConfig {
  paper: PaperKind;
  orientation: Orientation;
  columns: number;
  strategy: CellStrategy;
  /** Smallest cell (mm) considered comfortable enough to write in. */
  minCell: number;
  /** Used when strategy is "custom". */
  customCell: number;
  includeAnswers: boolean;
  includeMarks: boolean;
}

export interface WorkbookPuzzle {
  puzzleId: string;
  /** Content fingerprint of the printed version. */
  version: string;
  /** Stable 1-based catalog ordinal, used for anonymized labels. */
  ordinal: number;
  /** What may be printed: title only when already solved. */
  label: string;
  title: string | null;
  size: number;
  /** Full answer, kept for the opt-in answer pages only. */
  solution: number[];
  /** Clue numbers, identical to the on-screen puzzle. */
  clues: { rows: number[][]; cols: number[][] };
  /** Board state at print time, used to reconcile later screen progress. */
  snapshot: Mark[];
}

export interface PrintedWorkbook {
  code: string;
  createdAt: number;
  /** Last time this exact book was printed; keeps the code stable. */
  printedAt: number;
  config: WorkbookConfig;
  cell: number;
  columns: number;
  totalPages: number;
  puzzlePages: number;
  answerPages: number;
  answerStartPage: number | null;
  utilization: number;
  puzzles: WorkbookPuzzle[];
  /** Labels captured so a lost entry session can still name its drafts. */
  labels: Record<string, string>;
}

export interface WorkbookSourcePuzzle {
  puzzle: import("../../../shared/types").Puzzle;
  ordinal: number;
  solved: boolean;
  marks: Mark[];
}

export const DEFAULT_CONFIG: WorkbookConfig = {
  paper: "a4",
  orientation: "portrait",
  columns: 1,
  strategy: "writing",
  minCell: 6,
  customCell: 7,
  includeAnswers: false,
  includeMarks: false,
};

export function normalizeConfig(config: WorkbookConfig): WorkbookConfig {
  const paper: PaperKind = config.paper === "letter" ? "letter" : "a4";
  const orientation: Orientation =
    config.orientation === "landscape" ? "landscape" : "portrait";
  const columns = Math.min(3, Math.max(1, Math.round(config.columns) || 1));
  const strategy: CellStrategy =
    config.strategy === "paper" || config.strategy === "custom"
      ? config.strategy
      : "writing";
  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  return {
    paper,
    orientation,
    columns,
    strategy,
    minCell: clamp(config.minCell, 4, 12),
    customCell: clamp(config.customCell, 3, 20),
    includeAnswers: !!config.includeAnswers,
    includeMarks: !!config.includeMarks,
  };
}

export function isWorkbookConfig(value: unknown): value is WorkbookConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (v.paper === "a4" || v.paper === "letter") &&
    (v.orientation === "portrait" || v.orientation === "landscape") &&
    typeof v.columns === "number" &&
    Number.isFinite(v.columns) &&
    typeof v.minCell === "number" &&
    typeof v.customCell === "number" &&
    typeof v.strategy === "string" &&
    typeof v.includeAnswers === "boolean" &&
    typeof v.includeMarks === "boolean"
  );
}
