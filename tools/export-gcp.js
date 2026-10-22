/* Plain, crawlable versions of the Google Cloud page (gcp/) for LLM readers (Gemini, etc.) and search engines:
   gcp/llms.txt (index), gcp/llms-full.txt (lessons, resources explained with banking examples, list prices, the Terraform
   guide) and gcp/learn.html (same content as static HTML). Same idea as tools/export-k8s.js.
   Run: node tools/export-gcp.js   (no dependencies; build.py runs it too) */
const fs=require("fs"),path=require("path"),vm=require("vm");
const root=path.join(__dirname,"..");
const noop=()=>{},el=()=>({addEventListener:noop,querySelector:()=>null,querySelectorAll:()=>[],classList:{add:noop,remove:noop,toggle:noop},style:{setProperty:noop},setAttribute:noop,appendChild:noop,getAttribute:()=>null});
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,
  window:{addEventListener:noop,innerWidth:1440,innerHeight:900},localStorage:{getItem:()=>null,setItem:noop},
  document:{addEventListener:noop,getElementById:()=>null,querySelector:s=>String(s).includes("cloudlab-app")?{content:"gcp",getAttribute:()=>"gcp"}:null,querySelectorAll:()=>[],createElement:el,body:el(),documentElement:el()}};
ctx.window.document=ctx.document;vm.createContext(ctx);
const files=["vendor/js-yaml.min.js","src/prices.js","src/shell/core.js","src/shell/model.js","src/shell/sim.js",...["hcl","catalog","model","sim","lessons","views","lint"].map(f=>`gcp/src/${f}.js`)];
vm.runInContext(files.map(f=>fs.readFileSync(path.join(root,f),"utf8").replace(/^"use strict";/,"")).join("\n;\n")+"\n;globalThis.__X={LESSONS,T,STARTERS,GCP_ELI5,PRICES,GP,gcpPrice,HOURS_MO,REGION,VM_CAP};",ctx);
const {LESSONS,T,STARTERS,GCP_ELI5,PRICES,GP,HOURS_MO,REGION,VM_CAP}=ctx.__X;
const SITE="https://dat-2k2.github.io/cloudlab/gcp/",AWS="https://dat-2k2.github.io/cloudlab/";
const strip=h=>String(h||"").replace(/<\/(p|li|h4|tr)>/g,"\n").replace(/<br\s*\/?>/g,"\n").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/[ \t]+/g," ").replace(/\n\s+/g,"\n").trim();
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const phases=[...new Set(LESSONS.map(l=>l.phase))];
const intro=`CloudLab GCP là trang học Google Cloud chạy trong trình duyệt bằng Terraform, đặt trong bối cảnh một ngân hàng (project anphat-lab, region asia-southeast1). Người học kéo thả hoặc viết Terraform cho Cloud Run, Memorystore (Redis, Valkey), Managed Service for Apache Kafka, RabbitMQ trên VM, WebSocket trên Cloud Run, Pub/Sub; mỗi khối hiện giá niêm yết theo giờ và tháng; mô phỏng cho thấy mạng nội bộ, firewall, quyền IAM, tải và credit dùng thử $300 bị đốt nhanh thế nào. Xuất ra main.tf sạch để terraform apply. Mô phỏng chạy hoàn toàn trong trình duyệt, không gọi Google Cloud thật.`;
const types=Object.values(T).filter(t=>!t.alias&&!t.ext);
const actors=Object.values(T).filter(t=>t.ext);
const variants=Object.values(T).filter(t=>t.alias);
const fieldKeys=t=>(t.fields||[]).map(f=>f.k).filter(Boolean);
const m$=v=>"$"+(v>=100?v.toFixed(0):v>=1?v.toFixed(2):v.toFixed(4));
/* list prices of a few reference configurations, computed with the simulator's own price function */
const refNode=(type,props)=>{const d=T[type];return gcpPriceOf({type,props,def:d,raw:{},id:"x/x"})};
function gcpPriceOf(n){return ctx.__X.gcpPrice(n)}
const PRICE_ROWS=[["VM e2-micro (20 GB balanced, không IP public)","google_compute_instance",{machine_type:"e2-micro",boot_disk:{initialize_params:{size:20}},network_interface:{}}],
  ["VM e2-small (20 GB, không IP public)","google_compute_instance",{machine_type:"e2-small",boot_disk:{initialize_params:{size:20}},network_interface:{}}],
  ["Memorystore for Redis Basic 1 GB","google_redis_instance",{tier:"BASIC",memory_size_gb:1}],["Memorystore for Redis Standard HA 5 GB","google_redis_instance",{tier:"STANDARD_HA",memory_size_gb:5}],
  ["Memorystore for Valkey 1 node shared-core-nano","google_memorystore_instance",{node_type:"SHARED_CORE_NANO",shard_count:1,replica_count:0}],
  ["Managed Kafka 3 vCPU / 3 GiB (tối thiểu)","google_managed_kafka_cluster",{capacity_config:{vcpu_count:3,memory_bytes:3221225472}}],
  ["Cloud Run 1 instance thường trực (min 1, request-based, lúc rảnh)","google_cloud_run_v2_service",{template:{scaling:{min_instance_count:1},containers:{resources:{limits:{cpu:"1",memory:"512Mi"}}}}}]].map(([l,t,p])=>[l,refNode(t,p).h]);
