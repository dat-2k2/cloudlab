"use strict";
/* GCP pack · simulation: the Terraform configuration applied to one project (the clock, queue and counters are in shell/sim.js).
   Clients send HTTP requests or hold WebSocket connections; Cloud Run scales instances by concurrency; an app reaches
   Memorystore, Kafka and VMs only through its VPC path and firewall, and Kafka / Pub/Sub / Storage only with an IAM role.
   Costs per GP (src/prices.js). On a free-trial account the $300 credit pays the bill until it runs out or 90 days pass;
   then billing stops and so does everything. Budgets see spend net of credits unless told otherwise. */
DOMAIN.runtime=()=>({inbox:{},run:{},vm:{},kafka:{},budget:{},cl:{},trial:true,credMonth:0,ended:null});
DOMAIN.onNewMonth=()=>{for(const b of Object.values(RT.budget))b.fired=[];RT.credMonth=0};
const stackUp=()=>["CREATE_COMPLETE","UPDATE_COMPLETE","SUSPENDED"].includes(RT.stack.status);
const suspended=()=>RT.stack.status==="SUSPENDED";
function exists(id){const s=scopeOf(id);if(!s)return false;if(s==="ext"||s==="manual")return true;return stackUp()}
const runSpec=n=>{const t=n.props.template||{},c=arr(t.containers)[0]||t.containers||{};const cpu=parseFloat(getP(c,"resources.limits.cpu")||"1")||1,mem=String(getP(c,"resources.limits.memory")||"512Mi");
  const gib=/Gi$/.test(mem)?parseFloat(mem):/Mi$/.test(mem)?parseFloat(mem)/1024:/G$/.test(mem)?parseFloat(mem)*0.931:0.5;
  return{cpu,gib,conc:Math.max(1,+(t.max_instance_request_concurrency??80)),min:+(getP(t,"scaling.min_instance_count")??0),max:+(getP(t,"scaling.max_instance_count")??100),
    timeout:parseFloat(String(t.timeout||"300s"))||300,idle:getP(c,"resources.cpu_idle")!==false,ws:getP(n.props,"labels.protocol")==="websocket"}};
const isPublicRun=n=>allNodes().some(b=>b.type==="google_cloud_run_v2_service_iam_member"&&refAt(b,"name")===n.id&&b.props.role==="roles/run.invoker"&&b.props.member==="allUsers");
/* ---------------- terraform apply / destroy ---------------- */
function applyErrors(){const out=[];
  for(const n of allNodes()){if(n.ext)continue;const p=n.props;
    if(n.type==="google_managed_kafka_cluster"){const v=+getP(p,"capacity_config.vcpu_count")||0,g=(+getP(p,"capacity_config.memory_bytes")||0)/1073741824;
      if(v<3)out.push(`${addrOf(n)}: capacity_config.vcpu_count phải ≥ 3`);else if(g<v||g>8*v)out.push(`${addrOf(n)}: memory_bytes phải từ 1 đến 8 GiB mỗi vCPU (${v} vCPU → ${v}–${8*v} GiB)`);
      if(!refAt(n,"gcp_config.access_config.network_configs.subnet"))out.push(`${addrOf(n)}: thiếu gcp_config.access_config.network_configs.subnet`)}
    if(n.type==="google_managed_kafka_topic"&&!refAt(n,"cluster"))out.push(`${addrOf(n)}: cluster chưa trỏ tới Kafka cluster nào`);
    if(n.type==="google_compute_subnetwork"&&!refAt(n,"network"))out.push(`${addrOf(n)}: thiếu network`);
    if(n.type==="google_compute_instance"&&!refAt(n,"network_interface.subnetwork")&&!refAt(n,"network_interface.network"))out.push(`${addrOf(n)}: network_interface chưa có subnetwork (project không có VPC default)`);
    if(n.type==="google_redis_instance"&&!refAt(n,"authorized_network"))out.push(`${addrOf(n)}: authorized_network trống nên dùng VPC "default", nhưng project không có VPC default`);}
  if(RT.trial){const vcpu=allNodes().filter(n=>n.type==="google_compute_instance").reduce((a,n)=>a+((MACHINES[n.props.machine_type]||{}).burst||(MACHINES[n.props.machine_type]||{}).vcpu||2),0);
    if(GP.trial.vcpu&&vcpu>GP.trial.vcpu)out.push(`Free trial chỉ cho ${GP.trial.vcpu} core Compute Engine chạy cùng lúc; các VM đang cần ${vcpu} vCPU (CloudLab đếm vCPU danh nghĩa, e2-micro/small/medium = 2).`)}
  return out}
