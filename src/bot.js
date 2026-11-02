// ═════════════════════════════════════════════════════════════
//  GIEC JOB 봇 (@GIEC_JOB_bot)
//
//  흐름: 채널 가입 요청 → 봇이 1:1 인사 + 자동 승인 → 8단계 입력 → 혜승에게 카드
//   1 이름(입력) 2 나이(입력) 3 연락처(버튼, 한국 번호 아니면 010 입력)
//   4 학교(입력) 5 TOPIK 6 IELTS 7 자동차 8 수업 요일(여러 개 선택)
//
//  관리자(ADMIN_IDS, 기본 = 혜승) 명령어 — 봇과의 1:1 대화에서
//   /joinlink  채널 환영 링크(가입 요청 링크) 받기   · /joinlink new 새로 만들기
//   /pinpost   채널에 "정보 남기기" 버튼 글 올리고 고정 (이미 채널에 있는 학생용)
//   /export    지원자 전체 엑셀(CSV) 받기 (관리자 테스트 기록은 빠짐)
//   /reset     내 테스트 기록 지우기 · /delete 숫자ID  학생 정보 지우기
//   /find      학생 찾기 (일할 날·TOPIK·차) → 공고 보내기 · /cancel 공고 쓰기 취소
//   /help      도움말
// ═════════════════════════════════════════════════════════════
import { Bot, InlineKeyboard, Keyboard, InputFile } from "grammy";
import { kv } from "./storage.js";
import { tx, langOf, KO } from "./text.js";

export const bot = new Bot(process.env.BOT_TOKEN || "0:test");

export const ALLOWED_UPDATES = ["message", "callback_query", "chat_join_request", "my_chat_member"];

// 같은 메시지를 텔레그램이 다시 보내도 한 번만 처리 (카드 두 장 방지)
bot.use(async (ctx, next) => {
  const id = ctx.update.update_id;
  if (id != null && !(await kv.setNX(`upd:${id}`, 1, 600).catch(() => true))) return;
  await next();
  // 관리자 메뉴(입력창 / 목록)를 새 명령어로 한 번 갱신
  if (await kv.setNX("cmds:v3", 1, 365 * 24 * 3600).catch(() => false)) await setAdminCommands(ctx.api).catch(() => {});
  // 10분에 한 번, 들어온 메시지를 처리하는 김에 "이어서 하기" 알림도 확인 (따로 예약 서비스 필요 없음)
  if (await kv.setNX("remind:lock", 1, 600).catch(() => false)) await runReminders(ctx.api).catch((e) => console.error("알림 실패:", e.message));
});

// ── 관리자 ──
export const ADMIN_COMMANDS = [
  { command: "find", description: "공고 올리기 (긴급·일반) · 학생 찾기" },
  { command: "joinlink", description: "그룹 환영 링크" },
  { command: "pinpost", description: "정보 남기기 버튼 글 고정" },
  { command: "export", description: "지원자 엑셀(CSV)" },
  { command: "help", description: "도움말" },
];
async function setAdminCommands(api) {
  for (const id of adminIds()) await api.setMyCommands(ADMIN_COMMANDS, { scope: { type: "chat", chat_id: id } }).catch(() => {});
}
const adminIds = () =>
  (process.env.ADMIN_IDS || "8512697683")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter(Boolean);
const isAdmin = (id) => adminIds().includes(Number(id));

// ── 저장 ──
const K = {
  state: (id) => `state:${id}`, // 입력 중인 단계
  app: (id) => `app:${id}`, // 다 낸 지원 정보
  apps: "apps", // 지원자 id 목록
  channel: "channel", // 봇이 관리자로 있는 채널 { id, title }
  joinlink: "joinlink",
  pending: "pending", // 입력을 시작했거나 인사만 받은 학생 (아직 다 안 냄)
};
const STATE_TTL = 7 * 24 * 3600;
const getState = (id) => kv.get(K.state(id));
const setState = async (id, s) => {
  s.at = Date.now(); // 마지막으로 진행한 시각 (이어서 하기 알림 기준)
  await kv.set(K.state(id), s, STATE_TTL);
  await kv.sadd(K.pending, id);
};
const clearState = async (id) => {
  await kv.del(K.state(id));
  await kv.srem(K.pending, id);
};

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const nowKST = (ts = Date.now()) =>
  new Date(ts).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const fullName = (u) => [u?.first_name, u?.last_name].filter(Boolean).join(" ") || "?";
const html = { parse_mode: "HTML" };

// ═════════════ 학생 쪽 ═════════════

// 인사 + 동의 버튼
async function sendGreet(api, chatId, from, lang) {
  await setState(from.id, { step: "greet", lang, mode: "full", data: {}, chat: chatId, nudged: 0 });
  await api.sendMessage(chatId, tx(lang, "greet").replace("{name}", esc(from.first_name ?? "")), {
    ...html,
    reply_markup: new InlineKeyboard().text(tx(lang, "btnStart"), "c:go"),
  });
}

// 단계별 질문 보내기
async function ask(ctx, st) {
  const lang = st.lang;
  const opts = (key, prefix) => {
    const kb = new InlineKeyboard();
    tx(lang, key).forEach((label, i) => kb.text(label, `c:${prefix}:${i}`));
    return kb;
  };
  switch (st.step) {
    case "greet":
      return sendGreet(ctx.api, ctx.chat.id, ctx.from, lang);
    case "name":
      return ctx.reply(tx(lang, "name"), { ...html, reply_markup: { remove_keyboard: true } });
    case "age":
      return ctx.reply(tx(lang, "age"), html);
    case "phone":
      return ctx.reply(tx(lang, "phone"), {
        ...html,
        reply_markup: new Keyboard().requestContact(tx(lang, "btnPhone")).row().text(tx(lang, "btnNoPhone")).resized().oneTime(),
      });
    case "phoneText":
      return ctx.reply(tx(lang, "phoneNotKr"), {
        ...html,
        reply_markup: new Keyboard().text(tx(lang, "btnNoPhone")).resized().oneTime(),
      });
    case "school":
      return ctx.reply(tx(lang, "school"), { ...html, reply_markup: { remove_keyboard: true } });
    case "topik":
      return ctx.reply(tx(lang, "topik"), { ...html, reply_markup: opts("topikOpts", "topik") });
    case "ielts":
      return ctx.reply(tx(lang, "ielts"), { ...html, reply_markup: opts("ieltsOpts", "ielts") });
    case "car":
      return ctx.reply(tx(lang, "car"), { ...html, reply_markup: opts("carOpts", "car") });
    case "days":
      return ctx.reply(tx(lang, st.mode === "days" ? "daysAgain" : "days"), { ...html, reply_markup: daysKeyboard(lang, st.data.days ?? []) });
  }
}

