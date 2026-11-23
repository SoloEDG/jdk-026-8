import type { Mark } from "./types";

const VALID: Mark[] = ["unknown", "filled", "cross"];

export function isValidMark(mark: unknown): mark is Mark {
  return typeof mark === "string" && (VALID as string[]).includes(mark);
}

export function isValidMarks(marks: unknown, length: number): marks is Mark[] {
  return (
    Array.isArray(marks) &&
    marks.length === length &&
    marks.every(isValidMark)
  );
}

export function sameMarks(a: readonly Mark[], b: readonly Mark[]): boolean {
  return a.length === b.length && a.every((mark, i) => mark === b[i]);
}
