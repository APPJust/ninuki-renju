const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;
const PEER_PREFIX = "jit1151-27-";

export function makeRoomCode(random = Math.random) {
  let code = "";
  for (let index = 0; index < 4; index += 1) {
    code += ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length)];
  }
  return code;
}

export function isRoomCode(value) {
  return ROOM_PATTERN.test(String(value ?? "").trim().toUpperCase());
}

function cleanNickname(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 16) || "棋友";
}

function otherColor(color) {
  return color === "black" ? "white" : "black";
}

export function createNetworkManager(callbacks = {}) {
  let role = null;
  let peer = null;
  let connection = null;
  let roomCode = null;
  let hostPeerId = null;
  let nickname = "棋友";
  let remoteNickname = "對手";
  let hostColor = "black";
  let round = 1;
  let rules = null;
  let gameState = null;
  let hostRestartReady = false;
  let guestRestartReady = false;
  let lastMessageAt = 0;
  let heartbeatTimer = null;
  let silenceTimer = null;
  let reconnectTimer = null;
  let peerGeneration = 0;
  let hostAttempts = 0;
  let hostRoomWasOpened = false;
  let isOnline = false;
  let offlineShown = false;
  let disposed = false;
  let beforeUnloadHandler = null;
  let pageHideHandler = null;
  let byeSent = false;

  const reportStatus = (status, detail = "") => callbacks.onStatus?.(status, detail);

  function logMessage(direction, message) {
    if (message.type === "ping" || message.type === "pong") return;
    console.log("[連線] " + direction, message);
  }

  function sendMessage(message) {
    if (!connection?.open || disposed) return false;
    const packet = { ...message, type: message.type };
    try {
      connection.send(JSON.stringify(packet));
      logMessage("送出", packet);
      return true;
    } catch (error) {
      console.warn("[連線] 訊息送出失敗", error);
      return false;
    }
  }

  function clearHeartbeat() {
    window.clearInterval(heartbeatTimer);
    window.clearInterval(silenceTimer);
    heartbeatTimer = null;
    silenceTimer = null;
  }

  function startHeartbeat() {
    clearHeartbeat();
    lastMessageAt = Date.now();
    heartbeatTimer = window.setInterval(() => {
      if (connection?.open) sendMessage({ type: "ping", at: Date.now() });
    }, 2000);
    silenceTimer = window.setInterval(() => {
      if (connection?.open && Date.now() - lastMessageAt > 6000) {
        endConnection("超過 6 秒沒有收到對手訊息。");
      }
    }, 500);
  }

  function registerBeforeUnload() {
    byeSent = false;
    const sendBye = () => {
      if (byeSent) return;
      byeSent = true;
      if (connection?.open) sendMessage({ type: "bye" });
    };
    beforeUnloadHandler = sendBye;
    pageHideHandler = sendBye;
    window.addEventListener("beforeunload", beforeUnloadHandler);
    window.addEventListener("pagehide", pageHideHandler);
  }

  function unregisterBeforeUnload() {
    if (beforeUnloadHandler) window.removeEventListener("beforeunload", beforeUnloadHandler);
    if (pageHideHandler) window.removeEventListener("pagehide", pageHideHandler);
    beforeUnloadHandler = null;
    pageHideHandler = null;
  }

  function sendHello() {
    sendMessage({
      type: "hello",
      role,
      nickname,
      hostColor: role === "host" ? hostColor : undefined,
      round,
    });
  }

  function getSnapshot(captured = [], restarted = false) {
    return {
      type: "state",
      state: gameState,
      outcome: rules.getGameResult(gameState),
      captured,
      round,
      hostColor,
      hostNickname: nickname,
      guestNickname: remoteNickname,
      restarted,
    };
  }

  function publishState(captured = [], restarted = false) {
    const snapshot = getSnapshot(captured, restarted);
    callbacks.onState?.(snapshot);
    if (connection?.open) sendMessage(snapshot);
  }

  function publishRestartStatus() {
    const message = {
      type: "restart",
      hostReady: hostRestartReady,
      guestReady: guestRestartReady,
    };
    callbacks.onRestartStatus?.(message);
    if (connection?.open) sendMessage(message);
  }

  function beginNextRound() {
    if (!rules || !hostRestartReady || !guestRestartReady) return;
    round += 1;
    hostColor = otherColor(hostColor);
    hostRestartReady = false;
    guestRestartReady = false;
    gameState = rules.createInitialState();
    publishRestartStatus();
    publishState([], true);
  }

  function sendReject(reason) {
    callbacks.onReject?.(reason);
    sendMessage({ type: "reject", reason });
  }

  function commitMove(row, col, actorColor) {
    if (!rules || !gameState) {
      sendReject("棋局尚未準備好，請稍後再試。");
      return;
    }
    if (gameState.currentPlayer !== actorColor) {
      sendReject(actorColor === hostColor
        ? "現在輪到對手下棋。"
        : "現在還不是你的回合。");
      return;
    }
    const result = rules.applyMove(gameState, row, col);
    if (!result.ok) {
      sendReject(result.reason);
      return;
    }
    gameState = result.state;
    publishState(result.captured, false);
  }

  function handleRestartRequest() {
    if (!rules || !gameState || !rules.getGameResult(gameState).finished) {
      sendReject("本局尚未結束，暫時不能再來一局。");
      return;
    }
    guestRestartReady = true;
    publishRestartStatus();
    if (hostRestartReady && guestRestartReady) beginNextRound();
  }

  function handleData(raw) {
    let message;
    try {
      message = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      console.warn("[連線] 忽略無法解析的 JSON 訊息");
      return;
    }
    if (!message || typeof message !== "object" || typeof message.type !== "string") {
      console.warn("[連線] 忽略缺少 type 的訊息");
      return;
    }

    lastMessageAt = Date.now();
    if (message.type === "ping") {
      sendMessage({ type: "pong", at: message.at });
      return;
    }
    if (message.type === "pong") return;
    logMessage("收到", message);

    if (message.type === "hello") {
      remoteNickname = cleanNickname(message.nickname);
      if (role === "host") {
        if (message.role !== "guest") return;
        isOnline = true;
        callbacks.onConnected?.({
          role,
          nickname,
          remoteNickname,
          localColor: hostColor,
          remoteColor: otherColor(hostColor),
          hostColor,
          round,
        });
        reportStatus("online", "對手已加入，棋局開始。");
        publishState([], false);
      } else if (role === "guest") {
        if (message.role !== "host") return;
        hostColor = message.hostColor === "white" ? "white" : "black";
        round = Number.isInteger(message.round) && message.round > 0 ? message.round : 1;
        callbacks.onConnected?.({
          role,
          nickname,
          remoteNickname,
          localColor: otherColor(hostColor),
          remoteColor: hostColor,
          hostColor,
          round,
        });
        reportStatus("online", "已連上開房方，等待棋局狀態。");
      }
      return;
    }

    if (message.type === "move" && role === "host") {
      if (message.actor !== "guest") {
        sendReject("這個落子請求無效。");
        return;
      }
      commitMove(message.row, message.col, otherColor(hostColor));
      return;
    }

    if (message.type === "state" && role === "guest") {
      if (!message.state || !Array.isArray(message.state.board)) return;
      hostColor = message.hostColor === "white" ? "white" : "black";
      round = Number.isInteger(message.round) && message.round > 0 ? message.round : round;
      callbacks.onState?.(message);
      return;
    }

    if (message.type === "reject" && role === "guest") {
      callbacks.onReject?.(String(message.reason || "這一步不合法。"));
      return;
    }

    if (message.type === "restart") {
      if (role === "host") {
        handleRestartRequest();
      } else if (role === "guest") {
        hostRestartReady = Boolean(message.hostReady);
        guestRestartReady = Boolean(message.guestReady);
        callbacks.onRestartStatus?.({
          hostReady: hostRestartReady,
          guestReady: guestRestartReady,
        });
      }
      return;
    }

    if (message.type === "bye") {
      endConnection("對手已離線。");
    }
  }

  function stopPeer() {
    const oldPeer = peer;
    peer = null;
    peerGeneration += 1;
    if (oldPeer && !oldPeer.destroyed) {
      try { oldPeer.destroy(); } catch {}
    }
  }

  function endConnection(reason) {
    if (offlineShown || disposed) return;
    offlineShown = true;
    isOnline = false;
    clearHeartbeat();
    if (connection) {
      const oldConnection = connection;
      connection = null;
      try { oldConnection.close(); } catch {}
    }
    stopPeer();
    reportStatus("offline", reason);
    callbacks.onOffline?.(reason);
  }

  function failBeforeMatch(message) {
    clearHeartbeat();
    if (connection) {
      const oldConnection = connection;
      connection = null;
      try { oldConnection.close(); } catch {}
    }
    reportStatus("error", message);
  }

  function handleConnectionError(error, attachedConnection) {
    if (attachedConnection !== connection || offlineShown || disposed) return;
    const type = error?.type || "";
    if (role === "guest" && type === "peer-unavailable") {
      connection = null;
      failBeforeMatch("找不到這個房間，請確認代碼或邀請連結。");
      return;
    }
    if (!isOnline) {
      failBeforeMatch("連線無法建立，請回首頁後再試一次。");
      return;
    }
    endConnection("對手連線已中斷。");
  }

  function attachConnection(nextConnection) {
    connection = nextConnection;
    const attachedConnection = nextConnection;
    attachedConnection.on("open", () => {
      if (attachedConnection !== connection || disposed || offlineShown) return;
      startHeartbeat();
      sendHello();
      reportStatus("connecting", "正在交換暱稱與棋局資訊…");
    });
    attachedConnection.on("data", raw => {
      if (attachedConnection === connection && !offlineShown && !disposed) handleData(raw);
    });
    attachedConnection.on("close", () => {
      if (attachedConnection !== connection || disposed || offlineShown) return;
      if (isOnline) endConnection("對手已離線。");
      else if (role === "guest") failBeforeMatch("房間連線已關閉，請確認開房方仍在線。");
    });
    attachedConnection.on("error", error => handleConnectionError(error, attachedConnection));
  }

  function scheduleReconnect(targetPeer, generation) {
    if (reconnectTimer || disposed || offlineShown) return;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      if (peer !== targetPeer || peerGeneration !== generation || disposed || offlineShown) return;
      if (isOnline && connection?.open) return;
      if (targetPeer.disconnected) {
        try {
          targetPeer.reconnect();
        } catch {
          scheduleReconnect(targetPeer, generation);
        }
      }
    }, 1200);
  }

  function peerError(error, targetPeer, generation, candidateCode = null) {
    if (peer !== targetPeer || peerGeneration !== generation || disposed || offlineShown) return;
    const type = error?.type || "";
    if (role === "host" && type === "unavailable-id" && !isOnline) {
      console.info("[連線] 房間代碼重複，自動改用另一組代碼。");
      hostAttempts += 1;
      const oldPeer = peer;
      peer = null;
      peerGeneration += 1;
      try { oldPeer.destroy(); } catch {}
      if (hostAttempts < 20) createHostPeer();
      else reportStatus("error", "暫時無法取得房間代碼，請再試一次。");
      return;
    }

    if (type === "network" || type === "disconnected") {
      if (connection?.open || isOnline) {
        console.info("[連線] PeerJS 訊號伺服器暫時中斷；既有棋局資料通道繼續使用。", type);
        return;
      }
      console.info("[連線] PeerJS 訊號伺服器中斷，等待自動重連。", type);
      reportStatus("reconnecting", "訊號暫時中斷，正在自動重新連線…");
      scheduleReconnect(targetPeer, generation);
      return;
    }

    if (type === "unavailable-id" && role === "host") return;
    if (role === "guest" && type === "peer-unavailable") {
      failBeforeMatch("找不到這個房間，請確認代碼或邀請連結。");
      return;
    }
    if (connection?.open || isOnline) {
      console.info("[連線] PeerJS 訊號錯誤不影響已建立的棋局資料通道。", type || error);
      return;
    }
    console.warn("[連線] PeerJS 連線錯誤", error);
    reportStatus("error", candidateCode
      ? "開房失敗，請檢查網路後再試一次。"
      : "連線失敗，請確認網路或房間代碼。");
  }

  function createHostPeer() {
    if (disposed || offlineShown) return;
    if (typeof window.Peer !== "function") {
      reportStatus("error", "PeerJS 載入失敗，請確認網路後重新整理。");
      return;
    }
    const candidateCode = makeRoomCode();
    const candidateId = PEER_PREFIX + candidateCode;
    const generation = ++peerGeneration;
    let candidatePeer;
    try {
      candidatePeer = new window.Peer(candidateId);
    } catch {
      reportStatus("error", "PeerJS 無法啟動，請重新整理後再試。");
      return;
    }
    peer = candidatePeer;
    candidatePeer.on("open", () => {
      if (peer !== candidatePeer || peerGeneration !== generation || disposed || offlineShown) return;
      roomCode = candidateCode;
      hostPeerId = candidateId;
      hostRoomWasOpened = true;
      callbacks.onRoom?.({ code: roomCode, peerId: hostPeerId });
      reportStatus("waiting", "房間已開好，等待對手加入。");
    });
    candidatePeer.on("connection", incoming => {
      if (peer !== candidatePeer || peerGeneration !== generation || disposed || offlineShown) {
        incoming.close();
        return;
      }
      if (connection && connection !== incoming) {
        incoming.on("open", () => {
          const rejectPacket = JSON.stringify({ type: "reject", reason: "房間已有人，請使用其他房間。" });
          try { incoming.send(rejectPacket); } catch {}
          console.log("[連線] 送出", { type: "reject", reason: "房間已有人，請使用其他房間。" });
          incoming.close();
        });
        return;
      }
      attachConnection(incoming);
    });
    candidatePeer.on("disconnected", () => {
      if (peer !== candidatePeer || peerGeneration !== generation || disposed || offlineShown) return;
      if (connection?.open || isOnline) {
        console.info("[連線] PeerJS 訊號伺服器已斷線；現有對戰不中斷。");
        return;
      }
      console.info("[連線] 等候對手時 PeerJS 訊號中斷，正在重連。");
      reportStatus("reconnecting", "訊號暫時中斷，正在自動重新連線…");
      scheduleReconnect(candidatePeer, generation);
    });
    candidatePeer.on("error", error => peerError(error, candidatePeer, generation, candidateCode));
  }

  function createGuestPeer() {
    if (disposed || offlineShown) return;
    if (typeof window.Peer !== "function") {
      reportStatus("error", "PeerJS 載入失敗，請確認網路後重新整理。");
      return;
    }
    const generation = ++peerGeneration;
    let candidatePeer;
    try {
      candidatePeer = new window.Peer();
    } catch {
      reportStatus("error", "PeerJS 無法啟動，請重新整理後再試。");
      return;
    }
    peer = candidatePeer;
    candidatePeer.on("open", () => {
      if (peer !== candidatePeer || peerGeneration !== generation || disposed || offlineShown) return;
      if (connection && !connection.open) {
        try { connection.close(); } catch {}
        connection = null;
      }
      if (!connection) {
        const nextConnection = candidatePeer.connect(hostPeerId, { reliable: true, serialization: "json" });
        attachConnection(nextConnection);
      }
      reportStatus("connecting", "正在連接房間 " + roomCode + "…");
    });
    candidatePeer.on("disconnected", () => {
      if (peer !== candidatePeer || peerGeneration !== generation || disposed || offlineShown) return;
      if (connection?.open || isOnline) {
        console.info("[連線] PeerJS 訊號伺服器已斷線；現有對戰不中斷。");
        return;
      }
      console.info("[連線] 加入房間時 PeerJS 訊號中斷，正在重連。");
      reportStatus("reconnecting", "訊號暫時中斷，正在自動重新連線…");
      scheduleReconnect(candidatePeer, generation);
    });
    candidatePeer.on("error", error => peerError(error, candidatePeer, generation));
  }

  return {
    async startHost(playerNickname) {
      role = "host";
      nickname = cleanNickname(playerNickname);
      hostColor = "black";
      round = 1;
      hostAttempts = 0;
      offlineShown = false;
      disposed = false;
      hostRestartReady = false;
      guestRestartReady = false;
      try {
        rules = await import("./game.js");
        gameState = rules.createInitialState();
      } catch {
        reportStatus("error", "棋局規則載入失敗，請重新整理。");
        return;
      }
      registerBeforeUnload();
      reportStatus("starting", "正在建立 PeerJS 房間…");
      createHostPeer();
    },

    startJoin(code, playerNickname) {
      role = "guest";
      roomCode = String(code ?? "").trim().toUpperCase();
      hostPeerId = PEER_PREFIX + roomCode;
      nickname = cleanNickname(playerNickname);
      hostColor = "black";
      round = 1;
      offlineShown = false;
      disposed = false;
      isOnline = false;
      registerBeforeUnload();
      reportStatus("connecting", "正在準備加入房間 " + roomCode + "…");
      createGuestPeer();
    },

    submitMove(row, col) {
      if (role === "guest") {
        const sent = sendMessage({ type: "move", actor: "guest", row, col });
        if (!sent) callbacks.onReject?.("連線尚未就緒，落子沒有送出。");
        return;
      }
      if (role === "host") commitMove(row, col, hostColor);
    },

    requestRestart() {
      if (role === "guest") {
        guestRestartReady = true;
        callbacks.onRestartStatus?.({ hostReady: hostRestartReady, guestReady: true });
        if (!sendMessage({ type: "restart", ready: true })) {
          guestRestartReady = false;
          callbacks.onReject?.("連線中斷，無法送出再來一局的確認。");
        }
        return;
      }
      if (role !== "host" || !rules || !rules.getGameResult(gameState).finished) {
        callbacks.onReject?.("本局尚未結束，暫時不能再來一局。");
        return;
      }
      hostRestartReady = true;
      publishRestartStatus();
      if (hostRestartReady && guestRestartReady) beginNextRound();
    },

    copyInviteUrl() {
      if (!roomCode) return "";
      const invite = new URL(window.location.href);
      invite.search = "";
      invite.hash = "";
      invite.searchParams.set("room", roomCode);
      return invite.toString();
    },

    close() {
      if (disposed) return;
      if (connection?.open) sendMessage({ type: "bye" });
      disposed = true;
      clearHeartbeat();
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
      unregisterBeforeUnload();
      const oldConnection = connection;
      connection = null;
      if (oldConnection) {
        try { oldConnection.close(); } catch {}
      }
      stopPeer();
      isOnline = false;
    },
  };
}
