"use strict";
/* Kubernetes pack · catalog: the kinds CloudLab simulates, the container images the simulated registry knows (each
   image is an app with a port, health path, start-up time, memory and CPU cost per request), node types, and helpers.
   Model: M.res[id] = {Type: kind, Properties: the manifest without apiVersion/kind}. Ids are kubectl-style
   "deploy/ib-web", "svc/ib-web" (unique even when a Deployment and a Service share a name). Simulation-only actors
   (clients, the node pool) are documents with apiVersion cloudlab.dev/v1 and live in M.ext. */
const CLUSTER="anphat-prod",REG="registry.anphat.vn";
const GROUPS=[["ext","Ngoài cluster"],["work","Workload"],["net","Mạng"],["cfg","Cấu hình"],["store","Lưu trữ"],["sec","Bảo mật"],["scale","Tự co giãn"],["infra","Cluster"]];
const T={};
function def(type,spec){T[type]=Object.assign({type,fields:[],rel:{}},spec)}
/* kind ↔ id prefix ↔ apiVersion */
const KS={Namespace:"ns",Deployment:"deploy",StatefulSet:"sts",Service:"svc",Ingress:"ing",ConfigMap:"cm",Secret:"secret",HorizontalPodAutoscaler:"hpa",NetworkPolicy:"netpol",PersistentVolumeClaim:"pvc",CronJob:"cj","CloudLab::Client":"client","CloudLab::NodePool":"nodepool"};
const API={Namespace:"v1",Deployment:"apps/v1",StatefulSet:"apps/v1",Service:"v1",Ingress:"networking.k8s.io/v1",ConfigMap:"v1",Secret:"v1",HorizontalPodAutoscaler:"autoscaling/v2",NetworkPolicy:"networking.k8s.io/v1",PersistentVolumeClaim:"v1",CronJob:"batch/v1"};
const KIND_OF=Object.fromEntries(Object.entries(KS).map(([k,v])=>[v,k]));
const WORKLOADS=["Deployment","StatefulSet"];
/* the container images the simulated registry has. An image is an app: port it listens on, health path, seconds to
   start, memory it needs (MiB), CPU per request (ms), env vars it cannot start without, data directory (databases),
   seconds per run (batch jobs). Unknown repository → ErrImagePull; unknown tag → ImagePullBackOff. */
const IMAGES={
  [REG+"/ib-web"]:{tags:["2.4.0","2.4.1"],label:"Web Internet Banking",port:8080,health:["/healthz"],start:6,mem:160,cpu:4},
  [REG+"/core-api"]:{tags:["5.2.0","5.3.0"],label:"Core banking API",port:8080,health:["/healthz","/ready"],start:45,mem:420,cpu:12,needs:["DB_HOST","DB_PASSWORD"]},
  [REG+"/payment-api"]:{tags:["3.1.0","3.1.2"],label:"API thanh toán",port:8080,health:["/healthz"],start:8,mem:240,cpu:8},
  [REG+"/card-vault"]:{tags:["1.7.0"],label:"Kho dữ liệu thẻ (tokenization)",port:8443,health:["/healthz"],start:10,mem:200,cpu:6},
  [REG+"/admin-portal"]:{tags:["4.0.2"],label:"Back-office cho nhân viên",port:3000,health:["/health"],start:5,mem:150,cpu:5},
  [REG+"/campaign-api"]:{tags:["1.2.0"],label:"API chiến dịch marketing",port:8080,health:["/healthz"],start:5,mem:180,cpu:5},
  [REG+"/statement-api"]:{tags:["1.9.0"],label:"API sao kê",port:8080,health:["/healthz"],start:6,mem:350,cpu:6},
  [REG+"/loan-api"]:{tags:["2.2.0"],label:"API khoản vay / tra soát",port:8080,health:["/healthz"],start:10,mem:256,cpu:8,needs:["DB_HOST","DB_PASSWORD"]},
  [REG+"/recon-job"]:{tags:["2.0.0"],label:"Đối soát cuối ngày",job:true,jobSec:1500,mem:300,cpu:0,needs:["DB_HOST"]},
  "postgres":{tags:["15","16"],label:"PostgreSQL",port:5432,tcp:true,start:8,mem:300,cpu:3,needs:["POSTGRES_PASSWORD"],data:"/var/lib/postgresql/data",db:true},
  "nginx":{tags:["1.27","latest"],label:"nginx",port:80,health:["/"],start:2,mem:40,cpu:1}};
