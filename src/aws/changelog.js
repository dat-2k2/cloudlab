"use strict";
/* "Có gì mới": the app's features and updates grouped by big feature (from the repo history on GitHub,
   dat-2k2/cloudlab), newest first inside each group. CHANGELOG_VERSION changes whenever entries are added: the
   top-bar button shows a dot until the viewer opens the dialog (seen flag in localStorage cloudlab:news). */
const CHANGELOG_VERSION="2026-10-22a";
const CHANGELOG=[
  {id:"gcp",icon:"G",title:"Google Cloud, messaging và giá",sum:"Trang mới cho Google Cloud viết bằng Terraform, thêm Kafka, Redis, RabbitMQ, WebSocket cho cả AWS lẫn Google Cloud, và giá niêm yết trên từng khối.",items:[
    ["22/10","Trang mới cloudlab/gcp: viết Terraform (provider google) hoặc kéo thả; Cloud Run, Memorystore (Redis, Valkey), Managed Kafka, RabbitMQ / Redis / Kafka tự cài trên VM, WebSocket trên Cloud Run, Pub/Sub, budget. 7 bài, xoay quanh việc học bằng $300 credit dùng thử mà không đốt hết."],
    ["22/10","Credit dùng thử dưới đồng hồ chi phí: còn bao nhiêu, đủ bao nhiêu ngày theo mức tiêu hiện tại; hết credit hoặc hết 90 ngày thì tài nguyên dừng, như tài khoản thật. Budget mặc định trừ credit nên không báo: bài 1 dạy cách sửa."],
    ["22/10","AWS: thêm Amazon MSK (có broker và Serverless), ElastiCache Serverless (Valkey / Redis OSS), Amazon MQ for RabbitMQ, API Gateway WebSocket; 2 bài mới (bảng tỷ giá realtime, hàng đợi lệnh)."],
    ["22/10","Mỗi khối hiện giá niêm yết $/giờ và $/tháng ngay khi thêm vào, trước cả khi chạy; khung chi tiết tách phần cố định và phần theo lượng dùng. Trang So sánh giá: bốn dịch vụ trên AWS, Google Cloud và tự cài, kèm tính $300 đủ bao nhiêu ngày. Giá đọc từ trang giá chính thức ngày 22/10/2026."]]},
  {id:"k8s",icon:"☸",title:"CloudLab Kubernetes",sum:"Cùng giao diện, cho Kubernetes: kéo thả Deployment, Service, Ingress… hoặc viết manifest, rồi xem pod lên và request đi qua.",items:[
    ["20/10","Trang Kubernetes có bản văn bản (k8s/learn.html, llms.txt) với hướng dẫn nhờ Gemini viết manifest, và nút ✦ WebMCP: trợ lý AI của trình duyệt mở manifest, chạy mô phỏng, kiểm tra bài."],
    ["20/10","Thêm 17 loại tài nguyên: Ingress controller (ingress-nginx, AWS Load Balancer Controller), load balancer NLB / Classic, internet-facing / internal, giới hạn tốc độ theo IP, Gateway API (Gateway, HTTPRoute, canary theo trọng số), RBAC (ServiceAccount, Role, ClusterRole, RoleBinding, ClusterRoleBinding), PodDisruptionBudget, ResourceQuota, LimitRange, DaemonSet, Job, StorageClass."],
    ["20/10","4 bài mới: chặn bot gửi OTP (giới hạn tốc độ), hạn mức cho từng khối (ResourceQuota), nâng cấp node không gián đoạn (PodDisruptionBudget), quyền tối thiểu cho pipeline và kiểm toán (RBAC). Nâng cấp node group mô phỏng drain từng node như EKS."],
    ["20/10","Trang mới cloudlab/k8s: 10 bài đầu trong bối cảnh Ngân hàng An Phát (pod không chạy, Service không có endpoint, probe, Ingress, requests / limits, HPA ngày lương về, Secret, NetworkPolicy cho vùng dữ liệu thẻ, PVC, CronJob đối soát)."],
    ["20/10","Mô phỏng cluster: xếp pod theo requests, kéo image, probe, CrashLoopBackOff, OOMKilled, rolling update, HPA, cluster autoscaler, NetworkPolicy, DNS giữa namespace, chi phí EKS theo giờ."]]},
  {id:"editor",icon:"⊞",title:"Editor hạ tầng kéo thả",sum:"Dựng hạ tầng AWS như vẽ sơ đồ: mỗi khối là một thành phần thật, mỗi mũi tên là một cấu hình thật.",items:[
    ["20/10","Chế độ toàn màn hình (nút ⤢ hoặc phím F): sơ đồ phủ màn hình, công cụ và phần giải thích nổi phía trên."],
    ["20/10","Cuộn chuột để phóng to / thu nhỏ tại vị trí con trỏ; Shift + cuộn để kéo ngang."],
    ["20/10","Thư viện thành phần nằm cạnh canvas (＋ Thành phần hoặc phím /): tìm kiếm, mẫu dựng sẵn, kéo thả hoặc bấm để thêm."],
    ["20/10","Kéo thành phần thả vào canvas hoạt động lại trên mọi trình duyệt, kể cả màn hình cảm ứng."],
    ["20/10","Kéo EC2 hoặc RDS vào VPC chưa có subnet: CloudLab tự tạo subnet với dải IP không trùng."],
    ["20/10","API Gateway nối được tới EC2 và load balancer (HTTP integration); nối không hợp lệ thì hiện lý do ngay trên canvas."],
    ["20/10","Thành phần mạng: VPC, subnet, internet gateway, security group, load balancer, CloudFront, Route 53, RDS, ElastiCache; VPC và subnet vẽ thành khung."],
    ["20/10","Editor tự do kiểu draw.io với mẫu: web 3 tầng, website tĩnh, serverless."],
    ["18/10","Sơ đồ tài nguyên: khối có trạng thái, mũi tên theo loại quan hệ, kéo để nối, Trace, chế độ danh sách."]]},
  {id:"sim",icon:"▶",title:"Mô phỏng và chi phí",sum:"Bấm Chạy để thấy hệ thống hoạt động: request đi đâu, bị chặn ở đâu, tốn bao nhiêu tiền.",items:[
    ["20/10","Mô phỏng security group theo cổng, IP nguồn và SG nguồn; subnet public/private; health check; sức chịu tải từng loại máy (quá tải trả 5xx)."],
    ["20/10","Bảng Vấn đề kiểm tra cấu hình như một người soát hồ sơ: cổng database mở ra Internet, load balancer một AZ, bucket public…"],
    ["20/10","Đồng hồ chi phí cộng dồn theo giá tham khảo: giờ chạy máy, load balancer, IPv4 public, request, dung lượng."],
    ["20/10","Xóa stack giải thích rõ template vẫn còn; có tùy chọn xóa luôn các khối khỏi canvas."],
    ["20/10","Mô phỏng IAM: explicit deny, thiếu quyền, Block Public Access; sự kiện S3 → Lambda, vòng lặp tốn tiền."]]},
  {id:"lessons",icon:"◎",title:"Bài học",sum:"Mỗi bài là một hệ thống có lỗi cài sẵn: sửa, bấm Kiểm tra, rồi hiểu vì sao.",items:[
    ["20/10","Mọi bài đặt trong bối cảnh một ngân hàng (Ngân hàng An Phát): tình huống, sự cố thật và quy định liên quan (Thông tư NHNN, PCI DSS), câu hỏi thảo luận."],
    ["20/10","Mỗi thành phần có phần Hiểu nhanh, giải thích bằng ví dụ ngân hàng."],
    ["20/10","Khung bài học chia ba tầng: việc cần làm → bối cảnh → tham khảo; kéo mép để mở rộng khung đọc."],
    ["20/10","Ba bài landing zone (Control Tower, enroll theo đợt, drift) chuyển từ trang Brownfield rollout simulator."],
    ["20/10","Lộ trình theo workshop FCAJ (First Cloud AI Journey): Budgets, IAM, VPC, EC2 role, S3 + CloudFront, RDS, load balancer, CloudWatch, S3 → Lambda, API → DynamoDB, CloudFormation."],
    ["17/10","Ra mắt với các bài đầu tiên: Budgets + SNS, IAM + STS, S3, Lambda + Logs, S3 → Lambda, CDK."]]},
  {id:"code",icon:"{ }",title:"Code và xuất hạ tầng",sum:"Sơ đồ cũng là code: sửa bên nào bên kia cập nhật theo, rồi mang đi deploy thật.",items:[
    ["20/10","Dán template YAML (từ Gemini hoặc file của bạn) để mở ngay trong sandbox; lỗi YAML báo đúng dòng."],
    ["20/10","Xuất ra CloudFormation, Terraform hoặc AWS CDK (TypeScript)."],
    ["20/10","Tab YAML là CloudFormation của chính sơ đồ, đồng bộ hai chiều."]]},
  {id:"ai",icon:"✦",title:"Dùng cùng trợ lý AI",sum:"Mô phỏng tình huống của riêng bạn với Gemini hoặc trợ lý AI trong trình duyệt.",items:[
    ["20/10","Nút ✦ trên thanh trên cùng: hướng dẫn bật WebMCP và trạng thái trong trình duyệt của bạn."],
    ["20/10","WebMCP: trợ lý AI của trình duyệt dùng 16 công cụ của CloudLab để đọc sơ đồ, dựng template, chạy mô phỏng, kiểm tra bài."],
    ["20/10","Hướng dẫn và câu lệnh mẫu để nhờ Gemini viết template cho tình huống của bạn; bảng Vấn đề báo thuộc tính không được hỗ trợ."],
    ["20/10","Bản văn bản (learn.html, llms.txt) để Gemini và công cụ đọc web đọc được toàn bộ bài học."]]},
  {id:"ux",icon:"☰",title:"Dễ dùng hơn",sum:"Những thay đổi nhỏ giúp người mới bắt đầu nhanh và không lạc.",items:[
    ["20/10","Hộp thoại Có gì mới (chính là hộp thoại này)."],
    ["20/10","Hướng dẫn sử dụng lần đầu, xem lại bằng nút ?."],
    ["20/10","Mỗi bài có link riêng (#/lesson/…) để chia sẻ; thanh bên trái chỉ còn lộ trình, thu gọn được."],
    ["20/10","Viết lại toàn bộ chữ trên giao diện: một thuật ngữ cho một khái niệm, lỗi nói rõ cách sửa."],
    ["20/10","Trang Nguồn và bản quyền ghi công các nguồn tham khảo."],
    ["17/10","Giao diện theo bộ UI kit của dat-2k2.github.io, chế độ sáng / tối, dùng được trên điện thoại."]]}];