const daysKeyboard = (lang, picked) => {
  const kb = new InlineKeyboard();
  tx(lang, "dayNames").forEach((d, i) => kb.text(`${picked.includes(i) ? "✅ " : ""}${d}`, `c:day:${i}`));
  return kb.row().text(tx(lang, "btnDone"), "c:daysok");
};

async function startFlow(ctx, lang) {
  const st = { step: "name", lang, mode: "full", data: {}, chat: ctx.chat.id, nudged: 0 };
  await setState(ctx.from.id, st);
  return ask(ctx, st);
}

const next = { name: "age", age: "phone", phone: "school", phoneText: "school", school: "topik", topik: "ielts", ielts: "car", car: "days" };
async function goNext(ctx, st) {
  st.step = next[st.step];
  await setState(ctx.from.id, st);
  return ask(ctx, st);
}

// 한국 번호로 맞추기 → "010-1234-5678" (아니면 null)
export function krPhone(raw) {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("82")) d = "0" + d.slice(2).replace(/^0/, "");
  return /^010\d{8}$/.test(d) ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : null;
}

// 입력 단계에서 들어온 글
async function handleText(ctx, st) {
  const text = (ctx.message.text ?? "").trim();
  const lang = st.lang;
  if (st.step === "name") {
    if (!/[A-Za-z]/.test(text) || text.length < 2 || text.length > 60) return ctx.reply(tx(lang, "nameBad"));
    st.data.name = text.toUpperCase().replace(/\s+/g, " ");
    return goNext(ctx, st);
  }
  if (st.step === "age") {
    const n = Number(text.replace(/\D/g, ""));
    if (!n || n < 15 || n > 60) return ctx.reply(tx(lang, "ageBad"));
    st.data.age = n;
    return goNext(ctx, st);
  }
  if (st.step === "phone" || st.step === "phoneText") {
    if (text === tx(lang, "btnNoPhone")) {
      st.data.phone = null;
      st.step = "phoneText"; // 다음은 school
      return goNext(ctx, st);
    }
    const p = krPhone(text);
    if (!p) return ctx.reply(tx(lang, "phoneBad"));
    st.data.phone = p;
    return goNext(ctx, st);
  }
  if (st.step === "school") {
    if (text.length < 2 || text.length > 80) return ask(ctx, st);
    st.data.school = text;
    return goNext(ctx, st);
  }
  // 버튼 단계에서 글을 쓰면 같은 질문 다시
  return ask(ctx, st);
}

// 다 끝남 → 저장 + 관리자 카드
async function finish(ctx, st) {
  const id = ctx.from.id;
  const prev = await kv.get(K.app(id));
  const now = Date.now();
  if (st.mode === "days") {
    if (!prev) return clearState(id);
    const app = { ...prev, days: st.data.days, daysAt: now };
    await kv.set(K.app(id), app);
    await clearState(id);
    await ctx.reply(tx(st.lang, "daysUpdated"));
    return notifyAdmins(ctx.api, app, "📅 수업 요일 새로 받음");
  }
  const app = {
    ...(prev ?? {}),
    ...st.data,
    id,
    tgName: fullName(ctx.from),
    username: ctx.from.username ?? null,
    lang: st.lang,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    status: "new", // 다시 냈다 = 지금 일을 찾는 중
    statusBy: null,
    statusAt: null,
    test: isAdmin(id), // 관리자가 직접 해본 기록 → 엑셀에서 빠짐
  };
  await clearState(id);
  await ctx.reply(tx(st.lang, "done"), { reply_markup: { remove_keyboard: true } });
  const title = prev ? `✏️ 다시 신청 (이전: ${STATUS[prev.status] ?? STATUS.new})` : "🆕 새 지원자";
  await saveAndCard(ctx.api, app, `${app.test ? "🧪 테스트 · " : ""}${title}`);
  const want = await kv.get(`wantjob:${id}`);
  if (want) {
    await kv.del(`wantjob:${id}`);
    await applyJob(ctx.api, ctx.from, want);
  }
}

// 저장 + 카드 (같은 학생 카드는 하루(24시간)에 한 번만 — 그만두고 또 신청하는 학생이 많아서)
const DAY = 24 * 3600 * 1000;
async function saveAndCard(api, app, title) {
  const recent = app.lastCardAt && Date.now() - app.lastCardAt < DAY;
  if (!recent) app.lastCardAt = Date.now();
  await kv.set(K.app(app.id), app);
  await kv.sadd(K.apps, app.id);
  if (!recent) await notifyAdmins(api, app, title);
}

// ═════════════ 관리자 카드 ═════════════
const STATUS = {
  new: "🆕 신규",
  contacted: "🟡 연락함",
  introduced: "🟢 소개함",
  closed: "⚫ 종결",
};
const dayText = (days) => (days?.length ? [...days].sort().map((i) => KO.days[i]).join("·") : "없음");

export function cardText(app, title) {
  const line = "──────────────";
  const tg = `<a href="tg://user?id=${app.id}">${esc(app.tgName)}</a>${app.username ? ` (@${esc(app.username)})` : ""}`;
  const st = STATUS[app.status] ?? STATUS.new;
  return [
    `<b>${title}</b>`,
    line,
    `👤 이름: <b>${esc(app.name)}</b>`,
    `🎂 나이: ${esc(app.age)}`,
    `📞 연락처: ${app.phone ? `<code>${esc(app.phone)}</code>` : "한국 번호 없음"}`,
    `🏫 학교: ${esc(app.school)}`,
    `📝 TOPIK: ${KO.topik[app.topik] ?? "-"}`,
    `🇬🇧 IELTS: ${KO.ielts[app.ielts] ?? "-"}`,
    `🚗 자동차: ${KO.car[app.car] ?? "-"}`,
    `📅 수업 요일: ${dayText(app.days)}`,
    `💬 텔레그램: ${tg}`,
    `🌐 언어: ${app.lang === "ru" ? "러시아어" : "우즈벡어"}`,
    line,
    `상태: ${st}${app.statusBy ? ` — ${esc(app.statusBy)} · ${nowKST(app.statusAt)}` : ""}`,
    `🕐 ${nowKST(app.updatedAt ?? app.createdAt)}`,
  ].join("\n");
}

