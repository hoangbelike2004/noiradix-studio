# Trợ lý AI thao tác trong Studio

Mặc định, phần cài đặt hiển thị **Nhóm tài khoản ChatGPT + Gemini**: đăng nhập hai tài khoản, chọn model rồi bấm **Dùng hai tài khoản cùng nhau**. ChatGPT lập kế hoạch, Gemini thao tác editor, ChatGPT kiểm tra và chuyển nhận xét cho Gemini sửa nếu cần. Xem [hướng dẫn nhóm tài khoản](ACCOUNT_TEAM.md). Không cần API key cho luồng này.

**AI Agent Manager** cho kết nối API được giữ trong mục **Kết nối API nâng cao**, gồm Orchestrator, workflow và usage monitor. Xem [hướng dẫn Multi-Agent API và kiểm toán token](AI_MULTI_AGENT.md). Bạn vẫn có thể chọn dùng riêng Google hoặc ChatGPT cho chat.

Để dùng ChatGPT **không cần API key hoặc cài CLI**, mở **⚙ → Tài khoản ChatGPT → Continue with ChatGPT**, đăng nhập và cấp quyền dùng gói cho Studio. Sau khi đăng nhập, Studio chọn ChatGPT; nếu đang dùng kết nối khác, bấm **Dùng ChatGPT**. Chọn model từ danh sách của chính tài khoản. Mở nhanh tab này bằng `/?ai-settings=chatgpt`. Khi chuyển máy, mỗi người đăng nhập tài khoản của mình; phiên đăng nhập không được đóng gói cùng dự án.

