import { PAGE, type Figure, type WorkbookPlan } from "../model/layout";
import type { PrintedWorkbook } from "../model/types";

function mm(value: number): string {
  return `${value}mm`;
}

function Grid({
  figure,
  showMarks,
}: {
  figure: Figure;
  showMarks: boolean;
}) {
  const { size, cell, rowClueWidth, colClueHeight } = figure.grid;
  const answer = figure.kind === "answer";
  const marks = showMarks && !answer;
  return (
    <div
      className={`pdf-grid ${answer ? "is-answer" : ""}`}
      style={{
        left: mm(rowClueWidth),
        top: mm(colClueHeight),
        width: mm(size * cell),
        height: mm(size * cell),
        gridTemplateColumns: `repeat(${size}, ${cell}mm)`,
        gridTemplateRows: `repeat(${size}, ${cell}mm)`,
      }}
    >
      {Array.from({ length: size * size }, (_, index) => {
        const row = Math.floor(index / size);
        const col = index % size;
        const mark = marks ? figure.snapshot[index] : "unknown";
        const inked = answer
          ? !!figure.solution?.[index]
          : mark === "filled";
        const majorRight = (col + 1) % 5 === 0 && col + 1 !== size;
        const majorBottom = (row + 1) % 5 === 0 && row + 1 !== size;
        return (
          <div
            key={index}
            className={[
              "pdf-cell",
              inked ? "ink" : "",
              !answer && mark === "cross" ? "cross" : "",
              majorRight ? "major-right" : "",
              majorBottom ? "major-bottom" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          />
        );
      })}
    </div>
  );
}

function ClueStrips({ figure }: { figure: Figure }) {
  const { cell, rowClueWidth, colClueHeight, clueFont, clueLine, clueGap } =
    figure.grid;
  return (
    <>
      {figure.clues.rows.map((values, row) => (
        <div
          key={"r" + row}
          className="pdf-clue pdf-clue-row"
          style={{
            left: 0,
            top: mm(colClueHeight + row * cell),
            width: mm(rowClueWidth),
            height: mm(cell),
            gap: mm(clueGap),
            fontSize: `${clueFont}pt`,
            lineHeight: mm(clueLine),
            paddingRight: mm(0.7),
          }}
        >
          {values.map((value, i) => (
            <span key={i}>{value}</span>
          ))}
        </div>
      ))}
      {figure.clues.cols.map((values, col) => (
        <div
          key={"c" + col}
          className="pdf-clue pdf-clue-col"
          style={{
            left: mm(rowClueWidth + col * cell),
            top: 0,
            width: mm(cell),
            height: mm(colClueHeight),
            gap: mm(clueGap),
            fontSize: `${clueFont}pt`,
            lineHeight: mm(clueLine),
            paddingBottom: mm(0.7),
          }}
        >
          {values.map((value, i) => (
            <span key={i}>{value}</span>
          ))}
        </div>
      ))}
    </>
  );
}

function FigureBlock({
  figure,
  showMarks,
}: {
  figure: Figure;
  showMarks: boolean;
}) {
  const answer = figure.kind === "answer";
  return (
    <div
      className={`pdf-figure ${answer ? "pdf-answer-figure" : ""}`}
      style={{
        left: mm(figure.x),
        top: mm(figure.y),
        width: mm(figure.width),
        height: mm(figure.height),
      }}
    >
      <div
        className="pdf-figure-body"
        style={{
          width: mm(figure.width),
          height: mm(figure.height - 4.6),
        }}
      >
        {!answer && <ClueStrips figure={figure} />}
        <Grid figure={figure} showMarks={showMarks} />
      </div>
      <div
        className="pdf-figure-caption"
        style={{
          width: mm(figure.width),
          fontSize: `${Math.max(6, Math.min(8.6, figure.grid.cell * 0.72))}pt`,
        }}
      >
        <span className="pdf-figure-label">{figure.label}</span>
        <span className="pdf-figure-tag">
          {answer ? "答案" : `${figure.grid.size}×${figure.grid.size}`}
        </span>
      </div>
    </div>
  );
}

export function PageSheet({
  plan,
  pageIndex,
  code,
  createdAt,
}: {
  plan: WorkbookPlan;
  pageIndex: number;
  code: string;
  createdAt: number;
}) {
  const page = plan.pages[pageIndex];
  const answers = page.kind === "answer";
  const label = answers
    ? `答案 · 第 ${page.sectionNumber} / ${plan.answerPages} 页`
    : `题册 ${code}`;
  return (
    <section
      className={`pdf-page ${answers ? "pdf-page-answers" : ""}`}
      data-page={page.number}
      style={{
        width: mm(plan.pageSize.width),
        height: mm(plan.pageSize.height),
      }}
    >
      <div
        className="pdf-page-inner"
        style={{
          left: mm(PAGE.margin),
          top: mm(PAGE.margin),
          width: mm(plan.content.width),
          height: mm(
            PAGE.header +
              PAGE.headerGap +
              plan.content.height +
              PAGE.footer,
          ),
        }}
      >
        <header className="pdf-page-header">
          <span className="pdf-brand">格间 GEJIAN</span>
          <span className="pdf-code">{label}</span>
          <span className="pdf-date">
            {new Date(createdAt).toLocaleDateString("zh-CN")}
          </span>
        </header>
        <div
          className="pdf-content"
          style={{
            marginTop: mm(PAGE.headerGap),
            width: mm(plan.content.width),
            height: mm(plan.content.height),
          }}
        >
          {page.figures.map((figure) => (
            <FigureBlock
              key={figure.kind + figure.puzzleId}
              figure={figure}
              showMarks={plan.config.includeMarks && !answers}
            />
          ))}
          {!page.figures.length && (
            <p className="pdf-empty">
              未选择题目。勾选题库中的图案后，这里会出现可打印的题面。
            </p>
          )}
          {answers && (
            <p className="pdf-answer-note">
              答案页 · 只有在选项中明确勾选后才会印出。
            </p>
          )}
        </div>
        <footer className="pdf-page-footer">
          <span>
            {answers
              ? "答案单独成册 · 与题面分开保管"
              : "数字表示连续填涂的长度，两组之间至少空一格。"}
          </span>
          <span>
            {answers
              ? `第 ${page.number} / ${plan.pages.length} 页`
              : `${plan.columns} 栏 · 每格 ${plan.cell} mm · 第 ${page.number} / ${plan.puzzlePages} 页`}
          </span>
        </footer>
      </div>
    </section>
  );
}

export function CoverPage({
  plan,
  code,
  createdAt,
  puzzleCount,
}: {
  plan: WorkbookPlan;
  code: string;
  createdAt: number;
  puzzleCount: number;
}) {
  return (
    <section
      className="pdf-page pdf-cover"
      style={{
        width: mm(plan.pageSize.width),
        height: mm(plan.pageSize.height),
      }}
    >
      <div
        className="pdf-page-inner pdf-cover-inner"
        style={{
          left: mm(PAGE.margin),
          top: mm(PAGE.margin),
          width: mm(plan.content.width),
          height: mm(plan.pageSize.height - PAGE.margin * 2),
        }}
      >
        <span className="eyebrow">GEJIAN · 纸面题册</span>
        <h1>把一格一格，带到纸上。</h1>
        <p className="pdf-cover-lede">
          {puzzleCount} 道题 · 共 {plan.pages.length} 页 · 每格 {plan.cell} mm
        </p>
        <div className="pdf-cover-code">
          <span>题册编号</span>
          <strong>{code}</strong>
          <small>
            {new Date(createdAt).toLocaleString("zh-CN")} ·
            打印后可在录入模式凭此编号取回原题
          </small>
        </div>
        <ul className="pdf-cover-facts">
          <li>
            <span>纸张</span>
            <strong>
              {plan.config.paper === "a4" ? "A4" : "Letter"} ·{" "}
              {plan.config.orientation === "portrait" ? "纵向" : "横向"}
            </strong>
          </li>
          <li>
            <span>分页</span>
            <strong>
              {plan.puzzlePages} 页题面
              {plan.answerPages
                ? ` + ${plan.answerPages} 页答案（另选）`
                : " · 不含答案"}
            </strong>
          </li>
          <li>
            <span>附带标记</span>
            <strong>
              {plan.config.includeMarks ? "包含当前标记" : "不包含标记"}
            </strong>
          </li>
          <li>
            <span>每页行列</span>
            <strong>
              {plan.columns} 栏 · 每格 {plan.cell} mm
            </strong>
          </li>
        </ul>
        <p className="pdf-cover-rules">
          数字表示连续填涂的长度，两组之间至少空一格。题面与答案分开装订，
          答案页只在明确选择后才印出；未解图案不会在封面泄露名称或缩略图。
        </p>
        <div className="pdf-cover-foot">
          <span>格间 · 只属于你的专注时光</span>
          <span>未完成的题册不会被记为已完成</span>
        </div>
      </div>
    </section>
  );
}

export function WorkbookPages({
  workbook,
  plan,
}: {
  workbook: PrintedWorkbook;
  plan: WorkbookPlan;
}) {
  return (
    <>
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
    </>
  );
}
