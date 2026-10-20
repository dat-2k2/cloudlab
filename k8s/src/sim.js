"use strict";
/* Kubernetes pack · simulation: the manifests applied to one cluster (the clock, queue and counters are shell/sim.js).
   Every tick: the scheduler places Pending pods on nodes by their CPU / memory requests, the kubelet runs each pod
   (image pull, config, start-up time, liveness / readiness / startup probes, OOM, crash back-off), Deployments roll
   out new revisions, the HPA and the cluster autoscaler resize, CronJobs start Jobs. Requests from clients go through
   Ingress → Service → ready pods, checked against NetworkPolicy, and on to the Services an app calls by DNS. */
DOMAIN.runtime=()=>({pods:{},bad:{},hpa:{},cron:{},vol:{},nodes:[],ca:{pendingSince:null,idleSince:null},use:{},seenEv:{}});
const stackUp=()=>["CREATE_COMPLETE","UPDATE_COMPLETE"].includes(RT.stack.status);
function exists(id){const s=scopeOf(id);if(!s)return false;if(s!=="res")return true;return stackUp()}
const PULL_SEC=3;
let PODSEQ=0;const rnd=()=>(Math.random().toString(36)+"00000").slice(2,7);
const hashStr=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(16).slice(0,8)};
const revOf=n=>hashStr(JSON.stringify(getP(n.props,"spec.template")||{}));
const podsOf=id=>RT.pods[id]||(RT.pods[id]=[]);
/* one event line per pod and reason (kubectl get events style), not one per tick */
function kev(pod,reason,msg,tone){const k=pod.name+"|"+reason+"|"+(pod.restarts||0);if(RT.seenEv[k])return;RT.seenEv[k]=1;if(Object.keys(RT.seenEv).length>4000)RT.seenEv={};
  log("Sự kiện","k8s",reason,`pod/${pod.name}: ${msg}`,tone||"bad",`kubectl describe pod ${pod.name}${pod.ns&&pod.ns!=="default"?" -n "+pod.ns:""}`)}
/* ---------------- validation (what kubectl apply / the API server would reject) ---------------- */
function validate(n){const ns=nsOf(n);
  if(ns&&!nsExists(ns))return`namespaces "${ns}" not found`;
  if(WORKLOADS.includes(n.type)){const sel=getP(n.props,"spec.selector.matchLabels")||{};if(!Object.keys(sel).length)return"spec.selector: Required value";
    if(!matches(sel,podLabels(n)))return`spec.template.metadata.labels: Invalid value: ${JSON.stringify(podLabels(n))}: \`selector\` does not match template \`labels\``;
    if(!ctrOf(n))return"spec.template.spec.containers: Required value"}
  if(n.type==="CronJob"&&!cronOk(getP(n.props,"spec.schedule")))return`spec.schedule: Invalid value: "${getP(n.props,"spec.schedule")}"`;
  if(n.type==="Service"&&!arr(getP(n.props,"spec.ports")).length)return"spec.ports: Required value";
  if(typeof quotaApply==="function"){const q=quotaApply(n);if(q)return q}
  return null}
/* ---------------- nodes ---------------- */
const poolNode=()=>allNodes().find(n=>n.type==="CloudLab::NodePool")||null;
function poolSpec(){const p=poolNode(),s=p?getP(p.props,"spec")||{}:{};const it=NODE_TYPES[s.instanceType]?s.instanceType:"t3.medium",nodes=Math.max(1,+s.nodes||3);return{id:p?p.id:null,it,nodes,max:Math.max(nodes,+s.maxNodes||nodes),T:NODE_TYPES[it]}}
const allocOf=T_=>({cpu:T_.cpu*1000-200,mem:T_.mem*1024-900});
function syncNodes(){const P=poolSpec();if(RT.maint)return;if(!RT.nodes.length||RT.nodes.some(x=>x.it!==P.it)&&!RT.nodes.some(x=>x.fresh)){RT.nodes=[];for(let i=0;i<P.nodes;i++)RT.nodes.push({name:`ip-10-0-${10+i}-${21+i*7}`,it:P.it})}
  while(RT.nodes.length<P.nodes)RT.nodes.push({name:`ip-10-0-${10+RT.nodes.length}-${21+RT.nodes.length*7}`,it:P.it});
  while(RT.nodes.length>P.max){const gone=RT.nodes.pop();for(const L of Object.values(RT.pods))for(const p of L)if(p.node===gone.name){p.node=null;p.phase="Pending"}}}
const reqOf=n=>{const r=effRes(n);return{cpu:cpuQ(r.requests.cpu)||0,mem:memQ(r.requests.memory)||0}};
const LIVE=p=>!["Completed","Failed","Error"].includes(p.phase)||p.phase==="Error"&&false;
function nodeUse(){const u={};for(const nd of RT.nodes)u[nd.name]={cpu:0,mem:0,pods:0};
  for(const[id,L]of Object.entries(RT.pods)){const n=nodeOf(id);if(!n)continue;const r=reqOf(n);for(const p of L)if(p.node&&u[p.node]&&!["Completed","Failed"].includes(p.phase)){u[p.node].cpu+=r.cpu;u[p.node].mem+=r.mem;u[p.node].pods++}}return u}
