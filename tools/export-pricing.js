/* Writes pricing.html: Kafka, Redis, RabbitMQ and WebSocket compared across AWS (managed), Google Cloud (managed) and
   self-hosted on a small VM, from the same price table the simulators use (src/prices.js). The page recomputes in the
   browser when the reader changes the workload (connections, messages, hours a day) and plans a $300 credit.
   Run: node tools/export-pricing.js   (no dependencies; build.py runs it too) */
const fs=require("fs"),path=require("path"),vm=require("vm");
const root=path.join(__dirname,"..");
const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,"src/prices.js"),"utf8").replace(/^"use strict";/,"")+";globalThis.P=PRICES;",ctx);
const P=ctx.P;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
/* the options, as functions of the workload w = {hours, conns, mpm, kb, gb, rps}; each returns USD per month and the
   pieces it is made of. Same formulas as the simulators (fixed hourly parts + usage). */
const OPTIONS=`[
 {svc:"kafka",name:"Amazon MSK · 2 broker kafka.t3.small",cloud:"aws",kind:"managed",note:"Tối thiểu 2 broker ở 2 AZ; 100 GB ổ mỗi broker.",
  f:w=>{const b=2*P.aws.msk["kafka.t3.small"]*w.h,s=2*100*P.aws.msk.storGBmo;return[["2 broker",b],["Ổ đĩa 2 × 100 GB",s]]}},
 {svc:"kafka",name:"Amazon MSK Serverless",cloud:"aws",kind:"managed",note:"Không chọn broker, nhưng phí cluster-giờ cao; 6 partition.",
  f:w=>[["Cluster-giờ",P.aws.mskSl.clusterH*w.h],["6 partition",6*P.aws.mskSl.partH*w.h],["Ghi vào "+w.gb+" GB",w.gb*P.aws.mskSl.inGB],["Đọc ra "+w.gb+" GB",w.gb*P.aws.mskSl.outGB]]},
 {svc:"kafka",name:"Google Managed Kafka · 3 vCPU, 3 GiB",cloud:"gcp",kind:"managed",note:"Cỡ nhỏ nhất cho phép; ổ local 100 GiB mỗi vCPU.",
  f:w=>{const k=P.gcp.kafka;return[["3 vCPU",3*k.vcpuH*w.h],["3 GiB RAM",3*k.gibH*w.h],["Ổ local 300 GiB",300*k.localGiBh*w.h]]}},
 {svc:"kafka",name:"Google Pub/Sub (thay Kafka)",cloud:"gcp",kind:"serverless",note:"Không có giá cố định; mỗi lần publish tính tối thiểu 1 KB; 10 GiB đầu miễn phí. Không đọc lại luồng như Kafka.",
  f:w=>[["Throughput "+w.gb+" GB",Math.max(0,w.gb-P.gcp.pubsubFreeGiB)/1024*P.gcp.pubsubTiB]]},
 {svc:"kafka",name:"Kafka tự cài · AWS t3.small",cloud:"aws",kind:"self",note:"Một node, không bản sao: học được API, không dùng cho dữ liệu thật.",
  f:w=>[["EC2 t3.small",P.aws.ec2["t3.small"]*w.h],["gp3 20 GB",20*P.aws.gp3GBmo]]},
 {svc:"kafka",name:"Kafka tự cài · GCP e2-small",cloud:"gcp",kind:"self",note:"Một node, không bản sao.",
  f:w=>[["e2-small",P.gcp.vm["e2-small"]*w.h],["Ổ balanced 20 GB",20*P.gcp.pdGBmo]]},
 {svc:"redis",name:"ElastiCache · cache.t4g.micro (Valkey)",cloud:"aws",kind:"managed",note:"Một node; Valkey rẻ hơn Redis OSS 20%.",
  f:w=>[["Node t4g.micro",P.aws.cacheNodeValkey["cache.t4g.micro"]*w.h]]},
 {svc:"redis",name:"ElastiCache Serverless (Valkey)",cloud:"aws",kind:"serverless",note:"Tính theo GB đang lưu (tối thiểu 100 MB) và ECPU (≈ 1 mỗi lệnh nhỏ).",
  f:w=>[["Dữ liệu 0,1 GB",Math.max(P.aws.ecSl.valkey.minGB,0.1)*P.aws.ecSl.valkey.gbH*w.h],["ECPU",w.rps*3600*w.h*P.aws.ecSl.valkey.ecpu]]},
 {svc:"redis",name:"Memorystore for Redis · Basic 1 GB",cloud:"gcp",kind:"managed",note:"Một node, không bản sao; dung lượng nhỏ nhất.",
  f:w=>[["1 GB Basic",P.gcp.redis[0].basic*w.h]]},
 {svc:"redis",name:"Memorystore for Valkey · shared-core-nano",cloud:"gcp",kind:"managed",note:"Node nhỏ nhất, chỉ cho dev/test, không SLA. Cần service connection policy (PSC).",
  f:w=>[["1 node nano",P.gcp.valkeyNode.SHARED_CORE_NANO*w.h]]},
 {svc:"redis",name:"Redis tự cài · AWS t4g.micro",cloud:"aws",kind:"self",note:"Không failover, không backup tự động.",
  f:w=>[["EC2 t4g.micro",P.aws.ec2["t4g.micro"]*w.h],["gp3 8 GB",8*P.aws.gp3GBmo]]},
 {svc:"redis",name:"Redis tự cài · GCP e2-micro",cloud:"gcp",kind:"self",note:"Không failover, không backup tự động.",
  f:w=>[["e2-micro",P.gcp.vm["e2-micro"]*w.h],["Ổ balanced 10 GB",10*P.gcp.pdGBmo]]},
 {svc:"rabbitmq",name:"Amazon MQ · mq.m7g.medium (1 node)",cloud:"aws",kind:"managed",note:"Cỡ nhỏ nhất còn tạo mới được (mq.t3.micro đã ngừng từ 1/10/2026).",
  f:w=>[["Broker",P.aws.mq["mq.m7g.medium"]*w.h],["Lưu 20 GB",20*P.aws.mq.storGBmo]]},
 {svc:"rabbitmq",name:"Amazon MQ · cluster 3 × mq.m7g.medium",cloud:"aws",kind:"managed",note:"3 node ở 3 AZ, cho production.",
  f:w=>[["Cluster",P.aws.mqCluster["mq.m7g.medium"]*w.h],["Lưu 3 × 20 GB",60*P.aws.mq.storGBmo]]},
 {svc:"rabbitmq",name:"RabbitMQ tự cài · AWS t3.small",cloud:"aws",kind:"self",note:"Bạn tự vá lỗi, sao lưu, giám sát.",
  f:w=>[["EC2 t3.small",P.aws.ec2["t3.small"]*w.h],["gp3 20 GB",20*P.aws.gp3GBmo]]},
 {svc:"rabbitmq",name:"RabbitMQ tự cài · GCP e2-small",cloud:"gcp",kind:"self",note:"Google Cloud không có RabbitMQ được quản lý sẵn (chỉ qua Marketplace, bị chặn khi dùng thử).",
  f:w=>[["e2-small",P.gcp.vm["e2-small"]*w.h],["Ổ balanced 20 GB",20*P.gcp.pdGBmo]]},
 {svc:"ws",name:"API Gateway WebSocket",cloud:"aws",kind:"managed",note:"Trả theo phút-kết nối và message (mỗi 32 KB); chưa tính Lambda đẩy tin.",
  f:w=>{const min=w.conns*60*w.h,msg=w.conns*w.mpm*60*w.h;return[["Phút-kết nối",min*P.aws.ws.connMin],["Message",msg*P.aws.ws.msg]]}},
 {svc:"ws",name:"Cloud Run · 1.000 kết nối / instance (request-based)",cloud:"gcp",kind:"serverless",note:"Instance có kết nối mở được tính tiền suốt; timeout tối đa 60 phút.",
  f:w=>{const inst=Math.ceil(w.conns/1000),r=P.gcp.run,eg=w.conns*w.mpm*60*w.h*w.kb/1048576;return[[inst+" instance (1 vCPU, 512 MiB)",inst*(r.vcpuS+0.5*r.gibS)*3600*w.h],["Truyền ra Internet",eg*P.gcp.egressGB]]}},
 {svc:"ws",name:"Cloud Run · 1.000 kết nối / instance (instance-based)",cloud:"gcp",kind:"serverless",note:"Instance luôn bận thì instance-based rẻ hơn.",
  f:w=>{const inst=Math.ceil(w.conns/1000),r=P.gcp.run,eg=w.conns*w.mpm*60*w.h*w.kb/1048576;return[[inst+" instance (1 vCPU, 512 MiB)",inst*(r.instVcpuS+0.5*r.instGibS)*3600*w.h],["Truyền ra Internet",eg*P.gcp.egressGB]]}},
 {svc:"ws",name:"WebSocket tự cài · GCP e2-small",cloud:"gcp",kind:"self",note:"Một server nhỏ giữ được vài nghìn kết nối nhàn rỗi (ước tính CloudLab); bạn tự lo TLS, mở rộng.",
  f:w=>{const eg=w.conns*w.mpm*60*w.h*w.kb/1048576;return[["e2-small + 20 GB",P.gcp.vm["e2-small"]*w.h+20*P.gcp.pdGBmo],["IPv4 public",P.gcp.ipv4H*w.h],["Truyền ra Internet",eg*P.gcp.egressGB]]}},
 {svc:"ws",name:"WebSocket tự cài · AWS t3.small",cloud:"aws",kind:"self",note:"Như trên, trên EC2.",
  f:w=>{const eg=w.conns*w.mpm*60*w.h*w.kb/1048576;return[["t3.small + 20 GB",P.aws.ec2["t3.small"]*w.h+20*P.aws.gp3GBmo],["IPv4 public",P.aws.ipv4H*w.h],["Truyền ra Internet (ước tính $0.114/GB)",eg*0.114]]}}
]`;
const SVC=[["kafka","Kafka / luồng sự kiện"],["redis","Redis / cache"],["rabbitmq","RabbitMQ / hàng đợi"],["ws","WebSocket / đẩy dữ liệu realtime"]];
const page=`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>So sánh giá · Kafka, Redis, RabbitMQ, WebSocket</title>
<meta name="description" content="So sánh giá niêm yết Kafka, Redis, RabbitMQ và WebSocket trên AWS, Google Cloud và tự cài trên máy ảo nhỏ; tính xem $300 credit dùng thử đủ bao nhiêu ngày. Giá đọc ngày ${P.checked}.">
<link rel="canonical" href="https://dat-2k2.github.io/cloudlab/pricing.html">
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#111827;--mut:#4b5563;--line:#e5e7eb;--sunk:#f3f4f6;--acc:#4f46e5;--ok:#15803d;--warn:#b45309;--bad:#b91c1c;--aws:#c2410c;--gcp:#1d4ed8}
@media (prefers-color-scheme:dark){:root{--bg:#0b0d12;--fg:#e5e7eb;--mut:#9ca3af;--line:#1f2937;--sunk:#111827;--acc:#818cf8;--ok:#4ade80;--warn:#fbbf24;--bad:#f87171;--aws:#fb923c;--gcp:#93c5fd}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,sans-serif}main{max-width:980px;margin:0 auto;padding:24px 16px 64px}a{color:var(--acc)}
h1{font-size:28px;line-height:1.2;margin:8px 0}h2{margin:36px 0 8px;padding-top:16px;border-top:1px solid var(--line);font-size:20px}.mut{color:var(--mut)}
.ctl{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:16px 0;padding:14px;background:var(--sunk);border-radius:10px}
.ctl label{display:grid;gap:4px;font-size:14px;color:var(--mut)}.ctl input,.ctl select{font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:6px 8px;width:100%}
table{border-collapse:collapse;width:100%;font-size:15px}th,td{padding:8px 6px;border-top:1px solid var(--line);text-align:left;vertical-align:top}th{font-size:13px;color:var(--mut);font-weight:500}
td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}td small{display:block;color:var(--mut);font-size:13px;line-height:1.4}
.tag{display:inline-block;font-size:12px;padding:0 6px;border-radius:999px;border:1px solid currentColor;margin-right:6px}.tag.aws{color:var(--aws)}.tag.gcp{color:var(--gcp)}
tr.min td.n b{color:var(--ok)}.bar{height:6px;background:var(--line);border-radius:3px;margin-top:4px;min-width:60px}.bar i{display:block;height:6px;border-radius:3px;background:var(--acc)}
.plan{display:grid;gap:8px;margin-top:8px}.plan label{display:grid;grid-template-columns:220px minmax(0,1fr);gap:8px;align-items:center}.plan select{width:100%;min-width:0;max-width:100%;font:inherit;padding:6px 8px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
@media (max-width:640px){.plan label{grid-template-columns:minmax(0,1fr);gap:4px}}
.total{margin-top:12px;padding:14px;border-radius:10px;background:var(--sunk);font-size:18px}.total b{font-variant-numeric:tabular-nums}.total .warn{color:var(--warn)}.total .bad{color:var(--bad)}.total .ok{color:var(--ok)}
.wrap{overflow-x:auto}@media (max-width:640px){td.hide,th.hide{display:none}}
</style></head><body><main>
<p><a href="./">CloudLab AWS</a> · <a href="gcp/">CloudLab GCP</a> · <a href="k8s/">Kubernetes</a></p>
<h1>So sánh giá: Kafka, Redis, RabbitMQ, WebSocket</h1>
<p class="mut">Giá niêm yết on-demand, chưa trừ free tier, đọc ngày ${P.checked}. AWS: ${esc(P.aws.regionName)} (${P.aws.region}); Google Cloud: ${esc(P.gcp.regionName)} (${P.gcp.region}). Một tháng = 730 giờ. Cùng bảng giá với mô phỏng trong <a href="./">CloudLab AWS</a> và <a href="gcp/">CloudLab GCP</a>. Năng lực của máy tự cài là ước tính của CloudLab, không phải benchmark.</p>
<div class="ctl" role="group" aria-label="Tải giả định">
<label>Giờ chạy mỗi ngày<select id="hours"><option value="24">24 giờ (chạy suốt)</option><option value="8">8 giờ (bật khi học)</option><option value="2">2 giờ</option></select></label>
<label>Kết nối WebSocket mở cùng lúc<input id="conns" type="number" min="0" step="100" value="1000"></label>
<label>Tin đẩy mỗi kết nối mỗi phút<input id="mpm" type="number" min="0" step="1" value="12"></label>
<label>Message vào Kafka mỗi tháng (GB)<input id="gb" type="number" min="0" step="10" value="20"></label>
<label>Lệnh Redis mỗi giây<input id="rps" type="number" min="0" step="10" value="50"></label>
</div>
<div id="tables"></div>
<h2 id="plan">$300 credit đủ bao nhiêu ngày?</h2>
<p class="mut">Chọn một cách chạy cho mỗi dịch vụ. Google Cloud dùng thử: $300 trong 90 ngày, hết credit hoặc hết hạn thì tài nguyên dừng. AWS tài khoản mới: tối đa $200 credit trong 6 tháng (gói Free plan).</p>
<div class="plan" id="pick"></div><div class="total" id="total" aria-live="polite"></div>
<h2>Đọc bảng thế nào</h2>
<ul>
<li><b>Giá cố định thắng ở lưu lượng nhỏ.</b> Managed Kafka (cả MSK Serverless) tính tiền mỗi giờ dù không có message. Khi học, phần cố định chiếm gần hết hóa đơn.</li>
<li><b>WebSocket: AWS tính theo message, Cloud Run tính theo instance.</b> Đẩy giá liên tục cho nhiều người thì API Gateway đắt nhanh; ít tin nhưng nhiều người giữ kết nối thì ngược lại. Đổi “tin đẩy mỗi phút” để thấy điểm cắt.</li>
<li><b>Tự cài rẻ nhất, nhưng bạn là người trực.</b> Không bản sao, không failover, tự vá lỗi. Hợp để học API của Kafka / RabbitMQ / Redis, không hợp cho dữ liệu thật.</li>
<li><b>Bật khi học, tắt khi xong.</b> Chọn “8 giờ” để thấy một cluster Kafka managed chỉ bật buổi học rẻ hơn nhiều. Với Terraform: <code>terraform destroy</code> khi xong.</li>
</ul>
<h2>Nguồn</h2><ul>${Object.entries(P.src).map(([k,u])=>`<li><a href="${esc(u)}">${esc(k)}</a></li>`).join("")}</ul>
<p class="mut">Giá thay đổi theo thời gian và theo region; đối chiếu trang giá chính thức trước khi deploy. Không phải tư vấn tài chính. Amazon Web Services, AWS và Google Cloud là nhãn hiệu của chủ sở hữu tương ứng; CloudLab không liên kết. © ${new Date().getFullYear()} Nguyen Quoc Dat · <a href="credits.html">Nguồn và bản quyền</a></p>
</main>
<script>
const P=${JSON.stringify(P)};const OPT=${OPTIONS};const SVC=${JSON.stringify(SVC)};
const $=id=>document.getElementById(id),m=v=>"$"+(v>=100?Math.round(v).toLocaleString("en-US"):v.toFixed(2));
const KIND={managed:"được quản lý",serverless:"serverless",self:"tự cài"};
function w(){return{h:730/24*(+$("hours").value||24),conns:+$("conns").value||0,mpm:+$("mpm").value||0,gb:+$("gb").value||0,rps:+$("rps").value||0,kb:0.2}}
function price(o,W){const parts=o.f(W);return{parts,t:parts.reduce((a,x)=>a+x[1],0)}}
function render(){const W=w();let h="";
  for(const[s,label]of SVC){const rows=OPT.map((o,i)=>({o,i,...price(o,W)})).filter(r=>r.o.svc===s).sort((a,b)=>a.t-b.t),max=Math.max(...rows.map(r=>r.t),1e-9);
    h+='<h2>'+label+'</h2><div class="wrap"><table><thead><tr><th>Cách chạy</th><th class="hide">Gồm</th><th>USD / tháng</th></tr></thead><tbody>'+rows.map((r,k)=>'<tr'+(k===0?' class="min"':'')+'><td><span class="tag '+r.o.cloud+'">'+(r.o.cloud==="aws"?"AWS":"GCP")+'</span>'+r.o.name+'<small>'+KIND[r.o.kind]+' · '+r.o.note+'</small></td><td class="hide"><small>'+r.parts.map(p=>p[0]+': '+m(p[1])).join('<br>')+'</small></td><td class="n"><b>'+m(r.t)+'</b><div class="bar"><i style="width:'+Math.max(2,r.t/max*100)+'%"></i></div></td></tr>').join("")+'</tbody></table></div>'}
  $("tables").innerHTML=h;plan()}
function pickHtml(){$("pick").innerHTML=SVC.map(([s,label])=>'<label><span>'+label+'</span><select data-svc="'+s+'"><option value="">Không dùng</option>'+OPT.map((o,i)=>o.svc===s?'<option value="'+i+'">'+(o.cloud==="aws"?"AWS · ":"GCP · ")+o.name+'</option>':"").join("")+'</select></label>').join("");
  const def={kafka:"Google Pub/Sub",redis:"Memorystore for Redis",rabbitmq:"RabbitMQ tự cài · GCP",ws:"Cloud Run · 1.000 kết nối / instance (instance-based)"};
  document.querySelectorAll("#pick select").forEach(sel=>{const i=OPT.findIndex(o=>o.svc===sel.dataset.svc&&o.name.startsWith(def[sel.dataset.svc]));if(i>=0)sel.value=String(i)})}
function plan(){const W=w();let t=0;document.querySelectorAll("#pick select").forEach(sel=>{if(sel.value!=="")t+=price(OPT[+sel.value],W).t});
  const day=t/30,days=day>0?300/day:Infinity,cls=days>=90?"ok":days>=45?"warn":"bad";
  $("total").innerHTML='Tổng ≈ <b>'+m(t)+'</b> / tháng · <b>'+m(day)+'</b> / ngày → $300 đủ <b class="'+cls+'">'+(days===Infinity?"mãi mãi":Math.floor(days)+" ngày")+'</b>'+(days<90&&days!==Infinity?' <span class="mut">(dùng thử Google Cloud kéo dài 90 ngày)</span>':'')}
pickHtml();render();document.addEventListener("input",e=>{if(e.target.closest(".ctl"))render();else if(e.target.closest("#pick"))plan()});document.addEventListener("change",e=>{if(e.target.closest(".ctl"))render();else if(e.target.closest("#pick"))plan()});
</script></body></html>`;
fs.writeFileSync(path.join(root,"pricing.html"),page);
console.log(`pricing.html ${page.length} bytes`);
