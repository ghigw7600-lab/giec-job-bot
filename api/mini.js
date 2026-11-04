// ═════════════════════════════════════════════════════════════
//  미니앱 서버 (POST /api/mini)
//   - 🛠 관리 미니앱 (public/admin) : 혜승·관리자만 (ADMIN_IDS)
//   - 💼 학생 공고판 (public/jobs)  : 누구나 (텔레그램 안에서 열 때만)
//  요청마다 텔레그램이 준 initData 를 봇 토큰으로 확인 → 누가 열었는지 믿을 수 있음
// ═════════════════════════════════════════════════════════════
import crypto from "node:crypto";
import { kv } from "../src/storage.js";
import {
  bot,
  isAdmin,
  applyJob,
  unapplyJob,
  closeJob,
  reopenJob,
  repostJob,
  setAttendance,
  jobApplicants,
  sendJobOut,
  findStudents,
  createJobRecord,
  todayISO,
  jobMeta,
  addNoShow,
  removeManualNoShow,
  cancelAsNoShow,
} from "../src/bot.js";
import { tx, langOf, KO, langName } from "../src/text.js";

// ── 텔레그램 initData 확인 ──
function verify(initData) {
  if (!initData || !process.env.BOT_TOKEN) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(process.env.BOT_TOKEN).digest();
  const calc = crypto.createHmac("sha256", secret).update(check).digest("hex");
  if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  const authDate = Number(params.get("auth_date") ?? 0) * 1000;
  if (Date.now() - authDate > 7 * 24 * 3600 * 1000) return null; // 너무 오래된 열기 정보
  try {
    return JSON.parse(params.get("user") ?? "null");
  } catch {
    return null;
  }
}

const first = (job) => (job.text ?? job.caption ?? "").split("\n")[0].slice(0, 60);
const allJobs = async () => {
  const ids = (await kv.smembers("jobs")) ?? [];
  return (await kv.mget(ids.map((id) => `job:${id}`))).filter(Boolean).sort((a, b) => b.id - a.id);
};
const allStudents = async () => {
  const ids = (await kv.smembers("apps")) ?? [];
  return (await kv.mget(ids.map((id) => `app:${id}`))).filter((a) => a && !a.test && !isAdmin(a.id));
};
const studentView = (a) => ({
  id: a.id,
  name: a.name,
  age: a.age,
  gender: KO.gender[a.gender] ?? null,
  phone: a.phone ?? null,
  school: a.school,
  topik: KO.topik[a.topik] ?? "-",
  topikN: a.topik ?? 0,
  ielts: KO.ielts[a.ielts] ?? "-",
  car: a.car === 0,
  days: (a.days ?? []).map((i) => KO.days[i]),
  status: a.status ?? "new",
  guest: !!a.guest,
  lang: langName(a.lang),
  tgName: a.tgName,
  username: a.username ?? null,
  workOk: a.workOk ?? 0,
  workNo: a.workNo ?? 0,
  hist: a.hist ?? [],
  note: a.note ?? "",
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
});
async function jobView(job) {
  const ids = (await kv.smembers(`jobapps:${job.id}`)) ?? [];
  const att = job.att ?? {};
  return {
    id: job.id,
    kind: job.kind,
    dateLabel: job.dateLabel,
    date: job.date,
    title: first(job),
    text: job.text ?? job.caption ?? "",
    slots: job.slots,
    applied: ids.length,
    closed: !!job.closed,
    at: job.at,
    where: job.where ?? null,
    inGroup: !!job.group,
    attOk: Object.values(att).filter((r) => r === "ok").length,
    attNo: Object.values(att).filter((r) => r === "no").length,
    repostOf: job.repostOf ?? null,
  };
}

let username = process.env.BOT_USERNAME || null;
async function botName() {
  if (!username) {
    await bot.init().catch(() => {});
    username = bot.botInfo?.username ?? "GIEC_JOB_bot";
  }
  return username;
}

