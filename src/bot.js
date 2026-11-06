// ═════════════════════════════════════════════════════════════
//  GIEC JOB 봇 (@GIEC_JOB_bot)
//
//  흐름: 채널 가입 요청 → 봇이 1:1 인사 + 자동 승인 → 9단계 입력 → 혜승에게 카드
//   1 이름(입력) 2 나이(입력) 3 성별 4 연락처(버튼, 한국 번호 아니면 010 입력)
//   5 학교(입력) 6 TOPIK 7 IELTS 8 자동차 9 수업 요일(여러 개 선택)
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
import { tx, langOf, KO, LANGS, LANG_BTN, langName } from "./text.js";

export const bot = new Bot(process.env.BOT_TOKEN || "0:test");

export const ALLOWED_UPDATES = ["message", "callback_query", "chat_join_request", "my_chat_member"];

// 같은 메시지를 텔레그램이 다시 보내도 한 번만 처리 (카드 두 장 방지)
bot.use(async (ctx, next) => {
  const id = ctx.update.update_id;
  if (id != null && !(await kv.setNX(`upd:${id}`, 1, 600).catch(() => true))) return;
  await refreshChanAdmins(ctx.api).catch(() => {});
  await next();
  // 관리자 메뉴(입력창 / 목록)를 새 명령어로 한 번 갱신
  if (await kv.setNX("cmds:v4", 1, 365 * 24 * 3600).catch(() => false)) {
    await setAdminCommands(ctx.api).catch(() => {});
    await setMenuButtons(ctx.api).catch(() => {});
  }
  // 10분에 한 번, 들어온 메시지를 처리하는 김에 "이어서 하기" 알림도 확인 (따로 예약 서비스 필요 없음)
  if (await kv.setNX("remind:lock", 1, 600).catch(() => false)) await runReminders(ctx.api).catch((e) => console.error("알림 실패:", e.message));
});

// ── 관리자 ──
export const ADMIN_COMMANDS = [
  { command: "find", description: "공고 올리기 (긴급·일반) · 학생 찾기" },
  { command: "jobs", description: "관리 화면 열기 (공고·학생·현황)" },
  { command: "joinlink", description: "그룹 환영 링크" },
  { command: "pinpost", description: "정보 남기기 버튼 글 고정" },
  { command: "export", description: "지원자 엑셀(CSV)" },
  { command: "help", description: "도움말" },
];
// 입력창 왼쪽 메뉴 버튼: 학생 = [💼 Ish] 공고판 · 관리자 = [🛠 관리] 관리 미니앱
export async function setMenuButtons(api) {
  if (!baseUrl()) return;
  await api.setChatMenuButton({ menu_button: { type: "web_app", text: "💼 Ish", web_app: { url: boardUrl() } } });
  for (const id of adminIds()) {
    await api.setChatMenuButton({ chat_id: id, menu_button: { type: "web_app", text: "🛠 관리", web_app: { url: adminAppUrl() } } }).catch(() => {});
  }
}
async function setAdminCommands(api) {
  for (const id of adminIds()) await api.setMyCommands(ADMIN_COMMANDS, { scope: { type: "chat", chat_id: id } }).catch(() => {});
}
const adminIds = () =>
  (process.env.ADMIN_IDS || "8512697683")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter(Boolean);
// 채널 관리자 = 관리자 (11-05 대표 요청): 혜승이 채널에서 관리자로 올리면 그 사람도 관리 미니앱·관리 메뉴를 씀
//  ADMIN_IDS(혜승·대표)는 항상 관리자, 채널 관리자는 5분마다 다시 확인 (내리면 빠짐). 지원 알림은 ADMIN_IDS에게만.
let chanAdmins = new Set();
let chanAdminsAt = 0;
export async function refreshChanAdmins(api, force = false) {
  if (!force && Date.now() - chanAdminsAt < 5 * 60e3) return;
  chanAdminsAt = Date.now();
  const ch = await kv.get("channel");
  if (!ch?.id) return;
  const list = await api.getChatAdministrators(ch.id).catch(() => null);
  if (!list) return;
  const now = new Set(list.filter((m) => !m.user.is_bot).map((m) => Number(m.user.id)));
  chanAdmins = now;
  const before = new Set((await kv.get("chanadmins")) ?? []);
  const added = [...now].filter((id) => !before.has(id) && !adminIds().includes(id));
  const removed = [...before].filter((id) => !now.has(id) && !adminIds().includes(id));
  if (!added.length && !removed.length && before.size) return;
  await kv.set("chanadmins", [...now]);
  for (const id of added) {
    await api.setMyCommands(ADMIN_COMMANDS, { scope: { type: "chat", chat_id: id } }).catch(() => {});
    if (adminAppUrl()) await api.setChatMenuButton({ chat_id: id, menu_button: { type: "web_app", text: "🛠 관리", web_app: { url: adminAppUrl() } } }).catch(() => {});
  }
  for (const id of removed) {
    await api.deleteMyCommands({ scope: { type: "chat", chat_id: id } }).catch(() => {});
    await api.setChatMenuButton({ chat_id: id, menu_button: { type: "web_app", text: "💼 Ish", web_app: { url: boardUrl() } } }).catch(() => {});
  }
}
export const isAdmin = (id) => adminIds().includes(Number(id)) || chanAdmins.has(Number(id));
// 알림 받는 사람 = ADMIN_IDS + 채널 관리자(대표 포함) (11-05: 대표에게 지원 알림이 안 오던 것 고침)
export async function notifyIds(api) {
  await refreshChanAdmins(api).catch(() => {});
  return [...new Set([...adminIds(), ...chanAdmins])];
}

// ── 저장 ──
const K = {
  state: (id) => `state:${id}`, // 입력 중인 단계
  app: (id) => `app:${id}`, // 다 낸 지원 정보
  apps: "apps", // 지원자 id 목록
  channel: "channel", // 봇이 관리자로 있는 채널 { id, title }
  joinlink: "joinlink:open", // 승인 없는 보통 링크 (예전 승인 링크는 "joinlink")
  pending: "pending", // 입력을 시작했거나 인사만 받은 학생 (아직 다 안 냄)
  jobs: "jobs", // 공고 번호 목록
  jobApps: (id) => `jobapps:${id}`, // 그 공고 지원자 id 목록
  jobApp: (id, uid) => `jobapp:${id}:${uid}`, // 지원 시각 등
};
const JOB_TTL = 120 * 24 * 3600;
// 미니앱 주소 (Vercel 이 알려주는 내 주소)
export const baseUrl = () =>
  process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null);
