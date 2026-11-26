# 第 27 題〈夾吃五子棋〉

以早餐店為主題的 13×13 夾吃五子棋，支援「同一台練習」與 PeerJS 雙人連線對戰。

- **遊戲名稱：** 第 27 題〈夾吃五子棋〉
- **作者：** 資通系 李振偉老師
- **GitHub Pages：** https://appjust.github.io/ninuki-renju/
- **原始碼：** https://github.com/APPJust/ninuki-renju
- **棋子：** 黑方是黑咖啡，白方是豆漿
- **PeerJS：** 1.5.5

## 規則

1. 棋盤為 13×13，棋子落在交叉點；黑方先下。
2. 落子後，沿橫、直、斜方向檢查連續四格。若排列為「自己的新子、對方子、對方子、自己的子」，就提走中間兩子；同一步可以從多個方向提子。
3. 自己下在對方兩子中間不會被提。
4. 連成 5 子或以上，或累計提掉對方 5 對（10 子）即獲勝。
5. 棋盤下滿且無人獲勝時為和局。

## 架構

| 檔案 | 負責內容 |
|---|---|
| `index.html` | 首頁、遊戲、等待房間與離線畫面；載入 PeerJS 1.5.5 CDN、樣式與介面程式。 |
| `style.css` | 早餐店視覺、棋盤與黑咖啡／豆漿棋子、手機窄版排版及提子消失動畫。 |
| `ui.js` | 切換同一台練習與連線模式、顯示棋盤/輪次/提子數/訊息；把使用者操作交給規則層或連線層。連線中的加入方不直接載入規則模組。 |
| `game.js` | 純遊戲規則：建立初始狀態、檢查落子、套用落子與提子、判斷勝負/和局；不操作畫面或 DOM。 |
| `net.js` | PeerJS 房間建立與加入、房間代碼、JSON 訊息、心跳/離線/重連、雙方重開確認，以及主控端的裁判流程。 |
| `GAME_SPEC.md` | 規則、連線設計與驗收方式。 |
| `tests/game.test.js` | 遊戲規則測試。 |
| `tests/net.test.js` | 房間代碼格式測試。 |
| `package.json` | Node.js 測試指令（`npm test`）。 |
| `.gitignore` | 排除依賴、建置輸出、環境檔與本機 artifacts。 |
| `.game-project.json` | 此遊戲的本機專案識別資料。 |

### 開房方當裁判

開房時，`net.js` 只在開房方動態載入 `game.js`，並建立唯一初始狀態。加入方點棋盤時，`ui.js` 只送出 `move` 請求，不先改變棋盤，也不執行規則。

開房方收到請求後，確認請求者、回合、座標與落點是否合法，再呼叫 `game.js` 套用落子、檢查夾吃及勝負，最後用 `state` 封包傳送完整棋局狀態。加入方只根據房主傳來的狀態更新畫面；不合法時則收到 `reject` 與中文原因。

房間代碼為四碼大寫英文字母/數字（排除容易混淆的 `0`、`O`、`1`、`I`），PeerJS ID 格式是 `jit1151-27-房間代碼`。PeerJS 伺服器用於訊號媒合；雙方連線建立後，棋局資料透過 WebRTC 資料通道互傳。

連線只交換暱稱、棋盤狀態與連線/回合控制欄位，不傳送學號或真實姓名。

## 連線訊息格式

所有訊息都有 `type` 欄位，以 JSON 字串透過 PeerJS 資料通道傳送。範例中的時間戳為毫秒。

| type | 誰送給誰 | 欄位 | 例子 |
|---|---|---|---|
| `hello` | 雙方互送 | `role`、`nickname`、`round`；開房方另含 `hostColor` | 加入方：`{"type":"hello","role":"guest","nickname":"豆漿","round":1}`<br>開房方：`{"type":"hello","role":"host","nickname":"黑咖啡","hostColor":"black","round":1}` |
| `move` | 加入方 → 開房方 | `actor`（固定為 `"guest"`）、`row`、`col`（0–12） | `{"type":"move","actor":"guest","row":6,"col":7}` |
| `state` | 開房方 → 加入方 | `state`（`board`、`currentPlayer`、`capturedPairs`、`moveCount`、`lastMove`）、`outcome`（`finished`、`winner`、`draw`、`reasons`、`message`）、`captured`（`{row,col,color}` 陣列）、`round`、`hostColor`、`hostNickname`、`guestNickname`、`restarted` | 完整封包範例見下方。 |
| `reject` | 開房方 → 加入方 | `reason`（中文原因） | `{"type":"reject","reason":"現在還不是你的回合。"}` |
| `restart` | 加入方 → 開房方；開房方 → 加入方 | 加入方請求含 `ready`；開房方狀態含 `hostReady`、`guestReady` | 請求：`{"type":"restart","ready":true}`<br>狀態：`{"type":"restart","hostReady":true,"guestReady":false}` |
| `ping` | 雙方互送 | `at`（送出時間，Unix 毫秒） | `{"type":"ping","at":1760000000000}` |
| `pong` | 收到 ping 的一方 → 送出 ping 的一方 | `at`（原樣回傳 ping 的時間） | `{"type":"pong","at":1760000000000}` |
| `bye` | 離開的一方 → 對手 | 無其他欄位 | `{"type":"bye"}` |

`hello`、`move`、`restart`、`state`、`reject` 與 `bye` 會印在主控台方便除錯；`ping` / `pong` 不列印。每 2 秒互送一次心跳，超過 6 秒未收到訊息即顯示對手離線。

### `state` 封包範例

這是開局時實際格式的完整例子；`board` 是 13×13 陣列，`null` 代表空點，`black` / `white` 代表棋子。

```json
{
  "type": "state",
  "state": {
    "board": [
      [
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ],
      [
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ],
      [
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ],
      [
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ],
      [
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ],
      [
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ],
      [
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ],
      [
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ],
      [
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ],
      [
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ],
      [
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ],
      [
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ],
      [
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ]
    ],
    "currentPlayer": "black",
    "capturedPairs": {
      "black": 0,
      "white": 0
    },
    "moveCount": 0,
    "lastMove": null
  },
  "outcome": {
    "finished": false,
    "winner": null,
    "draw": false,
    "reasons": [],
    "message": ""
  },
  "captured": [],
  "round": 1,
  "hostColor": "black",
  "hostNickname": "黑咖啡",
  "guestNickname": "豆漿",
  "restarted": false
}
```

## 本機測試

需要 Node.js。於專案根目錄執行：

```sh
npm test
```

連線測試可在同一台電腦開兩個瀏覽器視窗：第一個按「開房」並複製邀請連結；第二個打開連結即可自動加入。連線需要網路存取 PeerJS CDN 與訊號伺服器。