function syncRuntime(){}
function deploy(){const cli="terraform init\nterraform plan -out tfplan\nterraform apply tfplan";const errs=applyErrors();
  if(errs.length){RT.stack={status:stackUp()&&!suspended()?RT.stack.status:"APPLY_FAILED"};log("CLI","terraform","apply",`Error: ${errs[0]}${errs.length>1?` (+${errs.length-1} lỗi)`:""}`,"bad",cli);errs.forEach(e=>log("Sự kiện","terraform","Error",e,"bad"));return false}
  if(suspended()){log("CLI","terraform","apply","Error 403: billing account của project đã ngưng (hết dùng thử). Nâng cấp lên tài khoản trả tiền để chạy tiếp.","bad",cli);return false}
  const was=stackUp();RT.stack={status:was?"UPDATE_COMPLETE":"CREATE_COMPLETE"};const k=Object.keys(M.res).length;
  log("CLI","terraform","apply",`Apply complete! Resources: ${was?0:k} added, ${was?k:0} changed, 0 destroyed.`,"ok",cli);return true}
DOMAIN.redeploy=(label)=>{if(!stackUp())return;const errs=applyErrors();if(errs.length){log("CLI","terraform","apply",`Error: ${errs[0]}`,"bad","terraform apply");return}
  if(!suspended())RT.stack.status="UPDATE_COMPLETE";log("CLI","terraform","apply",`Apply complete! Resources: 0 added, 1 changed, 0 destroyed.${label?" · "+label:""}`,"ok","terraform apply")};
function deleteStack(){if(!stackUp()){log("CLI","terraform","destroy","Chưa có gì để destroy","bad");return}
  const locked=allNodes().filter(n=>n.type==="google_cloud_run_v2_service"&&n.props.deletion_protection!==false);
  if(locked.length){log("CLI","terraform","destroy",`Error: cannot destroy service without setting deletion_protection=false and running \`terraform apply\` (${locked.map(addrOf).join(", ")})`,"bad","terraform destroy");return}
  const k=Object.keys(M.res).length;RT.stack={status:"DELETE_COMPLETE"};for(const id of Object.keys(M.res)){delete RT.n[id];delete RT.run[id];delete RT.vm[id];delete RT.kafka[id]}RT.q=[];
  log("CLI","terraform","destroy",`Destroy complete! Resources: ${k} destroyed.`,"ok","terraform destroy")}
/* ---------------- email ---------------- */
function mail(addr,m){const ib=inboxOf(addr);if(!ib)return;const L=RT.inbox[ib.id]||(RT.inbox[ib.id]=[]);L.unshift({id:"m"+(++RT.seq),t:stamp(),read:false,...m,n:1});if(L.length>50)L.length=50;bump(ib.id,"mail",1)}
/* ---------------- dependencies of an app (Cloud Run env / VM metadata) ---------------- */
function depsOfApp(n){const out=[];const add=(name,v)=>{const id=refOf(v);if(id&&!out.some(d=>d.id===id))out.push({name,id})};
  if(n.type==="google_cloud_run_v2_service")for(const e of arr(getP(n.props,"template.containers.env")))if(e)add(e.name,e.value);
  if(n.type==="google_compute_instance")for(const[k,v]of Object.entries(n.props.metadata||{}))add(k,v);return out}
