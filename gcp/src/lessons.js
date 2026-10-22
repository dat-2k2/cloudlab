"use strict";
/* GCP pack · lessons. Each is a Terraform configuration with a planted problem, set in the same fictional bank (Ngân hàng An
   Phát) and around one goal: learn Kafka, Redis, RabbitMQ and WebSocket on Google Cloud with the $300 free-trial credit,
   without burning it. Tasks are checked against the configuration and a simulation run on a throw-away copy. */
const first=t=>allNodes().find(n=>n.type===t);
const clientNamed=nm=>allNodes().find(n=>n.type==="cloudlab_client"&&tfName(n)===nm)||null;
const okShare=n=>{if(!n)return 0;const m=(RT.n[n.id]||{m:{}}).m,t=(m.ok||0)+(m.err||0);return t?(m.ok||0)/t:0};
const wsOk=n=>{const c=RT.cl[n&&n.id]||{};return(+((n&&n.props.connections)||0))>0&&(c.open||0)>=+n.props.connections&&!c.rej};
/* run the project forward on a copy: apply if needed, then sec seconds in steps of st */
const gRun=(sec,fn,st)=>probe(()=>{if(!stackUp())deploy();RT.q=[];for(const k in RT.n)RT.n[k]={cost:0,m:{},tk:{},series:[],last:null};RT.flow={};RT.why={};const t0=RT.total;let t=0;const s=st||10;while(t<sec){step(Math.min(s,sec-t));t+=s}RT.runCost=RT.total-t0;return fn()});
const monthly=id=>{const n=typeof id==="string"?nodeOf(id):id;return n?gcpPrice(n).h*HOURS_MO:0};
const fixedMonthly=()=>allNodes().filter(n=>!n.ext).reduce((a,n)=>a+gcpPrice(n).h,0)*HOURS_MO;
function ladder(steps,i){const s=steps.find(x=>!x[0]());if(!s)return"Cấu hình đã đúng. Bấm ▶ Chạy thêm một lúc rồi bấm Kiểm tra lại.";const m=s[1];return m[Math.min(i,m.length-1)]}
const solveLog=msg=>log("Bài học","lesson","solve",msg,"ok");
const NET=(cidr)=>`
resource "google_compute_network" "main" {
  name                    = "anphat-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "app" {
  name          = "app"
  ip_cidr_range = "${cidr||"10.10.0.0/24"}"
  region        = "asia-southeast1"
  network       = google_compute_network.main.id
}
`;
const SA=(name)=>`
resource "google_service_account" "${name}" {
  account_id   = "${name.replace(/_/g,"-")}"
  display_name = "${name}"
}
`;
const PUBLIC=(svc)=>`
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.${svc}.name
  location = "asia-southeast1"
  role     = "roles/run.invoker"
  member   = "allUsers"
}
`;
const INBOX=`
resource "cloudlab_inbox" "me" {
  address = "${EMAIL}"
}
`;
const RUN=(name,{env,egress,sa,extra,conc,min,max,timeout,ws,deps}={})=>`
resource "google_cloud_run_v2_service" "${name}" {
  name                = "${name.replace(/_/g,"-")}"
  location            = "asia-southeast1"
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false${ws?`
  labels              = { protocol = "websocket" }`:""}
${extra||""}
  template {${sa?`
    service_account                  = google_service_account.${sa}.email`:""}
    max_instance_request_concurrency = ${conc||80}
    timeout                          = "${timeout||"300s"}"

    scaling {
      min_instance_count = ${min||0}
      max_instance_count = ${max||20}
    }

    containers {
      image = "asia-southeast1-docker.pkg.dev/anphat-lab/app/${name.replace(/_/g,"-")}:1.0"

      resources {
        limits = { cpu = "1", memory = "512Mi" }
      }${(env||[]).map(([k,v])=>`

      env {
        name  = "${k}"
        value = "${v}"
      }`).join("")}
    }${egress?`

    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"

      network_interfaces {
        network    = google_compute_network.main.id
        subnetwork = google_compute_subnetwork.${egress}.id
      }
    }`:""}
  }
}
`;
const CLIENT=(name,target,body)=>`
resource "cloudlab_client" "${name}" {
  target = ${target}
${body||"  rate_per_second = 20"}
}
`;
const head=(title)=>`# CloudLab GCP · ${title}
terraform {
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
  }
}

provider "google" {
  project = var.project_id
  region  = "asia-southeast1"
}

variable "project_id" {
  type    = string
  default = "anphat-lab"
}
`;

/* ---------------- sandbox starters ---------------- */
const STARTER={id:"api",title:"API công khai trên Cloud Run",tag:"Cloud Run + allUsers",desc:"Một API chạy trên Cloud Run, công khai cho khách, có budget gửi cảnh báo về hộp thư.",
  yaml:head("sandbox · API công khai trên Cloud Run")+RUN("api")+PUBLIC("api")+`
resource "google_monitoring_notification_channel" "email" {
  display_name = "Email của tôi"
  type         = "email"
  labels       = { email_address = "${EMAIL}" }
}

resource "google_billing_budget" "credit" {
  billing_account = "${BILLING}"
  display_name    = "credit-300"

  amount {
    specified_amount {
      currency_code = "USD"
      units         = "100"
    }
  }

  budget_filter {
    projects               = ["projects/anphat-lab"]
    credit_types_treatment = "EXCLUDE_ALL_CREDITS"
  }

  threshold_rules {
    threshold_percent = 0.5
  }

  threshold_rules {
    threshold_percent = 0.9
  }

  all_updates_rule {
    monitoring_notification_channels = [google_monitoring_notification_channel.email.id]
  }
}
`+CLIENT("customers","google_cloud_run_v2_service.api.uri","  rate_per_second = 20")+INBOX,
  layout:{"client/customers":[40,80],"inbox/me":[40,420],"invoker/public":[380,300],"run/api":[380,60],"budget/credit":[720,60],"channel/email":[720,320]}};
