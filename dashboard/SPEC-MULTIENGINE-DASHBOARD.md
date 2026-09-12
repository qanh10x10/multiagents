# Multi-Engine Driver Dashboard - UI/UX Design Specification & Mockups

## 1. Muc tieu & Tong quan (Scope & Objectives)
Giam sat dong thoi cac worker su dung cac engine khac nhau:
- **Codex Engine**: Hien dai, ho tro JSON-RPC / IPC, live `mid-turn steer`.
- **Claude Engine**: Turn-based message queue, model Sonnet/Opus.
- **Antigravity / Gemini Engine**: Stream-based, provider quota tracking.

Tai lieu nay quy dinh:
1. He thong the Worker Card da engine (Engine badge, latency, token telemetry, connection status).
2. Quy chuan Visual Notification Log va su kien dac thu Mid-turn Steer.
3. Accessibility (WCAG 2.1 AA) & CSS token design system tuong thich dashboard hien co.

---

## 2. Design System Tokens & Color Palette
Ke thua va mo rong bo bien CSS tu `dashboard/index.html` va `dashboard/app.css`:

```css
:root {
  /* Engine Badges */
  --engine-codex-bg: rgba(88, 166, 255, 0.15);
  --engine-codex-border: #58a6ff;
  --engine-codex-text: #79c0ff;

  --engine-claude-bg: rgba(219, 109, 40, 0.15);
  --engine-claude-border: #db6d28;
  --engine-claude-text: #ffa657;

  --engine-antigravity-bg: rgba(57, 210, 192, 0.15);
  --engine-antigravity-border: #39d2c0;
  --engine-antigravity-text: #56d4c2;

  /* Latency indicators */
  --latency-fast: #3fb950;      /* < 150ms */
  --latency-medium: #d29922;    /* 150ms - 500ms */
  --latency-slow: #f85149;      /* > 500ms */

  /* Steer Event Visual */
  --steer-bg: rgba(188, 140, 255, 0.12);
  --steer-border: #bc8cff;
  --steer-glow: rgba(188, 140, 255, 0.35);
}
```

---

## 3. Worker Card Telemetry (Multi-Engine Card)

### 3.1 Cua so giao dien & Visual Hierarchy
Moi card worker trong luoi `.agents-grid` duoc bo tri 4 khu vuc ro rang:
1. **Header**: Worker Name, Engine Badge (kem icon steerable neu la Codex), Connection State Dot & Label.
2. **Telemetry Bar**: Latency (RTT ms), Turn state (Busy / Idle / Steering), Memory / Process PID.
3. **Usage & Quotas Meter**: Compact horizontal segmented meter (Input, Cache, Output) + 5h/weekly quota bar.
4. **Current Execution**: Active task, last observed step, quick action buttons (`View Feed`, `Inspect Telemetry`).

### 3.2 Mockup Worker Card (ASCII Representation)

```text
+-----------------------------------------------------------------------+
|  Coder Slot 1                         [CODEX ⚡ STEERABLE] [🟢 CONNECTED] |
|  Role: Software Engineer · PID 48212                                  |
+-----------------------------------------------------------------------+
|  ⚡ LATENCY: 38ms   |   TURNS: Turn #14 Active   |   HEARTBEAT: 2s ago  |
+-----------------------------------------------------------------------+
|  TOKENS USAGE:                                                        |
|  [|||||||||||||||||||||||..........] 24.5k / 128k (19%)               |
|  In: 18,240  ·  Cache Read: 12,050  ·  Out: 6,260                     |
|  Provider 5h Limit: 78% remaining [====================......]        |
+-----------------------------------------------------------------------+
|  Active Task: Implement multi-engine status cards                     |
|  Latest Step: Applied CSS tokens for telemetry pill                   |
|  Review: Awaiting reviewer                                            |
|  [ View Messages ]   [ Direct Steer Nudge ]                           |
+-----------------------------------------------------------------------+
```

### 3.3 HTML Structure De xuat
```html
<article class="agent-card agent-card--codex" data-slot-id="1">
  <header class="agent-top">
    <div class="agent-title-row">
      <h3 class="agent-name">Coder</h3>
      <span class="badge badge-engine badge-engine--codex" title="Codex Engine with real-time steer capability">
        <span class="engine-icon">⚡</span> Codex
      </span>
    </div>
    <div class="agent-conn-pill">
      <span class="conn-dot alive" aria-hidden="true"></span>
      <span class="conn-status-text">Connected</span>
    </div>
  </header>

  <div class="agent-telemetry-strip" aria-label="Engine telemetry">
    <div class="telemetry-item">
      <span class="telemetry-label">RTT</span>
      <span class="telemetry-val latency-fast">42ms</span>
    </div>
    <div class="telemetry-item">
      <span class="telemetry-label">Turn</span>
      <span class="telemetry-val turn-active">#14 Running</span>
    </div>
    <div class="telemetry-item">
      <span class="telemetry-label">Heartbeat</span>
      <span class="telemetry-val">2s ago</span>
    </div>
  </div>

  <section class="agent-usage-summary" aria-label="Token va han muc">
    <div class="usage-meter-header">
      <span>Tokens: 24,500</span>
      <span class="usage-cached-badge">Cache: 62%</span>
    </div>
    <div class="usage-bar-segmented" role="progressbar" aria-valuenow="19" aria-valuemin="0" aria-valuemax="100">
      <div class="bar-segment in" style="width: 45%" title="Input"></div>
      <div class="bar-segment cache" style="width: 35%" title="Cached Read"></div>
      <div class="bar-segment out" style="width: 20%" title="Output"></div>
    </div>
  </section>

  <footer class="agent-card-actions">
    <button type="button" class="btn-subtle" data-action="filter-messages">View messages</button>
    <button type="button" class="btn-subtle btn-steer" data-action="steer-modal" title="Mid-turn Steer (Codex only)">⚡ Steer</button>
  </footer>
</article>
```

