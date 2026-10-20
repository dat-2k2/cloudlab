"use strict";
/* Kubernetes pack · the edge of the cluster: how traffic gets in.
   - IngressController (cloudlab.dev/v1): the controller an Ingress needs. ingress-nginx serves every Ingress of class
     nginx behind one load balancer (internet-facing or internal) and honours rate-limit annotations; the AWS Load
     Balancer Controller gives each Ingress of class alb its own ALB (scheme from an annotation, internal by default).
   - Service type LoadBalancer: Classic LB by default (in-tree), or an NLB through the AWS Load Balancer Controller;
     internet-facing or internal, from annotations.
   - Where a client sits: Internet, the bank's internal network (VPN / Direct Connect into the VPC), or a pod.
   - Rate limiting per client IP (nginx.ingress.kubernetes.io/limit-rps / limit-rpm).
   - Gateway API: Gateway (listeners) + HTTPRoute (hosts, paths, weighted backends for canary releases). */
const A_LB_TYPE="service.beta.kubernetes.io/aws-load-balancer-type",A_LB_SCHEME="service.beta.kubernetes.io/aws-load-balancer-scheme",A_LB_INTERNAL="service.beta.kubernetes.io/aws-load-balancer-internal",A_NLB_TARGET="service.beta.kubernetes.io/aws-load-balancer-nlb-target-type";
const A_RPS="nginx.ingress.kubernetes.io/limit-rps",A_RPM="nginx.ingress.kubernetes.io/limit-rpm",A_ALB_SCHEME="alb.ingress.kubernetes.io/scheme";
const annOf=n=>meta(n).annotations||{};
const LB_PRICE={clb:0.028,nlb:0.0252,alb:0.0252};
/* what a Service of type LoadBalancer becomes on AWS */
function lbInfo(svc){const a=annOf(svc),ty=String(a[A_LB_TYPE]||"").toLowerCase(),lbc=ty==="external"||!!a[A_NLB_TARGET];
  const kind=lbc||ty==="nlb"?"nlb":"clb",internal=lbc?String(a[A_LB_SCHEME]||"internal")!=="internet-facing":String(a[A_LB_INTERNAL]||"")==="true"||String(a[A_LB_SCHEME]||"")==="internal";
  return{kind,lbc,internal,label:`${kind==="nlb"?"NLB":"Classic LB"} · ${internal?"internal":"internet-facing"}`}}
/* ingress controllers on the canvas, by class */
const ctlOf=cls=>allNodes().find(n=>n.type==="CloudLab::IngressController"&&ctlClass(n)===cls)||null;
const ctlClass=c=>getP(c.props,"spec.controller")==="aws-load-balancer-controller"?"alb":"nginx";
const ingClass=i=>getP(i.props,"spec.ingressClassName")||"nginx";
const albInternal=i=>String(annOf(i)[A_ALB_SCHEME]||"internal")!=="internet-facing";
/* where a request comes from: a pod (namespace + labels), the bank's internal network, or the Internet */
const srcOf=d=>d.from&&d.from.namespace?{ns:d.from.namespace,labels:d.from.labels||{}}:d.network==="vpc"?{external:true,vpc:true}:{external:true};
const srcTxt=s=>s.ns?`pod ở namespace ${s.ns}`:s.vpc?"mạng nội bộ ngân hàng":"Internet";
/* can this source reach an entry point with this exposure? internet-facing: everyone · internal: VPC + pods · cluster: pods */
function reachable(src,exposure){if(exposure==="internet")return true;if(exposure==="internal")return!src.external||src.vpc;return!src.external}
const exposureTxt={internet:"internet-facing",internal:"internal (chỉ mạng nội bộ)",cluster:"chỉ trong cluster"};
/* rate limit annotations → requests per second per client IP (null = none) */
function rateLimit(i){const a=annOf(i);if(a[A_RPS]!=null&&a[A_RPS]!=="")return+a[A_RPS];if(a[A_RPM]!=null&&a[A_RPM]!=="")return+a[A_RPM]/60;return null}

