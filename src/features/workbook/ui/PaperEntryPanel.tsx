import { useMemo, useState } from "react";
import { BookMarked, Check, TriangleAlert } from "lucide-react";
import type { GameDocument, Mark, Puzzle } from "../../../shared/types";
import type { PrintedWorkbook } from "../model/types";
import {
  reconcilePaper,
  type PaperEntryDraft,
  type ReconcileResult,
} from "../model/workbook";
import { puzzleVersion } from "../../../shared/version";
import { loadDraft, saveDraft } from "../lib/storage";

const NEXT: Record<Mark, Mark> = {
  unknown: "filled",
  filled: "cross",
  cross: "unknown",
};

const MARK_NAME: Record<Mark, string> = {
  unknown: "空",
  filled: "已填",
  cross: "标空",
};

function nameOf(mark: string): string {
  return MARK_NAME[mark as Mark] ?? "未知";
}

export function PaperEntryPanel({
  workbook,
  document,
  catalog,
  onCommit,
  onClose,
}: {
  workbook: PrintedWorkbook;
  document: GameDocument;
  catalog: Puzzle[];
  onCommit: (result: ReconcileResult, resolve: Record<string, "paper" | "screen">) => void;
  onClose: () => void;
}) {
  const saved = useMemo(() => loadDraft(workbook.code), [workbook.code]);
  const [draft, setDraft] = useState<PaperEntryDraft>(() => {
    const initial: PaperEntryDraft = {};
    for (const puzzle of workbook.puzzles)
      initial[puzzle.puzzleId] = saved?.marks[puzzle.puzzleId]
        ? [...saved.marks[puzzle.puzzleId]]
        : [...puzzle.snapshot];
    return initial;
  });
  const [resolve, setResolve] = useState<Record<string, "paper" | "screen">>(
    saved?.resolve ?? {},
  );
  const [active, setActive] = useState(workbook.puzzles[0]?.puzzleId ?? "");
  const [message, setMessage] = useState("");

  const result = useMemo(
    () => reconcilePaper(workbook, draft, { document, catalog }, resolve),
    [workbook, draft, document, catalog, resolve],
  );

  const current = workbook.puzzles.find((p) => p.puzzleId === active);
  const marks = draft[active] ?? [];
  const activePuzzle = current
    ? catalog.find((entry) => entry.id === current.puzzleId)
    : undefined;
  const missingVersion =
    !!current &&
    (!activePuzzle || puzzleVersion(activePuzzle) !== current.version);

  const persist = (nextDraft: PaperEntryDraft, nextResolve: typeof resolve) => {
    saveDraft({
      code: workbook.code,
      marks: nextDraft,
      resolve: nextResolve,
      label: workbook.labels,
      savedAt: Date.now(),
    });
  };

  const update = (nextDraft: PaperEntryDraft, nextResolve = resolve) => {
    setDraft(nextDraft);
    persist(nextDraft, nextResolve);
    setMessage("草稿已保存在本机，可随时回来继续转写。");
  };

  const toggleCell = (index: number) => {
    if (!current) return;
    const next = marks.map((mark, i) => (i === index ? NEXT[mark] : mark));
    update({ ...draft, [active]: next });
  };

  const fillAll = (mark: Mark) => {
    if (!current) return;
    update({
      ...draft,
      [active]: Array(current.size ** 2).fill(mark) as Mark[],
    });
  };

  const submit = () => {
    const checked = reconcilePaper(workbook, draft, { document, catalog }, resolve);
    const pending = checked.conflicts.filter((c) => !c.chosen);
    if (pending.length) {
      setMessage(
        `有 ${pending.length} 道题在你打印后又被解过，请先选择以纸面或屏幕为准。`,
      );
      return;
    }
    if (!checked.batches.length) {
      setMessage(
        checked.missing.length
          ? "原题版本已不在题库中：纸面草稿已保留，但不会套用到同名新版。"
          : checked.solved.length
            ? "这些题在屏幕上已完成，纸面标记不会覆盖完成状态。"
            : "纸面与当前进度一致，没有需要提交的改动。",
      );
      return;
    }
    onCommit(checked, resolve);
  };

  return (
    <section className="paper-entry panel">
      <div className="paper-entry-head">
        <div>
          <span className="eyebrow">PAPER RETURN · 纸面录入</span>
          <h2>
            <BookMarked size={18} /> 题册 {workbook.code}
          </h2>
          <p className="muted">
            {workbook.puzzlePages} 页题面
            {workbook.answerPages
              ? ` · ${workbook.answerPages} 页答案`
              : " · 无答案"}
            {" · "}
            对照纸面逐格转写。提交时会先与打印时的快照核对；原题若已被继续解过，会先请你处理冲突。
          </p>
        </div>
        <button className="paper-close" onClick={onClose}>
          返回
        </button>
      </div>
      <div className="paper-entry-body">
        <div className="paper-tabs">
          {workbook.puzzles.map((puzzle) => {
            const dirty = (draft[puzzle.puzzleId] ?? []).some(
              (mark, i) => mark !== puzzle.snapshot[i],
            );
            const conflicted = result.conflicts.some(
              (c) => c.puzzleId === puzzle.puzzleId,
            );
            return (
              <button
                key={puzzle.puzzleId}
                className={[
                  active === puzzle.puzzleId ? "active" : "",
                  dirty ? "dirty" : "",
                  conflicted ? "conflict" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setActive(puzzle.puzzleId)}
              >
                {puzzle.label}
                {conflicted && <span className="dirty-dot warn" />}
              </button>
            );
          })}
        </div>
        {current ? (
          <>
            <div className="paper-tools">
              <span>
                {current.size}×{current.size} · 单击循环「填涂 → 标空 → 空」
                {!workbook.config.includeMarks &&
                  " · 本题册未印出标记，这里先显示打印时的屏幕状态，只有你改动的格子会提交"}
              </span>
              <div>
                <button onClick={() => fillAll("unknown")}>全部清空</button>
                <button onClick={() => fillAll("filled")}>全部填涂</button>
              </div>
            </div>
            {missingVersion && (
              <p className="paper-warning">
                <TriangleAlert size={14} />
                题库中已找不到这道题的打印版本（编号 {current.puzzleId} /{" "}
                {current.version}）。这里仍可转写草稿，但不会提交到同名新版。
              </p>
            )}
            <div className="paper-board-wrap">
              <div
                className="paper-board"
                style={{
                  gridTemplateColumns: `repeat(${current.size}, 22px)`,
                  gridTemplateRows: `repeat(${current.size}, 22px)`,
                }}
              >
                {marks.map((mark, index) => (
                  <button
                    key={index}
                    aria-label={`第 ${Math.floor(index / current.size) + 1} 行第 ${(index % current.size) + 1} 列 ${MARK_NAME[mark]}`}
                    className={`paper-cell ${mark} ${(index % current.size) + 1 === current.size ? "row-end" : ""}`}
                    onClick={() => toggleCell(index)}
                  >
                    {mark === "cross" ? "×" : ""}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <p className="muted">题册中没有可录入的题目。</p>
        )}
        <div className="paper-summary" role="status">
          {message || "未提交的转写会作为草稿留在本机。"}
        </div>
        {result.conflicts.length > 0 && (
          <div className="paper-conflicts">
            <h3>
              <TriangleAlert size={16} /> 打印后已有新进度
            </h3>
            <p>
              下列题目在打印之后又被解过。请逐题选择以纸面为准，或保留屏幕上的新进度；未做选择的题目不会提交。
            </p>
            {result.conflicts.map((conflict) => {
              const size =
                workbook.puzzles.find((p) => p.puzzleId === conflict.puzzleId)
                  ?.size ?? 1;
              return (
                <div className="paper-conflict" key={conflict.puzzleId}>
                  <div className="paper-conflict-text">
                    <strong>{conflict.label}</strong>
                    <span>
                      纸面有 {conflict.changedCells} 处与打印时不同，其中{" "}
                      {conflict.collisions} 处与打印后的屏幕进度矛盾
                      {conflict.first
                        ? `。例如第 ${Math.floor(conflict.first.index / size) + 1} 行第 ${(conflict.first.index % size) + 1} 列：纸面 ${nameOf(conflict.first.paper)}，打印时 ${nameOf(conflict.first.snapshot)}，屏幕现为 ${nameOf(conflict.first.current)}`
                        : ""}
                      。
                    </span>
                  </div>
                  <div className="paper-conflict-actions">
                    <button
                      className={
                        resolve[conflict.puzzleId] === "paper" ? "active" : ""
                      }
                      onClick={() => {
                        const next = {
                          ...resolve,
                          [conflict.puzzleId]: "paper" as const,
                        };
                        setResolve(next);
                        persist(draft, next);
                      }}
                    >
                      以纸面为准
                    </button>
                    <button
                      className={
                        resolve[conflict.puzzleId] === "screen" ? "active" : ""
                      }
                      onClick={() => {
                        const next = {
                          ...resolve,
                          [conflict.puzzleId]: "screen" as const,
                        };
                        setResolve(next);
                        persist(draft, next);
                        setMessage(
                          `已保留「${conflict.label}」的屏幕进度；纸面草稿仍留在本题册中。`,
                        );
                      }}
                    >
                      保留屏幕进度
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="paper-entry-actions">
        <span className="muted">
          {result.batches.length} 题待提交
          {result.conflicts.filter((c) => !c.chosen).length
            ? ` · ${result.conflicts.filter((c) => !c.chosen).length} 题待确认`
            : ""}
          {result.conflicts.some((c) => c.chosen === "screen")
            ? ` · ${result.conflicts.filter((c) => c.chosen === "screen").length} 题保留屏幕进度`
            : ""}
          {result.missing.length ? ` · ${result.missing.length} 题原版缺失` : ""}
          {result.solved.length ? ` · ${result.solved.length} 题已在屏幕完成` : ""}
        </span>
        <button className="ghost" onClick={onClose}>
          稍后再录
        </button>
        <button className="primary" onClick={submit}>
          <Check size={16} /> 核对并提交
        </button>
      </div>
    </section>
  );
}
