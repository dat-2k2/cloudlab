"use strict";
/* Canvas: free-form node editor over the template. Nodes = resources/actors with live status + cost;
   edges = references (typed, coloured by what the simulation saw). Pan, zoom, drag nodes, drag from the
   out-port to connect (or click it / press C for the keyboard list), drop palette items to create, list view on phones. */
const GHEAD=62,GW=260;
let GCUR={z:1,pan:[0,0]},GD=null,GSUP=0;
const gs=()=>UI.g||(UI.g={view:null,zoom:null,pan:[0,0],trace:false});
/* ---------- what a node shows ---------- */
function nodeView(n){const r=RT.n[n.id]||{m:{},tk:{},series:[]},m=r.m,p=n.props,up=exists(n.id),rows=[];let st=null;
  const rate=k=>{const L=r.series.slice(-4),dt=L.reduce((a,x)=>a+x.dt,0);return dt?L.reduce((a,x)=>a+(x[k]||0),0)/dt:0};
  const perS=k=>{const v=rate(k);return v>=1?num(v)+"/s":v*60>=1?num(v*60)+"/phút":v*3600>=1?num(v*3600)+"/giờ":v>0?num(v*86400)+"/ngày":"—"};
  switch(n.type){
    case"CloudLab::Client":{const tg=refId(p.Target),tn=tg&&nodeOf(tg);rows.push(["Tần suất",`${+p.RatePerSecond||0}/s`,""]);
      if(tn&&tn.type==="AWS::S3::Bucket")rows.push([String(p.Action||"s3:GetObject").replace("s3:",""),p.Key||"",""]);
      rows.push(["Thành công · lỗi",`${num(m.ok||0)} · ${num(m.err||0)}`,m.err?(p.Expect==="Deny"?"ok":"bad"):m.ok?(p.Expect==="Deny"||m.leak?"bad":"ok"):"none"]);
      if(m.leak)st=["bad","Lộ dữ liệu"];else if(p.Expect==="Deny")st=m.ok?["bad","Không bị chặn"]:m.err?["ok","Bị chặn ✓"]:null;else if(r.tk.err&&!r.tk.ok)st=["bad","Lỗi"];else if(!tg)st=["off","Chưa nối"];break}
    case"CloudLab::Uploader":rows.push(["Tần suất",`${+p.PerHour||0} file/giờ`,""],["Key",`${p.Prefix||""}*${p.Suffix||""}`,""],["Đã upload",num(m.sent||0),"none"]);if(!refId(p.Target))st=["off","Chưa nối"];break;
    case"CloudLab::Inbox":{const L=RT.inbox[n.id]||[],un=L.filter(x=>!x.read).length,pend=L.some(x=>x.kind==="confirm"&&!x.done);rows.push(["Thư",String(L.length),"none"],["Chưa đọc",String(un),un?"warn":"none"]);
      if(pend)st=["warn","Chờ xác nhận"];else if(L.some(x=>x.kind==="alert"||x.kind==="alarm"))st=["ok",`${L.filter(x=>x.kind!=="confirm").length} cảnh báo`];break}
    case"CloudLab::Monitor":for(const w of arr(p.Watch).map(refId).filter(Boolean).slice(0,3)){const wn=nodeOf(w);if(!wn)continue;const s=(RT.n[w]||{series:[]}).series;rows.push([wn.id,"",(s.some(x=>x.err)?"bad":"ok"),s])}break;
    case"AWS::ApiGatewayV2::Api":rows.push(["Request",perS("req"),""],["Lỗi (5xx)",num(m.err||0),m.err?"bad":"none"]);if(!targetOf(p.Target))st=["warn","Chưa có integration"];else if(r.tk.err)st=["bad","502"];break;
    case"AWS::Lambda::Function":{rows.push(["Memory · timeout",`${p.MemorySize||128} MB · ${p.Timeout||3} s`,""],["Lần chạy",perS("inv"),""],["Lỗi",num(m.err||0),m.err?"bad":"none"]);
      if(r.noLogs&&m.inv)rows.push(["Log","không ghi được","bad"]);
      if(r.series.slice(-3).some(x=>x.loop))st=["bad","Vòng lặp"];else if(r.last&&!r.last.ok)st=["bad",r.last.timed?"Timeout":"Lỗi"];else if(!refId(p.Role))st=["warn","Thiếu role"];else if(r.last&&r.last.ok)st=["ok",`${Math.round(r.last.dur)} ms`];break}
    case"AWS::IAM::Role":{const st0=roleStatements(n.id);rows.push(["Statement",String(st0.length),""],["Deny",String(st0.filter(s=>s.Effect==="Deny").length),st0.some(s=>s.Effect==="Deny")?"warn":"none"]);
      if(st0.some(s=>matchAny(arr(s.Action),"iam:CreateUser")&&s.Effect==="Allow"&&arr(resolve(s.Resource)).includes("*")))st=["warn","Quyền admin"];break}
    case"AWS::S3::Bucket":{const o=RT.obj[n.id]||{},cnt=Object.values(o).reduce((a,x)=>a+x.n,0),gb=Object.values(o).reduce((a,x)=>a+x.kb*x.n,0);const nc=arr(getP(p,"NotificationConfiguration.LambdaConfigurations")).length;
      rows.push(["Object",num(cnt),""],["Dung lượng",kb(gb),""]);if(nc)rows.push(["Trigger",nc+" → Lambda",""]);
      const c=p.PublicAccessBlockConfiguration||{};if(!(c.BlockPublicPolicy&&c.RestrictPublicBuckets))st=["warn","BPA tắt"];if(m.leak)st=["bad","Đang bị đọc công khai"];break}
    case"AWS::S3::BucketPolicy":{const S=arr(getP(p,"PolicyDocument.Statement"));rows.push(["Statement",String(S.length),""]);if(S.some(s=>s.Effect==="Allow"&&isPublicPrincipal(s.Principal)))st=["bad",'Principal "*"'];break}
    case"AWS::DynamoDB::Table":rows.push(["Item",num(RT.items[n.id]||0),""],["Ghi",perS("wr"),""]);break;
    case"AWS::SNS::Topic":{const S=arr(p.Subscription),pend=S.filter(s=>s&&s.Protocol==="email"&&RT.subs[n.id+"|"+s.Endpoint]==="PendingConfirmation").length;rows.push(["Subscription",String(S.length),S.length?"":"warn"],["Đã publish",num(m.pub||0),"none"]);if(pend)st=["warn",`${pend} chờ xác nhận`];break}
    case"AWS::SQS::Queue":rows.push(["Trong queue",num(RT.items[n.id]||0),""],["Đã nhận",num(m.sent||0),"none"]);break;
    case"AWS::Events::Rule":rows.push(["Lịch",p.ScheduleExpression||"",""],["Target",String(arr(p.Targets).length),""]);if(p.State==="DISABLED")st=["off","Tắt"];break;
    case"AWS::Logs::LogGroup":{const L=RT.logs[resolve(p.LogGroupName)]||[];rows.push(["Dòng log",num(L.length),L.length?"":"none"],["Giữ",`${p.RetentionInDays||"∞"} ngày`,""]);break}
    case"AWS::CloudWatch::Alarm":{const a=RT.alarms[n.id];rows.push(["Metric",`${p.MetricName} > ${p.Threshold}`,""],["Báo tới",String(arr(p.AlarmActions).length),arr(p.AlarmActions).length?"":"warn"]);if(a)st=a.state==="ALARM"?["bad","ALARM"]:["ok","OK"];break}
    case"AWS::Budgets::Budget":{const lim=+getP(p,"Budget.BudgetLimit.Amount")||0,pct=lim?RT.total/lim*100:0,th=budgetTh(n);rows.push(["Hạn mức",money(lim)+"/tháng",""],["Đã chi",`${money(RT.total)} · ${Math.round(pct)}%`,pct>=100?"bad":pct>=50?"warn":""],["Ngưỡng",th.length?th.map(x=>x+"%").join(" "):"không có",th.length?"":"bad"]);
      const f=(RT.budgets[n.id]||{fired:[]}).fired;if(f.length)st=["warn",`vượt ${Math.max(...f)}%`];break}
    case"AWS::EC2::Instance":{const cpu=r.cpu||0,s=subnetsOf(n)[0];rows.push(["Loại · subnet",`${p.InstanceType} · ${s||"default VPC"}`,s?"":"none"],["CPU",up&&r.series.slice(-2).some(x=>x.req)?cpu+"%":"—",cpu>=100?"bad":cpu>=70?"warn":""],["Request",perS("req"),""],["Lỗi",num(m.err||0),m.err?"bad":"none"]);
      if(r.series.slice(-2).some(x=>x.err)&&cpu>=100)st=["bad","Quá tải"];else if(r.series.slice(-2).some(x=>x.err))st=["bad","Lỗi"];else if(r.series.slice(-2).some(x=>x.req))st=["ok",`CPU ${cpu}%`];break}
    case"AWS::ElasticLoadBalancingV2::LoadBalancer":{const hh=r.healthy;rows.push(["Scheme",p.Scheme||"internet-facing",""],["Request",perS("req"),""],["Target khỏe",hh?`${hh[0]}/${hh[1]}`:String(targetsOf(n.id).length),hh&&hh[0]<hh[1]?"bad":""],["Lỗi",num(m.err||0),m.err?"bad":"none"]);
      if(subnetsOf(n).length<2)st=["warn","Cần ≥ 2 subnet"];else if(hh&&!hh[0])st=["bad","503"];else if(r.series.slice(-2).some(x=>x.err))st=["bad","Lỗi"];break}
    case"AWS::ElasticLoadBalancingV2::TargetGroup":rows.push(["Cổng",`${p.Protocol||"HTTP"} :${p.Port||80}`,""],["Target",String(arr(p.Targets).length),arr(p.Targets).length?"":"warn"]);break;
    case"AWS::RDS::DBInstance":{const cpu=r.cpu||0;rows.push(["Engine · class",`${p.Engine} · ${p.DBInstanceClass}`,""],["Truy vấn",perS("q"),""],["CPU",cpu?cpu+"%":"—",cpu>=100?"bad":cpu>=70?"warn":""]);
      if(p.PubliclyAccessible===true)st=["warn","Public"];if(cpu>=100)st=["bad","Quá tải"];else if(p.MultiAZ===true&&!st)st=["ok","Multi-AZ"];break}
    case"AWS::ElastiCache::CacheCluster":rows.push(["Node",p.CacheNodeType,""],["Trúng cache",m.req?Math.round((m.hit||0)/m.req*100)+"%":"—",""],["Request",perS("req"),""]);break;
    case"AWS::CloudFront::Distribution":rows.push(["Trúng cache",m.req?Math.round((m.hit||0)/m.req*100)+"%":"—",""],["Request",perS("req"),""],["Origin",String(arr(getP(p,"DistributionConfig.Origins")).length),arr(getP(p,"DistributionConfig.Origins")).length?"":"warn"]);if(!arr(getP(p,"DistributionConfig.Origins")).length)st=["warn","Chưa có origin"];break;
    case"AWS::Route53::RecordSet":rows.push(["Tên",p.Name||"",""],["Alias",refId(getP(p,"AliasTarget.DNSName"))||"—",refId(getP(p,"AliasTarget.DNSName"))?"":"warn"]);break;
    case"AWS::EC2::SecurityGroup":{const L=arr(p.SecurityGroupIngress),open=L.filter(x=>x.CidrIp==="0.0.0.0/0");rows.push(["Inbound",L.map(x=>(x.IpProtocol==="-1"?"*":portOfRule(x))).join(", ")||"không có",""],["Mở ra Internet",open.map(portOfRule).join(", ")||"không",open.length?"warn":"ok"]);
      if(open.some(x=>x.IpProtocol==="-1"||[22,3389,5432,3306,6379].some(pt=>pt>=+x.FromPort&&pt<=+(x.ToPort??x.FromPort))))st=["bad","Mở cổng nhạy cảm"];break}
    case"AWS::EC2::InternetGateway":if(!Object.values(M.res).some(x=>x.Type==="AWS::EC2::VPCGatewayAttachment"&&refId(x.Properties.InternetGatewayId)===n.id))st=["warn","Chưa gắn VPC"];rows.push(["Gắn vào",(Object.values(M.res).find(x=>x.Type==="AWS::EC2::VPCGatewayAttachment"&&refId(x.Properties.InternetGatewayId)===n.id)||{Properties:{}}).Properties.VpcId?refId(Object.values(M.res).find(x=>x.Type==="AWS::EC2::VPCGatewayAttachment"&&refId(x.Properties.InternetGatewayId)===n.id).Properties.VpcId):"—",""]);break}
  if(n.def.view){const s2=n.def.view(n,rows);if(s2)st=s2}
  if(n.scope==="manual")st=(getP(n.raw,"Metadata.CloudLab.Retained")?["warn","Bị giữ lại"]:["warn","Ngoài stack"]);
  else if(!up&&!n.ext)st=["off",RT.stack.status==="DELETE_COMPLETE"?"Đã xóa":"Chưa deploy"];
  const cost=r.cost||0,out=rows.slice(0,cost>0?3:4);if(cost>0)out.push(["Chi phí",money(cost),"cost"]);return{st,rows:out,cost,ghost:!up&&!n.ext}}