/* can app `a` reach dependency `d` over the network? */
function netPath(a,d){const dn=nodeOf(d),dv=vpcOf(dn);if(!dn)return{ok:false,why:"không tìm thấy"};
  if(!NEEDS_VPC.has(dn.type))return{ok:true};
  const target=dn.type==="google_managed_kafka_topic"?nodeOf(refAt(dn,"cluster")):dn,tv=target?vpcOf(target):dv;
  if(!tv)return{ok:false,why:`${d} chưa nằm trong VPC nào`};
  let av=null,src=null;if(a.type==="google_cloud_run_v2_service"){const s=refAt(a,"template.vpc_access.network_interfaces.subnetwork");av=s?vpcOf(nodeOf(s)):refAt(a,"template.vpc_access.network_interfaces.network");src=s?nodeOf(s):null;
    if(!av)return{ok:false,why:`Cloud Run không có đường vào VPC: kết nối tới IP nội bộ của ${d} bị timeout (thêm vpc_access: Direct VPC egress qua một subnet của ${tv})`}}
  else{av=vpcOf(a);src=nodeOf(refAt(a,"network_interface.subnetwork"))}
  if(av!==tv)return{ok:false,why:`${a.id} ở VPC ${av}, ${d} ở VPC ${tv}: hai mạng không thông nhau`};
  if(dn.type==="google_compute_instance"){const port=APP_PORT[appOf(dn)]||80,cidr=src?String(src.props.ip_cidr_range||""):"";
    const ok=fwFor(dn).some(f=>arr(f.props.allow).some(r=>(r.protocol==="all"||r.protocol==="tcp")&&(!arr(r.ports).length||arr(r.ports).some(x=>portIn(port,x))))&&arr(f.props.source_ranges).some(s=>s==="0.0.0.0/0"||cidrCovers(s,cidr)));
    if(!ok)return{ok:false,why:`Firewall chặn tcp/${port} từ ${cidr||a.id} tới ${d} (cần luật INGRESS cho cổng ${port}, nguồn ${cidr||"subnet của app"}, target tag ${tagsOf(dn)[0]||"của VM"})`}}
  return{ok:true}}
const portIn=(p,x)=>{const s=String(x);if(s.includes("-")){const[a,b]=s.split("-").map(Number);return p>=a&&p<=b}return+s===p};
const ip4n=s=>{const m=/^(\d+)\.(\d+)\.(\d+)\.(\d+)(?:\/(\d+))?$/.exec(String(s||"").trim());if(!m)return null;return{net:((+m[1]<<24)>>>0)+(+m[2]<<16)+(+m[3]<<8)+(+m[4]),bits:m[5]==null?32:+m[5]}};
function cidrCovers(outer,inner){const o=ip4n(outer),i=ip4n(inner);if(!o||!i)return false;if(i.bits<o.bits)return false;const mask=o.bits===0?0:(~0<<(32-o.bits))>>>0;return((o.net&mask)>>>0)===((i.net&mask)>>>0)}
/* the identity an app runs as and whether it holds a role */
function appRole(a,role){if(a.type!=="google_cloud_run_v2_service")return{ok:true};const sa=runSa(a);
  if(!sa)return{ok:true,dflt:true};return roleBound(sa,role)||roleBound(sa,"roles/editor")||roleBound(sa,"roles/owner")?{ok:true}:{ok:false,why:`PERMISSION_DENIED: ${sa} chưa có ${role}`}}
/* one request (w of them) through an app's dependencies; returns the weight that failed and why */
function useDeps(a,w,at){let errW=0,why=null;
  for(const d of depsOfApp(a)){const dn=nodeOf(d.id);if(!dn)continue;
    if(!exists(d.id)){errW=w;why=`${d.id} chưa được tạo`;flow(a.id,d.id,"uses",w,why);continue}
    const net=netPath(a,d.id);if(!net.ok){errW=w;why=net.why;flow(a.id,d.id,"uses",w,net.why);continue}
    const role=ROLE_FOR[dn.type];if(role){const r=appRole(a,role);if(!r.ok){errW=w;why=r.why;flow(a.id,d.id,"uses",w,r.why);continue}}
    const r=depIn({to:d.id,from:a.id,w,at,data:{kb:1}},TICK_DT||1)||{};if(r.errW){errW=Math.max(errW,r.errW);why=r.why;flow(a.id,d.id,"uses",r.errW,r.why);if(w>r.errW)flow(a.id,d.id,"uses",w-r.errW)}else flow(a.id,d.id,"uses",w)}
  return{errW:Math.min(w,errW),why}}
