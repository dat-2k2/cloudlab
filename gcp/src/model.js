"use strict";
/* GCP pack · model: edges come from references between resources, as Terraform sees them (network = google_compute_network.vpc.id,
   "${google_redis_instance.cache.host}" inside an env value), plus two derived from matching: firewall rules → the VMs whose
   network tags they target, and budget → the inbox of the billing admins (default recipients). The text is Terraform HCL;
   CloudLab-only actors are cloudlab_* resources, written last and dropped for a real terraform apply. */
const TF_NAME=/^[A-Za-z_][A-Za-z0-9_-]*$/;
const relRe={};const relMatch=(pat,path)=>(relRe[pat]||(relRe[pat]=new RegExp("^"+pat.replace(/\./g,"\\.").replace(/\*/g,"[^.]+")+"(\\..*)?$"))).test(path);
/* first block id a value references */
function refOf(v){let hit=null;walkTf(v,"",(p,t,n)=>{if(!hit){const id=idFor(t,n);if(rawOf(id))hit=id}});return hit}
const refAt=(n,path)=>refOf(getP(n.props,path));
const tagsOf=n=>arr(n&&n.props.tags).map(String);
const vpcOf=n=>{if(!n)return null;switch(n.type){case"google_compute_network":return n.id;
  case"google_compute_subnetwork":return refAt(n,"network");case"google_compute_firewall":return refAt(n,"network");
  case"google_compute_instance":{const s=refAt(n,"network_interface.subnetwork");if(s)return vpcOf(nodeOf(s));return refAt(n,"network_interface.network")}
  case"google_redis_instance":return refAt(n,"authorized_network");case"google_memorystore_instance":return refAt(n,"desired_auto_created_endpoints.network");
  case"google_managed_kafka_cluster":{const s=refAt(n,"gcp_config.access_config.network_configs.subnet");return s?vpcOf(nodeOf(s)):null}}return null};
/* firewall rules that apply to a VM: same VPC, and target_tags empty or sharing a tag */
const fwFor=vm=>allNodes().filter(f=>f.type==="google_compute_firewall"&&vpcOf(f)&&vpcOf(f)===vpcOf(vm)&&String(f.props.direction||"INGRESS")==="INGRESS"&&(!arr(f.props.target_tags).length||arr(f.props.target_tags).some(t=>tagsOf(vm).includes(String(t)))));
const inboxOf=addr=>allNodes().find(x=>x.type==="cloudlab_inbox"&&x.props.address===addr)||null;
/* ---------------- edges ---------------- */
function edges(){const out=[],seen=new Set(),add=e=>{const k=e.from+">"+e.to+">"+e.kind;if(seen.has(k)||!rawOf(e.from)||!rawOf(e.to)||e.from===e.to)return;seen.add(k);e.id=k;out.push(e)};
  for(const n of allNodes()){const rel=Object.entries(n.def.rel||{});
    walkTf(n.props,"",(path,t,nm,attr)=>{if(path==="depends_on"||path.startsWith("depends_on."))return;const to=idFor(t,nm);if(!rawOf(to))return;
      const spec=rel.find(([p])=>relMatch(p,path));const r=spec?spec[1]:{kind:"ref",label:path.split(".").filter(x=>!/^\d+$/.test(x)).pop()};
      let label=typeof r.label==="function"?r.label(n.props,path,to):r.label;
      if(r.kind==="uses"){const m=/^(.*\.env\.\d+)\./.exec(path)||/^(metadata)\.([^.]+)/.exec(path);label=m?(m[2]||getP(n.props,m[1]+".name")||"env"):"dùng"}
      add({from:n.id,to,kind:r.kind,label:label||"",owner:n.id,path,hidden:r.kind==="contains"})});
    if(n.type==="google_compute_firewall"){const ports=arr(n.props.allow).map(a=>(a.protocol||"tcp")+(arr(a.ports).length?":"+arr(a.ports).join(","):"")).join(" ");
      for(const vm of allNodes())if(vm.type==="google_compute_instance"&&fwFor(vm).includes(n))add({from:n.id,to:vm.id,kind:"allows",label:"mở "+ports,owner:n.id,path:"target_tags"})}
    if(n.type==="google_monitoring_notification_channel"){const ib=inboxOf(getP(n.props,"labels.email_address"));if(ib)add({from:n.id,to:ib.id,kind:"delivers",label:"email",owner:n.id,path:"labels.email_address"})}
    if(n.type==="google_billing_budget"&&getP(n.props,"all_updates_rule.disable_default_iam_recipients")!==true){const ib=inboxOf(EMAIL);if(ib)add({from:n.id,to:ib.id,kind:"delivers",label:"admin billing (mặc định)",owner:n.id,path:"default"})}}
  return out}
