# Multi-Engine Driver Architecture & Cross-Platform Acceptance Specification

## 1. Overview & Goal
Multiagents supports multiple model execution engines (Codex, Claude, and Gemini/Antigravity) through a unified driver contract (`BaseAgentDriver` in `shared/agent-driver.ts`).
This document defines cross-platform acceptance gates, lifecycle behaviors, failure domains, and rollback mechanisms across Windows, macOS, and Linux.

---

## 2. Cross-Platform Portability Requirements

### A. Process Lifecycle & Spawning
1. **Direct Binary Execution**:
   - Do NOT execute via intermediary shells (`cmd.exe /c`, `powershell.exe`, or `/bin/sh -c`) when spawning child drivers.
   - Use `Bun.spawn` with array arguments to prevent shell escaping anomalies, command injection, and dangling child shell wrappers.
2. **Signal Handling & Termination**:
   - **Windows**: `SIGTERM` / `SIGINT` are not natively supported at the OS level; termination uses process-level termination. Child processes must handle stdin EOF gracefully as a primary teardown signal.
   - **macOS / Linux**: Drivers must handle standard POSIX termination (`SIGTERM`, `SIGHUP`) and flush pending stdio streams before exit.
   - **Resource Cleanup**: When `driver.kill()` is invoked or process exit is detected:
     - Clear all active timers (`requestTimeoutMs`, turn resolvers).
     - Reject in-flight pending requests with descriptive exit errors.
     - Release OS handles and close stdio pipe streams.

### B. Filesystem & Path Normalization
1. **Path Handling**:
   - Normalize file paths using `path.resolve` / `path.normalize` across working directories (`cwd`), project roots, and file locks.
   - Avoid hardcoding `/` or `\` in cross-engine payloads; use posix normalization for IPC contract ids and relative paths.
2. **Scripts & Tooling**:
   - Maintain script parity: `.bat` for Windows environments (`setup.bat`, `start.bat`, `update.bat`), `.sh` with POSIX compliance for Unix environments (`setup.sh`, `start.sh`, `update.sh`).
   - Use `pnpm` as the standardized package manager across all platforms.

---

## 3. Four-Phase Milestones & Acceptance Gates

### Phase 1: Shared Driver Contract & Backward Compatibility
- **Deliverables**:
  - `shared/agent-driver.ts` containing `BaseAgentDriver`, `AgentDriverKind`, `DriverTurnResult`, `DriverNotification`, `DriverUsage`, `DriverSessionOptions`.
  - `orchestrator/codex-driver.ts` implementing `BaseAgentDriver`.
- **Acceptance Gate**:
  - Typecheck passes with zero regressions.
  - Existing `CodexDriver` export signatures, types, and notification aliases preserved.
  - Zero disruption to current Codex CLI / app-server workflows.

### Phase 2: Claude Isolated Driver (`orchestrator/claude-driver.ts`)
- **Deliverables**:
  - Native stdio child management for `claude --input-format stream-json --output-format stream-json --verbose`.
  - Stream-JSON JSONL line buffer and frame parser.
  - Capability negotiation for mid-turn steering and interruption.
- **Acceptance Gate**:
  - Passes unit tests in `tests/claude-driver.test.ts`.
  - Stdio race condition prevented (pending resolver installed before writing prompt frame).
  - Proper error propagation on invalid JSONL or process crash.
  - Unsupported operations (`steer`, `interrupt`, `resume`) throw `UnsupportedDriverOperationError` when unnegotiated.

### Phase 3: Antigravity / Native Gemini Driver (`orchestrator/antigravity-driver.ts`)
- **Deliverables**:
  - Native JSON-RPC 2.0 stdio communication without Codex wrapper framing.
  - Response ID correlation (`pending` map with individual timeout timers).
  - Inbound streaming notifications (`method`, `params`) emitted without mangling.
  - Configurable line-size bounds (`maxLineBytes`) to guard against memory exhaustion.
- **Acceptance Gate**:
  - Passes unit tests in `tests/antigravity-driver.test.ts`.
  - Verification that no Codex-specific methods (`turn/start`, `expectedTurnId`) are dispatched.
  - Handling of unexpected response IDs, native RPC error payloads, and payload truncation.
  - Clean child process teardown on Windows without hanging handles.

### Phase 4: Orchestrator Integration & Dispatch
- **Deliverables**:
  - Driver factory in `orchestrator/launcher.ts` dispatching `BaseAgentDriver` based on `agent_type` (`codex` | `claude` | `gemini`).
  - Unified monitoring in `orchestrator/monitor.ts` attaching to `driver.onNotification` and `driver.onExit`.
  - Recovery and thread resumption in `orchestrator/recovery.ts` using `resumeThread` or falling back to clean handoff turn.
- **Acceptance Gate**:
  - End-to-end multi-agent session launch across mixed agent types.
  - Non-Codex engine failure isolates to slot error without crashing orchestrator.
  - Token usage correctly aggregated into slot statistics across all engine variants.

---

## 4. Failure Domains & Rollback Strategy

1. **Failure Domain Isolation**:
   - Stdio read errors or JSON parse errors in one driver instance must be localized to that driver's slot.
   - An unresponsive child driver process triggers `requestTimeoutMs` and transitions the slot into recovery rather than deadlocking the broker.
2. **Engine Incompatibility Fallback**:
   - Cross-engine thread resumption is explicitly disallowed: resuming a thread generated by Codex inside Claude or Gemini must trigger a fresh turn handoff (`startSession`) rather than corrupting state.
3. **Rollback Plan**:
   - Rollback of Phase 4: Revert dispatch logic in `launcher.ts`, `monitor.ts`, and `recovery.ts` back to direct `CodexDriver` instantiation.
   - Rollback of Phase 2/3: Remove `orchestrator/claude-driver.ts` and `orchestrator/antigravity-driver.ts`; contract definitions in `shared/agent-driver.ts` remain inert and safe.
