import { describe, expect, it } from "vitest";

import {
  countSudokuSolutions,
  generateSudokuGame,
  solveSudoku,
  type SudokuBoard,
} from "./sudoku-engine";

function expectGroupsToContainDigits(board: SudokuBoard) {
  const expected = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  for (let row = 0; row < 9; row += 1) {
    expect([...board[row]].sort((left, right) => left - right)).toEqual(expected);
  }

  for (let col = 0; col < 9; col += 1) {
    const column = Array.from({ length: 9 }, (_, row) => board[row][col]).sort(
      (left, right) => left - right,
    );
    expect(column).toEqual(expected);
  }

  for (let boxRow = 0; boxRow < 9; boxRow += 3) {
    for (let boxCol = 0; boxCol < 9; boxCol += 3) {
      const box = [];
      for (let row = boxRow; row < boxRow + 3; row += 1) {
        for (let col = boxCol; col < boxCol + 3; col += 1) {
          box.push(board[row][col]);
        }
      }
      expect(box.sort((left, right) => left - right)).toEqual(expected);
    }
  }
}

describe("sudoku-engine", () => {
  it("generates a uniquely solvable puzzle and matching solution", () => {
    const game = generateSudokuGame();
    const solved = solveSudoku(game.puzzle);

    expect(solved).not.toBeNull();
    expect(solved).toEqual(game.solution);
    expect(countSudokuSolutions(game.puzzle, 2)).toBe(1);
    expectGroupsToContainDigits(game.solution);
  });
});
