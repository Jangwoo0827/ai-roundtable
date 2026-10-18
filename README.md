# AI Roundtable

Gemini · ChatGPT · Claude가 서로의 답변을 읽고 비평·재검토하며 토론하는 로컬 웹앱입니다.
**공식 AI API를 쓰지 않습니다.** API 키를 요구하거나 저장하지 않고, 사용자가 직접 로그인한 공식 웹 채팅 탭을 이용합니다.

```
웹사이트(Vite, localhost:5173) ⇄ 로컬 브리지(Node, 127.0.0.1:8787) ⇄ Chrome 확장 프로그램(MV3) ⇄ gemini.google.com / chatgpt.com / claude.ai 탭
```

- **수동 모드**: 브리지·확장 없이 웹사이트만으로 동작. 프롬프트 복사 → 공식 사이트에 붙여넣기 → 답변 붙여넣기.
- **자동 모드**: 확장 프로그램이 로그인된 탭에 프롬프트를 입력·전송하고, 생성 완료를 감지해 답변을 수집합니다.

## 실행

```bash
npm install
npm run dev        # 웹사이트 http://localhost:5173
npm run bridge     # 자동 모드에만 필요. 콘솔에 연결 토큰이 표시됨
npm test           # 엔진·스케줄러·브리지 큐 단위 테스트 (더미 데이터)
```

## 확장 프로그램 설치

1. Chrome에서 `chrome://extensions` → 오른쪽 위 **개발자 모드** 켜기
2. **압축해제된 확장 프로그램을 로드합니다** → 이 프로젝트의 `extension/` 폴더 선택
3. 툴바의 AI Roundtable 아이콘 → `npm run bridge` 콘솔의 **토큰**(32자리)을 붙여넣고 **저장 후 연결**
   - 토큰은 `bridge/.bridge-token`에 저장되어 재시작해도 유지됩니다. 새로 만들려면 `node bridge/server.js --rotate`
   - (권장) 확장 ID를 고정하려면 `ALLOWED_EXTENSION_IDS=<확장ID> npm run bridge`

## 세 AI 로그인·연결

1. 확장 팝업의 **Gemini/ChatGPT/Claude 열기** 버튼(또는 직접)으로 각 사이트를 열고 **직접 로그인**합니다.
2. 웹사이트에서 진행 방식을 **자동 (확장 프로그램)** 으로 바꾸면 상단에 `브리지 + 확장 프로그램 연결됨`이 표시되고, 참가자 카드마다 사이트 상태(준비됨/로그인 필요/사람 확인 필요 등)가 보입니다.
3. 탭이 없으면 작업 시 공식 주소로 자동으로 엽니다. 토론 1라운드에서는 각 사이트에서 새 대화를 시작합니다.

## 토론 진행

1. 독립 의견(서로 비공개, 동시 전송) → 2. 상호 비평(다른 참가자 답변을 이름과 함께 전달) → 3~N. 재검토 및 반론 → 최종 종합(사회자 1명)
- 모든 응답이 도착해야 다음 라운드로 넘어갑니다. 실패하면 `조치 필요` 상태가 되며 **실패한 참가자만 재시도**, **제외**, 또는 **수동으로 붙여넣기**를 고를 수 있습니다.
- 일시 정지/재개/종료, 진행 중 수동↔자동 전환, 새로고침 후 복구(끊긴 자동 요청은 재개 시 다시 보냄)
- 기록은 브라우저 localStorage에만 저장되며 JSON/Markdown으로 내보내고 JSON으로 다시 가져올 수 있습니다.

## 구조

```
src/debate/      engine.js(단일 상태 엔진) scheduler.js prompts.js transcript.js participants.js
src/providers/   provider-interface.js manual-provider.js bridge-provider.js
src/components/  participant-card.js message-card.js debate-panel.js round-controls.js dom.js
src/storage/     local-store.js
bridge/          server.js protocol.js queue.js
extension/       manifest.json background.js popup.* content/{common,runner}.js adapters/{gemini,chatgpt,claude}.js
tests/           *.test.js, fake-extension.js(가짜 확장), mock-chat.html(모의 채팅 DOM)
```

