"use strict";
/* GCP pack · views: texts, inspector field types, canvas rows, runtime panels, VPC / subnet boxes, drag-and-drop placement,
   and the credit line under the cost meter (free trial: $300 for 90 days). */
Object.assign(DOMAIN.texts,{
  appName:"CloudLab GCP",unit:"tài nguyên Google Cloud",codeName:"Terraform",
  stack:"Terraform",deployLabel:"terraform apply",deployTitle:"terraform apply",deleteLabel:"Destroy",deleteTitle:"terraform destroy",
  status:{NOT_DEPLOYED:["","chưa apply"],CREATE_COMPLETE:["ok","đã apply"],UPDATE_COMPLETE:["ok","đã apply · cập nhật"],DELETE_COMPLETE:["","đã destroy"],APPLY_FAILED:["bad","apply lỗi"],SUSPENDED:["bad","billing ngưng"]},
  ghostNew:"Chưa apply",ghostDeleted:"Đã destroy",manualShort:"Ngoài Terraform",manualTag:"ngoài Terraform",extTag:"ngoài Google Cloud",deleteManual:"Xóa",manualWhere:"project",modelWhere:"Terraform",
  notDeployed:s=>`Chưa có trên Google Cloud (${s}). Bấm terraform apply để tạo.`,lessonReady:name=>`${name} đã apply`,
  idLabel:"Tên Terraform",cli:"terraform / gcloud",noCli:"Dòng này không có lệnh tương đương",labGroup:"",phaseDefault:"Google Cloud",
  searchPh:"Tìm: run, redis, kafka, rabbitmq, websocket…",searchNone:"Thử tên dịch vụ, ví dụ kafka hoặc redis.",importHint:"Dán Terraform (.tf), ví dụ file Gemini viết cho tình huống của bạn",
  emptyCanvas:"Mở ＋ Thành phần rồi kéo một tài nguyên vào đây, hoặc dán Terraform ở chế độ Terraform.",
  sandboxIntro:`<div><span class="cap eyebrow">Sandbox</span><h1>Dựng hạ tầng Google Cloud tự do</h1><p class="goal">Kéo Cloud Run, Memorystore, Kafka, RabbitMQ trên VM… vào canvas, nối các khối bằng chấm bên phải mỗi khối, hoặc viết Terraform. Mỗi khối hiện giá niêm yết; bấm ▶ Chạy để xem chi phí và credit dùng thử bị đốt nhanh thế nào.</p></div>
    <div class="sect"><span class="lab">Nguồn tạo tải</span><p class="note">Client gửi request HTTP hoặc giữ kết nối WebSocket. Hộp thư nhận cảnh báo budget. Hai khối này là <span class="mono">cloudlab_*</span>, bị bỏ khi xuất Terraform thật.</p></div>`,
  importBody:`<p>Dán Terraform (provider google). Thêm <code>resource "cloudlab_client" "customers" { target = google_cloud_run_v2_service.api.uri  rate_per_second = 20 }</code> để có khách gửi request khi mô phỏng. Cách nhờ Gemini viết: xem <a href="learn.html#gemini" target="_blank" rel="noopener">hướng dẫn dùng với Gemini</a>.</p>`,
  importPh:'resource "google_cloud_run_v2_service" "api" {\n  name     = "api"\n  location = "asia-southeast1"\n  …\n}',importEmpty:"File không có resource nào.",
  tourWelcome:"Ở đây bạn học Google Cloud bằng cách sửa một hệ thống mẫu có lỗi, rồi chạy thử xem nó hoạt động và tốn bao nhiêu. Không gọi Google Cloud thật, không tốn tiền. Xem qua màn hình mất khoảng 1 phút.",
  tourCode:"Canvas cũng là một file Terraform. Chế độ Terraform cho xem và sửa trực tiếp, rồi tải main.tf về để terraform apply với project thật. Nếu không làm kỹ thuật, bạn có thể bỏ qua."});
DOMAIN.relDoc={calls:"Client gửi request (HTTPS) hoặc mở kết nối WebSocket tới đây.",uses:"App dùng tài nguyên này qua một biến môi trường (hoặc metadata của VM) chứa địa chỉ của nó.",
  egress:"Cloud Run ra VPC qua subnet này (Direct VPC egress), nhờ đó gọi được Memorystore, Kafka hoặc VM chỉ có IP nội bộ.",runsas:"App chạy bằng danh tính (service account) này; quyền của app là quyền của service account.",
  applies:"Cấp quyền gọi service (roles/run.invoker).",grants:"Gán một role IAM cho service account.",allows:"Luật firewall này mở cổng tới VM (khớp network tag).",partof:"Topic thuộc Kafka cluster này.",
  notifies:"Vượt ngưỡng thì budget gửi cảnh báo tới đây.",delivers:"Gửi email tới hộp thư.",contains:"Nằm trong mạng / subnet này."};