/* ---------------- handlers ---------------- */
const REQ_S=0.12,WS_KB=0.2;/* CloudLab assumption: an API request keeps an instance busy 120 ms */
function runHttp(ev,dt){const id=ev.to,n=nodeOf(id),w=ev.w,src=nodeOf(ev.from),S=runSpec(n),st=RT.run[id]||(RT.run[id]={});
  const fail=(msg,ww)=>{flow(ev.from,id,"calls",ww||w,msg);bump(id,"err",ww||w);nrt(id).lastErr=msg;return{errW:ww||w,err:msg}};
  if(suspended())return fail("Billing account đã ngưng: service không chạy");
  if(n.props.ingress&&n.props.ingress!=="INGRESS_TRAFFIC_ALL")return fail(`404: ingress = ${n.props.ingress} nên request từ Internet không vào được`);
  if(!isPublicRun(n))return fail("403 Forbidden: service chưa cho allUsers quyền roles/run.invoker (khách trên Internet không có quyền gọi)");
  const rate=w/dt,cap=S.max*S.conc/REQ_S;let over=rate>cap?w*(rate-cap)/rate:0;st.inst=Math.max(S.min,Math.min(S.max,Math.ceil(rate*REQ_S/S.conc)));st.capped=over>0;
  bump(id,"req",w);const okW=w-over;flow(ev.from,id,"calls",okW);if(over)fail(`429: hết instance (max_instance_count = ${S.max}, mỗi instance ${S.conc} request đồng thời)`,over);
  /* request-based billing: an instance is billed while it serves at least one request */
  const busy=Math.min(st.inst,Math.max(rate*REQ_S/S.conc,1-Math.exp(-rate*REQ_S)));if(S.idle){charge(id,busy*dt*S.cpu*GP.run.vcpuS,"vCPU-giây");charge(id,busy*dt*S.gib*GP.run.gibS,"GiB-giây")}else st.billInst=Math.max(st.billInst||0,st.inst)
  charge(id,okW*GP.run.req,"request");
  const d=useDeps(n,okW,ev.at);if(d.errW){bump(id,"err",d.errW);nrt(id).lastErr="500 · "+d.why}return{errW:over+d.errW,err:over?"429":d.why}}
/* WebSocket clients: `w` open connections for this tick */
function runWs(ev,dt){const id=ev.to,n=nodeOf(id),want=ev.w,S=runSpec(n),st=RT.run[id]||(RT.run[id]={}),c=RT.cl[ev.from]||(RT.cl[ev.from]={});
  const deny=msg=>{c.open=0;c.rej=want;flow(ev.from,id,"calls",want,msg);nrt(id).lastErr=msg;nrt(ev.from).lastErr=msg;bump(ev.from,"err",want);return};
  if(suspended())return deny("Billing account đã ngưng");if(n.props.ingress&&n.props.ingress!=="INGRESS_TRAFFIC_ALL")return deny(`ingress = ${n.props.ingress}: không nhận kết nối từ Internet`);
  if(!isPublicRun(n))return deny("403: chưa cho allUsers quyền roles/run.invoker nên trình duyệt không mở được WebSocket");
  const open=Math.min(want,S.max*S.conc),rej=want-open,inst=Math.max(S.min,Math.ceil(open/S.conc));st.inst=inst;st.conns=open;st.capped=rej>0;c.open=open;c.rej=rej;
  flow(ev.from,id,"calls",open);if(rej){flow(ev.from,id,"calls",rej,`${num(rej)} kết nối bị từ chối: ${S.max} instance × ${S.conc} kết nối mỗi instance = ${num(S.max*S.conc)}`);nrt(ev.from).lastErr=`${num(rej)} kết nối bị từ chối (hết instance)`}
  /* connections are cut when the request timeout ends; each reconnect is a new request */
  const reco=open*dt/S.timeout;bump(ev.from,"reconnect",reco);bump(id,"req",reco);charge(id,reco*GP.run.req,"request (kết nối lại)");
  const mpm=+(nodeOf(ev.from).props.messages_per_minute||0),msgs=open*mpm/60*dt;bump(ev.from,"recv",msgs);bump(id,"push",msgs);
  /* every instance holding a connection is busy (billed) the whole time */
  if(S.idle){charge(id,inst*dt*S.cpu*GP.run.vcpuS,"vCPU-giây");charge(id,inst*dt*S.gib*GP.run.gibS,"GiB-giây")}else st.billInst=Math.max(st.billInst||0,inst);charge(id,msgs*WS_KB/1048576*GP.egressGB,"truyền ra Internet");
  if(open)bump(ev.from,"ok",reco||0);if(rej)bump(ev.from,"err",rej*dt/60);
  /* each pushed price comes from somewhere: the service reads its dependencies once per message batch */
  if(msgs>0){const d=useDeps(n,msgs/Math.max(1,open)*Math.min(open,50),ev.at);if(d.errW){nrt(id).lastErr="Không đọc được dữ liệu giá: "+d.why}}}