const PROMPT=`Bạn là kỹ sư Google Cloud. Hãy viết Terraform (provider hashicorp/google) để tôi mở trong CloudLab GCP (${SITE}) và mô phỏng tình huống sau:

[mô tả tình huống của bạn, ví dụ: "ngân hàng cần hàng đợi lệnh chuyển tiền bằng RabbitMQ, cache số dư bằng Redis, luồng giao dịch thẻ vào Kafka, bảng giá realtime qua WebSocket; tôi chỉ có $300 credit dùng thử trong 90 ngày"]

Yêu cầu:
- Đọc hướng dẫn tại ${SITE}learn.html#gemini (hoặc ${SITE}llms-full.txt). Chỉ dùng các resource google_* được liệt kê ở đó; region asia-southeast1.
- Thêm resource "cloudlab_client" (target, rate_per_second, hoặc protocol = "websocket" với connections, messages_per_minute) để tôi bấm Chạy là thấy traffic, và resource "cloudlab_inbox" để nhận cảnh báo budget.
- App trên Cloud Run gọi Redis / Kafka / VM qua biến môi trường tham chiếu tới resource; cần vpc_access (Direct VPC egress) và service account với đúng role.
- Có google_billing_budget với budget_filter { credit_types_treatment = "EXCLUDE_ALL_CREDITS" } gửi tới notification channel email.
- Chỉ trả về một khối Terraform hoàn chỉnh, sau đó giải thích ngắn gọn từng resource và ước tính chi phí mỗi tháng bằng tiếng Việt cho người không chuyên kỹ thuật.`;
const FORMAT=[
  "Terraform HCL chuẩn (provider hashicorp/google 6.x): resource \"loại\" \"tên\" { … }, block lồng nhau, tham chiếu như google_compute_network.main.id hoặc \"${google_redis_instance.cache.host}\" trong chuỗi. Mũi tên trên sơ đồ được suy ra từ các tham chiếu này.",
  "Giữ nguyên terraform {}, provider, variable, output, data khi đọc và xuất lại; module chưa được hỗ trợ.",
  "VM tự cài phần mềm: đặt labels = { app = \"rabbitmq\" } (hoặc redis, kafka, web) để CloudLab biết VM chạy gì và cổng nào (5672, 6379, 9092, 80).",
  "Phần chỉ dành cho mô phỏng là resource cloudlab_client và cloudlab_inbox; tab “Cho project thật” bỏ chúng đi.",
  `Giá niêm yết ${GP.regionName||"Singapore"} (${REGION}), đọc ngày ${PRICES.checked}, chưa trừ free tier. Free trial: $${GP.trial.credit} trong ${GP.trial.days} ngày; hết credit hoặc hết hạn thì tài nguyên dừng.`];