어댑터 공통 인터페이스: `checkConnection()`, `sendMessage(prompt)`, `waitForResponse()`, `readLatestResponse()`, `cancelResponse()`.
안정적으로 할 수 없는 동작은 성공으로 꾸미지 않고 오류 코드(`NOT_LOGGED_IN`, `BLOCKED`, `RATE_LIMITED`, `INPUT_NOT_FOUND`, `SEND_FAILED`, `TIMEOUT`, `NOT_SUPPORTED` 등)를 돌려줍니다.

## 보안

- 브리지는 `127.0.0.1`에만 바인딩, 허용된 Origin(`localhost:5173` 등, `chrome-extension://`)만 접속, 첫 메시지에 토큰 필요
- 메시지 크기 256KB 제한, 모든 메시지 형식 검증, 참가자 ID는 3개 사이트로 고정. 임의 URL 열기 기능 없음
- 확장은 쿠키·인증 토큰을 읽거나 전송하지 않으며, 열 수 있는 주소는 세 공식 사이트 홈뿐
- CAPTCHA·사용량 제한이 보이면 우회하지 않고 중단 후 안내
- AI 응답은 HTML로 해석하지 않고 텍스트로만 표시

## 검증 상태 (정직한 현황)

| 항목 | 상태 |
|---|---|
| 웹 UI, 수동 모드 4단계 전체 진행, 새로고침 복구 | 실제 브라우저에서 확인 |
| 엔진(동시 전송·대기·타임아웃·재시도·제외·중복 방지·일시정지·취소·복구) | 단위 테스트 25개 통과 (더미) |
| 웹 ⇄ 브리지 ⇄ 확장 프로토콜 | `tests/fake-extension.js`(가짜 확장)로 전체 토론 + 실패 재시도 + 중복 결과 무시 확인 |
| 어댑터 입력·전송·스트리밍 완료 감지 로직 | `tests/mock-chat.html` 모의 DOM에서 확인 |
| 실제 Gemini 어댑터 (입력·전송·완료 감지·답변 수집) | 2026-10-18 로그인된 Chrome(한국어 UI)에서 어댑터 코드를 직접 주입해 확인 |
| 실제 Claude 어댑터 | 같은 방식으로 확인 (전송 `메시지 보내기`, 중지 `응답 중지` 감지) |
| 실제 ChatGPT 어댑터 | **미검증** — 로그인 안 된 상태에서 `로그인 필요` 감지만 확인 |
| 확장 프로그램 설치 상태의 전체 자동 토론(background·탭 관리·브리지 경유) | **미검증** — 압축해제 확장 로드는 사용자가 직접 해야 함 |

## 알려진 제한

- 세 사이트의 DOM은 예고 없이 바뀝니다. 선택자는 `extension/adapters/*.js`에 사이트별로 모여 있으며, 깨지면 그 파일만 고치면 됩니다. 수동 모드는 항상 대체 수단으로 쓸 수 있습니다.
- 각 사이트의 이용 약관·자동화 정책을 확인하고 본인 계정에서 적정한 빈도로 사용하세요. 사용량 한도에 걸리면 토론이 `조치 필요`로 멈춥니다.
- 사이트별 탭은 하나만 사용하며 같은 사이트 작업은 순서대로 처리됩니다. 백그라운드 탭은 브라우저가 타이머를 늦출 수 있어 완료 감지가 느려질 수 있습니다.
- `cancelResponse()`는 중지 버튼이 보일 때만 동작합니다.

## 실제 사이트 테스트 방법

1. `npm run dev`, `npm run bridge`, 확장 설치·토큰 입력, 세 사이트 로그인
2. 확장 팝업에서 세 사이트가 `준비됨`인지 확인
3. 웹사이트에서 자동 모드, 참가자 1명(예: Gemini)만 + 다른 1명은 수동으로 2라운드 토론을 시작해 한 사이트씩 확인
4. 실패 시 해당 탭의 개발자 도구 콘솔에서 `__RT.adapters.gemini._debug()`로 입력창/버튼/응답 감지 여부를 확인