(function(){
  const KEY="cloudlab:news";
  const seen=()=>{try{return localStorage.getItem(KEY)===CHANGELOG_VERSION}catch(_){return true}};
  const mark=()=>{try{localStorage.setItem(KEY,CHANGELOG_VERSION)}catch(_){}};
  const dot=()=>{const b=document.getElementById("newsBtn");if(b)b.toggleAttribute("data-new",!seen())};
  function openNews(){const latest=[...new Set(CHANGELOG.flatMap(g=>g.items.map(i=>i[0])))][0];
    UI.modal={title:"Có gì mới trong CloudLab",cancel:"Đóng",init:{},fields:[],wide:true,
      body:`<p class="news-lead">Các tính năng chính, nhóm theo chủ đề. Mục mới nhất ở đầu mỗi nhóm. Cập nhật gần nhất: ${esc(latest)}/2026 · <a href="https://github.com/dat-2k2/cloudlab/commits/main" target="_blank" rel="noopener">lịch sử trên GitHub ↗</a></p>
      <div class="news">${CHANGELOG.map(g=>`<section class="news-g"><h3><span class="side-ic" aria-hidden="true">${esc(g.icon)}</span>${esc(g.title)}</h3><p class="news-sum">${esc(g.sum)}</p>
        <ul>${g.items.map(([d,t])=>`<li><span class="news-d">${esc(d)}</span><span>${esc(t)}</span></li>`).join("")}</ul></section>`).join("")}</div>`};
    mark();dot();render()}
  document.addEventListener("click",e=>{if(e.target.closest&&e.target.closest("#newsBtn,[data-news]")){e.preventDefault();openNews()}});
  window.addEventListener("hashchange",()=>{if(location.hash==="#/changelog")openNews()});
  if(location.hash==="#/changelog")setTimeout(openNews,0);
  dot();
})();