const adminAppUrl = (hash = "") => (baseUrl() ? `${baseUrl()}/admin/${hash ? `#${hash}` : ""}` : null);
const boardUrl = () => (baseUrl() ? `${baseUrl()}/jobs/` : null);
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
// 학생 언어: 직접 고른 언어가 있으면 그것, 없으면 텔레그램 앱 언어
const getLang = async (from) => (await kv.get(`lang:${from?.id}`)) ?? langOf(from?.language_code);

// ═════════════ 학생 쪽 ═════════════

// 인사 + 동의 버튼
async function sendGreet(api, chatId, from, lang) {
  await setState(from.id, { step: "greet", lang, mode: "full", data: {}, chat: chatId, nudged: 0 });
  await api.sendMessage(chatId, tx(lang, "greet").replace("{name}", esc(from.first_name ?? "")), {
    ...html,
    reply_markup: new InlineKeyboard().text(tx(lang, "btnStart"), "c:go").row().text(LANG_BTN, "c:lang"),
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
    case "gender":
      return ctx.reply(tx(lang, "gender"), { ...html, reply_markup: opts("genderOpts", "gender") });
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

const next = { name: "age", age: "gender", gender: "phone", phone: "school", phoneText: "school", school: "topik", topik: "days" }; // 2026-11-03: IELTS·자동차는 안 물음 (대표·혜승 결정)
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
    guest: false, // 정보 없이 지원했던 학생이 정보를 내면 일반 학생으로
  };
  await clearState(id);
  await ctx.reply(tx(st.lang, "done"), { reply_markup: { remove_keyboard: true } });
  if (boardUrl()) await ctx.reply(tx(st.lang, "wbOpenHint"), { reply_markup: new InlineKeyboard().webApp(tx(st.lang, "wbOpen"), boardUrl()) }).catch(() => {});
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
  contacted: "🟡 연락완료",
  introduced: "🟢 연결완료",
  closed: "⚫ 종결",
};
// 일한 기록 표시: ⭐ 출근 3번 이상 + 빵꾸 0 · ⚠️ 빵꾸 2번 이상
export const relBadge = (a) => ((a.workNo ?? 0) >= 2 ? "⚠️" : (a.workOk ?? 0) >= 3 && !(a.workNo ?? 0) ? "⭐" : "");
const workLine = (a) => (a.workOk || a.workNo ? `📈 일한 기록: 출근 ${a.workOk ?? 0} · 빵꾸 ${a.workNo ?? 0} ${relBadge(a)}`.trim() : null);
const dayText = (days) => (days?.length ? [...days].sort().map((i) => KO.days[i]).join("·") : "없음");

export function cardText(app, title) {
  const line = "──────────────";
  const tg = `<a href="tg://user?id=${app.id}">${esc(app.tgName)}</a>${app.username ? ` (@${esc(app.username)})` : ""}`;
  const st = STATUS[app.status] ?? STATUS.new;
  return [
    `<b>${title}</b>`,
    line,
    `👤 이름: <b>${esc(app.name)}</b>`,
    `🎂 나이: ${esc(app.age)} · ${KO.gender[app.gender] ?? "성별 미입력"}`,
    `📞 연락처: ${app.phone ? `<code>${esc(app.phone)}</code>` : "한국 번호 없음"}`,
    `🏫 학교: ${esc(app.school)}`,
    `📝 TOPIK: ${KO.topik[app.topik] ?? "-"}`,
    ...(app.ielts != null ? [`🇬🇧 IELTS: ${KO.ielts[app.ielts] ?? "-"}`] : []), // 예전 학생만
    ...(app.car != null ? [`🚗 자동차: ${KO.car[app.car] ?? "-"}`] : []),
    `📅 수업 요일: ${dayText(app.days)}`,
    `💬 텔레그램: ${tg}`,
    ...(workLine(app) ? [workLine(app)] : []),
    `🌐 언어: ${langName(app.lang)}`,
    line,
    `상태: ${st}${app.statusBy ? ` — ${esc(app.statusBy)} · ${nowKST(app.statusAt)}` : ""}`,
    `🕐 ${nowKST(app.updatedAt ?? app.createdAt)}`,
  ].join("\n");
}

const cardKeyboard = (id) => {
  const kb = cardKeyboardBase(id);
  if (!adminAppUrl()) kb.inline_keyboard.pop(); // 미니앱 주소가 없으면 마지막 줄(관리 화면) 빼기
  return kb;
};
const cardKeyboardBase = (id) =>
  new InlineKeyboard()
    .text("🟡 연락완료", `a:st:contacted:${id}`)
    .text("🟢 연결완료", `a:st:introduced:${id}`)
    .row()
    .text("🔄 수업 요일 다시 받기", `a:days:${id}`)
    .row()
    .webApp("📋 관리 화면에서 보기", adminAppUrl(`stu=${id}`) ?? "https://t.me");

async function notifyAdmins(api, app, title) {
  for (const admin of await notifyIds(api)) {
    await api
      .sendMessage(admin, cardText(app, title), { ...html, reply_markup: cardKeyboard(app.id), link_preview_options: { is_disabled: true } })
      .catch((e) => console.error(`카드 전송 실패(${admin}):`, e.description ?? e.message));
  }
}

// ═════════════ 업데이트 처리 ═════════════

// 채널 가입 요청 (예전 승인 링크) → 바로 승인만 (2026-11-03 혜승 요청: 들어올 때 정보 입력 안 시킴)
//   정보는 공고의 [🙋 지원하기]를 누를 때 받음. 지금 환영 링크는 승인 없는 보통 링크.
bot.on("chat_join_request", async (ctx) => {
  const req = ctx.chatJoinRequest;
  const ch = await kv.get(K.channel);
  // 그룹 → 채널로 옮기는 동안 예전 방 가입 요청도 승인 (봇이 관리자인 방이면 모두 GIEC JOB 방)
  if (!ch) await kv.set(K.channel, { id: req.chat.id, title: req.chat.title, type: req.chat.type });
  await ctx.api.approveChatJoinRequest(req.chat.id, req.from.id).catch((e) => console.error("승인 실패:", e.description));
});

// 채널·그룹 (GIEC JOB 방은 그룹일 수도 있음)
const ROOM_TYPES = ["channel", "group", "supergroup"];
async function rememberRoom(api, chat) {
  const ch = await kv.get(K.channel);
  if (ch && Number(ch.id) === chat.id) return;
  await kv.set(K.channel, { id: chat.id, title: chat.title, type: chat.type });
  // 방이 바뀜 (예: 그룹 → 새 채널) → 환영 링크·고정글은 새 방 기준으로 다시 만들게 비움
  await kv.del(K.joinlink);
  await kv.del("pinmsg");
  for (const admin of adminIds()) {
    await api
      .sendMessage(
        admin,
        `✅ 「${esc(chat.title)}」(${chat.type === "channel" ? "채널" : "그룹"})에 봇이 관리자로 연결됐어요.\n앞으로 공고·고정글·환영 링크는 이 방 기준이에요.\n👉 /joinlink 로 새 환영 링크를 받고, /pinpost 로 고정글을 올려주세요.`,
        html
      )
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
  // 📌 채널 글이 연결된 그룹방으로 넘어오면 텔레그램이 자동으로 고정함 → 공고·남은 인원·모집 완료 글은 바로 고정 해제 (11-05 대표 요청)
  //    /pinpost 고정글만 그대로 둠
  if (m.is_automatic_forward) {
    const pin = await kv.get("pinmsg");
    if (m.forward_origin?.message_id && m.forward_origin.message_id === pin) return;
    await ctx.api.unpinChatMessage(chat.id, m.message_id).catch(() => {});
    // 채널 글의 그룹방 사본 번호 기억 (이벤트 글 끌올 때 예전 사본도 같이 지우려고, 2일)
    if (m.forward_origin?.message_id) await kv.set(`fwdcopy:${m.forward_origin.message_id}`, { chat: chat.id, msgId: m.message_id }, 2 * 24 * 3600);
    return;
  }
  if (m.new_chat_members || m.left_chat_member) {
    // 참여·퇴장 알림은 봇이 바로 지움 (2026-11-02 대표 결정 — 다시 켬). 끄려면 Vercel 환경변수 HIDE_JOINS=0
    if (process.env.HIDE_JOINS !== "0") await ctx.deleteMessage().catch(() => {});
    // 안전망: 봇 환영 링크가 아닌 다른 링크로 들어온 학생(봇이 1:1 인사를 못 보낸 학생)
    //  → 그룹에 조용히(알림 없이) 이름을 불러 [정보 남기기] 버튼 → 10분 뒤 자동으로 지움
    // (2026-11-02 대표 결정: 끔 — 고정글로 충분. 다시 켜려면 GROUP_HELLO=1 환경변수)
    const helloOn = process.env.GROUP_HELLO === "1";
    for (const u of helloOn ? m.new_chat_members ?? [] : []) {
      if (u.is_bot || isAdmin(u.id)) continue;
      if ((await kv.get(K.app(u.id))) || (await kv.get(K.state(u.id)))) continue; // 이미 정보를 냈거나 인사를 받은 학생
      const lang = await getLang(u);
      const msg = await ctx.api
        .sendMessage(chat.id, tx(lang, "groupHello").replace("{name}", `<a href="tg://user?id=${u.id}">${esc(u.first_name ?? "")}</a>`), {
          parse_mode: "HTML",
          disable_notification: true,
          reply_markup: new InlineKeyboard().url(tx(lang, "btnPin"), `https://t.me/${ctx.me.username}?start=apply`),
        })
        .catch(() => null);
      if (msg) await kv.rpush("tmpmsg", { chat: chat.id, id: msg.message_id, at: Date.now() }, 7 * 24 * 3600);
    }
    return;
  }
  const ch = await kv.get(K.channel);
  if (!ch && isAdmin(ctx.from?.id)) await rememberRoom(ctx.api, chat);
});

const pm = bot.filter((ctx) => ctx.chat?.type === "private");

// /start
pm.command("start", async (ctx) => {
  const lang = await getLang(ctx.from);
  const payload = String(ctx.match ?? "");
  if (payload === "ref") return sendReferral(ctx, lang); // 🤝 친구 소개 링크 (관리자도 확인용으로 받음)
  if (isAdmin(ctx.from.id) && !payload.startsWith("test") && !payload.startsWith("job_")) return ctx.reply(HELP, html);
  await clearState(ctx.from.id);
  const app = await kv.get(K.app(ctx.from.id));
  // 그룹방 공고의 [🙋 지원하기]로 들어옴
  if (payload === "jobs" && boardUrl()) {
    return ctx.reply(tx(lang, "wbOpenHint"), { reply_markup: new InlineKeyboard().webApp(tx(lang, "wbOpen"), boardUrl()) });
  }
  const jobId = /^job_(\d+)$/.exec(payload)?.[1];
  if (jobId) {
    const job = await kv.get(`job:${jobId}`);
    // 모든 공고 = 자기소개서 먼저 (2026-11-04 대표 결정, 한 번 쓴 학생은 바로 지원)
    if (app && !app.guest) return ctx.reply((await applyJob(ctx.api, ctx.from, jobId)).msg);
    await kv.set(`wantjob:${ctx.from.id}`, Number(jobId), 7 * 24 * 3600); // 정보를 다 내면 자동으로 지원
  }
  if (app && !app.guest) {
    return ctx.reply(tx(lang, "already"), {
      reply_markup: new InlineKeyboard().text(tx(lang, "btnAgain"), "c:again").row().text(tx(lang, "btnUpdate"), "c:go"),
    });
  }
  return sendGreet(ctx.api, ctx.chat.id, ctx.from, lang);
});

// ═════════════ 🤝 친구 소개 이벤트 ═════════════
//   학생마다 GIECbot 개인 소개 링크: t.me/GIECbot?start=go-fr<텔레그램번호 36진수>
//   친구가 이 링크로 GIECbot 상담신청 → GIEC 직접 상담방(대표)으로, 추천인 = 이 학생 (GIECbot이 jobbot:app 기록에서 이름을 읽음)
const GIECBOT = () => process.env.GIECBOT_USERNAME || "GIECbot";
export const referralLink = (id) => `https://t.me/${GIECBOT()}?start=go-fr${Number(id).toString(36)}`;
async function sendReferral(ctx, lang) {
  const link = referralLink(ctx.from.id);
  await kv.sadd("referrers", ctx.from.id); // 링크를 받아 간 학생 (나중에 집계용)
  const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(tx(lang, "refShare"))}`;
  return ctx.reply(tx(lang, "refIntro").replace("{link}", link), {
    ...html,
    reply_markup: new InlineKeyboard().url(tx(lang, "refBtn"), share),
    link_preview_options: { is_disabled: true },
  });
}
// 학생 누구나 /ref 로도 받을 수 있음
pm.command("ref", async (ctx) => sendReferral(ctx, await getLang(ctx.from)));

// ── 관리자 명령어 ──
const HELP = [
  "🛠 <b>GIEC JOB 관리자 메뉴</b>",
  "",
  "/joinlink — 채널 환영 링크 (이 링크로 들어오면 봇이 인사 + 정보 받기)",
  "/pinpost — 채널에 [정보 남기기] 버튼 글 올리고 고정 (이미 있는 학생용)",
  "/refpost — 🤝 친구 소개 이벤트 포스터를 채널에 올리기 ([🎓 비자 전환] [🔗 내 소개 링크] 버튼이 붙음, 매일 저녁 9시 끌올 · 끄기 /refstop · 상태 /refdaily)",
  "/jobs — 🛠 관리 화면 (공고별 지원자·모집 완료·다시 올리기·출근 기록 / 학생 표 / 현황) — 입력창 왼쪽 [🛠 관리] 버튼과 같아요",
  "/find — 공고 올리기: 🚨 긴급(오늘·내일) / 📅 일반(5일 안) → 학생 찾기 → 그룹방·1:1로 보내기 → ✅ 모집 완료",
  "/export — 지원자 전체 엑셀(CSV)",
  "/start test — 학생 화면 직접 해보기 (기록은 🧪 테스트로 표시, 엑셀에서 빠짐)",
  "/reset — 내 테스트 기록 지우기",
  "/delete 숫자ID — 학생 정보 지우기 (학생이 삭제를 요청할 때, 숫자ID는 엑셀 맨 오른쪽 칸)",
  "",
  "새 지원자가 정보를 다 내면 이 대화로 카드가 와요.",
  "카드의 [🟡 연락완료] [🟢 연결완료] 로 진행 상태를 표시하세요.",
].join("\n");

const admin = pm.filter((ctx) => isAdmin(ctx.from?.id));
admin.command("help", (ctx) => ctx.reply(HELP, html));

admin.command("joinlink", async (ctx) => {
  const ch = await kv.get(K.channel);
  if (!ch) return ctx.reply("⚠️ 아직 방을 몰라요. GIEC JOB 그룹(채널)에 @GIEC_JOB_bot 을 관리자로 추가한 뒤, 그 방에 아무 글이나 한 줄 써 주세요 (예: 안녕). 봇이 그 방을 기억해요.");
  const fresh = String(ctx.match ?? "").trim() === "new";
  if (fresh) await kv.del(K.joinlink);
  let link;
  {
    try {
      link = await getJoinLink(ctx.api, ch);
    } catch (e) {
      return ctx.reply(`⚠️ 링크를 못 만들었어요: ${e.description ?? e.message}\n채널 관리자 설정에서 봇의 "사용자 초대" 권한을 켜 주세요.`);
    }
  }
  return ctx.reply(
    [
      `👋 <b>환영 링크</b> — ${esc(ch.title)}`,
      `<code>${link}</code>`,
      "",
      "누르면 승인 없이 바로 채널에 들어가요 (정보 입력 없음).",
      "정보는 학생이 공고의 [🙋 지원하기]나 고정글 [📝 정보 남기기]를 누를 때 받아요.",
      "예전 승인 링크로 들어오는 요청도 봇이 바로 승인해요.",
    ].join("\n"),
    { ...html, link_preview_options: { is_disabled: true } }
  );
});

// 환영 링크 (승인 없는 보통 초대 링크, 2026-11-03~) — 없으면 만듦
//   예전 승인 링크와 섞이지 않게 저장 칸 이름을 바꿈 (joinlink → joinlink:open)
async function getJoinLink(api, ch) {
  let link = await kv.get(K.joinlink);
  if (!link) {
    const r = await api.createChatInviteLink(ch.id, { name: "GIEC JOB 환영 링크" });
    link = r.invite_link;
    await kv.set(K.joinlink, link);
  }
  return link;
}

// /pinpost : 그룹 고정글 (봇 신청 버튼 + 친구 초대 링크·공유 버튼) + 그룹 소개글에도 봇·링크
//  다시 보내면 예전 봇 고정글은 고정 해제하고 새로 고정
admin.command("pinpost", async (ctx) => {
  const ch = await kv.get(K.channel);
  if (!ch) return ctx.reply("⚠️ 아직 방을 몰라요. 먼저 /joinlink 안내대로 방을 연결해 주세요.");
  let link;
  try {
    link = await getJoinLink(ctx.api, ch);
  } catch (e) {
    return ctx.reply(`⚠️ 초대 링크를 못 만들었어요: ${e.description ?? e.message}\n봇의 "링크를 통해 사용자 초대" 권한을 확인해 주세요.`);
  }
  const botName = ctx.me.username;
  const text = [
    "💼 <b>GIEC JOB</b>",
    "",
    "🇰🇷 일자리를 받으려면 봇에 자기소개서를 남겨주세요 (1분)",
    "🇺🇿 Ish takliflarini olish uchun botda «O'zim haqimda» ni to'ldiring (1 daqiqa)",
    "🇰🇬 Жумуш сунуштарын алуу үчүн ботто «Өзүм жөнүндө» толтуруңуз (1 мүнөт)",
    "",
    `🤖 @${botName}`,
    "",
    "👥 친구 초대 · Do'stlarni taklif qilish · Досторду чакыруу",
    link,
  ].join("\n");
  const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("💼 GIEC JOB — Koreyada talabalar uchun ish")}`;
  const kb = new InlineKeyboard()
    .url("📝 자기소개서 쓰기 · O'zim haqimda", `https://t.me/${botName}?start=apply`)
    .row()
    .url("💼 모집 중인 일 · Ishlar ro'yxati", boardLink(botName))
    .row()
    .url("📤 친구에게 보내기 · Do'stlarga yuborish", share);
  try {
    const old = await kv.get("pinmsg");
    if (old) await ctx.api.unpinChatMessage(ch.id, old).catch(() => {});
    const msg = await ctx.api.sendMessage(ch.id, text, { ...html, reply_markup: kb, link_preview_options: { is_disabled: true } });
    await ctx.api.pinChatMessage(ch.id, msg.message_id, { disable_notification: true }).catch(() => {});
    await kv.set("pinmsg", msg.message_id);
  } catch (e) {
    return ctx.reply(`⚠️ 그룹에 못 올렸어요: ${e.description ?? e.message}\n봇의 "메시지 고정" 권한을 확인해 주세요.`);
  }
  // 그룹 소개글(그룹 이름 눌렀을 때 보이는 글)에도 봇·초대 링크
  const desc = `💼 일자리 신청 · Ish uchun ariza: @${botName}\n👥 친구 초대 · Taklif havolasi: ${link}`;
  // 원래 소개글은 지우지 않고 아래에 붙임 (이미 붙어 있으면 링크만 새로)
  const cur = ((await ctx.api.getChat(ch.id).catch(() => ({})))?.description ?? "").split("\n💼 일자리 신청")[0].trim();
  const full = (cur ? `${cur}\n${desc}` : desc).slice(0, 255);
  const descOk = await ctx.api.setChatDescription(ch.id, full).then(() => true).catch((e) => /not modified/i.test(e.description ?? ""));
  return ctx.reply(
    `✅ 그룹에 고정글을 올렸어요 (봇 신청 버튼 + 친구 초대 링크·공유 버튼).${descOk ? "\n✅ 그룹 소개글에도 봇과 초대 링크를 넣었어요." : "\n⚠️ 그룹 소개글은 못 바꿨어요 (봇의 '그룹 정보 수정' 권한 확인)."}`
  );
});

// /refpost : 🤝 친구 소개 이벤트 포스터 → 채널 (버튼 2개)
//   [🎓 비자 전환] = GIECbot 직접 상담 (추천인 없음, 채널 학생 본인 D-4→D-2용)
//   [🔗 내 소개 링크] = 이 봇이 학생마다 GIECbot 개인 소개 링크를 줌 → 친구에게 보내기
//  쓰는 법: /refpost → 포스터 사진(+설명 글)을 보냄 → 미리보기 → [✅ 채널에 올리기]
//          (사진 설명 칸에 /refpost 를 쓰고 바로 보내도 됨)
const refKey = (id) => `refpost:${id}`;
const refKeyboard = (botName) =>
  new InlineKeyboard()
    .url("🎓 Viza o'zgartirish · Смена визы", `https://t.me/${GIECBOT()}?start=go-fr`)
    .row()
    .url("🔗 Taklif havolam · Моя ссылка", `https://t.me/${botName}?start=ref`);