const STACK={id:"stack4",title:"Kafka, Redis, RabbitMQ, WebSocket (rẻ)",tag:"Đủ 90 ngày với $300",desc:"Bản rẻ để học cả bốn: Redis tự cài, RabbitMQ trên e2-small, Pub/Sub thay Kafka managed, WebSocket trên Cloud Run concurrency 1000.",
  yaml:head("sandbox · bốn dịch vụ, bản rẻ để học")+NET()+`
resource "google_compute_firewall" "amqp_from_app" {
  name          = "amqp-from-app"
  network       = google_compute_network.main.name
  source_ranges = ["10.10.0.0/24"]
  target_tags   = ["rabbitmq", "redis"]

  allow {
    protocol = "tcp"
    ports    = ["5672", "6379"]
  }
}

resource "google_compute_instance" "rabbitmq" {
  name         = "rabbitmq-1"
  machine_type = "e2-small"
  zone         = "asia-southeast1-a"
  tags         = ["rabbitmq"]
  labels       = { app = "rabbitmq" }
  metadata_startup_script = <<-EOT
    apt-get update
    apt-get install -y rabbitmq-server
  EOT

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 20
      type  = "pd-balanced"
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.app.id
  }
}

resource "google_compute_instance" "redis" {
  name         = "redis-1"
  machine_type = "e2-micro"
  zone         = "asia-southeast1-a"
  tags         = ["redis"]
  labels       = { app = "redis" }

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 10
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.app.id
  }
}

resource "google_pubsub_topic" "trades" {
  name = "trades"
}
`+SA("api")+`
resource "google_project_iam_member" "api_pubsub" {
  project = "anphat-lab"
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:\${google_service_account.api.email}"
}
`+RUN("api",{sa:"api",egress:"app",env:[["AMQP_URL","amqp://${google_compute_instance.rabbitmq.network_interface[0].network_ip}:5672"],["REDIS_HOST","${google_compute_instance.redis.network_interface[0].network_ip}"],["PUBSUB_TOPIC","${google_pubsub_topic.trades.id}"]]})+PUBLIC("api")+
  RUN("prices",{ws:true,conc:1000,timeout:"3600s",max:5,egress:"app",env:[["REDIS_HOST","${google_compute_instance.redis.network_interface[0].network_ip}"]]})+`
resource "google_cloud_run_v2_service_iam_member" "prices_public" {
  name     = google_cloud_run_v2_service.prices.name
  location = "asia-southeast1"
  role     = "roles/run.invoker"
  member   = "allUsers"
}
`+CLIENT("orders","google_cloud_run_v2_service.api.uri","  rate_per_second = 30")+CLIENT("board","google_cloud_run_v2_service.prices.uri",`  protocol            = "websocket"
  connections         = 2000
  messages_per_minute = 12`),
  layout:{"client/orders":[40,80],"client/board":[40,560],"invoker/public":[380,330],"invoker/prices_public":[380,820],"run/api":[380,60],"run/prices":[380,560],"sa/api":[720,1000],"iam/api_pubsub":[1060,1000],
    "vpc/main":[720,40],"subnet/app":[760,110],"vm/rabbitmq":[790,170],"vm/redis":[1090,170],"fw/amqp_from_app":[790,560],"pubsub/trades":[1500,80]}};
const STARTERS={api:STARTER,stack4:STACK};