/* ---------------- add / remove / rename ---------------- */
const BASE_NAME={cloudlab_client:"customers",cloudlab_inbox:"me",google_compute_network:"main",google_compute_subnetwork:"app",google_compute_firewall:"allow_web",google_compute_instance:"web",
  "google_compute_instance#rabbitmq":"rabbitmq","google_compute_instance#redis":"redis","google_compute_instance#kafka":"kafka",google_cloud_run_v2_service:"api","google_cloud_run_v2_service#ws":"price_stream",
  google_cloud_run_v2_service_iam_member:"public",google_service_account:"app",google_project_iam_member:"app_role",google_redis_instance:"cache",google_memorystore_instance:"valkey",
  google_managed_kafka_cluster:"events",google_managed_kafka_topic:"trades",google_pubsub_topic:"events",google_storage_bucket:"reports",google_billing_budget:"credit",google_monitoring_notification_channel:"email"};
function freeName(type,base){let i=1,nm=base;while(rawOf(idFor(type,nm)))nm=base+"_"+(++i);return nm}
function addNode(type,x,y,id){const d=T[type],real=baseType(type);const name=id?id.split("/").pop():freeName(real,BASE_NAME[type]||"main");id=idFor(real,name);
  const raw={Type:real,Properties:clone(d.defaults(name.replace(/_/g,"-")))};(d.ext?M.ext:M.res)[id]=raw;M.pos[id]=[Math.round(x),Math.round(y)];return id}
function removeNode(id){const n=nodeOf(id);if(!n)return;const addr=addrOf(n);delete M[n.scope][id];delete M.pos[id];
  for(const s of ["res","ext","manual"])for(const k of Object.keys(M[s])){const r=M[s][k];if(refsTo(r.Properties,addr)){r.Properties=stripTf(r.Properties,addr);
    /* an env entry or channel list left without its value is removed whole */
    const env=getP(r.Properties,"template.containers.env");if(Array.isArray(env))setP(r.Properties,"template.containers.env",env.filter(e=>e&&e.name&&e.value!==undefined))}}}
function renameNode(a,b){const n=nodeOf(a);if(!n)return{ok:false,err:"Không tìm thấy."};const name=String(b).split("/").pop().trim();if(name===tfName(n))return{ok:true,id:a};
  if(!TF_NAME.test(name))return{ok:false,err:"Tên Terraform: chữ, số, dấu _ và -, bắt đầu bằng chữ hoặc _."};const nid=idFor(n.type,name);if(rawOf(nid))return{ok:false,err:`${n.type}.${name} đã tồn tại.`};
  const from=addrOf(n),to=n.type+"."+name;const reb=o=>{const r={};for(const k of Object.keys(o))r[k===a?nid:k]=o[k];return r};M[n.scope]=reb(M[n.scope]);M.pos=reb(M.pos);
  for(const s of ["res","ext","manual"])for(const k of Object.keys(M[s]))M[s][k].Properties=renameTfRefs(M[s][k].Properties,from,to);return{ok:true,id:nid}}