const isPoster = (m) => !!(m.photo || m.document || m.video || m.animation);
async function refPreview(ctx, m, caption) {
  await kv.set(refKey(ctx.from.id), { step: "ready", from: ctx.chat.id, msgId: m.message_id, caption }, 24 * 3600);
  await ctx.api.copyMessage(ctx.chat.id, ctx.chat.id, m.message_id, {
    reply_markup: refKeyboard(ctx.me.username),
    ...(caption != null ? { caption } : {}),
  });
  return ctx.reply("👆 미리보기예요. 이대로 채널에 올릴까요?", {
    reply_markup: new InlineKeyboard().text("✅ 채널에 올리기", "rp:ok").text("❌ 취소", "rp:no"),
  });
}
admin.command("refpost", async (ctx) => {
  const m = ctx.message;
  if (isPoster(m)) return refPreview(ctx, m, (m.caption ?? "").replace(/^\/refpost(@\w+)?\s*/i, ""));
  await kv.set(refKey(ctx.from.id), { step: "wait" }, 3600);
  return ctx.reply("🤝 친구 소개 포스터를 보내 주세요 (사진, 설명 글은 사진 아래 칸에).\n그만두려면 /cancel");
});
admin.on("message", async (ctx, next) => {
  const r = await kv.get(refKey(ctx.from.id));
  if (r?.step !== "wait" || ctx.message.text?.startsWith("/")) return next();
  if (!isPoster(ctx.message)) return ctx.reply("포스터 사진으로 보내 주세요. 그만두려면 /cancel");
  return refPreview(ctx, ctx.message, null);
});
bot.callbackQuery(/^rp:(ok|no)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const r = await kv.get(refKey(ctx.from.id));
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
  if (ctx.match[1] === "no" || r?.step !== "ready") {
    await kv.del(refKey(ctx.from.id));
    return ctx.answerCallbackQuery({ text: "취소했어요" });
  }
  const ch = await kv.get(K.channel);
  if (!ch) return ctx.answerCallbackQuery({ text: "⚠️ 채널을 아직 몰라요 (/joinlink 안내)", show_alert: true });
  await ctx.answerCallbackQuery();
  try {
    const sent = await ctx.api.copyMessage(ch.id, r.from, r.msgId, {
      reply_markup: refKeyboard(ctx.me.username),
      ...(r.caption != null ? { caption: r.caption } : {}),
    });
    await kv.del(refKey(ctx.from.id));
    await refDailyReplace(ctx.api, { chat: ch.id, msgId: sent.message_id }); // ⬆️ 매일 저녁 9시 끌올 대상으로 (예전 이벤트 글은 지움)
    const link = ch.username ? `https://t.me/${ch.username}/${sent.message_id}` : `https://t.me/c/${String(ch.id).replace(/^-100/, "")}/${sent.message_id}`;
    return ctx.reply(`✅ 「${esc(ch.title ?? "채널")}」에 올렸어요.\n${link}\n\n⬆️ 매일 한국 시간 저녁 9시에 맨 아래로 끌올돼요 (알림 소리 없이, 그 사이 새 공고가 없으면 건너뜀).\n그만하려면 /refstop`, { ...html, link_preview_options: { is_disabled: true } });
  } catch (e) {
    return ctx.reply(`⚠️ 못 올렸어요: ${e.description ?? e.message}`);
  }
});

