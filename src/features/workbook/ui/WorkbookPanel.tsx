import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookMarked,
  Check,
  ChevronRight,
  FileDown,
  Printer,
  Search,
  TriangleAlert,
} from "lucide-react";
import type { GameDocument, Puzzle } from "../../../shared/types";
import { completion } from "../../../shared/document";
import { makeWorkbook, type ReconcileResult } from "../model/workbook";
import {
  DEFAULT_CONFIG,
  normalizeConfig,
  type PrintedWorkbook,
  type WorkbookConfig,
} from "../model/types";
import type { WorkbookPlan } from "../model/layout";
import { fmt } from "../model/layout";
import { findWorkbook, retainDraft, saveWorkbook } from "../lib/storage";
import { CoverPage, PageSheet } from "./PrintSheet";
import { PaperEntryPanel } from "./PaperEntryPanel";

const MM_TO_PX = 96 / 25.4;

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

export function labelFor(puzzle: Puzzle, ordinal: number, solved: boolean) {
  return solved ? puzzle.title : `图案 ${pad(ordinal)}`;
}

function configKey(config: WorkbookConfig): string {
  return JSON.stringify(normalizeConfig(config));
}

/** Stable content signature: timer ticks must not rebuild the workbook. */
function documentKey(document: GameDocument, ids: string[]): string {
  return ids
    .map((id) => {
      const session = document.sessions[id];
      return `${id}:${session ? session.marks.join("") : "-"}:${session?.solved ? 1 : 0}`;
    })
    .join("|");
}