const imgParse=s=>{s=String(s||"").trim();const at=s.lastIndexOf(":"),sl=s.lastIndexOf("/");const has=at>sl;return{repo:has?s.slice(0,at):s,tag:has?s.slice(at+1):"latest"}};
/* image → {app} or {err, reason} */
function imageCheck(image){const{repo,tag}=imgParse(image);if(!repo)return{err:"InvalidImageName",msg:"image trống"};const A=IMAGES[repo];
  if(!A)return{err:"ErrImagePull",msg:`pull access denied for ${repo}, repository does not exist`};
  if(!A.tags.includes(tag))return{err:"ImagePullBackOff",msg:`manifest for ${repo}:${tag} not found: manifest unknown (tag có: ${A.tags.join(", ")})`};return{app:A,repo,tag}}
/* worker node sizes (vCPU, GiB) and on-demand price per hour, Singapore (ap-southeast-1), reference only */
const NODE_TYPES={"t3.medium":{cpu:2,mem:4,usd:0.0528},"m5.large":{cpu:2,mem:8,usd:0.12},"m5.xlarge":{cpu:4,mem:16,usd:0.24},"c5.xlarge":{cpu:4,mem:8,usd:0.196}};
const K8S_PRICE={controlPlaneH:0.10,lbH:0.0252,ipv4H:0.005,gbMonth:{gp3:0.096,standard:0.096},egressGB:0.12,note:"Giá tham khảo AWS EKS ap-southeast-1 (Singapore), on-demand, không tính free tier."};
const STORAGE_CLASSES=["gp3","standard"];
const INGRESS_NS="ingress-nginx";

/* ---------- helpers ---------- */
const meta=n=>n.props.metadata||(n.props.metadata={});
const nmOf=n=>meta(n).name||n.id.split("/").pop();
const nsOf=n=>n.type==="Namespace"||n.ext?null:(meta(n).namespace||"default");
const labelsOf=n=>meta(n).labels||{};
const podSpec=n=>n.type==="CronJob"?getP(n.props,"spec.jobTemplate.spec.template.spec"):getP(n.props,"spec.template.spec");
const podLabels=n=>(n.type==="CronJob"?getP(n.props,"spec.jobTemplate.spec.template.metadata.labels"):getP(n.props,"spec.template.metadata.labels"))||{};
const ctrOf=n=>{const s=podSpec(n);return s&&arr(s.containers)[0]||null};
const CTR=n=>n.type==="CronJob"?"spec.jobTemplate.spec.template.spec.containers.0":"spec.template.spec.containers.0";
const matches=(sel,labels)=>!!sel&&Object.entries(sel).every(([k,v])=>labels&&String(labels[k])===String(v));
const labelText=o=>Object.entries(o||{}).map(([k,v])=>`${k}=${v}`).join(", ");
/* quantities: "500m" → 500 millicores, "1" → 1000; "256Mi" → 256 MiB, "1Gi" → 1024 */
const cpuQ=v=>{if(v==null||v==="")return null;const s=String(v).trim();if(s.endsWith("m"))return parseFloat(s);const x=parseFloat(s);return isNaN(x)?null:x*1000};
const memQ=v=>{if(v==null||v==="")return null;const s=String(v).trim(),m=/^([\d.]+)\s*(Ki|Mi|Gi|Ti|K|M|G|T)?$/.exec(s);if(!m)return null;const x=parseFloat(m[1]);
  return({Ki:x/1024,Mi:x,Gi:x*1024,Ti:x*1048576,K:x*1000/1048576,M:x*1e6/1048576,G:x*1e9/1048576,T:x*1e12/1048576})[m[2]]??x/1048576};