DOMAIN.keepNull=["target"];
DOMAIN.fmt=v=>v==null?"":isExpr(v)?v.$:Array.isArray(v)?v.map(DOMAIN.fmt).join(", "):typeof v==="object"?JSON.stringify(v):String(v);
DOMAIN.idValue=n=>tfName(n);
const GCP_ELI5={
  cloudlab_client:"Khách hàng hoặc hệ thống bên ngoài gọi vào: gửi request, hoặc mở bảng giá và giữ kết nối để nhận giá mới liên tục.",
  google_compute_network:"Như mạng nội bộ của cả ngân hàng: mọi chi nhánh (subnet) nối chung một đường truyền riêng, không đi qua Internet.",
  google_compute_subnetwork:"Như một chi nhánh trong mạng nội bộ: có dải địa chỉ riêng ở một thành phố (region).",
  google_compute_firewall:"Như bảo vệ ở cổng tòa nhà, giữ danh sách: cổng nào mở, cho ai vào, áp cho phòng nào (network tag).",
  google_compute_instance:"Như thuê nguyên một phòng làm việc theo giờ: có người hay không vẫn trả tiền phòng.",
  "google_compute_instance#rabbitmq":"Như phòng văn thư tự lập để nhận và chuyển công văn giữa các phòng ban: rẻ, nhưng bạn tự thuê người trực, tự lo khi phòng mất điện.",
  "google_compute_instance#redis":"Như tự đặt một tủ hồ sơ tra nhanh ở sảnh: rẻ, nhưng hỏng tủ thì không ai thay giúp.",
  "google_compute_instance#kafka":"Như tự ghi sổ cái giao dịch bằng tay trên một cuốn sổ duy nhất: học được cách làm, nhưng mất sổ là mất hết.",
  google_cloud_run_v2_service:"Như quầy giao dịch tự mở thêm khi đông khách và đóng hết khi vắng: chỉ trả lương cho giờ quầy đang phục vụ.",
  "google_cloud_run_v2_service#ws":"Như tổng đài đọc tỷ giá cho khách giữ máy: mỗi khách đang giữ máy chiếm một đường dây, và tổng đài phải trả tiền suốt thời gian có người giữ máy.",
  google_cloud_run_v2_service_iam_member:"Như tấm biển “mời vào” ở cửa quầy: không có biển thì quầy mở mà khách vẫn bị bảo vệ chặn lại.",
  google_service_account:"Như thẻ nhân viên của một phần mềm: hệ thống nhìn thẻ để biết phần mềm này được làm gì.",
  google_project_iam_member:"Như quyết định phân quyền: ghi rõ thẻ nhân viên nào được vào kho nào. Ghi “toàn quyền” cho tiện là rủi ro.",
  google_redis_instance:"Như bảng tỷ giá dán ở quầy: giao dịch viên nhìn bảng thay vì gọi về hội sở mỗi lần, nhanh hơn và hội sở đỡ tải.",
  google_memorystore_instance:"Như bảng tra nhanh, nhưng thuê theo từng tấm bảng (node): bảng nhỏ nhất rất rẻ.",
  google_managed_kafka_cluster:"Như sổ cái giao dịch ghi liên tục, nhiều phòng ban cùng đọc lại được, có bản sao ở 3 nơi. Thuê cả bộ máy ghi sổ theo giờ, kể cả lúc không có giao dịch.",
  google_managed_kafka_topic:"Như một cuốn sổ trong sổ cái, chia thành nhiều quyển (partition) để nhiều người ghi và đọc song song.",
  google_pubsub_topic:"Như dịch vụ chuyển phát: không thuê bưu cục riêng, gửi bao nhiêu trả bấy nhiêu.",
  google_storage_bucket:"Như kho lưu trữ hồ sơ: trả tiền theo số kệ đang dùng.",
  google_billing_budget:"Như hạn mức chi tiêu thẻ công ty có tin nhắn báo khi tiêu tới 50%, 90%: chỉ báo, không khóa thẻ.",
  google_monitoring_notification_channel:"Như số điện thoại đăng ký nhận tin nhắn biến động số dư.",
  cloudlab_inbox:"Hộp thư của bạn: nơi cảnh báo budget tới."};