/* ---------------- lessons ---------------- */
const L_CREDIT={id:"credit",phase:"Chi phí",step:1,title:"Cảnh báo trước khi đốt hết $300",tag:"Budget + credit",who:["Đ","Đạt · tự học"],speed:4,
  scenario:"Tôi vừa mở tài khoản dùng thử Google Cloud với $300 credit và dựng thử Redis, RabbitMQ, một API. Đã đặt budget $100/tháng báo ở 50% và 90%. Chạy gần một tháng, credit tụt mà không có email nào.",
  goal:"Budget thấy tiền credit đang bị đốt và gửi cảnh báo vào hộp thư của bạn khi tiêu tới 50% hạn mức.",
  concepts:["Free trial $300 / 90 ngày","Cloud Billing budget","credit_types_treatment","notification channel","budget chỉ báo, không chặn"],
  yaml:head("lab-credit · Budget không báo dù credit đang tụt")+NET()+`
resource "google_compute_instance" "rabbitmq" {
  name         = "rabbitmq-1"
  machine_type = "e2-medium"
  zone         = "asia-southeast1-a"
  tags         = ["rabbitmq"]
  labels       = { app = "rabbitmq" }

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 20
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.app.id
  }
}

resource "google_redis_instance" "cache" {
  name               = "cache"
  tier               = "BASIC"
  memory_size_gb     = 2
  region             = "asia-southeast1"
  authorized_network = google_compute_network.main.id
}
`+RUN("api",{min:1})+PUBLIC("api")+`
resource "google_monitoring_notification_channel" "email" {
  display_name = "Email của tôi"
  type         = "email"
  labels       = { email_address = "${EMAIL}" }
}

resource "google_billing_budget" "credit" {
  billing_account = "${BILLING}"
  display_name    = "credit-300"

  amount {
    specified_amount {
      currency_code = "USD"
      units         = "100"
    }
  }

  budget_filter {
    projects = ["projects/anphat-lab"]
  }

  threshold_rules {
    threshold_percent = 0.5
  }

  threshold_rules {
    threshold_percent = 0.9
  }

  all_updates_rule {
    disable_default_iam_recipients = true
  }
}
`+CLIENT("customers","google_cloud_run_v2_service.api.uri","  rate_per_second = 5")+INBOX,
  layout:{"client/customers":[40,60],"inbox/me":[40,560],"run/api":[380,60],"invoker/public":[380,330],"budget/credit":[380,560],"channel/email":[720,620],"vpc/main":[720,40],"subnet/app":[760,110],"vm/rabbitmq":[790,170],"redis/cache":[1100,120]},
  explain:{"budget/credit":"Hạn mức $100 mỗi tháng (≈ $300 trong 90 ngày), báo ở 50% và 90%. Mở phần Cấu hình: xem dòng Credit và Gửi tới.","channel/email":"Kênh email đã tạo sẵn, nhưng chưa budget nào gửi tới nó.",
    "inbox/me":"Hộp thư của bạn. Cảnh báo budget tới đây.","vm/rabbitmq":"RabbitMQ thử nghiệm trên một VM e2-medium, chạy suốt ngày đêm.","redis/cache":"Memorystore Redis 2 GB, tính tiền theo GB-giờ.","run/api":"API giữ 1 instance tối thiểu nên tốn tiền cả khi không ai gọi.","client/customers":"Vài request mỗi giây để thử."},
  tasks:[{t:"Budget thấy chi tiêu thật (không trừ credit)",c:"budget_filter.credit_types_treatment = EXCLUDE_ALL_CREDITS.",test:()=>{const b=first("google_billing_budget");return!!b&&getP(b.props,"budget_filter.credit_types_treatment")==="EXCLUDE_ALL_CREDITS"}},
    {t:"Cảnh báo có đường tới hộp thư",c:"Budget gửi tới notification channel email của bạn (hoặc người nhận mặc định).",test:()=>{const b=first("google_billing_budget");if(!b)return false;const ch=arr(getP(b.props,"all_updates_rule.monitoring_notification_channels")).map(refOf).filter(Boolean);return ch.some(c=>getP(nodeOf(c).props,"labels.email_address")===EMAIL)||getP(b.props,"all_updates_rule.disable_default_iam_recipients")!==true}},
    {t:"Chạy 30 ngày: hộp thư nhận cảnh báo 50%",c:"Thư “đã tiêu 50%” tới trước cuối tháng.",test:()=>gRun(30*86400,()=>(RT.inbox["inbox/me"]||[]).some(m=>m.kind==="budget"&&/50%/.test(m.subject)),3600)}],
  hints:()=>["Bấm khối Budget rồi bấm ▶ Chạy: dòng “Budget thấy” đứng yên ở $0 dù chi phí tăng. Credit đang trả thay nên budget không thấy gì.","Trong Cấu hình của Budget, đổi “Credit” sang “Không trừ credit”.","Budget đã tắt người nhận mặc định và chưa gửi tới channel nào. Nối Budget tới khối Notification channel (kéo từ chấm bên phải)."],
  diagnose:i=>ladder([[()=>getP(first("google_billing_budget").props,"budget_filter.credit_types_treatment")==="EXCLUDE_ALL_CREDITS",["Credit đang tụt nhưng budget vẫn thấy $0.","Budget mặc định tính chi tiêu sau khi trừ credit (INCLUDE_ALL_CREDITS).","Trong thời gian dùng thử, credit trả toàn bộ hóa đơn nên chi tiêu “sau credit” luôn là $0. Đặt credit_types_treatment = EXCLUDE_ALL_CREDITS để budget đo tiền credit bị đốt."]],
    [()=>L_CREDIT.tasks[1].test(),["Budget đã thấy chi tiêu, nhưng cảnh báo không tới ai.","all_updates_rule đang tắt người nhận mặc định và không có channel.","Nối Budget tới Notification channel email (hoặc bỏ disable_default_iam_recipients)."]]],i),
  solve(){edit("budget không trừ credit, gửi tới channel email",()=>{const b=first("google_billing_budget");setP(b.props,"budget_filter.credit_types_treatment","EXCLUDE_ALL_CREDITS");setP(b.props,"all_updates_rule.monitoring_notification_channels",[X("google_monitoring_notification_channel.email.id")])});solveLog("budget: EXCLUDE_ALL_CREDITS + channel email")},
  pass:"Budget chỉ là cảnh báo: nó không dừng tài nguyên. Khi dùng thử, nhớ hai điều: (1) budget mặc định trừ credit nên không báo gì cho tới khi credit hết; (2) hết $300 hoặc hết 90 ngày thì tài nguyên dừng. Muốn tự động tắt khi chạm ngưỡng phải tự làm (budget → Pub/Sub → Cloud Function tắt billing)."};

const L_PUBLIC={id:"public",phase:"Nền tảng",step:2,title:"API trả 403 cho khách",tag:"Cloud Run + run.invoker",who:["H","Hà · vận hành"],speed:1,
  scenario:"API tra cứu tỷ giá mới deploy lên Cloud Run, trang web gọi vào thì nhận 403 Forbidden. Dev nói container chạy bình thường.",
  goal:"Khách trên Internet gọi được API tỷ giá; service vẫn chỉ có đúng quyền cần thiết.",concepts:["Cloud Run","roles/run.invoker","allUsers","ingress"],
  yaml:head("lab-public · Cloud Run trả 403")+RUN("rates").replace('ingress             = "INGRESS_TRAFFIC_ALL"','ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"')+CLIENT("website","google_cloud_run_v2_service.rates.uri","  rate_per_second = 40"),
  layout:{"client/website":[40,80],"run/rates":[400,80]},
  explain:{"client/website":"Trang web ngân hàng gọi API tỷ giá khoảng 40 lần mỗi giây.","run/rates":"API tỷ giá trên Cloud Run. Mặc định Cloud Run yêu cầu người gọi có quyền roles/run.invoker."},
  tasks:[{t:"Service nhận request từ Internet",c:"ingress = INGRESS_TRAFFIC_ALL.",test:()=>{const r=first("google_cloud_run_v2_service");return!!r&&r.props.ingress==="INGRESS_TRAFFIC_ALL"}},
    {t:"Khách không cần đăng nhập vẫn gọi được",c:"Có binding roles/run.invoker cho allUsers trên service.",test:()=>{const r=first("google_cloud_run_v2_service");return!!r&&isPublicRun(r)}},
    {t:"Trang web gọi API thành công",c:"Hơn 95% request trả 200.",test:()=>gRun(120,()=>okShare(clientNamed("website"))>0.95)}],
  hints:()=>["Bấm ▶ Chạy rồi bấm vào mũi tên client → service để xem lỗi.","ingress đang là “Chỉ trong VPC / project”: Internet không vào được.","Kéo “Quyền gọi Cloud Run” từ thư viện, nối nó tới service (member allUsers, role roles/run.invoker)."],
  diagnose:i=>ladder([[()=>L_PUBLIC.tasks[0].test(),["Request từ Internet bị trả 404 ngay ở cửa.","ingress của service.","INGRESS_TRAFFIC_INTERNAL_ONLY chỉ nhận traffic từ VPC / project. API công khai cần INGRESS_TRAFFIC_ALL."]],
    [()=>L_PUBLIC.tasks[1].test(),["Giờ request vào tới service nhưng nhận 403.","Quyền gọi service (IAM).","Cloud Run mặc định chỉ cho người có roles/run.invoker gọi. Cấp role đó cho allUsers để công khai."]]],i),
  solve(){edit("ingress all + allUsers invoker",()=>{const r=first("google_cloud_run_v2_service");r.props.ingress="INGRESS_TRAFFIC_ALL";M.res["invoker/public"]={Type:"google_cloud_run_v2_service_iam_member",Properties:{name:X("google_cloud_run_v2_service.rates.name"),location:REGION,role:"roles/run.invoker",member:"allUsers"}};M.pos["invoker/public"]=[400,360]});solveLog("ingress all, allUsers → roles/run.invoker")},
  pass:"Cloud Run có hai lớp cửa: ingress (traffic từ đâu được vào) và IAM (ai được gọi). API công khai cần cả hai mở. API nội bộ thì ngược lại: giữ ingress internal và chỉ cấp run.invoker cho service account của bên gọi."};