function schedule(t){const u=nodeUse(),pend=[];
  for(const[id,L]of Object.entries(RT.pods)){const n=nodeOf(id);if(!n)continue;const r=reqOf(n);
    for(const p of L){if(p.phase!=="Pending"||p.node)continue;
      const pvc=pvcBlock(n,p);if(pvc){p.reason="Pending";p.msg=pvc;kev(p,"FailedScheduling",pvc,"bad");continue}
      const same=nm=>L.filter(q=>q.node===nm&&!["Completed","Failed","Error"].includes(q.phase)).length;
      const nd=RT.nodes.filter(x=>{if(x.cordoned)return false;const a=allocOf(NODE_TYPES[x.it]);return u[x.name].cpu+r.cpu<=a.cpu&&u[x.name].mem+r.mem<=a.mem&&u[x.name].pods<29})
        .sort((x,y)=>same(x.name)-same(y.name)||u[x.name].cpu/allocOf(NODE_TYPES[x.it]).cpu-u[y.name].cpu/allocOf(NODE_TYPES[y.it]).cpu)[0];
      if(nd){p.node=nd.name;u[nd.name].cpu+=r.cpu;u[nd.name].mem+=r.mem;u[nd.name].pods++;p.phase="ContainerCreating";p.created=Math.max(p.created,t);p.reason="";p.msg="";continue}
      if(!RT.nodes.length){p.reason="Unschedulable";p.msg="0/0 nodes are available";continue}const a=allocOf(NODE_TYPES[RT.nodes[0].it]),cpuShort=RT.nodes.every(x=>u[x.name].cpu+r.cpu>a.cpu),memShort=RT.nodes.every(x=>u[x.name].mem+r.mem>a.mem);
      p.reason="Unschedulable";p.msg=`0/${RT.nodes.length} nodes are available: ${[cpuShort?`${RT.nodes.length} Insufficient cpu`:"",memShort?`${RT.nodes.length} Insufficient memory`:""].filter(Boolean).join(", ")||"too many pods"}`+(r.cpu>a.cpu||r.mem>a.mem?` (pod xin ${r.cpu}m CPU / ${Math.round(r.mem)}Mi, một node ${RT.nodes[0].it} chỉ có ${a.cpu}m / ${a.mem}Mi cho pod)`:"");
      kev(p,"FailedScheduling",p.msg,"bad");pend.push(p)}}
  /* cluster autoscaler: pods waiting for room for a minute → one more node (up to maxNodes) */
  const P=poolSpec();if(pend.length&&RT.nodes.length<P.max&&!RT.maint){const r0=pend[0];if(RT.ca.pendingSince==null)RT.ca.pendingSince=t;else if(t-RT.ca.pendingSince>=60){RT.ca.pendingSince=null;
      RT.nodes.push({name:`ip-10-0-${10+RT.nodes.length}-${21+RT.nodes.length*7}`,it:P.it});log("Sự kiện","cluster-autoscaler","TriggeredScaleUp",`thêm 1 node ${P.it} (${RT.nodes.length}/${P.max}) vì ${pend.length} pod Pending`,"warn")}}
  else RT.ca.pendingSince=null;
  /* scale back down to the pool size after 10 minutes with nodes left empty */
  if(RT.nodes.length>P.nodes&&!RT.maint){const empty=RT.nodes.filter(x=>!nodeUse()[x.name].pods);if(empty.length){if(RT.ca.idleSince==null)RT.ca.idleSince=t;else if(t-RT.ca.idleSince>=600){RT.nodes=RT.nodes.filter(x=>x!==empty[0]);RT.ca.idleSince=null;log("Sự kiện","cluster-autoscaler","ScaleDown",`bớt node trống ${empty[0].name}`,"")}}else RT.ca.idleSince=null}}
/* PVC problems that keep a pod from being scheduled / started */
function pvcClaims(n){return arr(getP(podSpec(n)||{},"volumes")).map(v=>getP(v||{},"persistentVolumeClaim.claimName")).filter(Boolean)}
function pvcBlock(n,p){for(const cl of pvcClaims(n)){const o=findObj("PersistentVolumeClaim",cl,nsOf(n));if(!o)return`persistentvolumeclaim "${cl}" not found`;
    if(!scOf(getP(o.props,"spec.storageClassName")))return`pod has unbound immediate PersistentVolumeClaims (storageclass "${getP(o.props,"spec.storageClassName")||"(mặc định)"}" not found)`}return null}
/* ReadWriteOnce: the volume attaches to one node; a second pod on another node waits forever */
function multiAttach(n,p){for(const cl of pvcClaims(n)){const o=findObj("PersistentVolumeClaim",cl,nsOf(n));if(!o||(getP(o.props,"spec.accessModes.0")||"ReadWriteOnce")!=="ReadWriteOnce")continue;
    for(const[id,L]of Object.entries(RT.pods)){const w=nodeOf(id);if(!w||!pvcClaims(w).includes(cl)||nsOf(w)!==nsOf(n))continue;
      const other=L.find(x=>x!==p&&x.node&&x.node!==p.node&&["Running","CrashLoopBackOff"].includes(x.phase)&&x.created<=p.created);if(other)return`Multi-Attach error for volume "${cl}": Volume is already used by pod ${other.name} trên node khác (ReadWriteOnce)`}}return null}