DOMAIN.eli5=t=>GCP_ELI5[t]||GCP_ELI5[baseType(t)]||"";

/* ---------------- inspector field types ---------------- */
const optHtml=(list,cur,none)=>(none!=null?`<option value="">${esc(none)}</option>`:"")+list.map(o=>{const[v,l]=Array.isArray(o)?o:[o,o];return`<option value="${esc(v)}"${String(cur??"")===String(v)?" selected":""}>${esc(l)}</option>`}).join("");
const nodesOf=types=>allNodes().filter(x=>arr(types).includes(x.type));
const attrFor=(f,type)=>typeof f.attr==="object"?f.attr[type]:f.attr;
const addRow=(t,html)=>{const tmp=document.createElement("div");tmp.innerHTML=html;const row=tmp.firstElementChild;t.parentNode.insertBefore(row,t);const f=row.querySelector("input");if(f)f.focus();return true};
const fwRow=a=>`<div class="frow"><select data-k="protocol" aria-label="Giao thức">${optHtml(["tcp","udp","icmp","all"],a.protocol||"tcp")}</select><input data-k="ports" value="${esc(arr(a.ports).join(", "))}" placeholder="80, 443, 5672" aria-label="Cổng"><button class="sm danger" data-act="rowDel" aria-label="Xóa">✕</button></div>`;
const envRow=e=>`<div class="frow"><input data-k="name" value="${esc(e.name||"")}" placeholder="TÊN_BIẾN" aria-label="Tên biến"><input data-k="value" class="mono" value="${esc(DOMAIN.fmt(e.value))}" placeholder="giá trị hoặc \${google_redis_instance.cache.host}" aria-label="Giá trị"><button class="sm danger" data-act="rowDel" aria-label="Xóa">✕</button></div>`;
const parseVal=s=>{s=String(s).trim();if(/^(google|cloudlab|var|local)\.[\w.\[\]-]+$/.test(s)&&!s.includes(" "))return X(s);return s};
Object.assign(DOMAIN.fields,{
  tref:{html:(n,f,c)=>{const cur=refOf(c.val);return`<label class="fld">${c.lab}<select ${c.da} data-ftype="tref">${optHtml(nodesOf(f.to).filter(x=>x.id!==n.id).map(x=>[x.id,x.id]),cur||"","— chưa chọn —")}</select>${c.help}</label>`},
    read:fs=>fs.value||null,write:(nn,k,v)=>{const f=nn.def.fields.find(x=>x.k===k);if(!v){setP(nn.props,k,k==="target"?null:undefined);return}const t=nodeOf(v);setP(nn.props,k,ref(v,attrFor(f,t.type)))}},
  trefs:{html:(n,f,c)=>{const cur=arr(c.val).map(refOf);const opts=nodesOf(f.to);return`<fieldset class="fld" ${c.da} data-ftype="trefs"><legend>${esc(f.label)}</legend>${opts.map(x=>`<label class="ck"><input type="checkbox" value="${esc(x.id)}"${cur.includes(x.id)?" checked":""}> ${esc(x.id)}</label>`).join("")||`<small>Chưa có ${esc(arr(f.to).map(t=>T[t].label).join(", "))} nào.</small>`}${c.help}</fieldset>`},
    read:fs=>[...fs.querySelectorAll("input:checked")].map(i=>i.value),write:(nn,k,v)=>{const f=nn.def.fields.find(x=>x.k===k);setP(nn.props,k,v.map(id=>ref(id,attrFor(f,nodeOf(id).type))))}},
  list:{html:(n,f,c)=>`<label class="fld">${c.lab}<input ${c.da} data-ftype="list" value="${esc(arr(c.val).map(DOMAIN.fmt).join(", "))}">${c.help}</label>`,
    read:fs=>fs.value.split(",").map(x=>x.trim()).filter(Boolean),write:(nn,k,v)=>setP(nn.props,k,v)},
  fwallow:{html:(n,f,c)=>`<fieldset class="fld" ${c.da} data-ftype="fwallow"><legend>${esc(f.label)}</legend>${arr(c.val).map(fwRow).join("")}<button class="sm" data-act="fwRowAdd">+ Luật</button>${c.help}</fieldset>`,
    read:fs=>[...fs.querySelectorAll(".frow")].map(r=>{const pr=r.querySelector('[data-k="protocol"]').value,ps=r.querySelector('[data-k="ports"]').value.split(",").map(x=>x.trim()).filter(Boolean);return ps.length&&pr!=="icmp"?{protocol:pr,ports:ps}:{protocol:pr}}),write:(nn,k,v)=>setP(nn.props,k,v)},
  publicip:{html:(n,f,c)=>`<label class="ck fld" style="display:flex;gap:8px;align-items:center"><input type="checkbox" ${c.da} data-ftype="publicip"${arr(c.val).length?" checked":""}> ${esc(f.label)} (access_config)</label>${c.help}`,
    read:fs=>fs.checked,write:(nn,k,v)=>{if(v)setP(nn.props,k,[{}]);else{const ni=getP(nn.props,"network_interface");if(ni)delete ni.access_config}}},
  tfenv:{html:(n,f,c)=>`<fieldset class="fld" ${c.da} data-ftype="tfenv"><legend>${esc(f.label)}</legend>${arr(c.val).map(envRow).join("")}<button class="sm" data-act="tfEnvAdd">+ Biến</button>${c.help}</fieldset>`,
    read:fs=>[...fs.querySelectorAll(".frow")].map(r=>{const nm=r.querySelector('[data-k="name"]').value.trim();if(!nm)return null;return{name:nm,value:parseVal(r.querySelector('[data-k="value"]').value)}}).filter(Boolean),
    write:(nn,k,v)=>setP(nn.props,k,v)},
  vpcegress:{html:(n,f,c)=>{const sub=refOf(getP(c.val||{},"network_interfaces.subnetwork"));return`<fieldset class="fld" ${c.da} data-ftype="vpcegress"><legend>${esc(f.label)}</legend><div class="frow"><select data-k="subnet" aria-label="Subnet">${optHtml(nodesOf("google_compute_subnetwork").map(x=>[x.id,x.id]),sub||"","— không ra VPC —")}</select>${sub?`<select data-k="egress" aria-label="Traffic nào đi qua VPC">${optHtml([["PRIVATE_RANGES_ONLY","Chỉ IP nội bộ"],["ALL_TRAFFIC","Mọi traffic"]],getP(c.val,"egress")||"PRIVATE_RANGES_ONLY")}</select>`:""}</div>${c.help}</fieldset>`},
    read:fs=>({subnet:fs.querySelector('[data-k="subnet"]').value,egress:(fs.querySelector('[data-k="egress"]')||{}).value}),
    write:(nn,k,v)=>{if(!v.subnet){delete nn.props.template.vpc_access;return}setEgress(nn,v.subnet);if(v.egress)setP(nn.props,"template.vpc_access.egress",v.egress)}},
  tmember:{html:(n,f,c)=>{const cur=refOf(c.val);return`<label class="fld">${c.lab}<select ${c.da} data-ftype="tmember">${optHtml(nodesOf("google_service_account").map(x=>[x.id,"serviceAccount: "+x.id]),cur||"",cur?null:(c.val?String(c.val):"— chưa chọn —"))}</select>${c.help}</label>`},
    read:fs=>fs.value,write:(nn,k,v)=>{if(!v)return;nn.props.member="serviceAccount:${"+addrOf(nodeOf(v))+".email}"}},
  thresholds:{html:(n,f,c)=>{const cur=arr(c.val).map(x=>+x.threshold_percent);return`<fieldset class="fld" ${c.da} data-ftype="thresholds"><legend>${esc(f.label)}</legend><div class="acts">${[0.25,0.5,0.75,0.9,1].map(x=>`<label class="ck"><input type="checkbox" value="${x}"${cur.includes(x)?" checked":""}> ${x*100}%</label>`).join("")}</div>${c.help}</fieldset>`},
    read:fs=>[...fs.querySelectorAll("input:checked")].map(i=>({threshold_percent:+i.value})),write:(nn,k,v)=>setP(nn.props,k,v)},
  membytes:{html:(n,f,c)=>`<label class="fld">${c.lab}<select ${c.da} data-ftype="membytes">${optHtml([3,4,6,8,12,16,24,32].map(g=>[g*1073741824,g+" GiB"]),+c.val||3221225472)}</select>${c.help}</label>`,read:fs=>+fs.value,write:(nn,k,v)=>setP(nn.props,k,v)}});
