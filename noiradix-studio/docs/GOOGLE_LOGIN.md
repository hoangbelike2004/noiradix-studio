# Đăng nhập Google trong Studio

Mở **Trợ lý Studio → ⚙ → Google → Đăng nhập Google**. Lần đầu, Studio tải bộ ACP chính thức do Google phát hành, kiểm tra SHA-256 rồi mở luồng đăng nhập do bộ Google xử lý. Bạn không cần tự cài Antigravity CLI, Node package hay nhập API key cho kết nối này.

1. Chờ tải và chuẩn bị bộ kết nối. Giao diện hiển thị tiến độ; có thể hủy và thử lại khi mạng ổn định.
2. Hoàn tất đăng nhập tài khoản Google trong trình duyệt. Studio không yêu cầu mật khẩu hay cookie của tài khoản.
3. Khi trạng thái **Google đang được dùng cho chat** xuất hiện, chọn model trong danh sách được tài khoản cấp và đóng cài đặt.
4. Gửi yêu cầu sửa frame, animation, layer hoặc vẽ pixel như bình thường. Agent dùng các công cụ Studio qua MCP; kết quả được gửi lại từ editor thật. Các thao tác editor hợp lệ trong lượt đã gửi được tự cho phép, không hiện nút Cho phép/Từ chối cho từng lệnh. Studio vẫn kiểm tra schema đối số và không tự cấp quyền cho lệnh shell, truy cập file ngoài editor hoặc MCP khác.
5. **Dừng** hủy lượt và khôi phục transaction editor. Sau khi dừng, kết nối lại Google để mở một phiên sạch; không phát lại công cụ của lượt cũ.

## Máy khác và bản portable

Trên máy mới, mở Studio rồi bấm **Đăng nhập Google**. Studio tự nhận hệ điều hành/kiến trúc và tải bộ chính thức phù hợp. Không cần cài CLI toàn hệ thống hoặc sửa PATH. Máy cần kết nối Internet để tải lần đầu và sử dụng AI. Các lần sau tái sử dụng cache đã xác minh; cache thay đổi/hỏng sẽ được tải lại trước khi chạy.

Bộ kết nối tải từ `dl.google.com`; phiên bản/checksum ghim trong `tools/google-acp-runtime.mjs`, đối chiếu [ACP Registry](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json). Không đóng gói lại binary độc quyền của Google trong bản phát hành Studio. Bản portable bao gồm mã tải/kết nối, rồi lấy runtime trực tiếp từ Google trên máy người dùng.

Cache và lựa chọn Studio nằm trong thư mục dữ liệu cá nhân:

- Windows: `%LOCALAPPDATA%/NoiradixStudio/google-acp`
- macOS: `~/Library/Application Support/NoiradixStudio/google-acp`
- Linux: `$XDG_DATA_HOME/NoiradixStudio/google-acp` hoặc `~/.local/share/NoiradixStudio/google-acp`

Thông tin xác thực do runtime chính thức của Google quản lý. Studio chỉ lưu lựa chọn dùng Google hay nhóm API; không sao chép token đăng nhập vào project, localStorage hoặc gói portable. Mỗi máy/người dùng hoàn tất đăng nhập bằng tài khoản của mình.

## Tài khoản, model và hạn mức

- Đây là **phiên editor tương tác qua ACP**, dùng riêng hoặc phối hợp trong [Nhóm tài khoản ChatGPT + Gemini](ACCOUNT_TEAM.md). ChatGPT lập kế hoạch/kiểm tra, phiên Google nhận kế hoạch và tự thao tác qua công cụ editor theo yêu cầu đã gửi. Luồng này tách khỏi scheduler dùng API key; không gọi `agy -p`, trích xuất OAuth token hoặc dùng endpoint web nội bộ.
- Model được lấy từ phiên ACP của tài khoản, không giả định mọi người đều có Gemini 4 Argon. Hạn mức và quyền sử dụng phụ thuộc gói dịch vụ, khu vực, tài khoản và chính sách Google.
- Google chịu trách nhiệm cấp quyền sử dụng gói. Đăng nhập thành công không đồng nghĩa mọi model/hạn mức đều được mở. Studio không tự chuyển sang Gemini API trả phí khi gói hết hạn mức.
- **Dùng nhóm AI / API key** chuyển chat về các kết nối đã cấu hình trước đó. **Dùng Google cho chat** chọn lại phiên Google. **Ngắt kết nối** dừng sử dụng Google trong Studio; không thu hồi phiên Google toàn hệ thống.
- **Ngữ cảnh dùng/tổng token** từ `usage_update` là dung lượng cửa sổ ngữ cảnh. Nó không phải số token/quota gói còn lại. Nếu Google không trả số dư gói, Studio hiển thị chưa có dữ liệu.

Tham khảo: [Google ACP cho editor](https://antigravity.google/docs/ide/extensions/acp/), [xác thực ACP](https://agentclientprotocol.com/protocol/v1/authentication), [MCP trong phiên ACP](https://agentclientprotocol.com/protocol/v1/session-setup).

## Khi chưa kết nối được

- **Máy chủ dùng bản cũ**: đóng/mở lại bằng file khởi động Studio để nạp phần máy chủ mới. Ctrl+F5 chỉ tải lại giao diện. Launcher giữ phiên cũ nếu nó còn chạy và mở bản mới ở cổng khác; dùng đúng URL được launcher in ra.
- **Không tải được/checksum không khớp**: kiểm tra Internet, proxy/firewall và khả năng truy cập `dl.google.com`, rồi thử lại. Studio sẽ không chạy bản tải chưa xác minh.
- **Không có đăng nhập Google/model yêu cầu**: kiểm tra quyền tài khoản trong Antigravity; không nhập key trả phí để thay thế nếu bạn muốn dùng gói Google.
- **Đã chạm hạn mức**: kiểm tra usage trong dịch vụ Google, chờ hạn mức phục hồi hoặc chọn model khác được tài khoản cấp. Studio không thể tăng hạn mức nhà cung cấp.

Kiểm thử giao thức dùng ACP subprocess và provider giả lập, không gọi AI trả phí. Kết nối `initialize` của binary Google Windows 1.4.5 đã được kiểm tra riêng; hoàn tất OAuth và quyền sử dụng model thực tế cần tài khoản người dùng.
