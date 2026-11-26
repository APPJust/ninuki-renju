import { createNetworkManager, isRoomCode } from "./net.js";

const BOARD_SIZE = 13;
const screens = {
  home: document.querySelector("#home-screen"),
  game: document.querySelector("#game-screen"),
  lobby: document.querySelector("#lobby-screen"),
  offline: document.querySelector("#offline-screen"),
};
const boardElement = document.querySelector("#board");
const turnBanner = document.querySelector("#turn-banner");
const turnLabel = document.querySelector("#turn-label");
const turnDot = turnBanner.querySelector(".turn-dot");
const notice = document.querySelector("#game-notice");
const toast = document.querySelector("#toast");
const homeNetworkNotice = document.querySelector("#home-network-notice");
const nicknameInput = document.querySelector("#nickname-input");
const roomCodeInput = document.querySelector("#room-code-input");
const lobbyTitle = document.querySelector("#lobby-title");
const lobbyStatus = document.querySelector("#lobby-status");
const hostRoomDetails = document.querySelector("#host-room-details");
const joinRoomDetails = document.querySelector("#join-room-details");
const inviteLink = document.querySelector("#invite-link");
const blackCard = document.querySelector("#black-card");
const whiteCard = document.querySelector("#white-card");
const blackCaptures = document.querySelector("#black-captures");
const whiteCaptures = document.querySelector("#white-captures");
const blackCapturedStones = document.querySelector("#black-captured-stones");
const whiteCapturedStones = document.querySelector("#white-captured-stones");
const blackPlayerName = document.querySelector("#black-player-name");
const whitePlayerName = document.querySelector("#white-player-name");
const blackPlayerRole = document.querySelector("#black-player-role");
const whitePlayerRole = document.querySelector("#white-player-role");
const roundLabel = document.querySelector("#round-label");
const restartButton = document.querySelector("#restart-game");

let screenName = "home";
let mode = "home";
let networkRole = null;
let currentNickname = "棋友";
let rules = null;
let rulesPromise = null;
let state = null;
let outcomeFromHost = null;
let network = null;
let networkSession = null;
let restartReady = { hostReady: false, guestReady: false };
let ghosts = [];
let ghostTimers = [];
let toastTimer = null;

function setScreen(nextScreen) {
  screenName = nextScreen;
  for (const [name, element] of Object.entries(screens)) {
    element.hidden = name !== nextScreen;
  }
  if (nextScreen === "game" && state) render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function loadRules() {
  if (!rulesPromise) {
    rulesPromise = import("./game.js").then(module => {
      rules = module;
      return module;
    });
  }
  return rulesPromise;
}

function otherColor(color) {
  return color === "black" ? "white" : "black";
}

function colorName(color) {
  return color === "black" ? "黑咖啡" : "豆漿";
}

function makeBoardLines() {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 312 312");
  svg.setAttribute("class", "board-lines");
  svg.setAttribute("aria-hidden", "true");
  for (let index = 0; index < BOARD_SIZE; index += 1) {
    const point = 12 + index * 24;
    const vertical = document.createElementNS(namespace, "line");
    vertical.setAttribute("x1", point);
    vertical.setAttribute("x2", point);
    vertical.setAttribute("y1", 12);
    vertical.setAttribute("y2", 300);
    const horizontal = document.createElementNS(namespace, "line");
    horizontal.setAttribute("x1", 12);
    horizontal.setAttribute("x2", 300);
    horizontal.setAttribute("y1", point);
    horizontal.setAttribute("y2", point);
    svg.append(vertical, horizontal);
  }
  return svg;
}

function makeStone(color) {
  const stone = document.createElement("span");
  stone.className = "stone " + (color === "black" ? "coffee-stone" : "soy-stone");
  stone.setAttribute("aria-hidden", "true");
  return stone;
}

function describeCell(row, col, color) {
  const coordinate = String.fromCharCode(65 + col) + (row + 1);
  if (color === "black") return coordinate + "，黑咖啡";
  if (color === "white") return coordinate + "，豆漿";
  return coordinate + "，空位";
}

function renderBoard() {
  if (!state) return;
  boardElement.replaceChildren(makeBoardLines());
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const color = state.board[row][col];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "intersection";
      button.dataset.row = String(row);
      button.dataset.col = String(col);
      button.setAttribute("aria-label", describeCell(row, col, color));
      button.style.left = ((12 + 24 * col) / 312 * 100) + "%";
      button.style.top = ((12 + 24 * row) / 312 * 100) + "%";
      if (color) button.append(makeStone(color));
      if (state.lastMove && state.lastMove.row === row && state.lastMove.col === col) {
        button.classList.add("last-move");
      }
      boardElement.append(button);
    }
  }

  for (const ghost of ghosts) {
    const element = document.createElement("span");
    element.className = "captured-ghost";
    element.style.left = ((12 + 24 * ghost.col) / 312 * 100) + "%";
    element.style.top = ((12 + 24 * ghost.row) / 312 * 100) + "%";
    element.append(makeStone(ghost.color));
    element.setAttribute("aria-hidden", "true");
    boardElement.append(element);
  }
}

