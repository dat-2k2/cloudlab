"use strict";
/* GCP pack · catalog: Google Cloud resources as Terraform (google provider) plus CloudLab-only actors (cloudlab_*
   resources: clients, inbox), dropped when exporting for a real `terraform apply`.
   Block ids are short type prefixes + the Terraform name (vpc/main, run/api, kafka/events) so two resources of different
   types can share a name, as in Terraform. Prices: src/prices.js (GP = PRICES.gcp). */
const PROJECT="anphat-lab",REGION="asia-southeast1",ZONES=["asia-southeast1-a","asia-southeast1-b","asia-southeast1-c"],EMAIL="dat@example.com",BILLING="012345-6789AB-CDEF01";
const GP=PRICES.gcp;
const GROUPS=[["ext","Bên ngoài GCP"],["infra","Mạng"],["comp","Compute"],["db","Cache & dữ liệu"],["notify","Messaging & streaming"],["sec","IAM & bảo mật"],["cost","Chi phí & cảnh báo"]];
const T={};
function def(type,spec){T[type]=Object.assign({type,fields:[],rel:{}},spec)}
/* Terraform type ↔ short id prefix */
const PFX={cloudlab_client:"client",cloudlab_inbox:"inbox",google_compute_network:"vpc",google_compute_subnetwork:"subnet",google_compute_firewall:"fw",google_compute_instance:"vm",
  google_cloud_run_v2_service:"run",google_cloud_run_v2_service_iam_member:"invoker",google_service_account:"sa",google_project_iam_member:"iam",google_redis_instance:"redis",
  google_memorystore_instance:"valkey",google_managed_kafka_cluster:"kafka",google_managed_kafka_topic:"topic",google_pubsub_topic:"pubsub",google_storage_bucket:"gcs",
  google_billing_budget:"budget",google_monitoring_notification_channel:"channel"};
const TYPE_OF=Object.fromEntries(Object.entries(PFX).map(([t,p])=>[p,t]));
const idFor=(type,name)=>(PFX[type]||type)+"/"+name;
const tfName=n=>n.id.split("/").pop();
const addrOf=n=>n.type+"."+tfName(n);
const byAddr=(type,name)=>{const id=idFor(type,name);return rawOf(id)?id:null};
const X=e=>({$:e});
const ref=(id,attr)=>{const n=nodeOf(id);return n?X(addrOf(n)+(attr?"."+attr:"")):null};
const MACHINES={"e2-micro":{vcpu:0.25,burst:2,mem:1},"e2-small":{vcpu:0.5,burst:2,mem:2},"e2-medium":{vcpu:1,burst:2,mem:4},"e2-standard-2":{vcpu:2,mem:8},"e2-standard-4":{vcpu:4,mem:16}};
/* CloudLab's capacity estimates for an app on a VM (not benchmarks): requests or messages per second it serves */
const VM_CAP={web:{"e2-micro":30,"e2-small":80,"e2-medium":160,"e2-standard-2":320,"e2-standard-4":640},rabbitmq:{"e2-micro":400,"e2-small":1500,"e2-medium":4000,"e2-standard-2":12000,"e2-standard-4":25000},
  redis:{"e2-micro":5000,"e2-small":20000,"e2-medium":40000,"e2-standard-2":80000,"e2-standard-4":150000},kafka:{"e2-micro":300,"e2-small":2000,"e2-medium":6000,"e2-standard-2":20000,"e2-standard-4":45000}};
const APP_PORT={web:80,rabbitmq:5672,redis:6379,kafka:9092};
const appOf=n=>{const a=String(getP(n.props,"labels.app")||"web");return VM_CAP[a]?a:"web"};

