"use strict";
/* Kubernetes pack · RBAC: who may do what through the Kubernetes API.
   ServiceAccount (an identity for pods and pipelines), Role / ClusterRole (lists of verbs on resources), RoleBinding
   (grants a role inside one namespace) and ClusterRoleBinding (grants a ClusterRole everywhere). The built-in
   ClusterRoles cluster-admin, admin, edit and view exist without being declared (view cannot read Secrets; edit can).
   Actor (cloudlab.dev/v1): a person or a pipeline calling the API (kubectl, CI) — each call is checked like the API
   server would, and compared with what should happen. */
const RES_GROUP={pods:"",services:"",configmaps:"",secrets:"",namespaces:"",serviceaccounts:"",persistentvolumeclaims:"",events:"",nodes:"",persistentvolumes:"",resourcequotas:"",limitranges:"",
  deployments:"apps",statefulsets:"apps",daemonsets:"apps",replicasets:"apps",jobs:"batch",cronjobs:"batch",ingresses:"networking.k8s.io",networkpolicies:"networking.k8s.io",horizontalpodautoscalers:"autoscaling",
  poddisruptionbudgets:"policy",roles:"rbac.authorization.k8s.io",rolebindings:"rbac.authorization.k8s.io",clusterroles:"rbac.authorization.k8s.io",clusterrolebindings:"rbac.authorization.k8s.io",storageclasses:"storage.k8s.io",
  gateways:"gateway.networking.k8s.io",httproutes:"gateway.networking.k8s.io"};
const CLUSTER_RES=new Set(["namespaces","nodes","persistentvolumes","storageclasses","clusterroles","clusterrolebindings"]);
const VERBS=["get","list","watch","create","update","patch","delete"];
const APP_GROUPS=["","apps","batch","networking.k8s.io","autoscaling","policy"];
const NS_RES=["pods","deployments","statefulsets","daemonsets","replicasets","jobs","cronjobs","services","ingresses","configmaps","persistentvolumeclaims","horizontalpodautoscalers","poddisruptionbudgets","serviceaccounts","events"];
const BUILTIN_CR={"cluster-admin":[{apiGroups:["*"],resources:["*"],verbs:["*"]}],
  admin:[{apiGroups:APP_GROUPS.concat(["rbac.authorization.k8s.io"]),resources:NS_RES.concat(["secrets","roles","rolebindings","networkpolicies"]),verbs:["*"]}],
  edit:[{apiGroups:APP_GROUPS,resources:NS_RES.concat(["secrets"]),verbs:VERBS}],
  view:[{apiGroups:APP_GROUPS,resources:NS_RES.concat(["namespaces"]),verbs:["get","list","watch"]}]};
const roleRules=(kind,name,ns)=>{if(kind==="ClusterRole"){const n=findObj("ClusterRole",name);if(n)return{rules:arr(n.props.rules),id:n.id};return BUILTIN_CR[name]?{rules:BUILTIN_CR[name],id:null,builtin:true}:null}
  const n=findObj("Role",name,ns);return n?{rules:arr(n.props.rules),id:n.id}:null};
const ruleHit=(r,verb,res)=>!!r&&arr(r.verbs).some(v=>v==="*"||v===verb)&&arr(r.resources).some(x=>x==="*"||x===res)&&(arr(r.apiGroups).length?arr(r.apiGroups).some(g=>g==="*"||g===(RES_GROUP[res]??"")):true);
const subjOk=(s,who,bns)=>{if(!s)return false;if(s.kind==="ServiceAccount")return who.kind==="ServiceAccount"&&s.name===who.name&&(s.namespace||bns)===who.namespace;if(s.kind==="User")return who.kind==="User"&&s.name===who.name;
  if(s.kind==="Group")return arr(who.groups).includes(s.name)||(who.kind==="ServiceAccount"&&(s.name==="system:serviceaccounts"||s.name==="system:serviceaccounts:"+who.namespace));return false};