Object.assign(DOMAIN.actions,{
  fwRowAdd(arg,t){return addRow(t,fwRow({protocol:"tcp",ports:["80"]}))},
  tfEnvAdd(arg,t){return addRow(t,envRow({name:"",value:""}))},
  openMail(arg){UI.mailOpen=arg;for(const L of Object.values(RT.inbox)){const m=L.find(x=>x.id===arg);if(m)m.read=true}},
  trialToggle(){RT.trial=!RT.trial;log("CloudLab","billing","account",RT.trial?"Tài khoản: Free trial ($300 credit, 90 ngày)":"Tài khoản: trả tiền thường (không có credit)","");if(RT.trial&&RT.stack.status==="SUSPENDED")RT.stack.status="UPDATE_COMPLETE"}});

/* ---------------- canvas rows + status pill ---------------- */
const pct=v=>Math.round(v*100)+"%";
DOMAIN.view=(n,rows,{r,m,p,up,perS})=>{let st=null;const err=up&&r.lastErr&&r.series.slice(-2).some(x=>x.err);
  switch(n.type){
    case"cloudlab_client":{const ws=p.protocol==="websocket";if(ws)rows.push(["Kết nối",`${num(+p.connections||0)} · ${num(+p.messages_per_minute||0)} tin/phút`,""]);else rows.push(["Tần suất",`${+p.rate_per_second||0}/s`,""]);
      const c=RT.cl[n.id]||{};rows.push(["Thành công · lỗi",ws?`${num(c.open||0)} mở · ${num(c.rej||0)} bị từ chối`:`${num(m.ok||0)} · ${num(m.err||0)}`,(ws?c.rej:m.err)?(p.expect==="deny"?"ok":"bad"):(ws?c.open:m.ok)?(p.expect==="deny"?"bad":"ok"):"none"]);
      if(p.expect==="deny")st=m.ok||c.open?["bad","Không bị chặn"]:m.err||c.rej?["ok","Bị chặn ✓"]:null;else if(!refOf(p.target))st=["off","Chưa nối"];else if(r.tk.err&&!r.tk.ok)st=["bad","Lỗi"];else if(r.tk.err||c.rej)st=["warn","Có lỗi"];else if(r.tk.ok||c.open)st=["ok","OK"];break}
    case"cloudlab_inbox":{const L=RT.inbox[n.id]||[],un=L.filter(x=>!x.read).length;rows.push(["Thư",String(L.length),"none"],["Chưa đọc",String(un),un?"warn":"none"]);if(un)st=["warn",un+" thư mới"];break}
    case"google_cloud_run_v2_service":{const s=RT.run[n.id]||{},ws=getP(p,"labels.protocol")==="websocket";
      rows.push(["Instance",`${num(s.inst||0)} / tối đa ${getP(p,"template.scaling.max_instance_count")??100}`,s.capped?"bad":""]);
      if(ws)rows.push(["Kết nối mở",num(s.conns||0),""]);else rows.push(["Request",perS("req"),""]);
      if(up){if(err)st=["bad","Lỗi"];else if(s.capped)st=["warn","Hết instance"];else if((s.inst||0)>0)st=["ok","Đang chạy"];else st=["","Về 0"]}break}
    case"google_compute_instance":{const a=appOf(n),cap=(VM_CAP[a]||VM_CAP.web)[p.machine_type]||40,s=RT.vm[n.id]||{};rows.push(["Máy",`${p.machine_type} · ${a}`,""]);
      rows.push([a==="web"?"Request":"Message",perS(a==="web"?"req":"msg"),""],["Tải",pct(Math.min(1,(s.load||0))),(s.load||0)>1?"bad":(s.load||0)>0.8?"warn":""]);
      if(up)st=err?["bad","Lỗi"]:(s.load||0)>1?["bad","Quá tải"]:["ok","RUNNING"];break}
    case"google_redis_instance":rows.push(["Cỡ",`${p.tier==="STANDARD_HA"?"Standard HA":"Basic"} · ${p.memory_size_gb||1} GB`,""],["Lệnh",perS("ops"),""]);if(up)st=err?["bad","Lỗi"]:["ok","READY"];break;
    case"google_memorystore_instance":rows.push(["Node",`${p.node_type||"?"} × ${(+p.shard_count||1)*(1+(+p.replica_count||0))}`,""],["Lệnh",perS("ops"),""]);if(up)st=["ok","ACTIVE"];break;
    case"google_managed_kafka_cluster":{const s=RT.kafka[n.id]||{};rows.push(["Cỡ",`${getP(p,"capacity_config.vcpu_count")||3} vCPU · ${Math.round((+getP(p,"capacity_config.memory_bytes")||3221225472)/1073741824)} GiB`,""],["Message",perS("msg"),""],["Tải",pct(Math.min(1,s.load||0)),(s.load||0)>1?"bad":""]);
      if(up)st=err?["bad","Lỗi"]:(s.load||0)>1?["bad","Quá tải"]:["ok","ACTIVE"];break}
    case"google_managed_kafka_topic":rows.push(["Partition",String(p.partition_count||1),""],["Message",perS("msg"),""]);break;
    case"google_pubsub_topic":rows.push(["Message",perS("msg"),""],["Dung lượng tính tiền",`${num((m.bytes||0)/1073741824)} GiB`,""]);break;
    case"google_compute_firewall":rows.push(["Mở",arr(p.allow).map(a=>a.protocol+(arr(a.ports).length?":"+arr(a.ports).join(","):"")).join(" ")||"—",""],["Từ",arr(p.source_ranges).join(", ")||"—",arr(p.source_ranges).includes("0.0.0.0/0")?"warn":""]);break;
    case"google_billing_budget":{const b=RT.budget[n.id]||{fired:[]},amt=+getP(p,"amount.specified_amount.units")||0,seen=budgetSpend(n);rows.push(["Budget thấy",`${money(seen)} / ${money(amt)}`,amt&&seen/amt>=.9?"bad":amt&&seen/amt>=.5?"warn":""],["Đã báo",b.fired.length?b.fired.map(x=>pct(x)).join(", "):"—",""]);break}
    case"google_project_iam_member":rows.push(["Role",String(p.role||""),/roles\/(owner|editor)$/.test(p.role||"")?"bad":""]);break;
    case"google_cloud_run_v2_service_iam_member":rows.push(["Ai",String(p.member||""),p.member==="allUsers"?"warn":""]);break}
  return st};

