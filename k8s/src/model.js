"use strict";
/* Kubernetes pack · model: edges come from how Kubernetes objects find each other — by name (Ingress → Service,
   envFrom → ConfigMap, claimName → PVC, scaleTargetRef → Deployment), by label selector (Service → pods,
   NetworkPolicy → pods) and by DNS names in env vars (app → Service). The YAML is a multi-document manifest;
   CloudLab-only objects (clients, node pool) are documents with apiVersion cloudlab.dev/v1. */
const DNS1123=/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;
/* ---------------- edges ---------------- */
function edges(){const out=[],seen=new Set(),add=e=>{const k=e.from+">"+e.to+">"+e.kind;if(seen.has(k)||!rawOf(e.from)||!rawOf(e.to)||e.from===e.to)return;seen.add(k);e.id=k;out.push(e)};
  for(const n of allNodes()){const p=n.props,ns=nsOf(n);
    switch(n.type){
      case"CloudLab::Client":{const t=getP(p,"spec.target");if(t)add({from:n.id,to:t,kind:"calls",label:(getP(p,"spec.host")||"")+(getP(p,"spec.path")||"")||"gọi",owner:n.id,path:"spec.target"});break}
      case"Ingress":arr(getP(p,"spec.rules")).forEach((r,i)=>arr(getP(r||{},"http.paths")).forEach((x,j)=>{const s=findObj("Service",getP(x||{},"backend.service.name"),ns);
        if(s)add({from:n.id,to:s.id,kind:"routes",label:`${(r&&r.host)||"*"}${(x&&x.path)||"/"}`,owner:n.id,path:`spec.rules.${i}.http.paths.${j}`})}));break;
      case"Service":{const sel=getP(p,"spec.selector")||{},hit=selected(n);hit.forEach(w=>add({from:n.id,to:w.id,kind:"selects",label:labelText(sel),owner:n.id,path:"spec.selector"}));
        /* a selector that almost matches (same keys, other values) is drawn so the mismatch is visible */
        if(!hit.length&&Object.keys(sel).length)allNodes().filter(w=>WORKLOADS.includes(w.type)&&nsOf(w)===ns&&Object.keys(sel).some(k=>k in podLabels(w))).forEach(w=>add({from:n.id,to:w.id,kind:"selects",label:"✕ selector không khớp nhãn pod",owner:n.id,path:"spec.selector",deny:true,miss:true}));break}
      case"HorizontalPodAutoscaler":{const r=getP(p,"spec.scaleTargetRef")||{},w=r.name&&findObj(r.kind||"Deployment",r.name,ns);if(w)add({from:n.id,to:w.id,kind:"scales",label:`${getP(p,"spec.minReplicas")||1}–${getP(p,"spec.maxReplicas")||1} pod`,owner:n.id,path:"spec.scaleTargetRef"});break}
      case"NetworkPolicy":{const sel=getP(p,"spec.podSelector.matchLabels")||{};allNodes().filter(w=>WORKLOADS.includes(w.type)&&nsOf(w)===ns&&matches(sel,podLabels(w))).forEach(w=>add({from:n.id,to:w.id,kind:"applies",label:"áp cho",owner:n.id,path:"spec.podSelector"}));break}}
    if(WORKLOADS.includes(n.type)||n.type==="CronJob"){const c=ctrOf(n)||{},base=CTR(n);
      arr(c.envFrom).forEach((ef,i)=>{const r=ef.configMapRef||ef.secretRef,o=r&&findObj(ef.configMapRef?"ConfigMap":"Secret",r.name,ns);if(o)add({from:n.id,to:o.id,kind:"uses",label:"envFrom",owner:n.id,path:`${base}.envFrom.${i}`})});
      arr(c.env).forEach((e,i)=>{const vf=e&&e.valueFrom||{},r=vf.secretKeyRef||vf.configMapKeyRef,o=r&&findObj(vf.secretKeyRef?"Secret":"ConfigMap",r.name,ns);if(o)add({from:n.id,to:o.id,kind:"uses",label:e.name,owner:n.id,path:`${base}.env.${i}`})});
      arr(getP(podSpec(n)||{},"volumes")).forEach((v,i)=>{const cl=v&&getP(v,"persistentVolumeClaim.claimName"),o=cl&&findObj("PersistentVolumeClaim",cl,ns);if(o)add({from:n.id,to:o.id,kind:"mounts",label:"gắn ổ đĩa",owner:n.id,path:`spec.template.spec.volumes.${i}`})});
      for(const d of depsOf(n))add({from:n.id,to:d.svc,kind:"calls",label:d.ok?d.env:"✕ DNS "+d.host,owner:n.id,path:"env:"+d.env,deny:!d.ok,dns:!d.ok})}}
  return out}
