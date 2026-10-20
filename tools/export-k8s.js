/* Plain, crawlable versions of the Kubernetes page (k8s/) for LLM readers (Gemini, etc.) and search engines:
   k8s/llms.txt (index), k8s/llms-full.txt (lessons, kinds explained with banking examples, the manifest guide) and
   k8s/learn.html (same content as static HTML). Same idea as tools/export-text.js for the AWS page.
   Run: node tools/export-k8s.js   (no dependencies; build.py runs it too) */
const fs=require("fs"),path=require("path"),vm=require("vm");
const root=path.join(__dirname,"..");
const noop=()=>{},el=()=>({addEventListener:noop,querySelector:()=>null,querySelectorAll:()=>[],classList:{add:noop,remove:noop,toggle:noop},style:{setProperty:noop},setAttribute:noop,appendChild:noop,getAttribute:()=>null});
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,
  window:{addEventListener:noop,innerWidth:1440,innerHeight:900},localStorage:{getItem:()=>null,setItem:noop},
  document:{addEventListener:noop,getElementById:()=>null,querySelector:s=>String(s).includes("cloudlab-app")?{content:"k8s",getAttribute:()=>"k8s"}:null,querySelectorAll:()=>[],createElement:el,body:el(),documentElement:el()}};
ctx.window.document=ctx.document;vm.createContext(ctx);
const files=["vendor/js-yaml.min.js","src/shell/core.js","src/shell/model.js","src/shell/sim.js",...["catalog","edge","rbac","ops","model","sim","lessons","bank","views","views-more","lint"].map(f=>`k8s/src/${f}.js`)];
vm.runInContext(files.map(f=>fs.readFileSync(path.join(root,f),"utf8").replace(/^"use strict";/,"")).join("\n;\n")+"\n;globalThis.__X={LESSONS,T,GROUPS,STARTERS,IMAGES,K8S_ELI5,API,NODE_TYPES,STORAGE_CLASSES,REG};",ctx);
const {LESSONS,T,STARTERS,IMAGES,K8S_ELI5,API,NODE_TYPES,STORAGE_CLASSES,REG}=ctx.__X;
const SITE="https://dat-2k2.github.io/cloudlab/k8s/",AWS="https://dat-2k2.github.io/cloudlab/";
const strip=h=>String(h||"").replace(/<\/(p|li|h4|tr)>/g,"\n").replace(/<br\s*\/?>/g,"\n").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/[ \t]+/g," ").replace(/\n\s+/g,"\n").trim();
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const phases=[...new Set(LESSONS.map(l=>l.phase))];
const intro=`CloudLab Kubernetes là trang học Kubernetes chạy trong trình duyệt, đặt trong bối cảnh một ngân hàng (cluster anphat-prod trên EKS giả lập). Người học kéo thả đối tượng Kubernetes hoặc viết manifest YAML, chạy mô phỏng để thấy scheduler xếp pod, probe, Service, Ingress, giới hạn tốc độ, HPA, quota, PodDisruptionBudget, RBAC, NetworkPolicy, ổ đĩa và chi phí cluster, rồi xuất manifest sạch cho kubectl apply. Mỗi bài là một cluster có lỗi cài sẵn; người học sửa rồi bấm Kiểm tra. Mô phỏng chạy hoàn toàn trong trình duyệt, không gọi cluster thật; giá là giá tham khảo.`;
const kinds=Object.values(T).filter(t=>!t.edge&&!t.type.startsWith("CloudLab::"));
const clDocs=Object.values(T).filter(t=>t.type.startsWith("CloudLab::"));
const fieldKeys=t=>(t.fields||[]).map(f=>f.k).filter(Boolean);
const imgs=Object.entries(IMAGES);
const imgLine=([r,a])=>`${r}: tag ${a.tags.join(" / ")} · ${a.label}${a.port?` · cổng ${a.port}${a.tcp?" (TCP)":""}`:""}${a.health?` · health ${a.health.join(", ")}`:""}${a.needs?` · cần biến ${a.needs.join(", ")}`:""}${a.job?" · chạy xong rồi thoát (dùng cho Job / CronJob)":""} · khoảng ${a.mem}Mi memory${a.start?` · khởi động khoảng ${a.start}s`:""}`;
const EXAMPLE=STARTERS.ib.yaml.trim();
const PROMPT=`Bạn là kỹ sư Kubernetes. Hãy viết manifest Kubernetes (YAML, nhiều tài liệu cách nhau ---) để tôi mở trong CloudLab Kubernetes (${SITE}) và mô phỏng tình huống sau:

[mô tả tình huống của bạn, ví dụ: "ngân hàng cần API tra cứu khoản vay: chạy 3 pod, tự co giãn khi ngày lương, chỉ app web gọi được, mật khẩu DB để trong Secret, giới hạn 50 request/giây mỗi IP"]

Yêu cầu:
- Đọc hướng dẫn định dạng tại ${SITE}learn.html#gemini (hoặc ${SITE}llms-full.txt). Chỉ dùng các kind và image được liệt kê ở đó (image phải đúng tên và tag trong danh sách, và đủ biến môi trường bắt buộc).
- Thêm tài liệu apiVersion: cloudlab.dev/v1, kind: Client (ratePerSecond, target) để tôi bấm Chạy là thấy traffic; có Ingress thì thêm IngressController.
- Khai báo resources.requests / limits, readinessProbe, nhãn và selector khớp nhau như manifest thật.
- Chỉ trả về một khối YAML hoàn chỉnh, sau đó giải thích ngắn gọn từng đối tượng bằng tiếng Việt cho người không chuyên kỹ thuật.`;
const FORMAT=[
  "Manifest Kubernetes YAML chuẩn: nhiều tài liệu cách nhau ---, mỗi tài liệu có apiVersion, kind, metadata.name; namespace mặc định là default. Một tài liệu kind: List cũng được.",
  "apiVersion phải khớp kind (ví dụ apps/v1 cho Deployment, networking.k8s.io/v1 cho Ingress); sai thì CloudLab báo lỗi giống API server.",
  "Mũi tên trên sơ đồ được suy ra như cluster thật: label selector của Service / NetworkPolicy / PodDisruptionBudget, tên được tham chiếu (configMapRef, secretKeyRef, claimName, scaleTargetRef, backend.service.name, roleRef, subjects), và biến môi trường trỏ tới DNS của Service (tên kết thúc _HOST, _URL… hoặc giá trị có ://).",
  `Image chỉ kéo được nếu có trong registry giả lập ${REG} (danh sách bên dưới); tag sai là ImagePullBackOff, thiếu biến bắt buộc là CrashLoopBackOff.`,
  "Phần chỉ dành cho mô phỏng là các tài liệu apiVersion: cloudlab.dev/v1 (Client, NodePool, IngressController, Actor); tab “Cho cluster thật” bỏ chúng đi.",
  `Cluster giả lập trên EKS: node ${Object.keys(NODE_TYPES).join(", ")}; storage class ${STORAGE_CLASSES.list.join(", ")}; giá tham khảo ap-southeast-1.`];
