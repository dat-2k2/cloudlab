"use strict";
/* Kubernetes pack · running a shared cluster day to day.
   - PodDisruptionBudget: how many pods of an app must stay up while nodes are drained (node upgrades, maintenance).
   - Node group upgrade (an action on the node pool): nodes are cordoned and drained one by one, evictions respect PDBs,
     each node is replaced by a new one; blocked for 15 minutes → the upgrade fails (PodEvictionFailure), as on EKS.
   - ResourceQuota / LimitRange: per-namespace ceilings and per-container defaults, checked when a pod is created.
   - DaemonSet (one pod per node), Job (run to completion), StorageClass (disk type, reclaim policy, price). */
def("PodDisruptionBudget",{label:"PodDisruptionBudget",short:"PDB",cat:"ops",
  doc:"Cam kết khi bảo trì: trong lúc rút node (drain, nâng cấp), luôn còn ít nhất N pod của app chạy. Lệnh drain sẽ chờ thay vì đuổi pod làm vi phạm cam kết này.",
  defaults:id=>({metadata:{name:id},spec:{minAvailable:1,selector:{matchLabels:{app:id}}}}),
  fields:[{k:"metadata.namespace",label:"Namespace",type:"nsref"},{k:"spec.selector.matchLabels",label:"Áp cho pod có nhãn",type:"labels"},{k:"spec.minAvailable",label:"Luôn còn ít nhất (minAvailable)",type:"text",help:"Số pod (2) hoặc tỷ lệ (50%). Để trống nếu dùng maxUnavailable."},{k:"spec.maxUnavailable",label:"Hoặc: tối đa được vắng (maxUnavailable)",type:"text"}]});
def("ResourceQuota",{label:"ResourceQuota",short:"RQ",cat:"ops",
  doc:"Hạn mức của một namespace: tổng CPU, memory, số pod, số load balancer… mà mọi pod trong namespace được xin. Vượt hạn mức thì pod mới không được tạo. Như hạn mức chi tiêu của từng phòng ban.",
  defaults:id=>({metadata:{name:id},spec:{hard:{"requests.cpu":"4","requests.memory":"8Gi",pods:"20"}}}),fields:[{k:"metadata.namespace",label:"Namespace",type:"nsref"},{k:"spec.hard",label:"Hạn mức (hard)",type:"kv",help:"requests.cpu, requests.memory, limits.cpu, limits.memory, pods, services.loadbalancers, persistentvolumeclaims"}]});
def("LimitRange",{label:"LimitRange",short:"LR",cat:"ops",
  doc:"Giá trị mặc định và trần cho từng container trong namespace: container không khai báo requests / limits thì nhận mặc định; xin quá trần thì bị từ chối.",
  defaults:id=>({metadata:{name:id},spec:{limits:[{type:"Container",default:{cpu:"500m",memory:"512Mi"},defaultRequest:{cpu:"100m",memory:"128Mi"},max:{cpu:"2",memory:"2Gi"}}]}}),
  fields:[{k:"metadata.namespace",label:"Namespace",type:"nsref"},{k:"spec.limits.0.defaultRequest.cpu",label:"requests CPU mặc định",type:"text"},{k:"spec.limits.0.defaultRequest.memory",label:"requests memory mặc định",type:"text"},
    {k:"spec.limits.0.default.cpu",label:"limits CPU mặc định",type:"text"},{k:"spec.limits.0.default.memory",label:"limits memory mặc định",type:"text"},{k:"spec.limits.0.max.cpu",label:"Trần CPU mỗi container",type:"text"},{k:"spec.limits.0.max.memory",label:"Trần memory mỗi container",type:"text"}]});