/* ---------------- runtime panel in the inspector ---------------- */
DOMAIN.rt=(n,{r,m,p})=>{const id=n.id;let h="";const lastErr=r.lastErr?`<div class="callout"><b>Lỗi gần nhất</b>${esc(r.lastErr)}</div>`:"";
  switch(n.type){
    case"cloudlab_inbox":{const L=RT.inbox[id]||[],sel=L.find(x=>x.id===UI.mailOpen)||L[0];
      h+=L.length?L.slice(0,8).map(x=>`<button class="mitem${sel&&x.id===sel.id?" on":""}${x.read?"":" unread"}" data-act="openMail" data-arg="${x.id}"><b>${esc(x.subject)}${x.n>1?` ×${num(x.n)}`:""}</b><small>${esc(x.t)} · Google Cloud Billing</small></button>`).join("")+(sel?`<div class="mread"><p style="margin-top:0">${esc(sel.body)}</p></div>`:""):`<div class="empty">Chưa có thư nào.</div>`;break}
    case"cloudlab_client":{const c=RT.cl[id]||{};h+=p.protocol==="websocket"?kvl([["Đang mở",num(c.open||0)],["Bị từ chối",num(c.rej||0)],["Kết nối lại vì hết timeout",num(m.reconnect||0)],["Tin đã nhận",num(m.recv||0)]]):kvl([["Đã gửi",num(m.sent||0)],["Thành công",num(m.ok||0)],["Lỗi / bị chặn",num(m.err||0)]]);h+=lastErr;break}
    case"google_cloud_run_v2_service":{const s=RT.run[id]||{};h+=kvl([["Instance đang chạy",num(s.inst||0)],["Request",num(m.req||0)],["Lỗi",num(m.err||0)],...(s.conns?[["Kết nối WebSocket mở",num(s.conns)]]:[])])+lastErr;break}
    case"google_compute_instance":{const s=RT.vm[id]||{};h+=kvl([["Tải",pct(s.load||0)],[appOf(n)==="web"?"Request":"Message",num(m.req||m.msg||0)],["Lỗi",num(m.err||0)]])+lastErr;break}
    case"google_managed_kafka_cluster":{const s=RT.kafka[id]||{};h+=kvl([["Message",num(m.msg||0)],["Ghi vào (MB/s)",num(s.mbps||0)],["Năng lực (MB/s, ước tính)",num(s.cap||0)]])+lastErr;break}
    case"google_billing_budget":{const amt=+getP(p,"amount.specified_amount.units")||0,seen=budgetSpend(n),gross=RT.total;h+=`<div class="big">${money(seen)} <span class="muted" style="font-size:16px">/ ${money(amt)}</span></div><div class="bar"><i class="${amt&&seen/amt>=.5?"hi":""}" style="width:${Math.min(100,seen/(amt||1)*100)}%"></i></div>`+
      kvl([["Chi tiêu thật tháng này",money(gross)],["Credit đã trả thay",money(Math.max(0,gross-seen))],["Ngưỡng đã báo",(RT.budget[id]||{fired:[]}).fired.map(pct).join(", ")||"—"]]);
      if(RT.trial&&gross>0&&seen<gross)h+=`<div class="callout"><b>Budget đang trừ credit</b>Chi tiêu thật ${money(gross)}, nhưng credit trả thay nên budget chỉ thấy ${money(seen)} và sẽ không báo cho tới khi hết credit. Đổi “Credit” thành “Không trừ credit” để thấy credit bị đốt.</div>`;break}
    default:h+=lastErr}
  return h};