const whoTxt=w=>w.kind==="ServiceAccount"?`system:serviceaccount:${w.namespace}:${w.name}`:`${w.kind==="User"?"User":"Group"} "${w.name}"`;
/* the API server's answer: allowed by which binding, or the Forbidden message */
function canI(who,verb,res,ns){if(who.kind==="ServiceAccount"&&!findObj("ServiceAccount",who.name,who.namespace))return{ok:false,why:`401 Unauthorized: ServiceAccount ${who.namespace}/${who.name} không tồn tại (token không hợp lệ)`};
  const clusterRes=CLUSTER_RES.has(res);
  for(const b of allNodes()){if(b.type!=="ClusterRoleBinding"&&b.type!=="RoleBinding")continue;if(b.type==="RoleBinding"&&(clusterRes||nsOf(b)!==ns))continue;
    if(!arr(b.props.subjects).some(s=>subjOk(s,who,nsOf(b))))continue;const rr=getP(b.props,"roleRef")||{},R=roleRules(rr.kind||"ClusterRole",rr.name,nsOf(b));if(!R)continue;
    if(R.rules.some(r=>ruleHit(r,verb,res)))return{ok:true,by:`${b.id} → ${rr.kind||"ClusterRole"} ${rr.name}${R.builtin?" (có sẵn)":""}`,binding:b.id}}
  return{ok:false,why:`Forbidden: ${whoTxt(who)} cannot ${verb} resource "${res}"${RES_GROUP[res]?` in API group "${RES_GROUP[res]}"`:""}${clusterRes?" at the cluster scope":` in the namespace "${ns}"`}`}}
const actorWho=a=>{const s=getP(a.props,"spec.as")||{};return{kind:s.kind||"User",name:s.name||"",namespace:s.namespace||"default",groups:arr(s.groups)}};

def("ServiceAccount",{label:"ServiceAccount",short:"SA",cat:"sec",
  doc:"Danh tính cho pod và cho pipeline gọi Kubernetes API. Bản thân nó không có quyền gì: quyền đến từ RoleBinding / ClusterRoleBinding trỏ tới nó.",
  defaults:id=>({metadata:{name:id}}),fields:[{k:"metadata.namespace",label:"Namespace",type:"nsref"},{k:"automountServiceAccountToken",label:"Tự gắn token vào pod",type:"select",bool:true,options:[["true","Có (mặc định)"],["false","Không: pod không cần gọi API thì tắt"]]}]});
def("Role",{label:"Role",short:"ROLE",cat:"sec",
  doc:"Danh sách quyền trong một namespace: động từ (get, list, update…) trên loại tài nguyên (pods, deployments, secrets…). Một mình Role không cấp quyền cho ai: cần RoleBinding.",
  defaults:id=>({metadata:{name:id},rules:[{apiGroups:["apps"],resources:["deployments"],verbs:["get","list","update","patch"]}]}),fields:[{k:"metadata.namespace",label:"Namespace",type:"nsref"},{k:"rules",label:"Quyền (rules)",type:"rbacrules"}]});
def("ClusterRole",{label:"ClusterRole",short:"CR",cat:"sec",
  doc:"Như Role nhưng dùng được ở mọi namespace (và cho tài nguyên cấp cluster như namespaces, nodes). Có sẵn: cluster-admin (mọi quyền), admin, edit (sửa được và đọc được Secret), view (chỉ xem, không đọc Secret).",
  defaults:id=>({metadata:{name:id},rules:[{apiGroups:[""],resources:["pods"],verbs:["get","list"]}]}),fields:[{k:"rules",label:"Quyền (rules)",type:"rbacrules"}]});
def("RoleBinding",{label:"RoleBinding",short:"RB",cat:"sec",
  doc:"Cấp một Role (hoặc ClusterRole) cho người / nhóm / ServiceAccount, chỉ trong namespace của RoleBinding. Đây là cách cấp quyền hẹp: ví dụ CI chỉ được cập nhật Deployment ở namespace web.",
  defaults:id=>({metadata:{name:id},roleRef:{apiGroup:"rbac.authorization.k8s.io",kind:"Role",name:""},subjects:[]}),fields:[{k:"metadata.namespace",label:"Namespace",type:"nsref"},{k:"roleRef",label:"Cấp role",type:"roleref"},{k:"subjects",label:"Cho ai (subjects)",type:"subjects"}]});
def("ClusterRoleBinding",{label:"ClusterRoleBinding",short:"CRB",cat:"sec",
  doc:"Cấp một ClusterRole cho ai đó ở MỌI namespace. Rất mạnh: một ClusterRoleBinding tới cluster-admin là chìa khóa vạn năng của cả cluster.",
  defaults:id=>({metadata:{name:id},roleRef:{apiGroup:"rbac.authorization.k8s.io",kind:"ClusterRole",name:"view"},subjects:[]}),fields:[{k:"roleRef",label:"Cấp ClusterRole",type:"roleref"},{k:"subjects",label:"Cho ai (subjects)",type:"subjects"}]});
