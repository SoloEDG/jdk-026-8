import type { Mark } from "../../../shared/types";
import type { WorkbookConfig, WorkbookPuzzle } from "./types";

/** All measurements are millimetres so preview and paper share one geometry. */
export interface Size {
  width: number;
  height: number;
}

export const PAPER_SIZES: Record<
  WorkbookConfig["paper"],
  Record<WorkbookConfig["orientation"], Size>
> = {
  a4: {
    portrait: { width: 210, height: 297 },
    landscape: { width: 297, height: 210 },
  },
  letter: {
    portrait: { width: 215.9, height: 279.4 },
    landscape: { width: 279.4, height: 215.9 },
  },
};

/** Fixed page furniture, identical in preview and print. */
export const PAGE = {
  margin: 11,
  header: 10,
  /** Breathing room between the running header rule and the first grid. */
  headerGap: 2.5,
  footer: 7,
  gapX: 6,
  gapY: 7,
} as const;

/** Cap so a page never turns into a poster, and floor for safe printing. */
export const MAX_CELL = 10;
export const PAPER_MAX_CELL = 12;
export const MIN_SAFE_CELL = 3;
export const ANSWER_MAX_CELL = 6;

export interface GridMetrics {
  size: number;
  cell: number;
  clueFont: number;
  clueLine: number;
  /** Space between adjacent clue numbers inside a strip, in mm. */
  clueGap: number;
  rowClueWidth: number;
  colClueHeight: number;
  gridWidth: number;
  gridHeight: number;
  captionHeight: number;
  blockWidth: number;
  blockHeight: number;
}

export interface ClueLines {
  rows: number[][];
  cols: number[][];
}

export interface Figure {
  kind: "puzzle" | "answer";
  puzzleId: string;
  /** Stable 1-based catalog ordinal, used for anonymized labels. */
  ordinal: number;
  /** Public label: the title only when the puzzle was already solved. */
  label: string;
  title: string | null;
  /** Top-left corner inside the printable content box, in mm. */
  x: number;
  y: number;
  width: number;
  height: number;
  grid: GridMetrics;
  clues: ClueLines;
  /** Present only for answer figures; fill-in pages never carry it. */
  solution?: number[];
  /** Board state at print time, rendered only when marks are included. */
  snapshot: Mark[];
}

export interface PagePlan {
  kind: "puzzle" | "answer";
  /** 1-based page number across the whole workbook. */
  number: number;
  /** 1-based page number within its own section. */
  sectionNumber: number;
  figures: Figure[];
}

export interface WorkbookPlan {
  config: WorkbookConfig;
  pageSize: Size;
  content: Size;
  cell: number;
  columns: number;
  pages: PagePlan[];
  puzzlePages: number;
  answerPages: number;
  /** Global page number where the opt-in answer section starts, if any. */
  answerStartPage: number | null;
  utilization: number;
  explanation: string;
  alternative: string | null;
  warnings: string[];
}

export function pageSize(config: WorkbookConfig): Size {
  return PAPER_SIZES[config.paper][config.orientation];
}

export function contentSize(config: WorkbookConfig): Size {
  const size = pageSize(config);
  return {
    width: size.width - PAGE.margin * 2,
    height:
      size.height -
      PAGE.margin * 2 -
      PAGE.header -
      PAGE.headerGap -
      PAGE.footer,
  };
}

export function cluesOf(puzzle: WorkbookPuzzle): ClueLines {
  return puzzle.clues;
}

function maxRunCount(clues: ClueLines): { rows: number; cols: number } {
  return {
    rows: Math.max(1, ...clues.rows.map((line) => line.length)),
    cols: Math.max(1, ...clues.cols.map((line) => line.length)),
  };
}

/**
 * Notebook-friendly grid geometry. The clue gutter is sized from the real
 * clue counts, never from the solution picture, so no artwork is implied.
 */