/* ---------------- the kubelet: one pod ---------------- */
function probeOk(pb,app,c){if(!pb||app.job)return false;const port=x=>{if(x==null)return null;if(!isNaN(+x))return+x;const q=arr(c.ports).find(y=>y&&y.name===x);return q?+q.containerPort:null};
  if(pb.httpGet)return!app.tcp&&port(pb.httpGet.port)===app.port&&(app.health||[]).includes(pb.httpGet.path||"/");
  if(pb.tcpSocket)return port(pb.tcpSocket.port)===app.port;if(pb.exec)return true;return false}
const probeTxt=pb=>pb&&pb.httpGet?`HTTP GET :${pb.httpGet.port}${pb.httpGet.path||"/"}`:pb&&pb.tcpSocket?`TCP :${pb.tcpSocket.port}`:"exec";
/* when things happen after a container starts: crash, kill by a probe, healthy (app listening), Ready */
function podPlan(n,app){const c=ctrOf(n)||{},{env}=envOf(n),need=(app.needs||[]).filter(k=>!(k in env)),lim=memQ(effRes(n).limits.memory),P={healthy:app.start||0};
  if(need.length)P.crash={at:1,reason:"Error",msg:`app thoát (exit 1): thiếu biến môi trường ${need.join(", ")}`};
  else if(lim!=null&&lim<app.mem)P.crash={at:Math.min(Math.max(1,app.start*0.6),5),reason:"OOMKilled",msg:`OOMKilled (exit 137): app cần khoảng ${app.mem}Mi, limits.memory chỉ ${Math.round(lim)}Mi`};
  if(app.job)return P;
  const su=c.startupProbe,lv=c.livenessProbe,rd=c.readinessProbe;let liveFrom=0;
  if(su){const lim2=(su.initialDelaySeconds||0)+(su.periodSeconds||10)*(su.failureThreshold||3);if(!probeOk(su,app,c)){P.kill={at:lim2,msg:`Startup probe failed: ${probeTxt(su)} (app không trả lời ở đó)`}}else if(P.healthy>lim2){P.kill={at:lim2,msg:`Startup probe failed: ${probeTxt(su)}: connection refused (app cần ${app.start}s để khởi động, startup probe chỉ chờ ${lim2}s)`}}else liveFrom=Math.ceil(P.healthy)}
  if(!P.kill&&lv){const d=(lv.initialDelaySeconds||0),per=lv.periodSeconds||10,f=lv.failureThreshold||3,first=liveFrom+d;
    if(!probeOk(lv,app,c))P.kill={at:first+per*(f-1),msg:`Liveness probe failed: ${probeTxt(lv)} (sai đường dẫn hoặc cổng: app phục vụ ${app.tcp?"TCP":"HTTP"} :${app.port}${app.health?" "+app.health.join(" "):""})`};
    else{const fails=P.healthy>first?Math.ceil((P.healthy-first)/per):0;if(fails>=f)P.kill={at:first+per*(f-1),msg:`Liveness probe failed: ${probeTxt(lv)}: connection refused (app cần ${app.start}s để khởi động; liveness bắt đầu sau ${d}s và chỉ chịu ${f} lần lỗi × ${per}s)`}}}
  P.readyAt=rd?(probeOk(rd,app,c)?Math.max(P.healthy,rd.initialDelaySeconds||0):Infinity):0;P.readyWhy=rd&&!probeOk(rd,app,c)?`Readiness probe failed: ${probeTxt(rd)} (app phục vụ :${app.port}${app.health?" "+app.health.join(" "):""})`:"";
  return P}