/* ---------------- add / remove / rename ---------------- */
const BASE_NAME={Deployment:"app",StatefulSet:"db",Service:"app",Ingress:"public",ConfigMap:"config",Secret:"secret",PersistentVolumeClaim:"data",HorizontalPodAutoscaler:"app",NetworkPolicy:"policy",CronJob:"job",Namespace:"team","CloudLab::Client":"customers","CloudLab::NodePool":"nodes"};
function freeName(kind,base){let i=1;while(rawOf(idFor(kind,base+"-"+i)))i++;return base+"-"+i}
function addNode(type,x,y,id){const d=T[type];const name=id?id.split("/").pop():freeName(type,BASE_NAME[type]||"obj");id=id||idFor(type,name);
  const raw={Type:type,Properties:clone(d.defaults(name))};raw.Properties.metadata=Object.assign({name},raw.Properties.metadata||{});raw.Properties.metadata.name=name;
  (d.ext?M.ext:M.res)[id]=raw;M.pos[id]=[Math.round(x),Math.round(y)];return id}
/* deleting a namespace deletes everything in it (as kubectl delete namespace does) */
function removeNode(id){const n=nodeOf(id);if(!n)return;const sc=n.scope;
  if(n.type==="Namespace"){const name=nmOf(n);for(const o of allNodes())if(!o.ext&&o.type!=="Namespace"&&nsOf(o)===name){delete M[o.scope][o.id];delete M.pos[o.id]}}
  delete M[sc][id];delete M.pos[id];
  for(const x of Object.values(M.ext))if(getP(x,"Properties.spec.target")===id)x.Properties.spec.target=null}
function renameNode(a,b){const n=nodeOf(a);if(!n)return{ok:false,err:"Không tìm thấy."};const name=String(b).split("/").pop().trim(),old=nmOf(n);if(name===old)return{ok:true,id:a};
  if(!DNS1123.test(name)||name.length>63)return{ok:false,err:"Tên Kubernetes: chữ thường, số và dấu -, bắt đầu và kết thúc bằng chữ hoặc số, tối đa 63 ký tự."};
  const nid=idFor(n.type,name);if(rawOf(nid))return{ok:false,err:`${nid} đã tồn tại.`};const ns=nsOf(n),sameNs=o=>!o.ext&&nsOf(o)===ns;
  meta(n).name=name;const reb=o=>{const r={};for(const k of Object.keys(o))r[k===a?nid:k]=o[k];return r};M[n.scope]=reb(M[n.scope]);M.pos=reb(M.pos);
  for(const x of Object.values(M.ext))if(getP(x,"Properties.spec.target")===a)x.Properties.spec.target=nid;
  const envHost=(o,fn)=>{for(const c of arr((podSpec(o)||{}).containers))for(const e of arr(c.env))if(e&&typeof e.value==="string")e.value=fn(e.value,e.name)};
  const cms=o=>o.type==="ConfigMap"?o.props.data||{}:null;
  for(const o of allNodes()){if(o.ext)continue;const p=o.props;
    if(n.type==="Service"){if(o.type==="Ingress"&&sameNs(o))arr(getP(p,"spec.rules")).forEach(r=>arr(getP(r||{},"http.paths")).forEach(x=>{if(getP(x||{},"backend.service.name")===old)x.backend.service.name=name}));
      const re=new RegExp(`(^|//)${old.replace(/[.-]/g,"\\$&")}(?=$|[.:/])`),fix=(v,k)=>(DNS_VAR.test(k||"")||v.includes("://"))&&(sameNs(o)||v.includes(old+"."+ns))?v.replace(re,"$1"+name):v;
      if(o.type!=="ConfigMap")envHost(o,fix);else{const d=cms(o);for(const k of Object.keys(d))d[k]=fix(String(d[k]),k)}}
    if((n.type==="ConfigMap"||n.type==="Secret")&&sameNs(o)){const isS=n.type==="Secret";for(const c of arr((podSpec(o)||{}).containers)){for(const ef of arr(c.envFrom)){const r=isS?ef.secretRef:ef.configMapRef;if(r&&r.name===old)r.name=name}
        for(const e of arr(c.env)){const r=getP(e||{},isS?"valueFrom.secretKeyRef":"valueFrom.configMapKeyRef");if(r&&r.name===old)r.name=name}}
      if(isS&&o.type==="Ingress")arr(getP(p,"spec.tls")).forEach(t=>{if(t&&t.secretName===old)t.secretName=name})}
    if(n.type==="PersistentVolumeClaim"&&sameNs(o))arr(getP(podSpec(o)||{},"volumes")).forEach(v=>{if(getP(v||{},"persistentVolumeClaim.claimName")===old)v.persistentVolumeClaim.claimName=name});
    if(WORKLOADS.includes(n.type)&&o.type==="HorizontalPodAutoscaler"&&sameNs(o)){const r=getP(p,"spec.scaleTargetRef");if(r&&r.name===old&&(r.kind||"Deployment")===n.type)r.name=name}
    if(n.type==="Namespace"&&meta(o).namespace===old){meta(o).namespace=name}}
  if(n.type==="Namespace")for(const x of Object.values(M.ext))if(getP(x,"Properties.spec.from.namespace")===old)x.Properties.spec.from.namespace=name;
  return{ok:true,id:nid}}