/* ---------------- boxes: VPC wraps subnets (and what reaches it privately); a subnet wraps VMs and Kafka endpoints ---------------- */
Object.assign(T.google_compute_network,{box:{pad:24,head:34,size:[420,260]},boxLabel:b=>`VPC · ${b.id} · ${b.props.name||""}`,boxEmpty:"Kéo subnet, Memorystore, firewall vào đây"});
Object.assign(T.google_compute_subnetwork,{box:{pad:22,head:30,size:[300,170]},boxLabel:b=>`Subnet · ${b.id} · ${b.props.region||REGION} · ${b.props.ip_cidr_range||""}`,boxClass:()=>" priv",boxEmpty:"Kéo VM hoặc Kafka vào đây"});
DOMAIN.parentOf=n=>{switch(n.type){case"google_compute_subnetwork":case"google_compute_firewall":case"google_redis_instance":case"google_memorystore_instance":return vpcOf(n);
  case"google_compute_instance":return refAt(n,"network_interface.subnetwork")||refAt(n,"network_interface.network");case"google_managed_kafka_cluster":return refAt(n,"gcp_config.access_config.network_configs.subnet")}return null};
const IN_SUBNET=["google_compute_instance","google_managed_kafka_cluster"],IN_VPC=["google_compute_subnetwork","google_compute_firewall","google_redis_instance","google_memorystore_instance"];
function placeGcp(id,box){const n=nodeOf(id);if(!n||!box)return;const B=nodeOf(box.id);if(!B)return;
  if(box.box==="subnet"&&IN_SUBNET.includes(n.type)){const r=connectRule(id,box.id);if(r)edit(`${id} → ${box.id}`,()=>r.apply(true))}
  else if(box.box==="vpc"&&IN_VPC.includes(n.type)){const r=connectRule(id,box.id);if(r)edit(`${id} → ${box.id}`,()=>r.apply(true))}
  else if(box.box==="vpc"&&IN_SUBNET.includes(n.type)){const s=subnetIn(box.id);if(s){const r=connectRule(id,s.id);if(r)edit(`${id} → ${s.id}`,()=>r.apply(true))}}}