function vmHttp(ev,dt){const id=ev.to,n=nodeOf(id),w=ev.w,a=appOf(n),port=APP_PORT[a]||80;
  const fail=msg=>{flow(ev.from,id,"calls",w,msg);bump(id,"err",w);nrt(id).lastErr=msg;return{errW:w,err:msg}};
  if(suspended())return fail("Billing account đã ngưng: VM đã dừng");if(!arr(getP(n.props,"network_interface.access_config")).length)return fail(`${id} không có IP public (access_config) nên Internet không tới được`);
  const ok=fwFor(n).some(f=>arr(f.props.allow).some(r=>(r.protocol==="all"||r.protocol==="tcp")&&(!arr(r.ports).length||arr(r.ports).some(x=>portIn(port,x))))&&arr(f.props.source_ranges).includes("0.0.0.0/0"));
  if(!ok)return fail(`Firewall chặn tcp/${port} từ Internet tới ${id}`);
  const cap=(VM_CAP[a]||VM_CAP.web)[n.props.machine_type]||40,rate=w/dt,over=rate>cap?w*(rate-cap)/rate:0,s=RT.vm[id]||(RT.vm[id]={});s.load=Math.max(s.load||0,rate/cap);bump(id,"req",w);flow(ev.from,id,"calls",w-over);
  if(over){bump(id,"err",over);nrt(id).lastErr=`Quá tải: ${num(rate)}/s, ${n.props.machine_type} chịu khoảng ${cap}/s`}
  const d=useDeps(n,w-over,ev.at);return{errW:over+d.errW,err:over?"quá tải":d.why}}
/* a message / command arriving at a dependency, synchronously: returns the weight refused (back-pressure) and why */
function depIn(ev,dt){const id=ev.to,n=nodeOf(id),w=ev.w,kb=ev.data&&ev.data.kb||1;
  switch(n.type){
    case"google_redis_instance":case"google_memorystore_instance":bump(id,"ops",w);return{};
    case"google_managed_kafka_topic":{bump(id,"msg",w);const c=refAt(n,"cluster");if(!c)return{errW:w,why:"topic chưa thuộc cluster nào"};flow(id,c,"partof",w);return depIn({...ev,to:c,from:id},dt)}
    case"google_managed_kafka_cluster":{bump(id,"msg",w);const s=RT.kafka[id]||(RT.kafka[id]={}),v=+getP(n.props,"capacity_config.vcpu_count")||3;s.cap=v*GP.kafka.mbpsPerVcpu;s.mbps=(nrt(id).tk.msg||0)*kb/1024/dt;s.load=s.mbps/s.cap;s.held=(s.held||0)+w*kb/1048576;
      if(s.load>1){const e=w*(1-1/s.load),why=`Producer bị throttle: ghi ${num(s.mbps)} MB/s, cluster ${v} vCPU chịu khoảng ${num(s.cap)} MB/s (ước tính CloudLab)`;bump(id,"err",e);nrt(id).lastErr=why;return{errW:e,why}}return{}}
    case"google_pubsub_topic":{const b=w*Math.max(1000,kb*1024);bump(id,"msg",w);bump(id,"bytes",b);charge(id,b/1099511627776*GP.pubsubTiB,"throughput");return{}}
    case"google_storage_bucket":bump(id,"put",w);charge(id,w*GP.gcsOpA/1000,"thao tác ghi");RT.gcsGB=(RT.gcsGB||0)+w*kb/1048576;return{};
    case"google_compute_instance":{const a=appOf(n),cap=(VM_CAP[a]||VM_CAP.web)[n.props.machine_type]||40,s=RT.vm[id]||(RT.vm[id]={});bump(id,a==="web"?"req":"msg",w);const rate=(nrt(id).tk[a==="web"?"req":"msg"]||0)/dt;s.load=Math.max(s.load||0,rate/cap);
      if(suspended()){bump(id,"err",w);nrt(id).lastErr="VM đã dừng (billing ngưng)";return{errW:w,why:"VM đã dừng"}}
      let e=0,why=null;if(rate>cap){e=Math.min(w,w*(rate-cap)/rate);why=a==="rabbitmq"?`Publisher bị chặn (memory alarm): ${num(rate)} message/s, ${n.props.machine_type} xử lý khoảng ${num(cap)}/s (ước tính CloudLab)`:`Quá tải: ${num(rate)}/s, ${n.props.machine_type} chịu khoảng ${num(cap)}/s`;bump(id,"err",e);nrt(id).lastErr=why}
      if(a==="web"){const d=useDeps(n,w-e,ev.at);if(d.errW){e+=d.errW;why=d.why}}return{errW:Math.min(w,e),why}}}return{}}
