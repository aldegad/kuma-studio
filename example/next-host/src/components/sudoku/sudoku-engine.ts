export type SudokuBoard = number[][];

export type SudokuGame = {
  puzzle: SudokuBoard;
  solution: SudokuBoard;
};

const BOARD_SIZE = 9;
const BOX_SIZE = 3;
const DEFAULT_CLUE_COUNT = 34;
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export function createEmptyBoard(): SudokuBoard {
  return Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => 0));
}

export function cloneBoard(board: SudokuBoard): SudokuBoard {
  return board.map((row) => row.slice());
}

function shuffleValues<T>(values: readonly T[]): T[] {
  const next = [...values];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function getCandidates(board: SudokuBoard, row: number, col: number): number[] {
  if (board[row][col] !== 0) {
    return [];
  }

  const blocked = new Set<number>();

  for (let index = 0; index < BOARD_SIZE; index += 1) {
    blocked.add(board[row][index]);
    blocked.add(board[index][col]);
  }

  const boxRowStart = Math.floor(row / BOX_SIZE) * BOX_SIZE;
  const boxColStart = Math.floor(col / BOX_SIZE) * BOX_SIZE;

  for (let boxRow = boxRowStart; boxRow < boxRowStart + BOX_SIZE; boxRow += 1) {
    for (let boxCol = boxColStart; boxCol < boxColStart + BOX_SIZE; boxCol += 1) {
      blocked.add(board[boxRow][boxCol]);
    }
  }

  return DIGITS.filter((value) => !blocked.has(value));
}

function findBestEmptyCell(board: SudokuBoard) {
  let best: { row: number; col: number; candidates: number[] } | null = null;

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col] !== 0) {
        continue;
      }

      const candidates = getCandidates(board, row, col);
      if (candidates.length === 0) {
        return { row, col, candidates };
      }

      if (!best || candidates.length < best.candidates.length) {
        best = { row, col, candidates };
      }

      if (best?.candidates.length === 1) {
        return best;
      }
    }
  }

  return best;
}

function collectSolutions(
  board: SudokuBoard,
  options: { limit: number; randomize: boolean },
  solutions: SudokuBoard[] = [],
) {
  if (solutions.length >= options.limit) {
    return solutions;
  }

  const nextCell = findBestEmptyCell(board);
  if (!nextCell) {
    solutions.push(cloneBoard(board));
    return solutions;
  }

  if (nextCell.candidates.length === 0) {
    return solutions;
  }

  const candidates = options.randomize ? shuffleValues(nextCell.candidates) : nextCell.candidates;

  for (const candidate of candidates) {
    board[nextCell.row][nextCell.col] = candidate;
    collectSolutions(board, options, solutions);
    board[nextCell.row][nextCell.col] = 0;

    if (solutions.length >= options.limit) {
      return solutions;
    }
  }

  return solutions;
}

export function solveSudoku(puzzle: SudokuBoard): SudokuBoard | null {
  const [solution] = collectSolutions(cloneBoard(puzzle), {
    limit: 1,
    randomize: false,
  });
  return solution ?? null;
}

export function countSudokuSolutions(puzzle: SudokuBoard, limit = 2): number {
  return collectSolutions(cloneBoard(puzzle), {
    limit,
    randomize: false,
  }).length;
}

function generateSolvedBoard(): SudokuBoard {
  const [solution] = collectSolutions(createEmptyBoard(), {
    limit: 1,
    randomize: true,
  });

  if (!solution) {
    throw new Error("Failed to generate a solved Sudoku board.");
  }

  return solution;
}

function countFilledCells(board: SudokuBoard): number {
  return board.reduce(
    (count, row) => count + row.reduce((rowCount, value) => rowCount + (value === 0 ? 0 : 1), 0),
    0,
  );
}

export function generateSudokuGame(clueCount = DEFAULT_CLUE_COUNT): SudokuGame {
  const solution = generateSolvedBoard();
  const puzzle = cloneBoard(solution);
  const cells = shuffleValues(Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => index));
  const minimumClues = Math.max(24, Math.min(clueCount, BOARD_SIZE * BOARD_SIZE));

  for (const cellIndex of cells) {
    if (countFilledCells(puzzle) <= minimumClues) {
      break;
    }

    const row = Math.floor(cellIndex / BOARD_SIZE);
    const col = cellIndex % BOARD_SIZE;
    const previousValue = puzzle[row][col];
    puzzle[row][col] = 0;

    if (countSudokuSolutions(puzzle, 2) !== 1) {
      puzzle[row][col] = previousValue;
    }
  }

  return {
    puzzle,
    solution,
  };
}