/* data a database keeps: on a PVC (survives), a StatefulSet claim (survives), or inside the pod (lost with it) */
function volKey(n,p){const cl=pvcClaims(n)[0];if(cl)return`pvc:${nsOf(n)}/${cl}`;if(n.type==="StatefulSet"&&arr(getP(n.props,"spec.volumeClaimTemplates")).length)return`sts:${n.id}/${p.ord}`;return`pod:${p.name}`}
function advance(p,n,t0,t1){let t=t0,g=0;const ck=imageCheck((ctrOf(n)||{}).image);
  while(t<=t1&&g++<80){
    if(p.phase==="Pending")return;
    if(["ContainerCreating","ErrImagePull","ImagePullBackOff","CreateContainerConfigError"].includes(p.phase)){
      if(ck.err){p.phase=ck.err==="InvalidImageName"?"InvalidImageName":t1-p.created>PULL_SEC*3?"ImagePullBackOff":"ErrImagePull";p.reason=p.phase;p.msg=`Failed to pull image "${(ctrOf(n)||{}).image}": ${ck.msg}`;kev(p,"Failed",p.msg);p.ready=p.serving=false;return}
      const miss=envOf(n).missing;if(miss.length){p.phase="CreateContainerConfigError";p.reason=p.phase;p.msg="Error: "+miss[0];kev(p,"Failed",p.msg);p.ready=p.serving=false;return}
      const ma=multiAttach(n,p);if(ma){p.phase="ContainerCreating";p.msg=ma;kev(p,"FailedAttachVolume",ma);return}
      const at=Math.max(t,p.created+PULL_SEC);if(at>t1){p.phase="ContainerCreating";p.msg="";return}p.phase="Running";p.started=at;p.reason="";p.msg="";t=at;continue}
    if(p.phase==="CrashLoopBackOff"){if(p.backoffUntil>t1)return;p.phase="Running";p.started=p.backoffUntil;t=p.started;continue}
    if(p.phase==="Running"){const app=ck.app,P=podPlan(n,app),isJob=app.job||n.type==="Job"||n.type==="CronJob";
      if(isJob){const dl=+getP(n.props,"spec.jobTemplate.spec.activeDeadlineSeconds")||0,end=p.started+(P.crash?P.crash.at:p.jobSec||app.jobSec||60);
        if(n.type==="CronJob"&&dl&&p.started+dl<end&&t1>=p.started+dl){p.phase="Failed";p.reason="DeadlineExceeded";p.msg=`Job chạy quá activeDeadlineSeconds (${dl}s) nên bị dừng`;p.ended=p.started+dl;kev(p,"DeadlineExceeded",p.msg,"warn");return}
        if(t1>=end){p.phase=P.crash?"Error":"Completed";p.reason=P.crash?P.crash.reason:"Completed";p.msg=P.crash?P.crash.msg:"";p.ended=end;if(P.crash)kev(p,"BackoffLimitExceeded",P.crash.msg);return}
        p.ready=false;p.serving=true;return}
      const ev=[P.crash&&{at:p.started+P.crash.at,why:P.crash.msg,reason:P.crash.reason},P.kill&&{at:p.started+P.kill.at,why:P.kill.msg,reason:"Unhealthy"}].filter(Boolean).sort((a,b)=>a.at-b.at)[0];
      if(ev&&ev.at<=t1){p.restarts=(p.restarts||0)+1;p.last={reason:ev.reason,msg:ev.why,t:ev.at};p.phase="CrashLoopBackOff";p.backoffUntil=ev.at+Math.min(300,10*Math.pow(2,p.restarts-1));p.ready=p.serving=false;p.reason=ev.reason;p.msg=ev.why;
        kev(p,ev.reason==="Unhealthy"?"Killing":"BackOff",ev.why+(ev.reason==="Unhealthy"?" → kubelet khởi động lại container":" → khởi động lại, chờ lâu dần (CrashLoopBackOff)"));
        if(app.db&&!pvcClaims(n).length&&!(n.type==="StatefulSet"&&arr(getP(n.props,"spec.volumeClaimTemplates")).length)){const k=volKey(n,p);if(RT.vol[k]&&RT.vol[k].rows){RT.vol[k].lost=(RT.vol[k].lost||0)+RT.vol[k].rows;RT.vol[k].rows=0}}
        t=ev.at;continue}
      p.serving=t1>=p.started+P.healthy;p.ready=t1>=p.started+P.readyAt;p.msg=!p.ready&&P.readyWhy?P.readyWhy:"";if(P.readyWhy&&t1>=p.started+P.healthy)kev(p,"Unhealthy",P.readyWhy,"warn");return}
    return}}
/* ---------------- controllers ---------------- */
function desiredOf(n){const h=allNodes().find(x=>x.type==="HorizontalPodAutoscaler"&&!RT.bad[x.id]&&nsOf(x)===nsOf(n)&&getP(x.props,"spec.scaleTargetRef.name")===nmOf(n)&&(getP(x.props,"spec.scaleTargetRef.kind")||"Deployment")===n.type);
  if(h&&RT.hpa[h.id]&&RT.hpa[h.id].replicas!=null)return RT.hpa[h.id].replicas;const r=getP(n.props,"spec.replicas");return r==null?1:Math.max(0,+r)}
const newPod=(n,rev,t,ord)=>({name:n.type==="StatefulSet"?`${nmOf(n)}-${ord}`:`${nmOf(n)}-${rev.slice(0,6)}-${rnd()}`,ord,ns:nsOf(n),rev,phase:"Pending",ready:false,serving:false,restarts:0,node:null,created:t,started:null,id:++PODSEQ});
function reconcileWl(n,t){const L=podsOf(n.id),rev=revOf(n),want=desiredOf(n);
  if(n.type==="StatefulSet"){/* ordered names; replace a pod whose template changed */
    for(let i=0;i<want;i++){let p=L.find(x=>x.ord===i);if(p&&p.rev!==rev){L.splice(L.indexOf(p),1);p=null}if(!p){const e=admit(n);if(e){failedCreate(n,e);break}clearFc(n);L.push(newPod(n,rev,t,i))}}
    for(const p of L.filter(x=>x.ord>=want))L.splice(L.indexOf(p),1);L.sort((a,b)=>a.ord-b.ord);return}
  const cur=L.filter(p=>p.rev===rev),old=L.filter(p=>p.rev!==rev);
  let fc=null;while(cur.length<want){const e=admit(n);if(e){fc=e;break}const p=newPod(n,rev,t);cur.push(p);L.push(p)}if(fc)failedCreate(n,fc);else clearFc(n);
  while(cur.length>want){const p=cur.pop();L.splice(L.indexOf(p),1)}
  /* rolling update: old pods stay until enough new ones are Ready, so a broken new version never takes the app down */
  const readyNew=cur.filter(p=>p.ready).length;let drop=old.length-Math.max(0,want-readyNew);
  for(const p of old.sort((a,b)=>a.created-b.created)){if(drop<=0)break;L.splice(L.indexOf(p),1);drop--}
  if(old.length&&L.filter(p=>p.rev!==rev).length&&t-Math.min(...cur.map(p=>p.created))>600){RT.stuck=RT.stuck||{};if(!RT.stuck[n.id]){RT.stuck[n.id]=1;log("Sự kiện","k8s","ProgressDeadlineExceeded",`deployment/${nmOf(n)}: rollout chưa xong sau 10 phút, pod mới chưa Ready nên pod cũ vẫn phục vụ`,"warn",`kubectl rollout status deploy/${nmOf(n)}`)}}}