function handle(ev,T1){RT.ops++;const dt=TICK_DT||1;
  switch(ev.type){
    case"req":{const tn=nodeOf(ev.to),src=ev.from;if(!tn||!exists(ev.to)){flow(src,ev.to,"calls",ev.w,"Chưa được tạo (bấm terraform apply)");bump(src,"err",ev.w);nrt(src).lastErr="Chưa được tạo";return}
      const r=tn.type==="google_cloud_run_v2_service"?runHttp(ev,dt):tn.type==="google_compute_instance"?vmHttp(ev,dt):{errW:ev.w,err:"không nhận HTTP"};const e=Math.min(ev.w,r.errW||0);bump(src,"ok",ev.w-e);if(e>0){bump(src,"err",e);nrt(src).lastErr=r.err||"lỗi"}return}
    case"ws":{const tn=nodeOf(ev.to);if(!tn||!exists(ev.to)){const c=RT.cl[ev.from]||(RT.cl[ev.from]={});c.open=0;c.rej=ev.w;flow(ev.from,ev.to,"calls",ev.w,"Chưa được tạo");return}
      if(tn.type!=="google_cloud_run_v2_service"){const c=RT.cl[ev.from]||(RT.cl[ev.from]={});c.open=0;c.rej=ev.w;flow(ev.from,ev.to,"calls",ev.w,"Đích này không chạy WebSocket server (dùng Cloud Run)");return}runWs(ev,dt);return}
    case"dep":if(exists(ev.to))depIn(ev,dt);return}}
/* ---------------- sources and the hourly side ---------------- */
function sources(t0,dt){for(const k in RT.run){RT.run[k].inst=0;RT.run[k].conns=0;RT.run[k].capped=false;RT.run[k].billInst=0}for(const k in RT.vm)RT.vm[k].load=0;for(const k in RT.kafka)RT.kafka[k].mbps=0;
  for(const n of allNodes()){if(n.type!=="cloudlab_client")continue;const tg=refOf(n.props.target);if(!tg)continue;
    if(n.props.protocol==="websocket"){const c=+n.props.connections||0;if(c>0){bump(n.id,"sent",0);push({at:t0+dt/2,to:tg,from:n.id,kind:"calls",w:c,type:"ws"})}continue}
    const rate=+n.props.rate_per_second||0;if(!rate)continue;const a=(RT.acc[n.id]||0)+rate*dt,c=Math.floor(a);RT.acc[n.id]=a-c;if(c)fire(n,c,t0+dt/2)}}
