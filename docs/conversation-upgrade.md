# Conversation upgrade: bàn giao để review

Ngày kiểm chứng: 2026-09-09. Chưa phê duyệt phát hành; chưa tạo/cài VSIX, commit,
push, publish hoặc cập nhật runtime đang chạy. Manifest extension vẫn 0.1.2.

## Phạm vi và ownership

Đọc AGENTS.md, CLAUDE.md, ECC workflow, code/callers/tests và dirty baseline trước
khi sửa. Bàn giao dashboard/prompt được orchestrator xác nhận rõ qua peer: Research
Manager xác nhận không còn sửa dở/khóa, mốc 2026-09-09T06:20:44.399Z; Workflow
Researcher xác nhận không ghi/khóa. Worker UI cũ không được tiếp tục. Chỉ một worker
triển khai, không spawn/delegate. Main không sửa đồng thời các file triển khai.

Kế hoạch thực hiện: kiểm tra ownership/contracts và baseline tests; nối điều phối
model đang chọn vào executor native Chat; thêm panel chỉ đọc; nâng cấp conversation
dashboard và prompt hiện có; regression/fixture browser; tự review và gửi main.

Các file đã sửa/thêm trong công việc này (không quy mọi dirty file về thay đổi này):

- `adapters/role-practices.ts`
- `orchestrator/chat-observation.ts`
- `dashboard/index.html`
- `extensions/multiagents-chat/extension.cjs`
- `extensions/multiagents-chat/core.cjs`
- `extensions/multiagents-chat/coordinator.cjs`
- `extensions/multiagents-chat/panel.cjs`
- `extensions/multiagents-chat/panel.js`
- `extensions/multiagents-chat/panel.css`
- `extensions/multiagents-chat/package.json`
- `extensions/multiagents-chat/README.md`
- `tests/chat-participant.test.ts`
- `tests/chat-watch.test.ts`
- `tests/conversation-coordinator.test.ts`
- `tests/conversation-panel.test.ts`
- `tests/conversation-chronology.test.ts`
- `tests/conversation-runtime.test.ts`
- `tests/conversation-fixture.ts`
- `tests/team-studio-ui.test.ts`
- `tests/agent-usage-ui.test.ts`
- `docs/conversation-upgrade.md`

Giữ baseline Studio, telemetry và selected-provider runtime. Không sửa broker,
monitor, launcher, credential/provider settings, Studio API hay package manager.
Không thêm dependency/framework.

## Hành vi

`@multiagents` dùng `request.model` trong yêu cầu Chat thật, lịch sử cùng
participant/MCP và ba tool nội bộ allowlist. Model chọn phiên khi rõ, hỏi khi mơ
hồ; slash command vẫn xác định và không gọi model. Giao tiếp tiếng Việt có dấu,
AI identity rõ, tổng hợp điều phối tách với báo cáo worker thật. Công cụ/model
mock kiểm tra việc chuyển nguyên yêu cầu có dấu/không dấu/lỗi gõ; không chứng minh
chất lượng hiểu ngôn ngữ của một model thật cụ thể.

Mỗi control phải có đoạn trích nguyên văn yêu cầu hiện tại, đúng action/session/
worker vừa quan sát, rồi đi qua xác nhận và fresh revalidation của native Chat.
Owner family, workspace trust và `toolInvocationToken` giữ nguyên. Không replay
side effect sau lỗi/từ chối; có báo khả năng thực hiện một phần. Model được giới
hạn vòng/công cụ/thời gian/input/history/output, dùng cancellation. Prompt/tool
results là dữ liệu không đáng tin; nội dung báo cáo không cấp quyền thao tác.

Panel dùng supported `createWebviewPanel`, command contribution, local resources,
CSP nonce và message validation. Không gọi model/MCP/network, không có controls
thay đổi worker. Chỉ nhận observation từ Chat thật, giữ 12 phiên trong RAM, cửa
sổ 50 bản ghi. Route đến xác nhận là nút hướng dẫn và `@multiagents` trong Chat;
không dùng token request cũ bên ngoài Chat. System/control chỉ chiếu metadata,
không đưa prompt/private context vào timeline. Nội dung dùng textContent/plain
Markdown không tin cậy; không có thread/reply giả.

