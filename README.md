# CloudLab

Node editor AWS chạy hoàn toàn trong trình duyệt: dựng hạ tầng bằng kéo thả hoặc bằng CloudFormation YAML, rồi chạy mô phỏng để thử kết nối, quyền IAM và chi phí theo thời gian thực. Mỗi bài học là một template dựng sẵn có lỗi cài sẵn.

Live: https://dat-2k2.github.io/cloudlab/

## Ba phần

**1. Editor tự do.** Canvas giống draw.io nhưng mỗi khối là một thành phần AWS thật: API Gateway, Lambda, S3, DynamoDB, SNS, SQS, EventBridge schedule, IAM role, bucket policy, CloudWatch log group và alarm, AWS Budget. Kéo từ thanh bên vào canvas, kéo từ chấm bên phải một khối sang khối khác để nối (hoặc bấm chấm đó / phím C). Nối khối nào với khối nào sẽ sửa đúng thuộc tính tương ứng, ví dụ Lambda → bucket thêm biến `OUTPUT_BUCKET: !Ref …` và hỏi có cấp `s3:PutObject` vào role không.

**2. Viết bằng code.** Tab YAML (hoặc Chia đôi) là template CloudFormation của chính canvas, sửa bên nào bên kia cập nhật theo. Quan hệ không lưu riêng: một cạnh tồn tại vì có `!Ref` / `!GetAtt` / `!Sub "${X}"`, đúng như template thật. Tài nguyên bên ngoài AWS (client, uploader, hộp thư, monitor) nằm trong `Metadata.CloudLab.External`; độ nặng của code Lambda ở `Metadata.CloudLab.WorkMs` của function.

**3. Mô phỏng.** Bấm ▶: nguồn tạo tải (Client request/giây, Uploader file/giờ, EventBridge schedule) bắn sự kiện, sự kiện đi theo các cạnh. Mỗi bước kiểm tra cấu hình (timeout, filter, subscription đã xác nhận…) và quyền IAM (explicit deny, thiếu Allow, Block Public Access). Cạnh đổi màu theo những gì vừa xảy ra: chạy, ✕ bị chặn kèm lý do, ↻ vòng lặp. Hộp thư nhận email từ SNS, Monitor vẽ số liệu của tài nguyên nối vào. Đồng hồ chi phí cộng dồn theo tháng theo giá tham khảo ap-southeast-2 (một số theo us-east-1, không tính free tier); tốc độ từ 1 giây/giây tới 1 ngày/giây.

Stack: Deploy / Xóa stack theo đúng CloudFormation — `DeletionPolicy: Retain` giữ bucket lại, bucket còn object thì `DELETE_FAILED`, tài nguyên tạo tay nằm ngoài stack.

## Bài học (template)

| Bài | Template | Lỗi cài sẵn |
|---|---|---|
| 0 · Budgets + SNS | API → Lambda có traffic thật, budget $20, topic, hộp thư | Chỉ có ngưỡng 50%; email chưa xác nhận |
| 1 · IAM + STS | Lan assume role chỉ-đọc để đọc bucket | Deny `s3:*Object` chặn cả GetObject |
| 2 · S3 | Bucket chia sẻ, người lạ và Lan | Bucket policy `Principal: "*"`, BPA tắt |
| 3 · Lambda + CloudWatch | API → Lambda, monitor, alarm → email | Role thiếu `logs:*`; timeout 3 s |
| 4 · S3 → Lambda | Uploader → bucket → Lambda | Lambda ghi lại vào `incoming/` → vòng lặp, chi phí tăng không dừng |
| 5 · CloudFormation | Pipeline sắp gỡ + bucket tạo tay | `DeletionPolicy: Retain`, bucket còn object, bucket ngoài stack |

Mỗi khối trong bài có phần **Trong bài này** giải thích nó làm gì trong bối cảnh đó. Nhiệm vụ được chấm trên template và bằng một lần mô phỏng thử; gợi ý mở dần (triệu chứng → chỗ hỏng → nguyên nhân), có Làm hộ và Reset.

## Chạy

Không có build step. Trang tải kit layout từ `../kit/`, nên khi chạy local cần serve một thư mục chứa `cloudlab/` và `kit/` (từ repo dat-2k2.github.io) cạnh nhau. Deploy bằng GitHub Pages (`.github/workflows/pages.yml`), phục vụ tại `/cloudlab/`.

## Cấu trúc

- `index.html`: khung trang (kit shell)
- `src/core.js`: hằng số, tiện ích, event log, undo
- `src/catalog.js`: danh mục thành phần (type, thuộc tính mặc định, field của inspector, quan hệ)
- `src/model.js`: template model, cạnh suy ra từ tham chiếu, quy tắc nối, đọc/ghi YAML
- `src/iam.js`: đánh giá IAM (identity policy, managed policy, bucket policy, BPA)
- `src/sim.js`: deploy / xóa stack, mô phỏng sự kiện, metric, chi phí, budget, alarm
- `src/lessons.js`: các template bài học
- `src/editor.js`: canvas (node, cạnh, pan/zoom, kéo nối, danh sách)
- `src/ui.js`: thanh bên, inspector, YAML, thanh mô phỏng, bài học, sự kiện
- `vendor/js-yaml.min.js`: js-yaml 4.1.0 (MIT)
- `fonts/`: Geist + Geist Mono (SIL OFL)
- `build.py`: gộp thành một file HTML để xem trước

Đây là mô phỏng để học: hành vi và giá được đơn giản hóa, không gọi AWS thật.