---

## 4. Notification Log & Mid-Turn Steer Event Standard

### 4.1 Visual Hierarchy & Filter Toolbar
Bao gom 2 kenh xem:
1. **Live Timeline Stream**: Hoi thoai va tuong tac nghiep vu giua cac agent.
2. **Dedicated Notification & Event Feed**: Tab hoac sub-filter gom cac muc do:
   - `INFO`: He thong dang ky slot, chuyen turn, khoi tao session.
   - `STEER`: Su kien inject chi thi mid-turn vao worker.
   - `WARN`: Engine latency tang dot bien (>500ms), token quota con duoi 20%.
   - `ERROR`: Worker timeout, respawn, disconnect hoac fail steer call.

### 4.2 Quy chuan Hien thi Mid-Turn Steer Event
Su kien Mid-turn Steer can noi bat de nguoi van hanh phan biet voi hoi thoai chat thong thuong:
- **Badge**: `[⚡ MID-TURN STEER]` phong cach tim neon (`--purple: #bc8cff`).
- **Target Slot & Engine**: Hien thi ro worker nhan kem loai engine (Vi du: `Slot 1 (CodexDriver)`).
- **Steer Status**:
  - `Injected`: Gui thanh cong vao turn dang chay ma khong lam ngat luong agent.
  - `Turn Queued`: Turn hien tai vua ket thuc, steer duoc chuyen sang dau turn moi tiep theo.
  - `Rejected`: Turn loi hoac session da pause.

### 4.3 Mockup Su kien Mid-Turn Steer (Timeline Entry)

```text
+-----------------------------------------------------------------------+
|  ⚡ MID-TURN STEER  ·  Orchestrator -> Coder (Slot 1 · Codex)   14:22:05 |
|  Target Turn: #14  ·  Status: [⚡ Injected - Live Interruption]        |
+-----------------------------------------------------------------------+
|  > Injected Context:                                                  |
|  "STOP current refactor on auth.ts. Teammate reported lock conflict.   |
|   Immediately switch to reviewing dashboard/app.js."                  |
+-----------------------------------------------------------------------+
```

### 4.4 DOM Template cho Mid-turn Event
```html
<article class="timeline-entry timeline-entry--steer" data-event-type="steer">
  <header class="timeline-heading">
    <span class="badge badge-steer">⚡ MID-TURN STEER</span>
    <strong class="steer-route">Orchestrator &rarr; Coder (Slot 1 · Codex)</strong>
    <span class="steer-status-tag tag-success">Injected</span>
    <time datetime="2026-09-11T14:22:05">14:22:05</time>
  </header>
  <div class="timeline-body steer-body">
    <p class="steer-quote">
      "Luu y: Tam dung viec sua api.ts. Chuyen sang hoan thien giao dien multi-engine dashboard."
    </p>
    <div class="steer-meta">Target Turn: #14 &bull; Dispatch Latency: 12ms</div>
  </div>
</article>
```

---

## 5. Accessibility (WCAG 2.1 AA) & Compatibility Guidelines
1. **Color Independence**:
   - Khong dung mau sac lam chi bao duy nhat. Luon kem text/icon: `🟢 Connected`, `🔴 Disconnected`, `⚡ Steerable`.
2. **Keyboard Navigation & ARIA**:
   - The card va nut action co `tabindex="0"` va hien thi ro rang `:focus-visible` (outline 2px solid `--accent`).
   - Telemetry strip va progress bar co thuoc tinh `role="progressbar"`, `aria-valuenow`, `aria-label`.
   - Vung live event notification su dung `aria-live="polite"` va `role="log"`.
3. **Contrast Ratio**:
   - Tat ca text tren nen badge phai dat ti le tuong phan toi thieu 4.5:1 (WCAG AA).
4. **Performance & Lightweight (YAGNI)**:
   - Su dung CSS thuan, khong them external dependency hay nang render loop.
   - Tan dung WebSocket san co tu server de streaming latency va steer events.