const cardKeyboard = (id) =>
  new InlineKeyboard()
    .text("🟡 연락함", `a:st:contacted:${id}`)
    .text("🟢 소개함", `a:st:introduced:${id}`)
    .text("⚫ 종결", `a:st:closed:${id}`)
    .row()
    .text("🔄 수업 요일 다시 받기", `a:days:${id}`);

async function notifyAdmins(api, app, title) {
  for (const admin of adminIds()) {
    await api
      .sendMessage(admin, cardText(app, title), { ...html, reply_markup: cardKeyboard(app.id), link_preview_options: { is_disabled: true } })
      .catch((e) => console.error(`카드 전송 실패(${admin}):`, e.description ?? e.message));
  }
}

// ═════════════ 업데이트 처리 ═════════════

// 채널 가입 요청 → 먼저 1:1 인사, 그다음 승인
bot.on("chat_join_request", async (ctx) => {
  const req = ctx.chatJoinRequest;
  const ch = await kv.get(K.channel);
  if (ch && Number(ch.id) !== req.chat.id) return; // 다른 방이면 무시
  if (!ch) await kv.set(K.channel, { id: req.chat.id, title: req.chat.title });
  const lang = langOf(req.from.language_code);
  const chatId = req.user_chat_id ?? req.from.id;
  const app = await kv.get(K.app(req.from.id));
  if (!app) await sendGreet(ctx.api, chatId, req.from, lang).catch((e) => console.error("인사 실패:", e.description));
  await ctx.api.approveChatJoinRequest(req.chat.id, req.from.id).catch((e) => console.error("승인 실패:", e.description));
});

// 채널·그룹 (GIEC JOB 방은 그룹일 수도 있음)
const ROOM_TYPES = ["channel", "group", "supergroup"];
async function rememberRoom(api, chat) {
  const ch = await kv.get(K.channel);
  if (ch && Number(ch.id) === chat.id) return;
  await kv.set(K.channel, { id: chat.id, title: chat.title, type: chat.type });
  for (const admin of adminIds()) {
    await api
      .sendMessage(admin, `✅ 「${esc(chat.title)}」에 봇이 관리자로 연결됐어요.\n이제 /joinlink 로 환영 링크를 받으세요.`, html)
      .catch(() => {});
  }
}

// 봇이 채널·그룹 관리자로 추가됨 → 기억 + 관리자에게 알림
bot.on("my_chat_member", async (ctx) => {
  const chat = ctx.myChatMember.chat;
  const status = ctx.myChatMember.new_chat_member.status;
  if (!ROOM_TYPES.includes(chat.type) || status !== "administrator") return;
  await rememberRoom(ctx.api, chat);
});

// 그룹 안의 메시지
//  - 아직 방을 모르면: 관리자가 그룹에 아무 글이나 쓰면 그 그룹을 기억
//  - "○○님이 들어왔습니다/나갔습니다" 알림은 봇이 바로 지움 (다른 학생들 대화방을 깨끗하게)
bot.on("message", async (ctx, next) => {
  const chat = ctx.chat;
  if (chat?.type !== "group" && chat?.type !== "supergroup") return next();
  const m = ctx.message;
  if (m.new_chat_members || m.left_chat_member) {
    await ctx.deleteMessage().catch(() => {});
    return;
  }
  const ch = await kv.get(K.channel);
  if (!ch && isAdmin(ctx.from?.id)) await rememberRoom(ctx.api, chat);
});

const pm = bot.filter((ctx) => ctx.chat?.type === "private");

// /start
pm.command("start", async (ctx) => {
  const lang = langOf(ctx.from.language_code);
  const payload = String(ctx.match ?? "");
  if (isAdmin(ctx.from.id) && !payload.startsWith("test") && !payload.startsWith("job_")) return ctx.reply(HELP, html);
  await clearState(ctx.from.id);
  const app = await kv.get(K.app(ctx.from.id));
  // 그룹방 공고의 [🙋 지원하기]로 들어옴
  const jobId = /^job_(\d+)$/.exec(payload)?.[1];
  if (jobId) {
    if (app) return ctx.reply((await applyJob(ctx.api, ctx.from, jobId)).msg);
    await kv.set(`wantjob:${ctx.from.id}`, Number(jobId), 7 * 24 * 3600); // 정보를 다 내면 자동으로 지원
  }
  if (app) {
    return ctx.reply(tx(lang, "already"), {
      reply_markup: new InlineKeyboard().text(tx(lang, "btnAgain"), "c:again").row().text(tx(lang, "btnUpdate"), "c:go"),
    });
  }
  return sendGreet(ctx.api, ctx.chat.id, ctx.from, lang);
});

// ── 관리자 명령어 ──
const HELP = [
  "🛠 <b>GIEC JOB 관리자 메뉴</b>",
  "",
  "/joinlink — 채널 환영 링크 (이 링크로 들어오면 봇이 인사 + 정보 받기)",
  "/pinpost — 채널에 [정보 남기기] 버튼 글 올리고 고정 (이미 있는 학생용)",
  "/find — 공고 올리기: 🚨 긴급(오늘·내일) / 📅 일반(5일 안) → 학생 찾기 → 그룹방·1:1로 보내기 → 🔒 마감",
  "/export — 지원자 전체 엑셀(CSV)",
  "/start test — 학생 화면 직접 해보기 (기록은 🧪 테스트로 표시, 엑셀에서 빠짐)",
  "/reset — 내 테스트 기록 지우기",
  "/delete 숫자ID — 학생 정보 지우기 (학생이 삭제를 요청할 때, 숫자ID는 엑셀 맨 오른쪽 칸)",
  "",
  "새 지원자가 정보를 다 내면 이 대화로 카드가 와요.",
  "카드의 [🟡 연락함] [🟢 소개함] [⚫ 종결] 로 진행 상태를 표시하세요.",
].join("\n");