/* ---- llms.txt */
let idx=`# CloudLab Kubernetes\n\n> ${intro}\n\nỨng dụng: ${SITE}\nToàn bộ nội dung dạng văn bản: ${SITE}llms-full.txt · bản HTML tĩnh: ${SITE}learn.html\nTrang AWS cùng bộ: ${AWS} (${AWS}llms.txt)\n`;
for(const ph of phases){idx+=`\n## ${ph}\n\n`;for(const l of LESSONS.filter(x=>x.phase===ph))idx+=`- [Bài ${l.step}: ${l.title}](${SITE}learn.html#${l.id}): ${l.goal}\n`}
idx+=`\n## Dùng với Gemini\n\n- [Nhờ Gemini viết manifest cho tình huống của bạn, rồi mở trong CloudLab Kubernetes](${SITE}learn.html#gemini): định dạng, kind và image được hỗ trợ, câu lệnh mẫu. Dán manifest tại ${SITE}#/import\n`;
idx+=`\n## WebMCP (cho trợ lý AI của trình duyệt)\n\nTrình duyệt có WebMCP (document.modelContext) sẽ thấy các công cụ: get_state, get_template, get_format_guide, list_lessons, get_lesson, explain_component, open_lesson, open_sandbox, load_template, add_component, connect, set_property, remove_component, run_simulation, check_lesson, export_iac (yaml, kubectl). Trợ lý có thể dựng cluster theo tình huống của người dùng bằng load_template rồi run_simulation.\n`;
idx+=`\n## Thành phần\n\n- [Giải thích từng kind Kubernetes bằng ví dụ ngân hàng](${SITE}learn.html#components)\n\n## Nguồn và bản quyền\n\n- [Bản quyền, nhãn hiệu, nguồn tham khảo](${AWS}credits.html). Kubernetes® là nhãn hiệu đã đăng ký của The Linux Foundation; trang này không liên kết với The Linux Foundation hay CNCF.\n`;
/* ---- full text */
const bankMd=b=>{if(!b)return"";let s=`**Trong ngân hàng:** ${b.why||""}\n`;(b.cases||[]).forEach(c=>s+=`- ${c.t}${c.url?` (${c.url})`:""}\n`);if(b.rule)s+=`- Quy định: ${b.rule.t}${b.rule.url?` (${b.rule.url})`:""}\n`;if(b.q)s+=`- Câu hỏi thảo luận: ${b.q}\n`;return s+"\n"};
const lessonMd=l=>`## Bài ${l.step}: ${l.title}\n\nNhóm: ${l.phase} · Chủ đề: ${l.tag}\n\n**Mục tiêu:** ${l.goal}\n\n**Tình huống:** ${l.scenario}\n\n`+bankMd(l.bank)+
  `**Nhiệm vụ:**\n${l.tasks.map((t,i)=>`${i+1}. ${t.t} (${t.c})`).join("\n")}\n\n**Các khối trong cluster:**\n${Object.entries(l.explain||{}).map(([k,v])=>`- ${k}: ${v}`).join("\n")}\n\n**Khái niệm:** ${(l.concepts||[]).join(", ")}\n\n**Gợi ý:** ${(l.hints?l.hints():[]).join(" ")}\n\n**Sau khi đạt:** ${l.pass||""}\n\n`+(l.reading?`**Đọc thêm (${l.reading.title}):**\n${strip(l.reading.html)}\n\n`:"");
