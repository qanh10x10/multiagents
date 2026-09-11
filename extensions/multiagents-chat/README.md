# Multiagents Chat

Cần VS Code 1.105+, workspace được tin cậy và MCP multiagents đang sở hữu nhóm
được bật trong `vscode.lm.tools`. Chọn đúng MCP một lần; các công cụ điều khiển
chỉ được lấy từ cùng tên tiền tố. Extension không tạo owner/worker/provider thay
thế và không sửa cấu hình.

## Điều phối AI bằng model đang chọn

Nhập `@multiagents` và yêu cầu tự nhiên. Điều phối viên AI dùng `request.model`
của VS Code Chat, có sử dụng token/quota của model đó. Không thêm provider worker.

- `Nhóm giao diện đến đâu, nếu tắt thì bật lại.`
- `Bật lại tất cả woker.`
- `Nhóm kia đang vướng gì?` (hỏi lại nếu có nhiều nhóm phù hợp).
- `Chỉ xem trạng thái, không bật lại worker.`

Ba công cụ nội bộ: `sessions`, `observe`, `control`. Điều hướng chỉ đọc có thể
tự động khi phiên đã rõ. Báo cáo, tên phiên và kết quả công cụ là dữ liệu không
đáng tin, không phải chỉ dẫn. Model phải trích nguyên văn yêu cầu thao tác trong
tin nhắn hiện tại; báo cáo không cấp quyền thực thi. Phủ định và yêu cầu chỉ đọc
chặn thao tác. Guard thận trọng; dùng slash command để làm rõ yêu cầu bị từ chối.

Mọi điều khiển dùng executor native Chat: xác nhận với phiên/worker cụ thể và
kiểm tra lại trạng thái trước khi gửi. Khởi động lại có thể phát sinh phí, dùng
nhiệm vụ/lịch sử đã lưu. Worker đã giải phóng không được khởi động lại. Nhiệm vụ
mới cần đi qua lifecycle giao việc của orchestrator.

Mỗi yêu cầu giới hạn: 5 vòng, 8 công cụ, 3 công cụ/vòng, 90 giây, prompt 8000 ký
tự, lịch sử tối đa 12 lượt/10000 ký tự, nội dung model tối đa 16000 ký tự. Input
được kiểm tra bằng `countTokens`, tối đa 24000 token hoặc 70% cửa sổ model; mỗi
kết quả công cụ vào model khoảng 12000 ký tự và có nhãn nếu rút gọn. Host/model
có thể tính thêm token trước khi nhận hủy; đây không phải giới hạn phí tuyệt đối.

Nếu model không khả dụng, hết quota, lỗi hoặc bị hủy: không đổi provider, không
tự gửi lại thao tác. Nhiều bước không nguyên tử, một phần có thể đã được gửi;
kiểm tra `/status` trước khi thử lại. Tổng hợp gắn nhãn **Điều phối AI**, khác với
tin nhắn worker thật và không phải bằng chứng hoàn thành.

## Slash command không gọi model

Dùng trong `@multiagents`, thay `worker` bằng tên chính xác hoặc ID số:

| Command | Nội dung |
| --- | --- |
| `/session` | Chọn hoặc đổi phiên |
| `/status session-id` | Đọc trạng thái |
| `/watch session-id` | Báo cáo mỗi 4 giây, tối đa 10 phút |
| `/pause session-id \| worker` | Tạm dừng hợp tác có xác nhận |
| `/interrupt session-id \| worker` | Yêu cầu ngắt lượt Codex có xác nhận |
| `/direct session-id \| worker \| điều kiện` | Gửi điều kiện bổ sung có xác nhận |
| `/resume session-id \| worker` | Tiếp tục hoặc xác nhận khởi động lại |
| `/resume session-id \| @all` | Xác nhận danh sách cần khởi động/bỏ tạm dừng |
| `/stop session-id \| worker` | Xác nhận dừng tiến trình, giữ lịch sử phiên |

Bỏ trống tham số để được hướng dẫn. Phiên được nhớ trong cùng Chat và cùng MCP.
Hủy Chat dừng theo dõi/điều phối, không tự dừng worker hay hoàn tác thao tác đang
chạy. Trạng thái có thể đổi sau kiểm tra cuối: MCP chưa có giao dịch nguyên tử
ràng buộc điều khiển với phiên bản trạng thái.

## Panel chỉ đọc

Dùng nút **Mở phòng hội thoại** trong Chat hoặc command palette
**Multiagents: Mở phòng hội thoại**. Panel hiển thị bản quan sát từ Chat: người
gửi/nhận, thời điểm, nội dung thật, worker/nhiệm vụ/token, sự kiện hệ thống riêng,
trạng thái trống/lỗi và kết nối tại thời điểm ghi nhận.

Panel không gọi model/MCP, không có network và không giữ `toolInvocationToken`
bên ngoài yêu cầu Chat. Chỉ chuyển giữa tối đa 12 phiên đã quan sát trong RAM;
không phải mọi phiên trên broker. Dùng `@multiagents /status` hoặc `/watch` để
cập nhật/chọn phiên mới. Nút hướng dẫn chỉ chỉ đường đến Chat, không gửi prompt.

Nội dung dùng văn bản an toàn; CSP chỉ cho tài nguyên extension và script có
nonce. Không có trusted Markdown, HTML hoặc command link từ báo cáo. Projection
loại prompt/private context; system/control chỉ hiển thị metadata. Mẫu credential
phổ biến được che như lớp phòng vệ bổ sung; không gửi bí mật trong báo cáo.
Cửa sổ 50 bản ghi, nội dung tối đa 4000 ký tự, không phải lịch sử đầy đủ hay luồng
không mất bản ghi. Cached token đã nằm trong input, không cộng lại. Hạn mức 5 giờ/
tuần xem trong dashboard, không suy ra từ token.

## Kiểm chứng và vận hành

Xem `docs/conversation-upgrade.md` tại gốc repo. Tests dùng Bun, VS Code/model giả
lập và browser fixture, không gọi provider thật. Chưa smoke test extension host
đã cài. Manifest vẫn `0.1.2`; sửa source không có nghĩa extension đã cài hoặc
worker đang chạy đã được cập nhật. Không tạo/cài VSIX trong công việc này.

Cấu hình **Multiagents Chat: Extension Host** có sẵn trong Run and Debug nếu được
duyệt thử riêng. Phải giữ đúng MCP sở hữu nhóm. Đóng gói, cài đặt, khởi động lại
MCP và phát hành cần phê duyệt riêng.