export function WorkbookPanel({
  document,
  puzzles,
  onCommit,
  onOpenPuzzle,
}: {
  document: GameDocument;
  puzzles: Puzzle[];
  onCommit: (
    result: ReconcileResult,
    resolve: Record<string, "paper" | "screen">,
  ) => { accepted: boolean; solved: string[] };
  onOpenPuzzle: (id: string) => void;
}) {
  const [config, setConfig] = useState<WorkbookConfig>(DEFAULT_CONFIG);
  const [selection, setSelection] = useState<string[]>(() =>
    document.activeId ? [document.activeId] : [],
  );
  const [query, setQuery] = useState("");
  const [entry, setEntry] = useState<PrintedWorkbook | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [notice, setNotice] = useState("");
  const [showPreview, setShowPreview] = useState(true);

  const openEntry = (workbook: PrintedWorkbook) => {
    setEntry(workbook);
    if (location.hash !== `#/workbook/${workbook.code}`)
      history.replaceState(null, "", `#/workbook/${workbook.code}`);
  };

  const closeEntry = (message?: string) => {
    setEntry(null);
    history.replaceState(null, "", location.pathname + location.search);
    if (message) setNotice(message);
  };

  const openByCode = (raw: string) => {
    const workbook = findWorkbook(raw);
    if (!workbook) {
      setNotice(
        `没有找到编号 ${raw.trim().toUpperCase()} 的题册。请核对封面编号；纸面草稿仍保存在本机。`,
      );
      return false;
    }
    openEntry(workbook);
    setNotice("");
    return true;
  };

  useEffect(() => {
    const syncFromHash = () => {
      const match = /^#\/workbook\/([A-Za-z0-9-]+)$/.exec(location.hash);
      if (!match) {
        setEntry(null);
        return;
      }
      const workbook = findWorkbook(match[1]);
      if (workbook) {
        setEntry(workbook);
        setNotice("");
      } else {
        setEntry(null);
        setNotice(
          `没有找到编号 ${match[1].toUpperCase()} 的题册。纸面草稿仍保存在本机。`,
        );
      }
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const candidates = useMemo(
    () =>
      puzzles
        .map((puzzle, index) => ({ puzzle, ordinal: index + 1 }))
        .filter(({ puzzle }) => selection.includes(puzzle.id)),
    [puzzles, selection],
  );

  const selectionKey = selection.join(",");
  const contentKey = documentKey(document, selection);
  const built = useMemo(
    () => makeWorkbook(config, candidates, document),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configKey(config), selectionKey, contentKey],
  );

  const toggle = (id: string) => {
    setSelection((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );
    setNotice("");
  };

  const visible = puzzles.filter((puzzle) => {
    const text = `${puzzle.collection} ${puzzle.size} ${
      document.sessions[puzzle.id]?.solved ? puzzle.title : ""
    }`;
    return text.includes(query.trim());
  });

  const print = () => {
    if (!built.workbook.puzzles.length) {
      setNotice("请先至少选择一道题。");
      return;
    }
    if (!saveWorkbook(built.workbook)) {
      setNotice("题册无法保存到本机存储，打印后可能无法凭编号取回。");
    } else {
      setNotice(
        `已保存题册 ${built.workbook.code}。打印后可在「凭编号取回」输入编号继续录入。`,
      );
    }
    setShowPreview(true);
    window.setTimeout(() => window.print(), 60);
  };

  const commit = (
    result: ReconcileResult,
    resolve: Record<string, "paper" | "screen">,
  ) => {
    const outcome = onCommit(result, resolve);
    if (!outcome.accepted) {
      setNotice("提交被拒绝：原题版本或当前进度已变化，请重新核对。");
      return;
    }
    // Submitted marks can leave the draft. Anything whose printed version is
    // gone stays, so the paper work is never silently discarded.
    const missingIds = new Set(
      result.missing
        .map(
          (label) =>
            entry?.puzzles.find((puzzle) => puzzle.label === label)?.puzzleId,
        )
        .filter((id): id is string => !!id),
    );
    const remaining = retainDraft(entry?.code ?? "", [...missingIds]);
    const kept =
      remaining && missingIds.size
        ? " 原版缺失的题仍保留纸面草稿，未套用同名新版。"
        : "";
    closeEntry(
      `已转写 ${result.batches.length} 道题${
        outcome.solved.length
          ? `，其中「${outcome.solved.join("」「")}」在纸面完成并记入成绩"`
          : ""
      }。${kept}`,
    );
  };

  if (entry) {
    return (
      <PaperEntryPanel
        workbook={entry}
        document={document}
        catalog={puzzles}
        onCommit={commit}
        onClose={() =>
          closeEntry("纸面录入草稿已保留，可凭编号重新打开。")
        }
      />
    );
  }

  return (
    <div className="workbook-page">
      <section className="workbook-builder panel">
        <header className="workbook-head">
          <div>
            <span className="eyebrow">PRINTABLE WORKBOOK · 纸面题册</span>
            <h1>
              <BookMarked size={20} /> 把题目带到纸上
            </h1>
            <p className="muted">
              从题库勾选多道题，安排每页行列，再决定是否附带当前标记。预览中的行列数字、分页与格子与打印完全一致；大题不会把一条线索拆到另一页。
            </p>
          </div>
          <div className="workbook-code-box">
            <label htmlFor="book-code">凭编号取回</label>
            <div>
              <Search size={14} />
              <input
                id="book-code"
                placeholder="GJ-XXXXXXX"
                value={codeInput}
                onChange={(event) => setCodeInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && openByCode(codeInput)) {
                    setCodeInput("");
                  }
                }}
              />
              <button
                onClick={() => {
                  if (openByCode(codeInput)) setCodeInput("");
                }}
              >
                打开
              </button>
            </div>
          </div>
        </header>

        {notice && (
          <p className="workbook-notice" role="status">
            {notice}
          </p>
        )}

        <div className="workbook-columns">
          <div className="workbook-library">
            <div className="workbook-section-head">
              <h2>选择题目</h2>
              <span>
                已选 {selection.length} / {puzzles.length}
              </span>
            </div>
            <label className="search">
              <Search size={16} />
              <input
                aria-label="筛选可打印题目"
                placeholder="筛选题目、主题、尺寸"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="workbook-list">
              {visible.map((puzzle) => {
                const index = puzzles.indexOf(puzzle);
                const ordinal = index + 1;
                const session = document.sessions[puzzle.id];
                const solved = !!session?.solved;
                const checked = selection.includes(puzzle.id);
                return (
                  <button
                    key={puzzle.id}
                    className={`workbook-item ${checked ? "checked" : ""}`}
                    onClick={() => toggle(puzzle.id)}
                    aria-pressed={checked}
                  >
                    <span className="workbook-check">
                      {checked && <Check size={12} />}
                    </span>
                    <span className="workbook-item-info">
                      <strong>{labelFor(puzzle, ordinal, solved)}</strong>
                      <small>
                        {puzzle.size} × {puzzle.size} · {puzzle.collection} ·{" "}
                        {solved
                          ? "已完成"
                          : session
                            ? `${completion(session)}%`
                            : "未开始"}
                      </small>
                    </span>
                    <span className="workbook-item-level">{puzzle.level}</span>
                  </button>
                );
              })}
              {!visible.length && <p className="muted">没有符合条件的题目。</p>}
            </div>
            <p className="workbook-hint">
              未解图案在题册中以「图案 NN」出现，封面和页眉不会提前泄露名称或缩略图。
            </p>
          </div>

          <div className="workbook-settings">
            <div className="workbook-section-head">
              <h2>版式与分页</h2>
              <span className="muted">单位：毫米</span>
            </div>
            <div className="setting-grid">
              <label>
                <span>纸张</span>
                <select
                  value={config.paper}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      paper: event.target.value as WorkbookConfig["paper"],
                    })
                  }
                >
                  <option value="a4">A4 210×297</option>
                  <option value="letter">Letter 8.5×11</option>
                </select>
              </label>
              <label>
                <span>方向</span>
                <select
                  value={config.orientation}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      orientation: event.target
                        .value as WorkbookConfig["orientation"],
                    })
                  }
                >
                  <option value="portrait">纵向</option>
                  <option value="landscape">横向</option>
                </select>
              </label>
              <label>
                <span>每页栏数</span>
                <select
                  value={config.columns}
                  onChange={(event) =>
                    setConfig({ ...config, columns: Number(event.target.value) })
                  }
                >
                  <option value={1}>1 栏</option>
                  <option value={2}>2 栏</option>
                  <option value={3}>3 栏</option>
                </select>
              </label>
              <label>
                <span>分页策略</span>
                <select
                  value={config.strategy}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      strategy: event.target
                        .value as WorkbookConfig["strategy"],
                    })
                  }
                >
                  <option value="writing">书写优先（推荐）</option>
                  <option value="paper">纸张优先</option>
                  <option value="custom">自定义格子</option>
                </select>
              </label>
              {config.strategy === "writing" && (
                <label className="setting-wide">
                  <span>
                    最小可书写格子 <strong>{fmt(config.minCell)} mm</strong>
                  </span>
                  <input
                    type="range"
                    min={4}
                    max={10}
                    step={0.5}
                    value={config.minCell}
                    onChange={(event) =>
                      setConfig({
                        ...config,
                        minCell: Number(event.target.value),
                      })
                    }
                  />
                </label>
              )}
              {config.strategy === "custom" && (
                <label className="setting-wide">
                  <span>
                    格子边长 <strong>{fmt(config.customCell)} mm</strong>
                  </span>
                  <input
                    type="range"
                    min={3}
                    max={12}
                    step={0.5}
                    value={config.customCell}
                    onChange={(event) =>
                      setConfig({
                        ...config,
                        customCell: Number(event.target.value),
                      })
                    }
                  />
                </label>
              )}
            </div>
            <label className="workbook-toggle">
              <input
                type="checkbox"
                checked={config.includeMarks}
                onChange={(event) =>
                  setConfig({ ...config, includeMarks: event.target.checked })
                }
              />
              <span>
                附带当前标记
                <small>印出屏幕上已有的填涂与标空，方便接着做。</small>
              </span>
            </label>
            <label className="workbook-toggle">
              <input
                type="checkbox"
                checked={config.includeAnswers}
                onChange={(event) =>
                  setConfig({ ...config, includeAnswers: event.target.checked })
                }
              />
              <span>
                另附答案页
                <small>
                  默认关闭。勾选后答案会单独成页并排在题面之后，请与题面分开保管。
                </small>
              </span>
            </label>
            {config.includeAnswers &&
              built.workbook.puzzles.some((puzzle) => !puzzle.title) && (
                <p className="workbook-warning">
                  <TriangleAlert size={13} /> 所选题目里有尚未完成的图案，答案页会
                  揭示它们的样子；请先收起答案页再开始解题。
                </p>
              )}

            <div className="workbook-plan-facts">
              <div>
                <strong>{built.plan.cell} mm</strong>
                <span>格子</span>
              </div>
              <div>
                <strong>{built.plan.columns}</strong>
                <span>栏</span>
              </div>
              <div>
                <strong>{built.plan.puzzlePages}</strong>
                <span>题面页</span>
              </div>
              <div>
                <strong>{built.plan.answerPages}</strong>
                <span>答案页</span>
              </div>
            </div>
            <p className="workbook-explain">{built.plan.explanation}</p>
            {built.plan.alternative && (
              <p className="workbook-alternative">
                <ChevronRight size={13} /> {built.plan.alternative}
              </p>
            )}
            <p className="workbook-utilization">
              纸张利用率 {Math.round(built.plan.utilization * 100)}%（按格子总面积估算）
            </p>
            {built.plan.warnings.map((warning) => (
              <p className="workbook-warning" key={warning}>
                <TriangleAlert size={13} /> {warning}
              </p>
            ))}
          </div>
        </div>

        <div className="workbook-actions">
          <button className="ghost" onClick={() => setShowPreview(!showPreview)}>
            {showPreview ? "隐藏预览" : "显示预览"}
          </button>
          <button
            className="ghost"
            onClick={() => {
              if (!built.workbook.puzzles.length) {
                setNotice("请先至少选择一道题。");
                return;
              }
              saveWorkbook(built.workbook);
              openEntry(built.workbook);
            }}
          >
            先录入纸面
          </button>
          <button className="primary" onClick={print}>
            <Printer size={16} /> 保存题册并打印
          </button>
        </div>
        <p className="workbook-foot-note">
          <FileDown size={13} /> 题册编号 {built.workbook.code} 会印在每页页眉；
          打印后凭编号可打开当时的题目快照。
          {built.workbook.printedAt !== built.workbook.createdAt &&
            " 同一选择与进度曾打印过，沿用原编号与快照。"}
        </p>
      </section>

      {showPreview && (
        <PreviewPane
          workbook={built.workbook}
          plan={built.plan}
          onOpenPuzzle={onOpenPuzzle}
        />
      )}
      <PrintPortal workbook={built.workbook} plan={built.plan} />
    </div>
  );
}

function PreviewPane({
  workbook,
  plan,
  onOpenPuzzle,
}: {
  workbook: PrintedWorkbook;
  plan: WorkbookPlan;
  onOpenPuzzle: (id: string) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const pageWidth = plan.pageSize.width * MM_TO_PX;
  const scale = Math.max(0.25, Math.min(1, (width - 24) / pageWidth));

  return (
    <section className="workbook-preview panel">
      <div className="workbook-section-head">
        <div>
          <span className="eyebrow">PREVIEW · 与打印一致</span>
          <h2>
            预览：{plan.puzzlePages} 页题面
            {plan.answerPages ? ` + ${plan.answerPages} 页答案` : ""}
          </h2>
        </div>
        <span className="muted">
          {plan.pageSize.width}×{plan.pageSize.height} mm · {plan.columns} 栏 · 每格{" "}
          {plan.cell} mm
        </span>
      </div>
      <div className="preview-stage" ref={stage}>
        {[<CoverPage
          key="cover"
          plan={plan}
          code={workbook.code}
          createdAt={workbook.createdAt}
          puzzleCount={workbook.puzzles.length}
        />, ...plan.pages.map((page, index) => (
          <PageSheet
            key={page.kind + page.number}
            plan={plan}
            pageIndex={index}
            code={workbook.code}
            createdAt={workbook.createdAt}
          />
        ))].map((page, index) => (
          <div
            className="preview-page-slot"
            key={index}
            style={{
              width: `${pageWidth * scale}px`,
              height: `${plan.pageSize.height * MM_TO_PX * scale}px`,
            }}
          >
            <div
              className="preview-page-scale"
              style={{
                transform: `scale(${scale})`,
                width: `${pageWidth}px`,
                height: `${plan.pageSize.height * MM_TO_PX}px`,
              }}
            >
              {page}
            </div>
            <span className="preview-page-label">
              {index === 0 ? "封面" : `第 ${index} 页`}
            </span>
          </div>
        ))}
      </div>
      <p className="preview-note">
        预览与打印共用同一份版面计算：行列数字、分页、格子尺寸一致。只有已完成的题会显示名称，其余以编号出现。
        {plan.answerPages > 0
          ? " 答案页排在最后，可单独打印后收起。"
          : " 当前不含答案页。"}
      </p>
      <div className="preview-links">
        {workbook.puzzles.map((puzzle) => (
          <button
            key={puzzle.puzzleId}
            onClick={() => onOpenPuzzle(puzzle.puzzleId)}
          >
            {puzzle.label} <ChevronRight size={13} />
          </button>
        ))}
      </div>
    </section>
  );
}

/** The real print DOM lives at body level so page geometry is untouched. */
function PrintPortal({
  workbook,
  plan,
}: {
  workbook: PrintedWorkbook;
  plan: WorkbookPlan;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = document.createElement("div");
    element.className = "print-portal";
    document.body.appendChild(element);
    document.body.classList.add("print-ready");
    setHost(element);
    return () => {
      document.body.classList.remove("print-ready");
      element.remove();
    };
  }, []);

  if (!host) return null;
  return createPortal(
    <>
      <style>{`@page { size: ${plan.pageSize.width}mm ${plan.pageSize.height}mm; margin: 0; }`}</style>
      <CoverPage
        plan={plan}
        code={workbook.code}
        createdAt={workbook.createdAt}
        puzzleCount={workbook.puzzles.length}
      />
      {plan.pages.map((page, index) => (
        <PageSheet
          key={page.kind + page.number}
          plan={plan}
          pageIndex={index}
          code={workbook.code}
          createdAt={workbook.createdAt}
        />
      ))}
    </>,
    host,
  );
}