function gH(n,v){return GHEAD+(v.rows.length?19+v.rows.length*20:0)}
/* edge look from what the simulation saw this tick and before */
function edgeView(e){const f=RT.flow[e.id],from=nodeOf(e.from),style=(REL[e.kind]||{style:"role"}).style;let st="idle",label=e.label||"",why=RT.why[e.id]||"";
  const expectDeny=from&&from.type==="CloudLab::Client"&&from.props.Expect==="Deny";
  if(e.deny)st="deny";
  if(f){if(f.tke&&!f.tk)st=expectDeny?"blocked":"stop";else if(f.tk)st="ok";else if(f.err&&!f.ok)st=expectDeny?"blocked":"stop"}
  if(f&&f.ok&&expectDeny)st="leak";
  const looping=id=>RT.n[id]&&RT.n[id].series.slice(-3).some(x=>x.loop);
  if(f&&f.tot&&((looping(e.to)&&e.kind==="invokes"&&(from||{}).type==="AWS::S3::Bucket")||(looping(e.from)&&e.kind==="uses"&&(nodeOf(e.to)||{}).type==="AWS::S3::Bucket")))st="loop";
  if(st==="stop"&&why)label="✕ "+why.split(" (")[0].slice(0,46);else if(st==="blocked")label="✕ bị chặn (đúng ý)";else if(st==="leak")label="! lẽ ra phải bị chặn";else if(st==="loop")label="↻ "+label;
  else if(st==="ok"&&f&&RT.running){const s=RT.n[e.to]&&RT.n[e.to].series.slice(-4),dt=s?s.reduce((a,x)=>a+x.dt,0):0;if(dt&&f.tk){const v=f.tk/(s.slice(-1)[0]||{dt:1}).dt;label+=" · "+(v>=1?num(v)+"/s":num(v*3600)+"/giờ")}}
  return{st,style,label,why}}