// ⬆️ 친구 소개 이벤트 글 매일 끌올 (11-06 대표 요청)
//  - 한국 시간 저녁 9시(우즈벡 오후 5시) — 한국 학생·현지 친구 둘 다 폰을 보는 시간
//  - 일자리 공고 배려: ① 이벤트 글은 늘 1개(예전 글·그룹방 사본 지움) ② 알림 소리 없이 올림
//    ③ 그 사이 새 공고·끌올이 없으면 이미 맨 아래라 건너뜀 ④ 30분 안에 올라온 공고가 있으면 공고가 먼저 보이게 기다림(최대 21:50)
//  kv refdaily = { on, chat, msgId, group: {chat,msgId}, at, day }
const REFD = "refdaily";
const kstDay = (ts = Date.now()) => new Date(ts + 9 * 3600e3).toISOString().slice(0, 10);
async function refDailyReplace(api, posted, keepOld = false) {
  const r = (await kv.get(REFD)) ?? {};
  if (!keepOld && r.chat && r.msgId && r.msgId !== posted.msgId) {
    await api.deleteMessage(r.chat, r.msgId).catch(() => {});
    const g = r.group ?? (await kv.get(`fwdcopy:${r.msgId}`));
    if (g) await api.deleteMessage(g.chat, g.msgId).catch(() => {});
  }
  await kv.set(REFD, { on: true, chat: posted.chat, msgId: posted.msgId, group: null, at: Date.now(), day: r.day ?? null });
}
export async function refDaily(api) {
  const r = await kv.get(REFD);
  if (!r?.on || !r.msgId) return "off";
  const now = new Date(Date.now() + 9 * 3600e3);
  const h = now.getUTCHours(), mi = now.getUTCMinutes();
  if (!(h === 21 || (h === 22 && mi < 30))) return "not-time"; // 21:00~22:29 (GitHub 정기 실행이 늦을 때 대비)
  const today = kstDay();
  if (r.day === today) return "done";
  const jobs = (await kv.mget(((await kv.smembers(K.jobs)) ?? []).map((x) => `job:${x}`))).filter((j) => j?.group?.chat === r.chat);
  const after = jobs.filter((j) => j.group.msgId > r.msgId);
  if (!after.length) { await kv.set(REFD, { ...r, day: today }); return "already-bottom"; }
  const latest = Math.max(...after.map((j) => j.bumpedAt ?? j.at ?? 0));
  if (Date.now() - latest < 30 * 60e3 && h === 21 && mi < 50) return "wait-job";
  const username = await meName(api);
  try {
    const sent = await api.copyMessage(r.chat, r.chat, r.msgId, { reply_markup: refKeyboard(username), disable_notification: true });
    await refDailyReplace(api, { chat: r.chat, msgId: sent.message_id });
    await kv.set(REFD, { ...(await kv.get(REFD)), day: today });
    return "bumped";
  } catch (e) {
    console.error("이벤트 끌올 실패:", e.description ?? e.message);
    await kv.set(REFD, { ...r, day: today }); // 오늘은 그만 (내일 다시)
    return "fail";
  }
}
// /refstop — 매일 끌올 그만 (글은 그대로) · /refdaily — 상태 보기 · /refdaily <채널 글 링크> — 이미 올린 글을 끌올 대상으로
admin.command("refstop", async (ctx) => {
  const r = await kv.get(REFD);
  if (!r?.on) return ctx.reply("매일 끌올은 이미 꺼져 있어요.");
  await kv.set(REFD, { ...r, on: false });
  return ctx.reply("⏸ 친구 소개 글 매일 끌올을 껐어요. (채널 글은 그대로)\n다시 켜려면 /refdaily on");
});
admin.command("refdaily", async (ctx) => {
  const arg = String(ctx.match ?? "").trim();
  const ch = await kv.get(K.channel);
  if (/^on$/i.test(arg)) {
    const r = await kv.get(REFD);
    if (!r?.msgId) return ctx.reply("끌올할 글이 없어요. /refpost 로 올리거나 /refdaily <채널 글 링크>");
    await kv.set(REFD, { ...r, on: true });
    return ctx.reply("▶️ 다시 매일 저녁 9시에 끌올해요.");
  }
  const m = arg.match(/t\.me\/(?:c\/\d+|[\w]+)\/(\d+)/);
  if (m) {
    if (!ch) return ctx.reply("⚠️ 채널을 아직 몰라요");
    const r = (await kv.get(REFD)) ?? {};
    await kv.set(REFD, { on: true, chat: ch.id, msgId: Number(m[1]), group: null, at: Date.now(), day: r.day ?? null });
    return ctx.reply(`✅ 이 글(${m[1]}번)을 매일 저녁 9시에 끌올할게요.\n⚠️ 이 글의 그룹방 사본은 봇이 몰라서, 첫 끌올 뒤 그룹방에 남은 예전 사본 하나만 직접 지워 주세요.`);
  }
  const r = await kv.get(REFD);
  if (!r?.msgId) return ctx.reply("아직 끌올할 이벤트 글이 없어요. /refpost 로 올리면 자동으로 매일 끌올돼요.");
  return ctx.reply(`⬆️ 친구 소개 글 매일 끌올: ${r.on ? "켜짐" : "꺼짐"}\n지금 글: ${r.msgId}번 · 마지막 확인: ${r.day ?? "아직"}\n매일 한국 시간 21:00 (그 사이 새 공고가 없으면 건너뜀)\n${r.on ? "끄기: /refstop" : "켜기: /refdaily on"}`);
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

// /wipeall : 학생 자기소개서 기록 전부 지우기 (11-04 대표 결정 — 모두 자기소개서 다시 받기)
//  지우기 전에 전체 기록을 파일로 보내고 저장소에도 90일 보관 → /wipeundo 로 되돌리기 가능
const WIPE_BACKUP = "backup:apps";
admin.command("wipeall", async (ctx) => {
  const ids = (await kv.smembers(K.apps)) ?? [];
  const pend = (await kv.smembers(K.pending)) ?? [];
  return ctx.reply(
    `⚠️ <b>학생 기록 전부 지우기</b>\n자기소개서 ${ids.length}명 + 쓰다 만 학생 ${pend.length}명\n\n지우기 전에 전체 기록 파일을 이 대화로 보내고, 90일 동안 /wipeundo 로 되돌릴 수 있어요.\n공고·출근 기록은 그대로예요.`,
    { ...html, reply_markup: new InlineKeyboard().text(`🗑 ${ids.length}명 전부 지우기`, "wipe:yes").row().text("취소", "wipe:no") },
  );
});
admin.callbackQuery("wipe:no", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "취소했어요" });
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
});
admin.callbackQuery("wipe:yes", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "지우는 중…" });
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
  const ids = (await kv.smembers(K.apps)) ?? [];
  const pend = (await kv.smembers(K.pending)) ?? [];
  const apps = (await kv.mget(ids.map(K.app))).filter(Boolean);
  const backup = { at: Date.now(), by: ctx.from.id, apps };
  await kv.set(WIPE_BACKUP, backup, 90 * 24 * 3600);
  await ctx.replyWithDocument(new InputFile(Buffer.from(JSON.stringify(backup, null, 1), "utf8"), `GIEC_JOB_학생기록_백업_${apps.length}명.json`), {
    caption: `📦 지우기 전 백업 ${apps.length}명 — 되돌리려면 /wipeundo`,
  }).catch(() => {});
  for (const id of ids) await kv.del(K.app(id));
  for (const id of new Set([...ids, ...pend])) await kv.del(K.state(id));
  await kv.del(K.apps);
  await kv.del(K.pending);
  return ctx.reply(`🧹 학생 기록 ${apps.length}명(+ 쓰다 만 ${pend.length}명)을 지웠어요.\n이제 모든 학생은 다음 지원 때 자기소개서부터 써요.`);
});
admin.command("wipeundo", async (ctx) => {
  const b = await kv.get(WIPE_BACKUP);
  if (!b?.apps?.length) return ctx.reply("되돌릴 백업이 없어요.");
  let n = 0;
  for (const a of b.apps) {
    if (await kv.get(K.app(a.id))) continue; // 그 사이 새로 쓴 학생은 새 기록 유지
    await kv.set(K.app(a.id), a);
    await kv.sadd(K.apps, a.id);
    n++;
  }
  return ctx.reply(`↩️ ${nowKST(b.at)} 백업에서 ${n}명을 되살렸어요. (그 사이 새로 쓴 학생 ${b.apps.length - n}명은 새 기록 그대로)`);
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
    ["접수일", "이름", "나이", "성별", "연락처", "학교", "TOPIK", "IELTS", "자동차", "수업 요일", "텔레그램 이름", "아이디", "상태", "텔레그램 번호"],
    ...apps.map((a) => [
      nowKST(a.createdAt),
      a.name,
      a.age,
      KO.gender[a.gender] ?? "",
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
  return startFlow(ctx, await getLang(ctx.from));
});

// 예전에 낸 학생: "또 일 찾아요" — 정보는 그대로, 상태만 🆕 신규로
// 🌐 언어 바꾸기 (인사 메시지 아래 버튼)
bot.callbackQuery("c:lang", async (ctx) => {
  await ctx.answerCallbackQuery();
  const kb = new InlineKeyboard();
  LANGS.forEach(([code, label], i) => {
    kb.text(label, `c:setlang:${code}`);
    if (i % 2 === 1) kb.row();
  });
  await ctx.editMessageReplyMarkup({ reply_markup: kb }).catch(() => {});
});
bot.callbackQuery(/^c:setlang:(\w+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const lang = ctx.match[1];
  if (!LANGS.some((l) => l[0] === lang)) return;
  await kv.set(`lang:${ctx.from.id}`, lang);
  const app = await kv.get(K.app(ctx.from.id));
  if (app) await kv.set(K.app(ctx.from.id), { ...app, lang });
  await ctx.deleteMessage().catch(() => {});
  return sendGreet(ctx.api, ctx.chat.id, ctx.from, lang);
});

async function reactivate(ctx, app) {
  const before = STATUS[app.status] ?? STATUS.new;
  const updated = { ...app, status: "new", statusBy: null, statusAt: null, updatedAt: Date.now(), againAt: Date.now() };
  await ctx.reply(tx(app.lang, "again"));
  return saveAndCard(ctx.api, updated, `🔁 다시 일 찾는 중 (이전: ${before})`);
}
bot.callbackQuery("c:again", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
  const app = await kv.get(K.app(ctx.from.id));
  if (!app) return startFlow(ctx, await getLang(ctx.from));
  if (app.gender == null) {
    // 예전에 성별 없이 낸 학생 → 성별만 한 번 묻고 다시 신청
    const kb = new InlineKeyboard();
    tx(app.lang, "genderOpts").forEach((l, i) => kb.text(l, `c:ag:${i}`));
    return ctx.reply(tx(app.lang, "genderOnly"), { ...html, reply_markup: kb });
  }
  return reactivate(ctx, app);
});
bot.callbackQuery(/^c:ag:(\d)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
  const app = await kv.get(K.app(ctx.from.id));
  if (!app) return;
  return reactivate(ctx, { ...app, gender: Number(ctx.match[1]) });
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

bot.callbackQuery(/^c:(topik|ielts|car|gender):(\d)$/, async (ctx) => {
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
// 🔄 수업 요일 다시 받기 — 학생에게 요일 질문을 보냄 (봇 카드 · 관리 미니앱 학생 카드 · 여러 명 한꺼번에 같이 씀)
export async function askDays(api, id) {
  const app = await kv.get(K.app(id));
  if (!app) return false;
  const st = { step: "days", lang: app.lang ?? "uz", mode: "days", data: { days: [] } };
  try {
    await api.sendMessage(id, tx(st.lang, "daysAgain"), { ...html, reply_markup: daysKeyboard(st.lang, []) });
    await kv.set(K.state(id), st, STATE_TTL);
    return true;
  } catch {
    return false;
  }
}
bot.callbackQuery(/^a:days:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const id = Number(ctx.match[1]);
  if (!(await kv.get(K.app(id)))) return ctx.answerCallbackQuery({ text: "지원자 정보를 찾을 수 없어요.", show_alert: true });
  const ok = await askDays(ctx.api, id);
  await ctx.answerCallbackQuery({ text: ok ? "✅ 학생에게 요일 질문을 보냈어요" : "보내지 못했어요 (학생이 봇을 차단했을 수 있어요)", show_alert: true });
});

// ═════════════ 🔎 학생 찾기 · 📢 공고 보내기 ═════════════
//  /find → ① 🚨 긴급(오늘·내일) / 📅 일반(오늘~5일 뒤 날짜 고르기)
//        → ② TOPIK · 차 → [🔎 찾기] → 맞는 학생 목록 (전화 바로 가능)
//        → ③ [✍️ 공고 쓰기] → 공고 한 개 보내기 → 미리보기
//        → ④ 어디로: [👥 그룹방] [📩 찾은 학생 1:1] [👥+📩 둘 다]
//  "일할 수 있는 날" = 그날 수업이 없는 학생 (일요일은 모두). ⚫ 종결·관리자 테스트 제외
//  그룹방 공고의 [🙋 지원하기] → 봇 1:1로 이동 → 정보를 낸 학생이면 바로 지원, 처음이면 9단계 후 자동 지원
//  공고마다 [🔒 마감] → 그룹방 공고에 "마감" 표시 + 버튼 없앰
const WD = ["월", "화", "수", "목", "금", "토", "일"];
const kstDate = (off = 0) => new Date(Date.now() + 9 * 3600e3 + off * DAY);
const dayOf = (off) => (kstDate(off).getUTCDay() + 6) % 7; // 월=0 … 일=6
const dateLabel = (off) => {
  const d = kstDate(off);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[dayOf(off)]})`;
};
const isoDate = (off) => kstDate(off).toISOString().slice(0, 10);
export const todayISO = () => isoDate(0);
const FIND_TTL = 3 * 3600;
const findKey = (a) => `find:${a}`;
const postKey = (a) => `post:${a}`;
const TOPIK_MIN = [["상관없음", 0], ["1급↑", 1], ["3급↑", 2], ["4급↑", 3]];
const topikName = (v) => TOPIK_MIN.find((t) => t[1] === v)?.[0] ?? "상관없음";
const mark = (on, label) => (on ? `✅ ${label}` : label);

const newFind = (kind) => ({ kind, off: kind === "urgent" ? 0 : 1, topik: 0, car: false, gender: null, noInfo: false });
// 공고 정보 (2026-11-03 혜승 요청: 시급·시작·퇴근·근무 시간·주소는 직접 입력, 점심시간은 버튼)
//   p.meta = { wage, start, end, hours, lunch, addr } → 공고 위에 한 줄씩 봇이 붙임
// 급여: "11000"·"시급 11,000" → 시급 / "일당 120,000"·5만 원 넘는 숫자만 → 일당 (혜승 요청 11-04: 시급·일당 구분)
const PAY_KIND = { h: "시급 · Soatbay · Почасовая", d: "일당 · Kunbay · За день" };
const payLine = (v) => {
  const t = String(v).trim();
  const num = t.replace(/[^\d]/g, "");
  const kind = /일당|kunbay|kunlik|день|дневн/i.test(t) ? "d" : /시급|soat|час/i.test(t) ? "h" : num && Number(num) > 50000 ? "d" : num ? "h" : null;
  const onlyNum = /^(시급|일당)?\s*[\d,]+\s*(원|₩|won)?$/i.test(t);
  const amount = onlyNum && num ? `${Number(num).toLocaleString("en-US")}₩` : t;
  return kind ? `${PAY_KIND[kind]}: ${amount}` : `급여 · Maosh · Оплата: ${amount}`;
};
const LUNCH = { 30: "30 min", 60: "1 h", 0: null };
export const jobMeta = (j) => {
  const m = j.meta ?? {};
  const T = "근무시간 · Ish vaqti · Время";
  const time = m.start || m.end ? `${T}: ${[m.start, m.end].filter(Boolean).join(" – ")}${m.hours ? ` (${m.hours})` : ""}` : m.hours ? `${T}: ${m.hours}` : null;
  // 혜승 피드백(11-03): 이모티콘은 급구·일시·지원만, 나머지는 글자로
  return [time, m.lunch ? `점심시간 · Tushlik · Обед: ${LUNCH[m.lunch]}` : null, m.wage ? payLine(m.wage) : null, m.addr ? `주소 · Manzil · Адрес: ${m.addr}` : null].filter(Boolean);
};
// 공고 양식 (11-04 혜승 확정) — 혜승이 직접 다 채워서 보냄, 봇은 그대로 올림
export const JOB_TEMPLATE = "📢 [GIEC JOB] (업체·업무) 모집!\n🧺 업무: \n👩 모집인원: \n📍 근무 위치\n(주소)\n━━━━━━━━━━━━━━\n⏰ 근무 조건\n📅 근무요일: \n(요일)\n휴무: \n🕘 평일 근무시간\n(요일): 09:00 ~ 18:00\n🕙 주말 근무시간\n(요일): 10:00 ~ 13:00\n━━━━━━━━━━━━━━\n💰 급여 조건\n평일 시급: \n주말 시급: \n급여 방식: \n급여 지급일: ";
// 공고 글에서 첫 "09:00" 같은 시각 → 출근 확인 기준 시작 시간
export const textStartMin = (t) => {
  const m = /(\d{1,2})\s*:\s*(\d{2})/.exec(String(t ?? ""));
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
};
// "9:00" "9시" "09:00" "9" "9시 30분" → 하루 중 몇 분 (출근 확인 시각 계산용)
export function startMinutes(v) {
  const t = String(v ?? "").trim();
  const m = /^(\d{1,2})(?:\s*[:시.]\s*(\d{1,2}))?/.exec(t);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2] ?? 0);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}
const GENDER = [["성별 상관없음", null], ["남자만", 0], ["여자만", 1]];
const genderName = (g) => GENDER.find((x) => x[1] === (g ?? null))[0];
const findDayLabel = (f) => (f.off == null ? "날짜 상관없음" : `${f.off === 0 ? "오늘 " : f.off === 1 ? "내일 " : ""}${dateLabel(f.off)}`);
const findText = (f) =>
  [
    f.kind === "urgent" ? "🚨 <b>긴급 공고 — 학생 찾기</b>" : "📅 <b>일반 공고 — 학생 찾기</b>",
    "",
    `📅 일할 날: <b>${findDayLabel(f)}</b>`,
    `📝 TOPIK: <b>${topikName(f.topik)}</b>`,
    `🚻 성별: <b>${genderName(f.gender)}</b>`,
    "",
    "<i>다음 단계에서 공고 양식을 드려요 — 빈칸을 채워 보내면 돼요.</i>",
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
  kb.row();
  GENDER.forEach(([n, v]) => kb.text(mark((f.gender ?? null) === v, n), `f:g:${v ?? "any"}`));
  kb.row().text(mark(!!f.noFlaky, "⚠️ 빵꾸 2번 이상 빼기"), `f:n:${f.noFlaky ? 0 : 1}`);
  return kb.row().text("🔎 찾기", "f:go");
};

admin.command("jobs", (ctx) =>
  adminAppUrl()
    ? ctx.reply("🛠 관리 화면 — 공고 · 학생 · 현황", { reply_markup: new InlineKeyboard().webApp("🛠 관리 화면 열기", adminAppUrl()) })
    : ctx.reply("⚠️ 미니앱 주소를 몰라요 (Vercel 배포 주소 확인 필요)")
);

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

bot.callbackQuery("f:noop", (ctx) => ctx.answerCallbackQuery());
bot.callbackQuery(/^f:(o|t|c|g|n|i):(\w+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  const f = (await kv.get(findKey(ctx.from.id))) ?? newFind("urgent");
  const [, k, v] = ctx.match;
  if (k === "o") f.off = v === "any" ? null : Number(v);
  if (k === "t") f.topik = Number(v);
  if (k === "c") f.car = v === "1";
  if (k === "g") f.gender = v === "any" ? null : Number(v);
  if (k === "n") f.noFlaky = v === "1";
  if (k === "i") f.noInfo = v === "1";
  await kv.set(findKey(ctx.from.id), f, FIND_TTL);
  await ctx.editMessageText(findText(f), { ...html, reply_markup: findKeyboard(f) }).catch(() => {});
});

const freeOn = (a, day) => day == null || day === 6 || !(a.days ?? []).includes(day);
export async function findStudents(f) {
  const day = f.off == null ? null : dayOf(f.off);
  const ids = (await kv.smembers(K.apps)) ?? [];
  return (await kv.mget(ids.map(K.app)))
    .filter((a) => a && !a.test && !a.guest && !isAdmin(a.id) && a.status !== "closed")
    .filter((a) => freeOn(a, day) && (a.topik ?? 0) >= f.topik && (!f.car || a.car === 0) && (f.gender == null || a.gender === f.gender))
    .filter((a) => !f.noFlaky || (a.workNo ?? 0) < 2)
    .sort(
      (a, b) =>
        (b.workOk ?? 0) - (b.workNo ?? 0) * 2 - ((a.workOk ?? 0) - (a.workNo ?? 0) * 2) ||
        (b.topik ?? 0) - (a.topik ?? 0) ||
        (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
    );
}

const LIST_MAX = 30;
const studentLine = (a, i) =>
  `${i + 1}. ${relBadge(a)}<a href="tg://user?id=${a.id}">${esc(a.name)}</a> · ${KO.gender[a.gender] ?? "성별?"} ${esc(a.age)}세 · ${a.phone ? `<code>${esc(a.phone)}</code>` : "번호 없음"} · ${esc(a.school)} · TOPIK ${KO.topik[a.topik] ?? "-"}${a.car === 0 ? " · 🚗" : ""}${a.status === "introduced" ? " · 🟢" : ""}`;

bot.callbackQuery("f:go", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  const f = (await kv.get(findKey(ctx.from.id))) ?? newFind("urgent");
  const list = await findStudents(f);
  await kv.set(findKey(ctx.from.id), { ...f, ids: list.map((a) => a.id) }, FIND_TTL);
  const head = `${f.kind === "urgent" ? "🚨" : "📅"} <b>조건에 맞는 학생 ${list.length}명</b>\n${findDayLabel(f)} · TOPIK ${topikName(f.topik)} · ${genderName(f.gender)}`;
  const lines = list.slice(0, LIST_MAX).map(studentLine);
  if (list.length > LIST_MAX) lines.push(`… 외 ${list.length - LIST_MAX}명`);
  if (f.gender != null) {
    const unknown = (await findStudents({ ...f, gender: null })).filter((a) => a.gender == null).length;
    if (unknown) lines.push(`ℹ️ 성별을 입력하기 전에 정보를 낸 학생 ${unknown}명은 빠졌어요 (다시 신청하면 성별을 물어봐요)`);
  }
  return ctx.reply(
    [head, "", ...(lines.length ? lines : ["(맞는 학생이 없어요 — 그룹방에만 올려도 돼요)"]), "", "🟢 = 이미 일 소개받은 학생 · ⭐ = 성실(출근 3번↑) · ⚠️ = 빵꾸 2번↑ · 이름을 누르면 대화로 가요."].join("\n"),
    { ...html, link_preview_options: { is_disabled: true }, reply_markup: whereKeyboard(list.length) }
  );
});

// 어디로 보낼지 → 공고 쓰기
const WHERE = { g: "👥 그룹방", d: "📩 찾은 학생 1:1", b: "👥 그룹방 + 📩 1:1" };
function whereKeyboard(n) {
  const kb = new InlineKeyboard().text("✍️ 👥 그룹방에 올릴 공고 쓰기", "p:new:g").row();
  if (n) kb.text(`✍️ 📩 이 ${n}명에게 1:1 공고 쓰기`, "p:new:d").row().text(`✍️ 👥 + 📩 둘 다`, "p:new:b");
  return kb;
}
// 공고 쓰기 순서: 💰 시급 → 🕘 시작 → 🕔 퇴근 → ⏱ 근무 시간 → 🍱 점심(버튼) → 📍 주소 → ✍️ 공고 글 → 미리보기 → ✅ 보내기
const META_STEPS = ["wage", "start", "end", "hours", "lunch", "addr"];
const META_ASK = {
  wage: "💰 <b>급여</b>를 써 주세요 — 시급이면 숫자만, 일당이면 앞에 \"일당\"\n예) <code>11000</code> → 시급 · <code>일당 120000</code> → 일당",
  start: "🕘 <b>시작 시간</b>\n예) <code>9:00</code> · <code>7시</code>\n(이 시간 30분 뒤에 출근 확인을 물어봐요)",
  end: "🕔 <b>퇴근 시간</b>\n예) <code>18:00</code>",
  hours: "⏱ <b>근무 시간</b>\n예) <code>8시간</code>",
  lunch: "🍱 <b>점심시간</b>",
  addr: "📍 <b>주소</b>\n예) <code>일산 설문동 606</code>",
};
const skipKb = (k) =>
  k === "lunch"
    ? new InlineKeyboard().text("30분", "p:l:30").text("1시간", "p:l:60").text("없음", "p:l:0").row().text("⏭ 건너뛰기", "p:skip")
    : new InlineKeyboard().text("⏭ 건너뛰기", "p:skip");
async function askMeta(ctx, p) {
  const k = META_STEPS.find((x) => !(x in (p.meta ?? {})));
  if (k) {
    await kv.set(postKey(ctx.from.id), { ...p, step: k }, 1800);
    return ctx.reply(META_ASK[k], { ...html, reply_markup: skipKb(k) });
  }
  await kv.set(postKey(ctx.from.id), { ...p, step: "text" }, 1800);
  const meta = jobMeta({ meta: p.meta });
  return ctx.reply(
    [
      `✍️ <b>${WHERE[p.where]}</b> — 마지막으로 공고 내용을 메시지 한 개로 보내주세요 (글, 또는 사진 + 설명)`,
      meta.length ? `공고 위에 붙는 줄:\n${meta.join("\n")}` : null,
      "예) <code>365로지스 / 4명\n단순 하차 업무</code>",
      "",
      "보내면 <b>미리보기</b>가 먼저 나오고, [✅ 보내기]를 눌러야 올라가요. 그만두려면 /cancel",
    ].filter((x) => x != null).join("\n"),
    html
  );
}
bot.callbackQuery(/^p:new:(g|d|b)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  const f = await kv.get(findKey(ctx.from.id));
  if (!f) return ctx.reply("찾기 조건이 사라졌어요. /find 부터 다시 해주세요.");
  // (11-04) 시급·시간 따로 묻지 않음 — 관리 화면에서 칸을 눌러 채우거나(추천), 양식을 복사해 채워 보냄
  await kv.set(postKey(ctx.from.id), { where: ctx.match[1], meta: {}, step: "text" }, 1800);
  if (adminAppUrl())
    await ctx.reply("📝 <b>칸을 눌러 채우기</b> (추천) — 제목·업무·인원·요일·시간·시급을 누르고 쓰면 공고 글이 자동으로 만들어져요.\n(관리 화면에서 받을 학생·보낼 곳을 다시 골라요)", {
      ...html,
      reply_markup: new InlineKeyboard().webApp("📝 공고 칸 채우기", adminAppUrl(`new=${f.kind}:${f.off ?? ""}`)),
    });
  await ctx.reply(
    [
      `✍️ 또는 여기서 바로: <b>${WHERE[ctx.match[1]]}</b> — 아래 양식을 눌러 복사한 뒤, 빈칸을 채워 메시지 한 개로 보내주세요 (사진 + 설명도 돼요)`,
      "",
      "• 모집인원에 <b>숫자+명</b>(예: 여성 1명)을 쓰면 남은 인원을 세요",
      "• 근무시간의 첫 시각(예: 09:00)으로 30분 뒤 출근 확인을 물어봐요",
      "• 보내면 미리보기가 먼저 나오고 [✅ 보내기]를 눌러야 올라가요. 그만두려면 /cancel",
    ].join("\n"),
    html,
  );
  return ctx.reply(`<pre>${esc(JOB_TEMPLATE)}</pre>`, html);
});
bot.callbackQuery(/^p:(skip|l:(\d+))$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  const p = await kv.get(postKey(ctx.from.id));
  if (!p || !META_STEPS.includes(p.step)) return;
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
  p.meta = { ...(p.meta ?? {}), [p.step]: ctx.match[2] != null ? Number(ctx.match[2]) : null };
  return askMeta(ctx, p);
});

admin.command("cancel", async (ctx) => {
  await kv.del(postKey(ctx.from.id));
  await kv.del(refKey(ctx.from.id));
  return ctx.reply("취소했어요.");
});

// ── 공고 모양 ──
const jobDate = (job) => (job.off == null ? null : job.dateLabel);
// 그룹방용 (여러 나라 학생이 같이 봄 → 짧게 3개 언어)
function groupBody(job, closed = false) {
  // (11-04) 채널 공고는 한글만 — 학생은 텔레그램 번역 기능 사용. 혜승 양식 글을 그대로 올림
  const head = job.kind === "urgent" ? "🚨 <b>급구</b>" : null;
  const body = job.text != null ? job.text : job.caption ?? "";
  return [
    closed ? "✅ <b>[모집 완료]</b>" : head,
    jobDate(job) ? `📅 ${jobDate(job)}` : null,
    ...jobMeta(job),
    "",
    esc(body),
    "",
    closed ? null : "👇 아래 [지원하기] 버튼을 눌러 주세요",
  ]
    .filter((x) => x !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}
// 1:1용 (학생 언어)
function dmBody(job, lang) {
  const body = job.text != null ? job.text : job.caption ?? "";
  return [`${job.kind === "urgent" ? "🚨 " : ""}${tx(lang, "jobHead")}`, jobDate(job) ? `📅 ${jobDate(job)}` : null, ...jobMeta(job), "", esc(body), "", tx(lang, "jobFoot")]
    .filter((x) => x !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}
const dmMarkup = (lang, jobId) => new InlineKeyboard().text(tx(lang, "btnJobYes"), `j:y:${jobId}`).text(tx(lang, "btnJobNo"), `j:n:${jobId}`);
const boardLink = (username) => `https://t.me/${username}?startapp=jobs`; // 채널에서 현황판 미니앱 바로 열기 (BotFather Main Mini App 필요)
let meNameCache = null;
const meName = async (api) => (meNameCache ??= (await api.getMe().catch(() => null))?.username ?? null);
const groupMarkup = (username, jobId) =>
  new InlineKeyboard().url("🙋 지원하기", `https://t.me/${username}?start=job_${jobId}`).row().url("💼 다른 일자리 보기", boardLink(username));
const closedMarkup = (username) => (username ? new InlineKeyboard().url("💼 다른 일자리 보기", boardLink(username)) : { inline_keyboard: [] });

// 📷 사진·영상 붙은 공고 (11-05 혜승 요청): 1개 + 글 1024자 이내 → 사진 아래 글·버튼 한 장 / 여러 개 → 앨범(묶음) 먼저, 그 아래 글·버튼
const mediaInput = (m, caption) => ({ type: m.type === "video" ? "video" : "photo", media: m.id, ...(caption ? { caption, parse_mode: "HTML" } : {}) });
async function sendTo(api, chatId, job, text, markup) {
  const opts = { parse_mode: "HTML", reply_markup: markup, link_preview_options: { is_disabled: true } };
  const media = job.media ?? [];
  if (job.text != null && media.length === 1 && text.length <= 1024) {
    const m = media[0];
    const msg = await (m.type === "video" ? api.sendVideo(chatId, m.id, { caption: text, parse_mode: "HTML", reply_markup: markup }) : api.sendPhoto(chatId, m.id, { caption: text, parse_mode: "HTML", reply_markup: markup }));
    msg.isCaption = true;
    return msg;
  }
  if (job.text != null && media.length) {
    const album = await api.sendMediaGroup(chatId, media.slice(0, 10).map((m) => mediaInput(m)));
    const msg = await api.sendMessage(chatId, text, { ...opts, reply_parameters: { message_id: album[0].message_id, allow_sending_without_reply: true } });
    msg.album = album.map((a) => a.message_id);
    return msg;
  }
  if (job.text != null) return api.sendMessage(chatId, text, opts);
  return api.copyMessage(chatId, job.from, job.msgId, { ...opts, caption: text.slice(0, 1024) });
}

// 관리자가 공고 글을 보냄 → 미리보기 + 어디로 보낼지
admin.on("message", async (ctx, next) => {
  const p = await kv.get(postKey(ctx.from.id));
  if (!p || ctx.message.text?.startsWith("/")) return next();
  if (META_STEPS.includes(p.step)) {
    if (p.step === "lunch") return ctx.reply("점심시간은 버튼으로 골라 주세요 👇", { reply_markup: skipKb("lunch") });
    const v = ctx.message.text?.trim();
    if (!v) return ctx.reply("글로 써 주세요. 넘어가려면 ⏭ 건너뛰기", { reply_markup: skipKb(p.step) });
    p.meta = { ...(p.meta ?? {}), [p.step]: v.slice(0, 80) };
    return askMeta(ctx, p);
  }
  if (p.step !== "text") return next();
  const m = ctx.message;
  if (m.text == null && !(m.photo || m.video || m.document || m.animation)) return ctx.reply("글이나 사진(+설명)으로 보내주세요. 그만두려면 /cancel");
  const f = (await kv.get(findKey(ctx.from.id))) ?? newFind("urgent");
  const jobId = await kv.incr("jobseq");
  const job = {
    id: jobId,
    kind: f.kind,
    off: f.off,
    dateLabel: f.off == null ? null : dateLabel(f.off),
    date: f.off == null ? null : isoDate(f.off),
    from: ctx.chat.id,
    msgId: m.message_id,
    text: m.text ?? null,
    caption: m.caption ?? "",
    ids: f.ids ?? [],
    meta: p.meta ?? {},
    startMin: startMinutes(p.meta?.start) ?? textStartMin(m.text ?? m.caption),
    noInfo: false,
    by: fullName(ctx.from),
    at: Date.now(),
  };
  // 모집 인원: 공고 글에서 "4명"을 찾아 읽음 → 지원할 때마다 그룹방에 "N명 남았습니다", 다 차면 자동 마감
  const slotMatch = /(\d{1,3})\s*명/.exec(job.text ?? job.caption ?? "");
  job.slots = slotMatch ? Number(slotMatch[1]) : null;
  await kv.set(`job:${jobId}`, job, JOB_TTL);
  await kv.set(postKey(ctx.from.id), { step: "confirm", jobId, where: p.where ?? "g" }, 1800);
  const where = p.where ?? "g";
  const n = job.ids.length;
  if (where !== "d") {
    await ctx.reply("👀 <b>미리보기 — 아직 안 올라갔어요.</b> 채널에는 이렇게 올라가요 👇", html);
    await sendTo(ctx.api, ctx.chat.id, job, groupBody(job), groupMarkup(ctx.me.username, jobId));
  }
  if (where !== "g") {
    await ctx.reply("👀 <b>미리보기 — 아직 안 보냈어요.</b> 1:1로는 이렇게 가요 👇", html);
    await sendTo(ctx.api, ctx.chat.id, job, dmBody(job, "uz"), dmMarkup("uz", jobId));
  }
  await ctx.reply(
    job.slots
      ? `👥 모집 인원 <b>${job.slots}명</b> (글에서 읽었어요) — 지원이 들어올 때마다 봇이 그룹방에 "N명 남았습니다"를 달고, ${job.slots}명이 차면 자동으로 모집 완료돼요.`
      : `ℹ️ 글에 "4명"처럼 인원 숫자가 없어서 남은 인원은 세지 않아요. 세려면 /cancel 후 인원을 넣어 다시 보내주세요.`,
    html
  );
  const left = ["(업체·업무)", "(주소)", "(요일)"].filter((x) => (job.text ?? job.caption ?? "").includes(x));
  if (left.length) await ctx.reply(`⚠️ 양식 빈칸이 남았어요: ${left.join(" ")} — 고치려면 ❌ 취소 후 다시 보내주세요`);
  const target = where === "g" ? "그룹방에 올릴까요?" : where === "d" ? `${n}명에게 1:1로 보낼까요?` : `그룹방에 올리고 ${n}명에게 1:1로도 보낼까요?`;
  return ctx.reply(`📢 공고 #${jobId} — ${target}`, {
    reply_markup: new InlineKeyboard().text("✅ 보내기", `p:send:${jobId}:${where}`).text("❌ 취소", "p:cancel"),
  });
});

bot.callbackQuery("p:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  await kv.del(postKey(ctx.from.id));
  await ctx.editMessageText("취소했어요.").catch(() => {});
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEND_MAX = 150; // 1:1 한 번에 최대 인원 (텔레그램 속도 제한 · 서버 1분 제한)

// 관리 미니앱에서 새 공고 만들기 (글만)
// 📷 공고 사진·영상 받아 두기 (11-05 혜승 요청): 관리자가 다른 일 중이 아닐 때 봇 대화에 사진·영상을 보내면
//  "새 공고용"으로 모아 둠 (앨범도 한 번에) → 관리 미니앱 새 공고에서 붙여서 올림
export const mediaKey = (uid) => `mediadraft:${uid}`;
admin.on(["message:photo", "message:video"], async (ctx) => {
  const m = ctx.message;
  const item = m.video ? { type: "video", id: m.video.file_id } : { type: "photo", id: m.photo.at(-1).file_id };
  const list = ((await kv.get(mediaKey(ctx.from.id))) ?? []).concat(item).slice(-10);
  await kv.set(mediaKey(ctx.from.id), list, 24 * 3600);
  // 앨범은 사진마다 따로 들어옴 → 안내는 한 번만
  if (m.media_group_id && !(await kv.setNX(`mg:${m.media_group_id}`, 1, 120))) return;
  const kb = new InlineKeyboard();
  if (adminAppUrl()) kb.webApp("📝 새 공고 화면 열기", adminAppUrl("new"));
  kb.row().text("🗑 임시함 비우기", "md:clear");
  return ctx.reply(`📥 임시함에 받아 뒀어요 (지금 ${list.length}개${m.media_group_id ? "+" : ""})\n새 공고 화면에서 [📥 봇 대화에서 가져오기]를 누르면 그 공고에만 붙고 임시함은 비워져요.\n(사진·짧은 영상은 새 공고 화면 [＋ 사진·영상 추가]로 바로 올려도 돼요)`, { reply_markup: kb });
});
bot.callbackQuery("md:clear", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await kv.del(mediaKey(ctx.from.id));
  await ctx.answerCallbackQuery({ text: "비웠어요" });
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
});
// 지원서 정원 (혜승 요청 11-05): 모집 인원과 따로 — 모집 3명이어도 지원은 10명까지 받아서 고르기·빵꾸 대비. 없으면 모집 인원까지
export const capOf = (j) => j.cap ?? j.slots ?? null;
export async function createJobRecord({ kind = "normal", off = null, text, slots, cap = null, by, ids = [], form = null, media = [], placeId = null }) {
  const id = await kv.incr("jobseq");
  const m = /(\d{1,3})\s*명/.exec(text ?? "");
  const job = {
    id,
    kind,
    off,
    dateLabel: off == null ? null : dateLabel(off),
    date: off == null ? null : isoDate(off),
    from: null,
    msgId: null,
    text,
    caption: "",
    ids,
    startMin: textStartMin(text),
    by,
    at: Date.now(),
    slots: slots ? Number(slots) : m ? Number(m[1]) : null,
    cap: Number(cap) > 0 ? Number(cap) : null,
    noInfo: false, // 모든 공고 자기소개서 먼저 (11-04)
    form, // 미니앱 칸 채우기 값 → 지난 공고 불러오기 (11-04)
    placeId: placeId ? Number(placeId) : null, // 🏢 업장 (11-06)
    placed: [], // ⭐ 배치된 학생 (지원자 중 실제로 보내는 학생)
    media: (Array.isArray(media) ? media : []).filter((m) => m && m.id && (m.type === "photo" || m.type === "video")).slice(0, 10),
  };
  await kv.set(`job:${id}`, job, JOB_TTL);
  return job;
}

// 공고 내보내기 (그룹방 / 1:1 / 둘 다) — 채팅 버튼과 관리 미니앱이 같이 씀
export async function sendJobOut(api, job, where, username) {
  const out = [];
  if (where !== "d") {
    const ch = await kv.get(K.channel);
    if (!ch) out.push("⚠️ 그룹방(채널)을 아직 몰라요 (/joinlink 안내 참고)");
    else {
      try {
        const msg = await sendTo(api, ch.id, job, groupBody(job), groupMarkup(username, job.id));
        job.group = { chat: ch.id, msgId: msg.message_id, ...(msg.isCaption ? { caption: true } : {}), ...(msg.album ? { album: msg.album } : {}) };
        out.push("👥 그룹방(채널)에 올렸어요");
      } catch (e) {
        out.push(`⚠️ 그룹방(채널)에 못 올렸어요: ${e.description ?? e.message}`);
      }
    }
  }
  if (where !== "g") {
    const apps = (await kv.mget((job.ids ?? []).slice(0, SEND_MAX).map(K.app))).filter(Boolean);
    let ok = 0;
    let fail = 0;
    for (const a of apps) {
      const lang = a.lang ?? "uz";
      await sendTo(api, a.id, job, dmBody(job, lang), dmMarkup(lang, job.id)).then(() => ok++).catch(() => fail++);
      await sleep(40);
    }
    out.push(`📩 ${ok}명에게 1:1로 보냈어요${fail ? ` (못 받은 학생 ${fail}명 — 봇을 차단했을 수 있어요)` : ""}`);
    if ((job.ids ?? []).length > SEND_MAX) out.push(`⚠️ ${job.ids.length - SEND_MAX}명은 150명을 넘어서 빠졌어요`);
  }
  job.sentAt = Date.now();
  job.where = where;
  await kv.set(`job:${job.id}`, job, JOB_TTL);
  await kv.sadd(K.jobs, job.id);
  return out;
}

bot.callbackQuery(/^p:send:(\d+):(g|d|b)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const [, jobId, where] = ctx.match;
  const job = await kv.get(`job:${jobId}`);
  const p = await kv.get(postKey(ctx.from.id));
  if (!job || p?.jobId !== job.id) return ctx.answerCallbackQuery({ text: "이미 보냈거나 취소된 공고예요.", show_alert: true });
  await kv.del(postKey(ctx.from.id)); // 두 번 눌러도 한 번만
  await ctx.answerCallbackQuery({ text: "보내는 중…" });
  await ctx.editMessageText(`📤 공고 #${job.id} 보내는 중…`).catch(() => {});
  const out = await sendJobOut(ctx.api, job, where, ctx.me.username);
  const kb = new InlineKeyboard().text("✅ 모집 완료 (자리 다 참)", `p:close:${job.id}`);
  if (adminAppUrl()) kb.row().webApp("📋 관리 화면에서 보기", adminAppUrl(`job=${job.id}`));
  await ctx.editMessageText(`✅ 공고 #${job.id}\n${out.join("\n")}\n🙋 지원한 학생은 바로 알려드릴게요.`, { reply_markup: kb }).catch(() => {});
});

// 📢 다시 올리기: 빵꾸 등으로 다시 뽑을 때 — 남은 인원으로 새 공고를 맨 아래에 올리고 예전 공고는 마감
export async function repostJob(api, old, username, slots) {
  // (11-06) 같은 공고가 여러 개 열려 있던 문제: 두 번 눌림 / 예전 공고에서 또 다시 올림
  const prev = old.repostedTo ? await kv.get(`job:${old.repostedTo}`) : null;
  // 1분 안에 또 누른 건 두 번 눌림으로 보고 방금 올린 공고를 그대로 돌려줌
  if (prev && !prev.closed && Date.now() - (prev.at ?? 0) < 60e3) return { job: prev, out: [] };
  // 이 공고에서 이미 다시 올린 공고들(사슬)이 열려 있으면 모두 마감 — 새로 올리는 공고 하나만 남김
  for (let next = prev, n = 0; next && n < 20; n++) {
    if (!next.closed) await closeJob(api, next);
    next = next.repostedTo ? await kv.get(`job:${next.repostedTo}`) : null;
  }
  const id = await kv.incr("jobseq");
  const job = {
    ...old,
    id,
    kind: "urgent",
    slots: slots ?? old.slots ?? null,
    cap: null, // 다시 올리면 남은 인원만 받음
    group: null,
    closed: false,
    att: {},
    attAsked: 0,
    repostOf: old.id,
    at: Date.now(),
    ids: [],
  };
  await kv.set(`job:${id}`, job, JOB_TTL);
  old.repostedTo = id;
  if (!old.closed) await closeJob(api, old);
  else await kv.set(`job:${old.id}`, old, JOB_TTL);
  const out = await sendJobOut(api, job, "g", username);
  return { job, out };
}

// ⬆️ 끌올 (11-06 대표 요청, 당근마켓 끌올처럼): 같은 공고(번호·지원자·출근 기록 그대로)를 채널 맨 아래로.
// 지금 내용(수정한 글·사진 포함)으로 새로 올리고 예전 글은 지움. 텔레그램은 48시간 지난 글을 못 지워서
// 그땐 예전 글을 "⬆️ 아래로 끌올됐어요"로 바꾸고 버튼을 없앰. 모집 완료였으면 다시 모집 중으로.
export async function bumpJob(api, job, username) {
  const ch = job.group ? { id: job.group.chat } : await kv.get(K.channel);
  if (!ch) throw new Error("그룹방(채널)을 아직 몰라요");
  if (Date.now() - (job.bumpedAt ?? 0) < 30e3) return job; // 두 번 눌림
  job.closed = false;
  let msg;
  try {
    msg = await sendTo(api, ch.id, job, groupBody(job), groupMarkup(username, job.id));
  } catch (e) { throw new Error("채널에 못 올렸어요: " + (e.description ?? e.message)); }
  const old = job.group;
  job.group = { chat: ch.id, msgId: msg.message_id, ...(msg.isCaption ? { caption: true } : {}), ...(msg.album ? { album: msg.album } : {}) };
  job.bumpedAt = Date.now();
  job.bumps = (job.bumps ?? 0) + 1;
  await kv.set(`job:${job.id}`, job, JOB_TTL);
  await kv.sadd(K.jobs, job.id);
  if (old) {
    const gone = await api.deleteMessage(old.chat, old.msgId).then(() => true).catch(() => false);
    for (const a of old.album ?? []) await api.deleteMessage(old.chat, a).catch(() => {});
    if (!gone) {
      const note = "⬆️ <b>이 공고는 아래로 끌올됐어요</b> — 맨 아래 새 글에서 지원해 주세요";
      const mk = closedMarkup(username);
      await (job.text != null && !old.caption
        ? api.editMessageText(old.chat, old.msgId, note, { parse_mode: "HTML", reply_markup: mk })
        : api.editMessageCaption(old.chat, old.msgId, { caption: note, parse_mode: "HTML", reply_markup: mk })
      ).catch(() => {});
    }
  }
  return job;
}

// 마감: 그룹방 공고에 표시 + 버튼 없앰, 1:1 버튼도 더는 안 받음
// 마감: 그룹방 공고에 표시 + 버튼 없앰, 그 뒤 지원은 "마감" 안내
export async function closeJob(api, job) {
  job.closed = true;
  job.closedAt ??= Date.now();
  await kv.set(`job:${job.id}`, job, JOB_TTL);
  if (!job.group) return;
  const text = groupBody(job, true);
  const markup = closedMarkup(await meName(api));
  const edit = job.text != null && !job.group.caption
    ? api.editMessageText(job.group.chat, job.group.msgId, text, { parse_mode: "HTML", reply_markup: markup })
    : api.editMessageCaption(job.group.chat, job.group.msgId, { caption: text.slice(0, 1024), parse_mode: "HTML", reply_markup: markup });
  await edit.catch(() => {});
}
// 다시 열기 (마감 뒤 지원 취소로 자리가 생겼을 때)
export async function reopenJob(api, job, username) {
  job.closed = false;
  await kv.set(`job:${job.id}`, job, JOB_TTL);
  if (!job.group) return;
  const opts = { parse_mode: "HTML", reply_markup: groupMarkup(username, job.id) };
  const edit = job.text != null && !job.group.caption
    ? api.editMessageText(job.group.chat, job.group.msgId, groupBody(job), opts)
    : api.editMessageCaption(job.group.chat, job.group.msgId, { ...opts, caption: groupBody(job).slice(0, 1024) });
  await edit.catch(() => {});
}
// 그룹방 공고에 답글로 남은 인원 알림
async function postRemaining(api, job, left) {
  if (!job.group) return;
  if (job.cap && left > 0) return; // 지원서 정원이 있으면 학생은 정원을 모르게 — "N명 남았습니다" 안 달고, 다 차면 "모집 완료"만
  const text = left > 0
    ? `🔔 <b>${left}명 남았습니다</b>`
    : "✅ <b>완료</b>";
  await api
    .sendMessage(job.group.chat, text, { parse_mode: "HTML", disable_notification: true, reply_parameters: { message_id: job.group.msgId, allow_sending_without_reply: true } })
    .catch(() => {});
}

bot.callbackQuery(/^p:close:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const job = await kv.get(`job:${ctx.match[1]}`);
  if (!job) return ctx.answerCallbackQuery({ text: "공고를 찾을 수 없어요.", show_alert: true });
  await closeJob(ctx.api, job);
  await ctx.answerCallbackQuery({ text: "✅ 모집 완료했어요" });
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
  await ctx.reply(`✅ 공고 #${job.id} 모집 완료했어요.${job.group ? " 채널 공고에도 '모집 완료'가 표시됐어요." : ""}`);
});