def("CloudLab::IngressController",{label:"Ingress controller",short:"CTL",cat:"net",ext:true,api:"cloudlab.dev/v1",kind:"IngressController",
  doc:"Chương trình thật sự nhận traffic cho các Ingress (cài bằng Helm, không phải một kind Kubernetes). ingress-nginx: một load balancer dùng chung cho mọi Ingress class nginx, hiểu annotation giới hạn tốc độ. AWS Load Balancer Controller: mỗi Ingress class alb có một ALB riêng. Không có controller thì Ingress không có địa chỉ. Lưu ý: dự án ingress-nginx đã ngừng bảo trì từ tháng 3/2026 (không còn bản vá bảo mật); hệ thống mới nên dùng Gateway API.",
  defaults:()=>({spec:{controller:"ingress-nginx",scheme:"internet-facing",rateLimitStatus:503}}),
  fields:[{k:"spec.controller",label:"Controller",type:"select",options:[["ingress-nginx","ingress-nginx · class nginx · một NLB dùng chung"],["aws-load-balancer-controller","AWS Load Balancer Controller · class alb · mỗi Ingress một ALB"]]},
    {k:"spec.scheme",label:"Load balancer của controller",type:"select",options:[["internet-facing","internet-facing · có IP public"],["internal","internal · chỉ mạng nội bộ"]],when:p=>getP(p,"spec.controller")!=="aws-load-balancer-controller"},
    {k:"spec.rateLimitStatus",label:"Mã trả về khi vượt giới hạn tốc độ",type:"select",num:true,options:[[503,"503 (mặc định của ingress-nginx)"],[429,"429 Too Many Requests"]],when:p=>getP(p,"spec.controller")!=="aws-load-balancer-controller",help:"Cấu hình limit-req-status-code của ingress-nginx."}]});
def("Gateway",{label:"Gateway (Gateway API)",short:"GW",cat:"net",
  doc:"Thế hệ sau của Ingress: Gateway là cửa vào (cổng, tên miền, chứng chỉ) do đội hạ tầng quản lý; các HTTPRoute do từng đội app gắn vào để chia đường dẫn, kể cả chia theo tỷ lệ (90% bản cũ, 10% bản mới).",
  defaults:id=>({metadata:{name:id},spec:{gatewayClassName:"nginx",listeners:[{name:"http",port:80,protocol:"HTTP",hostname:"ib.anphat.vn"}]}}),
  fields:[{k:"metadata.namespace",label:"Namespace",type:"nsref"},{k:"spec.gatewayClassName",label:"GatewayClass",type:"select",options:[["nginx","nginx (NGINX Gateway Fabric)"],["aws-alb","aws-alb (AWS Load Balancer Controller)"]]},{k:"spec.listeners",label:"Listener",type:"listeners"}]});
def("HTTPRoute",{label:"HTTPRoute",short:"RT",cat:"net",
  doc:"Luật định tuyến gắn vào một Gateway: tên miền + đường dẫn → một hoặc nhiều Service, mỗi Service một trọng số (weight). Dùng để chuyển dần traffic sang bản mới (canary).",
  defaults:id=>({metadata:{name:id},spec:{parentRefs:[{name:""}],hostnames:["ib.anphat.vn"],rules:[{matches:[{path:{type:"PathPrefix",value:"/"}}],backendRefs:[]}]}}),
  fields:[{k:"metadata.namespace",label:"Namespace",type:"nsref"},{k:"spec.parentRefs.0.name",label:"Gắn vào Gateway",type:"gwref"},{k:"spec.hostnames",label:"Tên miền",type:"textlist",help:"Cách nhau bằng dấu phẩy."},{k:"spec.rules",label:"Luật (đường dẫn → Service, trọng số)",type:"hroutes"}]});