const dsFields=()=>{const c="spec.template.spec.containers.0";return[{k:"metadata.namespace",label:"Namespace",type:"nsref"},{k:c+".image",label:"Image",type:"text"},{k:"spec.template.metadata.labels",label:"Nhãn của pod",type:"podlabels"},{k:c+".resources",label:"Tài nguyên (mỗi node một bản)",type:"resources"},{k:c+".envFrom",label:"Nạp ConfigMap / Secret (envFrom)",type:"envfrom"},{k:c+".env",label:"Biến môi trường",type:"envlist"}]};
def("DaemonSet",{label:"DaemonSet",short:"DS",cat:"work",
  doc:"Chạy đúng một pod trên MỖI node: agent thu log, agent bảo mật, giám sát. Thêm node là thêm pod. Requests của nó bị trừ trên mọi node, nên ít chỗ hơn cho app.",
  defaults:id=>({metadata:{name:id},spec:{selector:{matchLabels:{app:id}},template:{metadata:{labels:{app:id}},spec:{containers:[{name:id,image:REG+"/log-agent:3.2.0",resources:{requests:{cpu:"100m",memory:"128Mi"},limits:{memory:"256Mi"}}}]}}}}),fields:dsFields()});
def("Job",{label:"Job",short:"JOB",cat:"work",
  doc:"Một tác vụ chạy tới khi xong (migrate dữ liệu, xuất báo cáo một lần). completions: cần bao nhiêu lần chạy thành công; parallelism: chạy song song mấy pod; backoffLimit: lỗi bao nhiêu lần thì thôi.",
  defaults:id=>({metadata:{name:id},spec:{completions:1,parallelism:1,backoffLimit:2,template:{metadata:{labels:{app:id}},spec:{restartPolicy:"Never",containers:[{name:id,image:REG+"/recon-job:2.0.0",env:[{name:"DB_HOST",value:"ledger-db.internal"}],resources:{requests:{cpu:"250m",memory:"256Mi"},limits:{memory:"512Mi"}}}]}}}}),
  fields:[{k:"metadata.namespace",label:"Namespace",type:"nsref"},{k:"spec.completions",label:"Số lần cần chạy xong",type:"number",min:1},{k:"spec.parallelism",label:"Chạy song song",type:"number",min:1},{k:"spec.backoffLimit",label:"Lỗi tối đa",type:"number",min:0},{k:"spec.activeDeadlineSeconds",label:"Thời gian tối đa (giây)",type:"number",min:1},
    ...dsFields().slice(1)]});
def("StorageClass",{label:"StorageClass",short:"SC",cat:"store",
  doc:"Loại ổ đĩa PVC sẽ nhận: gp3 (đa dụng), io2 (IOPS cao cho database lớn), st1 (đọc tuần tự, rẻ). reclaimPolicy quyết định xóa PVC thì xóa luôn dữ liệu (Delete) hay giữ lại (Retain). Cluster có sẵn gp3 (mặc định) và standard.",
  defaults:id=>({metadata:{name:id},provisioner:"ebs.csi.aws.com",parameters:{type:"gp3"},reclaimPolicy:"Retain",allowVolumeExpansion:true,volumeBindingMode:"WaitForFirstConsumer"}),
  fields:[{k:"parameters.type",label:"Loại EBS",type:"select",options:[["gp3","gp3 · đa dụng"],["io2","io2 · IOPS cao"],["st1","st1 · đọc tuần tự, rẻ"]]},{k:"reclaimPolicy",label:"Khi xóa PVC",type:"select",options:[["Delete","Delete · xóa luôn ổ đĩa và dữ liệu"],["Retain","Retain · giữ ổ đĩa lại (vẫn tính tiền)"]]},
    {k:"metadata.annotations",label:"Là class mặc định",type:"defaultsc"}]});
K8S_PRICE.gbMonth=Object.assign(K8S_PRICE.gbMonth,{gp2:0.12,io2:0.149,st1:0.054});
const gbPrice=sc=>{const s=scOf(sc);return K8S_PRICE.gbMonth[(s&&s.type)||"gp3"]||0.096};