/* ---------------- CloudLab actors (cloudlab_* resources, simulation only) ---------------- */
def("cloudlab_client",{label:"Client / người dùng",short:"⇢",cat:"ext",ext:true,src:true,
  doc:"Người hoặc chương trình gọi vào hệ thống từ Internet. HTTP: số request mỗi giây. WebSocket: số kết nối mở cùng lúc, mỗi kết nối nhận tin đẩy từ server.",
  defaults:()=>({target:null,protocol:"http",rate_per_second:10}),
  fields:[{k:"target",label:"Gọi tới",type:"tref",to:["google_cloud_run_v2_service","google_compute_instance"],attr:{google_cloud_run_v2_service:"uri",google_compute_instance:"network_interface[0].access_config[0].nat_ip"}},
    {k:"protocol",label:"Giao thức",type:"select",options:[["http","HTTP request"],["websocket","WebSocket (kết nối mở lâu)"]]},
    {k:"rate_per_second",label:"Request mỗi giây",type:"number",min:0,step:"any",when:p=>p.protocol!=="websocket"},
    {k:"connections",label:"Kết nối mở cùng lúc",type:"number",min:0,when:p=>p.protocol==="websocket",help:"Ví dụ 2000 khách đang mở bảng giá."},
    {k:"messages_per_minute",label:"Tin đẩy mỗi kết nối mỗi phút",type:"number",min:0,step:"any",when:p=>p.protocol==="websocket",help:"Server đẩy giá mới xuống mỗi khách."},
    {k:"expect",label:"Kỳ vọng",type:"select",options:[["","Nên thành công"],["deny","Nên bị chặn"]]}],
  rel:{target:{kind:"calls",label:p=>p.protocol==="websocket"?"WebSocket":"HTTPS"}}});
def("cloudlab_inbox",{label:"Hộp thư email",short:"@",cat:"ext",ext:true,sink:true,
  doc:"Hộp thư của bạn. Nhận cảnh báo budget (qua notification channel, hoặc mặc định gửi cho admin của billing account).",
  defaults:()=>({address:EMAIL}),fields:[{k:"address",label:"Địa chỉ email",type:"text"}]});

/* ---------------- network ---------------- */
def("google_compute_network",{label:"VPC network",short:"VPC",cat:"infra",container:"vpc",
  doc:"Mạng riêng của project. Khác AWS: VPC của Google là toàn cầu, subnet mới theo region. Đặt auto_create_subnetworks = false để tự chia subnet.",
  defaults:n=>({name:n,auto_create_subnetworks:false}),name:p=>p.name,fields:[{k:"name",label:"Tên",type:"text"}]});
def("google_compute_subnetwork",{label:"Subnet",short:"SN",cat:"infra",container:"subnet",
  doc:"Dải IP trong một region. VM, endpoint Kafka và đường ra VPC của Cloud Run (Direct VPC egress) đều lấy IP từ subnet.",
  defaults:n=>({name:n,ip_cidr_range:"10.10.0.0/24",region:REGION,network:null}),name:p=>p.name,
  fields:[{k:"name",label:"Tên",type:"text"},{k:"ip_cidr_range",label:"CIDR",type:"text"},{k:"network",label:"VPC",type:"tref",to:["google_compute_network"],attr:"id"}],
  rel:{network:{kind:"contains",label:""}}});
def("google_compute_firewall",{label:"Firewall rule",short:"FW",cat:"sec",
  doc:"Luật tường lửa của cả VPC. Mặc định chặn mọi traffic vào. Một luật INGRESS mở cổng cho nguồn (source_ranges) tới các VM có network tag trùng target_tags; bỏ target_tags là mở cho mọi VM.",
  defaults:n=>({name:n,network:null,direction:"INGRESS",allow:[{protocol:"tcp",ports:["80"]}],source_ranges:["0.0.0.0/0"],target_tags:[]}),name:p=>p.name,
  fields:[{k:"name",label:"Tên",type:"text"},{k:"network",label:"VPC",type:"tref",to:["google_compute_network"],attr:"name"},{k:"allow",label:"Cho phép",type:"fwallow"},
    {k:"source_ranges",label:"Nguồn (CIDR)",type:"list",help:"0.0.0.0/0 = cả Internet. 10.10.0.0/24 = chỉ subnet app."},{k:"target_tags",label:"Áp cho VM có tag",type:"list",help:"Để trống = mọi VM trong VPC."}],
  rel:{network:{kind:"contains",label:""}}});

/* ---------------- compute ---------------- */
const vmDefaults=(n,app)=>({name:n,machine_type:"e2-small",zone:ZONES[0],tags:app==="web"?["web"]:[app],labels:{app},
  boot_disk:{initialize_params:{image:"debian-cloud/debian-12",size:20,type:"pd-balanced"}},network_interface:{subnetwork:null},
  ...(STARTUP[app]?{metadata_startup_script:STARTUP[app]}:{})});
const STARTUP={rabbitmq:"apt-get update\napt-get install -y rabbitmq-server\nrabbitmq-plugins enable rabbitmq_management\nsystemctl enable --now rabbitmq-server\n",
  redis:"apt-get update\napt-get install -y redis-server\nsed -i 's/^bind .*/bind 0.0.0.0/' /etc/redis/redis.conf\nsystemctl restart redis-server\n",
  kafka:"# Kafka tự cài: Java + Kafka KRaft một node, đủ để học, không dùng cho production\napt-get update\napt-get install -y default-jre-headless\n"};
