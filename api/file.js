// ═════════════════════════════════════════════════════════════
//  🖼 이미 올라간 공고 사진 작은 그림 (GET /api/file?id=<file_id>&i=<initData>) — 11-05
//   공고 수정 화면에서 지금 붙어 있는 사진을 보여 주려고. 관리자 확인 후 텔레그램에서 대신 가져옴
//   (봇 토큰이 들어간 텔레그램 파일 주소는 미니앱에 절대 안 보냄)
// ═════════════════════════════════════════════════════════════
import { bot, isAdmin, refreshChanAdmins } from "../src/bot.js";
import { verify } from "./mini.js";

export default async function handler(req, res) {
  const user = verify(String(req.query.i ?? ""));
  if (!user) return res.status(401).end();
  await refreshChanAdmins(bot.api).catch(() => {});
  if (!isAdmin(user.id)) return res.status(403).end();
  const id = String(req.query.id ?? "");
  if (!id || id.length > 300) return res.status(400).end();
  try {
    const f = await bot.api.getFile(id);
    if (!f.file_path) return res.status(404).end();
    const r = await fetch(`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${f.file_path}`);
    if (!r.ok) return res.status(502).end();
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=86400");
    return res.status(200).send(buf);
  } catch {
    return res.status(404).end();
  }
}