function removeEdge(e){const o=nodeOf(e.owner);if(!o)return;const p=o.props;
  if(e.kind==="allows"){const vm=nodeOf(e.to),tt=arr(p.target_tags).map(String);if(!tt.length){p.target_tags=["chua-gan"];return}vm.props.tags=tagsOf(vm).filter(t=>!tt.includes(t));return}
  if(e.kind==="delivers"&&e.path==="default"){setP(p,"all_updates_rule.disable_default_iam_recipients",true);return}
  if(e.kind==="delivers"){setP(p,"labels.email_address","");return}
  if(e.kind==="uses"){const m=/^(.*\.env)\.(\d+)\./.exec(e.path);if(m){const L=getP(p,m[1]);if(Array.isArray(L))L.splice(+m[2],1);return}const mm=/^metadata\.([^.]+)/.exec(e.path);if(mm){delete p.metadata[mm[1]];return}}
  const ks=e.path.split(".");for(let i=ks.length-1;i>0;i--)if(/^\d+$/.test(ks[i])){const parent=getP(p,ks.slice(0,i).join("."));if(Array.isArray(parent)){parent.splice(+ks[i],1);return}}
  if(e.kind==="egress"){delete p.template.vpc_access;return}
  setP(p,e.path,e.kind==="calls"?null:undefined)}
/* ---------------- connecting two blocks ---------------- */
const ENV_FOR={google_redis_instance:["REDIS_HOST",n=>"${"+addrOf(n)+".host}"],google_memorystore_instance:["VALKEY_HOST",n=>"${"+addrOf(n)+".discovery_endpoints[0].address}"],
  google_managed_kafka_cluster:["KAFKA_BOOTSTRAP",n=>`bootstrap.\${${addrOf(n)}.cluster_id}.${REGION}.managedkafka.${PROJECT}.cloud.goog:9092`],
  google_managed_kafka_topic:["KAFKA_TOPIC",n=>"${"+addrOf(n)+".topic_id}"],google_pubsub_topic:["PUBSUB_TOPIC",n=>"${"+addrOf(n)+".id}"],google_storage_bucket:["BUCKET",n=>"${"+addrOf(n)+".name}"],
  google_compute_instance:[n=>({rabbitmq:"AMQP_URL",redis:"REDIS_HOST",kafka:"KAFKA_BOOTSTRAP",web:"BACKEND_URL"})[appOf(n)],n=>{const ip="${"+addrOf(n)+".network_interface[0].network_ip}";return({rabbitmq:`amqp://${ip}:5672`,redis:ip,kafka:ip+":9092",web:"http://"+ip})[appOf(n)]}]};
/* what a dependency needs: a path into the VPC (private IP), an IAM role on the service account */
const NEEDS_VPC=new Set(["google_redis_instance","google_memorystore_instance","google_managed_kafka_cluster","google_managed_kafka_topic","google_compute_instance"]);
const ROLE_FOR={google_managed_kafka_cluster:"roles/managedkafka.client",google_managed_kafka_topic:"roles/managedkafka.client",google_pubsub_topic:"roles/pubsub.publisher",google_storage_bucket:"roles/storage.objectCreator"};
const runSa=r=>refAt(r,"template.service_account");
const subnetIn=vpc=>allNodes().find(s=>s.type==="google_compute_subnetwork"&&refAt(s,"network")===vpc)||null;
const roleBound=(sa,role)=>!!sa&&allNodes().some(b=>b.type==="google_project_iam_member"&&b.props.role===role&&refAt(b,"member")===sa);
function bindRole(sa,role){const nm=freeName("google_project_iam_member",tfName(nodeOf(sa))+"_"+role.split(/[./]/).pop().replace(/[^A-Za-z0-9]/g,"_").toLowerCase()),id=idFor("google_project_iam_member",nm);
  M.res[id]={Type:"google_project_iam_member",Properties:{project:PROJECT,role,member:"serviceAccount:${"+addrOf(nodeOf(sa))+".email}"}};const p=M.pos[sa]||[0,0];M.pos[id]=[p[0]+40,p[1]+190]}
