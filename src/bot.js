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
  if (await kv.setNX("cmds:v2", 1, 365 * 24 * 3600).catch(() => false)) await setAdminCommands(ctx.api).catch(() => {});
  // 10분에 한 번, 들어온 메시지를 처리하는 김에 "이어서 하기" 알림도 확인 (따로 예약 서비스 필요 없음)
  if (await kv.setNX("remind:lock", 1, 600).catch(() => false)) await runReminders(ctx.api).catch((e) => console.error("알림 실패:", e.message));
});

// ── 관리자 ──
export const ADMIN_COMMANDS = [
  { command: "find", description: "학생 찾기 → 공고 보내기" },
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
  return saveAndCard(ctx.api, app, `${app.test ? "🧪 테스트 · " : ""}${title}`);
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
  if (isAdmin(ctx.from.id) && !String(ctx.match).startsWith("test")) return ctx.reply(HELP, html);
  await clearState(ctx.from.id);
  const app = await kv.get(K.app(ctx.from.id));
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
  "/find — 학생 찾기 (오늘·내일 일할 사람 등) → 그 학생들에게 공고 보내기",
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
//  /find → 일할 날(오늘·내일·토·일·상관없음) · TOPIK · 차 고르기 → [찾기]
//  "일할 수 있는 날" = 그날 수업이 없는 학생 (일요일은 모두)
//  결과 → [📢 이 학생들에게 공고 보내기] → 공고 글 한 번 → 미리보기 → 보내기
//  학생은 [🙋 관심 있어요] 만 누르면 → 관리자에게 바로 알림 (전화번호 포함)
const WD = ["월", "화", "수", "목", "금", "토", "일"];
const kstDay = (plus = 0) => (new Date(Date.now() + 9 * 3600e3 + plus * DAY).getUTCDay() + 6) % 7; // 월=0 … 일=6
const FIND_TTL = 3600;
const findKey = (a) => `find:${a}`;
const postKey = (a) => `post:${a}`;
const TOPIK_MIN = [["상관없음", 0], ["1급↑", 1], ["3급↑", 2], ["4급↑", 3]];

const findDayLabel = (f) => (f.day == null ? "상관없음" : `${f.dayName} (${WD[f.day]})`);
const findText = (f) =>
  ["🔎 <b>학생 찾기</b>", "", `📅 일할 날: <b>${findDayLabel(f)}</b>`, `📝 TOPIK: <b>${TOPIK_MIN.find((t) => t[1] === f.topik)[0]}</b>`, `🚗 차: <b>${f.car ? "있어야 함" : "상관없음"}</b>`].join("\n");
const mark = (on, label) => (on ? `✅ ${label}` : label);
const findKeyboard = (f) => {
  const kb = new InlineKeyboard();
  [["오늘", 0], ["내일", 1]].forEach(([n, p]) => kb.text(mark(f.dayName === n, n), `f:d:${p}`));
  kb.text(mark(f.dayName === "토", "토"), "f:d:sat").text(mark(f.dayName === "일", "일"), "f:d:sun").text(mark(f.day == null, "상관없음"), "f:d:any").row();
  TOPIK_MIN.forEach(([n, v]) => kb.text(mark(f.topik === v, n), `f:t:${v}`));
  kb.row().text(mark(!f.car, "차 상관없음"), "f:c:0").text(mark(f.car, "차 있어야 함"), "f:c:1");
  return kb.row().text("🔎 찾기", "f:go");
};

admin.command("find", async (ctx) => {
  const f = { day: kstDay(0), dayName: "오늘", topik: 0, car: false };
  await kv.set(findKey(ctx.from.id), f, FIND_TTL);
  return ctx.reply(findText(f), { ...html, reply_markup: findKeyboard(f) });
});

bot.callbackQuery(/^f:(d|t|c):(\w+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  const f = (await kv.get(findKey(ctx.from.id))) ?? { day: kstDay(0), dayName: "오늘", topik: 0, car: false };
  const [, k, v] = ctx.match;
  if (k === "d") {
    if (v === "any") Object.assign(f, { day: null, dayName: null });
    else if (v === "sat") Object.assign(f, { day: 5, dayName: "토" });
    else if (v === "sun") Object.assign(f, { day: 6, dayName: "일" });
    else Object.assign(f, { day: kstDay(Number(v)), dayName: v === "0" ? "오늘" : "내일" });
  }
  if (k === "t") f.topik = Number(v);
  if (k === "c") f.car = v === "1";
  await kv.set(findKey(ctx.from.id), f, FIND_TTL);
  await ctx.editMessageText(findText(f), { ...html, reply_markup: findKeyboard(f) }).catch(() => {});
});

const freeOn = (a, day) => day == null || day === 6 || !(a.days ?? []).includes(day);
export async function findStudents(f) {
  const ids = (await kv.smembers(K.apps)) ?? [];
  return (await kv.mget(ids.map(K.app)))
    .filter((a) => a && !a.test && !isAdmin(a.id) && a.status !== "closed")
    .filter((a) => freeOn(a, f.day) && (a.topik ?? 0) >= f.topik && (!f.car || a.car === 0))
    .sort((a, b) => (b.topik ?? 0) - (a.topik ?? 0) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

const LIST_MAX = 30;
const studentLine = (a, i) =>
  `${i + 1}. <a href="tg://user?id=${a.id}">${esc(a.name)}</a> · ${esc(a.age)} · ${a.phone ? `<code>${esc(a.phone)}</code>` : "번호 없음"} · ${esc(a.school)} · TOPIK ${KO.topik[a.topik] ?? "-"}${a.car === 0 ? " · 🚗" : ""}${a.status === "introduced" ? " · 🟢" : ""}`;

bot.callbackQuery("f:go", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  const f = (await kv.get(findKey(ctx.from.id))) ?? { day: kstDay(0), dayName: "오늘", topik: 0, car: false };
  const list = await findStudents(f);
  await kv.set(findKey(ctx.from.id), { ...f, ids: list.map((a) => a.id) }, FIND_TTL);
  const head = `🔎 <b>조건에 맞는 학생 ${list.length}명</b>\n📅 ${findDayLabel(f)} · TOPIK ${TOPIK_MIN.find((t) => t[1] === f.topik)[0]} · 차 ${f.car ? "있어야 함" : "상관없음"}`;
  if (!list.length) return ctx.reply(`${head}\n\n조건을 바꿔서 다시 /find 해보세요.`, html);
  const lines = list.slice(0, LIST_MAX).map(studentLine);
  if (list.length > LIST_MAX) lines.push(`… 외 ${list.length - LIST_MAX}명 (공고는 ${list.length}명 모두에게 가요)`);
  return ctx.reply([head, "", ...lines, "", "🚗 = 차 있음 · 🟢 = 이미 일 소개받은 학생", "이름을 누르면 그 학생과 대화로 가요."].join("\n"), {
    ...html,
    link_preview_options: { is_disabled: true },
    reply_markup: new InlineKeyboard().text(`📢 이 ${list.length}명에게 공고 보내기`, "p:new"),
  });
});

// 공고 쓰기
bot.callbackQuery("p:new", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  const f = await kv.get(findKey(ctx.from.id));
  if (!f?.ids?.length) return ctx.reply("찾은 학생 목록이 사라졌어요. /find 부터 다시 해주세요.");
  await kv.set(postKey(ctx.from.id), { ids: f.ids, step: "text" }, 1800);
  return ctx.reply(
    [
      `📢 <b>공고 쓰기</b> — ${f.ids.length}명에게 보내요`,
      "",
      "공고 내용을 <b>메시지 한 개</b>로 보내주세요. (사진 + 설명도 가능)",
      "예) <code>11/3(월) 18~22시 · 파주 운정 식당 서빙 · 시급 12,000원</code>",
      "한국어로 써도 되고, 봇이 앞뒤에 우즈벡어 안내와 [🙋 관심 있어요] 버튼을 붙여요.",
      "",
      "그만두려면 /cancel",
    ].join("\n"),
    html
  );
});

admin.command("cancel", async (ctx) => {
  await kv.del(postKey(ctx.from.id));
  return ctx.reply("취소했어요.");
});

// 학생에게 보내는 공고 모양
const jobMarkup = (lang, jobId) =>
  new InlineKeyboard().text(tx(lang, "btnJobYes"), `j:y:${jobId}`).text(tx(lang, "btnJobNo"), `j:n:${jobId}`);
async function sendJob(api, chatId, lang, job) {
  // 한 학생에게 메시지 1개 (빨리 보내려고): 안내 + 공고 + 버튼
  const body = (t) => [tx(lang, "jobHead"), "", esc(t), "", tx(lang, "jobFoot")].join("\n").replace(/\n{3,}/g, "\n\n");
  const opts = { parse_mode: "HTML", reply_markup: jobMarkup(lang, job.id), link_preview_options: { is_disabled: true } };
  if (job.text != null) return api.sendMessage(chatId, body(job.text), opts);
  return api.copyMessage(chatId, job.from, job.msgId, { ...opts, caption: body(job.caption ?? "").slice(0, 1024) });
}

// 관리자가 공고 글을 보냄 → 미리보기
admin.on("message", async (ctx, next) => {
  const p = await kv.get(postKey(ctx.from.id));
  if (!p || p.step !== "text" || ctx.message.text?.startsWith("/")) return next();
  const jobId = await kv.incr("jobseq");
  const m = ctx.message;
  if (m.text == null && !(m.photo || m.video || m.document || m.animation)) return ctx.reply("글이나 사진(+설명)으로 보내주세요. 그만두려면 /cancel");
  const job = { id: jobId, from: ctx.chat.id, msgId: m.message_id, text: m.text ?? null, caption: m.caption ?? "", ids: p.ids, by: fullName(ctx.from), at: Date.now() };
  await kv.set(`job:${jobId}`, job, 30 * 24 * 3600);
  await kv.set(postKey(ctx.from.id), { ...p, step: "confirm", jobId }, 1800);
  await ctx.reply("👀 <b>학생에게는 이렇게 보여요</b> (우즈벡어 안내 + 버튼이 붙어요)", html);
  await sendJob(ctx.api, ctx.chat.id, "uz", job);
  return ctx.reply(`📢 공고 #${jobId}를 ${p.ids.length}명에게 보낼까요?`, {
    reply_markup: new InlineKeyboard().text(`✅ ${p.ids.length}명에게 보내기`, `p:send:${jobId}`).text("❌ 취소", "p:cancel"),
  });
});

bot.callbackQuery("p:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  await kv.del(postKey(ctx.from.id));
  await ctx.editMessageText("취소했어요.").catch(() => {});
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEND_MAX = 150; // 한 번에 보내는 최대 인원 (텔레그램 속도 제한 · 서버 1분 제한)

bot.callbackQuery(/^p:send:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const job = await kv.get(`job:${ctx.match[1]}`);
  const p = await kv.get(postKey(ctx.from.id));
  if (!job || p?.jobId !== job.id) return ctx.answerCallbackQuery({ text: "이미 보냈거나 취소된 공고예요.", show_alert: true });
  await kv.del(postKey(ctx.from.id)); // 두 번 눌러도 한 번만
  await ctx.answerCallbackQuery({ text: "보내는 중…" });
  await ctx.editMessageText(`📤 공고 #${job.id} 보내는 중…`).catch(() => {});
  const apps = (await kv.mget(job.ids.slice(0, SEND_MAX).map(K.app))).filter(Boolean);
  let ok = 0;
  let fail = 0;
  for (const a of apps) {
    try {
      await sendJob(ctx.api, a.id, a.lang ?? "uz", job);
      ok++;
    } catch {
      fail++; // 봇을 차단한 학생 등
    }
    await sleep(40);
  }
  const more = job.ids.length > SEND_MAX ? `\n⚠️ ${job.ids.length - SEND_MAX}명은 한 번에 보낼 수 있는 수(150명)를 넘어서 빠졌어요. 조건을 좁혀서 다시 보내주세요.` : "";
  await ctx.editMessageText(`✅ 공고 #${job.id}를 ${ok}명에게 보냈어요.${fail ? ` (못 받은 학생 ${fail}명 — 봇을 차단했을 수 있어요)` : ""}${more}\n🙋 관심 누른 학생은 바로 알려드릴게요.`).catch(() => {});
});

// 학생: 공고에 관심 / 관심 없음
bot.callbackQuery(/^j:(y|n):(\d+)$/, async (ctx) => {
  const [, yn, jobId] = ctx.match;
  const app = await kv.get(K.app(ctx.from.id));
  const lang = app?.lang ?? langOf(ctx.from.language_code);
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
  if (yn === "n") return ctx.reply(tx(lang, "jobNo"));
  if (!(await kv.setNX(`jobyes:${jobId}:${ctx.from.id}`, 1, 30 * 24 * 3600))) return; // 두 번 눌러도 한 번
  await ctx.reply(tx(lang, "jobYes"));
  const who = app
    ? [`👤 <a href="tg://user?id=${app.id}">${esc(app.name)}</a> · ${esc(app.age)}`, `📞 ${app.phone ? `<code>${esc(app.phone)}</code>` : "한국 번호 없음"}`, `🏫 ${esc(app.school)} · TOPIK ${KO.topik[app.topik] ?? "-"} · 차 ${KO.car[app.car] ?? "-"}`, `📅 수업: ${dayText(app.days)}`]
    : [`👤 <a href="tg://user?id=${ctx.from.id}">${esc(fullName(ctx.from))}</a>`];
  for (const a of adminIds()) {
    await ctx.api.sendMessage(a, [`🙋 <b>공고 #${jobId}에 관심 있어요</b>`, ...who].join("\n"), { ...html, link_preview_options: { is_disabled: true } }).catch(() => {});
  }
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
