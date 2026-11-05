// ═════════════════════════════════════════════════════════════
//  📷 공고 사진·영상 올리기 (POST /api/upload) — 관리 미니앱 새 공고에서 공고마다 붙임 (11-05)
//   본문 = 파일 그대로(사진은 미니앱이 줄여서 보냄), 머리글 x-init-data(텔레그램 확인)·x-kind(photo|video)
//   → 봇이 올린 사람 대화에 조용히 한 번 보내서 텔레그램 파일 번호(file_id)를 받고, 그 메시지는 바로 지움
//   Vercel 한 번 요청 한도(약 4.5MB) 때문에 큰 영상은 봇 대화로 보내서 붙이는 길을 같이 둠
// ═════════════════════════════════════════════════════════════
import { InputFile } from "grammy";
import { bot, isAdmin, refreshChanAdmins } from "../src/bot.js";
import { verify } from "./mini.js";

export const config = { api: { bodyParser: false } };

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const user = verify(req.headers["x-init-data"]);
  if (!user) return res.status(401).json({ error: "텔레그램 안에서 열어 주세요" });
  await refreshChanAdmins(bot.api).catch(() => {});
  if (!isAdmin(user.id)) return res.status(403).json({ error: "권한이 없어요" });
  const kind = req.headers["x-kind"] === "video" ? "video" : "photo";
  try {
    const buf = await readBody(req);
    if (!buf.length) return res.status(400).json({ error: "파일이 비어 있어요" });
    const file = new InputFile(buf, kind === "video" ? "video.mp4" : "photo.jpg");
    const opts = { disable_notification: true };
    const msg = kind === "video" ? await bot.api.sendVideo(user.id, file, { ...opts, supports_streaming: true }) : await bot.api.sendPhoto(user.id, file, opts);
    const id = kind === "video" ? msg.video?.file_id ?? msg.document?.file_id : msg.photo?.at(-1)?.file_id;
    await bot.api.deleteMessage(user.id, msg.message_id).catch(() => {});
    if (!id) return res.status(500).json({ error: "텔레그램이 파일을 못 받았어요" });
    return res.status(200).json({ ok: true, item: { type: kind, id } });
  } catch (e) {
    console.error("업로드 실패:", e);
    return res.status(500).json({ error: e.description ?? e.message });
  }
}