def("CloudLab::Actor",{label:"Người / pipeline gọi API",short:"👤",cat:"ext",ext:true,src:true,api:"cloudlab.dev/v1",kind:"Actor",
  doc:"Một người (kubectl) hoặc một pipeline CI dùng token của ServiceAccount, lặp lại một danh sách thao tác trên Kubernetes API. Mỗi thao tác có kỳ vọng: nên được phép, hay nên bị chặn.",
  defaults:()=>({spec:{as:{kind:"User",name:"vy",groups:["auditors"]},perMinute:6,actions:[{verb:"list",resource:"pods",namespace:"default"}]}}),
  fields:[{k:"spec.as",label:"Danh tính",type:"actoras"},{k:"spec.actions",label:"Thao tác (lặp lại)",type:"actions"},{k:"spec.perMinute",label:"Số lượt mỗi phút",type:"number",min:0,step:"any"}]});

/* ---------------- edges ---------------- */
EDGE_X.push((n,add)=>{const p=n.props;
  if(n.type==="RoleBinding"||n.type==="ClusterRoleBinding"){const rr=p.roleRef||{},R=rr.name&&(rr.kind==="Role"?findObj("Role",rr.name,nsOf(n)):findObj("ClusterRole",rr.name));if(R)add({from:n.id,to:R.id,kind:"binds",label:"roleRef",owner:n.id,path:"roleRef"});
    arr(p.subjects).forEach((s,i)=>{if(s&&s.kind==="ServiceAccount"){const sa=findObj("ServiceAccount",s.name,s.namespace||nsOf(n));if(sa)add({from:n.id,to:sa.id,kind:"grants",label:"cấp cho",owner:n.id,path:"subjects."+i})}})}
  if((WORKLOADS.includes(n.type)||n.type==="CronJob"||n.type==="Job"||n.type==="DaemonSet")){const sn=getP(podSpec(n)||{},"serviceAccountName"),sa=sn&&findObj("ServiceAccount",sn,nsOf(n));if(sa)add({from:n.id,to:sa.id,kind:"runsas",label:"chạy với",owner:n.id,path:"serviceAccountName"})}
  if(n.type==="CloudLab::Actor"){const w=actorWho(n);if(w.kind==="ServiceAccount"){const sa=findObj("ServiceAccount",w.name,w.namespace);if(sa)add({from:n.id,to:sa.id,kind:"calls",label:"dùng token",owner:n.id,path:"spec.as"})}}});
Object.assign(REL,{binds:{style:"role"},grants:{style:"grant"},runsas:{style:"role"}});
Object.assign(REMOVE_EDGE_K,{binds:(e,o)=>{o.props.roleRef.name="";return true},grants:(e,o)=>{o.props.subjects.splice(+e.path.split(".")[1],1);return true},runsas:(e,o)=>{delete podSpec(o).serviceAccountName;return true}});
CONNECT_K.push((A,B,say)=>{const ta=A.type,tb=B.type,bind=ta==="RoleBinding"||ta==="ClusterRoleBinding";
  if(bind&&(tb==="Role"||tb==="ClusterRole")&&(tb==="ClusterRole"||nsOf(A)===nsOf(B))&&!(ta==="ClusterRoleBinding"&&tb==="Role"))return say(`cấp ${tb} ${nmOf(B)}`,()=>{A.props.roleRef={apiGroup:"rbac.authorization.k8s.io",kind:tb,name:nmOf(B)}});
  if(bind&&tb==="ServiceAccount")return say(`cấp quyền cho ServiceAccount ${nmOf(B)}`,()=>{A.props.subjects=arr(A.props.subjects).concat([{kind:"ServiceAccount",name:nmOf(B),namespace:nsOf(B)}])});
  if((WORKLOADS.includes(ta)||ta==="CronJob"||ta==="Job"||ta==="DaemonSet")&&tb==="ServiceAccount"&&nsOf(A)===nsOf(B))return say("pod chạy với ServiceAccount này",()=>{podSpec(A).serviceAccountName=nmOf(B)});
  if(ta==="CloudLab::Actor"&&tb==="ServiceAccount")return say("dùng token của ServiceAccount này",()=>{A.props.spec.as={kind:"ServiceAccount",name:nmOf(B),namespace:nsOf(B)}});
  return null});