function syncRuntime(){if(!stackUp())return;const t=RT.t;RT.bad={};
  for(const n of allNodes()){if(n.ext)continue;const e=validate(n);if(e){RT.bad[n.id]=e}}
  syncNodes();
  for(const id of Object.keys(RT.pods)){const n=nodeOf(id);if(!n||!(WORKLOADS.includes(n.type)||["CronJob","Job","DaemonSet"].includes(n.type)))delete RT.pods[id]}
  for(const n of allNodes())if(WORKLOADS.includes(n.type)){if(RT.bad[n.id]){if(!RT.pods[n.id]||!RT.pods[n.id].length)RT.pods[n.id]=[];continue}reconcileWl(n,t)}
  for(const f of SYNC_K)f(t);
  schedule(t)}
/* ---------------- apply / delete ---------------- */
function deploy(){const was=stackUp();RT.stack={status:was?"UPDATE_COMPLETE":"CREATE_COMPLETE"};syncRuntime();const nb=Object.keys(RT.bad).length,cnt=Object.keys(M.res).length;
  log("CLI","kubectl","apply",`${cnt} object · ${nb?nb+" bị từ chối":"tất cả "+(was?"configured":"created")}`,nb?"bad":"ok","kubectl apply -f manifests.yaml");
  for(const[id,e]of Object.entries(RT.bad))log("Sự kiện","kubectl","Error",`${id}: ${e}`,"bad",`kubectl apply -f manifests.yaml`);
  /* opening a lesson or the sandbox: let the cluster run for two minutes so it shows its steady state */
  if(QUIET&&RT.t===0&&cnt){for(let i=0;i<24;i++)step(5,true);RT.total=0;for(const k in RT.n){RT.n[k].cost=0;RT.n[k].costBy={};RT.n[k].m={};RT.n[k].series=[]}RT.flow={};RT.why={}}
  return true}
DOMAIN.redeploy=(label,cli)=>{RT.stack.status="UPDATE_COMPLETE";syncRuntime();const nb=Object.keys(RT.bad).length;log("CLI","kubectl","apply",`configured${label?" · "+label:""}${nb?" · "+nb+" bị từ chối":""}`,nb?"bad":"ok",cli||"kubectl apply -f manifests.yaml")};
function deleteStack(){if(!stackUp()){log("CLI","kubectl","delete","Chưa apply gì lên cluster","bad");return}const keep={};for(const n of allNodes())if(n.type==="PersistentVolumeClaim"){const sc=scOf(getP(n.props,"spec.storageClassName")),k=`pvc:${nsOf(n)}/${nmOf(n)}`;if(sc&&sc.reclaim==="Retain"&&RT.vol[k]){keep[k]=RT.vol[k];log("Sự kiện","k8s","Released",`PV của ${n.id} được giữ lại (reclaimPolicy: Retain): dữ liệu còn, ổ đĩa vẫn tính tiền`,"warn")}}
  RT.pods={};RT.vol=keep;RT.hpa={};RT.cron={};RT.jobs={};RT.maint=null;RT.stack={status:"DELETE_COMPLETE"};
  log("CLI","kubectl","delete",`${Object.keys(M.res).length} object đã xóa (PVC xóa thì dữ liệu trên đó cũng mất)`,"warn","kubectl delete -f manifests.yaml")}
/* ---------------- traffic ---------------- */
const INGRESS_SRC={ns:INGRESS_NS,labels:{"app.kubernetes.io/name":"ingress-nginx"}};
/* NetworkPolicy: a pod picked by any policy only accepts what some rule of those policies allows */
function npAllows(src,w,port){const ns=nsOf(w),lab=podLabels(w);
  const pols=allNodes().filter(x=>x.type==="NetworkPolicy"&&!RT.bad[x.id]&&nsOf(x)===ns&&matches(getP(x.props,"spec.podSelector.matchLabels")||{},lab)&&arr(getP(x.props,"spec.policyTypes")||["Ingress"]).includes("Ingress"));
  if(!pols.length)return{ok:true};
  const peerOk=(peer,polNs)=>{if(src.external){const c=String(getP(peer,"ipBlock.cidr")||"");return c==="0.0.0.0/0"||(!!src.vpc&&c.startsWith("10."))}const nsS=peer.namespaceSelector,poS=peer.podSelector;
    if(nsS&&poS)return matches(nsS.matchLabels||{},nsLabels(src.ns))&&matches(poS.matchLabels||{},src.labels);if(nsS)return matches(nsS.matchLabels||{},nsLabels(src.ns));if(poS)return src.ns===polNs&&matches(poS.matchLabels||{},src.labels);return false};
  for(const pol of pols)for(const r of arr(getP(pol.props,"spec.ingress"))){if(!r)continue;const fromOk=!arr(r.from).length||arr(r.from).some(pe=>peerOk(pe||{},nsOf(pol))),portOk=!arr(r.ports).length||arr(r.ports).some(pp=>pp&&(+pp.port===port||portNum(w,pp.port)===port));if(fromOk&&portOk)return{ok:true}}
  return{ok:false,why:`connection timed out: NetworkPolicy ${pols.map(nmOf).join(", ")} không có luật nào cho ${src.external?(src.vpc?"mạng nội bộ":"Internet"):src.ns+(Object.keys(src.labels||{}).length?" ("+labelText(src.labels)+")":"")} vào ${nmOf(w)}:${port}`}}