/* ---------------- effective resources: the container's own, else the namespace LimitRange defaults ---------------- */
function lrOf(ns){const n=allNodes().find(x=>x.type==="LimitRange"&&nsOf(x)===ns&&!RT.bad[x.id]);return n?arr(getP(n.props,"spec.limits")).find(l=>l&&(l.type||"Container")==="Container")||null:null}
function effRes(n){const c=ctrOf(n)||{},r=clone(c.resources||{}),lr=lrOf(nsOf(n));r.requests=r.requests||{};r.limits=r.limits||{};
  if(lr){for(const k of ["cpu","memory"]){if(r.limits[k]==null&&lr.default&&lr.default[k]!=null)r.limits[k]=lr.default[k];if(r.requests[k]==null){if(lr.defaultRequest&&lr.defaultRequest[k]!=null)r.requests[k]=lr.defaultRequest[k];else if(r.limits[k]!=null)r.requests[k]=r.limits[k]}}}
  else for(const k of ["cpu","memory"])if(r.requests[k]==null&&r.limits[k]!=null)r.requests[k]=r.limits[k];return r}
/* admission: LimitRange max and ResourceQuota, for one more pod of workload n */
function admit(n,extra){const ns=nsOf(n),r=effRes(n),lr=lrOf(ns);
  if(lr&&lr.max){if(lr.max.cpu&&cpuQ(r.limits.cpu||r.requests.cpu)>cpuQ(lr.max.cpu))return`pods "${nmOf(n)}-…" is forbidden: maximum cpu usage per Container is ${lr.max.cpu}`;if(lr.max.memory&&memQ(r.limits.memory||r.requests.memory)>memQ(lr.max.memory))return`pods "${nmOf(n)}-…" is forbidden: maximum memory usage per Container is ${lr.max.memory}`}
  for(const q of allNodes()){if(q.type!=="ResourceQuota"||nsOf(q)!==ns||RT.bad[q.id])continue;const hard=getP(q.props,"spec.hard")||{},use=quotaUse(ns,extra);
    for(const[k,v]of Object.entries(hard)){const kk=k.replace(/^requests\./,"requests.").replace(/^(cpu|memory)$/,"requests.$1");
      if(kk==="pods"){if(use.pods+1>+v)return`exceeded quota: ${nmOf(q)}, requested: pods=1, used: pods=${use.pods}, limited: pods=${v}`;continue}
      const m=/^(requests|limits)\.(cpu|memory)$/.exec(kk);if(!m)continue;const want=m[2]==="cpu"?cpuQ(r[m[1]][m[2]]):memQ(r[m[1]][m[2]]);
      if(want==null)return`failed quota: ${nmOf(q)}: must specify ${kk}`;const lim=m[2]==="cpu"?cpuQ(v):memQ(v);
      if(use[kk]+want>lim)return`exceeded quota: ${nmOf(q)}, requested: ${kk}=${r[m[1]][m[2]]}, used: ${kk}=${m[2]==="cpu"?Math.round(use[kk])+"m":Math.round(use[kk])+"Mi"}, limited: ${kk}=${v}`}}
  return null}
function quotaUse(ns,extra){const u={pods:0,"requests.cpu":0,"requests.memory":0,"limits.cpu":0,"limits.memory":0};
  for(const[id,L]of Object.entries(RT.pods)){const w=nodeOf(id);if(!w||nsOf(w)!==ns)continue;const r=effRes(w);for(const p of L){if(["Completed","Failed","Error"].includes(p.phase))continue;u.pods++;
      u["requests.cpu"]+=cpuQ(r.requests.cpu)||0;u["requests.memory"]+=memQ(r.requests.memory)||0;u["limits.cpu"]+=cpuQ(r.limits.cpu)||0;u["limits.memory"]+=memQ(r.limits.memory)||0}}return u}
