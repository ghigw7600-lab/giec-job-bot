// ═════════════════════════════════════════════════════════════
//  학생에게 보이는 문구 (우즈벡어 기본 · 러시아어)
//   텔레그램 앱 언어가 러시아어·키르기스어·카자흐어면 러시아어, 그 외엔 우즈벡어
//   ⚠️ "취업 보장", "합법 취업" 같은 표현은 쓰지 않음
//   우즈벡어는 칸·혜승 검토 후 여기서 바로 고치면 됨
// ═════════════════════════════════════════════════════════════

export const TEXT = {
  uz: {
    greet:
      "Assalomu alaykum, {name}! 👋\nGIEC JOB ga xush kelibsiz.\n\nSizga mos ish topishimiz uchun 8 ta qisqa savolga javob bering — 1 daqiqa vaqt oladi ⏱\n\n<i>Ma'lumotlaringiz faqat ish taklif qilish uchun ishlatiladi.</i>",
    btnStart: "✅ Roziman, boshladik",
    name: "<b>1/8</b> · Ism va familiyangizni pasportdagidek lotin harflarida yozing\n\nMasalan: <code>ALIEV JASUR</code>",
    nameBad: "Ism va familiyangizni lotin harflarida yozing. Masalan: ALIEV JASUR",
    age: "<b>2/8</b> · Yoshingiz nechida? Faqat raqam yozing\n\nMasalan: <code>21</code>",
    ageBad: "Faqat raqam yozing. Masalan: 21",
    phone: "<b>3/8</b> · Koreya telefon raqamingizni yuboring 📱\nPastdagi tugmani bosing 👇",
    btnPhone: "📱 Raqamni yuborish",
    btnNoPhone: "Koreya raqamim hali yo'q",
    phoneNotKr: "Bu raqam Koreya raqami emas 🙂\nKoreya raqamingizni yozing (010 bilan boshlanadi)\n\nMasalan: <code>010-1234-5678</code>",
    phoneBad: "Raqam 010 bilan boshlanishi kerak. Masalan: 010-1234-5678",
    school: "<b>4/8</b> · Qaysi universitetda o'qiysiz?\n\nMasalan: <code>Shinhan</code>",
    topik: "<b>5/8</b> · TOPIK darajangiz qanday?",
    topikOpts: ["Yo'q", "1–2", "3", "4+"],
    ielts: "<b>6/8</b> · IELTS bormi?",
    ieltsOpts: ["Yo'q", "5.0 va past", "5.5", "6.0+"],
    car: "<b>7/8</b> · Mashinangiz bormi?",
    carOpts: ["Bor", "Yo'q"],
    days: "<b>8/8</b> · Qaysi kunlari darsingiz bor?\nKunlarni belgilab, <b>«Tayyor»</b> ni bosing",
    daysAgain: "Yangi semestr boshlandi 📚\nDars kunlaringizni qaytadan belgilab, <b>«Tayyor»</b> ni bosing",
    dayNames: ["Du", "Se", "Ch", "Pa", "Ju", "Sh"],
    btnDone: "✅ Tayyor",
    done: "Rahmat! ✅ Ma'lumotlaringiz qabul qilindi.\nMenejerimiz tez orada siz bilan bog'lanadi 🙌",
    daysUpdated: "Rahmat! Dars kunlaringiz yangilandi ✅",
    already: "Siz allaqachon ma'lumot qoldirgansiz ✅\nMenejerimiz siz bilan bog'lanadi.\n\nMa'lumotlaringiz o'zgargan bo'lsa, pastdagi tugmani bosing 👇",
    btnUpdate: "✏️ Ma'lumotlarni yangilash",
    msgSent: "Xabaringiz menejerga yuborildi ✅",
    pinPost: "💼 <b>Ish kerakmi?</b>\n\nBotga ma'lumotlaringizni qoldiring — menejerimiz siz bilan bog'lanadi.\nBor-yo'g'i 1 daqiqa ⏱\n\n👇 Pastdagi tugmani bosing",
    btnPin: "📝 Ma'lumot qoldirish",
  },
  ru: {
    greet:
      "Здравствуйте, {name}! 👋\nДобро пожаловать в GIEC JOB.\n\nОтветьте на 8 коротких вопросов, чтобы мы подобрали вам работу — это займёт 1 минуту ⏱\n\n<i>Ваши данные используются только для предложений по работе.</i>",
    btnStart: "✅ Согласен(на), начать",
    name: "<b>1/8</b> · Напишите имя и фамилию латиницей, как в паспорте\n\nНапример: <code>ALIEV JASUR</code>",
    nameBad: "Напишите имя и фамилию латиницей. Например: ALIEV JASUR",
    age: "<b>2/8</b> · Сколько вам лет? Только цифры\n\nНапример: <code>21</code>",
    ageBad: "Только цифры. Например: 21",
    phone: "<b>3/8</b> · Отправьте ваш корейский номер телефона 📱\nНажмите кнопку ниже 👇",
    btnPhone: "📱 Отправить номер",
    btnNoPhone: "Корейского номера пока нет",
    phoneNotKr: "Это не корейский номер 🙂\nНапишите корейский номер (начинается с 010)\n\nНапример: <code>010-1234-5678</code>",
    phoneBad: "Номер должен начинаться с 010. Например: 010-1234-5678",
    school: "<b>4/8</b> · В каком университете вы учитесь?\n\nНапример: <code>Shinhan</code>",
    topik: "<b>5/8</b> · Ваш уровень TOPIK?",
    topikOpts: ["Нет", "1–2", "3", "4+"],
    ielts: "<b>6/8</b> · Есть IELTS?",
    ieltsOpts: ["Нет", "5.0 и ниже", "5.5", "6.0+"],
    car: "<b>7/8</b> · Есть машина?",
    carOpts: ["Есть", "Нет"],
    days: "<b>8/8</b> · В какие дни у вас занятия?\nОтметьте дни и нажмите <b>«Готово»</b>",
    daysAgain: "Начался новый семестр 📚\nОтметьте дни занятий заново и нажмите <b>«Готово»</b>",
    dayNames: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб"],
    btnDone: "✅ Готово",
    done: "Спасибо! ✅ Ваши данные приняты.\nМенеджер скоро свяжется с вами 🙌",
    daysUpdated: "Спасибо! Дни занятий обновлены ✅",
    already: "Вы уже оставили данные ✅\nМенеджер свяжется с вами.\n\nЕсли данные изменились, нажмите кнопку ниже 👇",
    btnUpdate: "✏️ Обновить данные",
    msgSent: "Ваше сообщение отправлено менеджеру ✅",
    pinPost: "",
    btnPin: "",
  },
};

export const langOf = (code) => (/^(ru|ky|kk|be|uk)/.test(code ?? "") ? "ru" : "uz");
export const tx = (lang, key) => TEXT[lang]?.[key] || TEXT.uz[key];

// 관리자 카드에 쓰는 한국어 값 (학생이 고른 버튼 번호 → 한국어)
export const KO = {
  topik: ["없음", "1–2급", "3급", "4급 이상"],
  ielts: ["없음", "5.0 이하", "5.5", "6.0 이상"],
  car: ["있음", "없음"],
  days: ["월", "화", "수", "목", "금", "토"],
};
