/* Generates plain, crawlable versions of CloudLab's content for LLM readers (Gemini, etc.) and search engines:
   llms.txt (index), llms-full.txt (every lesson, component ELI5) and learn.html (same content as static HTML).
   The app itself renders with JavaScript, so a fetch-based reader would otherwise see an empty page.
   Run: node tools/export-text.js   (no dependencies; build.py runs it too) */
const fs=require("fs"),path=require("path"),vm=require("vm");
const root=path.join(__dirname,"..");
const noop=()=>{},el=()=>({addEventListener:noop,querySelector:()=>null,querySelectorAll:()=>[],classList:{add:noop,remove:noop,toggle:noop},style:{setProperty:noop},setAttribute:noop,appendChild:noop});
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,
  window:{addEventListener:noop,innerWidth:1440,innerHeight:900},localStorage:{getItem:()=>null,setItem:noop},
  document:{addEventListener:noop,getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],createElement:el,body:el(),documentElement:el()}};
ctx.window.document=ctx.document;vm.createContext(ctx);
const files=["vendor/js-yaml.min.js","src/core.js","src/catalog.js","src/model.js","src/infra.js","src/org.js","src/eli5.js","src/iam.js","src/sim.js","src/lessons.js","src/lessons-org.js","src/bank.js"];
vm.runInContext(files.map(f=>fs.readFileSync(path.join(root,f),"utf8").replace(/^"use strict";/,"")).join("\n;\n")+"\n;globalThis.__X={LESSONS,T,GROUPS,ELI5,STARTERS,LZ_SRC};",ctx);
const {LESSONS,T,GROUPS,ELI5,STARTERS,LZ_SRC}=ctx.__X;
const SITE="https://dat-2k2.github.io/cloudlab/";
const strip=h=>String(h||"").replace(/<\/(p|li|h4|tr)>/g,"\n").replace(/<br\s*\/?>/g,"\n").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/[ \t]+/g," ").replace(/\n\s+/g,"\n").trim();
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const phases=[...new Set(LESSONS.map(l=>l.phase))];
const intro=`CloudLab là IDE hạ tầng AWS chạy trong trình duyệt, dành cho người học (kể cả người không chuyên kỹ thuật, ví dụ nhân viên ngân hàng). Người học kéo thả thành phần AWS hoặc viết CloudFormation YAML, chạy mô phỏng để thử kết nối, security group, quyền IAM và chi phí, rồi xuất ra CloudFormation, Terraform hoặc CDK. Bài học là template có lỗi cài sẵn; người học sửa rồi bấm Check. Mô phỏng chạy hoàn toàn trong trình duyệt, không gọi AWS thật; giá là giá tham khảo.`;
/* ---- llms.txt: short index per the llms.txt convention */
let idx=`# CloudLab\n\n> ${intro}\n\nỨng dụng: ${SITE}\nToàn bộ nội dung dạng văn bản: ${SITE}llms-full.txt · bản HTML tĩnh: ${SITE}learn.html\n`;
for(const ph of phases){idx+=`\n## ${ph}\n\n`;for(const l of LESSONS.filter(x=>x.phase===ph))idx+=`- [Bài ${l.step}: ${l.title}](${SITE}learn.html#${l.id}): ${l.goal}\n`}
idx+=`\n## Thành phần\n\n- [Giải thích từng thành phần AWS bằng ví dụ ngân hàng](${SITE}learn.html#components)\n\n## Nguồn và bản quyền\n\n- [Bản quyền, nhãn hiệu, nguồn tham khảo](${SITE}credits.html)\n`;
/* ---- full text */
const lessonMd=l=>{let s=`## Bài ${l.step}: ${l.title}\n\nNhóm: ${l.phase} · Chủ đề: ${l.tag}${l.lab?` · Theo FCAJ workshop ${l.lab} (https://${l.lab.split(" · ")[0]}.awsstudygroup.com/)`:""}\n\n**Mục tiêu:** ${l.goal}\n\n**Tình huống:** ${l.scenario}\n\n`;
  if(l.bank){s+=`**Trong ngân hàng:** ${l.bank.why||""}\n`;(l.bank.cases||[]).forEach(c=>s+=`- ${c.t}${c.url?` (${c.url})`:""}\n`);if(l.bank.rule)s+=`- Quy định: ${l.bank.rule.t}${l.bank.rule.url?` (${l.bank.rule.url})`:""}\n`;if(l.bank.q)s+=`- Câu hỏi thảo luận: ${l.bank.q}\n`;s+="\n"}
  s+=`**Nhiệm vụ:**\n${l.tasks.map((t,i)=>`${i+1}. ${t.t} (${t.c})`).join("\n")}\n\n**Các khối trong template:**\n${Object.entries(l.explain||{}).map(([k,v])=>`- ${k}: ${v}`).join("\n")}\n\n**Khái niệm:** ${l.concepts.join(", ")}\n\n**Gợi ý:** ${l.hints().join(" ")}\n\n**Sau khi đạt:** ${l.pass}\n\n`;
  if(l.reading)s+=`**Đọc thêm (${l.reading.title}):**\n${strip(l.reading.html)}\n\n`;return s};
const comps=Object.values(T).filter(t=>!t.edge||ELI5[t.type]);
let full=`# CloudLab: toàn bộ nội dung\n\n${intro}\n\nỨng dụng: ${SITE}\n\n`+LESSONS.map(lessonMd).join("")+`## Thành phần AWS (giải thích bằng ví dụ ngân hàng)\n\n`+comps.map(t=>`### ${t.label} (${t.type})\n\n${ELI5[t.type]||""}\n\n${t.doc||""}\n`).join("\n");
/* ---- static HTML with the same content */
const html=`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CloudLab · Nội dung bài học</title><meta name="description" content="${esc(intro)}"><link rel="canonical" href="${SITE}learn.html"><link rel="alternate" type="text/markdown" href="llms-full.txt">
<script type="application/ld+json">${JSON.stringify({"@context":"https://schema.org","@type":"Course",name:"CloudLab",description:intro,inLanguage:"vi",url:SITE,provider:{"@type":"Person",name:"Nguyen Quoc Dat",url:"https://dat-2k2.github.io/"},
  hasPart:LESSONS.map(l=>({"@type":"LearningResource",name:`Bài ${l.step}: ${l.title}`,description:l.goal,url:`${SITE}learn.html#${l.id}`,teaches:l.concepts.join(", ")}))})}</script>
<style>:root{color-scheme:light dark;--bg:#fff;--fg:#111827;--mut:#4b5563;--line:#e5e7eb;--acc:#4f46e5}@media (prefers-color-scheme:dark){:root{--bg:#0b0d12;--fg:#e5e7eb;--mut:#9ca3af;--line:#1f2937;--acc:#818cf8}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:24px 16px 64px}a{color:var(--acc)}h2{margin-top:40px;padding-top:16px;border-top:1px solid var(--line)}h3{margin-top:24px}.mut{color:var(--mut)}li{margin:4px 0}table{border-collapse:collapse;width:100%}td,th{border-top:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}</style></head>
<body><main><p><a href="./">← Mở CloudLab</a></p><h1>CloudLab · Nội dung bài học</h1><p>${esc(intro)}</p>
<nav aria-label="Mục lục"><ul>${LESSONS.map(l=>`<li><a href="#${l.id}">Bài ${l.step}: ${esc(l.title)}</a></li>`).join("")}<li><a href="#components">Thành phần AWS</a></li></ul></nav>
${LESSONS.map(l=>`<article id="${l.id}"><h2>Bài ${l.step}: ${esc(l.title)}</h2><p class="mut">${esc(l.phase)} · ${esc(l.tag)}${l.lab?` · FCAJ workshop ${l.lab.split(" · ").map(x=>`<a href="https://${x}.awsstudygroup.com/">${x}</a>`).join(", ")}`:""}</p>
<p><b>Mục tiêu:</b> ${esc(l.goal)}</p><p><b>Tình huống:</b> ${esc(l.scenario)}</p>
${l.bank?`<h3>Trong ngân hàng</h3><p>${esc(l.bank.why||"")}</p><ul>${(l.bank.cases||[]).map(c=>`<li>${esc(c.t)}${c.url?` <a href="${esc(c.url)}">nguồn</a>`:""}</li>`).join("")}${l.bank.rule?`<li>Quy định: ${esc(l.bank.rule.t)}${l.bank.rule.url?` <a href="${esc(l.bank.rule.url)}">nguồn</a>`:""}</li>`:""}</ul>${l.bank.q?`<p><b>Câu hỏi thảo luận:</b> ${esc(l.bank.q)}</p>`:""}`:""}
<h3>Nhiệm vụ</h3><ol>${l.tasks.map(t=>`<li>${esc(t.t)} <span class="mut">(${esc(t.c)})</span></li>`).join("")}</ol>
<h3>Các khối trong template</h3><ul>${Object.entries(l.explain||{}).map(([k,v])=>`<li><b>${esc(k)}</b>: ${esc(v)}</li>`).join("")}</ul>
<p><b>Khái niệm:</b> ${esc(l.concepts.join(", "))}</p><p><b>Sau khi đạt:</b> ${esc(l.pass)}</p>${l.reading?`<details><summary>Đọc thêm: ${esc(l.reading.title)}</summary>${l.reading.html}</details>`:""}
<p><a href="./#/lesson/${l.id}">Mở bài này trong CloudLab →</a></p></article>`).join("\n")}
<section id="components"><h2>Thành phần AWS, giải thích bằng ví dụ ngân hàng</h2>${comps.map(t=>`<h3 id="c-${t.type.replace(/:+/g,"-")}">${esc(t.label)} <span class="mut">${esc(t.type)}</span></h3><p>${esc(ELI5[t.type]||"")}</p><p class="mut">${esc(t.doc||"")}</p>`).join("")}</section>
<p class="mut">© ${new Date().getFullYear()} Nguyen Quoc Dat · không liên kết với AWS · <a href="credits.html">Nguồn và bản quyền</a></p></main></body></html>`;
/* ---- credits.html: copyright, trademarks and the sources CloudLab draws on */
const labs=[...new Set(LESSONS.flatMap(l=>l.lab?l.lab.split(" · "):[]))];
const bankSrc=[...new Map(LESSONS.flatMap(l=>l.bank?[...(l.bank.cases||[]),...(l.bank.rule?[l.bank.rule]:[])]:[]).filter(c=>c.url).map(c=>[c.url,c])).values()];
const YEAR=new Date().getFullYear();
const credits=`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CloudLab · Nguồn và bản quyền</title><meta name="description" content="Bản quyền, nhãn hiệu và các nguồn tham khảo của CloudLab."><link rel="canonical" href="${SITE}credits.html">
<style>:root{color-scheme:light dark;--bg:#fff;--fg:#111827;--mut:#4b5563;--line:#e5e7eb;--acc:#4f46e5}@media (prefers-color-scheme:dark){:root{--bg:#0b0d12;--fg:#e5e7eb;--mut:#9ca3af;--line:#1f2937;--acc:#818cf8}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:24px 16px 64px}a{color:var(--acc)}h2{margin-top:36px;padding-top:14px;border-top:1px solid var(--line);font-size:20px}.mut{color:var(--mut)}li{margin:4px 0}</style></head>
<body><main><p><a href="./">← Mở CloudLab</a></p><h1>Nguồn và bản quyền</h1>
<h2>Bản quyền</h2><p>© ${YEAR} Nguyen Quoc Dat. Mã nguồn, mô phỏng và nội dung bài học của CloudLab do tác giả viết, trừ những phần ghi nguồn bên dưới.</p>
<h2>Nhãn hiệu, không liên kết</h2><p>Amazon Web Services, AWS và tên các dịch vụ AWS (EC2, S3, Lambda, CloudFormation, CDK, Control Tower, Organizations, …) là nhãn hiệu của Amazon.com, Inc. hoặc công ty liên kết. Terraform là nhãn hiệu của HashiCorp. CloudLab là dự án học tập cá nhân, không liên kết, không được AWS, HashiCorp hay AWS Study Group bảo trợ hoặc xác nhận.</p>
<h2>Nội dung tham khảo</h2><ul>
<li><b>First Cloud AI Journey / First Cloud Journey</b> của AWS Study Group (<a href="https://cloudjourney.awsstudygroup.com/">cloudjourney.awsstudygroup.com</a>): thứ tự bài, số workshop, tên và dải IP trong các bài theo FCAJ. Bài tập trong CloudLab được viết mới để luyện cùng chủ đề, không sao chép nội dung workshop. Workshop gốc: ${labs.map(x=>`<a href="https://${x}.awsstudygroup.com/">${x}</a>`).join(", ")}.</li>
<li><b>Tài liệu và bảng giá AWS</b> (<a href="https://docs.aws.amazon.com/">docs.aws.amazon.com</a>, <a href="https://aws.amazon.com/pricing/">aws.amazon.com/pricing</a>): hành vi dịch vụ và giá tham khảo (ap-southeast-2, một số theo us-east-1). Giá trong mô phỏng có thể đã cũ.</li>
<li><b>Bài landing zone</b> (chuyển từ <a href="https://dat-2k2.github.io/landing-zone-sim/">Brownfield rollout simulator</a>): nguyên tắc và case tóm tắt từ ${LZ_SRC.map(([t,u])=>`<a href="${u}">${esc(t)}</a>`).join("; ")}.</li>
${bankSrc.length?`<li><b>Bối cảnh ngân hàng</b> trong từng bài: ${bankSrc.map(c=>`<a href="${esc(c.url)}">${esc(c.t.length>90?c.t.slice(0,88)+"…":c.t)}</a>`).join("; ")}.</li>`:""}
</ul>
<h2>Phần mềm mã nguồn mở</h2><ul>
<li><a href="https://github.com/nodeca/js-yaml">js-yaml</a> 4.1.0, © Vitaly Puzrin, giấy phép MIT.</li>
<li>Font <a href="https://vercel.com/font">Geist và Geist Mono</a>, © Vercel, giấy phép SIL Open Font License 1.1 (<a href="fonts/OFL.txt">OFL.txt</a>).</li></ul>
<h2>Miễn trừ</h2><p>CloudLab là mô phỏng để học: hành vi dịch vụ, quyền và giá được đơn giản hóa, không gọi AWS thật. Quy định và sự cố được dẫn để minh họa; đối chiếu văn bản gốc trước khi dùng cho công việc thật. Nội dung không phải tư vấn pháp lý, tuân thủ hay tài chính.</p>
</main></body></html>`;
fs.writeFileSync(path.join(root,"credits.html"),credits);
fs.writeFileSync(path.join(root,"llms.txt"),idx);fs.writeFileSync(path.join(root,"llms-full.txt"),full);fs.writeFileSync(path.join(root,"learn.html"),html);
console.log(`llms.txt ${idx.length} · llms-full.txt ${full.length} · learn.html ${html.length} bytes · ${LESSONS.length} lessons · ${comps.length} components`);
