# Chạy và chia sẻ Studio trên localhost

## Người nhận không biết code

Gửi bản ZIP portable đúng hệ điều hành:

| Máy người nhận | File ZIP | File nhấp đúp sau khi giải nén |
| --- | --- | --- |
| macOS, Apple Silicon hoặc Intel | `NOIRADIX-Studio-macOS.zip` | `Mo Studio.command` |
| Windows, Intel/AMD 64 bit hoặc ARM64 | `NOIRADIX-Studio-Windows.zip` | `Mo Studio.bat` |

Bản ZIP có sẵn Node.js cho cả hai kiến trúc của hệ điều hành đó. Người nhận không cần cài Node.js, npm hay mở trình soạn thảo. Bộ chạy và tính tương thích hệ điều hành tuân theo phiên bản Node.js đi kèm; không hỗ trợ Windows 32 bit.

Người nhận làm ba việc: **giải nén toàn bộ → nhấp đúp file mở Studio → dùng trong trình duyệt**. Không tách riêng file mở Studio khỏi thư mục. `BAT-DAU.txt` trong ZIP có hướng dẫn bằng tiếng Việt.

Trình khởi chạy chờ máy chủ sẵn sàng rồi mở đúng URL localhost. Nó dùng lại máy chủ của cùng thư mục nếu đã chạy, hoặc thử cổng 8080 đến 8099 nếu có ứng dụng khác chiếm cổng. Nó không tắt ứng dụng đang chiếm cổng. URL có thể đổi khi cổng mặc định bận; dữ liệu lưu tự động trong trình duyệt thuộc từng URL, nên hãy lưu dự án `.pix2` ra file khi chuyển máy hoặc đổi địa chỉ.

Giữ cửa sổ khởi chạy mở khi dùng app. Lưu dự án rồi đóng cửa sổ hoặc nhấn **Ctrl+C** để tắt máy chủ. Nếu hệ điều hành chặn file tải từ Internet, người nhận cần xem cảnh báo và chỉ cho phép mở khi tin cậy nguồn gửi. Các ZIP này chưa được ký/notarize như một ứng dụng thương mại.

Vẽ tay và import ảnh dùng được ngay. Muốn dùng trợ lý AI, người nhận bấm **Trợ lý AI → Continue with ChatGPT**, đăng nhập và cấp quyền dùng gói nếu tài khoản hỗ trợ. Phiên được lưu trong cấu hình người dùng ngoài dự án; token không đưa vào ZIP. **Dùng API key riêng** là lựa chọn bổ sung, key nhập ở đó giữ đến khi tắt máy chủ. Xem [hướng dẫn đăng nhập AI](AI_CHAT.md).

### Thêm ảnh vào animation

Trong **Animation Studio**, chọn **Walk Down** (hoặc animation cần sửa) → **Add Frame → Import Image as Frame** → xem trước → **Add to Animation**. Tiêu đề màn hình chọn ảnh cho biết animation đích và số frame trước/sau khi thêm. Hai ảnh thêm vào Walk Down có 4 frame sẽ thành **6 frame**, xuất hiện ở cuối timeline và tiếp trên cùng hàng trong Grid Overview. Các animation khác giữ nguyên danh sách frame.

Nếu dùng dự án cũ có ảnh import nằm ở các hàng riêng: chọn animation → **Gom frame về cùng hàng** trong **Active Frame Info**. Nút này xếp các frame đã thuộc animation theo thứ tự timeline, giữ hình và có Undo. Nếu timeline chỉ có 4 frame và hai ảnh chưa thuộc animation, bấm **Add Frame**, để bộ lọc **All Frames**, rồi chọn lần lượt hai ảnh đã có để thêm chúng vào; không cần import lại ảnh. Sau đó bấm **Gom frame về cùng hàng** nếu cần.

### Thay ảnh trong một frame

Chọn frame trên timeline → bấm **Thay ảnh** trong **Active Frame Info** → chọn PNG, JPG hoặc WebP → xem trước → bấm **Thay ảnh**. Trong Cell Editor, nút **Thay ảnh** nằm trên thanh công cụ; trong Grid Overview, nút nằm dưới **Edit Frame Pixels**.

