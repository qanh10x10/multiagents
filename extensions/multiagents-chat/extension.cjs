"use strict";
const vscode = require("vscode");
const { coordinate } = require("./coordinator.cjs");
const { createConversationPanel } = require("./panel.cjs");
const { OBSERVATION, ACTIONS, parseRequest, toolFamily, exactAgent, decodeObservation, safeText, statusText, watch, chatContext, followups, sessionChoices, resumeRoster, stateKey } = require("./core.cjs");

function activate(context) {
  const panel = createConversationPanel(vscode, context);
  let selectedTool;
  let mutationBusy = false;
  const watchers = new Set();
  context.subscriptions.push({ dispose() { for (const watcher of watchers) watcher.cancel(); } });

  const handle = async (request, _history, stream, token, execution) => {
    let metadata;
    let sentControl = false;
    const emit = text => {
      if (token.isCancellationRequested) return;
      const markdown = new vscode.MarkdownString();
      markdown.isTrusted = false;
      markdown.supportHtml = false;
      markdown.appendText(safeText(text));
      // appendText escapes spaces as non-breaking entities; restore normal wrapping in narrow chat panels.
      markdown.value = markdown.value.replace(/&nbsp;/g, " ");
      stream.markdown(markdown);
      stream.markdown("\n\n");
    };
    try {
      if (token.isCancellationRequested) return;
      if (!vscode.workspace.isTrusted) throw new Error("Cần tin cậy workspace trước khi điều khiển worker.");
      const conversational = !request.command;
      let command = request.command;
      const tools = vscode.lm.tools;
      const candidates = tools.filter(tool => tool.name.endsWith(OBSERVATION));
      if (!candidates.length) throw new Error("Không tìm thấy công cụ quan sát MCP. Kiểm tra MCP sở hữu nhóm và công cụ đã bật. Extension không tự tạo server thay thế.");
      if (!candidates.some(tool => tool.name === selectedTool)) {
        // Always select explicitly: names from other extensions are not proof of server identity.
        const chosen = await vscode.window.showQuickPick(candidates.map(tool => ({ label: tool.name, description: tool.description })), {
          title: "Chọn MCP đáng tin cậy đang sở hữu nhóm worker", ignoreFocusOut: true,
        }, token);
        if (!chosen) return;
        selectedTool = chosen.label;
      }
      const ownerTool = selectedTool;
      if (execution && execution.owner !== ownerTool) throw new Error("MCP sở hữu nhóm đã đổi; chưa gửi thao tác.");
      const find = toolFamily(tools, ownerTool);
      const invoke = async (name, args, cancellation = token) => {
        if (cancellation.isCancellationRequested) throw new Error("Đã hủy trước khi gửi yêu cầu.");
        if (!vscode.workspace.isTrusted) throw new Error("Cần tin cậy workspace trước khi gửi yêu cầu.");
        const tool = find(name);
        if (execution && ![OBSERVATION, "list_sessions"].includes(name)) execution.sent++;
        const result = await vscode.lm.invokeTool(tool.name, { input: args, toolInvocationToken: request.toolInvocationToken }, cancellation);
        const text = result.content.filter(part => part instanceof vscode.LanguageModelTextPart).map(part => part.value).join("\n");
        if (text.length > 500000) throw new Error("Kết quả MCP vượt giới hạn; không tự gửi lại yêu cầu.");
        return name === OBSERVATION ? text : safeText(text).slice(0, 64000);
      };
      const previous = chatContext(_history.history, ownerTool);
      if (conversational) {
        metadata = await coordinate({ vscode, request, history: _history.history, owner: ownerTool, previous, invoke,
          token, emit, publish: snapshot => panel.publish(ownerTool, snapshot),
          runControl: async (input, cancellation) => {
            const record = { sent: 0, error: null, owner: ownerTool };
            emit(`Đề nghị từ điều phối AI: /${input.action} · ${input.session} · ${input.target}`);
            await handle({ ...request, command: input.action, prompt: `${input.session} | ${input.target}${input.message ? ` | ${input.message}` : ""}` },
              _history, stream, cancellation, record);
            return { ...record, meaning: "Số yêu cầu đã gửi, không chứng minh thực hiện hay hoàn thành. sent=0 nghĩa là chưa gửi hoặc đã từ chối." };
          } });
        if (!token.isCancellationRequested) stream.button?.({ command: "multiagents.openConversation", title: "Mở phòng hội thoại" });
        return { metadata };
      }
      const parts = (conversational ? "" : request.prompt || "").split("|");
      const first = parts.shift().trim();
      const explicitSession = /^[a-zA-Z0-9_-]{1,150}$/.test(first) ? first : undefined;
      let session = command === "session" ? undefined : explicitSession || previous.session;
      if (!session) {
        const listing = await invoke("list_sessions", { status_filter: "all" });
        const choices = sessionChoices(listing);
        if (choices.length) {
          session = (await vscode.window.showQuickPick(choices, { title: "Multiagents - chọn phiên", ignoreFocusOut: true }, token))?.label;
        } else {
          emit(`Chọn ID phiên chính xác từ MCP đã chọn (hoặc hủy nếu chưa có phiên):\n${listing}`);
          session = await vscode.window.showInputBox({ title: "Multiagents - phiên", prompt: "Nhập ID phiên chính xác từ danh sách trong Chat", ignoreFocusOut: true,
            validateInput: value => /^[a-zA-Z0-9_-]{1,150}$/.test(value) ? undefined : "Nhập ID phiên, không nhập chỉ dẫn." }, token);
        }
        if (!session || token.isCancellationRequested) return;
      }
      if (command === "session") command = "status";
      const input = { command, session, target: parts.shift()?.trim(), message: parts.join("|").trim() };
      if (command === "status" || command === "watch") parseRequest(command, `${session}${request.prompt?.includes("|") ? "|" : ""}`);
      const fetchSnapshot = async cancellation => {
        const snapshot = decodeObservation(await invoke(OBSERVATION, { session_id: input.session }, cancellation), input.session);
        metadata = { session, tool: ownerTool };
        if (!token.isCancellationRequested) panel.publish(ownerTool, snapshot);
        return snapshot;
      };
      if (input.command === "watch") {
        const watcher = new vscode.CancellationTokenSource();
        watchers.add(watcher);
        const parent = token.onCancellationRequested(() => watcher.cancel());
        if (token.isCancellationRequested) watcher.cancel();
        emit("Báo cáo hoạt động thật, lấy mẫu mỗi 4 giây, cửa sổ 50 tin gần nhất. Nút dừng Chat chỉ kết thúc theo dõi; worker vẫn chạy. Báo cáo chưa được xác minh độc lập. Dùng /interrupt để ngắt, /direct để thêm điều kiện, rồi /resume.");
        try { await watch({ fetchSnapshot: () => fetchSnapshot(watcher.token), emit, token: watcher.token }); }
        finally { parent.dispose(); watchers.delete(watcher); watcher.dispose(); }
        return { metadata };
      }
      const snapshot = await fetchSnapshot();
      if (input.command === "status") {
        emit(statusText(snapshot));
        stream.button?.({ command: "multiagents.openConversation", title: "Mở phòng hội thoại" });
        return { metadata };
      }
      if (command === "resume" && input.target === "@all") {
        parseRequest(command, `${session} | @all${input.message ? ` | ${input.message}` : ""}`);
        const roster = resumeRoster(snapshot);
        const names = agents => agents.map(a => `${a.name} [${a.id}]`).join(", ") || "không có";
        if (!roster.restart.length && !roster.unpause.length) {
          emit("Các worker đủ điều kiện đều đang kết nối và không tạm dừng. Không cần khởi động lại. Dùng /direct để gửi điều kiện cho worker.");
          return { metadata };
        }
        if (mutationBusy) throw new Error("Một thao tác khác đang chờ xác nhận hoặc gửi.");
        if (roster.restart.length) find("resume_session");
        if (roster.unpause.length) find("control_session");
        mutationBusy = true;
        try {
          const message = `Phiên ${session}\nKhởi động lại: ${names(roster.restart)}\nBỏ tạm dừng: ${names(roster.unpause)}\nGiữ nguyên worker khác; bỏ qua worker đã giải phóng.\nCó thể phát sinh phí provider. Khởi động lại dùng provider/model và lịch sử đã lưu, không tạo nhiệm vụ mới. Phiên sẽ hoạt động trở lại. Tiếp tục?`;
          emit(message);
          const choice = await vscode.window.showWarningMessage(message, { modal: true }, "Tiếp tục cả nhóm");
          if (choice !== "Tiếp tục cả nhóm" || token.isCancellationRequested) return { metadata };
          if (stateKey(await fetchSnapshot()) !== stateKey(snapshot)) throw new Error("Nhóm đã thay đổi trong lúc xác nhận. Xem /status trước khi thử lại; không tự gửi lại.");
          if (roster.restart.length) {
            sentControl = true;
            emit(`Phản hồi khởi động từ MCP (chưa chứng minh hoàn thành):\n${await invoke("resume_session", { session_id: session, agents_to_skip: [] })}`);
          }
          for (const agent of roster.unpause) {
            const latest = exactAgent(await fetchSnapshot(), String(agent.id));
            if (latest.connection !== agent.connection || latest.task !== agent.task || latest.paused !== agent.paused) throw new Error("Worker thay đổi trong lúc điều khiển nhóm. Thao tác trước đó có thể đã áp dụng; không tự gửi lại.");
            sentControl = true;
            emit(`${agent.name}: ${await invoke("control_session", { session_id: session, target: String(agent.id), action: "resume_agent" })}`);
          }
          return { metadata };
        } finally { mutationBusy = false; }
      }
      if (input.target === "@all") throw new Error("Điều khiển nhóm chỉ hỗ trợ resume. Chọn từng worker để pause, interrupt hoặc stop.");
      if (!input.target) {
        if (!snapshot.agents.length) throw new Error("Phiên này chưa có worker. Xem /status hoặc chọn phiên khác.");
        emit(`Phiên: ${session}. Chọn worker cho /${command}. Worker mất kết nối cần xác nhận khởi động riêng.`);
        const items = snapshot.agents.map(agent => ({
          label: `${agent.name} [${agent.id}]`, description: `${agent.connection} | ${agent.task}${agent.paused ? " | tạm dừng" : ""}`, agent,
        }));
        const picked = await vscode.window.showQuickPick(items, { title: `/${command} - ${session}`, ignoreFocusOut: true }, token);
        if (!picked || token.isCancellationRequested) return { metadata };
        input.target = String(picked.agent.id);
      }
      if (command === "direct" && !input.message) {
        input.message = await vscode.window.showInputBox({ title: "Điều kiện bổ sung", prompt: "Worker cần thay đổi điều gì? Không nhập thông tin xác thực.",
          value: !explicitSession ? first : "", ignoreFocusOut: true,
          validateInput: value => value.trim().length > 0 && value.length <= 12000 ? undefined : "Nhập từ 1 đến 12000 ký tự." }, token);
        if (!input.message || token.isCancellationRequested) return { metadata };
      }
      parseRequest(command, `${session} | ${input.target}${input.message ? ` | ${input.message}` : ""}`);
      const agent = exactAgent(snapshot, input.target);
      if (mutationBusy) throw new Error("Một thao tác khác đang chờ xác nhận hoặc gửi. Hãy chờ thao tác đó kết thúc.");
      mutationBusy = true;
      try {
        if (command === "resume" && agent.connection === "disconnected") {
          if (agent.task === "released") throw new Error("Worker đã được giải phóng, không thể tiếp tục. Nhiệm vụ mới cần được duyệt rõ qua orchestrator.");
          // resume_session skips by display name or role: refuse ambiguous names.
          if (new Set(snapshot.agents.map(a => a.name?.toLowerCase())).size !== snapshot.agents.length ||
              snapshot.agents.some(a => !a.name)) throw new Error("Tên worker bị trùng hoặc thiếu; hãy làm rõ qua orchestrator.");
          find("resume_session");
          emit(`Thao tác sẽ khởi động lại worker. Phiên ${session}: ${snapshot.session.status}. Phê duyệt trước đó chưa chứng minh nhiệm vụ hoàn thành.`);
          const restart = await vscode.window.showWarningMessage(`Khởi động lại ${agent.name} [${agent.id}] trong ${session}? Provider/model đã lưu sẽ chạy nhiệm vụ và lịch sử cũ, có thể không còn phù hợp và phát sinh phí. Bỏ qua worker mất kết nối khác. Không suy ra nhiệm vụ mới từ lời nhắn.`, { modal: true }, "Khởi động lại worker");
          if (restart !== "Khởi động lại worker" || token.isCancellationRequested) return { metadata };
          const latestSnapshot = await fetchSnapshot();
          if (stateKey(latestSnapshot) !== stateKey(snapshot)) throw new Error("Nhóm đã thay đổi trong lúc xác nhận; xem /status trước khi thử lại.");
          sentControl = true;
          const response = await invoke("resume_session", { session_id: session, agents_to_skip: snapshot.agents.filter(a => a.id !== agent.id).map(a => a.name) });
          emit(`Phản hồi khởi động (chưa chứng minh nhiệm vụ hoàn thành):\n${response}`);
          return { metadata };
        }
        if (agent.connection !== "connected") throw new Error("Worker mất kết nối. Dùng /resume với xác nhận chi phí để khởi động lại.");
        if (input.command === "direct" && ["approved", "released", "done_pending_review"].includes(agent.task)) {
          throw new Error("Worker đã báo kết thúc nhiệm vụ hiện tại. Cần giao việc mới rõ ràng qua orchestrator trước khi gửi điều kiện.");
        }
        if (input.command === "interrupt") {
          const enumValues = find("control_session").inputSchema?.properties?.action?.enum;
          if (!enumValues?.includes("interrupt_agent")) throw new Error("MCP này không có interrupt_agent. Cần phiên bản MCP hỗ trợ thao tác này.");
        }
        const warning = input.command === "stop" ? "Dừng tiến trình worker này? Thao tác đang chạy không được hoàn tác. Lịch sử phiên vẫn giữ."
          : input.command === "interrupt" ? "Yêu cầu ngắt và giữ công việc tiếp theo? Công cụ đang chạy vẫn có thể kết thúc; thay đổi file không được hoàn tác."
          : input.command === "pause" ? "Yêu cầu tạm dừng và giữ tin nhắn? Công cụ đang chạy không bị ngắt cưỡng bức."
          : input.command === "direct" ? `Gửi các điều kiện này? Gửi thành công chưa chứng minh worker đã áp dụng.\n\n${safeText(input.message)}`
          : "Gửi các tin đang giữ và cho worker tiếp tục? Provider có thể phát sinh phí.";
        const choice = await vscode.window.showWarningMessage(`${input.session} / ${agent.name} [${agent.id}]: ${warning}`, { modal: true }, "Xác nhận");
        if (choice !== "Xác nhận" || token.isCancellationRequested) return { metadata };
        const latestSnapshot = await fetchSnapshot();
        if (stateKey(latestSnapshot) !== stateKey(snapshot)) throw new Error("Worker hoặc phiên đã thay đổi trong lúc xác nhận. Xem /status trước khi thử lại.");
        const args = { session_id: input.session, target: String(agent.id) };
        sentControl = true;
        const result = input.command === "stop" ? await invoke("remove_agent", args)
          : input.command === "direct" ? await invoke("direct_agent", { ...args, message: `ĐIỀU KIỆN BỔ SUNG TỪ NGƯỜI DÙNG (hãy xác nhận khả năng áp dụng, không chỉ việc nhận tin):\n${input.message}` })
          : await invoke("control_session", { ...args, action: ACTIONS[input.command] });
        emit(`Phản hồi MCP (chưa chứng minh worker đã tiếp nhận):\n${result}`);
        return { metadata };
      } finally { mutationBusy = false; }
    } catch (error) {
      if (execution) execution.error = safeText(error.message);
      panel.error(safeText(error.message));
      if (!token.isCancellationRequested) emit(`Chưa hoàn tất yêu cầu: ${safeText(error.message)}\n${sentControl ? "Một thao tác có thể đã được gửi. Xem /status trước khi thử lại." : "Chưa gửi điều khiển worker. Dùng /status hoặc /resume không tham số để được hướng dẫn."}`);
      return { metadata };
    }
  };
  const participant = vscode.chat.createChatParticipant("multiagents.chat", handle);
  participant.iconPath = new vscode.ThemeIcon("organization");
  participant.followupProvider = { provideFollowups: result => followups(result) };
  context.subscriptions.push(participant);
}

module.exports = { activate };