const L_REDIS={id:"redis",phase:"Redis",step:3,title:"Cloud Run không với tới Memorystore",tag:"Memorystore + VPC egress",who:["L","Lan · dev"],speed:1,
  scenario:"API tra cứu số dư dùng Redis làm cache. Lên Cloud Run thì mọi request treo rồi lỗi 500: không kết nối được Redis. Thêm vào đó, hóa đơn ước tính cho Redis cao bất thường.",
  goal:"API đọc được Redis qua mạng nội bộ, khách gọi thành công, và Redis có cỡ hợp lý cho môi trường học.",concepts:["Memorystore for Redis","IP nội bộ","authorized_network","Direct VPC egress","Basic vs Standard HA"],
  yaml:head("lab-redis · Cloud Run không gọi được Memorystore")+NET()+`
resource "google_redis_instance" "cache" {
  name               = "balance-cache"
  tier               = "STANDARD_HA"
  memory_size_gb     = 5
  region             = "asia-southeast1"
  authorized_network = google_compute_network.main.id
}
`+RUN("balance",{env:[["REDIS_HOST","${google_redis_instance.cache.host}"]]})+PUBLIC("balance")+CLIENT("customers","google_cloud_run_v2_service.balance.uri","  rate_per_second = 30"),
  layout:{"client/customers":[40,80],"run/balance":[380,80],"invoker/public":[380,360],"vpc/main":[760,40],"subnet/app":[800,110],"redis/cache":[1120,110]},
  explain:{"client/customers":"Khách mở app xem số dư, khoảng 30 lần mỗi giây.","run/balance":"API số dư: đọc cache Redis qua biến REDIS_HOST.","redis/cache":"Memorystore Redis chỉ có IP nội bộ trong VPC main. Đang để Standard HA 5 GB.","vpc/main":"VPC của project.","subnet/app":"Subnet app: Cloud Run có thể mượn đường qua đây để vào VPC."},
  tasks:[{t:"Cloud Run có đường vào VPC của Redis",c:"vpc_access qua subnet app (Direct VPC egress).",test:()=>{const r=first("google_cloud_run_v2_service"),d=first("google_redis_instance");return!!r&&!!d&&netPath(r,d.id).ok}},
    {t:"Khách xem số dư thành công",c:"Hơn 95% request trả 200.",test:()=>gRun(120,()=>okShare(clientNamed("customers"))>0.95)},
    {t:`Redis cho môi trường học ≤ $60/tháng`,c:"Basic tier, dung lượng nhỏ (cache có thể mất).",test:()=>{const d=first("google_redis_instance");return!!d&&monthly(d)<=60}}],
  hints:()=>["Bấm ▶ Chạy, rồi bấm mũi tên balance → cache: lỗi timeout tới IP nội bộ.","Cloud Run không nằm trong VPC. Nối Cloud Run tới subnet app (Direct VPC egress).","Xem phần Giá niêm yết của Redis: Standard HA 5 GB tốn bao nhiêu mỗi tháng? Cache để học thì Basic 1 GB là đủ."],
  diagnose:i=>ladder([[()=>L_REDIS.tasks[0].test(),["Mọi request lỗi 500 sau khi chờ lâu.","Đường mạng từ Cloud Run tới Redis.","Memorystore chỉ có IP nội bộ trong VPC main; Cloud Run chạy ngoài VPC. Thêm vpc_access: network_interfaces { network, subnetwork = app }."]],
    [()=>L_REDIS.tasks[2].test(),["Đã chạy được, nhưng Redis tốn hơn $60/tháng.","tier và memory_size_gb của Redis.","Standard HA giữ bản sao ở zone khác (giá gấp đôi); 5 GB là nhiều cho cache học. Chọn BASIC, 1 GB."]]],i),
  solve(){edit("vpc egress + Redis Basic 1 GB",()=>{const r=first("google_cloud_run_v2_service");setEgress(r,"subnet/app");const d=first("google_redis_instance");d.props.tier="BASIC";d.props.memory_size_gb=1});solveLog("Direct VPC egress qua subnet app; Redis BASIC 1 GB")},
  pass:"Memorystore (Redis, Valkey) và Managed Kafka không có IP public: chỉ ai trong VPC mới tới được. Cloud Run, Cloud Functions chạy ngoài VPC nên cần Direct VPC egress (hoặc VPC connector). Còn giá: Memorystore tính theo dung lượng đã chọn, chạy suốt; với cache, Basic rẻ và đủ."};