/* a failed pod creation is shown on the workload (FailedCreate), once per reason */
function failedCreate(n,msg){RT.fc=RT.fc||{};if(RT.fc[n.id]!==msg){RT.fc[n.id]=msg;log("Sự kiện","k8s","FailedCreate",`${n.id}: Error creating: ${msg}`,"bad",`kubectl describe ${KS[n.type]}/${nmOf(n)}${nsOf(n)!=="default"?" -n "+nsOf(n):""}`)}}
const clearFc=n=>{if(RT.fc&&RT.fc[n.id])delete RT.fc[n.id]};
/* services.loadbalancers / persistentvolumeclaims quotas are checked at apply time */
function quotaApply(n){const ns=nsOf(n);if(!ns)return null;for(const q of allNodes()){if(q.type!=="ResourceQuota"||nsOf(q)!==ns)continue;const hard=getP(q.props,"spec.hard")||{};
    if(n.type==="Service"&&getP(n.props,"spec.type")==="LoadBalancer"&&hard["services.loadbalancers"]!=null){const lbs=allNodes().filter(x=>x.type==="Service"&&nsOf(x)===ns&&getP(x.props,"spec.type")==="LoadBalancer");if(lbs.indexOf(n)+1>+hard["services.loadbalancers"])return`exceeded quota: ${nmOf(q)}, limited: services.loadbalancers=${hard["services.loadbalancers"]}`}
    if(n.type==="PersistentVolumeClaim"&&hard.persistentvolumeclaims!=null){const ps=allNodes().filter(x=>x.type==="PersistentVolumeClaim"&&nsOf(x)===ns);if(ps.indexOf(n)+1>+hard.persistentvolumeclaims)return`exceeded quota: ${nmOf(q)}, limited: persistentvolumeclaims=${hard.persistentvolumeclaims}`}}return null}

/* ---------------- PDB: may this pod be evicted now? ---------------- */
const pdbsFor=w=>allNodes().filter(x=>x.type==="PodDisruptionBudget"&&!RT.bad[x.id]&&nsOf(x)===nsOf(w)&&matches(getP(x.props,"spec.selector.matchLabels")||{},podLabels(w)));
function pdbAllows(w,p){if(!p.ready)return{ok:true};for(const b of pdbsFor(w)){const sel=getP(b.props,"spec.selector.matchLabels")||{},ws=allNodes().filter(x=>(WORKLOADS.includes(x.type))&&nsOf(x)===nsOf(w)&&matches(sel,podLabels(x)));
    const healthy=ws.reduce((a,x)=>a+(RT.pods[x.id]||[]).filter(q=>q.ready).length,0),expected=ws.reduce((a,x)=>a+desiredOf(x),0);
    const pct=(v,base)=>String(v).endsWith("%")?Math.ceil(parseFloat(v)/100*base):+v;const mn=b.props.spec.minAvailable,mx=b.props.spec.maxUnavailable;
    const need=mn!=null&&mn!==""?pct(mn,expected):mx!=null&&mx!==""?expected-pct(mx,expected):0;
    if(healthy-1<need)return{ok:false,pdb:b,why:`Cannot evict pod as it would violate the pod's disruption budget (${nmOf(b)}: cần ít nhất ${need} pod Ready, đang có ${healthy})`}}return{ok:true}}
/* ---------------- node group upgrade: cordon → drain (PDB) → replace, one node at a time ---------------- */
function startUpgrade(){if(!stackUp()||RT.maint)return false;const P=poolSpec();RT.maint={queue:RT.nodes.map(x=>x.name),cur:null,joinAt:null,blockedSince:null,started:RT.t,done:0,total:RT.nodes.length};
  log("CLI","eks","update-nodegroup-version",`bắt đầu nâng cấp ${RT.nodes.length} node ${P.it}: lần lượt cordon, drain, thay node mới`,"warn",`aws eks update-nodegroup-version --cluster-name ${CLUSTER} --nodegroup-name nodes`);return true}