Đóng webview panel không xóa cache snapshot; cache chỉ được xóa khi extension
disposal chạy (`context.subscriptions`). Giới hạn 12 phiên trong RAM không phải
bảo đảm không còn rủi ro riêng tư; dữ liệu có thể còn trong bộ nhớ sau khi đóng panel.

Dashboard giữ Studio và sáu vùng theo dõi, mở conversation mặc định. Có session
rail/selector, bộ lọc, chat chính, system events riêng, agent/task/token/quota
compact. Timeline dùng ID thật, tối đa 200 bản ghi; giữ node/vị trí đọc/details,
báo có tin mới khi đang đọc cũ. Không dựng lại toàn bộ history mỗi polling tick.
Có empty/offline/error, focus bàn phím và responsive 390px. Ghi chú token/quota
được Việt hóa; raw status/code và nội dung do agent cung cấp vẫn giữ nguồn thật.

Input, cached input, output vẫn là counters đã quan sát, cached nằm trong input;
không cộng lại. Zero quan sát khác chưa báo cáo. Cửa sổ quota xác định bằng
300/10080 phút, giữ stale/reset/unknown và khả năng dùng chung tài khoản. Token
của model điều phối thuộc VS Code, không tự cộng vào telemetry của worker; không
có dữ liệu billing/quota riêng cho điều phối từ API hiện tại.

Guidance giao tiếp thêm vào hai helper role practices hiện có, đi qua role context
của adapter với các vai trò được matcher nhận diện. Không sửa cadence lifecycle,
completion gates, ECC opt-in hay environment isolation. Worker đang chạy không
được khởi động lại để nhận prompt mới.

## Nguồn tham khảo