function removeEdge(e){const o=nodeOf(e.owner);if(!o)return;const p=o.props;
  if(e.kind==="calls"&&o.ext){p.spec.target=null;return}
  if(e.kind==="routes"){const ks=e.path.split("."),ri=+ks[2],pi=+ks[5],r=arr(getP(p,"spec.rules"))[ri];if(!r)return;r.http.paths.splice(pi,1);if(!r.http.paths.length)p.spec.rules.splice(ri,1);return}
  if(e.kind==="selects"){if(!e.miss)p.spec.selector={};return}
  if(e.kind==="scales"){p.spec.scaleTargetRef.name="";return}
  if(e.kind==="uses"){const ks=e.path.split("."),i=+ks.pop(),list=getP(p,ks.join("."));if(Array.isArray(list))list.splice(i,1);return}
  if(e.kind==="mounts"){const ks=e.path.split("."),i=+ks.pop(),vols=getP(p,ks.join(".")),v=vols&&vols[i];if(!v)return;vols.splice(i,1);const c=ctrOf(o);if(c&&c.volumeMounts)c.volumeMounts=c.volumeMounts.filter(m=>m.name!==v.name);return}
  if(e.kind==="calls"&&e.path.startsWith("env:")){const k=e.path.slice(4),c=ctrOf(o);if(c&&c.env)c.env=c.env.filter(x=>x.name!==k);return}}
/* ---------------- connecting two blocks (drag, or "Nối tới…") ---------------- */
const sameNsOk=(A,B)=>nsOf(A)===nsOf(B);
function connectRule(a,b){const A=nodeOf(a),B=nodeOf(b);if(!A||!B||a===b)return null;const ta=A.type,tb=B.type;const say=(label,apply,grant)=>({label,apply,grant});
  const wl=WORKLOADS.includes(ta)||ta==="CronJob";
  if(ta==="CloudLab::Client"&&(tb==="Ingress"||tb==="Service"))return say(tb==="Ingress"?"gửi request tới Ingress":`gọi thẳng Service (${getP(B.props,"spec.type")||"ClusterIP"})`,()=>{A.props.spec=A.props.spec||{};A.props.spec.target=b;if(tb==="Ingress"&&!A.props.spec.host){const r=arr(getP(B.props,"spec.rules"))[0];if(r&&r.host)A.props.spec.host=r.host;A.props.spec.path=A.props.spec.path||"/"}});
  if(ta==="Ingress"&&tb==="Service"&&sameNsOk(A,B))return say("thêm luật đường dẫn → Service này",()=>{const sp=arr(getP(B.props,"spec.ports"))[0]||{port:80};A.props.spec=A.props.spec||{};A.props.spec.rules=arr(A.props.spec.rules);
    let r=A.props.spec.rules[0];if(!r){r={host:"ib.anphat.vn",http:{paths:[]}};A.props.spec.rules.push(r)}r.http=r.http||{paths:[]};r.http.paths=arr(r.http.paths);const used=r.http.paths.some(x=>x.path==="/");
    r.http.paths.push({path:used?"/"+nmOf(B):"/",pathType:"Prefix",backend:{service:{name:nmOf(B),port:{number:+sp.port||80}}}})});
  if(ta==="Service"&&WORKLOADS.includes(tb)&&sameNsOk(A,B))return say("chọn pod của workload này (selector = nhãn pod, targetPort = cổng container)",()=>{A.props.spec.selector=clone(podLabels(B));const cp=+getP(ctrOf(B)||{},"ports.0.containerPort")||8080;const ps=arr(A.props.spec.ports);if(!ps.length)A.props.spec.ports=[{port:80,targetPort:cp}];else ps[0].targetPort=cp});
  if(wl&&(tb==="ConfigMap"||tb==="Secret")&&sameNsOk(A,B))return say(`nạp toàn bộ ${tb} thành biến môi trường (envFrom)`,()=>{const c=ctrOf(A);c.envFrom=arr(c.envFrom).concat([tb==="ConfigMap"?{configMapRef:{name:nmOf(B)}}:{secretRef:{name:nmOf(B)}}])});
  if(WORKLOADS.includes(ta)&&tb==="PersistentVolumeClaim"&&sameNsOk(A,B))return say("gắn ổ đĩa bền (PVC)",()=>{const s=podSpec(A),c=ctrOf(A),app=(imageCheck(c.image).app||{});s.volumes=arr(s.volumes).filter(v=>v.name!=="data").concat([{name:"data",persistentVolumeClaim:{claimName:nmOf(B)}}]);c.volumeMounts=arr(c.volumeMounts).filter(m=>m.name!=="data").concat([{name:"data",mountPath:app.data||"/data"}])});
  if(wl&&tb==="Service"){const other=!sameNsOk(A,B),host=nmOf(B)+(other?"."+nsOf(B):""),k=nmOf(B).toUpperCase().replace(/[^A-Z0-9]/g,"_")+"_HOST";
    return say(`gọi Service qua DNS (biến ${k}=${host})`,()=>{const c=ctrOf(A);c.env=arr(c.env).filter(e=>e.name!==k).concat([{name:k,value:host}])})}
  if(ta==="HorizontalPodAutoscaler"&&WORKLOADS.includes(tb)&&sameNsOk(A,B))return say("tự co giãn workload này",()=>{A.props.spec.scaleTargetRef={apiVersion:"apps/v1",kind:tb,name:nmOf(B)}});
  if(ta==="NetworkPolicy"&&WORKLOADS.includes(tb)&&sameNsOk(A,B))return say("áp policy cho pod của workload này",()=>{A.props.spec.podSelector={matchLabels:clone(podLabels(B))}});
  return null}