/* ---------------- edges ---------------- */
EDGE_X.push((n,add)=>{const p=n.props,ns=nsOf(n);
  if(n.type==="CloudLab::IngressController")for(const i of allNodes())if(i.type==="Ingress"&&ingClass(i)===ctlClass(n))add({from:n.id,to:i.id,kind:"routes",label:"class "+ctlClass(n),owner:n.id,path:"spec.controller"});
  if(n.type==="HTTPRoute"){for(const r of arr(getP(p,"spec.parentRefs"))){const g=r&&r.name&&findObj("Gateway",r.name,r.namespace||ns);if(g)add({from:g.id,to:n.id,kind:"routes",label:arr(getP(p,"spec.hostnames")).join(", ")||"*",owner:n.id,path:"spec.parentRefs"})}
    arr(getP(p,"spec.rules")).forEach((r,i)=>arr(r&&r.backendRefs).forEach((b,j)=>{const s=b&&findObj("Service",b.name,b.namespace||ns);const tot=arr(r.backendRefs).reduce((a,x)=>a+(x&&x.weight!=null?+x.weight:1),0);
      if(s)add({from:n.id,to:s.id,kind:"routes",label:`${getP(r,"matches.0.path.value")||"/"}${arr(r.backendRefs).length>1?` · ${Math.round((b.weight!=null?+b.weight:1)/(tot||1)*100)}%`:""}`,owner:n.id,path:`spec.rules.${i}.backendRefs.${j}`})}))}});
REMOVE_EDGE_K.routes=(e,o)=>{if(o.type==="HTTPRoute"&&e.path.startsWith("spec.rules.")){const ks=e.path.split("."),r=arr(getP(o.props,"spec.rules"))[+ks[2]];if(r)r.backendRefs.splice(+ks[4],1);return true}
  if(o.type==="HTTPRoute"&&e.path==="spec.parentRefs"){o.props.spec.parentRefs=[];return true}return false};
CONNECT_K.push((A,B,say)=>{const ta=A.type,tb=B.type;
  if(ta==="CloudLab::Client"&&(tb==="Gateway"||tb==="CloudLab::IngressController"))return say(tb==="Gateway"?"gửi request tới Gateway":"gửi request tới ingress controller",()=>{A.props.spec=A.props.spec||{};A.props.spec.target=B.id;if(!A.props.spec.host)A.props.spec.host="ib.anphat.vn";A.props.spec.path=A.props.spec.path||"/"});
  if(ta==="HTTPRoute"&&tb==="Gateway"&&nsOf(A)===nsOf(B))return say("gắn route vào Gateway này",()=>{A.props.spec.parentRefs=[{name:nmOf(B)}]});
  if(ta==="HTTPRoute"&&tb==="Service"&&nsOf(A)===nsOf(B))return say("thêm Service làm backend (trọng số)",()=>{const sp=arr(getP(B.props,"spec.ports"))[0]||{port:80};A.props.spec.rules=arr(A.props.spec.rules);let r=A.props.spec.rules[0];if(!r){r={matches:[{path:{type:"PathPrefix",value:"/"}}],backendRefs:[]};A.props.spec.rules.push(r)}
    r.backendRefs=arr(r.backendRefs).concat([{name:nmOf(B),port:+sp.port||80,weight:r.backendRefs&&r.backendRefs.length?10:100}])});
  if(ta==="Ingress"&&tb==="CloudLab::IngressController")return say("dùng controller này (ingressClassName)",()=>{A.props.spec.ingressClassName=ctlClass(B)});
  return null});
Object.assign(WHY_K,{HTTPRoute:"Gateway hoặc Service cùng namespace",Gateway:"(Gateway nhận HTTPRoute gắn vào, nối từ HTTPRoute sang)","CloudLab::IngressController":"(controller tự phục vụ mọi Ingress cùng class)"});
RENAME_K.push((n,old,name,ns,o)=>{if(n.type==="Gateway"&&o.type==="HTTPRoute")for(const r of arr(getP(o.props,"spec.parentRefs")))if(r&&r.name===old&&(r.namespace||nsOf(o))===ns)r.name=name;
  if(n.type==="Service"&&o.type==="HTTPRoute"&&nsOf(o)===ns)for(const r of arr(getP(o.props,"spec.rules")))for(const b of arr(r&&r.backendRefs))if(b&&b.name===old)b.name=name});