// 지원 접수 (1:1 버튼이든 그룹방 버튼이든 여기로) → 관리자 알림
export async function applyJob(api, from, jobId) {
  const job = await kv.get(`job:${jobId}`);
  const app = await kv.get(K.app(from.id));
  const lang = app?.lang ?? (await getLang(from));
  if (!job || job.closed) return { lang, msg: tx(lang, "jobClosed") };
  if (!(await kv.setNX(`jobyes:${jobId}:${from.id}`, 1, JOB_TTL))) return { lang, msg: tx(lang, "jobYes"), already: true };
  // 인원 세기 (선착순)
  let left = null, taken = null;
  const lim = capOf(job);
  if (lim) {
    taken = await kv.incr(`jobcnt:${jobId}`, 60 * 24 * 3600);
    if (taken > lim) {
      // 동시에 눌러서 넘친 경우 → 되돌리고 마감 안내
      await kv.decr(`jobcnt:${jobId}`).catch(() => {});
      await kv.del(`jobyes:${jobId}:${from.id}`);
      return { lang, msg: tx(lang, "jobClosed") };
    }
    left = lim - taken;
    await postRemaining(api, job, left);
    if (left === 0) await closeJob(api, job);
  }
  await kv.sadd(K.jobApps(jobId), from.id);
  await kv.set(K.jobApp(jobId, from.id), { at: Date.now(), name: fullName(from), username: from.username ?? null }, JOB_TTL);
  const who = app
    ? [`👤 <a href="tg://user?id=${app.id}">${esc(app.name)}</a> · ${esc(app.age)}`, `📞 ${app.phone ? `<code>${esc(app.phone)}</code>` : "한국 번호 없음"}`, `🏫 ${esc(app.school)} · TOPIK ${KO.topik[app.topik] ?? "-"}`, `📅 수업: ${dayText(app.days)}`]
    : [`👤 <a href="tg://user?id=${from.id}">${esc(fullName(from))}</a>${from.username ? ` (@${esc(from.username)})` : ""} · 정보 없음 (일당·단기 지원)`];
  const first = (job.text ?? job.caption ?? "").split("\n")[0].slice(0, 40);
  for (const a of await notifyIds(api)) {
    await api
      .sendMessage(
        a,
        [
          `🙋 <b>공고 #${jobId} 지원</b>${job.dateLabel ? ` · ${job.dateLabel}` : ""}${left != null ? ` · 지원 ${taken}/${lim}${job.cap && job.slots ? ` (모집 ${job.slots}명)` : ""}${left === 0 ? " · ✅ 지원 다 참" : ""}` : ""}`,
          `└ ${esc(first)}`,
          ...who,
        ].join("\n"),
        {
          ...html,
          link_preview_options: { is_disabled: true },
          reply_markup: (() => {
            const kb = new InlineKeyboard()
              .text("🚫 직전 취소 (빵꾸)", `a:nocancel:${jobId}:${from.id}`)
              .row()
              .text("↩️ 그냥 지원 취소 (자리 다시 열기)", `a:unapply:${jobId}:${from.id}`);
            if (adminAppUrl()) kb.row().webApp("📋 관리 화면에서 보기", adminAppUrl(`job=${jobId}`));
            return kb;
          })(),
        }
      )
      .catch(() => {});
  }
  return { lang, msg: tx(lang, "jobYes"), ok: true };
}

