# GIEC JOB 봇 (@GIEC_JOB_bot)

채널 가입 요청 → 봇이 1:1 인사 + 자동 승인 → 버튼 8단계로 정보 받기 → 혜승에게 카드.

## 학생이 입력하는 것 (8단계)
1. 이름 (여권 영문) — 입력
2. 나이 — 숫자 입력
3. 연락처 — [📱 번호 보내기] 버튼. 한국 번호(+82)가 아니면 010 번호를 직접 입력, 없으면 [아직 없음]
4. 학교 — 입력
5. TOPIK — 버튼 (없음 / 1–2 / 3 / 4+)
6. IELTS — 버튼 (없음 / 5.0 이하 / 5.5 / 6.0+)
7. 자동차 — 버튼 (있음 / 없음)
8. 수업 요일 — 월~토 여러 개 선택 + [완료]

문구는 `src/text.js` (우즈벡어 기본, 앱이 러시아어·키르기스어면 러시아어).

## 관리자 (ADMIN_IDS, 기본 = 혜승 8512697683)
- 카드: [🟡 연락함] [🟢 소개함] [⚫ 종결] · [🔄 수업 요일 다시 받기]
- `/joinlink` 채널 환영 링크 (가입 요청 링크) · `/joinlink new` 새로 만들기
- `/pinpost` 채널에 [정보 남기기] 버튼 글 올리고 고정 (이미 채널에 있는 학생용)
- `/export` 지원자 전체 엑셀(CSV)
- `/start test` 학생 화면 직접 해보기
- 지원을 마친 학생이 봇에 메시지를 보내면 관리자에게 그대로 전달됨

## 처음 설정 (한 번만)
1. Vercel → Add New → Project → 이 저장소(giec-job-bot) 가져오기
2. Vercel → Storage → Redis 만들어서 이 프로젝트에 연결 (REDIS_URL 자동으로 들어감)
3. Settings → Environment Variables
   - `BOT_TOKEN` = BotFather 의 @GIEC_JOB_bot 토큰 (⚠️ 채팅·스크린샷에 올리지 않기)
   - `WEBHOOK_SECRET` = 아무 영어+숫자 20자 이상 (예: 직접 아무렇게나 입력)
   - `ADMIN_IDS` = 카드를 받을 사람 텔레그램 숫자 ID, 여러 명이면 쉼표로 (예: `8512697683,123456789`)
4. Deployments → Redeploy
5. 브라우저에서 `https://<프로젝트 주소>/api/setup?key=<WEBHOOK_SECRET>` 열기 → "완료!" 나오면 끝
6. 채널 → 관리자 추가 → @GIEC_JOB_bot (권한: 사용자 초대 · 메시지 게시 · 메시지 고정) → 혜승에게 "연결됐어요" 메시지가 옴
7. 혜승이 봇에 `/joinlink` → 받은 링크를 학생들에게 · `/pinpost` 로 기존 학생용 고정글

## 구조
- `api/webhook.js` 텔레그램 → 봇
- `api/setup.js` 웹훅·소개문·명령어 설정 (5번)
- `src/bot.js` 모든 흐름 · `src/text.js` 학생 문구 · `src/storage.js` Redis (키 앞에 `jobbot:`)
