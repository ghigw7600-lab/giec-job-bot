// ═════════════════════════════════════════════════════════════
//  학생에게 보이는 문구 (우즈벡어 기본 · 러시아어)
//   텔레그램 앱 언어가 러시아어·키르기스어·카자흐어면 러시아어, 그 외엔 우즈벡어
//   ⚠️ "취업 보장", "합법 취업" 같은 표현은 쓰지 않음
//   우즈벡어는 칸·혜승 검토 후 여기서 바로 고치면 됨
// ═════════════════════════════════════════════════════════════

export const TEXT = {
  uz: {
    greet:
      "Assalomu alaykum, {name}! 👋 Xush kelibsiz.\n«O'zim haqimda» — 7 ta qisqa savol, 1 daqiqa ⏱\n\n<i>Ma'lumotlaringiz faqat ish uchun ishlatiladi.</i>",
    btnStart: "✅ Roziman, boshladik",
    name: "<b>1/7</b> · Ism va familiyangizni pasportdagidek lotin harflarida yozing\n\nMasalan: <code>ALIEV JASUR</code>",
    nameBad: "Ism va familiyangizni lotin harflarida yozing. Masalan: ALIEV JASUR",
    age: "<b>2/7</b> · Yoshingiz nechida? Faqat raqam yozing\n\nMasalan: <code>21</code>",
    ageBad: "Faqat raqam yozing. Masalan: 21",
    gender: "<b>3/7</b> · Jinsingiz?",
    genderOpts: ["👨 Erkak", "👩 Ayol"],
    genderOnly: "Jinsingizni belgilang 👇",
    phone: "<b>4/7</b> · Koreya telefon raqamingizni yuboring 📱\nPastdagi tugmani bosing 👇",
    btnPhone: "📱 Raqamni yuborish",
    btnNoPhone: "Koreya raqamim hali yo'q",
    phoneNotKr: "Bu raqam Koreya raqami emas 🙂\nKoreya raqamingizni yozing (010 bilan boshlanadi)\n\nMasalan: <code>010-1234-5678</code>",
    phoneBad: "Raqam 010 bilan boshlanishi kerak. Masalan: 010-1234-5678",
    school: "<b>5/7</b> · Qaysi universitetda o'qiysiz?\n\nMasalan: <code>Shinhan</code>",
    topik: "<b>6/7</b> · TOPIK darajangiz qanday?",
    topikOpts: ["Yo'q", "1–2", "3", "4+"],
    ielts: "<b>7/9</b> · IELTS bormi?",
    ieltsOpts: ["Yo'q", "5.0 va past", "5.5", "6.0+"],
    car: "<b>8/9</b> · Mashinangiz bormi?",
    carOpts: ["Bor", "Yo'q"],
    days: "<b>7/7</b> · Qaysi kunlari darsingiz bor?\nKunlarni belgilab, <b>«Tayyor»</b> ni bosing",
    daysAgain: "Yangi semestr boshlandi 📚\nDars kunlaringizni qaytadan belgilab, <b>«Tayyor»</b> ni bosing",
    dayNames: ["Du", "Se", "Ch", "Pa", "Ju", "Sh"],
    btnDone: "✅ Tayyor",
    done: "Rahmat! ✅ «O'zim haqimda» qabul qilindi.\nMenejerimiz tez orada siz bilan bog'lanadi 🙌",
    daysUpdated: "Rahmat! Dars kunlaringiz yangilandi ✅",
    already: "Siz «O'zim haqimda» ni avval to'ldirgansiz ✅\nYana ish qidiryapsizmi? 👇",
    btnAgain: "🔁 Ha, yana ish qidiryapman",
    btnUpdate: "✏️ «O'zim haqimda» ni yangilash",
    again: "Rahmat! ✅ Menejerimiz tez orada siz bilan bog'lanadi 🙌",
    jobHead: "🔔 <b>Yangi ish taklifi</b>",
    jobFoot: "Qiziqsangiz, pastdagi tugmani bosing 👇",
    btnJobYes: "🙋 Qiziqaman",
    btnJobNo: "Kerak emas",
    jobYes: "Rahmat! ✅ Menejerimiz tez orada siz bilan bog'lanadi 🙌",
    jobNo: "👌 Tushunarli. Keyingi takliflarni yuboramiz.",
    jobClosed: "Bu ishga qabul yakunlandi 🙏 Keyingi takliflarni kuting!",
    msgSent: "Xabaringiz menejerga yuborildi ✅",
    remind: "«O'zim haqimda» hali to'liq emas 🙂\nOz qoldi — pastdagi tugmani bosib davom ettiring 👇",
    btnContinue: "▶️ Davom etish",
    pinPost: "💼 <b>Ish kerakmi?</b>\n\nBotda «O'zim haqimda» ni to'ldiring — menejerimiz siz bilan bog'lanadi.\nBor-yo'g'i 1 daqiqa ⏱\n\n👇 Pastdagi tugmani bosing",
    btnPin: "📝 «O'zim haqimda» ni to'ldirish",
    groupHello: "{name}, xush kelibsiz! 👋\nIsh takliflarini olish uchun botda «O'zim haqimda» ni to'ldiring — 1 daqiqa ⏱",
  },
  ru: {
    greet:
      "Здравствуйте, {name}! 👋 Добро пожаловать.\n«О себе» — 7 коротких вопросов, 1 минута ⏱\n\n<i>Данные используются только для работы.</i>",
    btnStart: "✅ Согласен(на), начать",
    name: "<b>1/7</b> · Напишите имя и фамилию латиницей, как в паспорте\n\nНапример: <code>ALIEV JASUR</code>",
    nameBad: "Напишите имя и фамилию латиницей. Например: ALIEV JASUR",
    age: "<b>2/7</b> · Сколько вам лет? Только цифры\n\nНапример: <code>21</code>",
    ageBad: "Только цифры. Например: 21",
    gender: "<b>3/7</b> · Ваш пол?",
    genderOpts: ["👨 Мужской", "👩 Женский"],
    genderOnly: "Укажите ваш пол 👇",
    phone: "<b>4/7</b> · Отправьте ваш корейский номер телефона 📱\nНажмите кнопку ниже 👇",
    btnPhone: "📱 Отправить номер",
    btnNoPhone: "Корейского номера пока нет",
    phoneNotKr: "Это не корейский номер 🙂\nНапишите корейский номер (начинается с 010)\n\nНапример: <code>010-1234-5678</code>",
    phoneBad: "Номер должен начинаться с 010. Например: 010-1234-5678",
    school: "<b>5/7</b> · В каком университете вы учитесь?\n\nНапример: <code>Shinhan</code>",
    topik: "<b>6/7</b> · Ваш уровень TOPIK?",
    topikOpts: ["Нет", "1–2", "3", "4+"],
    ielts: "<b>7/9</b> · Есть IELTS?",
    ieltsOpts: ["Нет", "5.0 и ниже", "5.5", "6.0+"],
    car: "<b>8/9</b> · Есть машина?",
    carOpts: ["Есть", "Нет"],
    days: "<b>7/7</b> · В какие дни у вас занятия?\nОтметьте дни и нажмите <b>«Готово»</b>",
    daysAgain: "Начался новый семестр 📚\nОтметьте дни занятий заново и нажмите <b>«Готово»</b>",
    dayNames: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб"],
    btnDone: "✅ Готово",
    done: "Спасибо! ✅ Анкета «О себе» принята.\nМенеджер скоро свяжется с вами 🙌",
    daysUpdated: "Спасибо! Дни занятий обновлены ✅",
    already: "Вы уже заполняли «О себе» ✅\nСнова ищете работу? 👇",
    btnAgain: "🔁 Да, снова ищу работу",
    btnUpdate: "✏️ Обновить «О себе»",
    again: "Спасибо! ✅ Менеджер скоро свяжется с вами 🙌",
    jobHead: "🔔 <b>Новая вакансия</b>",
    jobFoot: "Если интересно, нажмите кнопку ниже 👇",
    btnJobYes: "🙋 Интересно",
    btnJobNo: "Не нужно",
    jobYes: "Спасибо! ✅ Менеджер скоро свяжется с вами 🙌",
    jobNo: "👌 Понятно. Будем присылать следующие предложения.",
    jobClosed: "Набор на эту работу завершён 🙏 Ждите следующих предложений!",
    msgSent: "Ваше сообщение отправлено менеджеру ✅",
    remind: "Вы не закончили «О себе» 🙂\nОсталось немного — нажмите кнопку ниже 👇",
    btnContinue: "▶️ Продолжить",
    pinPost: "",
    btnPin: "📝 Заполнить «О себе»",
    groupHello: "{name}, добро пожаловать! 👋\nЧтобы получать вакансии, заполните «О себе» в боте — 1 минута ⏱",
  },
};

