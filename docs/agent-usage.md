# Agent token usage and provider limits

Agents and Stats display input, cached input and output totals for each slot in
the selected session. Cached input is already included in Codex input; do not add
it again. Stats totals cover only agents with supported telemetry and display
the coverage count. These are observed runtime counters, not a billing ledger.

Codex app-server `thread/tokenUsage/updated` provides cumulative `tokenUsage.total`
fields `inputTokens`, `cachedInputTokens`, and `outputTokens`. Each slot persists
hashed thread checkpoints with token increments in the same SQLite update, so
replayed totals after reconnect are not added again. Decreasing/out-of-order
totals do not move checkpoints backwards. New thread IDs have separate totals.
The first observed total may include earlier history of a resumed thread.
Legacy accounting before this change is not independently reconciled.

`account/rateLimits/updated` supplies optional sparse quota windows. Only numeric
percentages, durations and timestamps are retained; no raw account payload,
credentials, credit balances or raw thread IDs are stored in telemetry. Exactly
300-minute and 10080-minute windows are shown as 5-hour and weekly. Other durations
are not relabelled as these windows. Sparse updates retain the prior window and
its original observation timestamp. Multiple quota buckets are not summed.

Remaining percentage is `100 - usedPercent`, not a calculation from session
tokens. Limits are provider/account-scoped and may be shared with other agents,
sessions or applications. After reset time, five minutes without a quota update,
or disconnection, the UI labels the percentage as last reported rather than
assuming the quota has refilled. No extra model calls, account scraping or paid
requests are made to fetch limits.

Missing telemetry says **Not reported**, not zero or unlimited. Zero appears only
after a supported report. This collector targets the Codex app-server schema
verified with CLI 0.153.4; Claude/Gemini and custom providers without compatible
events remain unreported in this UI. Custom API providers may emit token usage
without exposing subscription 5-hour/weekly quotas.

Broker startup adds the nullable `agent_usage` column without deleting existing
data. The updated broker and orchestrator must be running to collect new fields;
the dashboard must reload the updated HTML. Existing running processes do not
hot-load this code. Coordinate restarts with active work; do not kill workers
just to refresh metrics. No historical log scan or live database migration is
performed by the implementation task.

Verification: `bun test tests/agent-usage.test.ts tests/agent-usage-ui.test.ts
tests/codex-driver.test.ts tests/web-dashboard.test.ts --timeout 20000`.
The tests use isolated fixtures, not live provider calls.