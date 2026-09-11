import type { BrokerClient } from "../shared/broker-client.ts";

// Explicit projection: never send private threads, prompts, raw tool arguments or
// reasoning notifications to a chat watcher.
export async function getChatObservation(broker: BrokerClient, sessionId: string) {
  const [session, slots, plan, messages] = await Promise.all([
    broker.getSession(sessionId), broker.listSlots(sessionId),
    broker.getPlan(sessionId), broker.getMessageLog(sessionId, { limit: 50 }),
  ]);
  if (!session) throw new Error("Không tìm thấy phiên");
  const names = new Map(slots.map(slot => [slot.id, slot.display_name || `Slot ${slot.id}`]));
  const isEvent = (type: string) => ["system", "control", "team_change"].includes(type);
  const messageRow = (message: typeof messages[number]) => ({ id: message.id, time: message.sent_at,
    from: names.get(message.from_slot_id ?? -1) ?? message.from_id ?? "Không có ID người gửi",
    to: names.get(message.to_slot_id ?? -1) ?? message.to_id ?? "Nhóm / người điều hành",
    type: message.msg_type,
    // Control/system payloads can contain internal prompts. Publish event metadata only.
    text: isEvent(message.msg_type) ? `Đã ghi sự kiện ${message.msg_type}; nội dung nội bộ không hiển thị.` : message.text.slice(0, 4000) });
  const usage = (slot: typeof slots[number]) => {
    try {
      const data = JSON.parse(slot.agent_usage || "null");
      if (!Number.isFinite(data?.tokensObservedAt) || data.tokensObservedAt <= 0) return null;
      const count = (value: number | undefined) => Number.isSafeInteger(value) && value! >= 0 ? value : null;
      return { observedAt: data.tokensObservedAt, input: count(slot.input_tokens), cached: count(slot.cache_read_tokens), output: count(slot.output_tokens) };
    } catch { return null; }
  };
  return {
    session: { id: session.id, status: session.status },
    agents: slots.map(slot => ({ id: slot.id, name: names.get(slot.id),
      connection: slot.status, task: slot.task_state, paused: Boolean(slot.paused),
      lastConnected: slot.last_connected, lastDisconnected: slot.last_disconnected, usage: usage(slot) })),
    plan: plan ? { completion: plan.completion, items: plan.items.map(item => ({
      label: item.label, status: item.status, agent: names.get(item.assigned_to_slot ?? -1) ?? null,
    })) } : null,
    messages: messages.filter(message => !isEvent(message.msg_type)).map(messageRow),
    events: messages.filter(message => isEvent(message.msg_type)).map(messageRow),
  };
}