// 관리자: 지원 취소 (안 온다고 하거나 잘못 지원) → 자리 하나 다시 열고 그룹방에 남은 인원 알림
// 지원 취소 → 자리 다시 열기 (채팅 버튼 · 관리 미니앱 같이 씀)
export async function unapplyJob(api, jobId, uid, username) {
  const job = await kv.get(`job:${jobId}`);
  if (!job || !(await kv.get(`jobyes:${jobId}:${uid}`))) return { ok: false, error: "이미 취소됐거나 없는 지원이에요." };
  await kv.del(`jobyes:${jobId}:${uid}`);
  await kv.srem(K.jobApps(jobId), uid);
  await kv.del(K.jobApp(jobId, uid));
  if ((job.placed ?? []).includes(Number(uid))) { job.placed = job.placed.filter((x) => x !== Number(uid)); await kv.set(`job:${jobId}`, job, JOB_TTL); } // 배치에서도 뺌
  let left = null;
  if (capOf(job)) {
    const taken = await kv.decr(`jobcnt:${jobId}`);
    left = Math.max(0, capOf(job) - Math.max(0, taken));
    if (job.repostedTo) {
      // 이미 다시 올린 공고 → 예전 공고는 그대로 두고 기록만 정리
    } else {
      if (job.closed && left > 0) await reopenJob(api, job, username);
      await postRemaining(api, job, left);
    }
  }
  if (job.att?.[uid]) await setAttendance(jobId, uid, null);
  return { ok: true, left };
}