function whyNot(a,b){const A=nodeOf(a),B=nodeOf(b);if(!A||!B)return"";
  const can={"CloudLab::Client":"Ingress hoặc Service",Ingress:"Service cùng namespace",Service:"Deployment / StatefulSet cùng namespace (để chọn pod)",Deployment:"ConfigMap, Secret, PVC (cùng namespace) hoặc Service",StatefulSet:"ConfigMap, Secret, PVC (cùng namespace) hoặc Service",
    CronJob:"ConfigMap, Secret hoặc Service",HorizontalPodAutoscaler:"Deployment / StatefulSet cùng namespace",NetworkPolicy:"Deployment / StatefulSet cùng namespace"}[A.type];
  if(can&&!A.ext&&!B.ext&&nsOf(A)!==nsOf(B)&&!(B.type==="Service"))return`${A.def.label} ở namespace ${nsOf(A)}, ${B.def.label} ở ${nsOf(B)}: ${A.def.label} chỉ nối tới ${can}`;
  return can?`${A.def.label} chỉ nối tới ${can}`:`${A.def.label} không nối đi đâu được`}
/* ---------------- YAML: multi-document manifest ---------------- */
const KIND_ORDER=["Namespace","ConfigMap","Secret","PersistentVolumeClaim","Deployment","StatefulSet","CronJob","Service","Ingress","HorizontalPodAutoscaler","NetworkPolicy"];
function cleanV(v){if(Array.isArray(v))return v.map(cleanV);if(v&&typeof v==="object"){const o={};for(const k of Object.keys(v)){if(v[k]===null||v[k]===undefined)continue;o[k]=cleanV(v[k])}return o}return v}
const docOf=(id,r,ext)=>{const d=T[r.Type]||{},p=r.Properties||{},o={apiVersion:ext?(d.api||"cloudlab.dev/v1"):(p.apiVersion||API[r.Type]||"v1"),kind:ext?(d.kind||r.Type.replace("CloudLab::","")):r.Type,metadata:p.metadata||{name:id.split("/").pop()}};
  for(const k of Object.keys(p))if(k!=="metadata"&&k!=="apiVersion")o[k]=p[k];return cleanV(o)};
