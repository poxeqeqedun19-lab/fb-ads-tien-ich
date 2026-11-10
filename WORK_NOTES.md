# Ghi chú công việc — Meta Business OS, Phase 0

Ngày: 2026-11-09 (giờ America/Chicago). Ngôn ngữ làm việc: tiếng Việt
với chủ; tài liệu kỹ thuật viết bằng tiếng Anh.

## 1. Các phần việc đã làm

### 1.1. Nâng cấp định hướng (09/11 19:31)
- Từ ý ban đầu "tạo tiện ích tải lên Google Chrome" và "Meta Ads
  Assistant" (chỉ kiểm tra tài khoản quảng cáo), chủ nâng cấp thành
  **Meta Business OS** — nền tảng quản lý Marketing toàn diện trên
  hệ sinh thái Meta, 12 module A–L, roadmap Phase 0–10, MVP là
  Phase 1–5.
- Nguyên tắc chốt: AI phải giúp thực hiện công việc (tạo bài, lập
  lịch, đề xuất phản hồi, phân loại, phân tích, tạo nhiệm vụ), không
  chỉ trả lời câu hỏi.

### 1.2. Phase 0 — 10 tài liệu, không code (09/11 19:33–19:40)
- Đủ 10 tài liệu, 61.541 từ: Product Requirements, Feature Matrix,
  Meta API Feasibility, System Architecture, Database Design,
  AI Agent Architecture, Security Requirements, Development Roadmap,
  MVP Definition, Acceptance Criteria.
- 64 tính năng, 34 cái thuộc MVP. Kiến trúc modular monolith, 23
  entity, 10 agent AI (tự chủ tối đa L2, không tự duyệt việc của mình).
- Đã rà soát chéo và sửa 3 mâu thuẫn: WhatsApp không nằm trong MVP,
  J-core (roles/approval/audit) thuộc MVP, agent hỗ trợ khách hàng
  chỉ làm WhatsApp từ Phase 10.

### 1.3. Xác minh khả thi API — lần 1: THẤT BẠI (09/11)
- Đọc trực tiếp developers.facebook.com đều HTTP 403; tìm kiếm chỉ
  ra nguồn thứ ba, không dùng làm bằng chứng.
- Kết quả: 0 trang chính thức đọc được, cả 64 tính năng NOT_VERIFIED.
  Tài liệu khả thi lúc này là danh sách 26 mục cần đọc lại (V-00–V-25),
  chưa phải giấy thông hành để xây Phase 1.

### 1.4. Xác minh lại bằng trình duyệt live (09/11 19:51–19:54)
- Mở bằng trình duyệt desktop thật (không đăng nhập, không CAPTCHA):
  cả 4 trang chính thức đều tải được — lỗi 403 là giới hạn của công
  cụ đọc trang, không phải Meta chặn.
- Đã xác minh 4/26 mục (V-00, V-07, V-08, V-10): luồng đăng Instagram
  (container → publish), giới hạn WhatsApp Cloud API, chính sách nhắn
  tin Messenger/IG (cửa sổ 24h, 7 ngày sau quảng cáo Click-to-
  Messenger/Direct, Human Agent 7 ngày), đăng Page Feed trên Graph
  API v27.0 (lên lịch 10 phút–75 ngày).
- Sửa sai quan trọng: carousel Instagram tối đa **20 mục, không phải
  10**. Mâu thuẫn chưa giải: 100 vs 50 bài/24h trên cùng một trang.
  Phiên bản API chốt v27.0.
- Còn 22/26 mục NOT_VERIFIED. Tài liệu khả thi gốc KHÔNG sửa; kết
  quả lưu ở `docs/META_API_REVERIFICATION_2026-11-10.md`.

### 1.5. Chủ duyệt Phase 0 như hiện tại (09/11 20:09)
- Chủ duyệt bộ tài liệu + phụ lục xác minh ở trạng thái hiện tại,
  chấp nhận giới hạn 22/26 NOT_VERIFIED. Biên bản:
  `docs/APPROVAL_PHASE0.md`.
- Duyệt tài liệu KHÔNG đồng nghĩa duyệt viết code Phase 1 — Phase 1
  vẫn cần lệnh bắt đầu riêng.

### 1.6. Đưa lên GitHub (09/11 20:10–20:14)
- Repo lưu trữ do chủ chỉ định:
  https://github.com/poxeqeqedun19-lab/fb-ads-tien-ich
  (public, lúc chỉ định đang trống, 0 commit, nhánh mặc định main).
- GitHub connector đã kết nối (tài khoản poxeqeqedun19-lab), kiểm tra
  chạm tới được repo. Chủ chọn repo trong phần cài đặt GitHub App
  rồi đồng ý đẩy.
- Đợt đẩy đầu tiên: README.md + WORK_NOTES.md + toàn bộ 12 file
  trong `docs/` (10 tài liệu Phase 0 + phụ lục xác minh lại +
  biên bản duyệt), lên nhánh main.

## 2. Mục tiêu hoàn thiện từng phần

| Phần việc | Mục tiêu hoàn thiện | Trạng thái |
|---|---|---|
| Định hướng sản phẩm | Chốt tên Meta Business OS, 12 module, MVP Phase 1–5, không tích hợp Google Ads | Xong |
| 10 tài liệu Phase 0 | Đủ 10 file, khớp nhau về module/phase/MVP, mỗi phase có scope + test + demo + giới hạn | Xong, đã duyệt |
| Xác minh API lần 1 | Mọi capability phải có nguồn chính thức, không bịa | Xong — kết quả là THẤT BẠI, ghi rõ NOT_VERIFIED |
| Xác minh lại bằng browser | Đọc được trang chính thức, sửa các con số sai | Xong một phần: 4/26 |
| Duyệt Phase 0 | Chủ duyệt bộ tài liệu như hiện tại | Xong 20:09 |
| Đưa lên GitHub | Toàn bộ tài liệu Phase 0 có mặt trên repo, kiểm lại được bằng commit | Đang làm (đợt đẩy này) |

## 3. Việc chưa xong / rủi ro còn mở

- **22/26 mục API vẫn NOT_VERIFIED** (Ads, Insights, đường đăng
  nhập, App Review/Business Verification, template và giá WhatsApp,
  CAPI, webhook, changelog, giới hạn Reels/Stories, danh sách tag
  tin nhắn đầy đủ). Không cam kết Phase 1 cho các mục này cho tới
  khi xác minh xong.
- **Mâu thuẫn 100 vs 50 bài Instagram/24h** chưa giải được.
- **Câu hỏi còn mở (PRD Q1–Q15):** khách hàng đầu tiên là doanh
  nghiệp đơn lẻ hay agency; ai sở hữu Meta app và Business
  Verification; chọn nhà cung cấp AI nào; thời gian lưu trữ dữ liệu,
  mô hình giá, và các mục kiến trúc/bảo mật NC-01–NC-18.
- **Phase 1 chưa bắt đầu** — cần lệnh riêng của chủ.

## 4. Bước tiếp theo (chờ chủ chọn)

1. Xác minh nốt 22 mục API còn lại bằng trình duyệt live, rồi mới
   quyết Phase 1; hoặc
2. Bắt đầu Phase 1 (Core Platform & Meta OAuth) với phạm vi đã biết
   là chưa xác minh hết; hoặc
3. Tạm dừng ở Phase 0.
