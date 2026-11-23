import { isValidMark, isValidMarks } from "../../../shared/marks";
import type { Mark } from "../../../shared/types";
import { isWorkbookConfig, type PrintedWorkbook } from "../model/types";

const BOOKS_KEY = "gejian.workbooks.v1";
const DRAFT_KEY = "gejian.paperDraft.v1";

export interface PaperDraft {
  code: string;
  /** puzzleId -> transcribed marks. Preserved even when no original exists. */
  marks: Record<string, Mark[]>;
  /** puzzleId -> "paper" once the user accepted paper over later screen work. */
  resolve: Record<string, "paper" | "screen">;
  label: Record<string, string>;
  savedAt: number;
}

function isWorkbook(value: unknown): value is PrintedWorkbook {
  if (!value || typeof value !== "object") return false;
  const book = value as Record<string, unknown>;
  return (
    typeof book.code === "string" &&
    typeof book.createdAt === "number" &&
    isWorkbookConfig(book.config) &&
    typeof book.cell === "number" &&
    typeof book.columns === "number" &&
    Array.isArray(book.puzzles) &&
    (book.puzzles as unknown[]).every((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const puzzle = entry as Record<string, unknown>;
      return (
        typeof puzzle.puzzleId === "string" &&
        typeof puzzle.version === "string" &&
        typeof puzzle.size === "number" &&
        Array.isArray(puzzle.solution) &&
        isValidMarks(puzzle.snapshot, puzzle.size ** 2)
      );
    })
  );
}

export function loadWorkbooks(): PrintedWorkbook[] {
  try {
    const raw = localStorage.getItem(BOOKS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter(isWorkbook);
  } catch {
    return [];
  }
}

export function saveWorkbook(workbook: PrintedWorkbook): boolean {
  try {
    const list = loadWorkbooks().filter((book) => book.code !== workbook.code);
    localStorage.setItem(
      BOOKS_KEY,
      JSON.stringify([workbook, ...list].slice(0, 24)),
    );
    return true;
  } catch {
    return false;
  }
}

export function findWorkbook(code: string): PrintedWorkbook | null {
  const normalized = code.trim().toUpperCase();
  return (
    loadWorkbooks().find((book) => book.code.toUpperCase() === normalized) ??
    null
  );
}

export function loadDraft(code: string): PaperDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as PaperDraft;
    if (draft.code !== code) return null;
    if (!draft.marks || typeof draft.marks !== "object") return null;
    for (const [id, marks] of Object.entries(draft.marks)) {
      if (!Array.isArray(marks) || !marks.every((mark) => isValidMark(mark)))
        delete draft.marks[id];
    }
    return draft;
  } catch {
    return null;
  }
}

export function saveDraft(draft: PaperDraft): boolean {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(code: string): void {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw) as PaperDraft;
    if (draft.code === code) localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore malformed draft */
  }
}

/**
 * Drop the submitted puzzles from the draft but keep any that could not be
 * committed (e.g. their original version is gone). Returns what remains.
 */
export function retainDraft(code: string, keep: string[]): PaperDraft | null {
  const draft = loadDraft(code);
  if (!draft) return null;
  const keepSet = new Set(keep);
  const next: PaperDraft = {
    ...draft,
    marks: Object.fromEntries(
      Object.entries(draft.marks).filter(([id]) => keepSet.has(id)),
    ),
    resolve: Object.fromEntries(
      Object.entries(draft.resolve).filter(([id]) => keepSet.has(id)),
    ),
  };
  if (!Object.keys(next.marks).length) {
    clearDraft(code);
    return null;
  }
  saveDraft(next);
  return next;
}
