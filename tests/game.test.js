import test from "node:test";
import assert from "node:assert/strict";
import {
  BOARD_SIZE,
  createInitialState,
  checkMove,
  applyMove,
  getGameResult,
} from "../game.js";

function fixture() {
  return createInitialState();
}

function play(state, row, col) {
  const result = applyMove(state, row, col);
  assert.equal(result.ok, true, result.reason);
  return result;
}

test("開局為 13×13，黑咖啡先手", () => {
  const state = createInitialState();
  assert.equal(BOARD_SIZE, 13);
  assert.equal(state.board.length, 13);
  assert.ok(state.board.every(row => row.length === 13 && row.every(cell => cell === null)));
  assert.equal(state.currentPlayer, "black");
});

test("拒絕越界、非整數、已佔位置及終局後落子並回傳中文原因", () => {
  const state = fixture();
  assert.match(checkMove(state, -1, 0).reason, /13×13/);
  assert.match(checkMove(state, 2.5, 0).reason, /13×13/);
  const moved = play(state, 6, 6).state;
  assert.match(checkMove(moved, 6, 6).reason, /已有棋子/);

  const ended = fixture();
  ended.capturedPairs.black = 5;
  assert.match(checkMove(ended, 0, 0).reason, /已結束/);
});

test("合法落子後輪流換手，且不修改舊狀態", () => {
  const state = fixture();
  const snapshot = JSON.stringify(state);
  const first = play(state, 0, 0);
  assert.equal(first.state.board[0][0], "black");
  assert.equal(first.state.currentPlayer, "white");
  assert.equal(JSON.stringify(state), snapshot);
  assert.equal(play(first.state, 0, 1).state.currentPlayer, "black");
});

test("一次可同時在橫、直、斜方向夾走多對棋子", () => {
  const state = fixture();
  for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    state.board[6 + dr * 3][6 + dc * 3] = "black";
    state.board[6 + dr][6 + dc] = "white";
    state.board[6 + dr * 2][6 + dc * 2] = "white";
  }
  const result = play(state, 6, 6);
  assert.equal(result.captured.length, 16);
  assert.equal(result.state.capturedPairs.black, 8);
  for (const stone of result.captured) {
    assert.equal(result.state.board[stone.row][stone.col], null);
    assert.equal(stone.color, "white");
  }
});

test("自己下進兩顆對方棋子中間不會被提走", () => {
  const state = fixture();
  state.board[6][5] = "white";
  state.board[6][7] = "white";
  const result = play(state, 6, 6);
  assert.deepEqual(result.captured, []);
  assert.equal(result.state.board[6][5], "white");
  assert.equal(result.state.board[6][6], "black");
  assert.equal(result.state.board[6][7], "white");
});

test("橫、直、兩種斜向連成五子或以上都獲勝", () => {
  for (const [coords, final] of [
    [[[6, 2], [6, 3], [6, 4], [6, 5]], [6, 6]],
    [[[2, 6], [3, 6], [4, 6], [5, 6]], [6, 6]],
    [[[2, 2], [3, 3], [4, 4], [5, 5]], [6, 6]],
    [[[2, 10], [3, 9], [4, 8], [5, 7]], [6, 6]],
    [[[6, 1], [6, 2], [6, 4], [6, 5], [6, 6]], [6, 3]],
  ]) {
    const state = fixture();
    for (const [row, col] of coords) state.board[row][col] = "black";
    const result = play(state, ...final);
    assert.equal(result.outcome.winner, "black");
    assert.ok(result.outcome.reasons.includes("連成 5 子或以上"));
    assert.equal(result.state.currentPlayer, "black");
  }
});

test("累計提滿五對獲勝", () => {
  const state = fixture();
  state.capturedPairs.black = 4;
  state.board[6][3] = "black";
  state.board[6][4] = "white";
  state.board[6][5] = "white";
  const result = play(state, 6, 6);
  assert.equal(result.state.capturedPairs.black, 5);
  assert.equal(result.outcome.winner, "black");
  assert.ok(result.outcome.reasons.includes("累計提掉 5 對"));
});

test("棋盤下滿且沒有勝線或五對提子時和局", () => {
  const state = fixture();
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      state.board[row][col] = (row + col + Math.floor(row / 2)) % 2 === 0 ? "black" : "white";
    }
  }
  state.moveCount = BOARD_SIZE * BOARD_SIZE;
  const result = getGameResult(state);
  assert.equal(result.finished, true);
  assert.equal(result.draw, true);
  assert.equal(result.winner, null);
});
