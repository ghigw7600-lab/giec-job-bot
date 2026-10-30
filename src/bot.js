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
//   /export    지원자 전체 엑셀(CSV) 받기
//   /help      도움말
// ═════════════════════════════════════════════════════════════
import { Bot, InlineKeyboard, Keyboard, InputFile } from "grammy";
import { kv } from "./storage.js";
import { tx, langOf, KO } from "./text.js";

export const bot = new Bot(process.env.BOT_TOKEN || "0:test");

export const ALLOWED_UPDATES = ["message", "callback_query", "chat_join_request", "my_chat_member"];

// ── 관리자 ──
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
};
const STATE_TTL = 7 * 24 * 3600;
const getState = (id) => kv.get(K.state(id));
const setState = (id, s) => kv.set(K.state(id), s, STATE_TTL);
const clearState = (id) => kv.del(K.state(id));

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const nowKST = (ts = Date.now()) =>
  new Date(ts).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const fullName = (u) => [u?.first_name, u?.last_name].filter(Boolean).join(" ") || "?";
const html = { parse_mode: "HTML" };

// ═════════════ 학생 쪽 ═════════════

// 인사 + 동의 버튼
async function sendGreet(api, chatId, from, lang) {
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
  const st = { step: "name", lang, mode: "full", data: {} };
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
    status: prev ? prev.status ?? "new" : "new",
  };
  await kv.set(K.app(id), app);
  await kv.sadd(K.apps, id);
  await clearState(id);
  await ctx.reply(tx(st.lang, "done"), { reply_markup: { remove_keyboard: true } });
  return notifyAdmins(ctx.api, app, prev ? "✏️ 정보 수정" : "🆕 새 지원자");
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

// 봇이 채널 관리자로 추가됨 → 채널 기억 + 관리자에게 알림
bot.on("my_chat_member", async (ctx) => {
  const chat = ctx.myChatMember.chat;
  const status = ctx.myChatMember.new_chat_member.status;
  if (chat.type !== "channel" || status !== "administrator") return;
  await kv.set(K.channel, { id: chat.id, title: chat.title });
  for (const admin of adminIds()) {
    await ctx.api
      .sendMessage(admin, `✅ 채널 「${esc(chat.title)}」에 봇이 관리자로 연결됐어요.\n이제 /joinlink 로 환영 링크를 받으세요.`, html)
      .catch(() => {});
  }
});

const pm = bot.filter((ctx) => ctx.chat?.type === "private");

// /start
pm.command("start", async (ctx) => {
  const lang = langOf(ctx.from.language_code);
  if (isAdmin(ctx.from.id) && !String(ctx.match).startsWith("test")) return ctx.reply(HELP, html);
  await clearState(ctx.from.id);
  const app = await kv.get(K.app(ctx.from.id));
  if (app) {
    return ctx.reply(tx(lang, "already"), { reply_markup: new InlineKeyboard().text(tx(lang, "btnUpdate"), "c:go") });
  }
  return sendGreet(ctx.api, ctx.chat.id, ctx.from, lang);
});

// ── 관리자 명령어 ──
const HELP = [
  "🛠 <b>GIEC JOB 관리자 메뉴</b>",
  "",
  "/joinlink — 채널 환영 링크 (이 링크로 들어오면 봇이 인사 + 정보 받기)",
  "/pinpost — 채널에 [정보 남기기] 버튼 글 올리고 고정 (이미 있는 학생용)",
  "/export — 지원자 전체 엑셀(CSV)",
  "/start test — 학생 화면 직접 해보기",
  "",
  "새 지원자가 정보를 다 내면 이 대화로 카드가 와요.",
  "카드의 [🟡 연락함] [🟢 소개함] [⚫ 종결] 로 진행 상태를 표시하세요.",
].join("\n");

const admin = pm.filter((ctx) => isAdmin(ctx.from?.id));
admin.command("help", (ctx) => ctx.reply(HELP, html));

admin.command("joinlink", async (ctx) => {
  const ch = await kv.get(K.channel);
  if (!ch) return ctx.reply("⚠️ 아직 채널을 몰라요. 채널 → 관리자 → @GIEC_JOB_bot 을 관리자로 추가해 주세요 (사용자 초대 권한 켜기).");
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
    ].join("\n"),
    { ...html, link_preview_options: { is_disabled: true } }
  );
});

admin.command("pinpost", async (ctx) => {
  const ch = await kv.get(K.channel);
  if (!ch) return ctx.reply("⚠️ 아직 채널을 몰라요. 먼저 봇을 채널 관리자로 추가해 주세요.");
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

admin.command("export", async (ctx) => {
  const ids = (await kv.smembers(K.apps)) ?? [];
  const apps = (await kv.mget(ids.map(K.app))).filter(Boolean).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
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

bot.catch((err) => console.error("봇 에러:", err.error));