DOMAIN.onDrop=(id,type,x,y,boxes)=>{const b=boxAt(boxes,x,y,"subnet")||boxAt(boxes,x,y,"vpc");if(b)placeGcp(id,b)};
DOMAIN.dropHint=(type,x,y,boxes)=>{const t=baseType(type),b=IN_SUBNET.includes(t)?boxAt(boxes,x,y,"subnet")||boxAt(boxes,x,y,"vpc"):IN_VPC.includes(t)?boxAt(boxes,x,y,"vpc"):null;return b?b.id:null};
DOMAIN.dragHint=(n,c,boxes)=>DOMAIN.dropHint(n.type,c[0],c[1],boxes.filter(b=>b.id!==n.id));
DOMAIN.onDragEnd=(n,c,boxes)=>{const b=IN_SUBNET.includes(n.type)?boxAt(boxes,c[0],c[1],"subnet"):IN_VPC.includes(n.type)?boxAt(boxes.filter(x=>x.id!==n.id),c[0],c[1],"vpc"):null;if(b&&b.id!==DOMAIN.parentOf(n))placeGcp(n.id,b)};
/* ---------------- the credit line under the cost meter ---------------- */
DOMAIN.meterExtra=()=>{if(!RT.trial)return`<button class="credit linkish" data-act="trialToggle" title="Đổi sang tài khoản dùng thử">Tài khoản trả tiền thường · bật Free trial</button>`;
  const T0=GP.trial,used=Math.min(T0.credit,RT.spent||0),left=T0.credit-used,day=Math.floor(RT.t/86400)+1,rate=(rateNow()||fixedRate())*24;
  const lasts=rate>0?left/rate:Infinity,cls=left<=0||RT.stack.status==="SUSPENDED"?"bad":lasts<T0.days-day+1?"warn":"";
  return`<button class="credit ${cls}" data-act="trialToggle" title="Free trial: $${T0.credit} credit trong ${T0.days} ngày. Bấm để tắt.">Credit ${money(left)} / $${T0.credit} · ngày ${Math.min(day,T0.days)}/${T0.days}${left<=0?" · đã hết":rate>0?` · ${lasts<1?"hết trong vài giờ":`đủ ~${Math.floor(lasts)} ngày`}`:""}</button>`};