const geminiMd=`## Dùng CloudLab Kubernetes với Gemini: mô phỏng cluster của riêng bạn

1. Mở Gemini, dán câu lệnh mẫu bên dưới và thay phần [mô tả tình huống].
2. Gemini trả về manifest Kubernetes (YAML).
3. Mở ${SITE}#/import (hoặc Sandbox → Dán template…), dán YAML, bấm "Mở trong sandbox". CloudLab vẽ sơ đồ; bấm ▶ Chạy để thấy pod khởi động, traffic, lỗi và chi phí; tab Vấn đề liệt kê cấu hình rủi ro.

Câu lệnh mẫu:

\`\`\`
${PROMPT}
\`\`\`

### Định dạng manifest CloudLab đọc được

${FORMAT.map(x=>"- "+x).join("\n")}

Kind được hỗ trợ (kind: apiVersion):
${kinds.map(t=>`- ${t.type}: ${API[t.type]||""}`).join("\n")}

Tài liệu chỉ cho mô phỏng (apiVersion: cloudlab.dev/v1):
${clDocs.map(t=>`- ${t.type.slice(10)} (${t.label}): ${fieldKeys(t).join(", ")}`).join("\n")}

Image có trong registry giả lập:
${imgs.map(x=>"- "+imgLine(x)).join("\n")}

Ví dụ hoàn chỉnh (Internet Banking: Ingress → Service → Deployment, có khách gửi request):

\`\`\`yaml
${EXAMPLE}
\`\`\`
`;
const full=`# CloudLab Kubernetes: toàn bộ nội dung\n\n${intro}\n\nỨng dụng: ${SITE}\n\n`+geminiMd+"\n"+LESSONS.map(lessonMd).join("")+`## Kind Kubernetes (giải thích bằng ví dụ ngân hàng)\n\n`+
  [...kinds,...clDocs].map(t=>`### ${t.label} (${t.type.startsWith("CloudLab::")?"cloudlab.dev/v1 "+t.type.slice(10):t.type})\n\n${K8S_ELI5[t.type]||""}\n\n${t.doc||""}\n`).join("\n");
