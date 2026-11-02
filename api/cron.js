// 정기 확인 (Vercel Cron 이 하루 두 번 부름: 한국 시간 10:05 · 20:05)
//  - ✅ 출근 확인 묻기 (일한 날 저녁 · 답 없으면 다음 날 아침)
//  - ▶️ 이어서 하기 알림 · 그룹 임시 안내 지우기
//  봇에 메시지가 오갈 때도 10분마다 같은 확인을 함 — 이건 조용한 날을 위한 안전장치
import { bot, runReminders } from "../src/bot.js";

export default async function handler(req, res) {
  const ua = String(req.headers["user-agent"] ?? "");
  const ok = ua.includes("vercel-cron") || (process.env.WEBHOOK_SECRET && req.query?.key === process.env.WEBHOOK_SECRET);
  if (!ok) return res.status(401).json({ ok: false });
  try {
    const reminded = await runReminders(bot.api); // 출근 확인 묻기도 이 안에서 함
    return res.status(200).json({ ok: true, reminded });
  } catch (e) {
    console.error("정기 확인 실패:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