DOMAIN.api={toHcl:(...a)=>toYaml(...a),hclParse:(...a)=>hclParse(...a)};
/* ---- WebMCP (../src/shell/webmcp.js): tool descriptions for Terraform and the format guide */
DOMAIN.mcp={guideHref:"learn.html#gemini",artifact:"Terraform",unitRes:"tài nguyên",
  d:{get_template:"Lấy file Terraform (HCL, provider google) của sơ đồ hiện tại, gồm cả các resource cloudlab_* chỉ dùng cho mô phỏng (client, hộp thư).",
    get_format_guide:"Hướng dẫn viết Terraform mà CloudLab GCP đọc được: resource google_* được hỗ trợ và các thuộc tính chính, resource cloudlab_* cho mô phỏng, cỡ máy, giá niêm yết. Đọc trước khi gọi load_template.",
    explain_component:"Giải thích một khối hoặc một loại tài nguyên Google Cloud bằng ngôn ngữ đơn giản (ví dụ ngân hàng), kèm mô tả kỹ thuật.",
    "explain_component.idOrType":"Id khối trên sơ đồ (dạng tiền tố/tên, ví dụ run/api, redis/cache) hoặc loại Terraform (ví dụ google_redis_instance)",
    load_template:"Mở một file Terraform (HCL) vào sandbox, thay sơ đồ sandbox hiện tại. Dùng để dựng hạ tầng theo tình huống của người dùng rồi xem giá và mô phỏng. Trả về lỗi kèm số dòng, hoặc danh sách khối và vấn đề.",
    "load_template.yaml":"Nội dung file .tf (HCL); xem get_format_guide",
    "add_component.type":"Loại Terraform, ví dụ google_cloud_run_v2_service, google_redis_instance, google_compute_instance#rabbitmq (VM chạy RabbitMQ) hoặc cloudlab_client",
    connect:"Nối khối from tới khối to, giống kéo mũi tên trên canvas (ví dụ Cloud Run → Redis thêm biến REDIS_HOST và đường ra VPC; Cloud Run → Kafka topic thêm biến và gán roles/managedkafka.client). Trả lý do nếu không nối được.",
    "connect.grant":"Khi phép nối kèm thay đổi phụ (đường ra VPC, gán role IAM): true để làm luôn (mặc định true)",
    set_property:"Đổi một thuộc tính của resource (đường dẫn có dấu chấm theo cấu trúc Terraform, ví dụ machine_type, tier, template.max_instance_request_concurrency, capacity_config.vcpu_count). Tham chiếu tới resource khác truyền dạng {\"$\":\"google_compute_network.main.id\"}.",
    export_iac:"Xuất sơ đồ hiện tại: tf (Terraform có phần mô phỏng cloudlab_*), terraform (Terraform sạch để terraform apply với project thật)."},
  guide:()=>({format:"Terraform HCL, provider hashicorp/google 6.x. Tham chiếu giữa resource viết như Terraform thật (network = google_compute_network.main.id, hoặc \"${google_redis_instance.cache.host}\" trong chuỗi). Phần mô phỏng là resource cloudlab_client (target, protocol http|websocket, rate_per_second, connections, messages_per_minute) và cloudlab_inbox (address). Region asia-southeast1. Không mô phỏng module, data source, Cloud NAT, load balancer.",
    types:Object.fromEntries(Object.values(T).filter(t=>!t.alias).map(t=>[t.type,(t.fields||[]).map(f=>f.k)])),
    vmApps:"google_compute_instance với labels = { app = \"rabbitmq\" | \"redis\" | \"kafka\" | \"web\" } là app tự cài trên VM (CloudLab dùng nhãn này để biết VM chạy gì).",
    machineTypes:Object.keys(GP.vm),prices:{checked:PRICES.checked,region:REGION,gcp:GP},
    guide:"https://dat-2k2.github.io/cloudlab/gcp/learn.html#gemini"})};