const L_RMQ={id:"rabbitmq",phase:"RabbitMQ",step:4,title:"RabbitMQ trên VM: tường lửa và cỡ máy",tag:"VM + firewall",who:["M","Minh · bảo mật"],speed:1,
  scenario:"Hàng đợi lệnh chuyển tiền chạy RabbitMQ trên một VM. Bảo mật báo VM này mở cổng AMQP và trang quản trị ra Internet. Giờ cao điểm, API báo lỗi publish.",
  goal:"Chỉ app trong subnet nói chuyện được với RabbitMQ, VM không lộ ra Internet, và chịu được tải giờ cao điểm.",concepts:["RabbitMQ","AMQP 5672 / 15672","firewall source_ranges + target_tags","IP public","cỡ máy e2"],
  yaml:head("lab-rabbitmq · RabbitMQ mở ra Internet và quá tải")+NET()+`
resource "google_compute_firewall" "rabbitmq" {
  name          = "allow-rabbitmq"
  network       = google_compute_network.main.name
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["rabbitmq"]

  allow {
    protocol = "tcp"
    ports    = ["5672", "15672"]
  }
}

resource "google_compute_instance" "rabbitmq" {
  name         = "rabbitmq-1"
  machine_type = "e2-micro"
  zone         = "asia-southeast1-a"
  tags         = ["rabbitmq"]
  labels       = { app = "rabbitmq" }

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 20
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.app.id

    access_config {}
  }
}
`+RUN("transfers",{egress:"app",env:[["AMQP_URL","amqp://${google_compute_instance.rabbitmq.network_interface[0].network_ip}:5672"]]})+PUBLIC("transfers")+CLIENT("customers","google_cloud_run_v2_service.transfers.uri","  rate_per_second = 900"),
  layout:{"client/customers":[40,80],"run/transfers":[380,80],"invoker/public":[380,360],"vpc/main":[760,40],"subnet/app":[800,110],"vm/rabbitmq":[830,170],"fw/rabbitmq":[830,520]},
  explain:{"client/customers":"Giờ cao điểm: khoảng 900 lệnh chuyển tiền mỗi giây.","run/transfers":"API nhận lệnh, đẩy vào hàng đợi RabbitMQ qua IP nội bộ (vpc_access qua subnet app).","vm/rabbitmq":"RabbitMQ tự cài trên VM e2-micro, đang có IP public.","fw/rabbitmq":"Luật firewall mở 5672 (AMQP) và 15672 (trang quản trị) cho VM có tag rabbitmq."},
  tasks:[{t:"Firewall chỉ cho subnet app vào RabbitMQ",c:"source_ranges không có 0.0.0.0/0; app vẫn kết nối được.",test:()=>{const f=allNodes().filter(x=>x.type==="google_compute_firewall");const vm=first("google_compute_instance");return!!vm&&fwFor(vm).every(x=>!arr(x.props.source_ranges).includes("0.0.0.0/0"))&&netPath(first("google_cloud_run_v2_service"),vm.id).ok&&f.length>0}},
    {t:"VM RabbitMQ không có IP public",c:"Bỏ access_config.",test:()=>{const vm=first("google_compute_instance");return!!vm&&!arr(getP(vm.props,"network_interface.access_config")).length}},
    {t:"Chịu được giờ cao điểm",c:"Hơn 95% lệnh được nhận.",test:()=>gRun(120,()=>okShare(clientNamed("customers"))>0.95)}],
  hints:()=>["Xem tab Vấn đề: firewall đang mở cổng gì cho ai?","Đổi source_ranges của firewall thành dải subnet app (10.10.0.0/24). Bỏ dấu “IP public” của VM.","Bấm ▶ Chạy: VM báo quá tải (memory alarm). e2-micro chỉ xử lý khoảng 400 message/giây trong CloudLab; thử e2-small hoặc e2-medium."],
  diagnose:i=>ladder([[()=>L_RMQ.tasks[0].test(),["Cổng 5672 và 15672 của RabbitMQ mở cho cả Internet.","source_ranges của firewall rabbitmq.","0.0.0.0/0 là mọi địa chỉ. App gọi từ subnet app (10.10.0.0/24), chỉ cần mở cho dải đó."]],
    [()=>L_RMQ.tasks[1].test(),["VM vẫn có IP public.","network_interface của VM (access_config).","App gọi qua IP nội bộ. IP public chỉ làm VM lộ ra và tốn thêm tiền IPv4 mỗi giờ."]],
    [()=>gRun(120,()=>okShare(clientNamed("customers"))>0.95),["Giờ cao điểm nhiều lệnh bị từ chối.","Cỡ máy của VM RabbitMQ.","Publisher bị chặn khi RabbitMQ quá tải. Chọn e2-small (≈1.500 message/s trong CloudLab) hoặc lớn hơn."]]],i),
  solve(){edit("firewall nội bộ, bỏ IP public, e2-small",()=>{const f=first("google_compute_firewall");f.props.source_ranges=["10.10.0.0/24"];const vm=first("google_compute_instance");delete vm.props.network_interface.access_config;vm.props.machine_type="e2-small"});solveLog("firewall 10.10.0.0/24, bỏ access_config, e2-small")},
  pass:"Google Cloud không có RabbitMQ được quản lý sẵn, nên phần vận hành là của bạn: tường lửa, vá lỗi, sao lưu, cỡ máy. Firewall của GCP áp theo network tag, không theo từng máy như security group của AWS. Mở theo dải subnet của app, không bao giờ 0.0.0.0/0 cho 5672 hay 15672."};