/* ---------- geometry ---------- */
function layoutModel(){const all=allNodes(),cont=all.filter(n=>n.def.container);
  const nodes=all.filter(n=>!n.def.container).map(n=>{const v=nodeView(n),p=M.pos[n.id]||(M.pos[n.id]=[40,40]);return{...n,v,x:p[0],y:p[1],w:GW,h:gH(n,v)}});
  const by={};nodes.forEach(n=>by[n.id]=n);
  /* containers: a subnet box wraps the nodes placed in it, a VPC box wraps its subnets and VPC-level nodes */
  const subOf={},vpcOf_={};for(const n of nodes){const ss=subnetsOf(n);if(ss.length===1&&nodeOf(ss[0]))subOf[n.id]=ss[0];else{const v=vpcOf(n);if(v&&nodeOf(v))vpcOf_[n.id]=v}}
  const bbox=(items,pad,head,def,id)=>{if(!items.length){const p=M.pos[id]||(M.pos[id]=[40,40]);return{x:p[0],y:p[1],w:def[0],h:def[1]}}
    const x0=Math.min(...items.map(i=>i.x))-pad,y0=Math.min(...items.map(i=>i.y))-pad-head,x1=Math.max(...items.map(i=>i.x+i.w))+pad,y1=Math.max(...items.map(i=>i.y+i.h))+pad;M.pos[id]=[x0,y0];return{x:x0,y:y0,w:x1-x0,h:y1-y0}};
  const boxes=[];
  for(const s of cont.filter(c=>c.def.container==="subnet")){const mem=nodes.filter(n=>subOf[n.id]===s.id);const b={...s,...bbox(mem,22,30,[300,170],s.id),members:mem.map(m=>m.id),box:"subnet",pub:isPublicSubnet(s.id)};boxes.push(b);by[s.id]=b}
  for(const v of cont.filter(c=>c.def.container==="vpc")){const subs=boxes.filter(b=>b.box==="subnet"&&refId(b.props.VpcId)===v.id),mem=nodes.filter(n=>vpcOf_[n.id]===v.id);
    const b={...v,...bbox([...subs,...mem],24,34,[400,260],v.id),members:[...mem.map(m=>m.id),...subs.flatMap(s=>[s.id,...s.members])],box:"vpc"};boxes.unshift(b);by[v.id]=b}
  /* OU boxes wrap the accounts placed in them (Organizations) */
  for(const o of cont.filter(c=>c.def.container==="ou")){const mem=nodes.filter(n=>n.type==="AWS::Organizations::Account"&&refId(arr(n.props.ParentIds)[0])===o.id);
    const b={...o,...bbox(mem,22,34,[320,190],o.id),members:mem.map(m=>m.id),box:"ou",reg:typeof ouRegistered==="function"&&ouRegistered(o.id)};boxes.push(b);by[o.id]=b}
  const es=edges().filter(e=>!e.hidden&&by[e.from]&&by[e.to]);const ext=[...nodes,...boxes];
  const minX=Math.min(20,...ext.map(n=>n.x)),minY=Math.min(20,...ext.map(n=>n.y));
  if(minX<20||minY<20){const dx=20-minX,dy=20-minY;for(const k of Object.keys(M.pos))M.pos[k]=[M.pos[k][0]+dx,M.pos[k][1]+dy];return layoutModel()}
  const W_=Math.max(800,...ext.map(n=>n.x+n.w))+60,H_=Math.max(420,...ext.map(n=>n.y+n.h))+60;return{nodes,boxes,by,edges:es,W:W_,H:H_,subOf}}