const vmFields=[{k:"name",label:"Tên",type:"text"},{k:"machine_type",label:"Machine type",type:"select",options:Object.keys(MACHINES),help:"e2-micro/small/medium dùng chung CPU (shared-core), rẻ, đủ để học."},
  {k:"zone",label:"Zone",type:"select",options:ZONES},{k:"network_interface.subnetwork",label:"Subnet",type:"tref",to:["google_compute_subnetwork"],attr:"id"},
  {k:"network_interface.access_config",label:"IP public",type:"publicip",help:"Có IP public thì VM nhận traffic Internet (nếu firewall cho) và tốn thêm tiền IPv4 mỗi giờ."},
  {k:"tags",label:"Network tag",type:"list",help:"Firewall chọn VM theo tag."},{k:"boot_disk.initialize_params.size",label:"Ổ đĩa (GB)",type:"number",min:10}];
def("google_compute_instance",{label:"VM (Compute Engine)",short:"VM",cat:"comp",
  doc:"Máy ảo chạy liên tục, tính tiền theo giây dù có request hay không. Muốn nhận traffic Internet phải có IP public (access_config) và firewall mở cổng cho tag của VM.",
  defaults:n=>vmDefaults(n,"web"),name:p=>p.name,fields:vmFields,variant:p=>{const a=getP(p,"labels.app");return a&&T["google_compute_instance#"+a]?"google_compute_instance#"+a:null},
  rel:{"network_interface.subnetwork":{kind:"contains",label:""}}});
for(const[app,label,short,doc]of[["rabbitmq","RabbitMQ trên VM","RMQ","Google Cloud không có RabbitMQ được quản lý sẵn, nên tự chạy RabbitMQ trên một VM (hoặc mua qua Marketplace / CloudAMQP). Bạn trả tiền VM + ổ đĩa, và tự lo cập nhật, sao lưu. Cổng 5672 (AMQP), 15672 (trang quản trị)."],
  ["redis","Redis tự cài trên VM","RDS","Redis tự chạy trên VM: rẻ hơn Memorystore ở cỡ nhỏ, nhưng không có failover, backup hay vá lỗi tự động."],
  ["kafka","Kafka tự cài trên VM","KFK","Kafka một node trên VM: rẻ để học, nhưng không có bản sao, mất VM là mất dữ liệu. Managed Service for Apache Kafka lo việc này với giá tối thiểu cao hơn nhiều."]])
  def("google_compute_instance#"+app,{alias:"google_compute_instance",label,short,cat:app==="rabbitmq"||app==="kafka"?"notify":"db",doc,defaults:n=>vmDefaults(n,app),name:p=>p.name,fields:vmFields,rel:{"network_interface.subnetwork":{kind:"contains",label:""}}});
const runFields=[{k:"name",label:"Tên service",type:"text"},{k:"template.containers.image",label:"Image",type:"text"},
  {k:"template.containers.resources.limits.cpu",label:"CPU mỗi instance",type:"select",options:["1","2","4"]},{k:"template.containers.resources.limits.memory",label:"Memory mỗi instance",type:"select",options:["512Mi","1Gi","2Gi","4Gi"]},
  {k:"template.max_instance_request_concurrency",label:"Request đồng thời mỗi instance",type:"number",min:1,max:1000,help:"Mặc định 80. WebSocket: mỗi kết nối chiếm một request suốt thời gian mở."},
  {k:"template.scaling.min_instance_count",label:"Instance tối thiểu",type:"number",min:0,help:"Lớn hơn 0 thì trả tiền cả khi không có ai gọi (không bị cold start)."},
  {k:"template.scaling.max_instance_count",label:"Instance tối đa",type:"number",min:1},{k:"template.containers.resources.cpu_idle",label:"Tính tiền CPU",type:"select",bool:true,dflt:true,options:[[true,"Chỉ khi có request (request-based)"],[false,"Suốt thời gian instance chạy (instance-based, đơn giá rẻ hơn)"]],help:"Instance luôn bận (WebSocket, lưu lượng đều) thì instance-based rẻ hơn."},
  {k:"template.timeout",label:"Timeout request",type:"select",options:["60s","300s","900s","3600s"],help:"Kết nối WebSocket bị cắt khi hết timeout (tối đa 60 phút)."},
  {k:"ingress",label:"Ai vào được",type:"select",options:[["INGRESS_TRAFFIC_ALL","Internet"],["INGRESS_TRAFFIC_INTERNAL_ONLY","Chỉ trong VPC / project"],["INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER","Chỉ qua load balancer"]]},
  {k:"template.containers.env",label:"Biến môi trường",type:"tfenv",help:"Giá trị tham chiếu tới Redis, Kafka, VM RabbitMQ, Pub/Sub, bucket thì app dùng tài nguyên đó."},
  {k:"template.vpc_access",label:"Đường vào VPC (Direct VPC egress)",type:"vpcegress",help:"Cần để gọi Memorystore, Kafka hoặc VM chỉ có IP nội bộ."},
  {k:"template.service_account",label:"Service account",type:"tref",to:["google_service_account"],attr:"email"}];
