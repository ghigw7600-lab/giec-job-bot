// 텔레그램이 메시지를 이 주소로 보내줍니다 (웹훅)
import { webhookCallback } from "grammy";
import { bot } from "../src/bot.js";

export default webhookCallback(bot, "https", {
  secretToken: process.env.WEBHOOK_SECRET, // 텔레그램이 보낸 요청인지 확인
  timeoutMilliseconds: 25_000,
  onTimeout: "return",
});