/* a request reaching a Service (from the ingress controller, a client, or another app) */
let HOPS=0;
function svcHop(sid,src,port,w,from,kind,T1){if(HOPS>8)return{ok:false,err:"các app gọi nhau thành vòng lặp",errW:w};HOPS++;try{return svcHop1(sid,src,port,w,from,kind,T1)}finally{HOPS--}}
function svcHop1(sid,src,port,w,from,kind,T1){const s=nodeOf(sid),fail=msg=>{if(from)flow(from,sid,kind,w,msg);bump(sid,"err",w);nrt(sid).lastErr=msg;return{ok:false,err:msg,errW:w}};
  if(!s||!exists(sid))return fail("Service chưa được apply");if(RT.bad[sid])return fail("Service bị API server từ chối: "+RT.bad[sid]);
  const ports=arr(getP(s.props,"spec.ports")),sp=(port&&ports.find(x=>+x.port===+port))||(!port?ports[0]:null);
  if(!sp)return fail(`Service ${nmOf(s)} không mở cổng ${port} (có: ${ports.map(x=>x.port).join(", ")})`);
  const ws=selected(s).filter(x=>!RT.bad[x.id]),eps=ws.map(x=>({w:x,ready:podsOf(x.id).filter(p=>p.ready)})).filter(e=>e.ready.length),tot=eps.reduce((a,e)=>a+e.ready.length,0);
  if(!tot)return fail(ws.length?`503 no endpoints: Service ${nmOf(s)} khớp ${ws.map(nmOf).join(", ")} nhưng chưa pod nào Ready`:`503 no endpoints: selector ${labelText(getP(s.props,"spec.selector"))} không khớp nhãn pod nào trong namespace ${nsOf(s)}`);
  if(from)flow(from,sid,kind,w);bump(sid,"req",w);let errW=0,err=null;
  for(const e of eps){const share=w*e.ready.length/tot,tp=portNum(e.w,sp.targetPort??sp.port),app=imageCheck((ctrOf(e.w)||{}).image).app||{};
    const np=npAllows(src,e.w,tp);if(!np.ok){flow(sid,e.w.id,"selects",share,np.why);errW+=share;err=np.why;continue}
    if(tp!==app.port){const m=`connection refused: Service gửi tới targetPort ${tp}, app trong pod nghe cổng ${app.port}`;flow(sid,e.w.id,"selects",share,m);errW+=share;err=m;continue}
    flow(sid,e.w.id,"selects",share);const r=appRun(e.w,share,T1);if(r.errW){errW+=r.errW;err=r.err}}
  if(errW>0){bump(sid,"err",errW);nrt(sid).lastErr=err}return{ok:errW<w,err,errW}}
/* an app handling requests: capacity from its CPU, start-up gap, then the Services it calls */
function appRun(n,w,T1){const L=podsOf(n.id).filter(p=>p.ready),srv=L.filter(p=>p.serving),app=imageCheck((ctrOf(n)||{}).image).app||{},r=nrt(n.id);bump(n.id,"req",w);
  let errW=L.length?w*(L.length-srv.length)/L.length:w,why=errW?"connection refused: pod đã nhận traffic nhưng app chưa khởi động xong (thiếu readiness probe)":null;const okIn=w-errW;
  const lim=cpuQ(effRes(n).limits.cpu),cap=lim||1000,perPod=app.cpu?cap/app.cpu:Infinity,rate=(r.tk.req||0)/TICK_DT,capAll=perPod*srv.length;
  if(srv.length&&rate>capAll){const over=okIn*(rate-capAll)/rate;errW+=over;why=`Quá tải: ${num(rate)} request/giây, ${srv.length} pod chỉ chịu khoảng ${num(capAll)} (mỗi pod ${num(perPod)} với ${lim?"limits.cpu "+lim+"m":"1 vCPU"})`;r.cpu=100}else r.cpu=srv.length?Math.round(rate/Math.max(1e-9,capAll)*100):0;
  /* CPU actually used this tick (ms of CPU = millicore-seconds), for the HPA */
  const served=srv.length?okIn*Math.min(1,capAll/Math.max(rate,1e-9)):0;(RT.use[n.id]||(RT.use[n.id]={cpu:0})).cpu+=served*(app.cpu||0);
  let ok=w-errW;
  /* an OTP service pays for every SMS it sends */
  if(app.sms&&ok>0){charge(n.id,ok*app.sms,"SMS OTP");bump(n.id,"sms",ok)}
  if(app.db&&ok>0){const p=srv[0];if(p){const k=volKey(n,p),v=RT.vol[k]||(RT.vol[k]={rows:0});v.rows+=ok}}
  for(const d of depsOf(n)){if(ok<=0)break;if(d.ok&&selected(nodeOf(d.svc)).some(x=>x.id===n.id))continue;if(!d.ok){flow(n.id,d.svc,"calls",ok,d.why);errW+=ok;why=d.why;ok=0;break}
    const h=svcHop(d.svc,{ns:nsOf(n),labels:podLabels(n)},d.port,ok,n.id,"calls",T1);if(!h.ok||h.errW){const e=Math.min(ok,h.errW||ok);errW+=e;ok-=e;why=`gọi ${d.host} lỗi: ${h.err}`}}
  errW=Math.min(w,errW);if(errW>0){bump(n.id,"err",errW);r.lastErr=why}else bump(n.id,"ok",w);return{ok:errW<w,err:why,errW}}