const admin = pm.filter((ctx) => isAdmin(ctx.from?.id));
admin.command("help", (ctx) => ctx.reply(HELP, html));

admin.command("joinlink", async (ctx) => {
  const ch = await kv.get(K.channel);
  if (!ch) return ctx.reply("⚠️ 아직 방을 몰라요. GIEC JOB 그룹(채널)에 @GIEC_JOB_bot 을 관리자로 추가한 뒤, 그 방에 아무 글이나 한 줄 써 주세요 (예: 안녕). 봇이 그 방을 기억해요.");
  const fresh = String(ctx.match ?? "").trim() === "new";
  let link = fresh ? null : await kv.get(K.joinlink);
  if (!link) {
    try {
      const r = await ctx.api.createChatInviteLink(ch.id, { name: "GIEC JOB 봇 환영 링크", creates_join_request: true });
      link = r.invite_link;
      await kv.set(K.joinlink, link);
    } catch (e) {
      return ctx.reply(`⚠️ 링크를 못 만들었어요: ${e.description ?? e.message}\n채널 관리자 설정에서 봇의 "사용자 초대" 권한을 켜 주세요.`);
    }
  }
  return ctx.reply(
    [
      `👋 <b>환영 링크</b> — ${esc(ch.title)}`,
      `<code>${link}</code>`,
      "",
      "이 링크로 들어오면 [가입 요청] → 봇이 1:1로 인사 + 정보 받기 → 바로 승인돼요.",
      "학생들에게 친구 초대할 때 이 링크를 쓰게 해주세요.",
      "⚠️ 예전 일반 링크로 들어온 사람에게는 봇이 먼저 말을 걸 수 없어요.",
      "   그룹 설정 → 초대 링크 에서 예전 링크는 취소(Revoke)해 주세요.",
    ].join("\n"),
    { ...html, link_preview_options: { is_disabled: true } }
  );
});

admin.command("pinpost", async (ctx) => {
  const ch = await kv.get(K.channel);
  if (!ch) return ctx.reply("⚠️ 아직 방을 몰라요. 먼저 /joinlink 안내대로 방을 연결해 주세요.");
  try {
    const msg = await ctx.api.sendMessage(ch.id, tx("uz", "pinPost"), {
      ...html,
      reply_markup: new InlineKeyboard().url(tx("uz", "btnPin"), `https://t.me/${ctx.me.username}?start=apply`),
    });
    await ctx.api.pinChatMessage(ch.id, msg.message_id, { disable_notification: true }).catch(() => {});
    return ctx.reply("✅ 채널에 올리고 고정했어요.");
  } catch (e) {
    return ctx.reply(`⚠️ 채널에 못 올렸어요: ${e.description ?? e.message}\n봇의 "메시지 게시·고정" 권한을 확인해 주세요.`);
  }
});

admin.command("reset", async (ctx) => {
  await kv.del(K.app(ctx.from.id));
  await kv.srem(K.apps, ctx.from.id);
  await clearState(ctx.from.id);
  return ctx.reply("🧹 내 테스트 기록을 지웠어요. /start test 로 처음부터 다시 해볼 수 있어요.");
});

admin.command("delete", async (ctx) => {
  const id = Number(String(ctx.match ?? "").replace(/\D/g, ""));
  if (!id) return ctx.reply("사용법: /delete 숫자ID\n숫자ID는 /export 엑셀 맨 오른쪽 '텔레그램 번호' 칸에 있어요.");
  const app = await kv.get(K.app(id));
  if (!app) return ctx.reply("그 번호의 학생 정보가 없어요.");
  await kv.del(K.app(id));
  await kv.srem(K.apps, id);
  await clearState(id);
  return ctx.reply(`🗑 ${esc(app.name)} 학생 정보를 지웠어요.`, html);
});

admin.command("export", async (ctx) => {
  const ids = (await kv.smembers(K.apps)) ?? [];
  const apps = (await kv.mget(ids.map(K.app))).filter((a) => a && !a.test && !isAdmin(a.id)).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  if (!apps.length) return ctx.reply("아직 지원자가 없어요.");
  const cell = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [
    ["접수일", "이름", "나이", "연락처", "학교", "TOPIK", "IELTS", "자동차", "수업 요일", "텔레그램 이름", "아이디", "상태", "텔레그램 번호"],
    ...apps.map((a) => [
      nowKST(a.createdAt),
      a.name,
      a.age,
      a.phone ?? "없음",
      a.school,
      KO.topik[a.topik],
      KO.ielts[a.ielts],
      KO.car[a.car],
      dayText(a.days),
      a.tgName,
      a.username ? `@${a.username}` : "",
      (STATUS[a.status] ?? STATUS.new).slice(2).trim(),
      a.id,
    ]),
  ];
  const csv = "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
  return ctx.replyWithDocument(new InputFile(Buffer.from(csv, "utf8"), `GIEC_JOB_지원자_${apps.length}명.csv`), {
    caption: `📥 지원자 ${apps.length}명`,
  });
});

// ── 버튼 ──
bot.callbackQuery("c:go", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
  return startFlow(ctx, langOf(ctx.from.language_code));
});

// 예전에 낸 학생: "또 일 찾아요" — 정보는 그대로, 상태만 🆕 신규로
bot.callbackQuery("c:again", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
  const app = await kv.get(K.app(ctx.from.id));
  if (!app) return startFlow(ctx, langOf(ctx.from.language_code));
  const before = STATUS[app.status] ?? STATUS.new;
  const updated = { ...app, status: "new", statusBy: null, statusAt: null, updatedAt: Date.now(), againAt: Date.now() };
  await ctx.reply(tx(app.lang, "again"));
  return saveAndCard(ctx.api, updated, `🔁 다시 일 찾는 중 (이전: ${before})`);
});

// 이어서 하기 (알림 버튼)
bot.callbackQuery("c:resume", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
  const st = await getState(ctx.from.id);
  if (!st) return;
  if (st.step === "greet") return startFlow(ctx, st.lang);
  return ask(ctx, st);
});

