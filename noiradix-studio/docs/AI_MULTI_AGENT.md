# AI Agent Manager và kiểm toán token

Để dùng **hai tài khoản ChatGPT + Google đã đăng nhập, không nhập API key**, mở [hướng dẫn Nhóm tài khoản](ACCOUNT_TEAM.md). Phần dưới mô tả nhóm API nâng cao và tài khoản ChatGPT được thêm thủ công vào nhóm đó.

## Bật và sử dụng

Chạy Studio bằng launcher hiện có hoặc `node tools/launch-studio.mjs` (Node.js 22+). Mở **Trợ lý AI → ⚙ Cài đặt AI → Nhóm tài khoản → Kết nối API nâng cao**. Khi mở phần nâng cao, danh sách API ở bên trái, form thêm/sửa bên phải. Khả năng model, giới hạn và chi phí nằm trong **Cài đặt nâng cao**. Chế độ Single/Multi-Agent của nhóm API cũng nằm trong phần này.

1. Nhập tên, chọn provider, chọn model trong danh sách và nhập API key rồi bấm **Lưu AI**. Gemini có lựa chọn **Gemini 4 Argon** và **Gemini 3.8 Flash**; OpenAI có **GPT-6.1 Sol**, **GPT-6 Astra**, **GPT-6.1 Terra**, **GPT-6 Luna**. Chọn **Model khác…** nếu cần nhập một ID chưa có trong danh sách. Model đã lưu vẫn được giữ nguyên khi mở sửa. Các mục này là gợi ý, không xác nhận quyền truy cập của key; đối chiếu [OpenAI Docs](https://developers.openai.com/api/docs/models) hoặc [Google](https://ai.google.dev/gemini-api/docs/models). Thêm bao nhiêu kết nối tùy nhu cầu, kể cả nhiều kết nối cùng provider. Model phải thực sự hỗ trợ chức năng bạn đánh dấu; Studio không tự đổi model khi lỗi.
2. Có thể bấm **Thêm kết nối OpenAI API hiện tại** để đưa key đã cấu hình vào nhóm mà không nhập lại key. Để dùng OAuth, đăng nhập bằng giao diện ChatGPT hiện có, chọn tài khoản, rồi bấm **Thêm tài khoản ChatGPT đang chọn**. Lặp lại cho tài khoản khác. Model OAuth được kiểm tra trong danh sách model của đúng tài khoản đó.
3. Bấm **Điều phối** trên AI muốn làm Orchestrator. **Sửa** cho phép đổi model, vai trò, khả năng, giá và giới hạn; **Tắt/Bật**, **Xóa** quản lý thành viên nhóm. Xóa agent OAuth không đăng xuất tài khoản gốc.
4. Chọn **Tự động**, **Single-Agent** hoặc **Multi-Agent**. Khi chỉ có một AI, không phát sinh một AI điều phối riêng. Khi có nhóm, Orchestrator chỉ gọi worker nếu cần. Nhóm có thể hoàn tất một yêu cầu chỉ bằng Orchestrator.
5. Theo dõi workflow ngay trong chat. Mở phần chi tiết để xem task, agent, trạng thái, request, input/output/cached tokens, thời gian và cache hit rate. **Tải usage JSON** xuất số đo của phiên để so sánh ngoài Studio.

Chọn **Dùng nhóm AI / API key** trong tab tài khoản để chủ động dùng nhóm API. Việc đã thêm key không ghi đè lựa chọn nhóm tài khoản hoặc tài khoản riêng; lỗi quota của nhóm tài khoản không chuyển sang key trả phí. Một agent có trạng thái `unverified` sau khi thêm; chỉ phản hồi API thành công mới xác nhận `online`. Không có heartbeat trả phí. Model và khả năng do người dùng khai báo; một provider/model không tương thích được báo lỗi, không được mô phỏng thành công.

Key được xem là chuỗi bí mật do provider phát hành: hỗ trợ dấu chấm và các ký tự ASCII hiển thị, tối đa 4.096 ký tự; không giới hạn vào định dạng key cũ. Tool bỏ khoảng trắng ở hai đầu khi dán và từ chối khoảng trắng/ký tự điều khiển bên trong key. Việc lưu key chỉ xác nhận dữ liệu nhập; xác thực thực tế và quyền model do provider kiểm tra khi gọi. Lỗi 401/key bị từ chối được phân biệt với lỗi 403/quyền truy cập và lỗi 404/model không tìm thấy. Sau khi cập nhật bộ kiểm tra key phía máy chủ, cần khởi động lại Studio để nạp bản sửa.

Các kết nối mới, key API, giá, cache, số đo và bản ghi dự án nằm trong RAM máy chủ. Khởi động lại máy chủ sẽ xóa chúng. Phiên ChatGPT vẫn dùng kho OAuth hiện có ngoài thư mục dự án; không sao chép token vào Agent Manager. Dùng `.env.local` cho cấu hình API qua lần khởi động, theo quy trình hiện có:

```dotenv
OPENAI_API_KEY=...
OPENAI_MODEL=ID_MODEL_DANG_CO_QUYEN
GEMINI_API_KEY=...
GEMINI_MODEL=ID_MODEL_DANG_CO_QUYEN
```

Gemini chỉ tự tạo kết nối khi có cả key và model. OpenAI trong `.env.local` vẫn là kết nối cũ, có thể thêm vào nhóm bằng nút bên trên. Không đưa key thật vào tài liệu, mã nguồn hoặc usage JSON.

## Token đã dùng và còn lại

Mỗi thẻ AI trong **⚙ → Quản lý AI** hiển thị tổng token đã dùng, input/output/cache và **Còn lại trong Studio**. Số đo lấy từ usage mà OpenAI/Gemini trả về; cập nhật trong lúc khung chat mở. Cache đã nằm trong input nên không cộng hai lần.

- Bấm **Đặt giới hạn token** hoặc **Đổi giới hạn token**, nhập tổng ngân sách cho AI trong phiên máy chủ rồi **Lưu AI**. Số còn lại bằng giới hạn này trừ input + output đã dùng. Giới hạn là tổng cho cả phiên, không phải lượng cộng thêm. Để trống nếu không giới hạn; 0 chặn request. Thanh tiến độ cảnh báo khi còn tối đa 10% hoặc đã hết.
- Chưa nhập giới hạn: hiển thị **Chưa đặt giới hạn**. Provider thiếu usage: hiển thị **Chưa xác định**, không suy ra số dư từ dữ liệu thiếu. Phiên ChatGPT OAuth chỉ hiển thị usage và liên kết hạn mức ChatGPT, không hỗ trợ ngân sách token riêng.
- Đây là ngân sách do bạn tự đặt trong Studio, không phải số dư tài khoản nhà cung cấp. API tính chi phí theo model, input/output/cache và có hạn mức theo thời gian; không có một lượng token cố định quy đổi chung cho mọi model. Số đo không bao gồm sử dụng ở ứng dụng khác hoặc AI khác, kể cả cùng key. Khởi động lại máy chủ sẽ xóa số đo và giới hạn trong RAM.
- **Usage** và **Số dư API / Billing** trên mỗi thẻ mở trang của đúng nhà cung cấp. Key gọi model thông thường trong Studio không đồng bộ số dư thanh toán. OpenAI Costs API là API quản trị tổ chức, không phải số dư token của từng agent; xem [OpenAI Docs](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs). Gemini hướng dẫn theo dõi ở [AI Studio](https://ai.google.dev/gemini-api/docs/billing).

Studio kiểm tra trước mỗi request bằng dự toán bảo thủ, vì vậy có thể dừng khi số còn lại vẫn dương nếu không đủ cho request tiếp theo. Chi phí hiển thị dựa trên giá do bạn nhập, không thay thế hóa đơn của nhà cung cấp.

## Những gì kiểm toán mã nguồn xác nhận

| Thành phần trước nâng cấp | Dữ liệu gửi và hệ quả |
| --- | --- |
| `js/ai-chat.js` | Giữ tối đa 12 tin nhắn gần đây, không phải toàn bộ lịch sử. Có thể giữ ảnh đính kèm gần nhất cho lượt tiếp theo. |
| `js/app.js`, `captureAiTarget()` | Gửi PIX2 của frame/lớp đang chọn, kích thước, tên, thông tin animation và trang metadata Studio. Đồng thời gửi PNG/WebP của toàn frame hiện tại. Hai cách biểu diễn có mục đích khác nhau: tọa độ chính xác và tham khảo hình ảnh toàn frame. |
| `tools/studio-agent.mjs` cũ | Mỗi vòng gửi instructions, toàn bộ schema của 5 công cụ, lịch sử ban đầu và tất cả output/tool results đã tích lũy. Có thể lên tới 32 vòng. Không có usage monitor để biết phần nào thực sự tốn token. |
| Tool results từ editor | `draw`, `create_frame`, `inspect_canvas` trả toàn bộ canvas; `studio_actions` còn trả metadata Studio. Các snapshot cũ bị gửi lại ở những vòng tiếp theo. |
| `AiDrawing.makeContext()` cũ | Chỉ dùng horizontal runs khi PIX2 vượt 500.000 ký tự. Frame nhỏ, nhiều pixel cùng màu vẫn có thể được biểu diễn bằng hàng nghìn lệnh pixel. |
| `/api/ai/chat` tương thích cũ | Yêu cầu model xuất trọn một frame PIX2, khác luồng dùng công cụ hiện tại. Không phải đường chat mặc định trong giao diện. |
| Ảnh | Có thể gửi hai lần cùng dữ liệu ảnh nếu ảnh nguồn và ảnh người dùng đính kèm trùng nhau. Ảnh cần thiết vẫn bị tính vision tokens khi provider phân tích. |

Không tìm thấy bằng chứng rằng mọi request trước đó bị gửi hai lần. Có chuỗi request theo vòng công cụ, dễ nhầm là trùng lặp. Cũng không thể kết luận mức chênh lệch so với giao diện ChatGPT chỉ từ mã nguồn: model, công cụ tạo hình, số vòng và cơ chế thanh toán có thể khác nhau. Chi phí gói ChatGPT không được quy đổi thành giá API tùy tiện.

## Thay đổi tối ưu đã triển khai

- Giữ 4 tin nhắn gần nhất, tối đa 4.000 ký tự/mục, thay cho 12 mục. Tham số kỹ thuật vẫn lấy nguyên vẹn từ trạng thái editor, không tóm tắt PIX2/palette/timing. Bản ghi dự án riêng giữ thiết kế nhân vật, style và các quyết định đã thống nhất bằng `remember_project`, theo ID project trong phiên Studio. Chỉ lưu bản ghi khi lượt hoàn tất.
- Thay snapshot canvas/Studio cũ trong tool feedback bằng asset reference khi đã có snapshot mới hơn. Giữ thứ tự call/result và trạng thái reasoning cần thiết của từng provider. Snapshot mới nhất vẫn đầy đủ.
- Dùng horizontal runs khi chúng ngắn hơn danh sách pixel, kể cả frame nhỏ. Fixture 32×32 tô một màu giảm biểu diễn từ khoảng 14.108 byte xuống 1.136 byte, giữ nguyên 1.024 pixel. Đây là số đo kích thước văn bản của fixture, **không phải tuyên bố giảm 92% token/chi phí trên mọi tác vụ**.
- Gộp ảnh có dữ liệu giống nhau trong một nhóm ảnh gửi, giữ tên của cả hai nguồn. Không hạ độ chi tiết ảnh để lấy số token thấp hơn.
- Worker chỉ nhận mục tiêu, expected output, bản ghi chung, tham số/asset liên quan và ảnh tham khảo cần thiết; không nhận toàn bộ hội thoại hoặc reasoning của Orchestrator.
- Cache kết quả tư vấn không sửa editor theo provider/model/agent, mục tiêu, expected output, context và hash ảnh. TTL 5 phút, tối đa 64 kết quả, gộp cả request tư vấn trùng nhau đang chạy. Không cache/replay lệnh sửa pixel, tạo frame hoặc xuất file.
- OpenAI API gửi `prompt_cache_key` ổn định; Gemini dùng caching ngầm của provider khi có. Chỉ ghi cached tokens thực sự provider báo, không coi cache hint là cache hit. Không tạo explicit cache có phí lưu trữ tự động.
- Asset dùng SHA-256 và kho RAM tối đa 32 MiB. Asset ID là tham chiếu **cục bộ**; không phải file ID trên OpenAI/Google. Ảnh cần xem vẫn đi qua `input_image`/`inlineData`; hiện chưa upload ảnh lên kho file dài hạn của provider. Dùng file ID không tự làm mất phí phân tích ảnh.

Các lệnh chính xác sau chạy bằng thuật toán editor với **0 request AI**, kể cả chưa kết nối AI:

```text
Nhân đôi frame này
Đổi kích thước tất cả frame 32x32
Dịch frame 2,-1
Xuất spritesheet
```

Chỉ nhận toàn bộ câu lệnh khớp rõ ràng. “Nhân đôi frame này rồi đổi màu áo” đi qua AI để hiểu đủ yêu cầu. Resize dùng nearest-neighbor trên mọi frame; dịch pixel tuân theo biên canvas hiện tại. Những thao tác phức hợp khác có thể cần một model để phân tích ý định, nhưng việc copy/resize/ghép/transform thực tế vẫn thực hiện bằng code của editor.

## Kiến trúc và giao thức thực thi

```text
Chat hiện có → Local task router hoặc Orchestrator
                             ├─ designer/planner/reviewer: tư vấn độc lập song song
                             └─ generator/refiner: công cụ editor, tuần tự
                   → actual tool results → Orchestrator → kết quả / export
```

| Module | Trách nhiệm |
| --- | --- |
| `tools/ai-providers.mjs` | OpenAI Responses và Gemini generateContent thật; chuẩn hóa calls, reply, usage; giữ native reasoning/signatures phía máy chủ. |
| `tools/ai-agent-manager.mjs` | Danh sách động, metadata, vai trò, capability, key trong RAM, giới hạn và thống kê; định tuyến theo khả năng, vai trò, trạng thái và giá do người dùng nhập. Không có hard-code số lượng tài khoản. |
| `tools/studio-agent.mjs` | Orchestrator được chọn, scheduler, task lifecycle, delegation, retry/fallback, quyền ghi editor và kết quả tổng hợp. |
| `tools/ai-context.mjs` | Shared context, asset IDs, bản ghi dự án, nén lịch sử tool, cache kết quả tư vấn. |
| `tools/ai-usage.mjs` | Usage thực tế, ước tính giá, dự phòng ngân sách trước request, giới hạn workflow. |
| `js/ai-agent-manager.js` | CRUD kết nối, điều phối, cấu hình, workflow, bảng so sánh và tải số đo. |
| `js/ai-agent-usage.js` | Tổng token, số còn lại trong ngân sách Studio; phân biệt thiếu usage, chưa đặt giới hạn và phiên ChatGPT. |
| `js/ai-local-tasks.js` | Nhận dạng một số câu lệnh chắc chắn không cần AI. |
| `js/app.js`, `js/ai-tools.js`, `js/ai-studio.js` | Tiếp tục thực thi các công cụ có kiểm tra kiểu/ID/tọa độ/quyền khóa và xuất PNG/ZIP/PIX2 thật. |

Task có ID, goal, agent/provider/model, role, expected output, input asset reference, trạng thái, result và error. Input/constraints chi tiết nằm trong shared context phía máy chủ. Trình duyệt chỉ nhận lệnh công cụ hợp lệ để thực thi và báo kết quả thật; không thực thi JavaScript do model tạo. Không hiển thị chuỗi suy luận nội bộ.

`delegate_tasks` chỉ có ở Orchestrator khi có ít nhất hai kết nối. Worker không có quyền gọi tiếp worker. Designer/planner/reviewer là vai trò tư vấn; generator/refiner mới có quyền dùng công cụ pixel/Studio. Batch delegation yêu cầu các task độc lập. Công việc phụ thuộc kết quả trước đó phải được giao trong lần delegate kế tiếp. Dù có nhiều provider, chỉ một task được ghi editor tại một thời điểm.

Chế độ tự động chọn worker có capability phù hợp, ưu tiên vai trò đã gán, trạng thái và giá khai báo. Chế độ thủ công bắt buộc Orchestrator dùng agent ID có vai trò khớp. Đây là heuristic định tuyến, chưa phải dự đoán chất lượng model bằng benchmark. Không tuyên bố Multi-Agent luôn rẻ hơn Single-Agent.

## Giới hạn, lỗi và dữ liệu đã tạo

- Mặc định tối đa 32 request, 32 vòng công cụ, 8 task con, 16 frame mới, 1.000 thao tác, 1 retry và 2 vòng sửa lỗi. Có thể chỉnh request/retry/output/budget trong giao diện; máy chủ vẫn kiểm tra giới hạn.
- Timeout mỗi request 120 giây; giao diện dừng lượt sau 10 phút. Workflow chờ công cụ quá 5 phút được hết hạn và nhả quyền điều phối.
- Chỉ retry lỗi mạng, timeout, lỗi tốc độ tạm thời đã nhận diện và lỗi máy chủ; không retry cùng credential khi bị từ chối quyền. Nếu được cho phép, có thể đổi sang một agent tương thích. Thời gian chờ retry tăng dần, tối đa 2 retry cấu hình.
- HTTP 429 được phân biệt bằng mã lỗi: hết credit, giới hạn chi tiêu của project/tổ chức, hạn mức gói ChatGPT, quota Gemini theo ngày hoặc tốc độ request/token. Không kết luận hết tiền nếu provider chỉ trả 429 chung chung. Không retry cùng kết nối với lỗi credit/quota; nếu cấu hình cho phép, có thể chuyển sang một agent khác. Với lỗi tốc độ có `Retry-After` tính bằng giây, chờ ít nhất thời gian đó; nếu quá 10 giây thì trả hướng dẫn thay vì giữ editor bị khóa. Thông báo chỉ dùng mã đã nhận diện, không đưa nguyên văn phản hồi provider vào giao diện.
- Khi chuyển quyền Orchestrator, chỉ một state server sở hữu workflow. Agent thay thế nhận trạng thái editor đã xác nhận, task hoàn tất và kết quả tool gần nhất. Không phát lại lệnh cũ hoặc mang reasoning của model khác sang model mới.
- Lỗi Worker được trả rõ cho Orchestrator, kèm trạng thái ảnh thực tế đã cập nhật. Nếu Orchestrator cuối cùng vẫn lỗi, editor giữ những thay đổi đã thực hiện; người dùng được thông báo lượt chưa hoàn tất và có thể Undo cả lượt. Không tự nhận thành công hoặc xóa các frame đã tạo chỉ vì lỗi mạng cuối lượt.
- **Dừng** hoặc timeout toàn lượt vẫn khôi phục trước lượt theo hành vi transaction hiện có. Batch Studio lỗi tự hoàn tác batch đó. Tệp đã chuẩn bị được đưa ra tải sau khi chốt transaction; chưa có việc tự ghi vào một đường dẫn đĩa.
- Đổi cấu hình agent trong lúc workflow đang chạy/chờ bị từ chối để tránh đổi tài khoản/model giữa giao dịch. Có thể hủy lượt trước. Khởi động lại máy chủ xóa workflow RAM; không có phục hồi workflow qua crash máy chủ.

Khóa frame/layer là ràng buộc editor có kiểm tra thực sự. Chỉnh theo frame/lớp/vùng đang chọn và các nét cục bộ được hỗ trợ; chưa có endpoint crop/mask generative-image riêng. Chất lượng chuyển động và thiết kế giữa frame vẫn phụ thuộc model và đánh giá của người dùng, không có cam kết tự động “game-ready”.

## Usage và ngân sách

Monitor ghi input/output/cached tokens từ Responses `usage` hoặc Gemini `usageMetadata`. Gemini output gồm cả `candidatesTokenCount` và `thoughtsTokenCount`; nội dung thought không gửi ra UI. Usage thiếu được đánh dấu chưa được báo, không coi là 0 token đã xác nhận. Request lỗi vẫn được đếm; request incomplete có usage vẫn được ghi. Endpoint `/api/ai/chat` cũ cũng ghi số đo, nhưng không dùng delegation và không hỗ trợ chính sách ngân sách workflow mới.

Giá USD/triệu input, cached input, output do người dùng khai báo theo provider/model. Nếu thiếu giá hoặc usage, hiển thị “chưa đủ giá”. Tổng USD chỉ là phần có thể tính; `unpricedRequests` cho biết phần còn thiếu. Phiên dùng gói ChatGPT không bị gán giá API. Chưa có gọi native image-generation API trong pipeline này nên không ghi bịa phí sinh ảnh riêng; hình được dựng bằng công cụ pixel và tính token của model gọi công cụ.

Trước request, máy chủ kiểm tra số request và dự phòng token/chi phí bằng số byte văn bản, allowance ảnh và output tối đa. Đây là **ước tính bảo thủ, không phải hóa đơn hoặc bộ đếm token chính xác của provider**. Chặn ngân sách USD nếu thiếu bảng giá; dừng nếu request trước có usage chưa xác nhận khi đang dùng giới hạn token/USD. Request tư vấn song song cùng chia dự phòng ngân sách, không mỗi worker một ngân sách riêng. Token/USD cap không áp dụng cho phiên ChatGPT dùng gói do endpoint hiện tại không đặt được output cap; dùng API key nếu cần các giới hạn đó. Request cap vẫn áp dụng cho mọi kết nối.

Giới hạn per-agent tính cộng dồn trong phiên máy chủ; per-workflow tính riêng từng lượt. Giới hạn vòng sửa chỉ đếm lỗi công cụ/delegation cần sửa; số lượt tinh chỉnh khác vẫn bị chặn bởi request/round/task cap. Không có vòng tự phản biện không giới hạn.

Bảng so sánh nhóm lượt Single/Multi và bật/tắt tối ưu context. Bỏ chọn **Tối ưu context** giữ lịch sử dài hơn và snapshot tool đầy đủ để đo đối chứng. Đây không phải khôi phục toàn bộ bản phần mềm trước nâng cấp. Các lượt khác nội dung/model/ảnh không tạo thành thí nghiệm A/B có kiểm soát. Chưa có số đo token/chi phí thực tế trước nâng cấp và chưa khẳng định một phần trăm tiết kiệm trên tài khoản thật.

## API chính thức và phạm vi xác thực

- OpenAI dùng [Responses/function calling](https://developers.openai.com/api/docs/guides/function-calling) và [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching). Giữ đường [Sign in with ChatGPT cho ứng dụng nguồn mở](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt) hiện có, chỉ dùng quyền được cấp và model tài khoản thực sự cung cấp. Đăng nhập danh tính đơn thuần không đủ quyền chạy AI.
- Google dùng [Gemini generateContent](https://ai.google.dev/api/generate-content?hl=en) với `x-goog-api-key`, `systemInstruction`, `functionDeclarations.parametersJsonSchema` và `functionResponse`. Native parts/thought signatures được giữ nguyên trong lượt gọi công cụ của cùng model. Không đưa state OpenAI sang Gemini hoặc ngược lại.
- Không điều khiển phiên đăng nhập website Gemini, không dùng cookie/session trình duyệt để thay API key. Chưa triển khai Google OAuth/Vertex AI; không giả định tài khoản Gemini web đồng nghĩa quyền hoặc hạn mức Gemini API.
- Key không đi vào prompt, log, response metadata, cache key hoặc localStorage. UI nhập key dạng password và xóa sau gửi; server giữ key trong kho riêng trong RAM. OAuth token do module xác thực quản lý và gia hạn theo đúng account ID. Kho OAuth đã có không được xuất trong bản portable.

## Kiểm thử

```powershell
node tests/test-ai-multi-agent.mjs
node tests/test-ai-agent.mjs
node tests/test-ai-images.mjs
node tests/test-ai-chat.mjs
node tests/test-chatgpt-auth.mjs
node tests/test-ai-studio.mjs
node tests/test-local-launcher.mjs
node tests/test-ai-browser.mjs
```

`test-ai-multi-agent.mjs` kiểm tra một AI, OpenAI điều phối Gemini dùng công cụ pixel thật, payload và chữ ký Gemini nguyên vẹn, dữ liệu frame chính xác, tư vấn song song/cache, fallback, retry, hủy, ngân sách, local router, nén không mất pixel và API quản lý có bảo vệ Origin.

`test-ai-browser.mjs` mở Chrome/Edge headless bằng profile tạm độc lập (có thể chỉ định `CHROME_PATH`), chặn HTTPS ngoài trang test và dùng provider giả lập. Kiểm tra thêm/sửa agent, key được xóa, lệnh local không key, phối hợp hai provider thực sự đi qua editor trong trình duyệt, và giữ pixel khi Orchestrator lỗi cuối lượt. Bỏ qua nếu máy không có Chrome/Edge. Không dùng profile cá nhân hoặc request AI trả phí.

Các bài kiểm thử dùng phản hồi provider giả lập; chưa xác nhận end-to-end bằng tài khoản API thật, mức tiết kiệm tiền thật hoặc chất lượng animation do model thật tạo. Portable packaging đưa đủ các module máy chủ mới vào gói, giữ cách mở Studio cũ. Bản compiler PIX2 độc lập được đồng bộ với sửa đổi alias `cellSize` đã có ở compiler chính để vượt kiểm tra conformance.