function toYaml(m,opts){m=m||M;opts=opts||{};const docs=[];
  const res=Object.entries(m.res).sort((a,b)=>{const ia=KIND_ORDER.indexOf(a[1].Type),ib=KIND_ORDER.indexOf(b[1].Type);return(ia<0?99:ia)-(ib<0?99:ib)});
  for(const[id,r]of res)docs.push(docOf(id,r,false));
  const dump=d=>typeof jsyaml==="undefined"?JSON.stringify(d,null,2)+"\n":jsyaml.dump(d,{lineWidth:110,noRefs:true,sortKeys:false});
  let out=`# CloudLab Kubernetes · ${m.name}${m.desc?" · "+m.desc:""}\n`+docs.map(dump).join("---\n");
  if(!opts.clean&&Object.keys(m.ext).length)out+="---\n# CloudLab: phần mô phỏng (khách hàng, node pool). Không apply lên cluster thật.\n"+Object.entries(m.ext).map(([id,r])=>dump(docOf(id,r,true))).join("---\n");
  return out}
function fromYaml(text,keep){let docs=[];keep=keep||{};
  try{if(typeof jsyaml==="undefined")throw new Error("thiếu js-yaml");jsyaml.loadAll(String(text),d=>{if(d!=null)docs.push(d)})}catch(e){const ln=e.mark?e.mark.line+1:null;return{ok:false,err:(e.reason||e.message||"YAML lỗi").split("\n")[0],line:ln}}
  docs=docs.flatMap(d=>d&&d.kind==="List"&&Array.isArray(d.items)?d.items:[d]);
  const m=emptyModel(keep.name);const first=/^#\s*CloudLab Kubernetes · [^·\n]+(?: · (.*))?$/m.exec(String(text).split("\n")[0]||"");m.desc=first&&first[1]||"";m.manual=clone(keep.manual||{});
  for(let i=0;i<docs.length;i++){const d=docs[i];if(!d||typeof d!=="object"||Array.isArray(d))return{ok:false,err:`Tài liệu thứ ${i+1} phải là một object YAML (có apiVersion, kind, metadata).`};
    if(!d.kind)return{ok:false,err:`Tài liệu thứ ${i+1}: thiếu kind.`};const name=getP(d,"metadata.name");
    if(!name||typeof name!=="string")return{ok:false,err:`${d.kind} (tài liệu ${i+1}): thiếu metadata.name.`};if(!DNS1123.test(name))return{ok:false,err:`${d.kind} "${name}": tên chỉ gồm chữ thường, số, dấu - và dấu chấm.`};
    const isCl=String(d.apiVersion||"").startsWith("cloudlab.dev/");let type=d.kind;
    if(isCl){type="CloudLab::"+d.kind;if(!T[type])return{ok:false,err:`cloudlab.dev: không có kind ${d.kind} (có Client, NodePool).`}}
    else if(API[d.kind]&&d.apiVersion&&d.apiVersion!==API[d.kind])return{ok:false,err:`${d.kind} "${name}": no matches for kind "${d.kind}" in version "${d.apiVersion}" (dùng ${API[d.kind]}).`};
    const ns=type==="Namespace"||isCl?null:(getP(d,"metadata.namespace")||"default");let id=idFor(type,name);
    if(m.res[id]||m.ext[id]){const prev=m.res[id]||m.ext[id];if((getP(prev,"Properties.metadata.namespace")||"default")===ns)return{ok:false,err:`${d.kind} "${name}" khai báo hai lần trong namespace ${ns}.`};id=id+"@"+ns}
    const props={};for(const k of Object.keys(d))if(k!=="kind"&&k!=="apiVersion")props[k]=d[k];if(!isCl&&d.apiVersion&&API[d.kind]!==d.apiVersion)props.apiVersion=d.apiVersion;
    (isCl?m.ext:m.res)[id]={Type:type,Properties:props}}
  /* positions: keep known ones, put new blocks in columns by role */
  const old=keep.pos||{},col={"CloudLab::Client":0,Ingress:1,Service:1,NetworkPolicy:1,Deployment:2,StatefulSet:2,CronJob:2,HorizontalPodAutoscaler:2,ConfigMap:3,Secret:3,PersistentVolumeClaim:3,Namespace:4,"CloudLab::NodePool":0},cnt={};
  for(const id of [...Object.keys(m.ext),...Object.keys(m.res),...Object.keys(m.manual)]){if(old[id]){m.pos[id]=old[id];continue}const t=(m.res[id]||m.ext[id]||m.manual[id]).Type,c=col[t]??4;cnt[c]=(cnt[c]||0)+1;m.pos[id]=[40+c*340,60+(cnt[c]-1)*200]}
  return{ok:true,model:m}}
function loadTemplate(yaml,layout,name,manual){const r=fromYaml(yaml,{name,pos:layout||{},manual:manual||{}});if(!r.ok)throw new Error(name+": "+r.err+(r.line?" @"+r.line:""));return r.model}