function setEgress(run,subnet){const s=nodeOf(subnet);setP(run.props,"template.vpc_access",{network_interfaces:{network:X(addrOf(nodeOf(vpcOf(s)))+".id"),subnetwork:X(addrOf(s)+".id")},egress:"PRIVATE_RANGES_ONLY"})}
function connectRule(a,b){const A=nodeOf(a),B=nodeOf(b);if(!A||!B||a===b)return null;const ta=A.type,tb=B.type,say=(label,apply,grant)=>({label,apply,grant});
  if(ta==="cloudlab_client"&&(tb==="google_cloud_run_v2_service"||tb==="google_compute_instance"))return say(tb==="google_compute_instance"?"gọi thẳng IP public của VM":A.props.protocol==="websocket"?"mở kết nối WebSocket tới service":"gửi request tới service",
    ()=>{A.props.target=ref(b,tb==="google_compute_instance"?"network_interface[0].access_config[0].nat_ip":"uri")});
  if(ta==="google_compute_subnetwork"&&tb==="google_compute_network")return say("thuộc VPC này",()=>{A.props.network=ref(b,"id")});
  if(ta==="google_compute_instance"&&tb==="google_compute_subnetwork")return say("đặt VM vào subnet",()=>{setP(A.props,"network_interface.subnetwork",ref(b,"id"))});
  if(ta==="google_compute_firewall"&&tb==="google_compute_network")return say("áp cho VPC này",()=>{A.props.network=ref(b,"name")});
  if(ta==="google_compute_firewall"&&tb==="google_compute_instance"){const tag=tagsOf(B)[0]||appOf(B);
    return say(`áp cho VM có tag ${tag}`,()=>{if(!tagsOf(B).includes(tag))B.props.tags=tagsOf(B).concat([tag]);A.props.target_tags=arr(A.props.target_tags).map(String).filter(t=>t!=="chua-gan");if(!A.props.target_tags.includes(tag))A.props.target_tags.push(tag);if(!A.props.network&&vpcOf(B))A.props.network=ref(vpcOf(B),"name")})}
  if(ta==="google_redis_instance"&&tb==="google_compute_network")return say("cho VPC này vào Redis (authorized_network)",()=>{A.props.authorized_network=ref(b,"id")});
  if(ta==="google_memorystore_instance"&&tb==="google_compute_network")return say("tạo endpoint trong VPC này",()=>{setP(A.props,"desired_auto_created_endpoints",{network:ref(b,"id"),project_id:PROJECT})});
  if(ta==="google_managed_kafka_cluster"&&tb==="google_compute_subnetwork")return say("đặt endpoint Kafka trong subnet này",()=>{setP(A.props,"gcp_config.access_config.network_configs",{subnet:ref(b,"id")})});
  if(ta==="google_managed_kafka_topic"&&tb==="google_managed_kafka_cluster")return say("thuộc cluster này",()=>{A.props.cluster=ref(b,"cluster_id")});
  if(ta==="google_cloud_run_v2_service_iam_member"&&tb==="google_cloud_run_v2_service")return say("cấp quyền gọi service này",()=>{A.props.name=ref(b,"name");A.props.location=REGION});
  if(ta==="google_project_iam_member"&&tb==="google_service_account")return say("gán role cho service account này",()=>{A.props.member="serviceAccount:${"+addrOf(B)+".email}"});
  if(ta==="google_billing_budget"&&tb==="google_monitoring_notification_channel")return say("vượt ngưỡng → gửi tới channel",()=>{const L=arr(getP(A.props,"all_updates_rule.monitoring_notification_channels"));if(!L.some(x=>refOf(x)===b))L.push(ref(b,"id"));setP(A.props,"all_updates_rule.monitoring_notification_channels",L)});
  if(ta==="google_billing_budget"&&tb==="cloudlab_inbox")return say("gửi cho admin billing (người nhận mặc định)",()=>{setP(A.props,"all_updates_rule.disable_default_iam_recipients",false)});
  if(ta==="google_monitoring_notification_channel"&&tb==="cloudlab_inbox")return say("gửi email tới hộp thư này",()=>{setP(A.props,"labels.email_address",B.props.address)});
  if(ta==="google_cloud_run_v2_service"){
    if(tb==="google_service_account")return say("chạy bằng service account này",()=>{setP(A.props,"template.service_account",ref(b,"email"))});
    if(tb==="google_compute_subnetwork")return say("đường ra VPC qua subnet này (Direct VPC egress)",()=>setEgress(A,b));
    const ev=ENV_FOR[tb];if(ev){const k0=typeof ev[0]==="function"?ev[0](B):ev[0],val=ev[1](B),vpc=vpcOf(B),sa=runSa(A),role=ROLE_FOR[tb];
      const needVpc=NEEDS_VPC.has(tb)&&vpc&&!getP(A.props,"template.vpc_access"),sub=needVpc&&(tb==="google_managed_kafka_cluster"||tb==="google_managed_kafka_topic"?refAt(B.type==="google_managed_kafka_topic"?nodeOf(refAt(B,"cluster"))||B:B,"gcp_config.access_config.network_configs.subnet"):null)||(needVpc&&(subnetIn(vpc)||{}).id);
      const extra=[needVpc&&sub?`thêm đường ra VPC qua ${sub}`:null,role&&sa&&!roleBound(sa,role)?`gán ${role} cho ${sa}`:null].filter(Boolean);
      return say(`app dùng ${B.def.label} (biến ${k0})`,grant=>{const env=arr(getP(A.props,"template.containers.env"));let k=k0;if(env.some(e=>e.name===k))k=k+"_"+(env.length+1);env.push({name:k,value:val});setP(A.props,"template.containers.env",env);
        if(grant){if(needVpc&&sub)setEgress(A,sub);if(role&&sa&&!roleBound(sa,role))bindRole(sa,role)}},extra.length?{text:extra.join("; ")}:null)}}
  if(ta==="google_compute_instance"&&ENV_FOR[tb]){const ev=ENV_FOR[tb],k=typeof ev[0]==="function"?ev[0](B):ev[0];
    return say(`app trên VM dùng ${B.def.label} (metadata ${k})`,()=>{A.props.metadata=Object.assign({},A.props.metadata||{},{[k]:ev[1](B)})})}
  return null}
