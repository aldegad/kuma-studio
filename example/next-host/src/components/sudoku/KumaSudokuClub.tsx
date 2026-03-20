"use client";

import Image from "next/image";
import { startTransition, useEffect, useMemo, useState } from "react";
import { Pencil, RotateCcw, Trophy } from "lucide-react";

import { KUMA_SUDOKU_ICON_SRC } from "../../lib/kuma-assets";
import { KumaSurfaceFrame } from "../lab/KumaSurfaceFrame";
import { cloneBoard, generateSudokuGame, type SudokuGame } from "./sudoku-engine";

type CellPosition = { row: number; col: number };

function getBlockIndex(row: number, col: number) {
  return Math.floor(row / 3) * 3 + Math.floor(col / 3);
}

function createEmptyNotes() {
  return Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => [] as number[]));
}

function getTargetPosition(selected: CellPosition, target?: CellPosition) {
  return target ?? selected;
}

export function KumaSudokuClub() {
  const initialGame = useMemo<SudokuGame>(() => generateSudokuGame(), []);
  const [game, setGame] = useState<SudokuGame>(initialGame);
  const [board, setBoard] = useState<number[][]>(() => cloneBoard(initialGame.puzzle));
  const [notes, setNotes] = useState<number[][][]>(() => createEmptyNotes());
  const [selected, setSelected] = useState<CellPosition>({ row: 0, col: 0 });
  const [noteMode, setNoteMode] = useState(false);
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);

  const puzzle = game.puzzle;
  const solution = game.solution;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSecondsElapsed((current) => current + 1);
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const wrongEntries = useMemo(() => {
    let count = 0;
    for (let row = 0; row < 9; row += 1) {
      for (let col = 0; col < 9; col += 1) {
        const value = board[row][col];
        if (value !== 0 && puzzle[row][col] === 0 && value !== solution[row][col]) {
          count += 1;
        }
      }
    }
    return count;
  }, [board]);

  const filledCount = useMemo(() => {
    let count = 0;
    for (const row of board) {
      for (const value of row) {
        if (value !== 0) {
          count += 1;
        }
      }
    }
    return count;
  }, [board]);

  const isSolved = useMemo(() => {
    for (let row = 0; row < 9; row += 1) {
      for (let col = 0; col < 9; col += 1) {
        if (board[row][col] !== solution[row][col]) {
          return false;
        }
      }
    }
    return true;
  }, [board]);

  function resetGame() {
    setBoard(cloneBoard(puzzle));
    setNotes(createEmptyNotes());
    setSelected({ row: 0, col: 0 });
    setNoteMode(false);
    setSecondsElapsed(0);
  }

  function newPuzzle() {
    if (isGenerating) {
      return;
    }

    setIsGenerating(true);
    window.setTimeout(() => {
      const nextGame = generateSudokuGame();
      startTransition(() => {
        setGame(nextGame);
        setBoard(cloneBoard(nextGame.puzzle));
        setNotes(createEmptyNotes());
        setSelected({ row: 0, col: 0 });
        setNoteMode(false);
        setSecondsElapsed(0);
        setIsGenerating(false);
      });
    }, 0);
  }

  function updateCell(value: number, target?: CellPosition) {
    const { row, col } = getTargetPosition(selected, target);
    if (puzzle[row][col] !== 0) {
      return;
    }

    if (noteMode) {
      setNotes((current) =>
        current.map((noteRow, noteRowIndex) =>
          noteRow.map((cellNotes, noteColIndex) => {
            if (noteRowIndex !== row || noteColIndex !== col) {
              return cellNotes;
            }
            return cellNotes.includes(value)
              ? cellNotes.filter((entry) => entry !== value)
              : [...cellNotes, value].sort((left, right) => left - right);
          }),
        ),
      );
      return;
    }

    setBoard((current) =>
      current.map((boardRow, boardRowIndex) =>
        boardRow.map((cellValue, boardColIndex) => {
          if (boardRowIndex !== row || boardColIndex !== col) {
            return cellValue;
          }
          return value;
        }),
      ),
    );
    setNotes((current) =>
      current.map((noteRow, noteRowIndex) =>
        noteRow.map((cellNotes, noteColIndex) => {
          if (noteRowIndex !== row || noteColIndex !== col) {
            return cellNotes;
          }
          return [];
        }),
      ),
    );
  }

  function clearCell(target?: CellPosition) {
    const { row, col } = getTargetPosition(selected, target);
    if (puzzle[row][col] !== 0) {
      return;
    }

    setBoard((current) =>
      current.map((boardRow, boardRowIndex) =>
        boardRow.map((cellValue, boardColIndex) => {
          if (boardRowIndex !== row || boardColIndex !== col) {
            return cellValue;
          }
          return 0;
        }),
      ),
    );
    setNotes((current) =>
      current.map((noteRow, noteRowIndex) =>
        noteRow.map((cellNotes, noteColIndex) => {
          if (noteRowIndex !== row || noteColIndex !== col) {
            return cellNotes;
          }
          return [];
        }),
      ),
    );
  }

  function applyHint(target?: CellPosition) {
    const { row, col } = getTargetPosition(selected, target);
    if (puzzle[row][col] !== 0) {
      return;
    }

    updateCell(solution[row][col], { row, col });
  }

  function clearSelectedCell() {
    clearCell();
  }

  function applySelectedHint() {
    applyHint();
  }

  function moveSelection(nextRow: number, nextCol: number) {
    setSelected({
      row: Math.min(8, Math.max(0, nextRow)),
      col: Math.min(8, Math.max(0, nextCol)),
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, row: number, col: number) {
    setSelected({ row, col });
    const target = { row, col };

    if (event.key >= "1" && event.key <= "9") {
      event.preventDefault();
      updateCell(Number(event.key), target);
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete" || event.key === "0") {
      event.preventDefault();
      clearCell(target);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(row - 1, col);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(row + 1, col);
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveSelection(row, col - 1);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveSelection(row, col + 1);
      return;
    }

    if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      setNoteMode((current) => !current);
    }
  }

  const selectedValue = board[selected.row][selected.col];

  return (
    <KumaSurfaceFrame
      appName="Kuma Sudoku Club"
      eyebrow="Kuma Sudoku Club"
      headline={
        <>
          Sweet logic.
          <br />
          Sharp selectors.
        </>
      }
      description="Every board starts from a fresh solved grid and gets carved back into a uniquely solvable puzzle. It is a polished Kuma Picker surface for click targeting, keyboard input, note mode, readback verification, mistakes, and completion checks."
      pills={[
        "Target cells by row and column labels",
        "Verify values after writes",
        "Use notes, hints, reset, and fresh puzzle flows",
      ]}
      visual={
        <div className="kuma-story-visual-stack">
          <Image src={KUMA_SUDOKU_ICON_SRC} alt="Kuma Sudoku Club icon" width={210} height={210} className="kuma-story-icon" priority />
          <div className="kuma-surface-float-card">
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[#87521f]">Today&apos;s Board</div>
            <div className="mt-2 text-lg font-black tracking-[-0.05em] text-[#4b2a0d]">{filledCount}/81 filled</div>
            <div className="mt-2 text-sm text-[#6f461f]">{wrongEntries} mistakes detected</div>
          </div>
        </div>
      }
      sidekickTitle="A puzzle that rewards exact automation"
      sidekickBody="The board is spacious, vivid, and packed with visible state so Kuma Picker can click, read back, and prove success instead of guessing."
      sidekickItems={[
        "Starter tiles stay locked while editable cells expose value changes immediately.",
        "Use note mode, keyboard entry, and hint flows for richer automation coverage.",
        "Every new puzzle changes the layout so scripts must read state instead of memorizing positions.",
      ]}
    >
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="kuma-board-card rounded-[2.2rem] p-5 shadow-[0_30px_90px_rgba(91,58,19,0.14)] sm:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#8b5a25]">Puzzle Surface</p>
                <h2 className="mt-2 text-3xl font-black tracking-[-0.06em] text-[#42220c]">
                  Honeycomb No. 01
                </h2>
                <p className="mt-3 max-w-[56ch] text-sm leading-7 text-[#78502b]">
                  Built for clicks, fills, keyboard steps, screenshot checks, and exact state
                  verification.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-[1.5rem] bg-[#fff8ea] p-3">
                <MetricCard label="Filled" value={`${filledCount}/81`} accent="gold" />
                <MetricCard label="Mistakes" value={String(wrongEntries)} accent="cream" />
                <MetricCard label="Timer" value={formatTime(secondsElapsed)} accent="mint" />
                <MetricCard
                  label="Mode"
                  value={isGenerating ? "Shuffling" : noteMode ? "Notes" : "Write"}
                  accent="rose"
                />
              </div>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div className="overflow-hidden rounded-[1.9rem] border border-[#9f6e34]/15 bg-[#fffdf8] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
                <div
                  className="grid aspect-square w-full max-w-[720px] grid-cols-9 gap-[2px] rounded-[1.5rem] bg-[#ab7a42] p-[4px]"
                  role="grid"
                  aria-label="Kuma Sudoku board"
                >
                  {board.map((rowValues, row) =>
                    rowValues.map((value, col) => {
                      const given = puzzle[row][col] !== 0;
                      const isSelected = selected.row === row && selected.col === col;
                      const inSameRow = selected.row === row;
                      const inSameCol = selected.col === col;
                      const inSameBlock = getBlockIndex(selected.row, selected.col) === getBlockIndex(row, col);
                      const wrong = value !== 0 && !given && value !== solution[row][col];
                      const noteEntries = notes[row][col];

                      return (
                        <button
                          key={`${row}-${col}`}
                          type="button"
                          role="gridcell"
                          data-testid={`cell-${row + 1}-${col + 1}`}
                          aria-label={`row ${row + 1} column ${col + 1} value ${value || "empty"}`}
                          aria-selected={isSelected}
                          className={[
                            "kuma-cell",
                            given ? "kuma-cell-given" : "kuma-cell-playable",
                            isSelected ? "kuma-cell-selected" : "",
                            !isSelected && (inSameRow || inSameCol || inSameBlock) ? "kuma-cell-related" : "",
                            wrong ? "kuma-cell-wrong" : "",
                            row % 3 === 2 && row !== 8 ? "kuma-cell-row-cut" : "",
                            col % 3 === 2 && col !== 8 ? "kuma-cell-col-cut" : "",
                          ].join(" ")}
                          onClick={() => setSelected({ row, col })}
                          onKeyDown={(event) => handleKeyDown(event, row, col)}
                        >
                          {value !== 0 ? (
                            <span className="text-[clamp(1.2rem,2.5vw,2.4rem)] font-black">{value}</span>
                          ) : (
                            <span className="grid h-full w-full grid-cols-3 grid-rows-3 gap-[2px] p-1.5 text-[10px] font-bold text-[#a37546] sm:text-xs">
                              {Array.from({ length: 9 }, (_, index) => index + 1).map((entry) => (
                                <span key={entry} className="flex items-center justify-center">
                                  {noteEntries.includes(entry) ? entry : ""}
                                </span>
                              ))}
                            </span>
                          )}
                        </button>
                      );
                    }),
                  )}
                </div>
              </div>

              <div className="space-y-4 rounded-[1.8rem] border border-[#8f6232]/15 bg-[#fff8eb] p-4">
                <div className="rounded-[1.4rem] bg-[#4d3112] p-4 text-[#fff6e1]">
                  <p className="text-[11px] uppercase tracking-[0.28em] text-[#f6cf91]">Selected Cell</p>
                  <div className="mt-3 flex items-end justify-between">
                    <div>
                      <h3 className="text-2xl font-black tracking-[-0.06em]">
                        R{selected.row + 1} · C{selected.col + 1}
                      </h3>
                      <p className="mt-1 text-sm text-[#f6e3ba]">
                        {puzzle[selected.row][selected.col] !== 0
                          ? "Starter tile"
                          : selectedValue === 0
                            ? "Ready for input"
                            : `Current value ${selectedValue}`}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white/12 px-4 py-3 text-3xl font-black">
                      {selectedValue || "·"}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {Array.from({ length: 9 }, (_, index) => index + 1).map((entry) => (
                    <button
                      key={entry}
                      type="button"
                      data-testid={`numpad-${entry}`}
                      className="kuma-numpad"
                      onClick={() => updateCell(entry)}
                    >
                      {entry}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className="kuma-tool" onClick={() => setNoteMode((current) => !current)}>
                    <Pencil className="h-4 w-4" />
                    {noteMode ? "Notes On" : "Notes Off"}
                  </button>
                  <button type="button" className="kuma-tool" onClick={clearSelectedCell}>
                    Clear
                  </button>
                  <button type="button" className="kuma-tool" onClick={applySelectedHint}>
                    Hint
                  </button>
                  <button type="button" className="kuma-tool" onClick={resetGame}>
                    <RotateCcw className="h-4 w-4" />
                    Reset
                  </button>
                  <button type="button" className="kuma-tool col-span-2" disabled={isGenerating} onClick={newPuzzle}>
                    {isGenerating ? "Shuffling..." : "New Puzzle"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-[2rem] border border-[#91612f]/15 bg-[#fff9f0] p-5 shadow-[0_24px_72px_rgba(89,58,19,0.12)]">
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#8e5d2b]">Kuma Picker Checklist</p>
              <div className="mt-4 space-y-3 text-sm leading-6 text-[#6f461f]">
                <CheckRow title="Click a cell" body="Target row 4 column 7 or use the board grid selectors." />
                <CheckRow title="Write and verify" body="Enter a value, then read it back with `browser-query-dom`." />
                <CheckRow title="Test note mode" body="Toggle notes and confirm mini digits render in the same tile." />
                <CheckRow title="Generate a fresh board" body="Use `New Puzzle` to confirm the surface re-renders with a different layout." />
              </div>
            </div>

            <div className="rounded-[2rem] border border-[#8d6137]/15 bg-[#4b3014] p-5 text-[#fff4dd] shadow-[0_24px_72px_rgba(75,48,20,0.22)]">
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#f0d59f]">E2E Hooks</p>
              <div className="mt-4 space-y-3 text-sm leading-6">
                <div className="rounded-2xl bg-white/8 px-4 py-3">`data-testid="cell-r-c"` style cell targeting via `cell-1-1` to `cell-9-9`</div>
                <div className="rounded-2xl bg-white/8 px-4 py-3">`data-testid="numpad-1"` to `numpad-9`</div>
                <div className="rounded-2xl bg-white/8 px-4 py-3">Completion state is visible when every cell matches the generated solution.</div>
              </div>
            </div>
          </aside>
        </section>

        {isSolved ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#261505]/55 p-4 backdrop-blur-sm">
            <div className="w-full max-w-[460px] rounded-[2rem] border border-[#9c703f]/20 bg-[#fff6e6] p-6 text-center shadow-[0_30px_100px_rgba(42,24,7,0.35)]">
              <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-[#f4c15f] text-[#4a2b0d]">
                <Trophy className="h-7 w-7" />
              </div>
              <h2 className="mt-5 text-3xl font-black tracking-[-0.06em] text-[#41230a]">
                Kuma cleared the board
              </h2>
              <p className="mt-3 text-sm leading-7 text-[#754b22]">
                The puzzle is solved and ready for end-to-end success checks, celebratory screenshots,
                and persistence verification.
              </p>
              <div className="mt-6 flex justify-center gap-3">
                <button type="button" className="kuma-tool" onClick={newPuzzle}>
                  New Puzzle
                </button>
              </div>
            </div>
          </div>
        ) : null}
    </KumaSurfaceFrame>
  );
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "gold" | "cream" | "mint" | "rose";
}) {
  return (
    <div className={`kuma-metric kuma-metric-${accent}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.26em] opacity-70">{label}</div>
      <div className="mt-2 text-xl font-black tracking-[-0.05em]">{value}</div>
    </div>
  );
}

function CheckRow({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[1.35rem] border border-[#8f6333]/12 bg-white/72 px-4 py-3">
      <div className="text-sm font-black tracking-[-0.03em] text-[#46270c]">{title}</div>
      <div className="mt-1 text-sm text-[#6f461f]">{body}</div>
    </div>
  );
}

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