bot.callbackQuery(/^a:unapply:(\d+):(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const [, jobId, uid] = ctx.match;
  const r = await unapplyJob(ctx.api, jobId, uid, ctx.me.username);
  if (!r.ok) return ctx.answerCallbackQuery({ text: r.error, show_alert: true });
  await ctx.answerCallbackQuery({ text: `↩️ 취소했어요${r.left != null ? ` — 남은 인원 ${r.left}명` : ""}` });
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
});

bot.callbackQuery(/^a:nocancel:(\d+):(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const [, jobId, uid] = ctx.match;
  const r = await cancelAsNoShow(ctx.api, jobId, uid, ctx.me.username);
  if (!r.ok) return ctx.answerCallbackQuery({ text: r.error, show_alert: true });
  await ctx.answerCallbackQuery({ text: `🚫 빵꾸로 기록하고 취소했어요${r.left != null ? ` — 남은 인원 ${r.left}명` : ""}`, show_alert: true });
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
});

// ═════════════ ✅ 출근 / ❌ 빵꾸 기록 ═════════════
//  일한 날 저녁 8시쯤 관리자에게 공고별로 묻기 → [✅ 모두 출근] 한 번 또는 빵꾸만 표시
//  답이 없으면 다음 날 아침 한 번 더. 학생에게는 아무것도 안 감
export async function jobApplicants(jobId) {
  const ids = (await kv.smembers(K.jobApps(jobId))) ?? [];
  const [apps, joins] = await Promise.all([kv.mget(ids.map(K.app)), kv.mget(ids.map((id) => K.jobApp(jobId, id)))]);
  // 정보 없이 지원한 학생은 텔레그램 이름으로
  return ids.map((id, i) => apps[i] ?? { id: Number(id), name: joins[i]?.name ?? `#${id}`, username: joins[i]?.username ?? null, guest: true });
}

// r = "ok" | "no" | null(지우기)
export async function setAttendance(jobId, uid, r) {
  const job = await kv.get(`job:${jobId}`);
  if (!job) return null;
  job.att ??= {};
  const prev = job.att[uid] ?? null;
  if (prev === r) return job;
  if (r) job.att[uid] = r;
  else delete job.att[uid];
  await kv.set(`job:${jobId}`, job, JOB_TTL);
  let app = await kv.get(K.app(uid));
  if (!app && r) {
    // 정보 없이 지원한 학생(일당·단기)도 출근·빵꾸 기록은 남김 — 이름·@아이디만 있는 가벼운 기록 (guest)
    const j = await kv.get(K.jobApp(jobId, uid));
    app = { id: Number(uid), guest: true, name: j?.name ?? `#${uid}`, tgName: j?.name ?? null, username: j?.username ?? null, status: "new", createdAt: Date.now(), updatedAt: Date.now() };
    await kv.sadd(K.apps, app.id);
  }
  if (app) {
    app.workOk = (app.workOk ?? 0) + (r === "ok" ? 1 : 0) - (prev === "ok" ? 1 : 0);
    app.workNo = (app.workNo ?? 0) + (r === "no" ? 1 : 0) - (prev === "no" ? 1 : 0);
    app.hist = (app.hist ?? []).filter((h) => h.job !== Number(jobId));
    if (r) app.hist.unshift({ job: Number(jobId), date: job.date ?? todayISO(), r, title: (job.text ?? job.caption ?? "").split("\n")[0].slice(0, 40) });
    app.hist = app.hist.slice(0, 30);
    await kv.set(K.app(uid), app);
  }
  return job;
}

// ❌ 빵꾸 직접 추가 (공고와 상관없이 — 예: 전화로 갑자기 취소) / 마지막 직접 기록 지우기
export async function addNoShow(uid, note, by) {
  const app = await kv.get(K.app(uid));
  if (!app) throw new Error("학생을 찾을 수 없어요");
  app.workNo = (app.workNo ?? 0) + 1;
  app.hist = [{ job: null, date: todayISO(), r: "no", title: String(note ?? "").trim().slice(0, 60) || "직접 추가", by, manual: Date.now() }, ...(app.hist ?? [])].slice(0, 30);
  await kv.set(K.app(uid), app);
  return app;
}
// 📝 근무 이력 직접 넣기 (혜승 요청 11-04: 업장 고르기/검색 + 날짜 + 출근/빵꾸)
export async function addWork(uid, { title, date, r, jobId, by }) {
  const app = await kv.get(K.app(uid));
  if (!app) throw new Error("학생을 찾을 수 없어요");
  const res = r === "no" ? "no" : "ok";
  if (res === "ok") app.workOk = (app.workOk ?? 0) + 1;
  else app.workNo = (app.workNo ?? 0) + 1;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? date : todayISO();
  app.hist = [{ job: jobId ? Number(jobId) : null, date: d, r: res, title: String(title ?? "").trim().slice(0, 60) || "직접 추가", by, manual: Date.now() }, ...(app.hist ?? [])]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 50);
  await kv.set(K.app(uid), app);
  return app;
}
// ✏️ 공고 고치기 — 채널 공고 글도 같이 바꿈
export async function editJob(api, id, { text, slots, cap, form, media }) {
  const job = await kv.get(`job:${id}`);
  if (!job) throw new Error("공고를 찾을 수 없어요");
  const t = String(text ?? "").trim();
  if (!t) throw new Error("공고 내용을 써 주세요");
  if (job.text != null) job.text = t;
  else job.caption = t;
  const m = /(\d{1,3})\s*명/.exec(t);
  job.slots = slots ? Number(slots) : m ? Number(m[1]) : job.slots;
  if (cap !== undefined) job.cap = Number(cap) > 0 ? Number(cap) : null;
  job.startMin = textStartMin(t) ?? job.startMin ?? null;
  if (form && typeof form === "object") job.form = form;
  // 📷 사진·영상 바꾸기 (11-05 대표 요청) — 글로 만든 공고만. 바뀌면 채널 공고를 새로 올리고 예전 글·앨범은 지움
  let mediaChanged = false;
  if (Array.isArray(media) && job.text != null) {
    const nm = media.filter((m) => m && typeof m.id === "string" && (m.type === "photo" || m.type === "video")).slice(0, 10).map((m) => ({ type: m.type, id: m.id }));
    if (JSON.stringify(nm.map((m) => m.id)) !== JSON.stringify((job.media ?? []).map((m) => m.id))) { job.media = nm; mediaChanged = true; }
  }
  job.editedAt = Date.now();
  if (job.group && mediaChanged) {
    const name = await meName(api);
    const old = job.group;
    let msg;
    try {
      msg = await sendTo(api, old.chat, job, groupBody(job, !!job.closed), job.closed ? closedMarkup(name) : groupMarkup(name, job.id));
    } catch (e) { throw new Error("채널에 새 공고를 못 올렸어요: " + (e.description ?? e.message)); }
    job.group = { chat: old.chat, msgId: msg.message_id, ...(msg.isCaption ? { caption: true } : {}), ...(msg.album ? { album: msg.album } : {}) };
    await kv.set(`job:${id}`, job, JOB_TTL);
    await api.deleteMessage(old.chat, old.msgId).catch(() => {});
    for (const a of old.album ?? []) await api.deleteMessage(old.chat, a).catch(() => {});
    return job;
  }
  await kv.set(`job:${id}`, job, JOB_TTL);
  if (job.group) {
    const name = await meName(api);
    const body = groupBody(job, !!job.closed);
    const markup = job.closed ? closedMarkup(name) : groupMarkup(name, job.id);
    const r = job.text != null && !job.group.caption
      ? api.editMessageText(job.group.chat, job.group.msgId, body, { parse_mode: "HTML", reply_markup: markup, link_preview_options: { is_disabled: true } })
      : api.editMessageCaption(job.group.chat, job.group.msgId, { caption: body.slice(0, 1024), parse_mode: "HTML", reply_markup: markup });
    await r.catch((e) => { if (!/not modified/.test(e.description ?? "")) throw new Error("채널 공고를 못 고쳤어요: " + (e.description ?? e.message)); });
  }
  return job;
}
// 🗑 공고 지우기 — 채널 공고 글도 지움 (지원·출근 기록은 학생 카드에 남음)
export async function deleteJobs(api, ids) {
  let n = 0;
  for (const id of ids) {
    const job = await kv.get(`job:${id}`);
    if (!job) continue;
    if (job.group) {
      await api.deleteMessage(job.group.chat, job.group.msgId).catch(() => {});
      for (const a of job.group.album ?? []) await api.deleteMessage(job.group.chat, a).catch(() => {});
    }
    await kv.del(`job:${id}`);
    await kv.srem(K.jobs, Number(id));
    n++;
  }
  return n;
}
// ═════════════ 🏢 업장 · ⭐ 배치 · ✅ 모집 완료 안내 (11-06 혜승 피드백 → 대표 결정) ═════════════
//  업장 → 공고 → 학생. 업장의 실제 이름은 관리자만, 학생에게는 학생용 이름(shown)만 보임
const placeKey = (id) => `place:${id}`;
export async function allPlaces() {
  const ids = (await kv.smembers("places")) ?? [];
  return (await kv.mget(ids.map(placeKey))).filter(Boolean).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}