function namesForColors() {
  if (mode !== "network" || !networkSession) {
    return {
      black: { name: "黑咖啡", role: "黑方・先手" },
      white: { name: "豆漿", role: "白方・後手" },
    };
  }
  const hostNickname = networkSession.hostNickname || (networkRole === "host" ? currentNickname : "開房方");
  const guestNickname = networkSession.guestNickname || (networkRole === "guest" ? currentNickname : "對手");
  const localColor = networkSession.localColor || (networkRole === "host" ? networkSession.hostColor : otherColor(networkSession.hostColor));
  const blackIsHost = networkSession.hostColor === "black";
  return {
    black: {
      name: blackIsHost ? hostNickname : guestNickname,
      role: (localColor === "black" ? "你" : "對手") + "・黑咖啡・先手",
    },
    white: {
      name: blackIsHost ? guestNickname : hostNickname,
      role: (localColor === "white" ? "你" : "對手") + "・豆漿・後手",
    },
  };
}

function currentOutcome() {
  if (!state) return { finished: false, winner: null, draw: false, reasons: [], message: "" };
  if (mode === "network") return outcomeFromHost || { finished: false, winner: null, draw: false, reasons: [], message: "" };
  return rules ? rules.getGameResult(state) : { finished: false, winner: null, draw: false, reasons: [], message: "" };
}

function updateRestartButton(outcome) {
  const networkGame = mode === "network";
  restartButton.hidden = networkGame && !outcome.finished;
  if (!networkGame) {
    restartButton.disabled = false;
    restartButton.innerHTML = '<span aria-hidden="true">↻</span> 重開';
    return;
  }
  const ownReady = networkRole === "host" ? restartReady.hostReady : restartReady.guestReady;
  const otherReady = networkRole === "host" ? restartReady.guestReady : restartReady.hostReady;
  restartButton.disabled = ownReady;
  restartButton.innerHTML = ownReady
    ? '<span aria-hidden="true">✓</span> 已按，等對手'
    : (otherReady
      ? '<span aria-hidden="true">↻</span> 對手已按・確認再來一局'
      : '<span aria-hidden="true">↻</span> 再來一局');
}