Khi đã chọn ChatGPT, Studio dùng hạn mức gói được OpenAI cấp và không tự chuyển sang API key đã lưu khi lỗi hoặc hết hạn mức. Bấm **Dùng nhóm AI / API key** nếu muốn chủ động đổi lại. Các giới hạn token/USD trong Quản lý AI chỉ áp dụng cho nhóm đó. Studio chưa có số token gói còn lại từ OpenAI; xem mức sử dụng qua liên kết ChatGPT trong tab tài khoản. Cách tích hợp dùng [Sign in with ChatGPT chính thức](https://developers.openai.com/siwc/token-sharing-open-source), với quyền dùng gói tùy tài khoản.

Để dùng tài khoản Google qua kết nối chính thức, mở **⚙ → Google → Đăng nhập Google**. Studio tự tải và kiểm tra bộ kết nối, không cần tự cài CLI. Đây là phiên editor tương tác riêng với danh sách model do tài khoản cấp; xem [Đăng nhập Google và chuyển máy](GOOGLE_LOGIN.md).

Mở **Trợ lý AI** trên thanh công cụ. Nhập kết quả bạn muốn, chẳng hạn **“Nhân đôi frame này, lật ngang bản sao, thêm vào cuối Walk Down, đặt 8 FPS rồi xuất PNG”**, rồi bấm **Gửi**.

AI xem trạng thái dự án, thực hiện các bước bằng công cụ thật của editor và kiểm tra kết quả. Các thao tác được hỗ trợ gồm:

| Nhóm | Ví dụ |
| --- | --- |
| Frame | Chọn, đổi tên, nhân đôi, tạo, xóa, sắp xếp và xếp cùng hàng |
| Animation | Tạo/chọn/xóa, đổi tên hiển thị, FPS, hướng, kiểu lặp, danh sách và thứ tự frame, phát/dừng |
| Layer/group/region | Tạo, chọn, đổi tên, sắp xếp, xóa, ẩn/hiện, khóa/mở khóa, chỉnh độ trong suốt |
| Hình | Vẽ, tẩy, tô màu, lật, xoay 90°, di chuyển, căn giữa, thay màu, giảm bảng màu pixel art |
| Dự án | Đổi tên, thay bảng màu, đổi kích thước mọi frame bằng scale hoặc crop/expand |
| Ảnh đính kèm | Nhập thẳng thành frame mới, thay ảnh frame hiện tại hoặc thêm layer |
| File kết quả | PNG frame, PNG animation/spritesheet, PNG atlas, ZIP các frame, ZIP TexturePacker hoặc dự án PIX2 |

AI chỉ có thể thực hiện các thao tác đã được nối vào Studio. Nếu thiếu khả năng hoặc chạm giới hạn, nó cần báo phần chưa hoàn tất. Ảnh xoay/di chuyển được giới hạn trong canvas hiện tại; có thể yêu cầu tăng kích thước trước nếu cần giữ phần vượt ra ngoài.

File xuất xuất hiện bằng nút tải trong chat sau khi cả lượt hoàn tất. Bấm tên file để tải xuống; việc chuẩn bị file không tự chọn một đường dẫn trên máy. Bạn có thể chat tiếp để chỉnh kết quả.

- **Sửa frame đang chọn**: bắt đầu với frame/lớp đang hoạt động. AI có thể chọn các frame/lớp khác khi yêu cầu cần thao tác trên chúng. Vẽ không ghi vào lớp bị khóa hoặc ẩn; chỉ mở khóa khi được yêu cầu.
- **Tạo khung hình mới**: thêm một khung hình và đưa vào animation đang chọn nếu có. Sau đó các tin nhắn tiếp theo sửa khung này.
- **Dừng**: hủy cả lượt hiện tại, khôi phục hình trước khi gửi yêu cầu.
- **⌘Z / Ctrl+Z**: hoàn tác toàn bộ thay đổi dự án của lượt vừa hoàn tất, gồm cả cấu trúc frame/layer và thông số animation. Có thể Redo như thao tác thông thường.

Editor tạm khóa thao tác trong lúc AI xử lý để tránh hai bên sửa cùng một dự án. Nếu provider mất kết nối hoặc AI trả về lỗi, các thay đổi đã thực hiện được giữ lại, kèm thông báo lượt chưa hoàn tất; có thể Undo cả lượt. **Dừng** hoặc timeout toàn lượt vẫn khôi phục trước lượt. Nếu một nhóm thao tác gặp lỗi, cả nhóm được hoàn tác để AI có thể xem lại trạng thái và thử sửa. Các thay đổi đang xem trước không được tự động lưu xuống file.

## Đăng nhập bằng ChatGPT — cách dùng chính

1. Mở Studio bằng file nhấp đúp đi kèm bản portable, hoặc launcher của bản mã nguồn.
2. Mở **Trợ lý AI**, bấm **Continue with ChatGPT** trong **⚙ Cài đặt AI → Tài khoản ChatGPT**.
3. Đăng nhập trên trang chính thức của OpenAI, chọn tài khoản/workspace và xem các quyền được yêu cầu. Cho phép dùng gói ChatGPT nếu tài khoản hỗ trợ.
4. Quay lại tab Studio. Lần đầu dùng gói, đọc thông báo và bấm **Đã hiểu**. Sau đó nhập yêu cầu, bấm **Gửi**.

Nút **⚙ Cài đặt AI** trên đầu khung chat mở cửa sổ riêng với các mục **Quản lý AI**, **Google**, **Tài khoản ChatGPT** và **Kết nối OpenAI**. Thêm AI, chọn model và quản lý kết nối trong cửa sổ này; đóng bằng nút × hoặc Escape để quay lại chat.

Không cần tạo hoặc dán API key cho cách này. Đăng nhập thành công chỉ xác nhận danh tính; quyền sử dụng AI phụ thuộc gói, tài khoản, quyền được OpenAI cấp và hạn mức. Nếu chỉ cấp quyền danh tính, Studio hiển thị trạng thái đã đăng nhập nhưng giữ nút vẽ tắt.

Khi dùng gói ChatGPT, Studio hiển thị tài khoản đang chọn, model khả dụng và liên kết **Quản lý sử dụng ChatGPT** đến `https://chatgpt.com/settings/usage`. Danh sách model lấy từ tài khoản; không mặc định tài khoản nào cũng có cùng model. Studio không tự chuyển sang tính phí API khi gói ChatGPT hết hạn mức.

Có thể chọn tài khoản đã lưu hoặc **Thêm tài khoản ChatGPT…**. Mỗi kết nối giữ client ID và thông tin phiên riêng. **Đăng xuất** thử thu hồi phiên từ OpenAI rồi xóa token của tài khoản đó trên máy; nếu chưa xác nhận được thu hồi từ xa, app thông báo và bạn có thể ngắt kết nối trong cài đặt ChatGPT.

Phiên được lưu ngoài thư mục dự án để mở lại app có thể khôi phục/gia hạn khi còn hợp lệ:

- macOS: `~/Library/Application Support/NOIRADIX Studio/chatgpt-auth.json`
- Windows: `%APPDATA%/NOIRADIX Studio/chatgpt-auth.json`
- Linux: `~/.config/noiradix-studio/chatgpt-auth.json`

Đây là file bí mật của tài khoản, không chia sẻ. Trên Unix, thư mục có quyền `0700`, file `0600` và được ghi nguyên khối; trên Windows dùng thư mục cấu hình trong hồ sơ người dùng. Token không được trả về giao diện, ghi vào localStorage hoặc đưa vào ZIP. Đăng nhập dùng trình duyệt hệ thống, PKCE, state, cookie HttpOnly/SameSite và nonce; ID token được xác minh chữ ký qua JWKS, issuer, audience và thời hạn trước khi chấp nhận tài khoản.

Tích hợp này dành cho Studio miễn phí/mã nguồn mở chạy trên máy người dùng, theo [OpenAI Docs: Sign in with ChatGPT cho ứng dụng mã nguồn mở](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt). Nếu chuyển sang sản phẩm thu phí hoặc dịch vụ chạy máy chủ dùng chung, cần kiểm tra lại điều kiện tích hợp với OpenAI.

## Dùng frame hiện tại làm mẫu và tạo thêm frame

Chọn frame có nhân vật trên timeline hoặc mở nó trong Cell Editor. Studio tự gửi ảnh của frame đang chọn cùng dữ liệu pixel cho AI; tên frame mẫu hiển thị ngay dưới ô **Bạn muốn vẽ ở đâu?**.

- **Sửa frame đang chọn**: AI chỉnh vùng/lớp đang chọn; ảnh mẫu cho AI thấy toàn bộ hình hiện có.
- **Tạo frame mới từ hình hiện tại**: AI bắt đầu từ bản sao hình hiện tại, giữ nguyên ảnh gốc và vẽ pose mới trên bản sao.
- Có thể chat **“Tạo thêm 2 frame bước đi dựa trên nhân vật này, giữ nguyên frame gốc”**. Công cụ `create_frame` cho phép AI tạo từng frame từ mẫu ban đầu, frame đang vẽ hoặc nền trống. Các frame mới được nối vào animation hiện tại và xếp cùng hàng trong lưới.

Một lượt có thể tạo tối đa 16 frame. **⌘Z / Ctrl+Z** hoàn tác cả lượt, bao gồm những frame vừa tạo; **Dừng** hủy các nét vẽ/frame tạm của lượt đang chạy. Chất lượng và mức độ giữ đúng nhân vật phụ thuộc kết quả của model.

## Gửi ảnh trực tiếp trong chat

Bấm **Thêm ảnh**, kéo thả ảnh vào khung chat, hoặc dán ảnh từ clipboard. Có thể đính kèm tối đa **3 ảnh PNG, JPG hoặc WebP** mỗi tin nhắn; mỗi file đầu vào tối đa **25 MB**. Studio thu nhỏ ảnh tham khảo về cạnh dài tối đa 1024 pixel và nén/thu nhỏ thêm nếu cần để gửi được. Ảnh này dùng làm mẫu cho AI; không tự thay ảnh trong frame khi chỉ đính kèm.

Ảnh xem trước xuất hiện phía trên các nút gửi. Bấm **×** để bỏ ảnh, rồi mô tả điều bạn muốn, ví dụ **“Dựa vào ảnh này, vẽ nhân vật pixel art trong frame mới”**. Ảnh được gửi cùng tin nhắn qua `input_image` của Responses API, theo [OpenAI Docs: Images and vision](https://developers.openai.com/api/docs/guides/images-vision?api-mode=responses). Ảnh đính kèm gần nhất được giữ trong lịch sử đang mở để AI hiểu yêu cầu chỉnh tiếp; ảnh gốc đính kèm không được lưu vào file dự án hoặc localStorage. Khi tải lại trang, cần đính kèm lại nếu vẫn muốn dùng ảnh đó làm mẫu.

## Dùng API key riêng — tùy chọn

Lấy key OpenAI theo [OpenAI Docs](https://developers.openai.com/api/docs/quickstart):

1. Đăng nhập [OpenAI API Keys](https://platform.openai.com/api-keys), chọn đúng project, bấm **Create new secret key**, đặt tên rồi tạo và sao chép key.
2. Kiểm tra [Billing](https://platform.openai.com/settings/organization/billing/overview) của đúng tổ chức. Nếu Pro đủ điều kiện, kích hoạt và liên kết quyền lợi API credits theo [hướng dẫn OpenAI](https://developers.openai.com/api/docs/guides/chatgpt-api-credits). Key của project phải thuộc tổ chức được nhận credits.
3. Trong Studio, mở **⚙ → Quản lý AI**, nhập tên, chọn **OpenAI API**, chọn model mà tài khoản có quyền, dán key vào ô **API key** rồi **Lưu AI**. Có thể đặt giới hạn token cho riêng agent ngay trong form. Không gửi key vào chat.

Tạo/lưu key không tự gọi model; gửi yêu cầu AI sẽ dùng hạn mức API. Khi hết toàn bộ credit OpenAI, request bị từ chối; credit đã mua hoặc Auto Recharge có thể cho phép tiếp tục và phát sinh thanh toán. Xem [API credits](https://developers.openai.com/api/docs/guides/chatgpt-api-credits). Gemini có Free Tier với hạn mức theo thời gian, Prepay và Postpay; hết số dư Prepay dừng dịch vụ, còn Postpay tiếp tục tính phí theo cấu hình thanh toán và giới hạn. Xem [Gemini Billing](https://ai.google.dev/gemini-api/docs/billing).

Mở **⚙ Cài đặt AI → Kết nối OpenAI → Dùng API key riêng (tùy chọn)**, nhập key vào ô trong Studio rồi bấm **Lưu kết nối**. Cách này sử dụng tài khoản và thanh toán OpenAI API riêng. Không gửi key vào cuộc trò chuyện hoặc đưa vào mã nguồn.

Key nhập trong giao diện chỉ giữ trong bộ nhớ máy chủ đến khi tắt. Ô key được xóa sau khi lưu; không lưu vào localStorage hay lịch sử chat. Có thể giữ cấu hình API qua các lần khởi động theo phần dưới.

### Giữ cấu hình qua các lần khởi động

Sao chép `.env.example` thành `.env.local`, điền `OPENAI_API_KEY` bằng trình soạn thảo trên máy rồi khởi động lại máy chủ. Có thể đặt `OPENAI_MODEL`; mặc định là `gpt-5.4-mini`. File `.env.local` được Git bỏ qua và máy chủ chặn truy cập qua trình duyệt.

Đổi cổng bằng `node tools/studio-server.mjs --port 8081`. GitHub Pages chỉ chạy editor; tính năng chat trực tiếp cần máy chủ này. Máy chủ chỉ lắng nghe `127.0.0.1`.

## Cách hoạt động

Máy chủ gọi OpenAI Responses API với các công cụ `draw`, `inspect_canvas`, `create_frame`, `inspect_studio` và `studio_actions`. Với phiên ChatGPT, công cụ nằm trong namespace `studio`, API dùng `store: false`, `stream: true` và chỉ chấp nhận phản hồi khi nhận `response.completed`. Trình duyệt kiểm tra danh sách thao tác, ID, kiểu dữ liệu, màu, tọa độ và giới hạn trước khi thực thi qua các hàm của editor. Kết quả thực tế của dự án và hình đã cập nhật được trả về model để nó kiểm tra và tiếp tục. Không thực thi JavaScript hoặc mã tùy ý do model trả về.

Bộ đọc kiểm tra các sự kiện SSE và sự kiện hoàn tất, kể cả khi phản hồi thiếu header `Content-Type`. Luồng bị ngắt hoặc báo lỗi vẫn hủy lượt vẽ và giữ hình trước đó.

Mỗi lượt có giới hạn 32 vòng gọi API, 1000 thao tác, tối đa 16 frame mới, 40 thao tác Studio hoặc 100 nét trong một lần gọi công cụ. Tọa độ phải nằm trong khung, kích thước tối đa 512×512. Có thể chuẩn bị tối đa 8 file với tổng dung lượng 64 MB mỗi lượt. Lượt chạy quá 10 phút được dừng. Nếu chạm giới hạn trước khi hoàn tất, cả lượt được hủy và bạn có thể chia yêu cầu nhỏ hơn.

Khi gửi yêu cầu, mô tả, lịch sử chat gần đây và dữ liệu hình của vùng/lớp đang sửa được gửi tới provider đã chọn. OpenAI Responses dùng `store: false`; Gemini dùng generateContent. Trạng thái thực thi công cụ tạm lưu trong bộ nhớ máy chủ, xóa khi xong/hủy hoặc hết hạn sau 5 phút không hoạt động. Tóm tắt task, usage, asset cache và bản ghi dự án được giữ có giới hạn trong phiên máy chủ theo [hướng dẫn Multi-Agent](AI_MULTI_AGENT.md). Chất lượng hình phụ thuộc model và yêu cầu của bạn.

Triển khai theo [OpenAI Docs: Function calling](https://developers.openai.com/api/docs/guides/function-calling).