export function gridMetrics(
  size: number,
  clues: ClueLines,
  cell: number,
): GridMetrics {
  const runs = maxRunCount(clues);
  const clueFont = Math.min(7.4, Math.max(4.1, cell * 0.6));
  const clueLine = Math.max(1.6, clueFont * 0.4);
  const clueGap = Math.max(0.35, clueFont * 0.22);
  // Width is measured with a conservative digit advance (font is in pt,
  // geometry in mm); height uses the actual line box. Gaps are counted so a
  // 5-run clue cannot overflow into the grid or past the page edge.
  const digit = clueFont * 0.3528 * 0.62 + 0.15;
  const rowClueWidth = runs.rows * digit + (runs.rows - 1) * clueGap + 1.3;
  const colClueHeight = runs.cols * clueLine + (runs.cols - 1) * clueGap + 1.3;
  const gridWidth = rowClueWidth + size * cell;
  const gridHeight = colClueHeight + size * cell;
  const captionHeight = 4.6;
  return {
    size,
    cell,
    clueFont,
    clueLine,
    clueGap,
    rowClueWidth,
    colClueHeight,
    gridWidth,
    gridHeight,
    captionHeight,
    blockWidth: gridWidth,
    blockHeight: gridHeight + captionHeight,
  };
}

interface Block<T> {
  data: T;
  width: number;
  height: number;
}

/**
 * Column-major packing. Blocks are atomic: a clue strip and its grid always
 * travel together, so a big puzzle can never have a clue split to another
 * page. `pages[page][slot]` lists the blocks in reading order.
 */
function packBlocks<T>(
  blocks: Block<T>[],
  columns: number,
  content: Size,
): { pages: Block<T>[][][]; overflow: boolean } {
  const columnWidth = (content.width - PAGE.gapX * (columns - 1)) / columns;
  const columnsUsed: Block<T>[][] = [];
  let current: Block<T>[] = [];
  let height = 0;
  let overflow = false;
  for (const block of blocks) {
    const spacing = current.length ? PAGE.gapY : 0;
    if (current.length && height + spacing + block.height > content.height) {
      columnsUsed.push(current);
      current = [];
      height = 0;
    }
    if (block.height > content.height) overflow = true;
    current.push({ ...block, width: Math.min(block.width, columnWidth) });
    height += (current.length > 1 ? PAGE.gapY : 0) + block.height;
  }
  if (current.length) columnsUsed.push(current);
  if (!columnsUsed.length) columnsUsed.push([]);

  const pageCount = Math.ceil(columnsUsed.length / columns);
  const pages: Block<T>[][][] = Array.from({ length: pageCount }, () =>
    Array.from({ length: columns }, () => [] as Block<T>[]),
  );
  columnsUsed.forEach((column, index) => {
    pages[Math.floor(index / columns)][index % columns].push(...column);
  });
  return { pages, overflow };
}

interface Placement {
  x: number;
  y: number;
  pageIndex: number;
  slot: number;
}

function placeBlocks<T>(
  pages: Block<T>[][][],
  content: Size,
): Placement[][][] {
  const columns = Math.max(1, pages[0]?.length ?? 1);
  const columnWidth = (content.width - PAGE.gapX * (columns - 1)) / columns;
  return pages.map((slots, pageIndex) =>
    slots.map((blocks, slot) => {
      const x = slot * (columnWidth + PAGE.gapX);
      let y = 0;
      return blocks.map((block) => {
        const placed = {
          x,
          y,
          pageIndex,
          slot,
        };
        y += block.height + PAGE.gapY;
        return placed;
      });
    }),
  );
}

function puzzleBlocks(puzzles: WorkbookPuzzle[], cell: number): {
  blocks: Block<{ puzzle: WorkbookPuzzle; metrics: GridMetrics }>[];
} {
  return {
    blocks: puzzles.map((puzzle) => {
      const clues = cluesOf(puzzle);
      const metrics = gridMetrics(puzzle.size, clues, cell);
      return {
        data: { puzzle, metrics },
        width: metrics.blockWidth,
        height: metrics.blockHeight,
      };
    }),
  };
}

function answerBlocks(puzzles: WorkbookPuzzle[], cell: number): {
  blocks: Block<{ puzzle: WorkbookPuzzle; metrics: GridMetrics }>[];
} {
  return {
    blocks: puzzles.map((puzzle) => {
      // Answers only show the revealed picture: no clue gutter.
      const metrics = gridMetrics(puzzle.size, { rows: [], cols: [] }, cell);
      const width = puzzle.size * cell;
      const height = width + metrics.captionHeight;
      return {
        data: {
          puzzle,
          metrics: { ...metrics, gridWidth: width, gridHeight: width, rowClueWidth: 0, colClueHeight: 0 },
        },
        width,
        height,
      };
    }),
  };
}

