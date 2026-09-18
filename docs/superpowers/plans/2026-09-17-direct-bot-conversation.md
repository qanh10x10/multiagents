# Direct Bot Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Làm hội thoại người ↔ worker như đồng nghiệp: inbox ai cần bạn, 1 composer 1 người hoặc cả nhóm, bubble operator thật. Bắt ý Buzz/OpenHands/Magentic + UX [AgentsRoom](https://agentsroom.dev/#try). Không clone stack.

**Architecture:** Giữ broker SQLite + MCP + dashboard HTML/WS + Chat participant. Không thêm React/Nostr/thread schema. Nâng composer, identity, inbox `categorizeSlots`, mention, HITL trên contract sẵn (`direct_agent`, `broadcast_to_team`, `/api/message/send`, `get_chat_observation`).

**Tech Stack:** Bun, `dashboard/index.html` + `dashboard/server.ts`, `extensions/multiagents-chat/*.cjs`, `orchestrator/chat-observation.ts`, `bun test`.

**Spec:** Mục Design dưới đây. Đối thủ chỉ là reference; không copy code.

## Global Constraints

- Bun only. Không Node/npm/Vite/React.
- Không dependency mới.
- Không commit/push/VSIX/publish.
- Panel Chat vẫn không giữ `toolInvocationToken` ngoài request; mutation panel = không.
- Không schema `parent_id` / thread giả từ adjacency.
- Giữ confirm + fresh revalidation cho Chat control.
- Operator identity: `from_id === "operator"`. Không lẫn Điều phối AI.
- Input validation ở trust boundary. Không log secret.

---

## Research (đối thủ)

Nguồn đọc 2026-09-17. Không clone.