const runDefaults=(n,ws)=>({name:n,location:REGION,ingress:"INGRESS_TRAFFIC_ALL",deletion_protection:false,...(ws?{labels:{protocol:"websocket"}}:{}),
  template:{timeout:ws?"3600s":"300s",max_instance_request_concurrency:ws?1000:80,scaling:{min_instance_count:0,max_instance_count:ws?10:20},
    containers:{image:`asia-southeast1-docker.pkg.dev/${PROJECT}/app/${ws?"price-stream":n}:1.0`,resources:{limits:{cpu:"1",memory:"512Mi"},cpu_idle:true},env:[]}}});
def("google_cloud_run_v2_service",{label:"Cloud Run service",short:"RUN",cat:"comp",
  doc:"Chạy container theo request, tự thêm bớt instance, về 0 khi không ai gọi. Tính tiền theo vCPU-giây và GiB-giây khi đang xử lý request, cộng số request. Mặc định không ai gọi được: phải cấp roles/run.invoker cho allUsers mới công khai.",
  defaults:n=>runDefaults(n,false),name:p=>p.name,fields:runFields,variant:p=>getP(p,"labels.protocol")==="websocket"?"google_cloud_run_v2_service#ws":null,
  rel:{"template.containers.env.*":{kind:"uses"},"template.vpc_access.*":{kind:"egress",label:"VPC egress"},"template.service_account":{kind:"runsas",label:"chạy bằng"}}});
def("google_cloud_run_v2_service#ws",{alias:"google_cloud_run_v2_service",label:"WebSocket server (Cloud Run)",short:"WS",cat:"comp",
  doc:"Cloud Run nhận WebSocket như một request kéo dài: mỗi kết nối chiếm một suất concurrency cho tới khi đóng hoặc hết timeout (tối đa 60 phút), và instance được tính tiền suốt thời gian có kết nối mở.",
  defaults:n=>runDefaults(n,true),name:p=>p.name,fields:runFields,rel:T.google_cloud_run_v2_service.rel});
def("google_cloud_run_v2_service_iam_member",{label:"Quyền gọi Cloud Run",short:"INV",cat:"sec",
  doc:"Ai được gọi service. member = \"allUsers\" với role roles/run.invoker là công khai cho cả Internet (cần cho web, API, WebSocket công khai).",
  defaults:()=>({name:null,location:REGION,role:"roles/run.invoker",member:"allUsers"}),name:p=>p.member,
  fields:[{k:"name",label:"Service",type:"tref",to:["google_cloud_run_v2_service"],attr:"name"},{k:"role",label:"Role",type:"text"},{k:"member",label:"Ai",type:"text",help:"allUsers = bất kỳ ai; serviceAccount:… = một service account."}],
  rel:{name:{kind:"applies",label:"cho phép gọi"}}});
/* ---------------- IAM ---------------- */
def("google_service_account",{label:"Service account",short:"SA",cat:"sec",
  doc:"Danh tính của app (giống IAM role của AWS). Cloud Run chạy bằng service account này; quyền đến từ các IAM binding gán role cho nó.",
  defaults:n=>({account_id:n.replace(/_/g,"-"),display_name:n}),name:p=>p.account_id,fields:[{k:"account_id",label:"Account ID",type:"text"},{k:"display_name",label:"Tên hiển thị",type:"text"}]});