function fire(n,c,at){const tg=refOf(n.props.target);bump(n.id,"sent",c);if(tg)push({at,to:tg,from:n.id,kind:"calls",w:c,type:n.props.protocol==="websocket"?"ws":"req"})}
const redisGbH=(tier,gb)=>{const row=GP.redis.find(r=>gb<=r.max)||GP.redis[GP.redis.length-1];return tier==="STANDARD_HA"?row.std:row.basic};
/* fixed hourly price of one block, by parts (used by the meter, the inspector and the comparison page) */
function gcpPrice(n){const p=n.props,parts=[],usage=[];
  switch(n.type){
    case"google_compute_instance":{parts.push([`VM ${p.machine_type}`,GP.vm[p.machine_type]||0]);parts.push([`Ổ đĩa ${getP(p,"boot_disk.initialize_params.size")||10} GB`,(+getP(p,"boot_disk.initialize_params.size")||10)*GP.pdGBmo/HOURS_MO]);
      if(arr(getP(p,"network_interface.access_config")).length)parts.push(["IPv4 public",GP.ipv4H]);usage.push(`Truyền ra Internet ${money(GP.egressGB)}/GB`);break}
    case"google_cloud_run_v2_service":{const S=runSpec(n),ih=S.idle?S.cpu*GP.run.vcpuS*3600+S.gib*GP.run.gibS*3600:S.cpu*GP.run.instVcpuS*3600+S.gib*GP.run.instGibS*3600;
      if(S.min>0)parts.push([`${S.min} instance tối thiểu${S.idle?" (lúc rảnh)":""}`,S.min*(S.idle?3600*(S.cpu*GP.run.idleVcpuS+S.gib*GP.run.idleGibS):ih)]);
      usage.push(`${money(ih)} mỗi instance-giờ ${S.idle?"đang bận (request-based)":"đang chạy (instance-based)"} · ${S.cpu} vCPU, ${Math.round(S.gib*1024)} MiB`,`${money(GP.run.req*1e6)} / triệu request`);
      if(S.ws)usage.push(`WebSocket: ${S.conc} kết nối mỗi instance; 1.000 kết nối giữ suốt tháng ≈ ${money(Math.ceil(1000/S.conc)*HOURS_MO*ih)}/tháng, chưa tính truyền ra Internet`);break}
    case"google_redis_instance":{const gb=+p.memory_size_gb||1;parts.push([`${p.tier==="STANDARD_HA"?"Standard HA":"Basic"} ${gb} GB`,gb*redisGbH(p.tier,gb)]);break}
    case"google_memorystore_instance":{const nodes=(+p.shard_count||1)*(1+(+p.replica_count||0));parts.push([`${nodes} node ${p.node_type}`,nodes*((GP.valkeyNode||{})[p.node_type]||0)]);break}
    case"google_managed_kafka_cluster":{const v=+getP(p,"capacity_config.vcpu_count")||3,g=(+getP(p,"capacity_config.memory_bytes")||3221225472)/1073741824;parts.push([`${v} vCPU`,v*GP.kafka.vcpuH],[`${g} GiB RAM`,g*GP.kafka.gibH],[`Ổ đĩa local ${v*GP.kafka.localGiBperVcpu} GiB (100 GiB mỗi vCPU)`,v*GP.kafka.localGiBperVcpu*GP.kafka.localGiBh]);
      usage.push(`Lưu message ${money(GP.kafka.storGBmo)}/GB-tháng`);break}
    case"google_pubsub_topic":usage.push(`${money(GP.pubsubTiB)}/TiB message (mỗi lần publish tính tối thiểu 1 KB)`,GP.pubsubFreeGiB?`${GP.pubsubFreeGiB} GiB đầu mỗi tháng miễn phí (CloudLab không trừ)`:"");break;
    case"google_storage_bucket":usage.push(`${money(GP.gcsGBmo)}/GB-tháng`,`${money(GP.gcsOpA)} / 1.000 thao tác ghi`);break;
    case"google_billing_budget":case"google_monitoring_notification_channel":case"google_compute_network":case"google_compute_subnetwork":case"google_compute_firewall":case"google_service_account":case"google_project_iam_member":case"google_cloud_run_v2_service_iam_member":case"google_managed_kafka_topic":
      return{h:0,parts:[],usage:[],note:"Không tính tiền."}}
  const h=parts.reduce((a,x)=>a+x[1],0);return{h,parts,usage:usage.filter(Boolean)}}