function renderScoreboard() {
  if (!state) return;
  const outcome = currentOutcome();
  const blackPairs = state.capturedPairs.black;
  const whitePairs = state.capturedPairs.white;
  const names = namesForColors();
  blackPlayerName.textContent = names.black.name;
  whitePlayerName.textContent = names.white.name;
  blackPlayerRole.textContent = names.black.role;
  whitePlayerRole.textContent = names.white.role;
  blackCaptures.textContent = blackPairs + " 對";
  whiteCaptures.textContent = whitePairs + " 對";
  blackCapturedStones.textContent = "提走 " + (blackPairs * 2) + " 顆豆漿";
  whiteCapturedStones.textContent = "提走 " + (whitePairs * 2) + " 顆黑咖啡";
  blackCard.classList.toggle("active", !outcome.finished && state.currentPlayer === "black");
  whiteCard.classList.toggle("active", !outcome.finished && state.currentPlayer === "white");
  turnBanner.classList.toggle("is-finished", outcome.finished);

  if (mode === "network" && networkSession) {
    const currentIsLocal = state.currentPlayer === networkSession.localColor;
    turnLabel.textContent = outcome.finished
      ? (outcome.draw ? "本局和局" : colorName(outcome.winner) + "獲勝！")
      : "輪到" + (currentIsLocal ? "你" : "對手") + "・" + colorName(state.currentPlayer);
  } else if (outcome.finished) {
    turnLabel.textContent = outcome.draw
      ? "本局和局"
      : colorName(outcome.winner) + "獲勝！";
  } else {
    turnLabel.textContent = "輪到" + colorName(state.currentPlayer);
  }
  turnDot.className = outcome.finished
    ? "turn-dot finish-dot"
    : "turn-dot " + (state.currentPlayer === "black" ? "coffee-stone" : "soy-stone");

  if (outcome.finished) {
    notice.textContent = (outcome.message || (outcome.draw ? "棋盤下滿，和局！" : colorName(outcome.winner) + "獲勝！")) +
      (mode === "network" ? " 雙方都按「再來一局」後會換先手。" : " 按「重開」再來一盤。");
    notice.classList.add("is-result");
  } else {
    notice.classList.remove("is-result");
  }
  roundLabel.textContent = mode === "network"
    ? "線上對戰・第 " + (networkSession?.round || 1) + " 局"
    : "同一台練習";
  updateRestartButton(outcome);
}

function render() {
  renderBoard();
  renderScoreboard();
}

function clearAnimations() {
  ghostTimers.forEach(window.clearTimeout);
  ghostTimers = [];
  ghosts = [];
}

function animateCaptured(stones) {
  if (!stones || !stones.length) return;
  const batch = stones.map((stone, index) => ({ ...stone, id: Date.now() + "-" + index + "-" + Math.random() }));
  ghosts.push(...batch);
  renderBoard();
  const timer = window.setTimeout(() => {
    const ids = new Set(batch.map(ghost => ghost.id));
    ghosts = ghosts.filter(ghost => !ids.has(ghost.id));
    renderBoard();
  }, 460);
  ghostTimers.push(timer);
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2200);
}

function clearRoomQuery() {
  const url = new URL(window.location.href);
  url.search = "";
  window.history.replaceState(null, "", url.pathname + url.hash);
}

function setLobbyForRole(role, code = "") {
  hostRoomDetails.hidden = role !== "host";
  joinRoomDetails.hidden = role !== "guest";
  lobbyTitle.textContent = role === "host" ? "等待對手加入" : "正在加入房間";
  document.querySelector("#joining-room-code").textContent = code;
  lobbyStatus.textContent = role === "host"
    ? "正在建立 PeerJS 房間…"
    : "正在準備連接房間 " + code + "…";
}

function returnHome() {
  if (network) network.close();
  network = null;
  networkRole = null;
  networkSession = null;
  mode = "home";
  state = null;
  outcomeFromHost = null;
  restartReady = { hostReady: false, guestReady: false };
  clearAnimations();
  clearRoomQuery();
  homeNetworkNotice.textContent = "";
  setScreen("home");
}

async function startPractice() {
  if (network) network.close();
  network = null;
  networkRole = null;
  networkSession = null;
  mode = "local";
  outcomeFromHost = null;
  restartReady = { hostReady: false, guestReady: false };
  clearAnimations();
  try {
    await loadRules();
    state = rules.createInitialState();
    setScreen("game");
  } catch {
    showToast("棋局規則載入失敗，請重新整理。");
  }
}