import { MORE, LANGS, BOARD, REFER } from "./text-more.js";
Object.assign(TEXT, MORE);
for (const [l, strings] of Object.entries(BOARD)) TEXT[l] = { ...(TEXT[l] ?? {}), ...strings };
for (const [l, strings] of Object.entries(REFER)) TEXT[l] = { ...(TEXT[l] ?? {}), ...strings };
export { LANGS };

// 텔레그램 앱 언어 → 봇 언어 (학생이 [🌐] 버튼으로 바꾸면 그게 우선 — bot.js getLang)
export function langOf(code) {
  const c = String(code ?? "").toLowerCase();
  if (!c || c.startsWith("uz")) return "uz";
  if (c.startsWith("ky")) return "ky";
  if (/^(ru|kk|be|uk|tg)/.test(c)) return "ru";
  if (c.startsWith("mn")) return "mn";
  if (c.startsWith("vi")) return "vi";
  if (c.startsWith("th")) return "th";
  return "en"; // 그 외 언어 (영어 등)
}
export const langName = (code) => LANGS.find((l) => l[0] === code)?.[2] ?? "우즈벡어";
export const tx = (lang, key) => TEXT[lang]?.[key] || TEXT.uz[key];
export const LANG_BTN = "🌐 Til · Язык · Language";

// 관리자 카드에 쓰는 한국어 값 (학생이 고른 버튼 번호 → 한국어)
export const KO = {
  topik: ["없음", "1–2급", "3급", "4급 이상"],
  ielts: ["없음", "5.0 이하", "5.5", "6.0 이상"],
  car: ["있음", "없음"],
  gender: ["남", "여"],
  days: ["월", "화", "수", "목", "금", "토"],
};