bot.callbackQuery(/^c:(topik|ielts|car):(\d)$/, async (ctx) => {
  const st = await getState(ctx.from.id);
  const [, key, val] = ctx.match;
  if (!st || st.step !== key) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  st.data[key] = Number(val);
  const label = tx(st.lang, `${key}Opts`)[Number(val)];
  await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n➡️ ${label}`).catch(() => {});
  return goNext(ctx, st);
});

bot.callbackQuery(/^c:day:(\d)$/, async (ctx) => {
  const st = await getState(ctx.from.id);
  if (!st || st.step !== "days") return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  const i = Number(ctx.match[1]);
  const days = new Set(st.data.days ?? []);
  days.has(i) ? days.delete(i) : days.add(i);
  st.data.days = [...days].sort();
  await setState(ctx.from.id, st);
  await ctx.editMessageReplyMarkup({ reply_markup: daysKeyboard(st.lang, st.data.days) }).catch(() => {});
});

bot.callbackQuery("c:daysok", async (ctx) => {
  const st = await getState(ctx.from.id);
  if (!st || st.step !== "days") return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  st.data.days ??= [];
  const picked = st.data.days.length ? st.data.days.map((i) => tx(st.lang, "dayNames")[i]).join(", ") : "—";
  await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n➡️ ${picked}`).catch(() => {});
  return finish(ctx, st);
});

// 관리자: 상태 바꾸기
bot.callbackQuery(/^a:st:(\w+):(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery({ text: "관리자만 누를 수 있어요.", show_alert: true });
  const [, status, id] = ctx.match;
  const app = await kv.get(K.app(id));
  if (!app) return ctx.answerCallbackQuery({ text: "지원자 정보를 찾을 수 없어요.", show_alert: true });
  const updated = { ...app, status, statusBy: fullName(ctx.from), statusAt: Date.now() };
  await kv.set(K.app(id), updated);
  await ctx.answerCallbackQuery({ text: `${STATUS[status]} 표시했어요` });
  const title = (ctx.callbackQuery.message.text ?? "").split("\n")[0] || "지원자";
  await ctx.editMessageText(cardText(updated, title), { ...html, reply_markup: cardKeyboard(id), link_preview_options: { is_disabled: true } }).catch(() => {});
});

// 관리자: 수업 요일 다시 받기 (새 학기)
bot.callbackQuery(/^a:days:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const id = Number(ctx.match[1]);
  const app = await kv.get(K.app(id));
  if (!app) return ctx.answerCallbackQuery({ text: "지원자 정보를 찾을 수 없어요.", show_alert: true });
  const st = { step: "days", lang: app.lang ?? "uz", mode: "days", data: { days: [] } };
  try {
    await kv.set(K.state(id), st, STATE_TTL);
    await ctx.api.sendMessage(id, tx(st.lang, "daysAgain"), { ...html, reply_markup: daysKeyboard(st.lang, []) });
    await ctx.answerCallbackQuery({ text: "✅ 학생에게 요일 질문을 보냈어요", show_alert: true });
  } catch (e) {
    await ctx.answerCallbackQuery({ text: `보내지 못했어요 (학생이 봇을 차단했을 수 있어요)`, show_alert: true });
  }
});