// ═════════════ 관리자 ═════════════
const ADMIN = {
  async overview() {
    const jobs = await Promise.all((await allJobs()).slice(0, 200).map(jobView));
    const students = (await allStudents()).map(studentView).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const week = jobs.filter((j) => j.at > weekAgo);
    const slotSum = week.reduce((s, j) => s + (j.slots ?? 0), 0);
    const filled = week.reduce((s, j) => s + Math.min(j.applied, j.slots ?? j.applied), 0);
    return {
      jobs,
      students,
      stats: {
        students: students.length,
        newStudents: students.filter((s) => s.status === "new").length,
        weekJobs: week.length,
        weekApplies: week.reduce((s, j) => s + j.applied, 0),
        fillRate: slotSum ? Math.round((filled / slotSum) * 100) : null,
        weekNoShow: week.reduce((s, j) => s + j.attNo, 0),
        flaky: students.filter((s) => s.workNo >= 2).sort((a, b) => b.workNo - a.workNo).slice(0, 10),
        today: todayISO(),
      },
    };
  },
  async job({ id }) {
    const job = await kv.get(`job:${id}`);
    if (!job) throw new Error("공고를 찾을 수 없어요");
    const apps = await jobApplicants(id);
    const times = await kv.mget(apps.map((a) => `jobapp:${id}:${a.id}`));
    return {
      job: await jobView(job),
      applicants: apps.map((a, i) => ({ ...studentView(a), appliedAt: times[i]?.at ?? null, att: job.att?.[a.id] ?? null })),
    };
  },
  async unapply({ id, uid }) {
    return unapplyJob(bot.api, id, uid, await botName());
  },
  // 🚫 직전 취소 = 빵꾸 + 자리 다시 열기
  async nocancel({ id, uid }) {
    return cancelAsNoShow(bot.api, id, uid, await botName());
  },
  // ❌ 빵꾸 직접 추가 / 지우기 (학생 카드)
  async noshow({ uid, note }) {
    await addNoShow(uid, note, this.who);
    return { ok: true };
  },
  // 🗑 학생 기록 지우기 (혜승 요청 11-04: 카드 안에서 한 명 / 학생 목록에서 골라서 여러 명)
  async del({ uids }) {
    const list = [...new Set((Array.isArray(uids) ? uids : [uids]).map(Number).filter(Boolean))].slice(0, 500);
    for (const id of list) {
      await kv.del(`app:${id}`);
      await kv.srem("apps", id);
      await kv.del(`state:${id}`);
      await kv.srem("pending", id);
    }
    return { ok: true, n: list.length };
  },
  async noshowDel({ uid, at }) {
    await removeManualNoShow(uid, at);
    return { ok: true };
  },
  async close({ id }) {
    const job = await kv.get(`job:${id}`);
    if (!job) throw new Error("공고를 찾을 수 없어요");
    await closeJob(bot.api, job);
    return { ok: true };
  },
  async reopen({ id }) {
    const job = await kv.get(`job:${id}`);
    if (!job) throw new Error("공고를 찾을 수 없어요");
    await reopenJob(bot.api, job, await botName());
    return { ok: true };
  },
  async repost({ id, slots }) {
    const old = await kv.get(`job:${id}`);
    if (!old) throw new Error("공고를 찾을 수 없어요");
    const r = await repostJob(bot.api, old, await botName(), slots ? Number(slots) : null);
    return { ok: true, id: r.job.id, out: r.out };
  },
  async att({ id, uid, r }) {
    await setAttendance(id, uid, r === "ok" || r === "no" ? r : null);
    return { ok: true };
  },
  async attall({ id }) {
    const apps = await jobApplicants(id);
    let job = await kv.get(`job:${id}`);
    for (const a of apps) if (!job.att?.[a.id]) job = await setAttendance(id, a.id, "ok");
    job.attDone = true;
    await kv.set(`job:${id}`, job, 120 * 24 * 3600);
    return { ok: true };
  },
  async status({ uid, status }) {
    if (!["new", "contacted", "introduced", "closed"].includes(status)) throw new Error("상태 값이 이상해요");
    const app = await kv.get(`app:${uid}`);
    if (!app) throw new Error("학생을 찾을 수 없어요");
    await kv.set(`app:${uid}`, { ...app, status, statusAt: Date.now(), statusBy: this.who });
    return { ok: true };
  },
  async note({ uid, note }) {
    const app = await kv.get(`app:${uid}`);
    if (!app) throw new Error("학생을 찾을 수 없어요");
    await kv.set(`app:${uid}`, { ...app, note: String(note ?? "").slice(0, 1000) });
    return { ok: true };
  },
  // 조건에 맞는 학생 수 미리보기
  async count({ filter }) {
    const list = await findStudents(normFilter(filter));
    return { count: list.length, sample: list.slice(0, 50).map(studentView) };
  },
  // 새 공고 보내기
  async send({ text, kind, off, slots, where, filter, noInfo }) {
    if (!String(text ?? "").trim()) throw new Error("공고 내용을 써 주세요");
    if (!["g", "d", "b"].includes(where)) throw new Error("보낼 곳을 골라 주세요");
    const f = normFilter({ ...filter, off });
    const ids = where === "g" ? [] : (await findStudents(f)).map((a) => a.id);
    const job = await createJobRecord({ kind: kind === "urgent" ? "urgent" : "normal", off: off == null ? null : Number(off), text: String(text).trim(), slots, by: this.who, ids });
    const out = await sendJobOut(bot.api, job, where, await botName());
    return { ok: true, id: job.id, out };
  },
};
const normFilter = (f = {}) => ({
  off: f.off == null || f.off === "" ? null : Number(f.off),
  topik: Number(f.topik ?? 0),
  car: !!f.car,
  gender: f.gender == null || f.gender === "" ? null : Number(f.gender),
  noFlaky: !!f.noFlaky,
});