/* ---- static HTML */
const pre=(s,wrap)=>`<pre style="white-space:${wrap?"pre-wrap":"pre"};overflow:auto;background:var(--line);padding:12px;border-radius:8px">${esc(s)}</pre>`;
const bankHtml=b=>b?`<h3>Trong ngân hàng</h3><p>${esc(b.why||"")}</p><ul>${(b.cases||[]).map(c=>`<li>${esc(c.t)}${c.url?` <a href="${esc(c.url)}">nguồn</a>`:""}</li>`).join("")}${b.rule?`<li>Quy định: ${esc(b.rule.t)}${b.rule.url?` <a href="${esc(b.rule.url)}">nguồn</a>`:""}</li>`:""}</ul>${b.q?`<p><b>Câu hỏi thảo luận:</b> ${esc(b.q)}</p>`:""}`:"";
const html=`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CloudLab Kubernetes · Nội dung bài học</title><meta name="description" content="${esc(intro)}"><link rel="canonical" href="${SITE}learn.html"><link rel="alternate" type="text/markdown" href="llms-full.txt">
<script type="application/ld+json">${JSON.stringify({"@context":"https://schema.org","@type":"Course",name:"CloudLab Kubernetes",description:intro,inLanguage:"vi",url:SITE,provider:{"@type":"Person",name:"Nguyen Quoc Dat",url:"https://dat-2k2.github.io/"},
  hasPart:LESSONS.map(l=>({"@type":"LearningResource",name:`Bài ${l.step}: ${l.title}`,description:l.goal,url:`${SITE}learn.html#${l.id}`,teaches:(l.concepts||[]).join(", ")}))}).replace(/</g,"\\u003c")}</script>