const gbQ=v=>{const m=memQ(v);return m==null?0:m/1024};
/* objects by kind / name / namespace */
const kindNodes=k=>allNodes().filter(n=>n.type===k);
function findObj(kind,name,ns){return allNodes().find(n=>n.type===kind&&nmOf(n)===name&&(ns==null||nsOf(n)===ns))||null}
const idFor=(kind,name)=>(KS[kind]||kind.toLowerCase())+"/"+name;
/* a namespace's labels (Kubernetes adds kubernetes.io/metadata.name automatically) */
function nsLabels(ns){const n=findObj("Namespace",ns);return Object.assign({"kubernetes.io/metadata.name":ns},n?labelsOf(n):{})}
const nsExists=ns=>ns==="default"||ns===INGRESS_NS||!!findObj("Namespace",ns);
/* env vars a container sees: direct env + every key of envFrom ConfigMaps / Secrets (missing ones reported) */
function envOf(n){const c=ctrOf(n),ns=nsOf(n),out={},from={},missing=[];if(!c)return{env:out,from,missing};
  for(const ef of arr(c.envFrom)){const cm=ef.configMapRef&&ef.configMapRef.name,sc=ef.secretRef&&ef.secretRef.name,opt=(ef.configMapRef||ef.secretRef||{}).optional;
    const o=cm?findObj("ConfigMap",cm,ns):sc?findObj("Secret",sc,ns):null;if(!o){if(!opt)missing.push(cm?`configmap "${cm}" not found`:`secret "${sc}" not found`);continue}
    const d=cm?(o.props.data||{}):Object.assign({},o.props.data||{},o.props.stringData||{});for(const k of Object.keys(d)){out[k]=cm?String(d[k]):"••••";from[k]=o.id}}
  for(const e of arr(c.env)){if(!e||!e.name)continue;const vf=e.valueFrom||{};
    if(vf.secretKeyRef||vf.configMapKeyRef){const r=vf.secretKeyRef||vf.configMapKeyRef,isS=!!vf.secretKeyRef,o=findObj(isS?"Secret":"ConfigMap",r.name,ns);
      if(!o){if(!r.optional)missing.push(`${isS?"secret":"configmap"} "${r.name}" not found`);continue}
      const d=isS?Object.assign({},o.props.data||{},o.props.stringData||{}):(o.props.data||{});if(!(r.key in d)){if(!r.optional)missing.push(`couldn't find key ${r.key} in ${isS?"Secret":"ConfigMap"} ${ns}/${r.name}`);continue}
      out[e.name]=isS?"••••":String(d[r.key]);from[e.name]=o.id}
    else{out[e.name]=e.value==null?"":String(e.value);from[e.name]=null}}
  return{env:out,from,missing}}