- [Buzz README](https://github.com/block/buzz): con người và AI trong cùng phòng,
  identity/nguồn bản ghi rõ, tách evidence với lời kể. Đã đọc qua trình duyệt;
  không sao chép code hay chuyển sang Nostr/Rust/React của Buzz.
- [VS Code Chat Participant API](https://code.visualstudio.com/api/extension-guides/ai/chat):
  `request.model`, Chat request context và participant.
- [VS Code Language Model API](https://code.visualstudio.com/api/extension-guides/ai/language-model)
  và [Webview API](https://code.visualstudio.com/api/extension-guides/webview):
  API contract cần dùng khi review host integration.

## Lệnh và kết quả

Chạy tại `C:\Users\PC\Desktop\OutSources\Git\multiagents`, Bun 1.4.2.

Baseline trước sửa:

```powershell
bun test --timeout 15000 tests/chat-participant.test.ts tests/chat-watch.test.ts tests/web-dashboard.test.ts tests/team-studio-ui.test.ts tests/agent-usage-ui.test.ts
```

Exit 0: 40 pass, 0 fail.

Regression cuối:

```powershell
bun test --timeout 15000 tests/chat-participant.test.ts tests/chat-watch.test.ts tests/conversation-coordinator.test.ts tests/conversation-panel.test.ts tests/conversation-runtime.test.ts tests/team-studio-ui.test.ts tests/agent-usage-ui.test.ts tests/ecc.test.ts tests/ecc-runtime.test.ts tests/web-dashboard.test.ts tests/agent-usage.test.ts tests/model-selection-runtime.test.ts tests/selected-codex-native.test.ts
```

Exit 0: **135 pass, 1 skip, 0 fail**, 136 tests trong 13 file. Skip là native config
opt-in `native selected config excludes synthetic global/project auth and transports`:
không cấu hình `MULTIAGENTS_TEST_CODEX_EXECUTABLE`. Các test selected-runtime còn lại
dùng subprocess giả lập, không chạy provider thật.

```powershell
bun node_modules/typescript/bin/tsc --noEmit
git diff --check
```

Lượt typecheck đã ghi nhận exit 2 với 53 diagnostics: base-adapter
(1), broker (1), dashboard/server (2), orchestrator-server (2), provider-credentials
test (1), provider-settings test (21), studio-api test (8), team-library test (9),
team-studio-ui test (2), team-template-tools test (6). Nguồn gốc lịch sử của toàn bộ
53 diagnostics là **CHƯA XÁC MINH (UNVERIFIED)**: log trước thay đổi chỉ hiển thị
một phần (25 diagnostics), không đủ chứng minh tất cả đã tồn tại từ trước.
Không tuyên bố full typecheck đạt và không sửa các lỗi ngoài phạm vi được giao.
Không có diagnostics ở coordinator/observation/role-practices hoặc tests mới.
CJS không được typecheck bằng VS Code declarations; covered bằng mock/runtime
tests và parse test, chưa thay cho smoke test extension host thật.

`git diff --check` exit 0, chỉ có thông báo cấu hình LF/CRLF của Git. Đã rà cả file
mới chưa tracked, vì diff mặc định không hiển thị chúng.

Log tạm: `%TEMP%/conversation-regression-final.log`,
`%TEMP%/conversation-typecheck-final.log`. Những lượt test trung gian phát hiện
encoding, mock export và lỗi thay tên biến lúc Việt hóa đã được sửa trước lượt
cuối; không dùng kết quả trung gian làm bằng chứng đạt.

## Fixture trình duyệt

```powershell
bun tests/conversation-fixture.ts
agent-browser --session conversation-qa open http://127.0.0.1:<port>
agent-browser --session conversation-qa set viewport 1440 1000
agent-browser --session conversation-qa set viewport 390 844
agent-browser --session conversation-qa a11y --selector .conversation-room --json
agent-browser --session conversation-qa open http://127.0.0.1:<port>/panel
agent-browser --session conversation-qa a11y --json
```

Fixture bind loopback port tự cấp, tự dừng sau 15 phút, không broker/provider/
credentials. Mọi bản ghi gắn `[Fixture]`; không phải dialogue người dùng/worker
thật. Đã kiểm tra tại các port 64278, 65076 và lượt cuối 49763. Một lượt cuối vào
65076 gặp connection refused vì fixture hết hạn; đã chạy fixture mới và kiểm tra
lại, không tính ảnh trang lỗi làm bằng chứng.

Browser CLI checks thành công exit 0: không tràn ngang desktop/mobile; cùng node
tin nhắn, details vẫn mở và scroll 0→0 khi tin mới tới; nút tin mới hoạt động;
payload HTML hiển thị như text, không chạy XSS; system không lẫn trong chat; đổi
phiên xóa dữ liệu cũ; empty/offline/error đúng; selector có focus trap, Escape trả
focus; panel có empty state, không network/control, giữ scroll khi history mới
thay cửa sổ cũ. Lượt cuối xác minh cả nhãn quota tiếng Việt và lỗi đổi phiên từ rail
hiển thị tại `conversation-error` mà không đổi phiên hiện tại.

Axe vùng conversation dashboard và panel desktop/mobile: **0 violations**.
Contrast vẫn có incomplete do gradient và nội dung bị clip trong vùng scroll;
không tuyên bố toàn bộ accessibility đã được chứng nhận. Tỷ lệ tính từ màu fixture:
dim text/panel 7.96:1, text/gradient start 10.63:1, text/surface 14.64:1. Theme thật
của VS Code còn phụ thuộc cấu hình host.

Ảnh cuối tại `%TEMP%/conversation-final-desktop.png`,
`%TEMP%/conversation-final-mobile.png`, panel tại `%TEMP%/conversation-panel.png`.
Đây là fixture artifacts, không ảnh runtime đã cài.

## Giới hạn và kiểm tra bỏ qua

- Chưa gọi model/provider thật; tests chứng minh guard/data flow, không chứng minh
  model cụ thể luôn hiểu đúng câu mơ hồ hay chống mọi prompt injection.
- Chưa chạy smoke test extension host thật, đóng gói/cài VSIX, refresh MCP hoặc
  worker. Không có build/lint script trong package.json, không tự tạo bước này.
- Không chạy toàn bộ suite/Studio API vì nằm ngoài phạm vi kiểm chứng được giao;
  chỉ chạy các regression liên quan ở trên, không sửa Studio API không liên quan.
- Session listing model parse contract hiện có của `list_sessions`. Host/tool
  version không hỗ trợ cần báo lỗi hoặc dùng slash fallback, không tạo server mới.
- Confirm + fresh read không nguyên tử với mutation trên server; có cửa sổ race
  sau lần đọc cuối. Thao tác nhiều bước có thể một phần, không rollback/replay.
- Panel là snapshot tại thời điểm ghi, không tự live khi không có `/watch`;
  giới hạn history 50/200 có thể bỏ lỡ burst, không suy ra thread từ adjacency.

Main/orchestrator cần review diff và kiểm tra host đã được cho phép trước khi
quyết định phát hành. `signal_done` chỉ bàn giao implementation và bằng chứng.

## Bổ sung sau self-review cuối

Header dashboard trước đây ghi `completed` từ approved/released + mất kết nối.
Đã đổi thành ghi nhận phê duyệt/giải phóng, **chưa xác minh bàn giao**; đồng thời
xóa thời lượng cũ khi phiên mới không có timestamp. Browser fixture đã kiểm tra
đúng trigger này. Regression sau thay đổi cuối:

```powershell
bun test --timeout 15000 tests/conversation-panel.test.ts tests/agent-usage-ui.test.ts tests/team-studio-ui.test.ts tests/web-dashboard.test.ts
```

Exit 0: **31 pass, 0 fail**, 4 file (có thêm test hành vi header). Kết quả 135 pass
của lượt 13 file phía trên có trước bổ sung này; không gộp hai lượt thành một
lượt kiểm thử chưa chạy. Log: `%TEMP%/conversation-last-mile.log`.

## Sửa findings Manager: chronology và độ chính xác bằng chứng

Manager tái hiện lỗi lọc `[Fixture 4]` hoặc `[Fixture 10]` rồi xóa bộ lọc:
row giữ lại đứng đầu, làm timeline sai thứ tự. `patchTimeline` nay dùng map theo
ID và chèn/di chuyển row đến đúng vị trí trước khi bỏ qua nội dung không đổi.
Không dựng lại row/details giữ lại; cập nhật giống nhau không di chuyển node.
Giữ cơ chế ngừng theo tin mới và khôi phục scroll hiện có.

Phạm vi lượt sửa này chỉ gồm `dashboard/index.html`,
`tests/conversation-chronology.test.ts`, và tài liệu này. Đã mở lại các bước
triển khai, kiểm chứng, bàn giao của kế hoạch; chưa có phê duyệt review lại.
Nhận định nguồn gốc lịch sử typecheck được sửa thành UNVERIFIED; vòng đời cache
panel được mô tả đúng là giữ qua đóng panel, xóa khi extension disposal.

Gate trước sửa: lệnh 4 file trong phần bổ sung phía trên, exit 0, 31 pass/0 fail.
Gate sau sửa:

```powershell
bun test --timeout 15000 tests/conversation-chronology.test.ts tests/conversation-panel.test.ts tests/agent-usage-ui.test.ts tests/team-studio-ui.test.ts tests/web-dashboard.test.ts
```

Exit 0: **36 pass, 0 fail, 268 expect**, 5 file, không skip. Năm regression mới
thực thi renderer lấy từ HTML: filter shrink/expand ID 4 và 10, node/details còn
nguyên và mở, cập nhật giống nhau không ghi DOM, sửa thứ tự row đã có, giữ offset
đọc và hoãn hiển thị history mới. DOM giả không mô phỏng layout/clamping của browser.

Fixture browser riêng tại `http://127.0.0.1:55343`, không broker/provider thật:

```powershell
bun tests/conversation-fixture.ts
agent-browser --session conversation-chronology open http://127.0.0.1:55343
agent-browser --session conversation-chronology set viewport 1440 1000
# eval --stdin: filter 4/10 -> clear; so sánh IDs, node/details, MutationObserver và scroll
agent-browser --session conversation-chronology set viewport 390 844
# Lặp lại cùng assertions qua eval --stdin
```

Cả hai lượt browser assertions exit 0: 44 row đúng thứ tự sau mỗi lần mở rộng,
retained node ID 4/10; details ID 4 giữ identity/trạng thái mở (ID 10 fixture thật
không có details). Cập nhật giống nhau có 0 DOM mutations; offset đọc 230→230;
không tràn ngang. Desktop filter expand giữ 0→0; mobile ID 4 giữ 230→230 và
ID 10 giữ 0→0. Bộ test Bun riêng dùng nội dung dài ở cả ID 4 và 10.

Không chạy lại full typecheck hoặc suite ngoài phạm vi trong lượt này; kết quả
53 diagnostics/exit 2 là lượt đã ghi nhận phía trên, không phải bằng chứng lịch sử
baseline. Chưa smoke test extension host/model thật; chưa đóng gói/cài VSIX hoặc
refresh runtime. Bàn giao để Manager review lại, không tự tuyên bố approved.