// ═════════════ 🔎 학생 찾기 · 📢 공고 보내기 ═════════════
//  /find → ① 🚨 긴급(오늘·내일) / 📅 일반(오늘~5일 뒤 날짜 고르기)
//        → ② TOPIK · 차 → [🔎 찾기] → 맞는 학생 목록 (전화 바로 가능)
//        → ③ [✍️ 공고 쓰기] → 공고 한 개 보내기 → 미리보기
//        → ④ 어디로: [👥 그룹방] [📩 찾은 학생 1:1] [👥+📩 둘 다]
//  "일할 수 있는 날" = 그날 수업이 없는 학생 (일요일은 모두). ⚫ 종결·관리자 테스트 제외
//  그룹방 공고의 [🙋 지원하기] → 봇 1:1로 이동 → 정보를 낸 학생이면 바로 지원, 처음이면 8단계 후 자동 지원
//  공고마다 [🔒 마감] → 그룹방 공고에 "마감" 표시 + 버튼 없앰
const WD = ["월", "화", "수", "목", "금", "토", "일"];
const kstDate = (off = 0) => new Date(Date.now() + 9 * 3600e3 + off * DAY);
const dayOf = (off) => (kstDate(off).getUTCDay() + 6) % 7; // 월=0 … 일=6
const dateLabel = (off) => {
  const d = kstDate(off);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[dayOf(off)]})`;
};
const FIND_TTL = 3 * 3600;
const findKey = (a) => `find:${a}`;
const postKey = (a) => `post:${a}`;
const TOPIK_MIN = [["상관없음", 0], ["1급↑", 1], ["3급↑", 2], ["4급↑", 3]];
const topikName = (v) => TOPIK_MIN.find((t) => t[1] === v)?.[0] ?? "상관없음";
const mark = (on, label) => (on ? `✅ ${label}` : label);

const newFind = (kind) => ({ kind, off: kind === "urgent" ? 0 : 1, topik: 0, car: false });
const findDayLabel = (f) => (f.off == null ? "날짜 상관없음" : `${f.off === 0 ? "오늘 " : f.off === 1 ? "내일 " : ""}${dateLabel(f.off)}`);
const findText = (f) =>
  [
    f.kind === "urgent" ? "🚨 <b>긴급 공고 — 학생 찾기</b>" : "📅 <b>일반 공고 — 학생 찾기</b>",
    "",
    `📅 일할 날: <b>${findDayLabel(f)}</b>`,
    `📝 TOPIK: <b>${topikName(f.topik)}</b>`,
    `🚗 차: <b>${f.car ? "있어야 함" : "상관없음"}</b>`,
  ].join("\n");
const findKeyboard = (f) => {
  const kb = new InlineKeyboard();
  if (f.kind === "urgent") {
    kb.text(mark(f.off === 0, `오늘 ${dateLabel(0)}`), "f:o:0").text(mark(f.off === 1, `내일 ${dateLabel(1)}`), "f:o:1").row();
  } else {
    for (let o = 0; o <= 5; o++) {
      kb.text(mark(f.off === o, dateLabel(o)), `f:o:${o}`);
      if (o === 2) kb.row();
    }
    kb.row().text(mark(f.off == null, "날짜 상관없음"), "f:o:any").row();
  }
  TOPIK_MIN.forEach(([n, v]) => kb.text(mark(f.topik === v, n), `f:t:${v}`));
  kb.row().text(mark(!f.car, "차 상관없음"), "f:c:0").text(mark(f.car, "차 있어야 함"), "f:c:1");
  return kb.row().text("🔎 찾기", "f:go");
};

admin.command("find", (ctx) =>
  ctx.reply("어떤 공고인가요?", {
    reply_markup: new InlineKeyboard().text("🚨 긴급 공고 (오늘·내일)", "f:k:urgent").row().text("📅 일반 공고 (5일 안)", "f:k:normal"),
  })
);

bot.callbackQuery(/^f:k:(urgent|normal)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  const f = newFind(ctx.match[1]);
  await kv.set(findKey(ctx.from.id), f, FIND_TTL);
  await ctx.editMessageText(findText(f), { ...html, reply_markup: findKeyboard(f) }).catch(() => {});
});

bot.callbackQuery(/^f:(o|t|c):(\w+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  const f = (await kv.get(findKey(ctx.from.id))) ?? newFind("urgent");
  const [, k, v] = ctx.match;
  if (k === "o") f.off = v === "any" ? null : Number(v);
  if (k === "t") f.topik = Number(v);
  if (k === "c") f.car = v === "1";
  await kv.set(findKey(ctx.from.id), f, FIND_TTL);
  await ctx.editMessageText(findText(f), { ...html, reply_markup: findKeyboard(f) }).catch(() => {});
});

const freeOn = (a, day) => day == null || day === 6 || !(a.days ?? []).includes(day);
export async function findStudents(f) {
  const day = f.off == null ? null : dayOf(f.off);
  const ids = (await kv.smembers(K.apps)) ?? [];
  return (await kv.mget(ids.map(K.app)))
    .filter((a) => a && !a.test && !isAdmin(a.id) && a.status !== "closed")
    .filter((a) => freeOn(a, day) && (a.topik ?? 0) >= f.topik && (!f.car || a.car === 0))
    .sort((a, b) => (b.topik ?? 0) - (a.topik ?? 0) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

const LIST_MAX = 30;
const studentLine = (a, i) =>
  `${i + 1}. <a href="tg://user?id=${a.id}">${esc(a.name)}</a> · ${esc(a.age)} · ${a.phone ? `<code>${esc(a.phone)}</code>` : "번호 없음"} · ${esc(a.school)} · TOPIK ${KO.topik[a.topik] ?? "-"}${a.car === 0 ? " · 🚗" : ""}${a.status === "introduced" ? " · 🟢" : ""}`;

bot.callbackQuery("f:go", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  const f = (await kv.get(findKey(ctx.from.id))) ?? newFind("urgent");
  const list = await findStudents(f);
  await kv.set(findKey(ctx.from.id), { ...f, ids: list.map((a) => a.id) }, FIND_TTL);
  const head = `${f.kind === "urgent" ? "🚨" : "📅"} <b>조건에 맞는 학생 ${list.length}명</b>\n${findDayLabel(f)} · TOPIK ${topikName(f.topik)} · 차 ${f.car ? "있어야 함" : "상관없음"}`;
  const lines = list.slice(0, LIST_MAX).map(studentLine);
  if (list.length > LIST_MAX) lines.push(`… 외 ${list.length - LIST_MAX}명`);
  return ctx.reply(
    [head, "", ...(lines.length ? lines : ["(맞는 학생이 없어요 — 그룹방에만 올려도 돼요)"]), "", "🚗 = 차 있음 · 🟢 = 이미 일 소개받은 학생 · 이름을 누르면 대화로 가요."].join("\n"),
    { ...html, link_preview_options: { is_disabled: true }, reply_markup: new InlineKeyboard().text("✍️ 공고 쓰기", "p:new") }
  );
});

// 공고 쓰기
bot.callbackQuery("p:new", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  const f = await kv.get(findKey(ctx.from.id));
  if (!f) return ctx.reply("찾기 조건이 사라졌어요. /find 부터 다시 해주세요.");
  await kv.set(postKey(ctx.from.id), { step: "text" }, 1800);
  return ctx.reply(
    [
      "✍️ <b>공고 내용을 메시지 한 개로 보내주세요</b> (글, 또는 사진 + 설명)",
      "지금 그룹방에 올리는 모양 그대로 쓰면 돼요. 예)",
      "<code>365로지스 / 4명\n단순 하차 업무\n위치 : 일산 설문동 606\n근무시간 : 7시-12시\n시급 : 11,000원</code>",
      "",
      "날짜와 [🙋 지원하기] 버튼, 우즈벡어·키르기스어 안내는 봇이 붙여요. 그만두려면 /cancel",
    ].join("\n"),
    html
  );
});

admin.command("cancel", async (ctx) => {
  await kv.del(postKey(ctx.from.id));
  return ctx.reply("취소했어요.");
});

// ── 공고 모양 ──
const jobDate = (job) => (job.off == null ? null : job.dateLabel);
// 그룹방용 (여러 나라 학생이 같이 봄 → 짧게 3개 언어)
function groupBody(job, closed = false) {
  const head =
    job.kind === "urgent" ? "🚨 <b>급구 · Shoshilinch · Срочно</b>" : "📢 <b>일자리 · Ish · Работа</b>";
  const body = job.text != null ? job.text : job.caption ?? "";
  return [
    closed ? "🔒 <b>마감 · Yopildi · Жабылды</b>" : head,
    jobDate(job) ? `📅 ${jobDate(job)}` : null,
    "",
    esc(body),
    "",
    closed ? null : "👇 지원 · Ariza · Арыз — tugmani bosing",
  ]
    .filter((x) => x !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}
// 1:1용 (학생 언어)
function dmBody(job, lang) {
  const body = job.text != null ? job.text : job.caption ?? "";
  return [`${job.kind === "urgent" ? "🚨 " : ""}${tx(lang, "jobHead")}`, jobDate(job) ? `📅 ${jobDate(job)}` : null, "", esc(body), "", tx(lang, "jobFoot")]
    .filter((x) => x !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}
const dmMarkup = (lang, jobId) => new InlineKeyboard().text(tx(lang, "btnJobYes"), `j:y:${jobId}`).text(tx(lang, "btnJobNo"), `j:n:${jobId}`);
const groupMarkup = (username, jobId) => new InlineKeyboard().url("🙋 지원하기 · Ariza berish", `https://t.me/${username}?start=job_${jobId}`);

