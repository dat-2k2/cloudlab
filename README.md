# CloudLab

IDE hạ tầng AWS chạy hoàn toàn trong trình duyệt: dựng bằng kéo thả hoặc CloudFormation YAML, chạy mô phỏng để thử kết nối, security group, quyền IAM và chi phí, rồi xuất ra CloudFormation, Terraform hoặc CDK. Bài học đi theo workshop FCAJ (First Cloud AI Journey), mỗi bài là một template có lỗi cài sẵn.

Live: https://dat-2k2.github.io/cloudlab/

## IDE

**Thành phần.** Tab Thành phần ở thanh bên (hoặc nút ＋ Thêm / phím `/` để tìm nhanh) có đủ khối cho một hạ tầng cơ bản:

- Mạng & phân phối: VPC, subnet, internet gateway, security group, Application Load Balancer, target group, CloudFront, Route 53
- Compute: EC2, Lambda, API Gateway
- Lưu trữ & database: S3, DynamoDB, RDS, ElastiCache
- Tích hợp: SNS, SQS, EventBridge
- Bảo mật, giám sát, chi phí: IAM role, bucket policy, CloudWatch log group và alarm, AWS Budget
- Bên ngoài AWS: client gửi request, uploader, hộp thư, monitor

"Bắt đầu từ mẫu" có sẵn web 3 tầng (Route 53 → ALB → 2 EC2 → RDS), web tĩnh (CloudFront → S3) và serverless.

**Nối là cấu hình.** Kéo từ chấm bên phải một khối sang khối khác. Nối khối nào sẽ sửa đúng thuộc tính tương ứng:

- ALB → EC2 tạo target group + listener và hỏi có mở security group không
- EC2 → RDS hỏi có thêm rule 3306/5432 từ SG của app không
- EC2 → IAM role tạo instance profile
- Lambda/EC2 → S3, DynamoDB, SNS, SQS hỏi có cấp quyền vào role không

VPC và subnet vẽ thành khung; kéo EC2/RDS vào khung subnet để đặt vào subnet đó.

**Code.** Tab YAML (hoặc Chia đôi) là template CloudFormation của chính canvas, sửa bên nào bên kia cập nhật theo. Cạnh tồn tại vì có `!Ref` / `!GetAtt` / `!Sub`, đúng như template thật. Phần chỉ dành cho mô phỏng nằm trong `Metadata.CloudLab`: traffic bên ngoài (`External`), độ nặng code Lambda (`WorkMs`), cổng app và tài nguyên app gọi tới của EC2 (`AppPort`, `Uses`).

**Xuất.** Tab code có 4 dạng, tải về được:

- CloudFormation (CloudLab), sửa được
- CloudFormation cho AWS, đã bỏ `Metadata.CloudLab`
- Terraform: provider `awscc` theo đúng tên CloudFormation; Route 53 dùng `aws_route53_record`
- AWS CDK v2 (TypeScript): construct L1 `Cfn*`, giữ nguyên logical ID

CloudLab không vẽ route table. Public subnet ở đây là `MapPublicIpOnLaunch` cộng với VPC có IGW gắn vào. Bản xuất có ghi chú cần thêm route table trước khi deploy thật.

**Vấn đề.** Panel Vấn đề kiểm tra template như linter. Một số kiểm tra:

- Tham chiếu tới tài nguyên không tồn tại
- ALB có ít hơn 2 AZ
- Subnet nằm ngoài CIDR của VPC hoặc trùng dải
- Cổng database hay SSH mở cho 0.0.0.0/0
- RDS public, bucket public
- Lambda sẽ timeout, hoặc vòng lặp S3 → Lambda

**Mô phỏng.** Bấm ▶: client bắn request, sự kiện đi theo các cạnh, mỗi bước kiểm tra:

- Security group theo cổng, IP nguồn và SG nguồn
- Subnet public hay private
- Health check của target group
- Sức chịu tải của từng loại EC2/RDS (quá tải trả 5xx)
- Quyền IAM: explicit deny, thiếu Allow, Block Public Access

Cạnh đổi màu theo những gì vừa xảy ra và ghi lý do khi bị chặn. Đồng hồ chi phí cộng dồn theo giá tham khảo ap-southeast-2 (một số theo us-east-1, không tính free tier). Các khoản tính gồm giờ chạy EC2/RDS/ALB, LCU, IPv4 public, request, GB-giây, dung lượng và data ra Internet.

## Bài học theo FCAJ