for(const k of Object.keys(T))if(!T[k].ext)T[k].price=gcpPrice;
/* what a budget sees this month: gross spend, or spend after the free-trial credit paid part of it */
const budgetSpend=b=>{const inc=String(getP(b.props,"budget_filter.credit_types_treatment")||"INCLUDE_ALL_CREDITS")!=="EXCLUDE_ALL_CREDITS";return inc?Math.max(0,RT.total-(RT.credMonth||0)):RT.total};
function periodic(t0,dt){const t1=t0+dt;if(suspended())return;
  for(const n of allNodes()){if(n.ext||!exists(n.id))continue;const pr=gcpPrice(n);for(const[label,h]of pr.parts)charge(n.id,h*dt/3600,label);
    if(n.type==="google_cloud_run_v2_service"){const S=runSpec(n);if(!S.idle){const k=Math.max(S.min,(RT.run[n.id]||{}).billInst||0);if(k)charge(n.id,k*dt*(S.cpu*GP.run.instVcpuS+S.gib*GP.run.instGibS),"instance-giây (instance-based)")}}
    if(n.type==="google_managed_kafka_cluster"){const s=RT.kafka[n.id];if(s&&s.held)charge(n.id,s.held*GP.kafka.storGBmo*dt/MONTH,"lưu message")}
    if(n.type==="google_storage_bucket"&&RT.gcsGB)charge(n.id,RT.gcsGB*GP.gcsGBmo*dt/MONTH,"lưu trữ")}
  /* free trial: the credit pays; at $0 left or day 90, billing stops and resources stop */
  if(RT.trial){const T0=GP.trial,spent=RT.spent||0;RT.credMonth=Math.min(RT.total,Math.max(0,T0.credit-(spent-RT.total)));
    if(spent>=T0.credit||t1>=T0.days*86400){RT.stack.status="SUSPENDED";RT.ended=spent>=T0.credit?"credit":"days";
      log("Sự kiện","billing","free-trial-ended",spent>=T0.credit?`Đã dùng hết $${T0.credit} credit sau ${Math.floor(t1/86400)} ngày. Free trial kết thúc: tài nguyên bị dừng; nâng cấp lên tài khoản trả tiền để chạy tiếp.`:`Hết ${T0.days} ngày dùng thử, còn ${money(T0.credit-spent)} credit chưa dùng (bị hủy). Tài nguyên bị dừng.`,"bad");
      mail(EMAIL,{kind:"trial",subject:"Your Google Cloud free trial has ended",body:"Free trial đã kết thúc. Nâng cấp lên tài khoản trả tiền trong 30 ngày để giữ tài nguyên và dữ liệu."})}}
  else RT.credMonth=0;
  for(const b of allNodes()){if(b.type!=="google_billing_budget"||!exists(b.id))continue;const amt=+getP(b.props,"amount.specified_amount.units")||0;if(!amt)continue;const st=RT.budget[b.id]||(RT.budget[b.id]={fired:[]}),seen=budgetSpend(b);
    for(const r of arr(b.props.threshold_rules)){const th=+r.threshold_percent;if(!th||st.fired.includes(th)||seen<amt*th)continue;st.fired.push(th);
      const subj=`Budget ${b.props.display_name||tfName(b)}: đã tiêu ${Math.round(th*100)}% (${money(seen)} / ${money(amt)})`,body=`Chi tiêu tháng này của billing account đã tới ${Math.round(th*100)}% hạn mức ${money(amt)}. Budget chỉ cảnh báo, không dừng tài nguyên.`;
      const chans=arr(getP(b.props,"all_updates_rule.monitoring_notification_channels")).map(refOf).filter(Boolean);let sent=0;
      for(const c of chans){const cn=nodeOf(c);if(cn&&exists(c)){mail(getP(cn.props,"labels.email_address"),{kind:"budget",subject:subj,body});flow(b.id,c,"notifies",1);sent++}}
      if(getP(b.props,"all_updates_rule.disable_default_iam_recipients")!==true){mail(EMAIL,{kind:"budget",subject:subj,body});sent++}
      log("Sự kiện","billing","budget",`${b.props.display_name||tfName(b)} vượt ${Math.round(th*100)}%${sent?"":" nhưng không có ai nhận (đã tắt người nhận mặc định và chưa có channel)"}`,sent?"warn":"bad")}}}
const rateOf=()=>0;