<style>:root{color-scheme:light dark;--bg:#fff;--fg:#111827;--mut:#4b5563;--line:#e5e7eb;--acc:#4f46e5}@media (prefers-color-scheme:dark){:root{--bg:#0b0d12;--fg:#e5e7eb;--mut:#9ca3af;--line:#1f2937;--acc:#818cf8}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:24px 16px 64px}a{color:var(--acc)}h2{margin-top:40px;padding-top:16px;border-top:1px solid var(--line)}h3{margin-top:24px}.mut{color:var(--mut)}li{margin:4px 0}code{overflow-wrap:anywhere}</style></head>
<body><main><p><a href="./">← Mở CloudLab Kubernetes</a> · <a href="../learn.html">Bài học AWS</a></p><h1>CloudLab Kubernetes · Nội dung bài học</h1><p>${esc(intro)}</p>
<nav aria-label="Mục lục"><ul><li><a href="#gemini">Dùng với Gemini</a></li>${LESSONS.map(l=>`<li><a href="#${l.id}">Bài ${l.step}: ${esc(l.title)}</a></li>`).join("")}<li><a href="#components">Kind Kubernetes</a></li></ul></nav>
<section id="gemini"><h2>Dùng CloudLab Kubernetes với Gemini: mô phỏng cluster của riêng bạn</h2>
<ol><li>Mở Gemini, dán câu lệnh mẫu bên dưới và thay phần [mô tả tình huống].</li><li>Gemini trả về manifest Kubernetes (YAML).</li><li>Mở <a href="./#/import">CloudLab Kubernetes → Dán template</a>, dán YAML, bấm “Mở trong sandbox”. Bấm ▶ Chạy để thấy pod khởi động, traffic, lỗi và chi phí; tab Vấn đề liệt kê cấu hình rủi ro.</li></ol>
<h3>Câu lệnh mẫu</h3>${pre(PROMPT,true)}
<h3>Trợ lý AI trong trình duyệt (WebMCP)</h3><p>Khi trình duyệt hỗ trợ <a href="https://github.com/webmachinelearning/webmcp">WebMCP</a>, trang tự đăng ký 16 công cụ để trợ lý AI đọc và thao tác trực tiếp: đọc trạng thái cluster, mở bài, mở manifest (<code>load_template</code>), thêm, nối, đổi trường, chạy mô phỏng (<code>run_simulation</code>), kiểm tra bài và xuất manifest cho <code>kubectl apply</code>. Không cần cài thêm gì.</p>
<h3>Định dạng manifest CloudLab đọc được</h3><ul>${FORMAT.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>
<p><b>Kind được hỗ trợ:</b></p><ul>${kinds.map(t=>`<li><code>${esc(t.type)}</code> <span class="mut">${esc(API[t.type]||"")}</span></li>`).join("")}</ul>
<p><b>Tài liệu chỉ cho mô phỏng</b> (<code>apiVersion: cloudlab.dev/v1</code>):</p><ul>${clDocs.map(t=>`<li><code>${esc(t.type.slice(10))}</code> (${esc(t.label)}): ${esc(fieldKeys(t).join(", "))}</li>`).join("")}</ul>
<p><b>Image có trong registry giả lập:</b></p><ul>${imgs.map(x=>`<li><code>${esc(x[0])}</code>${esc(imgLine(x).slice(x[0].length))}</li>`).join("")}</ul>
<h3>Ví dụ hoàn chỉnh</h3>${pre(EXAMPLE)}</section>
${LESSONS.map(l=>`<article id="${l.id}"><h2>Bài ${l.step}: ${esc(l.title)}</h2><p class="mut">${esc(l.phase)} · ${esc(l.tag)}</p>
<p><b>Mục tiêu:</b> ${esc(l.goal)}</p><p><b>Tình huống:</b> ${esc(l.scenario)}</p>${bankHtml(l.bank)}
<h3>Nhiệm vụ</h3><ol>${l.tasks.map(t=>`<li>${esc(t.t)} <span class="mut">(${esc(t.c)})</span></li>`).join("")}</ol>
<h3>Các khối trong cluster</h3><ul>${Object.entries(l.explain||{}).map(([k,v])=>`<li><b>${esc(k)}</b>: ${esc(v)}</li>`).join("")}</ul>
<p><b>Khái niệm:</b> ${esc((l.concepts||[]).join(", "))}</p><p><b>Sau khi đạt:</b> ${esc(l.pass||"")}</p>${l.reading?`<details><summary>Đọc thêm: ${esc(l.reading.title)}</summary>${l.reading.html}</details>`:""}
<p><a href="./#/lesson/${l.id}">Mở bài này trong CloudLab Kubernetes →</a></p></article>`).join("\n")}
<section id="components"><h2>Kind Kubernetes, giải thích bằng ví dụ ngân hàng</h2>${[...kinds,...clDocs].map(t=>`<h3 id="c-${t.type.replace(/:+/g,"-")}">${esc(t.label)} <span class="mut">${esc(t.type.startsWith("CloudLab::")?"cloudlab.dev/v1 · "+t.type.slice(10):t.type)}</span></h3><p>${esc(K8S_ELI5[t.type]||"")}</p><p class="mut">${esc(t.doc||"")}</p>`).join("")}</section>
<p class="mut">© ${new Date().getFullYear()} Nguyen Quoc Dat · Kubernetes® là nhãn hiệu đã đăng ký của The Linux Foundation; không liên kết với The Linux Foundation hay CNCF · <a href="../credits.html">Nguồn và bản quyền</a></p></main></body></html>`;
const out=path.join(root,"k8s");
fs.writeFileSync(path.join(out,"llms.txt"),idx);fs.writeFileSync(path.join(out,"llms-full.txt"),full);fs.writeFileSync(path.join(out,"learn.html"),html);
console.log(`k8s/llms.txt ${idx.length} · llms-full.txt ${full.length} · learn.html ${html.length} bytes · ${LESSONS.length} lessons · ${kinds.length+clDocs.length} kinds`);