const L_KAFKA={id:"kafka",phase:"Kafka",step:5,title:"Managed Kafka: endpoint và quyền",tag:"Managed Kafka + IAM",who:["L","Lan · dev"],speed:1,
  scenario:"Luồng giao dịch thẻ cần ghi vào Kafka để chống gian lận đọc lại. Cluster đã tạo, nhưng API ghi vào thì lỗi. Sếp hỏi thêm: cluster này tốn bao nhiêu mỗi tháng?",
  goal:"API ghi được giao dịch vào topic Kafka bằng đúng quyền cần thiết, và bạn biết giá tối thiểu của cluster.",concepts:["Managed Service for Apache Kafka","vCPU / RAM tối thiểu","endpoint trong subnet (PSC)","roles/managedkafka.client","service account"],
  yaml:head("lab-kafka · Ghi vào Kafka bị lỗi")+NET()+`
resource "google_managed_kafka_cluster" "events" {
  cluster_id = "card-events"
  location   = "asia-southeast1"

  capacity_config {
    vcpu_count   = 3
    memory_bytes = 3221225472
  }

  gcp_config {
    access_config {
      network_configs {
        subnet = google_compute_subnetwork.app.id
      }
    }
  }
}

resource "google_managed_kafka_topic" "card_txn" {
  topic_id           = "card-transactions"
  cluster            = google_managed_kafka_cluster.events.cluster_id
  location           = "asia-southeast1"
  partition_count    = 6
  replication_factor = 3
}
`+SA("card_api")+RUN("card_api",{sa:"card_api",env:[["KAFKA_TOPIC","${google_managed_kafka_topic.card_txn.topic_id}"]]})+PUBLIC("card_api")+CLIENT("pos","google_cloud_run_v2_service.card_api.uri","  rate_per_second = 200"),
  layout:{"client/pos":[40,80],"run/card_api":[380,80],"invoker/public":[380,380],"sa/card_api":[380,640],"vpc/main":[760,40],"subnet/app":[800,110],"kafka/events":[830,170],"topic/card_txn":[1160,560]},
  explain:{"client/pos":"Máy POS gửi giao dịch thẻ, khoảng 200 mỗi giây.","run/card_api":"API nhận giao dịch và ghi vào topic Kafka, chạy bằng service account card_api.","sa/card_api":"Danh tính của API. Chưa có role nào.","kafka/events":"Cluster Kafka managed 3 vCPU, 3 GiB, endpoint ở subnet app.","topic/card_txn":"Topic card-transactions, 6 partition, 3 bản sao."},
  tasks:[{t:"API có đường vào subnet chứa endpoint Kafka",c:"vpc_access qua subnet app.",test:()=>{const r=first("google_cloud_run_v2_service");return!!r&&netPath(r,"topic/card_txn").ok}},
    {t:"Service account có đúng quyền Kafka",c:"roles/managedkafka.client cho sa card_api; không dùng editor / owner.",test:()=>roleBound("sa/card_api","roles/managedkafka.client")&&!roleBound("sa/card_api","roles/editor")&&!roleBound("sa/card_api","roles/owner")},
    {t:"Giao dịch được ghi vào topic",c:"Hơn 95% request thành công.",test:()=>gRun(120,()=>okShare(clientNamed("pos"))>0.95)}],
  hints:()=>["Bấm ▶ Chạy, bấm mũi tên card_api → card_txn để xem lỗi đầu tiên.","Endpoint Kafka nằm trong subnet app. Nối Cloud Run tới subnet app.","Lỗi tiếp theo là PERMISSION_DENIED. Nối “IAM binding” với role roles/managedkafka.client tới service account card_api (hoặc nối Cloud Run tới topic, CloudLab gợi ý luôn)."],
  diagnose:i=>ladder([[()=>L_KAFKA.tasks[0].test(),["Kết nối tới Kafka bị timeout.","Đường mạng từ Cloud Run tới endpoint Kafka.","Endpoint Kafka chỉ có IP trong subnet app. Thêm Direct VPC egress qua subnet app."]],
    [()=>L_KAFKA.tasks[1].test(),["Kết nối được, nhưng ghi bị PERMISSION_DENIED.","Quyền của service account card_api.","Managed Kafka xác thực bằng IAM: gán roles/managedkafka.client cho service account (đừng gán editor cho tiện)."]]],i),
  solve(){edit("egress + managedkafka.client",()=>{setEgress(first("google_cloud_run_v2_service"),"subnet/app");bindRole("sa/card_api","roles/managedkafka.client")});solveLog("Direct VPC egress; roles/managedkafka.client cho card_api")},
  pass:"Managed Kafka lo broker, bản sao và nâng cấp, đổi lại có giá tối thiểu (3 vCPU, 3 GiB) chạy suốt tháng dù không có message. Với $300 credit: bật khi học, terraform destroy khi xong, hoặc học API Kafka trên một VM nhỏ; còn Pub/Sub thì không có giá cố định."};

const L_WS={id:"websocket",phase:"WebSocket",step:6,title:"Bảng giá realtime: WebSocket trên Cloud Run",tag:"WebSocket + concurrency",who:["T","Tú · sản phẩm"],speed:2,
  scenario:"Bảng giá chứng khoán realtime cho 3.000 khách mở cùng lúc, server đẩy giá mới 12 lần mỗi phút. Nhiều khách không kết nối được, người còn lại bị rớt kết nối mỗi 5 phút. Ước tính chi phí cũng quá cao.",
  goal:"Cả 3.000 khách giữ được kết nối, không bị cắt mỗi 5 phút, và service WebSocket tốn không quá $350/tháng (tính cả truyền dữ liệu ra Internet).",concepts:["WebSocket","request timeout (tối đa 60 phút)","max_instance_request_concurrency","max_instance_count","instance-giờ"],
  yaml:head("lab-websocket · Bảng giá realtime bị từ chối và rớt kết nối")+RUN("prices",{ws:true,conc:80,timeout:"300s",max:10})+PUBLIC("prices")+CLIENT("traders","google_cloud_run_v2_service.prices.uri",`  protocol            = "websocket"
  connections         = 3000
  messages_per_minute = 12`),
  layout:{"client/traders":[40,80],"run/prices":[400,80],"invoker/public":[400,380]},
  explain:{"client/traders":"3.000 nhà đầu tư mở bảng giá cùng lúc, mỗi người nhận 12 lần cập nhật mỗi phút.","run/prices":"Server WebSocket trên Cloud Run. Mỗi kết nối chiếm một suất request đồng thời cho tới khi đóng."},
  tasks:[{t:"Cả 3.000 khách kết nối được",c:"Không kết nối nào bị từ chối.",test:()=>gRun(300,()=>wsOk(clientNamed("traders")),60)},
    {t:"Kết nối không bị cắt mỗi 5 phút",c:"timeout = 3600s (tối đa).",test:()=>runSpec(first("google_cloud_run_v2_service")).timeout>=3600},
    {t:"Service WebSocket ≤ $350/tháng",c:"Chạy một ngày mô phỏng, nhân 30.",test:()=>gRun(86400,()=>(RT.n["run/prices"]||{cost:0}).cost*30<=350&&wsOk(clientNamed("traders")),600)}],
  hints:()=>["Bấm ▶ Chạy: khối prices báo “Hết instance”. 10 instance × 80 kết nối = 800 < 3.000.","Đừng tăng instance trước: một server WebSocket nhẹ giữ được hàng trăm kết nối. Tăng “Request đồng thời mỗi instance” (tối đa 1000).","Đặt Timeout request = 3600s để khách không bị cắt mỗi 5 phút.","Còn muốn rẻ hơn: instance luôn có kết nối nên luôn bận; “Tính tiền CPU: suốt thời gian instance chạy” (instance-based) có đơn giá thấp hơn."],
  diagnose:i=>ladder([[()=>L_WS.tasks[0].test(),["Hơn 2.000 khách không kết nối được.","max_instance_count × max_instance_request_concurrency.","Mỗi kết nối WebSocket giữ một suất concurrency suốt thời gian mở: 10 × 80 = 800 kết nối. Tăng concurrency (ví dụ 1000) thay vì tăng instance: rẻ hơn nhiều."]],
    [()=>L_WS.tasks[1].test(),["Khách bị rớt kết nối đều đặn mỗi 5 phút.","timeout của service.","Cloud Run cắt request khi hết timeout, kể cả WebSocket. Tối đa 3600s; client vẫn nên tự kết nối lại."]],
    [()=>L_WS.tasks[2].test(),["Đã kết nối đủ, nhưng tiền tháng vẫn cao.","Số instance đang chạy (xem Giá niêm yết).","Instance có kết nối mở được tính tiền suốt. Ít instance hơn (concurrency cao hơn) là rẻ hơn."]]],i),
  solve(){edit("concurrency 1000, timeout 3600s",()=>{const r=first("google_cloud_run_v2_service");r.props.template.max_instance_request_concurrency=1000;r.props.template.timeout="3600s"});solveLog("concurrency 1000, timeout 3600s")},
  pass:"WebSocket trên Cloud Run: mỗi kết nối là một request kéo dài, giữ instance bận và bị tính tiền suốt thời gian mở, bị cắt khi hết timeout (tối đa 60 phút). Thứ quyết định giá là số kết nối mỗi instance. Trên AWS, API Gateway WebSocket tính theo phút-kết nối và số message thay vì theo instance: so ở trang so sánh giá."};