async function sendTo(api, chatId, job, text, markup) {
  const opts = { parse_mode: "HTML", reply_markup: markup, link_preview_options: { is_disabled: true } };
  if (job.text != null) return api.sendMessage(chatId, text, opts);
  return api.copyMessage(chatId, job.from, job.msgId, { ...opts, caption: text.slice(0, 1024) });
}

// 관리자가 공고 글을 보냄 → 미리보기 + 어디로 보낼지
admin.on("message", async (ctx, next) => {
  const p = await kv.get(postKey(ctx.from.id));
  if (!p || p.step !== "text" || ctx.message.text?.startsWith("/")) return next();
  const m = ctx.message;
  if (m.text == null && !(m.photo || m.video || m.document || m.animation)) return ctx.reply("글이나 사진(+설명)으로 보내주세요. 그만두려면 /cancel");
  const f = (await kv.get(findKey(ctx.from.id))) ?? newFind("urgent");
  const jobId = await kv.incr("jobseq");
  const job = {
    id: jobId,
    kind: f.kind,
    off: f.off,
    dateLabel: f.off == null ? null : dateLabel(f.off),
    from: ctx.chat.id,
    msgId: m.message_id,
    text: m.text ?? null,
    caption: m.caption ?? "",
    ids: f.ids ?? [],
    by: fullName(ctx.from),
    at: Date.now(),
  };
  await kv.set(`job:${jobId}`, job, 60 * 24 * 3600);
  await kv.set(postKey(ctx.from.id), { step: "confirm", jobId }, 1800);
  await ctx.reply("👀 <b>그룹방에는 이렇게 올라가요</b>", html);
  await sendTo(ctx.api, ctx.chat.id, job, groupBody(job), groupMarkup(ctx.me.username, jobId));
  const n = job.ids.length;
  const kb = new InlineKeyboard().text("👥 그룹방에 올리기", `p:send:${jobId}:g`).row();
  if (n) kb.text(`📩 찾은 ${n}명에게 1:1`, `p:send:${jobId}:d`).row().text(`👥 + 📩 둘 다`, `p:send:${jobId}:b`).row();
  kb.text("❌ 취소", "p:cancel");
  return ctx.reply(
    `📢 공고 #${jobId} — 어디로 보낼까요?\n\n👥 그룹방: 모두가 봐요. 지원 버튼을 누르면 봇으로 와요.\n📩 1:1: 조건에 맞는 학생에게만 개인 메시지로 가요 (알림이 확실히 감).${n ? "" : "\n(조건에 맞는 학생이 없어서 1:1은 없어요)"}`,
    { reply_markup: kb }
  );
});

bot.callbackQuery("p:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  await kv.del(postKey(ctx.from.id));
  await ctx.editMessageText("취소했어요.").catch(() => {});
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEND_MAX = 150; // 1:1 한 번에 최대 인원 (텔레그램 속도 제한 · 서버 1분 제한)

bot.callbackQuery(/^p:send:(\d+):(g|d|b)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const [, jobId, where] = ctx.match;
  const job = await kv.get(`job:${jobId}`);
  const p = await kv.get(postKey(ctx.from.id));
  if (!job || p?.jobId !== job.id) return ctx.answerCallbackQuery({ text: "이미 보냈거나 취소된 공고예요.", show_alert: true });
  await kv.del(postKey(ctx.from.id)); // 두 번 눌러도 한 번만
  await ctx.answerCallbackQuery({ text: "보내는 중…" });
  await ctx.editMessageText(`📤 공고 #${job.id} 보내는 중…`).catch(() => {});
  const out = [];

  if (where !== "d") {
    const ch = await kv.get(K.channel);
    if (!ch) out.push("⚠️ 그룹방을 아직 몰라요 (/joinlink 안내 참고)");
    else {
      try {
        const msg = await sendTo(ctx.api, ch.id, job, groupBody(job), groupMarkup(ctx.me.username, job.id));
        job.group = { chat: ch.id, msgId: msg.message_id };
        out.push("👥 그룹방에 올렸어요");
      } catch (e) {
        out.push(`⚠️ 그룹방에 못 올렸어요: ${e.description ?? e.message}`);
      }
    }
  }
  if (where !== "g") {
    const apps = (await kv.mget(job.ids.slice(0, SEND_MAX).map(K.app))).filter(Boolean);
    let ok = 0;
    let fail = 0;
    for (const a of apps) {
      const lang = a.lang ?? "uz";
      await sendTo(ctx.api, a.id, job, dmBody(job, lang), dmMarkup(lang, job.id)).then(() => ok++).catch(() => fail++);
      await sleep(40);
    }
    out.push(`📩 ${ok}명에게 1:1로 보냈어요${fail ? ` (못 받은 학생 ${fail}명 — 봇을 차단했을 수 있어요)` : ""}`);
    if (job.ids.length > SEND_MAX) out.push(`⚠️ ${job.ids.length - SEND_MAX}명은 150명을 넘어서 빠졌어요`);
  }
  await kv.set(`job:${job.id}`, job, 60 * 24 * 3600);
  await ctx.editMessageText(`✅ 공고 #${job.id}\n${out.join("\n")}\n🙋 지원한 학생은 바로 알려드릴게요.`, {
    reply_markup: new InlineKeyboard().text("🔒 마감 (자리 다 참)", `p:close:${job.id}`),
  }).catch(() => {});
});