Thao tác thay toàn bộ hình và các lớp của frame, giữ tên, kích thước, ID và vị trí trong animation. Nếu có lớp bị khóa, cần mở khóa trước. Ảnh được khớp vào frame, giữ tỉ lệ và độ trong suốt; có thể chọn giữ màu gốc hoặc chuyển thành pixel art. Sau khi thay vẫn dùng bút, tẩy và các công cụ khác để chỉnh được. **⌘Z** trên Mac hoặc **Ctrl+Z** trên Windows khôi phục hình cũ; **Hủy** ở màn hình xem trước giữ hình hiện tại. **Add Frame → Import Image** tiếp tục dùng để thêm frame mới.

### macOS báo `EPERM: operation not permitted` khi đọc file dự án

Nếu lỗi trỏ đến `tools/launch-studio.mjs` trong Desktop, và quyền đọc file thông thường vẫn đúng, nguyên nhân thường là Terminal chưa được cấp quyền đọc Desktop. macOS có quyền riêng cho Desktop, Documents và Downloads; kiểm thử từ ứng dụng khác không xác nhận được quyền của Terminal trên máy người nhận.

1. Mở **System Settings → Privacy & Security → Files & Folders**.
2. Mở mục **Terminal**, bật **Desktop Folder**. Nếu đặt dự án trong Documents/Downloads, bật quyền tương ứng.
3. Thoát hẳn Terminal bằng **⌘Q**, rồi nhấp đúp file mở Studio lần nữa.

Nếu không thấy mục Terminal hoặc không muốn cấp quyền Desktop: dùng Finder → **Go → Home**, chuyển toàn bộ thư mục dự án vào thư mục chính của bạn, bên ngoài Desktop/Documents/Downloads, rồi mở lại. Không tách riêng file `.command`. Không cần dùng `sudo`, sửa quyền thành `777`, hoặc cấp Full Disk Access để xử lý riêng trường hợp Desktop này.

Launcher macOS bắt lỗi ngay khi nạp module đầu tiên và hiện hướng dẫn trên. Nó không tự thay đổi thiết lập quyền riêng tư của máy. Xem [Apple: Control access to files and folders](https://support.apple.com/en-gb/guide/mac-help/mchld5a35146/mac).

## Tạo hai ZIP để gửi — dành cho người quản lý dự án

Chạy trên macOS hoặc Linux, có Node.js 22+, `zip`, `unzip`, `tar` và Internet:

```sh
node tools/package-studio.mjs
```

Kết quả nằm trong `dist/`:

- `NOIRADIX-Studio-macOS.zip`
- `NOIRADIX-Studio-Windows.zip`
- File `.sha256` tương ứng để kiểm tra ZIP khi cần.

Chỉ tạo một hệ điều hành hoặc chỉ định phiên bản Node.js:

```sh
node tools/package-studio.mjs --platform macos
node tools/package-studio.mjs --platform windows
node tools/package-studio.mjs --node-version v24.22.2
```

Bộ đóng gói tải các bản phân phối chính thức từ `nodejs.org`, kiểm tra SHA-256 theo `SHASUMS256.txt` cùng phiên bản trước khi dùng. Bản mặc định là Node.js 24.22.2. Bản tải được lưu trong `dist/.runtime-cache/` để lần đóng gói sau không tải lại. ZIP luôn lấy nội dung editor hiện tại, nên cần tạo lại sau khi sửa code.

Chỉ các file giao diện, máy chủ cần thiết, tài liệu, ví dụ công khai và bộ chạy được đưa vào ZIP. `.env.local`, `.git`, test, file liên kết và các file ẩn trong thư mục tài nguyên không được sao chép. `dist/` và `runtime/` được Git bỏ qua. Mỗi ZIP có license của Node.js và `BUNDLE-INFO.json` ghi phiên bản cùng checksum.

## Chạy trực tiếp bản mã nguồn

Cài [Node.js LTS chính thức](https://nodejs.org/en/download) từ phiên bản 22 trở lên một lần, rồi nhấp đúp:

- macOS: `start-noiradix-studio.command`
- Windows: `start-noiradix-studio.bat`

Không cần `npm install`. Có thể khởi chạy bằng lệnh khi phát triển:

```sh
node tools/launch-studio.mjs
node tools/launch-studio.mjs --port 8090 --no-open
```

`--no-open` dùng cho kiểm thử hoặc khi muốn tự mở trình duyệt. `node tools/studio-server.mjs` vẫn chạy máy chủ trên cổng 8080 nhưng không tự mở trình duyệt hoặc chọn cổng khác.