function answerCellFor(
  puzzles: WorkbookPuzzle[],
  preferred: number,
  columns: number,
  content: Size,
): number {
  const widest = puzzles.reduce(
    (max, puzzle) => Math.max(max, puzzle.size),
    0,
  );
  if (!widest) return Math.min(ANSWER_MAX_CELL, preferred);
  const columnWidth = (content.width - PAGE.gapX * (columns - 1)) / columns;
  const fit = columnWidth / widest;
  return Math.max(
    MIN_SAFE_CELL,
    Math.min(ANSWER_MAX_CELL, preferred, fit),
  );
}

function columnsFor(
  requested: number,
  widest: number,
  contentWidth: number,
): number {
  if (widest <= 0) return Math.max(1, requested);
  const fit = Math.floor((contentWidth + PAGE.gapX) / (widest + PAGE.gapX));
  return Math.max(1, Math.min(requested, fit));
}

function countPages(
  puzzles: WorkbookPuzzle[],
  cell: number,
  columns: number,
  content: Size,
): { pages: number; overflow: boolean } {
  if (!puzzles.length) return { pages: 1, overflow: false };
  const { blocks } = puzzleBlocks(puzzles, cell);
  const packed = packBlocks(blocks, columns, content);
  return { pages: packed.pages.length, overflow: packed.overflow };
}

function feasibleCell(
  puzzles: WorkbookPuzzle[],
  cell: number,
  requestedColumns: number,
  content: Size,
): boolean {
  const { blocks } = puzzleBlocks(puzzles, cell);
  const widest = Math.max(0, ...blocks.map((block) => block.width));
  const columns = columnsFor(requestedColumns, widest, content.width);
  const columnWidth = (content.width - PAGE.gapX * (columns - 1)) / columns;
  if (widest > columnWidth + 0.01) return false;
  const packed = packBlocks(blocks, columns, content);
  return !packed.overflow;
}

function bestPagesAt(
  puzzles: WorkbookPuzzle[],
  cell: number,
  requestedColumns: number,
  content: Size,
): { pages: number; columns: number } | null {
  if (!feasibleCell(puzzles, cell, requestedColumns, content)) return null;
  const { blocks } = puzzleBlocks(puzzles, cell);
  const widest = Math.max(0, ...blocks.map((block) => block.width));
  const columns = columnsFor(requestedColumns, widest, content.width);
  return { pages: countPages(puzzles, cell, columns, content).pages, columns };
}

