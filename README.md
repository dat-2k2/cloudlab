# CloudLab

Sandbox học AWS chạy hoàn toàn trong trình duyệt. Nội dung là AWS; bố cục mượn từ OpenStack Horizon/Skyline.

Live: https://dat-2k2.github.io/cloudlab/

## Track 1 · AWS Foundations (P0 + P1)

| Bài | Nội dung | Lỗi cài sẵn |
|---|---|---|
| 0 · Guardrails | Budget $20 + SNS topic + email subscription | Email chưa xác nhận nên cảnh báo không tới |
| 1 · IAM + STS | Assume role, đọc/ghi S3, policy simulator | Explicit Deny `s3:*Object` chặn cả GetObject |
| 2 · S3 | Block Public Access, bucket policy, presigned URL | Bucket bị public qua `Principal: "*"` |
| 3 · Lambda + Logs | Invoke, execution role, CloudWatch Logs, memory/timeout | Role thiếu quyền `logs:*` nên log mất im lặng; timeout 3s |
| 4 · S3 → Lambda | Event notification, prefix/suffix filter, biến môi trường | Lambda ghi lại vào `incoming/` gây vòng lặp |
| 5 · CDK | `cdk deploy` / `cdk destroy`, removalPolicy, CloudFormation | Bucket mặc định RETAIN; bucket tạo tay nằm ngoài stack |

Mỗi bài: tình huống → thao tác trong console mô phỏng → **Check**. Nhóm nút **Thử** (thanh trên) không tính điểm. Gợi ý mở dần, có **Skip** (làm hộ, không tính đạt), **Undo** và **Reset**.

Event log ghi mọi API call kèm lệnh `aws` CLI tương đương.

## Giao diện

Component và type theo UI kit của dat-2k2.github.io (Figma). Bảng màu v2: nền slate, accent indigo, mỗi nhóm dịch vụ một màu riêng (Chi phí teal, Thông báo hồng, Bảo mật tím, Lưu trữ xanh dương, Compute xanh lá mạ, Giám sát fuchsia, IaC slate); màu trạng thái (ok/cảnh báo/lỗi) không dùng cho nhóm dịch vụ. Đủ tương phản WCAG AA ở cả sáng và tối. Font Geist 1.8 tự host trong `fonts/` (có đủ dấu tiếng Việt), giấy phép SIL OFL trong `fonts/OFL.txt`.

## Chạy

Không có build step. Mở `index.html`, hoặc deploy thư mục gốc lên GitHub Pages (workflow `.github/workflows/pages.yml`).

## Cấu trúc

- `index.html`: khung trang
- `style.css`: giao diện (token sáng/tối)
- `app.js`: mock AWS API, state engine, lesson engine, giao diện
- `fonts/`: Geist + Geist Mono (variable, woff2)
- `build.py`: gộp thành một file HTML duy nhất để xem trước (font nhúng base64)

Đây là mô phỏng để học: hành vi được đơn giản hóa và không gọi AWS thật.