function request(ev,T1){const id=ev.to,n=nodeOf(id),w=ev.w;
  const fail=msg=>{if(ev.from)flow(ev.from,id,"calls",w,msg);bump(id,"err",w);nrt(id).lastErr=msg;return{ok:false,err:msg,errW:w}};
  if(!n||!exists(id))return fail("Chưa apply (bấm kubectl apply)");if(RT.bad[id])return fail("Bị API server từ chối: "+RT.bad[id]);
  if(ROUTE_K[n.type])return ROUTE_K[n.type](ev,T1,n);
  return fail(`${n.def.label} không nhận request (gọi Ingress, Gateway hoặc Service)`)}
function handle(ev,T1){RT.ops++;if(ev.type!=="req")return;const r=request(ev,T1),src=ev.from;if(src&&nodeOf(src)&&nodeOf(src).ext){const e=r.ok?(r.errW||0):ev.w;bump(src,"ok",ev.w-e);if(e>0){bump(src,"err",e);nrt(src).lastErr=r.err||"lỗi"}}}
/* ---------------- sources: clients and CronJobs ---------------- */
function rateAt(n,t){const s=getP(n.props,"spec")||{},b=+s.ratePerSecond||0;if(s.pattern!=="payday")return b;const pk=Math.max(1,+s.peak||5),x=t%3600;
  const f=x<600?x/600:x<2400?1:x<3000?1-(x-2400)/600:0;return b*(1+(pk-1)*f)}
function sources(t0,dt){for(const n of allNodes()){if(n.type!=="CloudLab::Client")continue;const tg=getP(n.props,"spec.target");if(!tg)continue;
    const rate=(rateAt(n,t0)+rateAt(n,t0+dt))/2;if(!rate)continue;const a=(RT.acc[n.id]||0)+rate*dt,c=Math.floor(a);RT.acc[n.id]=a-c;if(c)fire(n,c,t0+dt/2)}
  if(stackUp())for(const n of allNodes())if(n.type==="CronJob"&&!RT.bad[n.id])cronFire(n,t0,t0+dt);
  for(const f of SOURCE_K)f(t0,dt)}
function fire(n,c,at){const s=getP(n.props,"spec")||{};if(!s.target)return;bump(n.id,"sent",c);const rate=rateAt(n,at);
  push({at,to:s.target,from:n.id,w:c,type:"req",data:{host:s.host,path:s.path,from:s.from&&s.from.namespace?s.from:null,network:s.network,port:s.port,rate,sources:+s.sources||Math.max(1,Math.round(rate*30))}})}
/* cron: minute hour day month weekday, with * , - and / ; plus @hourly @daily */
const CRON_AT={"@hourly":"0 * * * *","@daily":"0 0 * * *","@midnight":"0 0 * * *"};
function cronField(f,v,max){return String(f).split(",").some(part=>{const[r,st]=part.split("/");const s=st?+st:1;let a=0,b=max;if(r!=="*"){if(r.includes("-")){[a,b]=r.split("-").map(Number)}else{a=b=+r;if(st)b=max}}return v>=a&&v<=b&&(v-a)%s===0})}
const cronOk=s=>{s=CRON_AT[s]||s;const f=String(s||"").trim().split(/\s+/);return f.length===5&&f.every(x=>/^[\d*,/-]+$/.test(x))};
function cronTimes(s,t0,t1){s=CRON_AT[s]||s;if(!cronOk(s))return[];const f=s.trim().split(/\s+/),out=[];for(let m=Math.ceil(t0/60);m*60<t1&&out.length<500;m++){const mi=m%60,h=Math.floor(m/60)%24;if(cronField(f[0],mi,59)&&cronField(f[1],h,23))out.push(m*60)}return out}
function cronFire(n,t0,t1){const pol=getP(n.props,"spec.concurrencyPolicy")||"Allow",L=podsOf(n.id),C=RT.cron[n.id]||(RT.cron[n.id]={runs:0,skipped:0,overlap:0});
  for(const t of cronTimes(getP(n.props,"spec.schedule"),t0,t1)){const active=L.filter(p=>!["Completed","Failed","Error"].includes(p.phase)),hh=`${String(Math.floor(t%86400/3600)).padStart(2,"0")}:${String(Math.floor(t%3600/60)).padStart(2,"0")}`;
    if(active.length&&pol==="Forbid"){C.skipped++;bump(n.id,"skipped",1);log("Sự kiện","cronjob","JobAlreadyActive",`${nmOf(n)} ${hh}: bỏ qua lần này vì lần trước chưa xong (concurrencyPolicy: Forbid)`,"warn");continue}
    if(active.length&&pol==="Replace"){for(const p of active){p.phase="Failed";p.reason="Replaced";p.msg="Bị dừng để chạy lần mới (concurrencyPolicy: Replace)";p.ended=t}}
    if(active.length&&pol==="Allow"){C.overlap++;bump(n.id,"dup",1);log("Sự kiện","cronjob","Overlap",`${nmOf(n)} ${hh}: lần mới chạy khi lần trước chưa xong → hai job cùng đối soát một dữ liệu`,"bad",`kubectl get jobs -l app=${nmOf(n)}`)}
    {const e=admit(n);if(e){failedCreate(n,e);continue}}C.runs++;bump(n.id,"runs",1);const p=newPod(n,"job",t);p.name=`${nmOf(n)}-${Math.floor(t/60)}-${rnd()}`;const app=imageCheck((ctrOf(n)||{}).image).app||{};p.jobSec=(app.jobSec||600)*(t%86400>=72000?1.6:1);L.push(p);
    log("Sự kiện","cronjob","SuccessfulCreate",`${nmOf(n)} ${hh}: tạo job ${p.name}`,"")}
  const done=L.filter(p=>["Completed","Failed","Error"].includes(p.phase));if(done.length>6)for(const p of done.slice(0,done.length-6))L.splice(L.indexOf(p),1)}