/* ---------------- routing ---------------- */
/* rate limiting: per client IP. A client stands for `sources` distinct IPs sharing its rate */
function limited(i,d,w){const lim=rateLimit(i);if(lim==null)return 0;const ips=Math.max(1,+d.sources||1),perIp=(+d.rate||w)/ips;return perIp>lim?w*(1-lim/perIp):0}
/* find the Ingress rule a request matches among the given Ingresses: host, then the longest path */
function ingMatch(list,host,path){let best=null;for(const n of list)arr(getP(n.props,"spec.rules")).forEach(r=>{if(!r||(r.host&&String(r.host).toLowerCase()!==host))return;arr(getP(r,"http.paths")).forEach(x=>{if(!x)return;const p=x.path||"/",hit=x.pathType==="Exact"?path===p:(path===p||path.startsWith(p.endsWith("/")?p:p+"/")||p==="/");if(hit&&(!best||p.length>best.p.length))best={p,x,ing:n}})});return best}
function viaIngress(ev,T1,entry){const w=ev.w,d=ev.data||{},src=srcOf(d),host=String(d.host||"").toLowerCase(),path=d.path||"/",id=entry.id;
  const fail=msg=>{if(ev.from)flow(ev.from,id,"calls",w,msg);bump(id,"err",w);nrt(id).lastErr=msg;return{ok:false,err:msg,errW:w}};
  let cls,ctl,cands;
  if(entry.type==="CloudLab::IngressController"){ctl=entry;cls=ctlClass(entry);if(cls==="alb")return fail("Với AWS Load Balancer Controller, mỗi Ingress có ALB riêng: gửi request tới chính Ingress đó");cands=allNodes().filter(x=>x.type==="Ingress"&&ingClass(x)===cls&&!RT.bad[x.id])}
  else{cls=ingClass(entry);ctl=ctlOf(cls);if(!ctl)return fail(`Không có ingress controller cho class ${cls}: Ingress không có địa chỉ (kubectl get ingress: cột ADDRESS trống). Thêm khối Ingress controller.`);
    cands=cls==="alb"?[entry]:allNodes().filter(x=>x.type==="Ingress"&&ingClass(x)===cls&&!RT.bad[x.id])}
  const expo=cls==="alb"?(albInternal(entry)?"internal":"internet"):(getP(ctl.props,"spec.scheme")==="internal"?"internal":"internet");
  if(!reachable(src,expo))return fail(cls==="alb"?`ALB của Ingress này là internal (annotation ${A_ALB_SCHEME} mặc định internal): ${srcTxt(src)} không tới được. Đặt internet-facing nếu khách ngoài Internet cần vào.`:`Load balancer của ingress controller là internal: ${srcTxt(src)} không tới được`);
  if(ev.from)flow(ev.from,id,"calls",w);bump(id,"req",w);
  const best=ingMatch(cands,host,path);if(!best){bump(id,"err",w);const m=`404 Not Found: không Ingress nào (class ${cls}) có luật cho ${host||"(không host)"}${path}`;nrt(id).lastErr=m;return{ok:false,err:m,errW:w}}
  const ing=best.x&&best.ing;if(ing.id!==id){flow(id,ing.id,"routes",w);bump(ing.id,"req",w)}
  const sname=getP(best.x,"backend.service.name"),s=findObj("Service",sname,nsOf(ing));
  if(!s){bump(ing.id,"err",w);const m=`503: Ingress ${nmOf(ing)} trỏ tới Service "${sname}" không có trong namespace ${nsOf(ing)}`;nrt(ing.id).lastErr=m;return{ok:false,err:m,errW:w}}
  charge(cls==="alb"?ing.id:ctl.id,w*20/1048576*K8S_PRICE.egressGB,"truyền ra Internet");
  /* nginx rate limit (per client IP) */
  const cut=cls==="nginx"?limited(ing,d,w):0;let errW=0,err=null;
  if(cut>0){const code=+getP(ctl.props,"spec.rateLimitStatus")||503;bump(ing.id,"limited",cut);errW+=cut;err=`${code} ${code===429?"Too Many Requests":"Service Temporarily Unavailable"}: vượt giới hạn ${rateLimit(ing)} request/giây mỗi IP (nginx limit-rps)`;nrt(ing.id).lastErr=err}
  const pass=w-cut;if(pass>0){const r=svcHop(s.id,cls==="alb"?{external:true,vpc:true}:src.external?INGRESS_SRC:src,+getP(best.x,"backend.service.port.number")||null,pass,ing.id,"routes",T1);if(r.errW){errW+=r.errW;err="502/503 · "+r.err}}
  if(errW>0){bump(ing.id,"err",errW);if(ing.id!==id)bump(id,"err",errW);nrt(ing.id).lastErr=err;return{ok:errW<w,err,errW}}return{ok:true}}