export async function savePlace(p, by) {
  const name = String(p?.name ?? "").trim().slice(0, 60);
  const shown = String(p?.shown ?? "").trim().slice(0, 60);
  if (!name) throw new Error("실제 업장 이름을 써 주세요");
  if (!shown) throw new Error("학생에게 보일 이름을 써 주세요");
  const id = p.id ? Number(p.id) : await kv.incr("placeseq");
  const old = p.id ? await kv.get(placeKey(id)) : null;
  if (p.id && !old) throw new Error("업장을 찾을 수 없어요");
  const place = { ...(old ?? { id, at: Date.now(), by }), name, shown, addr: String(p.addr ?? "").trim().slice(0, 200), boss: String(p.boss ?? "").trim().slice(0, 100), memo: String(p.memo ?? "").trim().slice(0, 1000), editedAt: Date.now() };
  await kv.set(placeKey(id), place);
  await kv.sadd("places", id);
  return place;
}
// 업장 지우기 — 그 업장 공고는 "업장 없음"으로 남음 (공고·학생 기록은 그대로)
export async function deletePlace(id) {
  await kv.del(placeKey(Number(id)));
  await kv.srem("places", Number(id));
  const jobs = (await kv.mget(((await kv.smembers(K.jobs)) ?? []).map((x) => `job:${x}`))).filter((j) => j && j.placeId === Number(id));
  for (const j of jobs) { j.placeId = null; await kv.set(`job:${j.id}`, j, JOB_TTL); }
  return jobs.length;
}
export async function setJobPlace(jobId, placeId) {
  const job = await kv.get(`job:${jobId}`);
  if (!job) throw new Error("공고를 찾을 수 없어요");
  if (placeId && !(await kv.get(placeKey(Number(placeId))))) throw new Error("업장을 찾을 수 없어요");
  job.placeId = placeId ? Number(placeId) : null;
  await kv.set(`job:${jobId}`, job, JOB_TTL);
  return job;
}
// ⭐ 배치하기 / 배치 빼기 — 모집인원만큼 차면 더 못 넣음 ("배치 인원이 찼습니다")
export async function placeStudent(jobId, uid, on) {
  const job = await kv.get(`job:${jobId}`);
  if (!job) throw new Error("공고를 찾을 수 없어요");
  uid = Number(uid);
  job.placed = (job.placed ?? []).filter((x) => x !== uid);
  if (on) {
    if (!((await kv.smembers(K.jobApps(jobId))) ?? []).map(Number).includes(uid)) throw new Error("이 공고 지원자가 아니에요");
    if (job.slots && job.placed.length >= job.slots) throw new Error("FULL");
    job.placed.push(uid);
  } else if (job.notified?.[uid]) delete job.notified[uid]; // 다시 배치하면 안내도 다시
  await kv.set(`job:${jobId}`, job, JOB_TTL);
  return job;
}
// 학생 안내 메시지 — 날짜·시간은 공고 칸에서, 요일은 학생 언어로
const isoMD = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const isoDow = (iso) => (new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7; // 월=0
export function confirmText(job, place, lang) {
  const f = job.form ?? {};
  const wd = tx(lang, "cfWd");
  const day = (iso) => `${isoMD(iso)} (${wd[isoDow(iso)]})`;
  let date = null;
  if (f.payType === "시간제" && f.dates?.length) date = [...f.dates].sort().map(day).join(", ");
  else if (f.startDate || f.days?.length) date = [f.startDate ? tx(lang, "cfFrom").replace("{d}", day(f.startDate)) : null, f.days?.length ? [...f.days].sort((a, b) => a - b).map((i) => wd[i]).join(", ") : null].filter(Boolean).join(" · ");
  else if (job.date) date = day(job.date);
  const tr = (a, b) => (a || b ? `${a || "?"} ~ ${b || "?"}` : null);
  let time = null;
  if (f.payType === "시간제" || !(f.days ?? []).some((x) => x >= 5)) time = tr(f.wdS, f.wdE);
  else {
    const wdDays = f.days.filter((x) => x < 5), weDays = f.days.filter((x) => x >= 5);
    time = [wdDays.length && tr(f.wdS, f.wdE) ? `${wdDays.map((i) => wd[i]).join(", ")}: ${tr(f.wdS, f.wdE)}` : null, weDays.length && tr(f.weS, f.weE) ? `${weDays.map((i) => wd[i]).join(", ")}: ${tr(f.weS, f.weE)}` : null].filter(Boolean).join("\n") || null;
  }
  if (!time && job.startMin != null) time = `${String(Math.floor(job.startMin / 60)).padStart(2, "0")}:${String(job.startMin % 60).padStart(2, "0")} ~`;
  const addr = place?.addr || f.addr || null;
  const name = place?.shown || f.title || null;
  return [
    tx(lang, "cfTitle"),
    "",
    name ? `${tx(lang, "cfPlace")}: <b>${esc(name)}</b>` : null,
    date ? `${tx(lang, "cfDate")}: <b>${esc(date)}</b>` : null,
    time ? `${tx(lang, "cfTime")}: <b>${esc(time)}</b>` : null,
    addr ? `${tx(lang, "cfAddr")}: ${esc(addr)}` : null,
    "",
    tx(lang, "cfArrive"),
  ].filter((x) => x !== null).join("\n");
}
// ✅ 모집 완료 + 배치된 학생에게 1:1 출근 안내 (이미 안내 받은 학생은 빼고 보냄)
export async function finishJob(api, jobId) {
  let job = await kv.get(`job:${jobId}`);
  if (!job) throw new Error("공고를 찾을 수 없어요");
  if (!job.closed) { await closeJob(api, job); job = await kv.get(`job:${jobId}`); }
  const place = job.placeId ? await kv.get(placeKey(job.placeId)) : null;
  job.notified ??= {};
  const targets = (job.placed ?? []).filter((u) => !job.notified[u]);
  let sent = 0, fail = 0;
  for (const uid of targets) {
    const app = await kv.get(K.app(uid));
    const lang = app?.lang ?? (await kv.get(`lang:${uid}`)) ?? "uz";
    const ok = await api.sendMessage(uid, confirmText(job, place, lang), { ...html, link_preview_options: { is_disabled: true } }).then(() => true).catch(() => false);
    if (ok) { job.notified[uid] = Date.now(); sent++; } else fail++;
    await sleep(40);
  }
  job.finishedAt ??= Date.now();
  await kv.set(`job:${jobId}`, job, JOB_TTL);
  return { sent, fail };
}

export async function removeManualNoShow(uid, at) {
  const app = await kv.get(K.app(uid));
  if (!app) throw new Error("학생을 찾을 수 없어요");
  const i = (app.hist ?? []).findIndex((h) => h.manual === Number(at));
  if (i < 0) throw new Error("이미 지웠어요");
  const [h] = app.hist.splice(i, 1);
  if (h.r === "ok") app.workOk = Math.max(0, (app.workOk ?? 0) - 1);
  else app.workNo = Math.max(0, (app.workNo ?? 0) - 1);
  await kv.set(K.app(uid), app);
  return app;
}
// 🚫 직전 취소 = ❌ 빵꾸로 기록 + 지원 취소(자리 다시 열기)
export async function cancelAsNoShow(api, jobId, uid, username) {
  // 지원 취소 먼저 (취소하면 그 공고 출근 기록이 지워지므로), 그다음 학생 기록에 빵꾸 1회
  const job = await kv.get(`job:${jobId}`);
  const j = await kv.get(K.jobApp(jobId, uid));
  const left = await unapplyJob(api, jobId, uid, username);
  let app = await kv.get(K.app(uid));
  if (!app) {
    app = { id: Number(uid), guest: true, name: j?.name ?? `#${uid}`, tgName: j?.name ?? null, username: j?.username ?? username ?? null, status: "new", createdAt: Date.now(), updatedAt: Date.now() };
    await kv.sadd(K.apps, app.id);
  }
  app.workNo = (app.workNo ?? 0) + 1;
  const title = "직전 취소 · " + (job?.text ?? job?.caption ?? "").split("\n")[0].slice(0, 34);
  app.hist = [{ job: null, date: job?.date ?? todayISO(), r: "no", title, manual: Date.now() }, ...(app.hist ?? [])].slice(0, 30);
  await kv.set(K.app(uid), app);
  return left;
}

// 출근 확인 (11-06 대표 피드백): 안내 문구 없앰([나머지 모두 출근] 버튼은 맨 아래 유지), 출근 시간 표시,
// 이름 줄(전체 폭, 이름이 안 잘리게) 바로 아래 [✅ 출근][❌ 빵꾸] 줄 — 텔레그램은 한 줄 버튼 너비가 같아서 이렇게 나눔
const attStartMin = (job) => job.startMin ?? textStartMin(job.text ?? job.caption);
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const attMark = (r) => (r === "ok" ? "✅" : r === "no" ? "❌" : "⬜");
const attText = (job, apps, done = false) => {
  const st = attStartMin(job);
  const when = [job.dateLabel ? `📅 ${job.dateLabel}` : null, st != null ? `🕘 출근 <b>${hhmm(st)}</b>` : null].filter(Boolean).join(" · ");
  const lines = [`📋 <b>출근 확인 — 공고 #${job.id}</b>`, `└ ${esc((job.text ?? job.caption ?? "").split("\n")[0].slice(0, 40))}`];
  if (when) lines.push(when);
  // 버튼이 없어진 뒤(끝)에만 글로 결과 명단을 남김
  if (done) lines.push("", ...apps.map((a, i) => `${i + 1}. ${attMark(job.att?.[a.id])} ${esc(a.name)}`));
  return lines.join("\n");
};
const attKeyboard = (job, apps) => {
  const kb = new InlineKeyboard();
  apps.forEach((a, i) => {
    const r = job.att?.[a.id];
    kb.text(`${i + 1}. ${attMark(r)} ${a.name}`, "f:noop")
      .row()
      .text(r === "ok" ? "● ✅ 출근" : "✅ 출근", `a:att:${job.id}:${a.id}:ok`)
      .text(r === "no" ? "● ❌ 빵꾸" : "❌ 빵꾸", `a:att:${job.id}:${a.id}:no`)
      .row();
  });
  // 맨 아래: 빵꾸 누른 사람 빼고 아직 안 누른 사람 모두 출근으로 한 번에
  return kb.text("✅ 나머지 모두 출근했어요", `a:attall:${job.id}`);
};

// 출근 확인 대상 = 배치된 학생 (배치한 사람이 없으면 예전처럼 지원자 모두)
export async function attendees(jobOrId) {
  const job = typeof jobOrId === "object" ? jobOrId : await kv.get(`job:${jobOrId}`);
  const apps = await jobApplicants(job?.id ?? jobOrId);
  const placed = job?.placed ?? [];
  return placed.length ? apps.filter((a) => placed.includes(Number(a.id))) : apps;
}
async function askAttendance(api, job) {
  const apps = await attendees(job);
  if (!apps.length) return false;
  for (const a of await notifyIds(api)) {
    await api.sendMessage(a, attText(job, apps), { ...html, reply_markup: attKeyboard(job, apps) }).catch(() => {});
  }
  return true;
}

// 정기 확인: 오늘 날짜 공고는 20시 이후, 날짜 없는 공고는 마감 다음 날 → 묻기 / 답 없으면 다음 날 10시 이후 한 번 더
export async function checkAttendance(api) {
  const h = hourKST();
  const today = todayISO();
  const ids = (await kv.smembers(K.jobs)) ?? [];
  const jobs = (await kv.mget(ids.map((id) => `job:${id}`))).filter(Boolean);
  let asked = 0;
  for (const job of jobs) {
    if (job.attDone) continue;
    const day = job.date ?? (job.closedAt ? new Date(job.closedAt + 9 * 3600e3 + DAY).toISOString().slice(0, 10) : null);
    if (!day) continue;
    const apps = job.placed?.length ? job.placed : (await kv.smembers(K.jobApps(job.id))) ?? [];
    if (!apps.length) continue;
    const allMarked = apps.every((u) => job.att?.[u]);
    if (allMarked) {
      job.attDone = true;
      await kv.set(`job:${job.id}`, job, JOB_TTL);
      continue;
    }
    const n = job.attAsked ?? 0;
    // 시작 시간이 있으면 그 30분 뒤에, 없으면 예전처럼 그날 저녁 8시
    const startAt = job.startMin != null && job.date ? Date.parse(`${job.date}T00:00:00+09:00`) + (job.startMin + 30) * 60e3 : null;
    const first = n === 0 && (startAt ? Date.now() >= startAt : day < today || (day === today && h >= 20));
    const second = n === 1 && day < today && h >= 10 && Date.now() - (job.attAskedAt ?? 0) > 10 * 3600e3;
    if (!first && !second) continue;
    job.attAsked = n + 1;
    job.attAskedAt = Date.now();
    await kv.set(`job:${job.id}`, job, JOB_TTL);
    if (await askAttendance(api, job)) asked++;
  }
  return asked;
}

bot.callbackQuery(/^a:att:(\d+):(\d+):(ok|no)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const [, jobId, uid, r] = ctx.match;
  const job = await setAttendance(jobId, uid, r);
  if (!job) return ctx.answerCallbackQuery({ text: "공고를 찾을 수 없어요.", show_alert: true });
  await ctx.answerCallbackQuery({ text: r === "ok" ? "✅ 출근" : "❌ 빵꾸" });
  const apps = await attendees(jobId);
  // 모두 체크하면 버튼을 거두고 결과 명단으로 마무리 (고칠 땐 관리 미니앱 공고 카드에서)
  if (apps.every((a) => job.att?.[a.id])) {
    job.attDone = true;
    await kv.set(`job:${jobId}`, job, JOB_TTL);
    return ctx.editMessageText(attText(job, apps, true) + "\n\n✅ 출근 확인 끝", { ...html, reply_markup: { inline_keyboard: [] } }).catch(() => {});
  }
  await ctx.editMessageText(attText(job, apps), { ...html, reply_markup: attKeyboard(job, apps) }).catch(() => {});
});
bot.callbackQuery(/^a:attall:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const jobId = ctx.match[1];
  const apps = await attendees(jobId);
  let job = await kv.get(`job:${jobId}`);
  if (!job) return ctx.answerCallbackQuery();
  for (const a of apps) if (!job.att?.[a.id]) job = await setAttendance(jobId, a.id, "ok");
  job.attDone = true;
  await kv.set(`job:${jobId}`, job, JOB_TTL);
  await ctx.answerCallbackQuery({ text: "✅ 기록했어요" });
  await ctx.editMessageText(attText(job, apps, true) + "\n\n✅ 출근 확인 끝", { ...html, reply_markup: { inline_keyboard: [] } }).catch(() => {});
});

// 학생: 1:1 공고에 관심 / 관심 없음
bot.callbackQuery(/^j:(y|n):(\d+)$/, async (ctx) => {
  const [, yn, jobId] = ctx.match;
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
  if (yn === "n") {
    const app = await kv.get(K.app(ctx.from.id));
    return ctx.reply(tx(app?.lang ?? (await getLang(ctx.from)), "jobNo"));
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

  const lang = await getLang(ctx.from);
  const app = await kv.get(K.app(ctx.from.id));
  if (!app) return sendGreet(ctx.api, ctx.chat.id, ctx.from, lang);
  // 이미 지원한 학생이 보낸 메시지 → 관리자에게 전달
  for (const a of await notifyIds(ctx.api)) {
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

// 그룹에 잠깐 올린 안내(새 학생 이름 부르기) 10분 지나면 지우기
async function cleanupTemp(api) {
  const list = (await kv.lrange("tmpmsg")) ?? [];
  if (!list.length) return;
  const keep = [];
  for (const t of list) {
    if (Date.now() - t.at > 10 * 60 * 1000) await api.deleteMessage(t.chat, t.id).catch(() => {});
    else keep.push(t);
  }
  await kv.del("tmpmsg");
  for (const t of keep) await kv.rpush("tmpmsg", t, 7 * 24 * 3600);
}

export async function runReminders(api) {
  await cleanupTemp(api).catch(() => {});
  await checkAttendance(api).catch((e) => console.error("출근 확인 실패:", e.message));
  await refDaily(api).catch((e) => console.error("이벤트 끌올 실패:", e.message));
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