function sidesFor(A,B){const ax=A.x+A.w/2,ay=A.y+A.h/2,bx=B.x+B.w/2,by=B.y+B.h/2,dx=bx-ax,dy=by-ay;
  if(Math.abs(dx)>=Math.abs(dy)*0.9||Math.abs(dx)>A.w*0.9)return dx>=0?["r","l"]:["l","r"];return dy>=0?["b","t"]:["t","b"]}
function gAnchor(n,s,i,cnt){const off=cnt>1?(i-(cnt-1)/2)*14:0;return s==="r"?[n.x+n.w,n.y+GHEAD/2+off]:s==="l"?[n.x,n.y+GHEAD/2+off]:s==="b"?[n.x+n.w/2+off*2,n.y+n.h]:[n.x+n.w/2+off*2,n.y]}
const GDIR={r:[1,0],l:[-1,0],b:[0,1],t:[0,-1]};
function gCurve(p1,s1,p2,s2){const k=Math.max(40,Math.hypot(p2[0]-p1[0],p2[1]-p1[1])*.4),a=GDIR[s1],b=s2?GDIR[s2]:[-a[0],-a[1]];
  const c1=[p1[0]+a[0]*k,p1[1]+a[1]*k],c2=[p2[0]+b[0]*k,p2[1]+b[1]*k],r=v=>Math.round(v*10)/10;
  const at=t=>{const u=1-t;return[0,1].map(i=>u*u*u*p1[i]+3*u*u*t*c1[i]+3*u*t*t*c2[i]+t*t*t*p2[i])};
  return{d:`M${r(p1[0])} ${r(p1[1])} C${r(c1[0])} ${r(c1[1])} ${r(c2[0])} ${r(c2[1])} ${r(p2[0])} ${r(p2[1])}`,at}}
