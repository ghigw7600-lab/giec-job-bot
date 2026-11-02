// 텔레그램이 메시지를 이 주소로 보내줍니다 (웹훅)
import { webhookCallback } from "grammy";
import { bot } from "../src/bot.js";

export default webhookCallback(bot, "https", {
  secretToken: process.env.WEBHOOK_SECRET, // 텔레그램이 보낸 요청인지 확인
  timeoutMilliseconds: 55_000, // 공고를 여러 명에게 보낼 때 시간이 걸림
  onTimeout: "return",
});