// 마감: 그룹방 공고에 표시 + 버튼 없앰, 1:1 버튼도 더는 안 받음
bot.callbackQuery(/^p:close:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const job = await kv.get(`job:${ctx.match[1]}`);
  if (!job) return ctx.answerCallbackQuery({ text: "공고를 찾을 수 없어요.", show_alert: true });
  job.closed = true;
  await kv.set(`job:${job.id}`, job, 60 * 24 * 3600);
  if (job.group) {
    const text = groupBody(job, true);
    const edit = job.text != null
      ? ctx.api.editMessageText(job.group.chat, job.group.msgId, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: [] } })
      : ctx.api.editMessageCaption(job.group.chat, job.group.msgId, { caption: text.slice(0, 1024), parse_mode: "HTML", reply_markup: { inline_keyboard: [] } });
    await edit.catch(() => {});
  }
  await ctx.answerCallbackQuery({ text: "🔒 마감했어요" });
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
  await ctx.reply(`🔒 공고 #${job.id} 마감했어요.${job.group ? " 그룹방 공고에도 '마감'이 표시됐어요." : ""}`);
});

// 지원 접수 (1:1 버튼이든 그룹방 버튼이든 여기로) → 관리자 알림
async function applyJob(api, from, jobId) {
  const job = await kv.get(`job:${jobId}`);
  const app = await kv.get(K.app(from.id));
  const lang = app?.lang ?? langOf(from.language_code);
  if (!job || job.closed) return { lang, msg: tx(lang, "jobClosed") };
  if (!(await kv.setNX(`jobyes:${jobId}:${from.id}`, 1, 60 * 24 * 3600))) return { lang, msg: tx(lang, "jobYes") };
  const who = app
    ? [`👤 <a href="tg://user?id=${app.id}">${esc(app.name)}</a> · ${esc(app.age)}`, `📞 ${app.phone ? `<code>${esc(app.phone)}</code>` : "한국 번호 없음"}`, `🏫 ${esc(app.school)} · TOPIK ${KO.topik[app.topik] ?? "-"} · 차 ${KO.car[app.car] ?? "-"}`, `📅 수업: ${dayText(app.days)}`]
    : [`👤 <a href="tg://user?id=${from.id}">${esc(fullName(from))}</a>`];
  const first = (job.text ?? job.caption ?? "").split("\n")[0].slice(0, 40);
  for (const a of adminIds()) {
    await api
      .sendMessage(a, [`🙋 <b>공고 #${jobId} 지원</b>${job.dateLabel ? ` · ${job.dateLabel}` : ""}`, `└ ${esc(first)}`, ...who].join("\n"), { ...html, link_preview_options: { is_disabled: true } })
      .catch(() => {});
  }
  return { lang, msg: tx(lang, "jobYes") };
}

// 학생: 1:1 공고에 관심 / 관심 없음
bot.callbackQuery(/^j:(y|n):(\d+)$/, async (ctx) => {
  const [, yn, jobId] = ctx.match;
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
  if (yn === "n") {
    const app = await kv.get(K.app(ctx.from.id));
    return ctx.reply(tx(app?.lang ?? langOf(ctx.from.language_code), "jobNo"));
  }
  const r = await applyJob(ctx.api, ctx.from, jobId);
  return ctx.reply(r.msg);
});

// 연락처 버튼
pm.on("message:contact", async (ctx) => {
  const st = await getState(ctx.from.id);
  if (!st || (st.step !== "phone" && st.step !== "phoneText")) return;
  const c = ctx.message.contact;
  if (c.user_id && c.user_id !== ctx.from.id) return ask(ctx, st); // 다른 사람 연락처
  const p = krPhone(c.phone_number);
  if (!p) {
    st.step = "phoneText";
    await setState(ctx.from.id, st);
    return ask(ctx, st);
  }
  st.data.phone = p;
  return goNext(ctx, st);
});

// 그 외 글
pm.on("message", async (ctx) => {
  const st = await getState(ctx.from.id);
  if (st && ctx.message.text && !ctx.message.text.startsWith("/")) return handleText(ctx, st);
  if (st) return ask(ctx, st);
  if (isAdmin(ctx.from.id)) return ctx.reply(HELP, html);

  const lang = langOf(ctx.from.language_code);
  const app = await kv.get(K.app(ctx.from.id));
  if (!app) return sendGreet(ctx.api, ctx.chat.id, ctx.from, lang);
  // 이미 지원한 학생이 보낸 메시지 → 관리자에게 전달
  for (const a of adminIds()) {
    await ctx.api
      .sendMessage(a, `💬 <b>${esc(app.name)}</b> (<a href="tg://user?id=${app.id}">${esc(app.tgName)}</a>) 님의 메시지:`, html)
      .catch(() => {});
    await ctx.api.copyMessage(a, ctx.chat.id, ctx.message.message_id).catch(() => {});
  }
  return ctx.reply(tx(lang, "msgSent"));
});

// ═════════════ ⏰ 이어서 하기 알림 ═════════════
//  입력을 시작했거나 인사만 받고 멈춘 학생 → 1시간 뒤 1번 + 다음 날 1번 (최대 2번)
//  한국 시간 10~21시에만 보냄. 2일 지나면 포기.
const HOUR = 3600 * 1000;
const hourKST = () => Number(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul", hour: "numeric", hourCycle: "h23" }));

export async function runReminders(api) {
  const h = hourKST();
  if (h < 10 || h >= 22) return 0;
  let sent = 0;
  for (const id of (await kv.smembers(K.pending)) ?? []) {
    const st = await kv.get(K.state(id));
    if (!st) { await kv.srem(K.pending, id); continue; }
    if (st.mode === "days") continue; // 새 학기 요일 질문은 알림 안 함
    const age = Date.now() - (st.at ?? 0);
    if (age > 48 * HOUR) { await clearState(id); continue; }
    const nudged = st.nudged ?? 0;
    const due = (nudged === 0 && age > HOUR) || (nudged === 1 && age > 23 * HOUR);
    if (!due) continue;
    await kv.set(K.state(id), { ...st, nudged: nudged + 1 }, STATE_TTL); // 먼저 표시 (두 번 안 가게)
    const ok = await api
      .sendMessage(st.chat ?? id, tx(st.lang, "remind"), {
        reply_markup: new InlineKeyboard().text(tx(st.lang, "btnContinue"), "c:resume"),
      })
      .then(() => true)
      .catch(() => false); // 봇을 차단한 학생 등
    if (ok) sent++;
    if (nudged + 1 >= 2) await kv.srem(K.pending, id); // 2번 보냈으면 끝 (입력 기록은 남겨 둠)
  }
  return sent;
}

bot.catch((err) => console.error("봇 에러:", err.error));