function spark(series,key){const pts=series.map(x=>(x[key]||0)/(x.dt||1)),mx=Math.max(1e-9,...pts);if(!pts.length)return"";const w=120,h=22;
  return`<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts.map((v,i)=>`${(i/(Math.max(1,pts.length-1))*w).toFixed(1)},${(h-2-v/mx*(h-4)).toFixed(1)}`).join(" ")}"/></svg>`}
/* ---------- render ---------- */
function gWorld(L){const G=gs(),sel=UI.sel||{},drag=UI.gdrag;let h="";
  const valid=drag?Object.fromEntries(L.nodes.map(n=>[n.id,n.id!==drag.from&&connectRule(drag.from,n.id)])):null;
  /* edge bundling per side so several edges into one side don't overlap */
  const sideUse={};const plan=L.edges.map(e=>{const A=L.by[e.from],B=L.by[e.to],[sa,sb]=sidesFor(A,B);const ka=e.from+sa,kb2=e.to+sb;(sideUse[ka]=sideUse[ka]||[]).push(e.id);(sideUse[kb2]=sideUse[kb2]||[]).push(e.id);return{e,A,B,sa,sb,ka,kb:kb2}});
  const trace=G.trace?new Set(L.edges.filter(e=>{const f=RT.flow[e.id];return f&&(f.tk||f.tke)}).flatMap(e=>[e.from,e.to])):null;
  let svg=`<svg class="gedges" width="${L.W}" height="${L.H}"><defs>${["ok","idle","stop","warn","leak","loop","blocked","drag","deny","sel"].map(k=>`<marker id="ga-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9" class="ga s-${k}"/></marker>`).join("")}</defs>`,chips="";
  for(const{e,A,B,sa,sb,ka,kb}of plan){const v=edgeView(e),ia=sideUse[ka].indexOf(e.id),ib=sideUse[kb].indexOf(e.id);
    const p1=gAnchor(A,sa,ia,sideUse[ka].length),p2=gAnchor(B,sb,ib,sideUse[kb].length),c=gCurve(p1,sa,p2,sb),isSel=sel.edge===e.id,dim=trace&&!(trace.has(e.from)&&trace.has(e.to))?" dim":"";
    const st=isSel?"sel":v.st;
    svg+=`<path d="${c.d}" class="ge s-${v.st} k-${v.style}${v.st==="ok"&&RT.running?" run":""}${isSel?" is-sel":""}${dim}" marker-end="url(#ga-${st})"/><path d="${c.d}" class="ge-hit" data-edge="${esc(e.id)}"><title>${esc(e.from+" → "+e.to+": "+(v.why||e.label||e.kind))}</title></path>`;
    if(v.label&&(v.st!=="idle"||v.style==="flow"||isSel)){const rev=L.edges.some(x=>x.from===e.to&&x.to===e.from),q=c.at(rev?.3:.5);chips+=`<span class="gchip s-${v.st}${isSel?" is-sel":""}${dim}" style="left:${q[0]}px;top:${q[1]}px">${esc(v.label)}</span>`}}
  if(drag&&drag.at){const A=L.by[drag.from],over=drag.over&&valid[drag.over]?L.by[drag.over]:null,p1=gAnchor(A,"r",0,1),p2=over?gAnchor(over,"l",0,1):drag.at,c=gCurve(p1,"r",p2,over?"l":null);
    svg+=`<path d="${c.d}" class="ge s-drag" marker-end="url(#ga-drag)"/>`;if(over){const q=c.at(.5);chips+=`<span class="gchip s-drag" style="left:${q[0]}px;top:${q[1]}px">thả để nối · ${esc(valid[drag.over].label)}</span>`}}
  let bx="";for(const b of L.boxes){const p=b.props,label=b.box==="ou"?`OU · ${p.Name||b.id} · ${b.reg?"đã register":"chưa register"}`:b.box==="vpc"?`VPC · ${b.id} · ${p.CidrBlock||""}`:`${b.pub?"Public":"Private"} subnet · ${b.id} · ${p.AvailabilityZone||""} · ${p.CidrBlock||""}`;
    bx+=`<div class="gbox ${b.box}${b.box==="subnet"?(b.pub?" pub":" priv"):""}${b.box==="ou"&&b.reg?" reg":""}${sel.node===b.id?" sel":""}${UI.gdropBox===b.id?" drop":""}" data-gid="${b.id}" data-box="${b.box}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"><button class="gbox-h" data-node="${b.id}" aria-label="${esc(label)}"><span class="side-ic" style="--cat:var(--c-${b.box==="ou"?"org":"infra"})" aria-hidden="true">${b.box==="vpc"?"VPC":b.box==="ou"?"OU":"SN"}</span>${esc(label)}</button>${b.members.length?"":`<span class="gbox-empty">${b.box==="ou"?"Kéo account vào đây":"Kéo EC2 / RDS vào đây"}</span>`}</div>`}
  h=bx+h+svg+"</svg>";
  for(const n of L.nodes){const v=n.v,isSel=sel.node===n.id,vt=valid?(n.id===drag.from?"":valid[n.id]?" valid":" invalid"):"",dim=trace&&!trace.has(n.id)?" dim":"";
    const desc=`${n.id}, ${n.def.label}${v.st?", "+v.st[1]:""}`;
    const rowsH=v.rows.length?`<span class="gm">${v.rows.map(r=>r[3]?`<span class="gr"><span>${esc(r[0])}</span>${spark(r[3],"inv")||spark(r[3],"req")}</span>`:`<span class="gr"><span>${esc(r[0])}</span><span class="v ${r[2]}">${esc(String(r[1]).length>26?String(r[1]).slice(0,25)+"…":r[1])}</span></span>`).join("")}</span>`:"";
    h+=`<div class="gnode c-${n.def.cat}${v.ghost?" ghost":""}${n.scope==="manual"?" manual":""}${isSel?" sel":""}${v.st?" st-"+(v.st[0]||"none"):""}${vt}${dim}" data-gid="${n.id}" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px">`+
      `<button class="gn" data-node="${n.id}" aria-label="${esc(desc)}" aria-controls="drawer" aria-expanded="${isSel}"><span class="gh"><span class="side-ic" style="--cat:var(--c-${n.def.cat})" aria-hidden="true">${esc(n.def.short)}</span><span class="gtt"><b>${esc(n.id)}</b><small>${esc(n.ext?n.def.label:(physName(n)!==n.id?physName(n):n.def.label))}</small></span></span>${rowsH}</button>`+
      (v.st?`<span class="gpill s-${v.st[0]||"none"}" aria-hidden="true"><i></i>${esc(v.st[1])}</span>`:"")+
      `<span class="gp in" aria-hidden="true"></span><button class="gp out" data-act="gMenu" data-arg="${n.id}" data-gconnect="${n.id}" aria-label="Nối ${esc(n.id)} tới…" title="Kéo tới khối khác để nối, hoặc bấm để chọn từ danh sách"></button></div>`}
  return h+chips}
