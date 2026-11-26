import test from "node:test";
import assert from "node:assert/strict";
import { isRoomCode, makeRoomCode } from "../net.js";

test("房間代碼為四碼大寫英文數字，排除 0、O、1、I", () => {
  for (let index = 0; index < 100; index += 1) {
    const code = makeRoomCode();
    assert.match(code, /^[A-Z2-9]{4}$/);
    assert.equal(/[0O1I]/.test(code), false);
    assert.equal(isRoomCode(code), true);
  }
});

test("接受小寫輸入的正規化代碼，拒絕格式錯誤或容易看錯的代碼", () => {
  assert.equal(isRoomCode("ab23"), true);
  assert.equal(isRoomCode("AB0I"), false);
  assert.equal(isRoomCode("ABC"), false);
  assert.equal(isRoomCode("ABCDE"), false);
});