| Project | Chat mạnh hơn ta ở đâu | Bỏ / không lấy |
| --- | --- | --- |
| [block/buzz](https://github.com/block/buzz) (~33k★) | Cùng phòng người+agent; @mention có identity; thread thật; evidence ≠ lời kể; human floor | Nostr, Rust, Tauri, React, voice huddle |
| [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands) Agent Canvas (~88k★) | Chat-first; stream; tool card trong lượt; ACP | Sandbox Docker, automation Slack, frontend riêng |
| [microsoft/magentic-ui](https://github.com/microsoft/magentic-ui) (~10k★) | Steer / approve / takeover giữa lượt | Browser-use VM, frontier/small-model stack |
| AutoGen Studio | Group chat nhìn được | Maintenance; GUI prototype |
| CrewAI | Human-in-the-loop trên task | Framework Python, không phòng chat |
| ruvnet/ruflo (claude-flow) | Web chat + MCP tools | Harness phình, không pattern ta cần |
| [AgentsRoom](https://agentsroom.dev/#try) (demo 2026-09-17) | Inbox “Needs input / To review”; “Message every agent”; unread trên 1 người; nói như teammate không như log hệ thống | Desktop IDE, Dynamic Island multi-project, terminal, Chat overlay tickets/forum (demo crash: `loadConversations` / `tickets` undefined) |

**Ta đã có:** MCP team, lock/plan/knowledge, `@multiagents` + slash confirm, dashboard room + composer `/api/message/send`, WS poll, 1-on-1 rail, operator collapse-broadcast, panel chỉ đọc. `window.AgentsRoom.categorizeSlots` trong `dashboard/app.js` (blocked/paused → needsInput, `done_pending_review` → toReview). Sidebar brand “AgentsRoom” = skin. List worker phẳng. Helper **không** gắn `#conversation-agents`.

**Gap thật (không mơ feature):**

1. Composer dashboard gửi được nhưng mention/recipient kém Buzz; không chip `@Engineer`.
2. Panel VS Code không gửi; nhảy Chat/`/direct`. Cảm giác “không nói trực tiếp”.
3. `/watch` 4s; panel không live nếu không watch. OpenHands stream mượt hơn.
4. Không presence “đang gõ / đang làm” trên timeline khi Codex mid-turn.
5. Chat `/direct` ≠ dashboard send: một bên confirm, một bên fire-and-forget. User lệch kỳ vọng.
6. HITL Magentic (approve/steer từ tin) chưa gắn vào bubble; steer Codex đã có driver, UX chưa lộ.
8. AgentsRoom “nói như người”: người mở inbox ai chờ mình, click 1 tên, gõ, gửi. Ta có composer + filter; sidebar không bucket; không unread; copy composer vẫn “nhiệm vụ / chỉ đạo”.

**Không làm:** thread schema, voice, Nostr, React rewrite, reply giả, mutation từ panel. Không clone AgentsRoom IDE / multi-project island / overlay Chat
**Không làm:** thread schema, voice, Nostr, React rewrite, reply giả, mutation từ panel.

---

## Design (phê duyệt trước khi code)

Ba lớp, một contract gửi tin.

```
Người
  ├─ Dashboard composer  → POST /api/message/send → broker (from_id=operator)
  ├─ @multiagents /direct → confirm Chat → direct_agent
  └─ Panel               → chỉ đọc; nút “Trả lời trong Chat” prefill slash
Worker ← broker message / Codex mid-turn steer
Timeline ← WS dashboard | observation Chat/panel
```
như người (dashboard)**

- Inbox sidebar từ `AgentsRoom.categorizeSlots(state.slots)`: **Cần bạn** (`needsInput`) / **Chờ duyệt** (`toReview`) / **Đang làm** / **Rảnh**. Click row = `selectAgentFilter(slot.id)` + focus `#prompt-input`. Không DM riêng, không thread.
- Nút **Nhắn mọi worker** = `messageAgent=""` rồi gửi broadcast (`to_slot_id: null`). API sẵn. Không endpoint mới.
- Unread local: đếm tin `from_slot_id` sau lần operator mở slot đó. `sessionStorage`. Không cột broker. Click slot xóa badge.
- Mention `@tên` từ slot list; Tab/Enter chọn 1 worker. Không match → không gửi nhầm.
- Chip đích: Tất cả | 1 worker. Rail / inbox click = chip. `@all` = broadcast.
- Bubble operator khác worker (đã có class `--operator`); badge Người / AI.
- Gửi xong: tin operator hiện ngay (optimistic chỉ sau HTTP 200 + id thật; không fake id).
- Status: gửi / đã giao / lỗi. Không replay sau lỗi.
- Placeholder composer: nói với người (“Nhắn Engineer… / Nhắn cả nhóm…”). Không “nhiệm vụ hoặc chỉ đạo”sau HTTP 200 + id thật; không fake id).
- Status: gửi / đã giao / lỗi. Không replay sau lỗi.

**P1 — Live + presence**

- Dashboard: worker `working` + heartbeat hiện “Đang làm…” trên rail và ghost row timeline. Không bịa nội dung.
- Chat `/watch`: giữ 4s; thêm hint “dashboard WS nhanh hơn”. Không websocket mới trong extension.
- Panel: nút “Trả lời @Name trong Chat” copy `/direct session | Name | ` vào clipboard + showInformationMessage. Không invoke tool.

**P2 — HITL sát tin**

- Dashboard: trên tin worker, nút “Nhắn lại” set chip + focus composer. Không pause/resume từ bubble.
- Chat: intent “bảo Engineer làm X” → `/direct` confirm như hiện tại.
- Codex steer: nếu slot busy + user gửi dashboard, server đã có mid-turn; UI badge “Injected” giữ. Thêm copy: tin lúc busy = steer, không phải chat nhàn.

**P3 — không làm kỳ này**

- AgentsRoom overlay Chat / forum / tickets / multi-project island / terminal IDE.
- Thread/reply-to.
- Composer trong panel.
- Đổi poll broker.
- Voice, reaction, search FTS.

---

## File map

| File | Việc |
| --- | --- |
| `dashboard/index.html` | Inbox bucket, unread, mention, chip, “Nhắn mọi worker”, operator bubble, presence ghost, Trả lời |
| `dashboard/app.js` | Chỉ reuse `categorizeSlots`; không helper mới nếu 1 hàm đủ |
| `dashboard/server.ts` | Validate send; trả message id; không schema mới |
| `dashboard/app.css` | Token inbox/mention/presence tối thiểu |
| `extensions/multiagents-chat/panel.cjs` + `panel.js` | Nút copy `/direct` |
| `extensions/multiagents-chat/README.md` | Cách nói chuyện trực tiếp |
| `docs/conversation-upgrade.md` | Ghi nhận gap/đối thủ, không copy Buzz |
| `tests/web-dashboard.test.ts` | Composer mention + send |
| `tests/conversation-chronology.test.ts` | Operator/presence không phá thứ tự |
| `tests/conversation-panel.test.ts` | Copy slash, không mutation |

Không đụng: `broker.ts` schema, launcher, credentials, Studio API, `create_team`.

---

## Task 1: Inbox teammate + mention + chip

**Files:** `dashboard/index.html`, `dashboard/app.js`, `tests/web-dashboard.test.ts`

- [ ] Test fail: slot `blocked` vào nhóm Cần bạn; `done_pending_review` vào Chờ duyệt; click set `messageAgent` + focus composer.
- [ ] Test fail: “Nhắn mọi worker” clear `messageAgent`; POST `to_slot_id` null.
- [ ] Test fail: tin worker mới trên slot chưa mở → badge unread; click slot xóa badge. `sessionStorage` only.
- [ ] Test fail: gõ `@Eng` hiện đúng 1 slot `Engineer`; chọn set `messageAgent`.
- [ ] Test fail: `@all` / chip Tất cả clear filter, send broadcast.
- [ ] Test fail: 0 hoặc 2 match → không auto-send.
- [ ] Render `#conversation-agents` bằng `window.AgentsRoom.categorizeSlots`. Stdlib DOM. Không lib. Không gọi helper nếu list rỗng.
- [ ] `bun test --timeout 15000 tests/web-dashboard.test.ts`
- [ ] Commit chỉ khi user yêu cầu.

## Task 2: Send receipt + operator identity

**Files:** `dashboard/index.html`, `dashboard/server.ts`

- [ ] Test fail: POST `/api/message/send` 200 có `id`; timeline dùng id server.
- [ ] Test fail: `from_id === "operator"` → class `--operator`, label Người, không icon model worker.
- [ ] HTTP lỗi: status error, không optimistic row.
- [ ] `bun test --timeout 15000 tests/web-dashboard.test.ts tests/conversation-chronology.test.ts`

## Task 3: Presence “Đang làm”

**Files:** `dashboard/index.html`, `tests/conversation-chronology.test.ts`

- [ ] Test fail: slot `task_state=working` + connected → 1 ghost row không `dataset.messageId` thật; biến mất khi idle.
- [ ] Ghost không chen ID timeline; `patchTimeline` bỏ qua node không id.
- [ ] `bun test --timeout 15000 tests/conversation-chronology.test.ts`

## Task 4: Panel “Trả lời trong Chat”

**Files:** `extensions/multiagents-chat/panel.cjs`, `panel.js`, `tests/conversation-panel.test.ts`

- [ ] Test fail: message `{type:"reply", name}` hợp lệ; copy `/direct {session} | {name} | `.
- [ ] Test fail: type lạ / mutation → ignore.
- [ ] `validMessage` thêm 1 shape; không gọi MCP.
- [ ] `bun test --timeout 15000 tests/conversation-panel.test.ts tests/chat-participant.test.ts`

## Task 5: Docs + regression hẹp

**Files:** `docs/conversation-upgrade.md`, `extensions/multiagents-chat/README.md`

- [ ] 1 mục: nói chuyện trực tiếp = dashboard composer hoặc `@multiagents /direct`. Panel chỉ đọc.
- [ ] Ghi đối thủ + việc cố ý không copy.
- [ ] `bun test --timeout 15000 tests/web-dashboard.test.ts tests/conversation-chronology.test.ts tests/conversation-panel.test.ts tests/chat-participant.test.ts tests/chat-watch.test.ts`
- [ ] Không `tsc` full; không bịa typecheck sạch.

---

## Acceptance

1. User thấy Cần bạn / Chờ duyệt; click 1 tên; gõ như nhắn đồng nghiệp; tin operator hiện với id thật.
2. “Nhắn mọi worker” = broadcast; collapse như hiện tại. Unread local, không schema.
3. Panel không gửi; copy slash + hướng dẫn Chat.
4. Ghost “Đang làm” không phá chronology test.
5. Không file/dependency/schema mới ngoài list trên.

## Validation

```powershell
bun test --timeout 15000 tests/web-dashboard.test.ts tests/conversation-chronology.test.ts tests/conversation-panel.test.ts tests/chat-participant.test.ts tests/chat-watch.test.ts
```

Fixture browser chỉ khi user xin: `bun tests/conversation-fixture.ts`.

## Remaining risks

- Confirm Chat ≠ dashboard fire-and-forget: cố ý. Docs phải nói.
- Race send vs poll: id server tránh duplicate; vẫn có cửa sổ 1 tick.
- Presence từ `task_state`, không typing thật.
- Unread mất khi xóa `sessionStorage` / đổi máy. Đủ kỳ này.
- Demo AgentsRoom Chat overlay hỏng; ta không bắt chước overlay.
- Extension host smoke / VSIX: ngoài phạm vi.