export function chooseCell(
  config: WorkbookConfig,
  puzzles: WorkbookPuzzle[],
): {
  cell: number;
  columns: number;
  warnings: string[];
  explanation: string;
  alternative: string | null;
} {
  const content = contentSize(config);
  const warnings: string[] = [];
  const requested = config.columns;
  if (!puzzles.length) {
    return {
      cell: config.strategy === "custom" ? config.customCell : 8,
      columns: requested,
      warnings,
      explanation: "尚未选择题目。",
      alternative: null,
    };
  }
  const steps = (from: number, to: number) => {
    const values: number[] = [];
    for (let value = from; value <= to + 0.001; value += 0.5)
      values.push(Math.round(value * 10) / 10);
    return values;
  };

  let chosen: { cell: number; columns: number; pages: number } | null = null;

  if (config.strategy === "custom") {
    const cell = Math.min(PAPER_MAX_CELL, Math.max(MIN_SAFE_CELL, config.customCell));
    const at = bestPagesAt(puzzles, cell, requested, content);
    if (at) chosen = { cell, columns: at.columns, pages: at.pages };
    else {
      const safe = bestPagesAt(puzzles, MIN_SAFE_CELL, requested, content);
      chosen = {
        cell: MIN_SAFE_CELL,
        columns: safe?.columns ?? 1,
        pages: safe?.pages ?? puzzles.length,
      };
      warnings.push(
        `自定义的 ${cell} mm 格子放不进一栏，已退回 ${MIN_SAFE_CELL} mm。`,
      );
    }
  } else if (config.strategy === "paper") {
    const candidates = steps(MIN_SAFE_CELL, PAPER_MAX_CELL).reverse();
    for (const cell of candidates) {
      const at = bestPagesAt(puzzles, cell, requested, content);
      if (at) {
        chosen = { cell, columns: at.columns, pages: at.pages };
        break;
      }
    }
    if (!chosen) {
      chosen = { cell: MIN_SAFE_CELL, columns: 1, pages: puzzles.length };
      warnings.push("题目过大，已按最小安全格子排版，可能略显拥挤。");
    }
  } else {
    // Writing comfort first, paper second: among comfortable sizes, take the
    // largest cell that still achieves the fewest possible pages.
    const comfortable = steps(config.minCell, MAX_CELL);
    const feasible = comfortable
      .map((cell) => ({ cell, at: bestPagesAt(puzzles, cell, requested, content) }))
      .filter((entry): entry is { cell: number; at: { pages: number; columns: number } } =>
        !!entry.at,
      );
    if (feasible.length) {
      const leastPages = Math.min(...feasible.map((entry) => entry.at.pages));
      const best = feasible
        .filter((entry) => entry.at.pages === leastPages)
        .sort((a, b) => b.cell - a.cell)[0];
      chosen = { cell: best.cell, columns: best.at.columns, pages: leastPages };
    } else {
      const fallback = steps(MIN_SAFE_CELL, Math.max(MIN_SAFE_CELL, config.minCell - 0.5))
        .reverse()
        .map((cell) => ({ cell, at: bestPagesAt(puzzles, cell, requested, content) }))
        .find((entry) => !!entry.at);
      chosen = {
        cell: fallback?.cell ?? MIN_SAFE_CELL,
        columns: fallback?.at?.columns ?? 1,
        pages: fallback?.at?.pages ?? puzzles.length,
      };
      warnings.push(
        `最小可书写尺寸 ${config.minCell} mm 排不下所有题，已降到 ${chosen.cell} mm 以保留完整题面。`,
      );
    }
  }

  const alternative = explainAlternative(config, puzzles, chosen.cell, chosen.pages, content);
  const explanation = explainChoice(config, puzzles, chosen, content);
  return {
    cell: chosen.cell,
    columns: chosen.columns,
    warnings,
    explanation,
    alternative,
  };
}

function explainChoice(
  config: WorkbookConfig,
  puzzles: WorkbookPuzzle[],
  chosen: { cell: number; columns: number; pages: number },
  content: Size,
): string {
  const paperName = config.paper === "a4" ? "A4" : "Letter";
  const orientation = config.orientation === "portrait" ? "纵向" : "横向";
  const base = `${paperName} ${orientation} · 每页 ${chosen.columns} 栏 · 每格 ${fmt(chosen.cell)} mm · 共 ${chosen.pages} 页`;
  if (config.strategy === "paper") {
    return `${base}。纸张优先：在不溢出的前提下取最大格子，便于摊开对照。`;
  }
  if (config.strategy === "custom") {
    return `${base}。自定义格子尺寸，分页按所选尺寸计算。`;
  }
  const widest = puzzles.reduce(
    (max, puzzle) =>
      Math.max(max, gridMetrics(puzzle.size, cluesOf(puzzle), chosen.cell).blockWidth),
    0,
  );
  return `${base}。书写优先：在 ${fmt(config.minCell)}–${MAX_CELL} mm 的可书写范围内，${chosen.pages} 页已是当前题量下最少的分页，因此取仍能保持该页数的最大格子 ${fmt(chosen.cell)} mm（最宽题面 ${fmt(widest)} mm，栏宽 ${fmt((content.width - PAGE.gapX * (chosen.columns - 1)) / chosen.columns)} mm）。`;
}

function explainAlternative(
  config: WorkbookConfig,
  puzzles: WorkbookPuzzle[],
  cell: number,
  pages: number,
  content: Size,
): string | null {
  if (config.strategy !== "writing") return null;
  const larger = Math.min(MAX_CELL, cell + 1);
  if (larger <= cell) return null;
  const at = bestPagesAt(puzzles, larger, config.columns, content);
  if (!at) return `若把格子放大到 ${fmt(larger)} mm，题面将超出栏宽，预览会自动减少栏数或缩小格子。`;
  if (at.pages > pages)
    return `若把格子放大到 ${fmt(larger)} mm，页数会从 ${pages} 页增加到 ${at.pages} 页；当前尺寸是页数与书写舒适度的折中。`;
  return null;
}