const ROLES=["roles/managedkafka.client","roles/pubsub.publisher","roles/storage.objectCreator","roles/storage.objectViewer","roles/redis.viewer","roles/editor","roles/owner"];
def("google_project_iam_member",{label:"IAM binding (project)",short:"IAM",cat:"sec",
  doc:"Gán một role cho một member trên cả project. roles/editor hay roles/owner cho app là quá rộng: chỉ gán đúng role app cần.",
  defaults:()=>({project:PROJECT,role:"roles/pubsub.publisher",member:null}),name:p=>String(p.role||"").replace("roles/",""),
  fields:[{k:"role",label:"Role",type:"select",options:ROLES},{k:"member",label:"Cho ai",type:"tmember"}],
  rel:{member:{kind:"grants",label:p=>String(p.role||"").replace("roles/","")}}});
/* ---------------- cache & data ---------------- */
def("google_redis_instance",{label:"Memorystore for Redis",short:"MR",cat:"db",
  doc:"Redis do Google quản lý, chỉ có IP nội bộ trong VPC được chỉ định (authorized_network). Basic: một node, mất node là mất cache. Standard HA: có bản sao ở zone khác, giá cao hơn. Tính theo GB-giờ của dung lượng đã chọn.",
  defaults:n=>({name:n,tier:"BASIC",memory_size_gb:1,region:REGION,redis_version:"REDIS_7_2",authorized_network:null,connect_mode:"DIRECT_PEERING"}),name:p=>p.name,
  fields:[{k:"tier",label:"Tier",type:"select",options:[["BASIC","Basic (1 node)"],["STANDARD_HA","Standard HA (có bản sao)"]]},{k:"memory_size_gb",label:"Dung lượng (GB)",type:"number",min:1,max:300},
    {k:"authorized_network",label:"VPC được vào",type:"tref",to:["google_compute_network"],attr:"id"}],
  rel:{authorized_network:{kind:"contains",label:""}}});
def("google_memorystore_instance",{label:"Memorystore for Valkey",short:"VK",cat:"db",
  doc:"Valkey (bản mã nguồn mở tách từ Redis) do Google quản lý, tính theo node-giờ. Kết nối qua Private Service Connect trong VPC bạn chỉ định.",
  defaults:n=>({instance_id:n,location:REGION,shard_count:1,replica_count:0,node_type:"SHARED_CORE_NANO",engine_version:"VALKEY_8_0",deletion_protection_enabled:false,desired_auto_created_endpoints:{network:null,project_id:PROJECT}}),name:p=>p.instance_id,
  fields:[{k:"node_type",label:"Node type",type:"select",options:Object.keys(GP.valkeyNode||{SHARED_CORE_NANO:0})},{k:"shard_count",label:"Shard",type:"number",min:1},{k:"replica_count",label:"Bản sao mỗi shard",type:"number",min:0,max:2},
    {k:"desired_auto_created_endpoints.network",label:"VPC",type:"tref",to:["google_compute_network"],attr:"id"}],
  rel:{"desired_auto_created_endpoints.network":{kind:"contains",label:""}}});
def("google_storage_bucket",{label:"Cloud Storage bucket",short:"GCS",cat:"db",
  doc:"Kho object (file). Tính theo GB lưu mỗi tháng và số thao tác. public_access_prevention = \"enforced\" chặn mọi cách làm bucket công khai.",
  defaults:n=>({name:`${n}-${PROJECT}`,location:"ASIA-SOUTHEAST1",uniform_bucket_level_access:true,public_access_prevention:"enforced",force_destroy:false}),name:p=>p.name,
  fields:[{k:"name",label:"Tên bucket",type:"text"},{k:"location",label:"Location",type:"text"},{k:"public_access_prevention",label:"Chặn công khai",type:"select",options:["enforced","inherited"]}]});
/* ---------------- messaging & streaming ---------------- */
def("google_managed_kafka_cluster",{label:"Managed Kafka cluster",short:"KFK",cat:"notify",
  doc:"Apache Kafka do Google vận hành (Managed Service for Apache Kafka). Bạn chọn số vCPU và RAM của cả cluster; Google lo broker, bản sao và nâng cấp. Client kết nối qua endpoint trong subnet bạn chỉ định và xác thực bằng IAM (roles/managedkafka.client). Tính theo vCPU-giờ + GiB-giờ + ổ đĩa, kể cả khi không có message.",
  defaults:n=>({cluster_id:n,location:REGION,capacity_config:{vcpu_count:3,memory_bytes:3221225472},gcp_config:{access_config:{network_configs:{subnet:null}}},rebalance_config:{mode:"AUTO_REBALANCE_ON_SCALE_UP"}}),name:p=>p.cluster_id,
  fields:[{k:"capacity_config.vcpu_count",label:"vCPU",type:"number",min:3},{k:"capacity_config.memory_bytes",label:"RAM",type:"membytes",help:"1–8 GiB mỗi vCPU."},
    {k:"gcp_config.access_config.network_configs.subnet",label:"Subnet cho endpoint",type:"tref",to:["google_compute_subnetwork"],attr:"id"}],
  rel:{"gcp_config.access_config.network_configs.*":{kind:"contains",label:""}}});