function gMenuHtml(L,list){const M_=UI.gmenu;if(!M_||!L.by[M_.from])return"";const src=L.by[M_.from];
  const opts=L.nodes.filter(n=>n.id!==M_.from).map(n=>({n,r:connectRule(M_.from,n.id)})).sort((a,b)=>(b.r?1:0)-(a.r?1:0));M_.ids=opts.map(o=>o.n.id);const ai=Math.min(M_.active||0,opts.length-1);
  let style="";if(!list){const z=GCUR.z,cw=(document.querySelector(".gx")||{}).clientWidth||880,l=(src.x+src.w)*z+GCUR.pan[0]+10;style=` style="left:${Math.max(8,Math.min(l,cw-316))}px;top:${Math.max(8,src.y*z+GCUR.pan[1])}px"`}
  return`<div class="gmenu${list?" inline":""}"${style}><p class="cap">Nối từ</p><b class="gmt">${esc(src.id)} →</b>
    <ul class="gopts" id="glist" role="listbox" tabindex="0" aria-label="Chọn khối để nối" aria-activedescendant="gopt-${ai}">${opts.map(({n,r},i)=>`<li id="gopt-${i}" role="option" class="gopt${r?"":" bad"}${i===ai?" on":""}" aria-selected="${i===ai}" aria-disabled="${!r}" data-act="gPick" data-arg="${n.id}"><span class="side-ic" style="--cat:var(--c-${n.def.cat})" aria-hidden="true">${esc(n.def.short)}</span><span class="gtt"><b>${esc(n.id)}</b><small>${esc(r?r.label:whyNot(M_.from,n.id))}</small></span><span class="k" aria-hidden="true">${r?(i===ai?"↵":""):"✕"}</span></li>`).join("")||`<li class="gopt bad">Canvas chưa có khối nào khác để nối</li>`}</ul>
    <p class="cap gmf">↑↓ chọn · Enter nối · Esc hủy</p></div>`}
