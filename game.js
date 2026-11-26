export const BOARD_SIZE = 13;
export const PLAYERS = Object.freeze(["black", "white"]);

const DIRECTIONS = Object.freeze([
  [0, 1], [0, -1], [1, 0], [-1, 0],
  [1, 1], [-1, -1], [1, -1], [-1, 1],
]);
const LINE_DIRECTIONS = Object.freeze([[0, 1], [1, 0], [1, 1], [1, -1]]);

export function createInitialState() {
  return {
    board: Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null)),
    currentPlayer: "black",
    capturedPairs: { black: 0, white: 0 },
    moveCount: 0,
    lastMove: null,
  };
}

function hasValidState(state) {
  return Boolean(
    state &&
    Array.isArray(state.board) &&
    state.board.length === BOARD_SIZE &&
    state.board.every(row =>
      Array.isArray(row) &&
      row.length === BOARD_SIZE &&
      row.every(cell => cell === null || PLAYERS.includes(cell))
    ) &&
    PLAYERS.includes(state.currentPlayer) &&
    state.capturedPairs &&
    PLAYERS.every(player => Number.isInteger(state.capturedPairs[player]) && state.capturedPairs[player] >= 0) &&
    Number.isInteger(state.moveCount) &&
    state.moveCount >= 0
  );
}

function isInside(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

export function checkMove(state, row, col) {
  if (!hasValidState(state)) {
    return { legal: false, reason: "棋局狀態無效，請重新開局。" };
  }
  if (getGameResult(state).finished) {
    return { legal: false, reason: "本局已結束，請重新開局。" };
  }
  if (!Number.isInteger(row) || !Number.isInteger(col) || !isInside(row, col)) {
    return { legal: false, reason: "請下在 13×13 棋盤的交叉點上。" };
  }
  if (state.board[row][col] !== null) {
    return { legal: false, reason: "這個交叉點已有棋子，請改選空位。" };
  }
  return { legal: true, reason: "" };
}

function findCaptures(board, row, col, player) {
  const opponent = player === "black" ? "white" : "black";
  const captured = [];

  for (const [dr, dc] of DIRECTIONS) {
    const one = [row + dr, col + dc];
    const two = [row + dr * 2, col + dc * 2];
    const three = [row + dr * 3, col + dc * 3];
    if (
      isInside(...one) &&
      isInside(...two) &&
      isInside(...three) &&
      board[one[0]][one[1]] === opponent &&
      board[two[0]][two[1]] === opponent &&
      board[three[0]][three[1]] === player
    ) {
      captured.push(
        { row: one[0], col: one[1], color: opponent },
        { row: two[0], col: two[1], color: opponent },
      );
    }
  }
  return captured;
}

function hasFiveOrMore(board, player) {
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col] !== player) continue;
      for (const [dr, dc] of LINE_DIRECTIONS) {
        let count = 1;
        for (const sign of [-1, 1]) {
          let nextRow = row + dr * sign;
          let nextCol = col + dc * sign;
          while (
            isInside(nextRow, nextCol) &&
            board[nextRow][nextCol] === player
          ) {
            count += 1;
            nextRow += dr * sign;
            nextCol += dc * sign;
          }
        }
        if (count >= 5) return true;
      }
    }
  }
  return false;
}

export function getGameResult(state) {
  if (!hasValidState(state)) {
    return { finished: false, winner: null, draw: false, reasons: [] };
  }

  for (const player of PLAYERS) {
    const reasons = [];
    if (hasFiveOrMore(state.board, player)) reasons.push("連成 5 子或以上");
    if (state.capturedPairs[player] >= 5) reasons.push("累計提掉 5 對");
    if (reasons.length) {
      const playerName = player === "black" ? "黑咖啡" : "豆漿";
      return {
        finished: true,
        winner: player,
        draw: false,
        reasons,
        message: playerName + "獲勝！" + reasons.join("，"),
      };
    }
  }

  const full = state.board.every(row => row.every(cell => cell !== null));
  if (full) {
    return { finished: true, winner: null, draw: true, reasons: ["棋盤下滿"], message: "棋盤下滿，和局！" };
  }
  return { finished: false, winner: null, draw: false, reasons: [], message: "" };
}

export function applyMove(state, row, col) {
  const legality = checkMove(state, row, col);
  if (!legality.legal) {
    return { ok: false, reason: legality.reason, state };
  }

  const player = state.currentPlayer;
  const board = state.board.map(boardRow => boardRow.slice());
  board[row][col] = player;
  const captured = findCaptures(board, row, col, player);
  for (const stone of captured) board[stone.row][stone.col] = null;

  const capturedPairs = { ...state.capturedPairs };
  capturedPairs[player] += captured.length / 2;
  const provisional = {
    board,
    currentPlayer: player === "black" ? "white" : "black",
    capturedPairs,
    moveCount: state.moveCount + 1,
    lastMove: { row, col, color: player },
  };
  const outcome = getGameResult(provisional);
  const nextState = outcome.finished
    ? { ...provisional, currentPlayer: player }
    : provisional;

  return { ok: true, state: nextState, captured, outcome };
}