function maintTick(t){const S=RT.maint;if(!S)return;
  if(S.joinAt!=null){if(t<S.joinAt)return;const it=poolSpec().it,nm=`ip-10-1-${10+S.done}-${40+S.done*3}`;RT.nodes.push({name:nm,it,fresh:true});log("Sự kiện","eks","NodeReady",`node mới ${nm} đã sẵn sàng (${S.done}/${S.total})`,"ok");S.joinAt=null}
  if(!S.cur){const nx=S.queue.shift();if(!nx){log("CLI","eks","update-nodegroup-version",`nâng cấp xong ${S.total} node`,"ok");RT.maint=null;return}
    const nd=RT.nodes.find(x=>x.name===nx);if(!nd)return;nd.cordoned=true;S.cur=nx;S.blockedSince=null;log("Sự kiện","eks","NodeNotSchedulable",`cordon + drain ${nx}`,"warn",`kubectl drain ${nx} --ignore-daemonsets --delete-emptydir-data`)}
  const nd=RT.nodes.find(x=>x.name===S.cur);let blocked=null;
  for(const[id,L]of Object.entries(RT.pods)){const w=nodeOf(id);if(!w||w.type==="DaemonSet")continue;for(const p of L.slice()){if(p.node!==S.cur||["Completed","Failed","Error"].includes(p.phase))continue;
      const a=WORKLOADS.includes(w.type)?pdbAllows(w,p):{ok:true};if(!a.ok){blocked=a;if(!RT.seenEv["pdb|"+p.name]){RT.seenEv["pdb|"+p.name]=1;log("Sự kiện","eviction","Blocked",`pod/${p.name}: ${a.why}`,"warn")}continue}
      L.splice(L.indexOf(p),1);bump(id,"evicted",1);log("Sự kiện","eviction","Evicted",`pod/${p.name} bị đuổi khỏi ${S.cur}`,"")}}
  if(blocked){if(S.blockedSince==null)S.blockedSince=t;if(t-S.blockedSince>=900){log("Sự kiện","eks","PodEvictionFailure",`nâng cấp thất bại sau 15 phút: ${blocked.why}`,"bad");if(nd)nd.cordoned=false;RT.maint=null;RT.maintFailed=true}return}
  /* node empty (DaemonSet pods aside): terminate it, a new node joins about 30 seconds later */
  RT.nodes=RT.nodes.filter(x=>x.name!==S.cur);for(const[id,L]of Object.entries(RT.pods)){for(const p of L.slice())if(p.node===S.cur){L.splice(L.indexOf(p),1)}}
  log("Sự kiện","eks","Terminate",`node ${S.cur} đã tắt`,"");S.cur=null;S.done++;S.joinAt=t+30}
/* ---------------- DaemonSet and Job controllers ---------------- */
function reconcileDs(n,t){const L=podsOf(n.id),rev=revOf(n);for(const p of L.slice())if(!RT.nodes.some(x=>x.name===p.node)||p.rev!==rev)L.splice(L.indexOf(p),1);
  for(const nd of RT.nodes)if(!L.some(p=>p.node===nd.name)){const e=admit(n);if(e){failedCreate(n,e);break}clearFc(n);const p=newPod(n,rev,t);p.name=`${nmOf(n)}-${rnd()}`;p.node=nd.name;p.phase="ContainerCreating";L.push(p)}}