ROUTE_K.Ingress=viaIngress;ROUTE_K["CloudLab::IngressController"]=viaIngress;
/* Gateway API: listeners (port/hostname) + HTTPRoutes attached by parentRefs; weighted backends */
ROUTE_K.Gateway=(ev,T1,g)=>{const w=ev.w,d=ev.data||{},src=srcOf(d),host=String(d.host||"").toLowerCase(),path=d.path||"/",id=g.id;
  const fail=msg=>{if(ev.from)flow(ev.from,id,"calls",w,msg);bump(id,"err",w);nrt(id).lastErr=msg;return{ok:false,err:msg,errW:w}};
  if(!["nginx","aws-alb"].includes(getP(g.props,"spec.gatewayClassName")))return fail(`GatewayClass "${getP(g.props,"spec.gatewayClassName")}" không có trong cluster (có nginx, aws-alb): Gateway không được cấp địa chỉ`);
  const ls=arr(getP(g.props,"spec.listeners")).filter(l=>l&&(!l.hostname||String(l.hostname).toLowerCase()===host));if(!ls.length)return fail(`Gateway không có listener cho ${host}`);
  if(ev.from)flow(ev.from,id,"calls",w);bump(id,"req",w);
  let best=null;for(const r of allNodes()){if(r.type!=="HTTPRoute"||RT.bad[r.id]||nsOf(r)!==nsOf(g)||!arr(getP(r.props,"spec.parentRefs")).some(x=>x&&x.name===nmOf(g)))continue;
    const hs=arr(getP(r.props,"spec.hostnames"));if(hs.length&&!hs.map(x=>String(x).toLowerCase()).includes(host))continue;
    for(const rule of arr(getP(r.props,"spec.rules"))){const ms=arr(rule&&rule.matches);const ps=ms.length?ms.map(m=>getP(m||{},"path.value")||"/"):["/"];for(const p of ps){const hit=path===p||p==="/"||path.startsWith(p.endsWith("/")?p:p+"/");if(hit&&(!best||p.length>best.p.length))best={p,rule,route:r}}}}
  if(!best){bump(id,"err",w);const m=`404: không HTTPRoute nào gắn vào ${nmOf(g)} khớp ${host}${path}`;nrt(id).lastErr=m;return{ok:false,err:m,errW:w}}
  flow(id,best.route.id,"routes",w);bump(best.route.id,"req",w);const bs=arr(best.rule.backendRefs).filter(Boolean),tot=bs.reduce((a,b)=>a+(b.weight!=null?+b.weight:1),0);
  if(!bs.length||!tot){bump(id,"err",w);const m=`500: route ${nmOf(best.route)} không có backend`;nrt(id).lastErr=m;return{ok:false,err:m,errW:w}}
  charge(id,w*20/1048576*K8S_PRICE.egressGB,"truyền ra Internet");let errW=0,err=null;
  for(const b of bs){const share=w*(b.weight!=null?+b.weight:1)/tot;if(share<=0)continue;const s=findObj("Service",b.name,b.namespace||nsOf(best.route));if(!s){errW+=share;err=`Service ${b.name} không có`;continue}
    const r=svcHop(s.id,{external:true,vpc:true},+b.port||null,share,best.route.id,"routes",T1);if(r.errW){errW+=r.errW;err=r.err}}
  if(errW>0){bump(id,"err",errW);nrt(id).lastErr=err;return{ok:errW<w,err,errW}}return{ok:true}};