const L_BURN={id:"burn",phase:"Chi phí",step:7,title:"Đủ 90 ngày với $300",tag:"Cả bốn dịch vụ",who:["Đ","Đạt · tự học"],speed:4,
  scenario:"Tôi muốn dựng cả Kafka, Redis, RabbitMQ và WebSocket để học trong 3 tháng dùng thử. Bản đầu tiên tôi chọn toàn dịch vụ “chuẩn production”: chạy chưa tới hai tuần đã hết $300.",
  goal:"Giữ đủ bốn dịch vụ đang chạy được cho khách, mà một ngày tốn không quá $5 (credit đủ ít nhất 60 ngày).",concepts:["giá cố định vs theo lượng dùng","Managed Kafka vs Pub/Sub vs Kafka tự cài","Memorystore Basic vs Standard HA","IP public","concurrency"],
  yaml:head("lab-burn · Bốn dịch vụ đốt hết credit trong một tháng")+NET()+`
resource "google_compute_firewall" "from_app" {
  name          = "from-app"
  network       = google_compute_network.main.name
  source_ranges = ["10.10.0.0/24"]
  target_tags   = ["rabbitmq"]

  allow {
    protocol = "tcp"
    ports    = ["5672"]
  }
}

resource "google_compute_instance" "rabbitmq" {
  name         = "rabbitmq-1"
  machine_type = "e2-standard-4"
  zone         = "asia-southeast1-a"
  tags         = ["rabbitmq"]
  labels       = { app = "rabbitmq" }

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 100
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.app.id

    access_config {}
  }
}

resource "google_redis_instance" "cache" {
  name               = "cache"
  tier               = "STANDARD_HA"
  memory_size_gb     = 5
  region             = "asia-southeast1"
  authorized_network = google_compute_network.main.id
}

resource "google_managed_kafka_cluster" "events" {
  cluster_id = "events"
  location   = "asia-southeast1"

  capacity_config {
    vcpu_count   = 3
    memory_bytes = 3221225472
  }

  gcp_config {
    access_config {
      network_configs {
        subnet = google_compute_subnetwork.app.id
      }
    }
  }
}
`+SA("api")+`
resource "google_project_iam_member" "api_kafka" {
  project = "anphat-lab"
  role    = "roles/managedkafka.client"
  member  = "serviceAccount:\${google_service_account.api.email}"
}

resource "google_project_iam_member" "api_pubsub" {
  project = "anphat-lab"
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:\${google_service_account.api.email}"
}

resource "google_pubsub_topic" "trades" {
  name = "trades"
}
`+RUN("api",{sa:"api",egress:"app",min:2,env:[["AMQP_URL","amqp://${google_compute_instance.rabbitmq.network_interface[0].network_ip}:5672"],["REDIS_HOST","${google_redis_instance.cache.host}"],["KAFKA_BOOTSTRAP","bootstrap.${google_managed_kafka_cluster.events.cluster_id}.asia-southeast1.managedkafka.anphat-lab.cloud.goog:9092"]]})+PUBLIC("api")+
  RUN("prices",{ws:true,conc:100,timeout:"3600s",max:20,egress:"app",env:[["REDIS_HOST","${google_redis_instance.cache.host}"]]})+`
resource "google_cloud_run_v2_service_iam_member" "prices_public" {
  name     = google_cloud_run_v2_service.prices.name
  location = "asia-southeast1"
  role     = "roles/run.invoker"
  member   = "allUsers"
}
`+CLIENT("orders","google_cloud_run_v2_service.api.uri","  rate_per_second = 2")+CLIENT("board","google_cloud_run_v2_service.prices.uri",`  protocol            = "websocket"
  connections         = 500
  messages_per_minute = 6`),
  layout:{"client/orders":[40,80],"client/board":[40,560],"run/api":[380,60],"invoker/public":[380,330],"run/prices":[380,560],"invoker/prices_public":[380,830],"sa/api":[380,1060],"iam/api_kafka":[720,1060],"iam/api_pubsub":[1060,1060],
    "vpc/main":[760,40],"subnet/app":[800,110],"vm/rabbitmq":[830,170],"kafka/events":[1130,170],"redis/cache":[1500,120],"fw/from_app":[830,640],"pubsub/trades":[1500,520]},
  explain:{"client/orders":"Lệnh đặt từ app thử nghiệm, khoảng 2 mỗi giây.","client/board":"500 người dùng thử mở bảng giá realtime, 6 cập nhật mỗi phút.","run/api":"API nhận lệnh: đẩy vào RabbitMQ, ghi sự kiện vào Kafka, đọc Redis. Giữ 2 instance thường trực.","run/prices":"Server WebSocket đẩy giá, 100 kết nối mỗi instance.",
    "vm/rabbitmq":"RabbitMQ trên e2-standard-4, ổ 100 GB, có IP public.","redis/cache":"Memorystore Standard HA 5 GB.","kafka/events":"Managed Kafka 3 vCPU, 3 GiB.","pubsub/trades":"Một topic Pub/Sub, chưa ai dùng: có thể thay Kafka để học khái niệm publish / subscribe."},
  tasks:[{t:"Cả hai nhóm khách đều phục vụ được",c:"Lệnh đặt > 95% thành công; 500 kết nối bảng giá mở đủ.",test:()=>gRun(300,()=>okShare(clientNamed("orders"))>0.95&&wsOk(clientNamed("board")),60)},
    {t:"Vẫn đủ bốn loại: Kafka (hoặc Pub/Sub), Redis, RabbitMQ, WebSocket",c:"API vẫn dùng một hàng đợi RabbitMQ, một cache Redis và một luồng sự kiện (Kafka hoặc Pub/Sub); bảng giá vẫn là WebSocket.",
      test:()=>{const a=nodeOf("run/api");if(!a)return false;const ds=depsOfApp(a).map(d=>nodeOf(d.id)).filter(Boolean),has=f=>ds.some(f);
        return has(d=>d.type==="google_compute_instance"&&appOf(d)==="rabbitmq")&&has(d=>d.type==="google_redis_instance"||d.type==="google_memorystore_instance"||(d.type==="google_compute_instance"&&appOf(d)==="redis"))&&has(d=>/kafka|pubsub/.test(d.type)||(d.type==="google_compute_instance"&&appOf(d)==="kafka"))&&!!first("google_cloud_run_v2_service")&&allNodes().some(n=>n.type==="google_cloud_run_v2_service"&&runSpec(n).ws)}},
    {t:"Một ngày tốn ≤ $5 (đủ 60 ngày)",c:"Chạy một ngày mô phỏng, tính cả giá cố định và theo lượng dùng.",test:()=>gRun(86400,()=>RT.runCost<=5&&okShare(clientNamed("orders"))>0.95,600)}],
  hints:()=>["Mở từng khối, xem phần Giá niêm yết: khối nào đắt nhất mỗi tháng?","Managed Kafka có giá tối thiểu cao nhất. Để học publish / subscribe, Pub/Sub (không có giá cố định) hoặc Kafka tự cài trên VM nhỏ rẻ hơn nhiều. Nhớ đổi biến môi trường của API.","Redis Standard HA 5 GB → Basic 1 GB. RabbitMQ e2-standard-4, ổ 100 GB, IP public → e2-micro, 20 GB, không IP public (2 lệnh/giây là rất nhẹ). API bỏ 2 instance thường trực.","Server WebSocket: concurrency 1000 để một instance giữ hết 500 kết nối, và vì instance luôn bận, chọn tính tiền instance-based."],
  diagnose:i=>ladder([[()=>!nodeOf("kafka/events")||!depsOfApp(nodeOf("run/api")).some(d=>d.id==="kafka/events"),["Khoản cố định lớn nhất là Managed Kafka.","Cluster 3 vCPU, 3 GiB chạy suốt tháng.",`Riêng cluster này ≈ ${money(monthly("kafka/events")||0)}/tháng. Đổi API sang Pub/Sub (biến PUBSUB_TOPIC) rồi xóa cluster, hoặc dùng “Kafka tự cài trên VM”.`]],
    [()=>!nodeOf("redis/cache")||monthly("redis/cache")<=50,["Redis vẫn là một khoản lớn.","tier và memory_size_gb.","Basic 1 GB đủ cho cache khi học."]],
    [()=>!nodeOf("vm/rabbitmq")||monthly("vm/rabbitmq")<=25,["RabbitMQ trên VM quá to.","machine_type, ổ đĩa, IP public.","e2-micro, 20 GB, không IP public là đủ cho 2 lệnh/giây."]],
    [()=>{const p=nodeOf("run/prices");return!p||(runSpec(p).conc>=500&&!runSpec(p).idle)},["Server WebSocket vẫn đốt nhiều nhất mỗi ngày.","concurrency và cách tính tiền CPU của run/prices.","500 kết nối với 100 kết nối mỗi instance là 5 instance bận suốt ngày. Concurrency 1000 → 1 instance; instance luôn bận thì instance-based rẻ hơn."]]],i),
  solve(){edit("bản rẻ: Pub/Sub thay Kafka, Redis Basic 1 GB, RabbitMQ e2-small, không instance thường trực",()=>{
      const a=nodeOf("run/api");a.props.template.containers.env=arr(a.props.template.containers.env).filter(e=>e.name!=="KAFKA_BOOTSTRAP").concat([{name:"PUBSUB_TOPIC",value:"${google_pubsub_topic.trades.id}"}]);a.props.template.scaling.min_instance_count=0;
      delete M.res["kafka/events"];delete M.pos["kafka/events"];delete M.res["iam/api_kafka"];
      const r=nodeOf("redis/cache");r.props.tier="BASIC";r.props.memory_size_gb=1;
      const vm=nodeOf("vm/rabbitmq");vm.props.machine_type="e2-micro";vm.props.boot_disk.initialize_params.size=20;delete vm.props.network_interface.access_config;
      const p=nodeOf("run/prices");p.props.template.max_instance_request_concurrency=1000;p.props.template.containers.resources.cpu_idle=false});solveLog("Pub/Sub thay Managed Kafka; Redis BASIC 1 GB; RabbitMQ e2-micro 20 GB không IP public; api min 0; WebSocket 1000 kết nối/instance, instance-based")},
  pass:"Hóa đơn cloud chia hai phần: giá cố định (tài nguyên tồn tại là tính: VM, Memorystore, Kafka, instance thường trực, IPv4) và giá theo lượng dùng (request, GB, message). Khi học bằng credit, cắt phần cố định trước. Muốn đủ cả 90 ngày ($3,30/ngày) thì còn phải cắt nữa: Redis tự cài trên e2-micro thay Memorystore, hoặc chỉ bật Kafka / WebSocket vào buổi học rồi terraform destroy."};
const LESSONS=[L_CREDIT,L_PUBLIC,L_REDIS,L_RMQ,L_KAFKA,L_WS,L_BURN];
LESSONS.forEach((l,i)=>{l.step=i+1});