// ═════════════ 학생 공고판 ═════════════
const STUDENT = {
  async board() {
    const today = todayISO();
    const app = await kv.get(`app:${this.user.id}`);
    const lang = app?.lang ?? (await kv.get(`lang:${this.user.id}`)) ?? langOf(this.user.language_code);
    const jobs = (await allJobs()).filter((j) => !j.closed && j.sentAt && (!j.date || j.date >= today) && (j.group || (j.ids ?? []).includes(this.user.id)));
    const list = [];
    for (const j of jobs.slice(0, 50)) {
      const applied = !!(await kv.get(`jobyes:${j.id}:${this.user.id}`));
      const taken = ((await kv.smembers(`jobapps:${j.id}`)) ?? []).length;
      list.push({ id: j.id, urgent: j.kind === "urgent", dateLabel: j.dateLabel, text: [...jobMeta(j), j.text ?? j.caption ?? ""].join("\n"), left: j.slots ? Math.max(0, j.slots - taken) : null, applied });
    }
    const t = (k) => tx(lang, k);
    return {
      lang,
      registered: !!app,
      jobs: list,
      bot: await botName(),
      t: { title: t("wbTitle"), empty: t("wbEmpty"), apply: t("wbApply"), applied: t("wbApplied"), left: t("wbLeft"), closed: t("wbClosed"), needInfo: t("wbNeedInfo"), urgent: t("wbUrgent") },
    };
  },
  async apply({ id }) {
    const app = await kv.get(`app:${this.user.id}`);
    const job = await kv.get(`job:${Number(id)}`);
    if (!app || app.guest) {
      // 정보를 아직 안 냄 → 봇으로 보내서 9단계 후 자동 지원
      return { needInfo: true, link: `https://t.me/${await botName()}?start=job_${Number(id)}` };
    }
    const r = await applyJob(bot.api, this.user, id);
    // 봇 대화에도 확인 메시지 (지원 기록이 남게)
    await bot.api.sendMessage(this.user.id, r.msg).catch(() => {});
    return { ok: !!r.ok || !!r.already, msg: r.msg, closed: !r.ok && !r.already };
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {};
  const user = verify(body.initData);
  if (!user) return res.status(401).json({ error: "텔레그램 안에서 열어 주세요" });
  const { action, ...args } = body;
  delete args.initData;
  try {
    if (body.area === "admin") {
      if (!isAdmin(user.id)) return res.status(403).json({ error: "권한이 없어요" });
      const fn = ADMIN[action];
      if (!fn) return res.status(400).json({ error: "모르는 요청" });
      const who = [user.first_name, user.last_name].filter(Boolean).join(" ");
      return res.status(200).json(await fn.call({ who, user }, args));
    }
    const fn = STUDENT[action];
    if (!fn) return res.status(400).json({ error: "unknown" });
    return res.status(200).json(await fn.call({ user }, args));
  } catch (e) {
    console.error("미니앱 오류:", e);
    return res.status(500).json({ error: e.message });
  }
}