/* service DNS names inside env values: VAR names ending in _HOST/_URL/_ADDR/_ENDPOINT/_SERVICE, or any value with :// */
const DNS_VAR=/(_HOST|_URL|_ADDR|_ADDRESS|_ENDPOINT|_SERVICE)$/;
function depsOf(n){const ns=nsOf(n),{env}=envOf(n),out=[];
  for(const[k,v]of Object.entries(env)){if(!(DNS_VAR.test(k)||/:\/\//.test(v)))continue;const m=/^(?:[a-z][a-z0-9+.-]*:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\d+))?/.exec(v.trim());if(!m)continue;
    const host=m[1],parts=host.split("."),name=parts[0];let tns=ns;if(parts.length>=2&&(parts.length===2||parts[2]==="svc"))tns=parts[1];else if(parts.length>2)continue;
    const svc=findObj("Service",name,tns),other=!svc&&parts.length===1?allNodes().find(x=>x.type==="Service"&&nmOf(x)===name):null;
    if(svc)out.push({svc:svc.id,host,port:m[2]?+m[2]:null,env:k,ok:true});else if(other)out.push({svc:other.id,host,port:m[2]?+m[2]:null,env:k,ok:false,why:`could not resolve host ${host}: Service ${name} nằm ở namespace ${nsOf(other)}, từ namespace ${ns} phải gọi ${name}.${nsOf(other)}`})}
  return out}
/* pods a Service selects come from workloads whose pod labels match the selector, same namespace */
const selected=svc=>{const sel=getP(svc.props,"spec.selector");if(!sel||!Object.keys(sel).length)return[];return allNodes().filter(w=>WORKLOADS.includes(w.type)&&nsOf(w)===nsOf(svc)&&matches(sel,podLabels(w)))};
/* the container port a Service targetPort points at (number, or a named port) */
function portNum(n,tp){if(tp==null)return null;if(!isNaN(+tp))return+tp;const p=arr((ctrOf(n)||{}).ports).find(x=>x&&x.name===tp);return p?+p.containerPort:null}

/* ---------------- kinds ---------------- */
const nsField={k:"metadata.namespace",label:"Namespace",type:"nsref",help:"Để trống = default. Namespace phải tồn tại (khung namespace trên canvas)."};
const tplFields=(c)=>[nsField,
  {k:c+".image",label:"Image",type:"text",help:`Ví dụ ${REG}/ib-web:2.4.1. Sai tag → ImagePullBackOff.`},
  {k:"spec.template.metadata.labels",label:"Nhãn của pod",type:"podlabels",help:"Service tìm pod theo nhãn này. Deployment giữ selector và nhãn pod giống nhau."},
  {k:c+".ports.0.containerPort",label:"Cổng container",type:"number",min:1,max:65535,help:"Cổng app thật sự nghe. Service phải trỏ targetPort vào đây."},
  {k:c+".envFrom",label:"Nạp cả ConfigMap / Secret (envFrom)",type:"envfrom"},
  {k:c+".env",label:"Biến môi trường",type:"envlist",help:"Biến tên *_HOST, *_URL trỏ tới tên Service là app gọi Service đó (vd DB_HOST: ledger-db, hoặc ledger-db.data nếu khác namespace)."},
  {k:c+".resources",label:"Tài nguyên (requests / limits)",type:"resources"},
  {k:c+".readinessProbe",label:"Readiness probe",type:"probe",help:"Chỉ khi probe này đạt, pod mới nhận traffic từ Service."},
  {k:c+".livenessProbe",label:"Liveness probe",type:"probe",help:"Probe này thất bại liên tiếp thì kubelet khởi động lại container."},
  {k:c+".startupProbe",label:"Startup probe",type:"probe",help:"Cho app khởi động chậm: liveness chỉ bắt đầu sau khi probe này đạt."},
  {k:"spec.template.spec.volumes",label:"Ổ đĩa (PersistentVolumeClaim)",type:"pvcmount"}];
def("CloudLab::Client",{label:"Client / khách hàng",short:"⇢",cat:"ext",ext:true,src:true,api:"cloudlab.dev/v1",kind:"Client",
  doc:"Người hoặc chương trình gửi request vào hệ thống. Từ Internet thì gọi Ingress hoặc Service kiểu LoadBalancer; đặt Namespace + nhãn để giả lập một pod bên trong cluster (như kubectl run curl).",
  defaults:()=>({spec:{target:null,ratePerSecond:5}}),
  fields:[{k:"spec.target",label:"Gọi tới",type:"target"},{k:"spec.ratePerSecond",label:"Request mỗi giây",type:"number",step:"any",min:0},
    {k:"spec.pattern",label:"Dạng tải",type:"select",options:[["","Đều"],["payday","Ngày lương về (tăng vọt rồi giảm, lặp mỗi giờ)"]]},
    {k:"spec.peak",label:"Đỉnh tải (× bình thường)",type:"number",min:1,step:"any",when:p=>getP(p,"spec.pattern")==="payday"},
    {k:"spec.host",label:"Host (khi gọi Ingress)",type:"text",help:"Ví dụ ib.anphat.vn"},{k:"spec.path",label:"Đường dẫn",type:"text",help:"Ví dụ / hoặc /admin"},
    {k:"spec.from.namespace",label:"Từ trong cluster: namespace",type:"text",help:"Để trống = từ Internet."},{k:"spec.from.labels",label:"Nhãn của pod gọi",type:"labels"},
    {k:"spec.expect",label:"Kỳ vọng",type:"select",options:[["","Nên thành công"],["Deny","Nên bị chặn"]],help:"Chọn “Nên bị chặn” khi request này lẽ ra phải bị từ chối. Mũi tên tô xanh khi bị chặn đúng."}],
  rel:{}});
def("CloudLab::NodePool",{label:"Node pool (worker node)",short:"▦",cat:"infra",ext:true,api:"cloudlab.dev/v1",kind:"NodePool",
  doc:"Các máy (EC2) chạy pod, như một EKS managed node group. Pod chỉ chạy được khi còn đủ CPU và memory trên một node. Tính tiền theo giờ chạy của từng node, cộng phí control plane của cluster.",
  defaults:()=>({spec:{instanceType:"t3.medium",nodes:3,maxNodes:3}}),
  fields:[{k:"spec.instanceType",label:"Loại máy",type:"select",options:Object.entries(NODE_TYPES).map(([k,v])=>[k,`${k} · ${v.cpu} vCPU · ${v.mem} GiB · $${v.usd}/giờ`])},
    {k:"spec.nodes",label:"Số node",type:"number",min:1,max:20},{k:"spec.maxNodes",label:"Tối đa (cluster autoscaler)",type:"number",min:1,max:40,help:"Lớn hơn số node: khi pod Pending vì thiếu chỗ, cluster tự thêm node (mất khoảng 1–2 phút)."}]});
def("Namespace",{label:"Namespace",short:"NS",cat:"infra",container:"ns",
  doc:"Một vùng tách biệt trong cluster, có tên riêng. Tên Service chỉ tự hiểu trong cùng namespace; NetworkPolicy, quota, quyền (RBAC) thường đặt theo namespace.",
  defaults:id=>({metadata:{name:id,labels:{}}}),fields:[{k:"metadata.labels",label:"Nhãn của namespace",type:"labels",help:"NetworkPolicy chọn namespace theo nhãn (namespaceSelector)."}]});
def("Deployment",{label:"Deployment",short:"DEP",cat:"work",
  doc:"Chạy và giữ đủ N bản (pod) của một app không lưu trạng thái. Đổi image hay cấu hình thì Deployment thay pod dần dần (rolling update); pod chết thì tạo pod mới.",
  defaults:id=>({metadata:{name:id,labels:{app:id}},spec:{replicas:2,selector:{matchLabels:{app:id}},template:{metadata:{labels:{app:id}},spec:{containers:[{name:id,image:REG+"/ib-web:2.4.1",ports:[{containerPort:8080}],resources:{requests:{cpu:"250m",memory:"256Mi"},limits:{cpu:"500m",memory:"512Mi"}},readinessProbe:{httpGet:{path:"/healthz",port:8080},periodSeconds:5}}]}}}}),
  fields:[...tplFields(CTR({type:"Deployment"})).slice(0,1),{k:"spec.replicas",label:"Số bản (replicas)",type:"number",min:0,max:50},...tplFields(CTR({type:"Deployment"})).slice(1)]});
def("StatefulSet",{label:"StatefulSet",short:"STS",cat:"work",
  doc:"Như Deployment nhưng cho app có dữ liệu (database): pod có tên cố định (ledger-0, ledger-1) và mỗi pod giữ ổ đĩa riêng (volumeClaimTemplates) kể cả khi bị khởi động lại.",
  defaults:id=>({metadata:{name:id},spec:{serviceName:id,replicas:1,selector:{matchLabels:{app:id}},template:{metadata:{labels:{app:id}},spec:{containers:[{name:id,image:"postgres:16",ports:[{containerPort:5432}],env:[{name:"POSTGRES_PASSWORD",valueFrom:{secretKeyRef:{name:"db",key:"password"}}}],volumeMounts:[{name:"data",mountPath:"/var/lib/postgresql/data"}],resources:{requests:{cpu:"250m",memory:"512Mi"},limits:{memory:"1Gi"}}}]}},volumeClaimTemplates:[{metadata:{name:"data"},spec:{accessModes:["ReadWriteOnce"],storageClassName:"gp3",resources:{requests:{storage:"20Gi"}}}}]}}),
  fields:[...tplFields(CTR({type:"StatefulSet"})).slice(0,1),{k:"spec.replicas",label:"Số bản (replicas)",type:"number",min:0,max:10},...tplFields(CTR({type:"StatefulSet"})).slice(1,-1),
    {k:"spec.volumeClaimTemplates.0.spec.resources.requests.storage",label:"Ổ đĩa mỗi pod (volumeClaimTemplates)",type:"text",help:"Ví dụ 20Gi. Mỗi pod có một PVC riêng, giữ nguyên khi pod khởi động lại."}]});
def("CronJob",{label:"CronJob",short:"⏱",cat:"work",src:true,
  doc:"Chạy một tác vụ theo lịch (cron), mỗi lần là một Job tạo pod chạy tới khi xong. concurrencyPolicy quyết định chuyện gì xảy ra khi lần trước chưa xong mà tới giờ chạy lần sau.",
  defaults:id=>({metadata:{name:id},spec:{schedule:"0 23 * * *",concurrencyPolicy:"Forbid",jobTemplate:{spec:{backoffLimit:1,template:{metadata:{labels:{app:id}},spec:{restartPolicy:"Never",containers:[{name:id,image:REG+"/recon-job:2.0.0",resources:{requests:{cpu:"500m",memory:"512Mi"},limits:{memory:"512Mi"}}}]}}}}}}),
  fields:[nsField,{k:"spec.schedule",label:"Lịch (cron)",type:"text",help:"*/20 * * * * = mỗi 20 phút · 0 23 * * * = 23:00 hằng ngày · @hourly"},
    {k:"spec.concurrencyPolicy",label:"Lần trước chưa xong thì",type:"select",options:[["Allow","Allow · cứ chạy thêm lần mới"],["Forbid","Forbid · bỏ qua lần mới"],["Replace","Replace · dừng lần cũ, chạy lần mới"]]},
    {k:"spec.jobTemplate.spec.activeDeadlineSeconds",label:"Thời gian tối đa mỗi lần (giây)",type:"number",min:1,help:"Quá thời gian này Job bị dừng và báo Failed."},
    {k:CTR({type:"CronJob"})+".image",label:"Image",type:"text"},{k:CTR({type:"CronJob"})+".envFrom",label:"Nạp ConfigMap / Secret (envFrom)",type:"envfrom"},{k:CTR({type:"CronJob"})+".env",label:"Biến môi trường",type:"envlist"},
    {k:CTR({type:"CronJob"})+".resources",label:"Tài nguyên",type:"resources"}]});
def("Service",{label:"Service",short:"SVC",cat:"net",
  doc:"Một địa chỉ cố định đứng trước các pod: tìm pod theo nhãn (selector) rồi chia request cho các pod đang Ready. ClusterIP chỉ dùng trong cluster; LoadBalancer tạo một load balancer có IP public (tính tiền theo giờ).",
  defaults:id=>({metadata:{name:id},spec:{type:"ClusterIP",selector:{app:id},ports:[{port:80,targetPort:8080}]}}),
  fields:[nsField,{k:"spec.type",label:"Kiểu",type:"select",options:[["ClusterIP","ClusterIP · chỉ trong cluster"],["NodePort","NodePort · cổng trên mỗi node"],["LoadBalancer","LoadBalancer · IP public, tính tiền"]]},
    {k:"spec.selector",label:"Chọn pod có nhãn (selector)",type:"labels",help:"Phải khớp đúng nhãn pod của Deployment, không thì Service không có endpoint (503)."},{k:"spec.ports",label:"Cổng",type:"svcports"}]});
def("Ingress",{label:"Ingress",short:"ING",cat:"net",
  doc:"Cửa vào HTTP/HTTPS duy nhất cho nhiều Service: chia request theo tên miền và đường dẫn (ib.anphat.vn/ → web, /api → API). Cần một ingress controller (ở đây: ingress-nginx, dùng chung một load balancer).",
  defaults:id=>({metadata:{name:id},spec:{ingressClassName:"nginx",rules:[{host:"ib.anphat.vn",http:{paths:[{path:"/",pathType:"Prefix",backend:{service:{name:"ib-web",port:{number:80}}}}]}}]}}),
  fields:[nsField,{k:"spec.ingressClassName",label:"Ingress class",type:"select",options:["nginx"]},{k:"spec.rules",label:"Luật (host + đường dẫn → Service)",type:"rules"},
    {k:"spec.tls.0.secretName",label:"TLS (Secret chứa chứng chỉ)",type:"text",help:"Để trống = chỉ HTTP. Ngân hàng: luôn bật HTTPS."}]});
def("ConfigMap",{label:"ConfigMap",short:"CM",cat:"cfg",
  doc:"Bảng cấu hình dạng khóa = giá trị (địa chỉ API, chế độ chạy…) để không phải build lại image khi đổi cấu hình. Ai đọc được namespace là đọc được ConfigMap: không chứa mật khẩu.",
  defaults:id=>({metadata:{name:id},data:{LOG_LEVEL:"info"}}),fields:[nsField,{k:"data",label:"Dữ liệu",type:"kv"}]});
def("Secret",{label:"Secret",short:"KEY",cat:"sec",
  doc:"Như ConfigMap nhưng cho mật khẩu, token, chứng chỉ: quyền đọc tách riêng, không in ra log, có thể mã hóa khi lưu. Lưu ý: data chỉ là base64, không phải mã hóa.",
  defaults:id=>({metadata:{name:id},type:"Opaque",stringData:{password:"đổi-tôi"}}),fields:[nsField,{k:"stringData",label:"Dữ liệu (stringData)",type:"kv",secret:true}]});
def("PersistentVolumeClaim",{label:"PersistentVolumeClaim",short:"PVC",cat:"store",
  doc:"Yêu cầu một ổ đĩa bền (EBS gp3…) cho pod. Dữ liệu trên PVC còn nguyên khi pod chết hay được tạo lại; ReadWriteOnce = mỗi lúc chỉ gắn vào một node.",
  defaults:id=>({metadata:{name:id},spec:{accessModes:["ReadWriteOnce"],storageClassName:"gp3",resources:{requests:{storage:"20Gi"}}}}),
  fields:[nsField,{k:"spec.resources.requests.storage",label:"Dung lượng",type:"text",help:"Ví dụ 20Gi"},{k:"spec.storageClassName",label:"Storage class",type:"select",options:["gp3","standard","fast-nvme"]},
    {k:"spec.accessModes.0",label:"Access mode",type:"select",options:[["ReadWriteOnce","ReadWriteOnce · một node"],["ReadWriteMany","ReadWriteMany · nhiều node (cần EFS)"]]}]});
def("HorizontalPodAutoscaler",{label:"HorizontalPodAutoscaler",short:"HPA",cat:"scale",
  doc:"Tự tăng giảm số pod theo tải: đo CPU trung bình của các pod so với CPU đã request, cao hơn mục tiêu thì thêm pod (tới max), thấp thì bớt (sau 5 phút ổn định). Pod không khai báo requests.cpu thì HPA không tính được.",
  defaults:id=>({metadata:{name:id},spec:{scaleTargetRef:{apiVersion:"apps/v1",kind:"Deployment",name:""},minReplicas:2,maxReplicas:10,metrics:[{type:"Resource",resource:{name:"cpu",target:{type:"Utilization",averageUtilization:70}}}]}}),
  fields:[nsField,{k:"spec.scaleTargetRef",label:"Co giãn cho",type:"scaletarget"},{k:"spec.minReplicas",label:"Ít nhất",type:"number",min:1},{k:"spec.maxReplicas",label:"Nhiều nhất",type:"number",min:1,max:100},
    {k:"spec.metrics.0.resource.target.averageUtilization",label:"Mục tiêu CPU (% của requests)",type:"number",min:10,max:100}]});
def("NetworkPolicy",{label:"NetworkPolicy",short:"NP",cat:"sec",
  doc:"Tường lửa giữa các pod. Mặc định pod nào cũng gọi được pod nào. Khi một policy chọn một pod, pod đó chỉ nhận traffic mà một luật nào đó cho phép (theo namespace, nhãn pod, cổng).",
  defaults:id=>({metadata:{name:id},spec:{podSelector:{},policyTypes:["Ingress"],ingress:[]}}),
  fields:[nsField,{k:"spec.podSelector.matchLabels",label:"Áp cho pod có nhãn",type:"labels",help:"Để trống = mọi pod trong namespace."},{k:"spec.ingress",label:"Cho phép đi vào từ",type:"peers",help:"Không có luật nào = chặn hết (default deny)."}]});
const REL={calls:{style:"flow"},routes:{style:"flow"},selects:{style:"flow"},uses:{style:"data"},mounts:{style:"data"},scales:{style:"role"},applies:{style:"role"},runs:{style:"role"}};