/* ---------------- every tick: kubelet, controllers, HPA, cost ---------------- */
function hpaTick(t,dt){for(const h of allNodes()){if(h.type!=="HorizontalPodAutoscaler"||RT.bad[h.id])continue;const ref=getP(h.props,"spec.scaleTargetRef")||{},w=ref.name&&findObj(ref.kind||"Deployment",ref.name,nsOf(h));
    const S=RT.hpa[h.id]||(RT.hpa[h.id]={replicas:null,hist:[]});if(!w){S.err=`scaleTargetRef: ${ref.kind||"Deployment"} "${ref.name||""}" không có trong namespace ${nsOf(h)}`;continue}
    const mn=Math.max(1,+getP(h.props,"spec.minReplicas")||1),mx=Math.max(mn,+getP(h.props,"spec.maxReplicas")||mn),tg=+getP(h.props,"spec.metrics.0.resource.target.averageUtilization")||80;
    if(S.replicas==null)S.replicas=Math.min(mx,Math.max(mn,+getP(w.props,"spec.replicas")||mn));
    const req=reqOf(w).cpu,pods=podsOf(w.id).filter(p=>p.serving),u=RT.use[w.id];
    if(!req){S.err="FailedGetResourceMetric: missing request for cpu (container chưa khai báo resources.requests.cpu nên HPA không tính được % CPU)";S.util=null;continue}S.err=null;
    if(!pods.length){S.util=0;continue}
    const used=u?u.cpu/Math.max(dt,1e-9)/pods.length:0,util=Math.round(used/req*100);S.util=util;
    let want=Math.ceil(pods.length*util/tg);want=Math.min(mx,Math.max(mn,want));
    S.hist.push({t,want});S.hist=S.hist.filter(x=>t-x.t<=300);
    const cur=S.replicas;if(want>cur){S.replicas=Math.min(want,Math.max(cur*2,cur+4));log("Sự kiện","hpa","SuccessfulRescale",`${nmOf(h)}: ${cur} → ${S.replicas} pod (CPU ${util}% so với mục tiêu ${tg}%)`,"ok",`kubectl get hpa ${nmOf(h)}`)}
    else{const keep=Math.max(...S.hist.map(x=>x.want));if(keep<cur){S.replicas=keep;log("Sự kiện","hpa","SuccessfulRescale",`${nmOf(h)}: ${cur} → ${keep} pod (tải giảm, ổn định 5 phút)`,"")}}}}
function periodic(t0,dt){if(!stackUp())return;const t1=t0+dt,h=dt/3600;
  hpaTick(t1,dt);RT.use={};
  for(const n of allNodes())if(WORKLOADS.includes(n.type)&&!RT.bad[n.id])reconcileWl(n,t1);
  schedule(t1);
  for(const[id,L]of Object.entries(RT.pods)){const n=nodeOf(id);if(!n)continue;for(const p of L)advance(p,n,t0,t1)}
  for(const n of allNodes())if(WORKLOADS.includes(n.type)&&!RT.bad[n.id])reconcileWl(n,t1);
  /* cost: control plane, worker nodes, load balancers, disks */
  const P=poolSpec(),bill=P.id||"cluster";charge(bill,K8S_PRICE.controlPlaneH*h,"control plane EKS");charge(bill,RT.nodes.length*P.T.usd*h,`${RT.nodes.length} node ${P.it}`);
  for(const f of TICK_K)f(t0,dt);
  for(const n of allNodes()){if(RT.bad[n.id])continue;
    if(n.type==="StatefulSet"){const g=gbQ(getP(n.props,"spec.volumeClaimTemplates.0.spec.resources.requests.storage"));if(g)charge(n.id,g*desiredOf(n)*K8S_PRICE.gbMonth.gp3*dt/MONTH,"ổ đĩa gp3 (mỗi pod một PVC)")}}}
/* restart every pod of a workload (kubectl rollout restart): the template gets a restartedAt annotation */
function rolloutRestart(id){const n=nodeOf(id);if(!n)return;edit(`rollout restart ${id}`,()=>{const nn=nodeOf(id);setP(nn.props,"spec.template.metadata.annotations",Object.assign({},getP(nn.props,"spec.template.metadata.annotations")||{},{"kubectl.kubernetes.io/restartedAt":stamp()}))},`kubectl rollout restart ${KS[n.type]}/${nmOf(n)}${nsOf(n)!=="default"?" -n "+nsOf(n):""}`)}