const EXAMPLE=STARTERS.stack4.yaml.trim();
let idx=`# CloudLab GCP\n\n> ${intro}\n\nỨng dụng: ${SITE}\nToàn bộ nội dung dạng văn bản: ${SITE}llms-full.txt · bản HTML tĩnh: ${SITE}learn.html\nSo sánh giá Kafka, Redis, RabbitMQ, WebSocket giữa AWS, Google Cloud và tự cài: ${AWS}pricing.html\n`;
for(const ph of phases){idx+=`\n## ${ph}\n\n`;for(const l of LESSONS.filter(x=>x.phase===ph))idx+=`- [Bài ${l.step}: ${l.title}](${SITE}learn.html#${l.id}): ${l.goal}\n`}
idx+=`\n## Dùng với Gemini\n\n- [Nhờ Gemini viết Terraform cho tình huống của bạn, rồi mở trong CloudLab GCP](${SITE}learn.html#gemini): định dạng, resource được hỗ trợ, giá, câu lệnh mẫu. Dán Terraform tại ${SITE}#/import\n`;
idx+=`\n## WebMCP (cho trợ lý AI của trình duyệt)\n\nTrình duyệt có WebMCP (document.modelContext) sẽ thấy các công cụ: get_state, get_template, get_format_guide, list_lessons, get_lesson, explain_component, open_lesson, open_sandbox, load_template, add_component, connect, set_property, remove_component, run_simulation, check_lesson, export_iac (tf, terraform).\n`;
idx+=`\n## Giá và thành phần\n\n- [Giá niêm yết các cấu hình mẫu](${SITE}learn.html#prices)\n- [Giải thích từng tài nguyên Google Cloud bằng ví dụ ngân hàng](${SITE}learn.html#components)\n\n## Nguồn và bản quyền\n\n- [Bản quyền, nhãn hiệu, nguồn tham khảo](${AWS}credits.html). Google Cloud là nhãn hiệu của Google LLC; trang này không liên kết với Google.\n`;
const lessonMd=l=>`## Bài ${l.step}: ${l.title}\n\nNhóm: ${l.phase} · Chủ đề: ${l.tag}\n\n**Mục tiêu:** ${l.goal}\n\n**Tình huống:** ${l.scenario}\n\n`+
  `**Nhiệm vụ:**\n${l.tasks.map((t,i)=>`${i+1}. ${t.t} (${t.c})`).join("\n")}\n\n**Các khối:**\n${Object.entries(l.explain||{}).map(([k,v])=>`- ${k}: ${v}`).join("\n")}\n\n**Khái niệm:** ${(l.concepts||[]).join(", ")}\n\n**Gợi ý:** ${(l.hints?l.hints():[]).join(" ")}\n\n**Sau khi đạt:** ${l.pass||""}\n\n`;
const priceMd=`## Giá niêm yết một số cấu hình (${REGION}, ${PRICES.checked})\n\n${PRICE_ROWS.map(([l,h])=>`- ${l}: ${m$(h)}/giờ ≈ ${m$(h*HOURS_MO)}/tháng`).join("\n")}\n- Cloud Run: ${m$(GP.run.vcpuS*3600)}/vCPU-giờ khi đang xử lý request (request-based), ${m$(GP.run.instVcpuS*3600)}/vCPU-giờ instance-based, ${m$(GP.run.req*1e6)}/triệu request\n- Pub/Sub: $${GP.pubsubTiB}/TiB, ${GP.pubsubFreeGiB} GiB đầu mỗi tháng miễn phí\n- Truyền dữ liệu ra Internet (tới châu Á): $${GP.egressGB}/GiB\n\nNguồn: ${Object.entries(PRICES.src).filter(([k])=>!/^AWS|^Amazon|^API Gateway|^EC2/.test(k)).map(([k,u])=>`${k} ${u}`).join(" · ")}\n`;
const geminiMd=`## Dùng CloudLab GCP với Gemini: dựng hạ tầng của riêng bạn

1. Mở Gemini, dán câu lệnh mẫu bên dưới và thay phần [mô tả tình huống].
2. Gemini trả về một file Terraform.
3. Mở ${SITE}#/import (hoặc Sandbox → Dán template…), dán Terraform, bấm "Mở trong sandbox". Xem giá niêm yết trên từng khối, bấm ▶ Chạy để thấy traffic, lỗi mạng / quyền, chi phí và credit còn lại; tab Vấn đề liệt kê cấu hình rủi ro.

Câu lệnh mẫu:

\`\`\`
${PROMPT}
\`\`\`

### Định dạng Terraform CloudLab đọc được

${FORMAT.map(x=>"- "+x).join("\n")}

Resource được hỗ trợ (và thuộc tính CloudLab đọc):
${types.map(t=>`- ${t.type} (${t.label}): ${fieldKeys(t).join(", ")}`).join("\n")}

Biến thể trên canvas:
${variants.map(t=>`- ${t.label}: ${t.alias}${t.type.includes("#ws")?' với labels = { protocol = "websocket" }':` với labels = { app = "${t.type.split("#")[1]}" }`}`).join("\n")}

Resource chỉ cho mô phỏng:
${actors.map(t=>`- ${t.type} (${t.label}): ${fieldKeys(t).join(", ")}`).join("\n")}

Ví dụ hoàn chỉnh (bốn dịch vụ, bản rẻ để học):

\`\`\`hcl
${EXAMPLE}
\`\`\`
`;
const comps=[...types,...variants,...actors];
const full=`# CloudLab GCP: toàn bộ nội dung\n\n${intro}\n\nỨng dụng: ${SITE}\n\n`+geminiMd+"\n"+priceMd+"\n"+LESSONS.map(lessonMd).join("")+`## Tài nguyên Google Cloud (giải thích bằng ví dụ ngân hàng)\n\n`+
  comps.map(t=>`### ${t.label} (${t.alias||t.type})\n\n${GCP_ELI5[t.type]||""}\n\n${t.doc||""}\n`).join("\n");