function whyNot(a,b){const A=nodeOf(a),B=nodeOf(b);if(!A||!B)return"";
  const can={cloudlab_client:"Cloud Run service hoặc VM có IP public",google_compute_subnetwork:"VPC",google_compute_instance:"subnet, Redis, Kafka, VM khác, Pub/Sub, bucket",google_compute_firewall:"VPC hoặc VM",
    google_cloud_run_v2_service:"Redis, Valkey, Kafka, VM, Pub/Sub, bucket, subnet hoặc service account",google_redis_instance:"VPC",google_memorystore_instance:"VPC",google_managed_kafka_cluster:"subnet",
    google_managed_kafka_topic:"Kafka cluster",google_cloud_run_v2_service_iam_member:"Cloud Run service",google_project_iam_member:"service account",google_billing_budget:"notification channel hoặc hộp thư",
    google_monitoring_notification_channel:"hộp thư",google_compute_network:"(VPC chỉ nhận mũi tên đi vào)",google_service_account:"(service account chỉ nhận mũi tên đi vào)",cloudlab_inbox:"(hộp thư chỉ nhận)"}[A.type];
  if(can&&can[0]==="(")return`${A.def.label} không nối đi đâu ${can}`;return can?`${A.def.label} chỉ nối tới ${can}`:`${A.def.label} không nối đi đâu được`}
/* ---------------- Terraform text ---------------- */
const TYPE_ORDER=["google_compute_network","google_compute_subnetwork","google_compute_firewall","google_service_account","google_project_iam_member","google_compute_instance","google_redis_instance",
  "google_memorystore_instance","google_managed_kafka_cluster","google_managed_kafka_topic","google_pubsub_topic","google_storage_bucket","google_cloud_run_v2_service","google_cloud_run_v2_service_iam_member",
  "google_monitoring_notification_channel","google_billing_budget"];
const HEAD_DEFAULT=()=>[{type:"terraform",labels:[],o:{required_providers:{google:{source:"hashicorp/google",version:"~> 6.0"}}}},
  {type:"provider",labels:["google"],o:{project:X("var.project_id"),region:REGION}},{type:"variable",labels:["project_id"],o:{type:X("string"),default:PROJECT}}];