function reconcileJob(n,t){const L=podsOf(n.id),S=RT.jobs||(RT.jobs={}),J=S[n.id]||(S[n.id]={succeeded:0,failed:0,status:"Running",start:t});if(J.status!=="Running")return;
  const comp=Math.max(1,+getP(n.props,"spec.completions")||1),par=Math.max(1,+getP(n.props,"spec.parallelism")||1),bo=getP(n.props,"spec.backoffLimit")==null?6:+getP(n.props,"spec.backoffLimit"),dl=+getP(n.props,"spec.activeDeadlineSeconds")||0;
  J.succeeded=L.filter(p=>p.phase==="Completed").length;J.failed=L.filter(p=>p.phase==="Failed"||p.phase==="Error").length;
  if(J.succeeded>=comp){J.status="Complete";log("Sự kiện","job","Completed",`${n.id}: xong ${J.succeeded}/${comp}`,"ok");return}
  if(J.failed>bo){J.status="Failed";log("Sự kiện","job","BackoffLimitExceeded",`${n.id}: lỗi ${J.failed} lần (backoffLimit ${bo})`,"bad");return}
  if(dl&&t-J.start>dl){J.status="Failed";for(const p of L)if(!["Completed","Failed","Error"].includes(p.phase)){p.phase="Failed";p.reason="DeadlineExceeded"}log("Sự kiện","job","DeadlineExceeded",`${n.id}: quá ${dl}s`,"bad");return}
  const active=L.filter(p=>!["Completed","Failed","Error"].includes(p.phase)).length;for(let i=active;i<Math.min(par,comp-J.succeeded);i++){const e=admit(n);if(e){failedCreate(n,e);break}clearFc(n);const p=newPod(n,"job",t);p.name=`${nmOf(n)}-${rnd()}`;L.push(p)}}
SYNC_K.push(t=>{for(const n of allNodes()){if(RT.bad[n.id])continue;if(n.type==="DaemonSet")reconcileDs(n,t);if(n.type==="Job")reconcileJob(n,t)}});
TICK_K.push((t0,dt)=>{const t1=t0+dt;maintTick(t1);for(const n of allNodes()){if(RT.bad[n.id])continue;if(n.type==="DaemonSet")reconcileDs(n,t1);if(n.type==="Job")reconcileJob(n,t1)}
  /* disks: PVCs by their class, StatefulSet claims, volumes kept by Retain */
  for(const n of allNodes()){if(RT.bad[n.id])continue;if(n.type==="PersistentVolumeClaim"&&scOf(getP(n.props,"spec.storageClassName")))charge(n.id,gbQ(getP(n.props,"spec.resources.requests.storage"))*gbPrice(getP(n.props,"spec.storageClassName"))*dt/MONTH,`ổ đĩa ${(scOf(getP(n.props,"spec.storageClassName"))||{}).type||"gp3"}`)}});
LINT_K.push((n,add)=>{const id=n.id,p=n.props;
  if(n.type==="PodDisruptionBudget"){const ws=allNodes().filter(x=>WORKLOADS.includes(x.type)&&nsOf(x)===nsOf(n)&&matches(getP(p,"spec.selector.matchLabels")||{},podLabels(x)));
    if(!ws.length)add("warn",id,`${id}: selector không khớp pod nào`);else{const exp=ws.reduce((a,x)=>a+desiredOf(x),0),mn=p.spec.minAvailable;if(mn!=null&&mn!==""&&!String(mn).endsWith("%")&&+mn>=exp)add("error",id,`${id}: minAvailable ${mn} ≥ số pod (${exp}): không pod nào được đuổi, nâng cấp node sẽ kẹt rồi thất bại`)}}
  if(WORKLOADS.includes(n.type)&&desiredOf(n)>=2&&imageCheck((ctrOf(n)||{}).image).app&&!pdbsFor(n).length&&(imageCheck((ctrOf(n)||{}).image).app.start||0)>=20)add("info",id,`${id}: app khởi động chậm mà chưa có PodDisruptionBudget: lúc nâng cấp node có thể mọi pod bị đuổi cùng lúc`);
  if(n.type==="Namespace"&&nmOf(n)!=="default"&&!allNodes().some(x=>x.type==="ResourceQuota"&&nsOf(x)===nmOf(n))&&allNodes().filter(x=>nsOf(x)===nmOf(n)&&WORKLOADS.includes(x.type)).reduce((a,x)=>a+desiredOf(x)*(cpuQ(getP(effRes(x),"requests.cpu"))||0),0)>2000)add("info",id,`${id}: chưa có ResourceQuota: một đội có thể chiếm hết CPU của cluster`);
  if(RT&&RT.fc&&RT.fc[id])add("error",id,`${id}: không tạo được pod: ${RT.fc[id]}`)});