const pre=(s,wrap)=>`<pre style="white-space:${wrap?"pre-wrap":"pre"};overflow:auto;background:var(--line);padding:12px;border-radius:8px">${esc(s)}</pre>`;
const html=`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CloudLab GCP · Nội dung bài học</title><meta name="description" content="${esc(intro)}"><link rel="canonical" href="${SITE}learn.html"><link rel="alternate" type="text/markdown" href="llms-full.txt">
<script type="application/ld+json">${JSON.stringify({"@context":"https://schema.org","@type":"Course",name:"CloudLab GCP",description:intro,inLanguage:"vi",url:SITE,provider:{"@type":"Person",name:"Nguyen Quoc Dat",url:"https://dat-2k2.github.io/"},
  hasPart:LESSONS.map(l=>({"@type":"LearningResource",name:`Bài ${l.step}: ${l.title}`,description:l.goal,url:`${SITE}learn.html#${l.id}`,teaches:(l.concepts||[]).join(", ")}))}).replace(/</g,"\\u003c")}</script>
<style>:root{color-scheme:light dark;--bg:#fff;--fg:#111827;--mut:#4b5563;--line:#e5e7eb;--acc:#4f46e5}@media (prefers-color-scheme:dark){:root{--bg:#0b0d12;--fg:#e5e7eb;--mut:#9ca3af;--line:#1f2937;--acc:#818cf8}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:24px 16px 64px}a{color:var(--acc)}h2{margin-top:40px;padding-top:16px;border-top:1px solid var(--line)}h3{margin-top:24px}.mut{color:var(--mut)}li{margin:4px 0}code{overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}td,th{border-top:1px solid var(--line);padding:6px;text-align:left;vertical-align:top}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}</style></head>
<body><main><p><a href="./">← Mở CloudLab GCP</a> · <a href="../pricing.html">So sánh giá</a> · <a href="../learn.html">Bài học AWS</a></p><h1>CloudLab GCP · Nội dung bài học</h1><p>${esc(intro)}</p>
<nav aria-label="Mục lục"><ul><li><a href="#gemini">Dùng với Gemini</a></li><li><a href="#prices">Giá niêm yết</a></li>${LESSONS.map(l=>`<li><a href="#${l.id}">Bài ${l.step}: ${esc(l.title)}</a></li>`).join("")}<li><a href="#components">Tài nguyên Google Cloud</a></li></ul></nav>
<section id="gemini"><h2>Dùng CloudLab GCP với Gemini: dựng hạ tầng của riêng bạn</h2>
<ol><li>Mở Gemini, dán câu lệnh mẫu bên dưới và thay phần [mô tả tình huống].</li><li>Gemini trả về một file Terraform.</li><li>Mở <a href="./#/import">CloudLab GCP → Dán template</a>, dán Terraform, bấm “Mở trong sandbox”. Xem giá trên từng khối; bấm ▶ Chạy để thấy traffic, lỗi, chi phí và credit còn lại.</li></ol>
<h3>Câu lệnh mẫu</h3>${pre(PROMPT,true)}
<h3>Trợ lý AI trong trình duyệt (WebMCP)</h3><p>Khi trình duyệt hỗ trợ <a href="https://github.com/webmachinelearning/webmcp">WebMCP</a>, trang tự đăng ký 16 công cụ để trợ lý AI đọc và thao tác trực tiếp: đọc trạng thái, mở bài, mở Terraform (<code>load_template</code>), thêm, nối, đổi thuộc tính, chạy mô phỏng (<code>run_simulation</code>), kiểm tra bài và xuất main.tf.</p>
<h3>Định dạng Terraform CloudLab đọc được</h3><ul>${FORMAT.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>
<p><b>Resource được hỗ trợ:</b></p><ul>${types.map(t=>`<li><code>${esc(t.type)}</code> (${esc(t.label)}): <span class="mut">${esc(fieldKeys(t).join(", "))}</span></li>`).join("")}</ul>
<p><b>Biến thể trên canvas:</b></p><ul>${variants.map(t=>`<li>${esc(t.label)}: <code>${esc(t.alias)}</code></li>`).join("")}</ul>
<p><b>Resource chỉ cho mô phỏng:</b></p><ul>${actors.map(t=>`<li><code>${esc(t.type)}</code> (${esc(t.label)}): ${esc(fieldKeys(t).join(", "))}</li>`).join("")}</ul>
<h3>Ví dụ hoàn chỉnh</h3>${pre(EXAMPLE)}</section>
<section id="prices"><h2>Giá niêm yết một số cấu hình</h2><p class="mut">${esc(REGION)} · đọc ngày ${PRICES.checked} · chưa trừ free tier. Bảng so sánh đầy đủ với AWS và tự cài: <a href="../pricing.html">So sánh giá</a>.</p>
<table><thead><tr><th>Cấu hình</th><th>USD / giờ</th><th>USD / tháng (730 giờ)</th></tr></thead><tbody>${PRICE_ROWS.map(([l,h])=>`<tr><td>${esc(l)}</td><td class="n">${m$(h)}</td><td class="n">${m$(h*HOURS_MO)}</td></tr>`).join("")}</tbody></table></section>
${LESSONS.map(l=>`<article id="${l.id}"><h2>Bài ${l.step}: ${esc(l.title)}</h2><p class="mut">${esc(l.phase)} · ${esc(l.tag)}</p>
<p><b>Mục tiêu:</b> ${esc(l.goal)}</p><p><b>Tình huống:</b> ${esc(l.scenario)}</p>
<h3>Nhiệm vụ</h3><ol>${l.tasks.map(t=>`<li>${esc(t.t)} <span class="mut">(${esc(t.c)})</span></li>`).join("")}</ol>
<h3>Các khối</h3><ul>${Object.entries(l.explain||{}).map(([k,v])=>`<li><b>${esc(k)}</b>: ${esc(v)}</li>`).join("")}</ul>
<p><b>Khái niệm:</b> ${esc((l.concepts||[]).join(", "))}</p><p><b>Sau khi đạt:</b> ${esc(l.pass||"")}</p>
<p><a href="./#/lesson/${l.id}">Mở bài này trong CloudLab GCP →</a></p></article>`).join("\n")}
<section id="components"><h2>Tài nguyên Google Cloud, giải thích bằng ví dụ ngân hàng</h2>${comps.map(t=>`<h3 id="c-${t.type.replace(/[^a-z0-9]+/gi,"-")}">${esc(t.label)} <span class="mut">${esc(t.alias||t.type)}</span></h3><p>${esc(GCP_ELI5[t.type]||"")}</p><p class="mut">${esc(t.doc||"")}</p>`).join("")}</section>
<p class="mut">© ${new Date().getFullYear()} Nguyen Quoc Dat · Google Cloud là nhãn hiệu của Google LLC; không liên kết với Google · <a href="../credits.html">Nguồn và bản quyền</a></p></main></body></html>`;
const out=path.join(root,"gcp");
fs.writeFileSync(path.join(out,"llms.txt"),idx);fs.writeFileSync(path.join(out,"llms-full.txt"),full);fs.writeFileSync(path.join(out,"learn.html"),html);
console.log(`gcp/llms.txt ${idx.length} · llms-full.txt ${full.length} · learn.html ${html.length} bytes · ${LESSONS.length} lessons · ${comps.length} components`);