def("google_managed_kafka_topic",{label:"Kafka topic",short:"TPC",cat:"notify",
  doc:"Một luồng message trong cluster. partition_count quyết định bao nhiêu consumer đọc song song; replication_factor 3 = mỗi message có 3 bản ở 3 zone.",
  defaults:n=>({topic_id:n,cluster:null,location:REGION,partition_count:3,replication_factor:3}),name:p=>p.topic_id,
  fields:[{k:"cluster",label:"Cluster",type:"tref",to:["google_managed_kafka_cluster"],attr:"cluster_id"},{k:"partition_count",label:"Partition",type:"number",min:1},{k:"replication_factor",label:"Bản sao",type:"number",min:1,max:3}],
  rel:{cluster:{kind:"partof",label:"thuộc cluster"}}});
def("google_pubsub_topic",{label:"Pub/Sub topic",short:"PS",cat:"notify",
  doc:"Hàng đợi / phát tin không cần máy chủ của Google: không có giá cố định, trả theo dung lượng message (mỗi lần publish tính tối thiểu 1 KB). Hợp khi lưu lượng nhỏ hoặc thất thường; Kafka hợp khi cần giữ lại và đọc lại luồng sự kiện.",
  defaults:n=>({name:n,message_retention_duration:"86600s"}),name:p=>p.name,fields:[{k:"name",label:"Tên topic",type:"text"}]});
/* ---------------- cost ---------------- */
def("google_billing_budget",{label:"Budget",short:"$",cat:"cost",
  doc:"Theo dõi chi tiêu của billing account và gửi cảnh báo khi vượt các ngưỡng %. Budget chỉ báo, không tự dừng chi tiêu. Mặc định chi tiêu được trừ credit (INCLUDE_ALL_CREDITS): trong thời gian dùng thử, credit trả hết nên budget thấy $0 và không báo.",
  defaults:()=>({billing_account:BILLING,display_name:"credit-300",amount:{specified_amount:{currency_code:"USD",units:"100"}},threshold_rules:[{threshold_percent:0.5},{threshold_percent:0.9},{threshold_percent:1.0}],
    budget_filter:{projects:[`projects/${PROJECT}`]},all_updates_rule:{monitoring_notification_channels:[]}}),name:p=>p.display_name,
  fields:[{k:"display_name",label:"Tên",type:"text"},{k:"amount.specified_amount.units",label:"Hạn mức mỗi tháng (USD)",type:"text"},{k:"threshold_rules",label:"Ngưỡng cảnh báo",type:"thresholds"},
    {k:"budget_filter.credit_types_treatment",label:"Credit",type:"select",dflt:"INCLUDE_ALL_CREDITS",options:[["INCLUDE_ALL_CREDITS","Trừ credit (mặc định)"],["EXCLUDE_ALL_CREDITS","Không trừ credit: thấy chi tiêu thật"]],help:"Đang dùng $300 credit? Chọn “Không trừ credit” để budget thấy tiền credit đang bị đốt."},
    {k:"all_updates_rule.monitoring_notification_channels",label:"Gửi tới",type:"trefs",to:["google_monitoring_notification_channel"],attr:"id"}],
  rel:{"all_updates_rule.monitoring_notification_channels.*":{kind:"notifies",label:"vượt ngưỡng"}}});
def("google_monitoring_notification_channel",{label:"Notification channel",short:"✉",cat:"cost",
  doc:"Nơi nhận cảnh báo (email, SMS, Slack…). Budget và alert policy gửi tới đây.",
  defaults:n=>({display_name:n,type:"email",labels:{email_address:EMAIL}}),name:p=>getP(p,"labels.email_address"),
  fields:[{k:"display_name",label:"Tên",type:"text"},{k:"labels.email_address",label:"Email",type:"text"}]});

/* relation look */
const REL={calls:{style:"flow"},uses:{style:"data"},egress:{style:"role"},runsas:{style:"role"},applies:{style:"grant"},grants:{style:"grant"},contains:{style:"role"},
  partof:{style:"role"},notifies:{style:"flow"},delivers:{style:"flow"},allows:{style:"grant"},publishes:{style:"flow"}};