function updateRoomInfo(room) {
  document.querySelector("#room-code-view").textContent = room.code;
  inviteLink.value = network ? network.copyInviteUrl() : "";
  hostRoomDetails.hidden = false;
}

function networkCallbacks() {
  return {
    onStatus(status, detail) {
      if (screenName !== "lobby") return;
      lobbyStatus.textContent = detail || "";
      if (status === "waiting") lobbyTitle.textContent = "等待對手加入";
      if (status === "reconnecting") lobbyTitle.textContent = "正在重新連線";
      if (status === "error") lobbyTitle.textContent = "暫時無法連線";
    },
    onRoom(room) {
      updateRoomInfo(room);
    },
    onConnected(session) {
      networkSession = {
        ...networkSession,
        ...session,
        localNickname: currentNickname,
        hostNickname: session.role === "host" ? currentNickname : session.remoteNickname,
        guestNickname: session.role === "guest" ? currentNickname : session.remoteNickname,
      };
    },
    onState(snapshot) {
      const previousRound = networkSession?.round;
      state = snapshot.state;
      outcomeFromHost = snapshot.outcome || { finished: false, winner: null, draw: false, reasons: [], message: "" };
      networkSession = {
        ...(networkSession || {}),
        role: networkRole,
        hostColor: snapshot.hostColor === "white" ? "white" : "black",
        localColor: networkRole === "host"
          ? (snapshot.hostColor === "white" ? "white" : "black")
          : (snapshot.hostColor === "white" ? "black" : "white"),
        remoteColor: networkRole === "host"
          ? (snapshot.hostColor === "white" ? "black" : "white")
          : (snapshot.hostColor === "white" ? "white" : "black"),
        round: snapshot.round || 1,
        hostNickname: snapshot.hostNickname || networkSession?.hostNickname,
        guestNickname: snapshot.guestNickname || networkSession?.guestNickname,
      };
      if (snapshot.restarted || previousRound !== networkSession.round) {
        restartReady = { hostReady: false, guestReady: false };
      }
      render();
      if (screenName !== "game") setScreen("game");
      if (snapshot.restarted) {
        notice.textContent = "第 " + networkSession.round + " 局開始，黑咖啡先下。";
      } else if (snapshot.captured?.length && !outcomeFromHost.finished) {
        const mover = colorName(state.lastMove?.color);
        notice.textContent = mover + "夾走 " + (snapshot.captured.length / 2) + " 對棋子！";
      } else if (state.lastMove && !outcomeFromHost.finished) {
        notice.textContent = colorName(state.lastMove.color) + "落子完成。";
      }
      if (snapshot.captured?.length) animateCaptured(snapshot.captured);
    },
    onReject(reason) {
      if (screenName === "game") {
        notice.textContent = reason;
        notice.classList.add("is-warning");
        window.setTimeout(() => notice.classList.remove("is-warning"), 500);
      } else {
        lobbyStatus.textContent = reason;
      }
    },
    onRestartStatus(status) {
      restartReady = {
        hostReady: Boolean(status.hostReady),
        guestReady: Boolean(status.guestReady),
      };
      updateRestartButton(currentOutcome());
      if (screenName === "game" && currentOutcome().finished) {
        const ownReady = networkRole === "host" ? restartReady.hostReady : restartReady.guestReady;
        const otherReady = networkRole === "host" ? restartReady.guestReady : restartReady.hostReady;
        notice.textContent = ownReady
          ? "已提出再來一局，等待對手確認。"
          : (otherReady ? "對手已按再來一局，按下按鈕即可同意。" : notice.textContent);
      }
    },
    onOffline(reason) {
      clearAnimations();
      document.querySelector("#offline-detail").textContent = reason || "這一局的棋盤已停止更新。";
      setScreen("offline");
    },
  };
}