| # | Workshop | Template | Lỗi cài sẵn |
|---|---|---|---|
| 0 | [000007](https://000007.awsstudygroup.com/) Budgets | API → Lambda có traffic, budget $20, SNS, hộp thư | Chỉ ngưỡng 50% (lab dùng 80/100%); email chưa xác nhận |
| 1 | [000002](https://000002.awsstudygroup.com/) IAM | Lan assume role chỉ-đọc | Deny `s3:*Object` chặn cả GetObject |
| 2 | [000003](https://000003.awsstudygroup.com/) VPC | VPC 10.10.0.0/16, 2 public + 2 private subnet, web + SSH | IGW chưa gắn; SSH mở 0.0.0.0/0; private SG nhận SSH từ Internet |
| 3 | [000048](https://000048.awsstudygroup.com/) EC2 + IAM role | App EC2 ghi vào S3 | Không có instance profile; role `s3:*` trên `*` |
| 4 | [000057](https://000057.awsstudygroup.com/) · [000094](https://000094.awsstudygroup.com/) S3 + CloudFront | Website tĩnh trên S3 | Bucket public, khách đọc thẳng S3, chưa có CloudFront |
| 5 | [000005](https://000005.awsstudygroup.com/) RDS | EC2 → MySQL `fcaj` | DB public, rds-sg mở 3306 cho Internet, một AZ |
| 6 | [000006](https://000006.awsstudygroup.com/) ALB | ALB → 1 t3.micro, 60 req/s | ALB một subnet, quá tải, không HA |
| 7 | [000008](https://000008.awsstudygroup.com/) CloudWatch | API → Lambda, monitor, alarm → email | Role thiếu `logs:*`; timeout 3 s |
| 8 | [000078](https://000078.awsstudygroup.com/) S3 → Lambda | Uploader → bucket → Lambda | Lambda ghi lại vào `incoming/`, vòng lặp tốn tiền |
| 9 | [000079](https://000079.awsstudygroup.com/) API → Lambda → DynamoDB | Book Store API | Role thiếu `dynamodb:PutItem` |
| 10 | [000037](https://000037.awsstudygroup.com/) · [000038](https://000038.awsstudygroup.com/) CloudFormation / CDK | Pipeline sắp gỡ + bucket tạo tay | `DeletionPolicy: Retain`, bucket còn object, bucket ngoài stack |

| 11 | Landing zone · chuẩn bị | Org cũ: OU Legacy + Workloads, 4 account | Billing only; SCP chặn `config:*`; account thiếu execution role, còn Config recorder cũ |
| 12 | Landing zone · enroll theo đợt | Landing zone + OU Security (log archive, audit) | Manifest thiếu audit; app-prod còn recorder cũ; SCP gắn lại lên Legacy |
| 13 | Landing zone · contract | Mọi account đã enroll | Drift; trail riêng ghi log hai nơi; chưa có preventive control |

Ba bài landing zone chuyển từ trang [Brownfield rollout simulator](https://dat-2k2.github.io/landing-zone-sim/) (vẫn giữ nguyên), kèm nguyên tắc, bảng expand–contract, case thực tế và nguồn.

CIDR, tên và cấu hình theo lab gốc. Chỗ nào CloudLab đơn giản hóa thì bài ghi rõ: NAT gateway và traffic đi ra chưa mô phỏng; Auto Scaling group thay bằng instance cố định; RDS dùng db.t3.micro thay vì db.m5.large.

Mỗi khối trong bài có phần **Trong bài này** giải thích nó làm gì trong bối cảnh đó. Nhiệm vụ được chấm trên template và bằng một lần mô phỏng thử. Gợi ý mở dần (triệu chứng → chỗ hỏng → nguyên nhân); có Làm hộ và Reset.

Khung bên phải chia ba tầng: việc cần làm (mục tiêu, nhiệm vụ, Check) → bối cảnh (tình huống, ví dụ trong ngân hàng) → tham khảo (thu gọn). Kéo mép trái của khung để mở rộng; canvas khi đó chỉ để tham khảo. Mỗi thành phần có phần **Hiểu nhanh** giải thích bằng ví dụ ngân hàng.

Mỗi bài có link riêng: `#/lesson/<id>` (ví dụ `#/lesson/vpc`), sandbox là `#/sandbox`.

## Cho Gemini và công cụ đọc web

App vẽ bằng JavaScript, nên công cụ chỉ tải HTML sẽ thấy trang trống. `build.py` chạy `tools/export-text.js` để sinh `llms.txt` (mục lục), `llms-full.txt` (toàn bộ bài học và giải thích thành phần) và `learn.html` (cùng nội dung, HTML tĩnh, có JSON-LD Course). Đưa link `learn.html` cho Gemini là đủ.

### WebMCP

`src/aws/webmcp.js` đăng ký 16 công cụ qua `document.modelContext.registerTool()` (thử cả `navigator.modelContext` của bản Chrome cũ) khi trình duyệt hỗ trợ [WebMCP](https://github.com/webmachinelearning/webmcp): get_state, get_template, get_format_guide, list_lessons, get_lesson, explain_component, open_lesson, open_sandbox, load_template, add_component, connect, set_property, remove_component, run_simulation, check_lesson, export_iac. Trình duyệt chưa hỗ trợ thì không có gì xảy ra. Các công cụ cũng có ở `window.CloudLab.tools` để thử.

## Chạy

Không có build step. Trang tải kit layout từ `../kit/`, nên khi chạy local cần serve một thư mục chứa `cloudlab/` và `kit/` (từ repo dat-2k2.github.io) cạnh nhau. Deploy bằng GitHub Pages, phục vụ tại `/cloudlab/`.

## CloudLab Kubernetes (`k8s/`)

Trang con [`/cloudlab/k8s/`](https://dat-2k2.github.io/cloudlab/k8s/) dùng chung shell (bố cục, canvas, khung bài học, mô phỏng, toàn màn hình, tour) với một domain pack riêng cho Kubernetes:

- `k8s/src/catalog.js`: Namespace, Deployment, StatefulSet, CronJob, Service, Ingress, ConfigMap, Secret, PVC, HPA, NetworkPolicy; client và node pool (mô phỏng); các image app mà registry mô phỏng biết (cổng, health path, thời gian khởi động, memory, CPU mỗi request)
- `k8s/src/edge.js`: Ingress controller (ingress-nginx, AWS Load Balancer Controller), load balancer NLB / Classic, internet-facing / internal, khách từ Internet / mạng nội bộ / pod, giới hạn tốc độ theo IP, Gateway API (Gateway, HTTPRoute có trọng số)
- `k8s/src/rbac.js`: ServiceAccount, Role, ClusterRole, RoleBinding, ClusterRoleBinding, ClusterRole có sẵn (cluster-admin, admin, edit, view), người / pipeline gọi API và kiểm tra quyền như kubectl auth can-i
- `k8s/src/ops.js`: PodDisruptionBudget, nâng cấp node group (cordon, drain theo PDB, thay node), ResourceQuota, LimitRange, DaemonSet, Job, StorageClass
- `k8s/src/views-more.js`: phần giao diện cho các loại trên
- `k8s/src/model.js`: cạnh suy ra theo tên (Ingress → Service, envFrom, claimName, scaleTargetRef), theo label selector và theo tên DNS trong biến môi trường; manifest YAML nhiều tài liệu
- `k8s/src/sim.js`: scheduler theo requests, kubelet (kéo image, cấu hình, probe, OOMKilled, CrashLoopBackOff), rolling update, HPA, cluster autoscaler, Service / Ingress / NetworkPolicy, CronJob, PVC, chi phí EKS
- `k8s/src/lessons.js`, `bank.js`: 14 bài trong bối cảnh Ngân hàng An Phát, có nguồn; mẫu sandbox Internet Banking, database có PVC, canary với Gateway API
- `k8s/src/views.js`, `lint.js`: phần giao diện riêng, panel Vấn đề, xuất manifest cho cluster thật

## Cấu trúc

CloudLab tách làm hai lớp: **shell** (editor, bố cục, khung bài học, đồng hồ mô phỏng, toàn màn hình, tour) không biết gì về AWS, và **domain pack** cho từng nền tảng. Hợp đồng giữa hai lớp (hàm toàn cục và `DOMAIN`) ghi ở [`src/shell/README.md`](src/shell/README.md).

Shell (`src/shell/`):

- `core.js`: tiện ích, state, event log, undo, `DOMAIN` (texts, field types, actions, hooks)
- `model.js`: model dùng chung (`M`: res, ext, manual, pos)
- `sim.js`: đồng hồ, hàng đợi sự kiện, metric, flow, chi phí, probe
- `editor.js`: canvas (node, khung chứa, cạnh, pan/zoom, kéo nối)
- `ui.js`: thanh bên, thư viện thành phần, inspector, code, thanh mô phỏng, bài học, toàn màn hình
- `tour.js`: hướng dẫn lần đầu

AWS pack (`src/aws/`):

- `catalog.js`: thành phần serverless, IAM, giám sát, bên ngoài AWS
- `cfn.js`: CloudFormation: cạnh suy ra từ tham chiếu, quy tắc nối, YAML
- `infra.js`: VPC, subnet, IGW, security group, EC2, ALB, CloudFront, Route 53, RDS, ElastiCache
- `org.js`: Organizations, OU, account, SCP, Control Tower (landing zone, register OU, controls), precheck enroll
- `iam.js`: đánh giá IAM (identity policy, managed policy, bucket policy, BPA)
- `sim.js`: deploy / xóa stack, xử lý sự kiện và request, budget, alarm, giá
- `lessons.js`, `lessons-org.js`, `bank.js`: template mẫu, bài học FCAJ, bài landing zone, bối cảnh ngân hàng
- `eli5.js`: giải thích từng thành phần bằng ví dụ ngân hàng
- `iac.js`: xuất CloudFormation, Terraform, CDK
- `lint.js`: panel Vấn đề
- `views.js`: phần giao diện riêng của AWS (chữ, field, khối trên canvas, panel runtime, nút, đặt vào VPC/subnet/OU)
- `webmcp.js`: công cụ WebMCP cho trợ lý AI của trình duyệt
- `changelog.js`: hộp thoại Có gì mới

Khác:

- `tools/export-text.js`: sinh llms.txt, llms-full.txt, learn.html
- `vendor/js-yaml.min.js`: js-yaml 4.1.0 (MIT)
- `fonts/`: Geist + Geist Mono (SIL OFL)
- `build.py`: gộp thành một file HTML để xem trước

Đây là mô phỏng để học: hành vi và giá được đơn giản hóa, không gọi AWS thật. FCAJ và các workshop thuộc AWS Study Group; CloudLab không liên kết chính thức.