Object.assign(WHY_K,{RoleBinding:"Role / ClusterRole (cùng namespace) hoặc ServiceAccount",ClusterRoleBinding:"ClusterRole hoặc ServiceAccount","CloudLab::Actor":"ServiceAccount",ServiceAccount:"(ServiceAccount nhận quyền: nối từ RoleBinding sang)",Role:"(Role được RoleBinding trỏ tới)",ClusterRole:"(ClusterRole được binding trỏ tới)"});
RENAME_K.push((n,old,name,ns,o)=>{const p=o.props;
  if(n.type==="ServiceAccount"){if((o.type==="RoleBinding"||o.type==="ClusterRoleBinding"))for(const s of arr(p.subjects))if(s&&s.kind==="ServiceAccount"&&s.name===old&&(s.namespace||nsOf(o))===ns)s.name=name;
    const ps=podSpec(o);if(ps&&ps.serviceAccountName===old&&nsOf(o)===ns)ps.serviceAccountName=name;if(o.type==="CloudLab::Actor"){const a=getP(p,"spec.as");if(a&&a.kind==="ServiceAccount"&&a.name===old&&(a.namespace||"default")===ns)a.name=name}}
  if((n.type==="Role"||n.type==="ClusterRole")&&(o.type==="RoleBinding"||o.type==="ClusterRoleBinding")){const rr=p.roleRef;if(rr&&rr.kind===n.type&&rr.name===old&&(n.type==="ClusterRole"||nsOf(o)===ns))rr.name=name}});
/* ---------------- simulation: actors repeat their API calls ---------------- */
SOURCE_K.push((t0,dt)=>{for(const a of allNodes()){if(a.type!=="CloudLab::Actor")continue;const rate=(+getP(a.props,"spec.perMinute")||0)/60;if(!rate)continue;
    const acc=(RT.acc[a.id]||0)+rate*dt,c=Math.floor(acc);RT.acc[a.id]=acc-c;if(c)actorRun(a,c)}});
function actorRun(a,c){if(!stackUp())return;const who=actorWho(a),acts=arr(getP(a.props,"spec.actions")).filter(x=>x&&x.verb&&x.resource),S=RT.rbac||(RT.rbac={});const L=S[a.id]||(S[a.id]=[]);bump(a.id,"sent",c*acts.length);
  const sa=who.kind==="ServiceAccount"?findObj("ServiceAccount",who.name,who.namespace):null;let wrong=null;
  acts.forEach((x,i)=>{const r=canI(who,x.verb,x.resource,x.namespace||"default"),R=L[i]||(L[i]={ok:0,deny:0});if(r.ok)R.ok+=c;else R.deny+=c;R.last=r;R.expect=x.expect||"";
    const good=(x.expect==="Deny")!==r.ok;bump(a.id,good?"ok":"err",c);if(!good)wrong=r.ok?`${x.verb} ${x.resource} ở ${x.namespace||"default"} lẽ ra phải bị chặn, nhưng được phép qua ${r.by}`:`${x.verb} ${x.resource} ở ${x.namespace||"default"} bị chặn: ${r.why}`;
    if(!RT.seenEv["rbac|"+a.id+"|"+i+"|"+r.ok]){RT.seenEv["rbac|"+a.id+"|"+i+"|"+r.ok]=1;log("API","kube-apiserver",r.ok?"allowed":"Forbidden",`${whoTxt(who)}: ${x.verb} ${x.resource} -n ${x.namespace||"default"}${r.ok?" · "+r.by:""}`,good?(r.ok?"ok":""):"bad",`kubectl auth can-i ${x.verb} ${x.resource} -n ${x.namespace||"default"} --as=${who.kind==="ServiceAccount"?`system:serviceaccount:${who.namespace}:${who.name}`:who.name}${who.kind==="User"&&who.groups.length?" "+who.groups.map(g=>"--as-group="+g).join(" "):""}`)}});
  if(wrong)nrt(a.id).lastErr=wrong;if(sa)flow(a.id,sa.id,"calls",c,wrong||undefined)}
LINT_K.push((n,add)=>{const id=n.id,p=n.props;
  if(n.type==="ClusterRoleBinding"&&getP(p,"roleRef.name")==="cluster-admin")for(const s of arr(p.subjects))if(s&&!(s.kind==="Group"&&s.name==="system:masters"))add("error",id,`${id}: ${s.kind} ${s.name} có cluster-admin: toàn quyền mọi namespace, kể cả đọc mọi Secret và xóa namespace`);
  if((n.type==="ClusterRoleBinding"||n.type==="RoleBinding")&&getP(p,"roleRef.name")==="edit")add("warn",id,`${id}: ClusterRole edit cho phép sửa tài nguyên và đọc Secret. Chỉ xem thì dùng view`);
  if((n.type==="Role"||n.type==="ClusterRole")&&arr(p.rules).some(r=>arr(r&&r.verbs).includes("*")&&arr(r&&r.resources).includes("*")))add("warn",id,`${id}: quyền * trên * : tương đương admin, khó kiểm soát`);
  if(n.type==="RoleBinding"||n.type==="ClusterRoleBinding"){const rr=p.roleRef||{};if(rr.name&&!roleRules(rr.kind||"ClusterRole",rr.name,nsOf(n)))add("error",id,`${id}: roleRef ${rr.kind} ${rr.name} không có`)}});