function startNetwork(role, code = "") {
  currentNickname = nicknameInput.value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 16) || "棋友";
  homeNetworkNotice.textContent = "";
  mode = "network";
  networkRole = role;
  networkSession = {
    role,
    localNickname: currentNickname,
    hostColor: "black",
    localColor: role === "host" ? "black" : "white",
    remoteColor: role === "host" ? "white" : "black",
    round: 1,
  };
  state = null;
  outcomeFromHost = null;
  restartReady = { hostReady: false, guestReady: false };
  clearAnimations();
  setLobbyForRole(role, code);
  setScreen("lobby");
  if (role === "host") clearRoomQuery();
  network = createNetworkManager(networkCallbacks());
  if (role === "host") {
    network.startHost(currentNickname);
  } else {
    network.startJoin(code, currentNickname);
  }
}

function handleLocalMove(row, col) {
  const result = rules.applyMove(state, row, col);
  if (!result.ok) {
    notice.textContent = result.reason;
    notice.classList.add("is-warning");
    window.setTimeout(() => notice.classList.remove("is-warning"), 450);
    return;
  }
  const mover = colorName(state.currentPlayer);
  state = result.state;
  render();
  if (result.captured.length) {
    notice.textContent = mover + "夾走 " + (result.captured.length / 2) + " 對棋子！";
    animateCaptured(result.captured);
  } else if (!result.outcome.finished) {
    notice.textContent = mover + "落子完成。";
  }
}

document.querySelector("#start-game").addEventListener("click", startPractice);
document.querySelector("#back-home").addEventListener("click", returnHome);
document.querySelector("#lobby-home").addEventListener("click", returnHome);
document.querySelector("#offline-home").addEventListener("click", returnHome);
document.querySelector("#restart-game").addEventListener("click", async () => {
  if (mode === "network") {
    if (network) network.requestRestart();
    return;
  }
  clearAnimations();
  state = rules.createInitialState();
  render();
  notice.textContent = "黑咖啡先下，想辦法連成五子或夾走五對。";
});

document.querySelector("#host-room").addEventListener("click", () => {
  startNetwork("host");
});

function sanitizeRoomInput() {
  roomCodeInput.value = roomCodeInput.value
    .toUpperCase()
    .replace(/[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g, "")
    .slice(0, 4);
}
roomCodeInput.addEventListener("input", sanitizeRoomInput);
document.querySelector("#join-room").addEventListener("click", () => {
  sanitizeRoomInput();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!isRoomCode(code)) {
    homeNetworkNotice.textContent = "請輸入 4 碼代碼（不含 0、O、1、I）。";
    return;
  }
  startNetwork("guest", code);
});

document.querySelector("#copy-invite").addEventListener("click", async () => {
  const value = network?.copyInviteUrl() || inviteLink.value;
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    showToast("邀請連結已複製。");
  } catch {
    inviteLink.focus();
    inviteLink.select();
    showToast("無法自動複製，已選取連結，請手動複製。");
  }
});

boardElement.addEventListener("click", async event => {
  const button = event.target.closest(".intersection");
  if (!button || !state) return;
  const row = Number(button.dataset.row);
  const col = Number(button.dataset.col);
  if (mode === "network") {
    notice.textContent = "落子請求已送出，等待開房方裁判確認。";
    notice.classList.remove("is-warning");
    network?.submitMove(row, col);
    return;
  }
  await loadRules();
  handleLocalMove(row, col);
});

document.querySelectorAll(".source-link").forEach(link => {
  link.addEventListener("click", event => {
    event.preventDefault();
    showToast("原始碼連結網址之後補上。");
  });
});

const roomFromUrl = new URLSearchParams(window.location.search).get("room");
if (roomFromUrl) {
  const code = roomFromUrl.trim().toUpperCase();
  if (isRoomCode(code)) {
    roomCodeInput.value = code;
    startNetwork("guest", code);
  } else {
    homeNetworkNotice.textContent = "邀請連結中的房間代碼格式不正確。";
  }
}
