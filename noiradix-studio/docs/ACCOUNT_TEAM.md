# Nhóm tài khoản ChatGPT + Gemini

Mở **Trợ lý AI → ⚙ → Nhóm tài khoản** hoặc đường dẫn `/?ai-settings=accounts`. Đây là cách dùng chính khi bạn đã đăng nhập cả hai tài khoản; không cần dán API key hay tự cài CLI.

1. Bấm **Kết nối ChatGPT** và hoàn tất đăng nhập/cấp quyền dùng gói trên trang OpenAI. Nếu đã kết nối, thẻ hiện danh sách model của tài khoản.
2. Bấm **Kết nối Google**, hoàn tất đăng nhập Google. Studio tải bộ kết nối chính thức nếu máy chưa có. Chọn model Google cấp cho tài khoản, không giả định mọi model đều có sẵn.
3. Chọn model trên mỗi thẻ, rồi bấm **Dùng hai tài khoản cùng nhau**. Nút này cũng thử khôi phục phiên Google đã lưu trên máy bằng bộ kết nối chính thức.
4. Đóng cài đặt và nhập yêu cầu một lần, ví dụ: **“Thêm 8 frame Walk Down, giữ nhân vật và bảng màu, đặt 8 FPS.”**

Studio chạy tuần tự trong cùng một lượt editor:

| Bước | Tài khoản | Công việc |
| --- | --- | --- |
| 1 | ChatGPT | Lập kế hoạch theo yêu cầu và trạng thái dự án |
| 2 | Gemini qua Google ACP | Thao tác bằng công cụ editor; hỏi quyền trong chat khi cần |
| 3 | ChatGPT | Kiểm tra snapshot pixel và metadata Studio thật sau lượt Gemini |
| 4, nếu cần | Gemini | Sửa một lượt theo các nhận xét cụ thể |
| 5, nếu có sửa | ChatGPT | Đọc lại trạng thái thật, báo kết quả và hạn chế còn lại |

Vai trò được cố định trong phiên bản này: ChatGPT tư vấn/kiểm tra, Gemini thực hiện editor. Các bước tuần tự chia sẻ kết quả; không có hai AI cùng ghi editor một lúc. Kết quả tư vấn không phải bằng chứng đã sửa hình. Trước mỗi lần kiểm tra, Studio yêu cầu editor trả snapshot canvas và Studio mới.

Tiến độ xuất hiện trong chat. **Dừng** hủy cả lượt và khôi phục dự án trước khi gửi; **Ctrl+Z / ⌘Z** hoàn tác cả lượt đã hoàn tất. Nếu provider gặp lỗi, những thay đổi editor đã làm được giữ lại và được báo là chưa hoàn tất. Từ chối quyền Google dừng nhóm, không tự xin lại quyền. Sau khi hủy phiên Google, chọn dùng nhóm lại để khôi phục kết nối.

Mỗi lượt có tối đa một lần sửa theo nhận xét, tối đa 32 vòng công cụ và 10 phút. Các lệnh xác định như nhân đôi frame hoặc xuất spritesheet vẫn chạy trực tiếp trong editor, không gọi AI.

## Hạn mức và chuyển máy

- Mỗi tài khoản dùng quyền/hạn mức gói mà nhà cung cấp cho phép ứng dụng sử dụng. Đăng nhập không biến mọi model thành miễn phí hoặc không giới hạn.
- Không tự gọi bất kỳ API key đã lưu khi nhóm gặp lỗi hoặc hết hạn mức. Các kết nối API cũ được thu gọn ở **Kết nối API nâng cao** và chỉ dùng khi bạn chủ động chuyển sang nhóm API.
- Token ChatGPT chỉ cộng theo usage OpenAI thực sự báo. Request không có usage được đánh dấu riêng. Số token Google hiển thị là cửa sổ ngữ cảnh do ACP báo, không phải tổng token đã tiêu hay số dư gói.
- Hạn mức gói còn lại không được tự suy ra từ token đã dùng. Các model cùng tài khoản có thể chia sẻ hạn mức; tạo thêm model không tăng số dư.
- Trên máy khác, mỗi người đăng nhập tài khoản của mình. Bộ Google được tự tải và kiểm tra; phiên đăng nhập và tùy chọn nhóm lưu ngoài dự án, không được đóng gói cùng bản portable. Lựa chọn nhóm được lưu trên máy và khôi phục khi mở lại Studio.

Tích hợp dùng [OpenAI Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) và [Google ACP cho editor](https://antigravity.google/docs/ide/extensions/acp/). Google tiếp tục sở hữu và xử lý thông tin đăng nhập; Studio không trích xuất cookie/token web để giả lập API.