function relText(L,n){const out=L.edges.filter(e=>e.from===n.id).map(e=>`→ ${e.to} (${e.label||e.kind})`),inn=L.edges.filter(e=>e.to===n.id).map(e=>`← ${e.from}`);return[...inn,...out].join(" · ")||"chưa nối với khối nào"}
let GLAST=null;
function canvasHtml(){const L=layoutModel(),G=gs();GLAST=L;const view=G.view||(KIT.isNarrow()?"list":"graph"),host=document.getElementById("canvas");
  const gxo=document.querySelector(".gx"),cw=(gxo&&gxo.clientWidth)||((host&&host.clientWidth)||0)||900,ch=(gxo&&gxo.clientHeight)||((host&&host.clientHeight)||0)||520;
  const fitZ=Math.max(.4,Math.min(1,(cw-24)/L.W,(ch-24)/L.H)),z=G.zoom||fitZ,pan=G.zoom?G.pan:[Math.max(8,(cw-L.W*z)/2),Math.max(8,(ch-L.H*z)/2)];GCUR={z,pan};
  const tools=`<div class="gx-tools" role="toolbar" aria-label="Công cụ canvas"><button class="sm${UI.picker?" on":" primary"}" data-act="picker" aria-pressed="${!!UI.picker}" title="Thư viện thành phần (phím /)">＋ Thành phần</button>${view==="graph"?`<button class="sm" data-act="gFit" title="Vừa khung">⤢<span class="hide-s"> Vừa khung</span></button><button class="sm" data-act="gZoom" data-arg="-1" aria-label="Thu nhỏ" title="Thu nhỏ (hoặc cuộn chuột trên canvas)">−</button><span class="gz mono">${Math.round(z*100)}%</span><button class="sm" data-act="gZoom" data-arg="1" aria-label="Phóng to" title="Phóng to (hoặc cuộn chuột trên canvas)">+</button><button class="sm${G.trace?" on":""}" data-act="gTrace" aria-pressed="${!!G.trace}" title="Chỉ làm nổi các khối và mũi tên vừa có dữ liệu chạy qua (phím T)">◎ Trace</button>`:""}<span class="grow"></span><div class="seg" role="group" aria-label="Kiểu xem"><button class="${view==="graph"?"on":""}" data-act="gView" data-arg="graph" aria-pressed="${view==="graph"}">Sơ đồ</button><button class="${view==="list"?"on":""}" data-act="gView" data-arg="list" aria-pressed="${view==="list"}">Danh sách</button></div></div>`;
  if(view==="list")return tools+`<div class="gx-row">`+pickerHtml()+`<div class="glist-wrap">`+gMenuHtml(L,true)+`<ul class="glist" aria-label="Các khối và mũi tên">${L.nodes.map(n=>`<li class="glrow${n.v.ghost?" ghost":""}"><button class="gl" data-node="${n.id}"><span class="side-ic" style="--cat:var(--c-${n.def.cat})" aria-hidden="true">${esc(n.def.short)}</span><span class="gtt"><span class="gl-top"><b>${esc(n.id)}</b>${n.v.st?`<span class="gpill s-${n.v.st[0]||"none"}"><i></i>${esc(n.v.st[1])}</span>`:""}${n.v.cost>0?`<span class="gcost">${money(n.v.cost)}</span>`:""}</span><small>${esc(n.def.label)} · ${esc(relText(L,n))}</small></span><span class="chev" aria-hidden="true">›</span></button><button class="sm" data-act="gMenu" data-arg="${n.id}" data-gconnect="${n.id}">Nối…</button></li>`).join("")||`<li class="glrow"><div class="gl">Canvas trống. Mở ＋ Thành phần để thêm.</div></li>`}</ul></div></div>`;
  const empty=!L.nodes.length&&!L.boxes.length?`<div class="gx-empty"><b>Canvas trống</b><span>Mở ＋ Thành phần rồi kéo một thành phần vào đây, hoặc dán CloudFormation YAML ở chế độ YAML.</span></div>`:"";
  return tools+`<div class="gx-row">`+pickerHtml()+`<div class="gx${UI.gdrag?" connecting":""}" data-gx><div class="gx-world" id="gworld" style="width:${L.W}px;height:${L.H}px;transform:translate(${pan[0]}px,${pan[1]}px) scale(${z})">${gWorld(L)}</div>${empty}${UI.gnote?`<div class="gx-note callout ${UI.gnote.kind==="info"?"ctx":"warn"}" role="status"><span>${esc(UI.gnote.text)}</span><button class="sm ghost" data-act="gNoteClose" aria-label="Đóng">×</button></div>`:""}${gMenuHtml(L,false)}</div></div>`}
function gRefresh(){const w=document.getElementById("gworld");if(!w){const c=document.getElementById("canvas");if(c&&!UI.code||UI.split)renderCanvas();return}
  const ae=document.activeElement,keep=ae&&ae.closest&&ae.closest("#gworld")?ae.getAttribute("data-node"):null;const L=layoutModel();GLAST=L;w.style.width=L.W+"px";w.style.height=L.H+"px";w.innerHTML=gWorld(L);
  if(keep){const e=w.querySelector(`[data-node="${keep}"]`);if(e)e.focus({preventScroll:true})}}