/* a Service called from outside the cluster: ClusterIP is not routable, NodePort only from the VPC, LB by its scheme */
function svcEntry(ev,T1,n){const w=ev.w,d=ev.data||{},src=srcOf(d),id=n.id,ty=getP(n.props,"spec.type")||"ClusterIP";
  const fail=msg=>{if(ev.from)flow(ev.from,id,"calls",w,msg);bump(id,"err",w);nrt(id).lastErr=msg;return{ok:false,err:msg,errW:w}};
  if(src.external&&ty==="ClusterIP")return fail("ClusterIP chỉ có địa chỉ bên trong cluster, từ ngoài không gọi tới được (dùng Ingress, hoặc LoadBalancer)");
  if(src.external&&ty==="NodePort"&&!src.vpc)return fail("NodePort mở cổng trên IP của node, nhưng node nằm ở private subnet nên Internet không tới được (dùng Ingress)");
  if(ty==="LoadBalancer"&&src.external){const L=lbInfo(n);if(L.internal&&!src.vpc)return fail(`Load balancer của Service này là internal${L.lbc?" (AWS Load Balancer Controller mặc định internal)":""}: Internet không tới được`)}
  if(src.external&&!src.vpc)charge(id,w*20/1048576*K8S_PRICE.egressGB,"truyền ra Internet");
  return svcHop(id,src,+d.port||null,w,ev.from,"calls",T1)}
ROUTE_K.Service=svcEntry;
/* hourly cost of entry points */
TICK_K.push((t0,dt)=>{const h=dt/3600,ip=2*K8S_PRICE.ipv4H;
  for(const n of allNodes()){if(RT.bad[n.id])continue;
    if(n.type==="Service"&&getP(n.props,"spec.type")==="LoadBalancer"){const L=lbInfo(n);charge(n.id,(LB_PRICE[L.kind]+(L.internal?0:ip))*h,`${L.kind==="nlb"?"NLB":"Classic LB"}${L.internal?" internal":" + 2 IPv4"}`)}
    if(n.type==="CloudLab::IngressController"&&ctlClass(n)==="nginx"&&allNodes().some(x=>x.type==="Ingress"&&ingClass(x)==="nginx"))charge(n.id,(LB_PRICE.nlb+(getP(n.props,"spec.scheme")==="internal"?0:ip))*h,"NLB của ingress-nginx");
    if(n.type==="Ingress"&&ingClass(n)==="alb"&&ctlOf("alb"))charge(n.id,(LB_PRICE.alb+(albInternal(n)?0:ip))*h,"ALB riêng của Ingress");
    if(n.type==="Gateway")charge(n.id,(LB_PRICE[getP(n.props,"spec.gatewayClassName")==="aws-alb"?"alb":"nlb"]+ip)*h,"load balancer của Gateway")}});
LINT_K.push((n,add)=>{const id=n.id,p=n.props;
  if(n.type==="Ingress"){if(!ctlOf(ingClass(n)))add("error",id,`${id}: chưa có ingress controller cho class ${ingClass(n)}: Ingress sẽ không có địa chỉ`);
    if(ingClass(n)==="alb"&&rateLimit(n)!=null)add("warn",id,`${id}: ALB không hiểu annotation limit-rps của nginx. Giới hạn tốc độ trên ALB dùng AWS WAF (rate-based rule)`);
    if(ingClass(n)==="alb"&&!annOf(n)[A_ALB_SCHEME])add("info",id,`${id}: chưa đặt ${A_ALB_SCHEME}: AWS Load Balancer Controller mặc định tạo ALB internal`)}
  if(n.type==="Service"&&getP(p,"spec.type")==="LoadBalancer"){const L=lbInfo(n);if(L.kind==="clb")add("info",id,`${id}: tạo Classic Load Balancer (thế hệ cũ). Trên EKS nên dùng NLB qua AWS Load Balancer Controller`)}
  if(n.type==="HTTPRoute"){for(const r of arr(getP(p,"spec.parentRefs")))if(r&&r.name&&!findObj("Gateway",r.name,r.namespace||nsOf(n)))add("error",id,`${id}: parentRef Gateway ${r.name} không có trong namespace ${r.namespace||nsOf(n)}`);
    for(const r of arr(getP(p,"spec.rules")))for(const b of arr(r&&r.backendRefs))if(b&&!findObj("Service",b.name,b.namespace||nsOf(n)))add("error",id,`${id}: backend Service ${b.name} không có`)}
  if(n.type==="Gateway"&&!["nginx","aws-alb"].includes(getP(p,"spec.gatewayClassName")))add("error",id,`${id}: GatewayClass ${getP(p,"spec.gatewayClassName")} không có trong cluster`)});