function buildFigures(
  planPages: Block<{ puzzle: WorkbookPuzzle; metrics: GridMetrics }>[][][],
  content: Size,
  kind: "puzzle" | "answer",
): PagePlan[] {
  const positions = placeBlocks(planPages, content);
  const columns = Math.max(1, planPages[0]?.length ?? 1);
  const columnWidth =
    (content.width - PAGE.gapX * (columns - 1)) / columns;
  return planPages.map((slots, pageIndex) => ({
    kind,
    number: pageIndex + 1,
    sectionNumber: pageIndex + 1,
    figures: slots.flatMap((blocks, slot) =>
      blocks.map((block, blockIndex) => {
        const placed = positions[pageIndex][slot][blockIndex];
        const metrics = block.data.metrics;
        const answer = kind === "answer";
        const width = answer
          ? block.data.puzzle.size * metrics.cell
          : Math.max(0, Math.min(metrics.gridWidth, columnWidth));
        return {
          kind,
          puzzleId: block.data.puzzle.puzzleId,
          ordinal: block.data.puzzle.ordinal,
          label: block.data.puzzle.label,
          title: block.data.puzzle.title,
          x: placed.x + Math.max(0, (columnWidth - width) / 2),
          y: placed.y,
          width,
          height: block.height,
          grid: { ...metrics, gridWidth: width },
          clues: cluesOf(block.data.puzzle),
          solution: answer ? block.data.puzzle.solution : undefined,
          snapshot: block.data.puzzle.snapshot,
        };
      }),
    ),
  }));
}

export function buildPlan(
  config: WorkbookConfig,
  puzzles: WorkbookPuzzle[],
): WorkbookPlan {
  const page = pageSize(config);
  const content = contentSize(config);
  const choice = chooseCell(config, puzzles);
  const warnings = [...choice.warnings];
  const columns = choice.columns;

  const puzzlePages: PagePlan[] = [];
  if (puzzles.length) {
    const { blocks } = puzzleBlocks(puzzles, choice.cell);
    const packed = packBlocks(blocks, columns, content);
    if (packed.overflow)
      warnings.push("有题目高度超过版面，已单独成页；建议改用横向或更小格子。");
    puzzlePages.push(...buildFigures(packed.pages, content, "puzzle"));
  } else {
    puzzlePages.push({ kind: "puzzle", number: 1, sectionNumber: 1, figures: [] });
  }

  const answerPages: PagePlan[] = [];
  if (config.includeAnswers && puzzles.length) {
    // Answers target a compact but legible 6 mm cell and take as many
    // columns as fit, independent of the fill-in page's column count.
    const widest = puzzles.reduce((max, p) => Math.max(max, p.size), 0);
    const maxColumns = Math.max(
      1,
      Math.min(3, Math.floor((content.width + PAGE.gapX) / (widest * 4 + PAGE.gapX))),
    );
    const answerColumns = maxColumns;
    const answerCell = answerCellFor(
      puzzles,
      ANSWER_MAX_CELL,
      answerColumns,
      content,
    );
    const { blocks } = answerBlocks(puzzles, answerCell);
    const packed = packBlocks(blocks, answerColumns, content);
    const figures = buildFigures(packed.pages, content, "answer");
    figures.forEach((plan, index) => {
      answerPages.push({
        ...plan,
        number: puzzlePages.length + index + 1,
        sectionNumber: index + 1,
      });
    });
  }

  const pages = [...puzzlePages, ...answerPages];
  const total = pages.length;
  const utilization = utilizationOf(puzzles, choice.cell, total, content);

  return {
    config,
    pageSize: page,
    content,
    cell: choice.cell,
    columns,
    pages,
    puzzlePages: puzzlePages.length,
    answerPages: answerPages.length,
    answerStartPage: answerPages.length ? puzzlePages.length + 1 : null,
    utilization,
    explanation: choice.explanation,
    alternative: choice.alternative,
    warnings,
  };
}

function utilizationOf(
  puzzles: WorkbookPuzzle[],
  cell: number,
  pageCount: number,
  content: Size,
): number {
  const ink = puzzles.reduce(
    (total, puzzle) => total + (puzzle.size * cell) ** 2,
    0,
  );
  return ink / (Math.max(1, pageCount) * content.width * content.height);
}

export function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