function gApply(){const w=document.getElementById("gworld");if(w)w.style.transform=`translate(${GCUR.pan[0]}px,${GCUR.pan[1]}px) scale(${GCUR.z})`;const zl=document.querySelector(".gx-tools .gz");if(zl)zl.textContent=Math.round(GCUR.z*100)+"%"}
function gFreeze(){const G=gs();G.zoom=GCUR.z;G.pan=[...GCUR.pan]}
function gZoomAt(nz,cx,cy){const G=gs();nz=Math.max(.3,Math.min(2,nz));const z=GCUR.z,p=GCUR.pan;if(cx===undefined){const gx=document.querySelector(".gx");cx=gx?gx.clientWidth/2:300;cy=gx?gx.clientHeight/2:200}
  const wx=(cx-p[0])/z,wy=(cy-p[1])/z;G.zoom=nz;G.pan=[cx-wx*nz,cy-wy*nz];GCUR={z:nz,pan:G.pan};gApply()}
function toWorld(cx,cy){const gx=document.querySelector(".gx");if(!gx)return[100,100];const r=gx.getBoundingClientRect();return[(cx-r.left-GCUR.pan[0])/GCUR.z,(cy-r.top-GCUR.pan[1])/GCUR.z]}
/* nearest spot to (x,y) that doesn't overlap a node or a VPC/subnet box */
function freeSpot(x,y){const L=typeof GLAST!=="undefined"&&GLAST;if(!L)return[x,y];const W=GW+30,H=170,rects=[...L.nodes.map(n=>({x:n.x,y:n.y,w:GW,h:n.h||150})),...(L.boxes||[])];
  const hit=(px,py)=>rects.some(r=>px<r.x+r.w+20&&px+W>r.x-20&&py<r.y+r.h+20&&py+H>r.y-20);
  for(let ring=0;ring<12;ring++)for(const[dx,dy]of[[0,0],[1,0],[0,1],[-1,0],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){const px=x+dx*ring*W/1.5,py=y+dy*ring*H/1.5;if(!hit(px,py))return[Math.round(px),Math.round(py)]}
  return[x,y]}
function viewCenter(){const gx=document.querySelector(".gx");if(!gx)return[80+Object.keys(M.pos).length*30,80+Object.keys(M.pos).length*20];return[(gx.clientWidth/2-GCUR.pan[0])/GCUR.z-GW/2,(gx.clientHeight/2-GCUR.pan[1])/GCUR.z-50]}
function gNeighbor(id,key){const L=GLAST;if(!L||!L.by[id])return null;const n=L.by[id],c=[n.x+n.w/2,n.y+n.h/2],dir={ArrowRight:[1,0],ArrowLeft:[-1,0],ArrowDown:[0,1],ArrowUp:[0,-1]}[key];
  const linked=new Set(L.edges.filter(e=>e.from===id||e.to===id).map(e=>e.from===id?e.to:e.from));let best=null,bs=Infinity;
  for(const o of L.nodes){if(o.id===id)continue;const d=[o.x+o.w/2-c[0],o.y+o.h/2-c[1]],along=d[0]*dir[0]+d[1]*dir[1];if(along<=8)continue;const s=Math.hypot(...d)+Math.abs(d[0]*dir[1]-d[1]*dir[0])*1.5-(linked.has(o.id)?120:0);if(s<bs){bs=s;best=o}}return best&&best.id}
/* connect a → b via the catalog rule; asks first when a permission can be granted at the same time */
function doConnect(a,b){const r=connectRule(a,b);if(!r)return false;UI.gmenu=null;UI.gnote=null;UI.lastOpener=`[data-gconnect="${a}"]`;
  if(r.grant){const role=r.grant.role,net=!!r.grant.text;UI.modal={title:`Nối ${a} → ${b}`,submitLabel:"Nối",init:{grant:1},body:`<p>${esc(r.label)}.</p>`,fields:[{type:"checks",label:net?"Security group":"Quyền",items:[["grant",net?r.grant.text:`Thêm ${r.grant.actions.join(", ")} vào role ${role}`]]}],
    note:v=>v.grant?"":`<div class="callout warn"><b>${net?"Không mở security group":"Không cấp quyền"}</b>Mô phỏng sẽ báo ${net?"lỗi kết nối":"AccessDenied"} ở mũi tên này. Bạn có thể tự sửa sau, đó cũng là một cách học ${net?"security group":"IAM"}.</div>`,
    submit:v=>{edit(`${a} → ${b}`,()=>r.apply(!!+v.grant));log("CloudLab","editor","connect",`${a} → ${b}: ${r.label}`,"ok");return{ok:true}}};return true}
  edit(`${a} → ${b}`,()=>r.apply(true));log("CloudLab","editor","connect",`${a} → ${b}: ${r.label}`,"ok");return true}