BLOCK_KEYS.add("required_providers");MAP_KEYS.add("google");
function toYaml(m,opts){m=m||M;opts=opts||{};const parts=[`# CloudLab GCP · ${m.name}${m.desc?" · "+m.desc:""}`];
  for(const h of (m.tf&&m.tf.head)||HEAD_DEFAULT())parts.push(hclBlock(h.type,h.labels,h.o));
  const res=Object.entries(m.res).sort((x,y)=>{const ix=TYPE_ORDER.indexOf(x[1].Type),iy=TYPE_ORDER.indexOf(y[1].Type);return(ix<0?99:ix)-(iy<0?99:iy)});
  for(const[id,r]of res)parts.push(hclBlock("resource",[r.Type,id.split("/").pop()],r.Properties||{}));
  if(!opts.clean&&Object.keys(m.ext).length){parts.push("# ---- CloudLab: phần mô phỏng (khách hàng, hộp thư). Không có trong Terraform thật; bỏ đi khi apply.");
    for(const[id,r]of Object.entries(m.ext))parts.push(hclBlock("resource",[r.Type,id.split("/").pop()],r.Properties||{}))}
  return parts.join("\n\n")+"\n"}
function fromYaml(text,keep){keep=keep||{};let doc;try{doc=hclParse(text)}catch(e){return{ok:false,err:e.message||"HCL lỗi",line:e.line||null}}
  const m=emptyModel(keep.name);m.manual=clone(keep.manual||{});m.tf={head:[]};const first=/^#\s*CloudLab GCP · [^·\n]+(?: · (.*))?$/.exec(String(text).split("\n")[0]||"");m.desc=first&&first[1]||"";
  for(const b of doc.blocks){if(b.type!=="resource"){if(b.type==="module")return{ok:false,err:`module chưa được hỗ trợ, hãy viết thẳng các resource.`,line:b.line};m.tf.head.push({type:b.type,labels:b.labels,o:bodyToObj(b.body)});continue}
    const[type,name]=b.labels;if(!type||!name)return{ok:false,err:`resource cần 2 nhãn, ví dụ resource "google_compute_network" "main"`,line:b.line};
    if(!TF_NAME.test(name))return{ok:false,err:`tên ${name} không hợp lệ (chữ, số, _ và -)`,line:b.line};
    if(!/^(google|cloudlab)_/.test(type))return{ok:false,err:`${type} không thuộc provider google (CloudLab GCP chỉ đọc google_* và cloudlab_*)`,line:b.line};
    if(type.startsWith("cloudlab_")&&!T[type])return{ok:false,err:`không có ${type} (có cloudlab_client, cloudlab_inbox)`,line:b.line};
    const id=idFor(type,name);if(m.res[id]||m.ext[id])return{ok:false,err:`${type}.${name} khai báo hai lần`,line:b.line};
    (type.startsWith("cloudlab_")?m.ext:m.res)[id]={Type:type,Properties:bodyToObj(b.body)}}
  if(!m.tf.head.length)m.tf.head=HEAD_DEFAULT();
  const old=keep.pos||{},col={cloudlab_client:0,cloudlab_inbox:0,google_cloud_run_v2_service_iam_member:1,google_cloud_run_v2_service:1,google_billing_budget:1,google_monitoring_notification_channel:1,
    google_service_account:2,google_project_iam_member:2,google_compute_network:3,google_compute_subnetwork:3,google_compute_firewall:3,google_compute_instance:3,google_redis_instance:4,
    google_memorystore_instance:4,google_managed_kafka_cluster:4,google_managed_kafka_topic:4,google_pubsub_topic:5,google_storage_bucket:5},cnt={};
  for(const id of [...Object.keys(m.ext),...Object.keys(m.res),...Object.keys(m.manual)]){if(old[id]){m.pos[id]=old[id];continue}const t=(m.res[id]||m.ext[id]||m.manual[id]).Type,c=col[t]??5;cnt[c]=(cnt[c]||0)+1;m.pos[id]=[40+c*340,60+(cnt[c]-1)*190]}
  return{ok:true,model:m}}
function loadTemplate(text,layout,name,manual){const r=fromYaml(text,{name,pos:layout||{},manual:manual||{}});if(!r.ok)throw new Error(name+": "+r.err+(r.line?" @"+r.line:""));return r.model}
