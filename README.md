# CloudLab

Sandbox học AWS chạy hoàn toàn trong trình duyệt. Nội dung là AWS; bố cục mượn từ OpenStack Horizon/Skyline.

Live: https://dat-2k2.github.io/cloudlab/

## Track 1 · AWS Foundations (P0)

| Bài | Nội dung | Lỗi cài sẵn |
|---|---|---|
| 0 · Guardrails | Budget $20 + SNS topic + email subscription | Email chưa xác nhận nên cảnh báo không tới |
| 1 · IAM + STS | Assume role, đọc/ghi S3, policy simulator | Explicit Deny `s3:*Object` chặn cả GetObject |
| 2 · S3 | Block Public Access, bucket policy, presigned URL | Bucket bị public qua `Principal: "*"` |

Mỗi bài: tình huống → thao tác trong console mô phỏng → **Check**. Nhóm nút **Thử** (thanh trên) không tính điểm. Gợi ý mở dần, có **Skip** (làm hộ, không tính đạt), **Undo** và **Reset**.

Event log ghi mọi API call kèm lệnh `aws` CLI tương đương.

## Chạy

Không có build step. Mở `index.html`, hoặc deploy thư mục gốc lên GitHub Pages (workflow `.github/workflows/pages.yml`).

## Cấu trúc

- `index.html`: khung trang
- `style.css`: giao diện (token sáng/tối)
- `app.js`: mock AWS API, state engine, lesson engine, giao diện
- `build.py`: gộp thành một file HTML duy nhất để xem trước

Đây là mô phỏng để học: hành vi được đơn giản hóa và không gọi AWS thật.
