// 처음 한 번만: 브라우저로 https://<봇 주소>/api/setup?key=<WEBHOOK_SECRET> 열기
//  → 웹훅 연결 + 봇 소개문·명령어 설정 (컴퓨터에 아무것도 설치할 필요 없음)
import { bot, ALLOWED_UPDATES } from "../src/bot.js";

export default async function handler(req, res) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || req.query?.key !== secret) return res.status(401).send("열쇠(key)가 맞지 않아요.");
  if (!process.env.BOT_TOKEN) return res.status(500).send("Vercel 환경변수에 BOT_TOKEN 이 없어요.");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const url = `https://${host}/api/webhook`;
  const api = bot.api;
  const done = [];
  try {
    await api.setWebhook(url, { secret_token: secret, allowed_updates: ALLOWED_UPDATES, drop_pending_updates: true });
    done.push(`✅ 웹훅 연결: ${url}`);
    await api.setMyDescription(
      "💼 GIEC JOB — Koreyadagi talabalar uchun ish.\nMa'lumotlaringizni qoldiring, menejerimiz siz bilan bog'lanadi.\n\n💼 Работа для студентов в Корее. Оставьте данные — менеджер свяжется с вами."
    );
    await api.setMyShortDescription("💼 GIEC JOB · Koreyada talabalar uchun ish");
    await api.setMyCommands([{ command: "start", description: "Boshlash / Начать" }]);
    done.push("✅ 봇 소개문·명령어 설정");
    const admins = (process.env.ADMIN_IDS || "8512697683").split(",").map((s) => s.trim()).filter(Boolean);
    for (const id of admins) {
      await api
        .setMyCommands(
          [
            { command: "joinlink", description: "채널 환영 링크" },
            { command: "pinpost", description: "채널에 정보 남기기 버튼 글 고정" },
            { command: "export", description: "지원자 엑셀(CSV)" },
            { command: "help", description: "도움말" },
          ],
          { scope: { type: "chat", chat_id: Number(id) } }
        )
        .then(() => done.push(`✅ 관리자 메뉴 (${id})`))
        .catch((e) => done.push(`⚠️ 관리자 메뉴 실패 (${id}): 그 사람이 봇에 /start 를 먼저 눌러야 해요 — ${e.description ?? e.message}`));
    }
    const me = await api.getMe();
    done.push(`\n완료! https://t.me/${me.username}`);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send(done.join("\n"));
  } catch (e) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(500).send([...done, `⚠️ 실패: ${e.description ?? e.message}`].join("\n"));
  }
}
