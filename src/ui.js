"use strict";
const LW_DEF=380,LW_MIN=300;   /* right panel width: default and minimum (px) */
/* UI: shell (kit layout), palette + templates sidebar, stack bar, canvas / YAML, simulation bar with live cost meter,
   inspector drawer (properties, explanation, runtime), lesson pane, modals, events, boot. */
const KIT=window.Kit||{layer:{open(){},close(){},isOpen(){return false},top(){return null}},isNarrow(){return false}};
const L_=()=>UI.mode==="lesson"?LESSONS[UI.lesson]:null;
const CATN={ext:"Bên ngoài",notify:"Tích hợp",comp:"Compute",store:"Lưu trữ",sec:"Bảo mật",mon:"Giám sát",cost:"Chi phí",infra:"Hạ tầng"};
const REL_DOC={calls:"Client gửi request (HTTP hoặc S3 API) tới tài nguyên này.",uploads:"Mỗi file là một s3:PutObject vào bucket.",invokes:"Gọi Lambda: API gọi đồng bộ (chờ kết quả), S3 / lịch gọi bất đồng bộ.",
  delivers:"Topic đẩy mỗi message tới subscription này. Email cần được xác nhận.",notifies:"Khi vượt ngưỡng / chuyển ALARM, publish một message vào topic.",uses:"Code của Lambda dùng tài nguyên này qua biến môi trường. Role phải cho phép thao tác tương ứng.",
  assumes:"Mượn quyền của role (Lambda khi chạy, hoặc người qua STS AssumeRole).",grants:"Một statement trong policy của role nhắc tới tài nguyên này.",applies:"Bucket policy (resource-based) áp cho bucket này.",
  logs:"Lambda ghi log vào log group /aws/lambda/<tên>.",metrics:"Alarm đọc metric của function này.",reports:"Số liệu của tài nguyên hiển thị trên monitor.",polls:"Lambda đọc message từ queue theo lô (event source mapping)."};
/* ---------------- helpers ---------------- */
function selOf(el){if(!el||el===document.body||!el.closest)return null;if(el.id)return"#"+el.id;const box=el.closest("#drawer")?"#drawer ":el.closest("#canvas")?"#canvas ":el.closest("#lesson")?"#lesson ":el.closest("#bar")?"#bar ":el.closest("#side")?"#side ":el.closest("#simbar")?"#simbar ":"";
  const q=v=>String(v).replace(/\\/g,"\\\\").replace(/"/g,'\\"');for(const k of ["node","act","edge","ptype","lesson","log","field"]){const v=el.getAttribute&&el.getAttribute("data-"+k);if(v!=null){let s=`${box}[data-${k}="${q(v)}"]`;const a=el.getAttribute("data-arg");if(a!=null)s+=`[data-arg="${q(a)}"]`;return s}}return null}
const fmtIntr=v=>{if(v==null)return"";if(typeof v!=="object")return String(v);if(Array.isArray(v))return v.map(fmtIntr).join(", ");if("Ref" in v)return"!Ref "+v.Ref;if("Fn::GetAtt" in v)return"!GetAtt "+arr(v["Fn::GetAtt"]).join(".");if("Fn::Sub" in v)return"!Sub "+(Array.isArray(v["Fn::Sub"])?v["Fn::Sub"][0]:v["Fn::Sub"]);return JSON.stringify(v)};
const parseOne=s=>{s=s.trim();if(s.startsWith("!Ref "))return{Ref:s.slice(5).trim()};if(s.startsWith("!GetAtt "))return{"Fn::GetAtt":s.slice(8).trim().split(".")};if(s.startsWith("!Sub "))return{"Fn::Sub":s.slice(5).trim()};return s};
const parseList=s=>{const parts=String(s).split(/,(?![^{]*\})/).map(x=>x.trim()).filter(Boolean);return parts.length===1?parseOne(parts[0]):parts.map(parseOne)};
const optsOf=(types,cur)=>allNodes().filter(n=>types==="*"||types.includes(n.type)).map(n=>`<option value="${n.id}"${cur===n.id?" selected":""}>${esc(n.id)} · ${esc(n.def.label)}</option>`).join("");
const chip=(t,c)=>`<span class="chip ${c||""}">${esc(t)}</span>`;
/* ---------------- shell parts ---------------- */
/* components the palette shows, filtered by the search box */
/* search score: name/short/type beats description; 0 = no match */
function palScore(t,q){if(!q)return 1;q=q.toLowerCase().trim();const L=t.label.toLowerCase(),S=String(t.short).toLowerCase(),ty=t.type.toLowerCase();
  if(S===q||L.startsWith(q))return 4;if(L.split(/[\s()/]+/).some(w=>w.startsWith(q))||S.startsWith(q))return 3;if(L.includes(q)||ty.includes(q))return 2;return 0}
function palItems(q,flat){const all=Object.values(T).filter(t=>!t.edge),grp=g=>GROUPS.find(x=>x[0]===g)||[g,g];
  if(q&&flat){const r=all.map(t=>[t,palScore(t,q)]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]).map(x=>x[0]);return r.length?[["","Kết quả",r]]:[]}
  return GROUPS.map(([g,name])=>[g,name,all.filter(t=>t.cat===g&&palScore(t,q)>0)]).filter(x=>x[2].length)}
/* left sidebar = navigation only: the free sandbox and the lesson path. Components live in the editor's own library
   panel next to the canvas (the pattern n8n, Miro, Retool, Webflow use), not at the same level as the lessons. */
function renderSide(){let h=`<p class="side-group">Tự thực hành</p><button class="side-item" data-act="openSandbox" data-cat="learn"${UI.mode==="sandbox"?' aria-current="page"':""}><span class="side-ic" aria-hidden="true">✎</span><span class="side-label">Sandbox tự do</span></button>`;
  let ph="";LESSONS.forEach((l,i)=>{if(l.phase!==ph){ph=l.phase;h+=`<p class="side-group">${l.lab?"FCAJ ":""}${esc(ph)}</p>`}
    h+=`<button class="side-item lsn" data-lesson="${i}" data-cat="learn" title="${esc(l.title)}"${UI.mode==="lesson"&&UI.lesson===i?' aria-current="page"':""}><span class="side-ic" aria-hidden="true">${l.step}</span><span class="side-label">${esc(l.tag)}<small>${l.lab?"lab "+esc(l.lab):esc(l.sub||"")}</small></span>${DONE.has(l.id)?'<span class="side-badge chip ok">✓</span>':""}</button>`});
  h+=`<button class="side-collapse" data-shell-toggle aria-controls="side" title="Thu gọn / mở"><span aria-hidden="true">«</span><span class="side-label">Thu gọn</span></button>`;
  document.getElementById("side").innerHTML=h}
/* component library docked beside the canvas (＋ Thành phần, or the / key): search, starter templates, grouped
   components; click to add, drag onto the canvas, Enter adds the highlighted one. Stays open while you build. */
function pickerHtml(){if(!UI.picker)return"";const q=UI.picker.q||"",groups=palItems(q,true),flat=groups.flatMap(g=>g[2]);UI.picker.flat=flat.map(t=>t.type);const ai=Math.min(UI.picker.active||0,Math.max(0,flat.length-1));let i=-1;
  const tpl=q?"":`<li class="pkg" role="presentation">Bắt đầu từ mẫu</li>`+Object.entries(STARTERS).map(([k,t])=>`<li role="presentation"><button class="gopt tplopt" data-act="loadTpl" data-arg="${k}" title="${esc(t.desc)}"><span class="side-ic" aria-hidden="true">▦</span><span class="gtt"><b>${esc(t.title)}</b><small>${esc(t.tag)}</small></span></button></li>`).join("");
  return`<aside class="gpicker glib" aria-label="Thư viện thành phần"><div class="glib-h"><div><b>Thành phần</b><small>Kéo vào canvas, hoặc bấm để thêm</small></div><button class="sm ghost" data-act="picker" aria-label="Đóng thư viện thành phần" title="Đóng (Esc)">×</button></div>
    <input id="pkq" type="search" placeholder="Tìm: ec2, rds, s3, lambda…" value="${esc(q)}" autocomplete="off" aria-label="Tìm thành phần" aria-controls="pklist" aria-activedescendant="pk-${ai}">
    <ul id="pklist" role="listbox" aria-label="Thành phần">${tpl}${groups.map(([g,name,items])=>`<li class="pkg" role="presentation">${esc(name)}</li>`+items.map(t=>{i++;return`<li id="pk-${i}" role="option" aria-selected="${i===ai}" class="gopt${i===ai?" on":""}" data-ptype="${t.type}" title="${esc(t.label)}"><span class="side-ic" style="--cat:var(--c-${t.cat})" aria-hidden="true">${esc(t.short)}</span><span class="gtt"><b>${esc(t.label)}</b><small>${esc((t.doc||"").split(". ")[0])}</small></span></li>`}).join("")).join("")||`<li class="gopt bad">Không có thành phần nào khớp “${esc(q)}”. Thử tên dịch vụ, ví dụ ec2 hoặc s3.</li>`}</ul>
    <p class="cap gmf">↑↓ · Enter thêm · Esc đóng</p></aside>`}
const libPref=()=>{try{return localStorage.getItem("cloudlab:lib")}catch(_){return null}};
const libSave=open=>{try{localStorage.setItem("cloudlab:lib",open?"open":"closed")}catch(_){}};
function renderTop(){const cr=document.getElementById("crumb");if(!cr)return;const L=L_();cr.innerHTML=L?`<span class="cc">Bài ${L.step} · ${esc(L.tag)}</span> /<b>${esc(L.title)}</b>`:`<span class="cc">Sandbox</span> /<b>${esc(M.name)}</b>`}
const STK={NOT_DEPLOYED:["","chưa deploy"],CREATE_COMPLETE:["ok","CREATE_COMPLETE"],UPDATE_COMPLETE:["ok","UPDATE_COMPLETE"],DELETE_COMPLETE:["","DELETE_COMPLETE"],DELETE_FAILED:["bad","DELETE_FAILED"],ROLLBACK_COMPLETE:["bad","ROLLBACK_COMPLETE"]};
function renderBar(){const s=STK[RT.stack.status]||["",RT.stack.status],up=stackUp(),v=UI.code?(UI.split?"split":"code"):"graph";
  document.getElementById("bar").innerHTML=`<span class="stk"><span class="cap">Stack</span><b class="mono">${esc(M.name)}</b>${chip(s[1],s[0])}</span>
    ${UI.mode==="sandbox"&&!up&&Object.keys(M.res).length+Object.keys(M.ext).length?`<button class="sm ghost" data-act="askClear" title="Xóa mọi khối khỏi canvas">Xóa canvas</button>`:""}${up?`<button class="sm danger" data-act="askDelete" title="aws cloudformation delete-stack">Xóa stack</button>`:`<button class="sm primary" data-act="deploy" title="aws cloudformation deploy">Deploy</button>`}
    <span class="grow"></span><div class="seg" role="group" aria-label="Chế độ sửa"><button class="${v==="graph"?"on":""}" data-act="vMode" data-arg="graph" aria-pressed="${v==="graph"}">Canvas</button><button class="${v==="split"?"on":""} hide-s" data-act="vMode" data-arg="split" aria-pressed="${v==="split"}">Chia đôi</button><button class="${v==="code"?"on":""}" data-act="vMode" data-arg="code" aria-pressed="${v==="code"}">YAML</button></div>
    <button class="icon-btn" data-act="undo" ${UNDO.length?"":"disabled"} title="Hoàn tác (Ctrl+Z)" aria-label="Hoàn tác">↶</button><button class="icon-btn" data-act="redo" ${REDO.length?"":"disabled"} title="Làm lại (Ctrl+Y)" aria-label="Làm lại">↷</button>`}
function renderCanvas(){const el=document.getElementById("canvas");if(!el)return;el.hidden=UI.code&&!UI.split;if(!el.hidden)el.innerHTML=canvasHtml()}
let YAML_ERR=null,YAML_T=0;
function renderCode(force){const el=document.getElementById("code");if(!el)return;el.hidden=!UI.code;if(el.hidden)return;
  const ta=document.getElementById("yaml");if(ta&&document.activeElement===ta&&!force){const st=document.getElementById("ystat");if(st)st.innerHTML=ystat();return}
  const tab=UI.codeTab||"cfn",X=EXPORTS[tab],text=X.edit?toYaml():X.gen();
  el.innerHTML=`<div class="ctabs" role="tablist" aria-label="Định dạng IaC">${Object.entries(EXPORTS).map(([k,x])=>`<button role="tab" class="${k===tab?"on":""}" aria-selected="${k===tab}" data-act="codeTab" data-arg="${k}">${esc(x.label)}</button>`).join("")}</div>
    <div class="code-head"><span class="cap mono">${esc(X.file)}</span>${X.edit?`<span id="ystat">${ystat()}</span>`:`<span class="chip">chỉ đọc · sinh từ canvas</span>`}<span class="grow"></span><button class="sm" data-act="copyCode">Copy</button><button class="sm" data-act="dlCode">Tải xuống</button></div>
    ${X.edit?`<textarea id="yaml" class="yaml" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="CloudFormation template (YAML)">${esc(text)}</textarea>`:`<pre class="yaml ro" tabindex="0" aria-label="${esc(X.label)}">${esc(text)}</pre>`}
    <p class="note">${X.edit?`Sửa YAML là sửa canvas, và ngược lại. Phần mô phỏng (client, monitor, traffic) nằm ở <span class="mono">Metadata.CloudLab</span>.`:tab==="tf"?"Provider awscc dùng cùng schema với CloudFormation nên ánh xạ 1-1. Chạy terraform plan để kiểm tra trước khi apply.":tab==="cdk"?"Construct L1 (Cfn*) giữ nguyên logical ID, nên stack CDK tạo đúng template này.":"Đã bỏ Metadata.CloudLab. Nhớ thêm route table cho public subnet khi deploy thật."}</p>`}
const ystat=()=>YAML_ERR?`<span class="chip bad">Lỗi${YAML_ERR.line?" dòng "+YAML_ERR.line:""}: ${esc(YAML_ERR.err)}</span>`:`<span class="chip ok">Hợp lệ · ${Object.keys(M.res).length} tài nguyên</span>`;
function clockText(){const t=RT.t,d=Math.floor(t%MONTH/86400),h=Math.floor(t%86400/3600),m=Math.floor(t%3600/60);return`Tháng ${RT.month} · ngày ${d+1} · ${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`}
function renderSim(){const el=document.getElementById("simbar");if(!el)return;const r=rateNow();
  el.innerHTML=`<button class="${RT.running?"":"primary "}play" data-act="simToggle" aria-pressed="${!!RT.running}" title="${RT.running?"Tạm dừng":"Chạy mô phỏng"}">${RT.running?"❚❚ Tạm dừng":"▶ Chạy"}</button>
    <label class="spd"><span class="cap hide-s">Tốc độ</span><select id="speed" aria-label="Tốc độ mô phỏng">${SPEEDS.map(([l],i)=>`<option value="${i}"${i===UI.speed?" selected":""}>${l}</option>`).join("")}</select></label>
    <span class="meter" role="status" aria-label="Chi phí tháng này ${money(RT.total)}"><span class="cap">Chi phí · ${clockText()}</span><b class="mono">${money(RT.total)}</b><small class="mono">${r>0?`≈ ${money(r)}/giờ · ${money(r*720)}/tháng`:"không có gì đang tính tiền"}</small></span>
    <span class="grow"></span><button class="sm" data-act="simReset" title="Đặt lại thời gian, chi phí và dữ liệu mô phỏng">⟲<span class="hide-s"> Đặt lại</span></button>
    ${(()=>{const pr=problems(),e=pr.filter(x=>x.sev==="error").length,w=pr.filter(x=>x.sev==="warn").length;return`<button class="sm${UI.panel==="problems"?" on":""}" data-act="panel" data-arg="problems" aria-expanded="${UI.panel==="problems"}">Vấn đề <span class="chip ${e?"bad":w?"warn":"ok"}">${e||w||0}</span></button>`})()}
    <button class="sm${UI.panel==="log"?" on":""}" data-act="panel" data-arg="log" aria-expanded="${UI.panel==="log"}">Event log <span class="chip">${LOG.length}</span></button>`}
function renderLog(){const el=document.getElementById("log");if(!el)return;el.hidden=!UI.panel;if(el.hidden)return;
  if(UI.panel==="problems"){const pr=problems(),ic={error:"✕",warn:"!",info:"i"};el.classList.add("probs");el.innerHTML=pr.length?`<ul class="plist">${pr.map(x=>`<li><button class="prob ${x.sev}" data-act="selNode" data-arg="${esc(x.id)}"><span class="pi" aria-hidden="true">${ic[x.sev]}</span><span class="pm">${esc(x.msg)}</span><span class="pid mono">${esc(x.id)}</span></button></li>`).join("")}</ul>`:`<div class="empty">Không có vấn đề nào. Template chưa có lỗi cấu hình hay rủi ro nào CloudLab nhận ra.</div>`;return}
  el.classList.remove("probs");const sel=LOG.find(l=>l.id===UI.logSel)||LOG.find(l=>l.cli)||LOG[0];
  const kk=l=>l.kind==="API"||l.kind==="CLI"?"api":l.kind==="Sự kiện"?"evt":"les";
  el.innerHTML=`<div class="logl"><ul class="log">${LOG.slice(0,120).map(l=>`<li class="${l.id===(sel&&sel.id)?"sel":""}" data-log="${l.id}" tabindex="0"><span class="t">${l.t}</span><span class="ev ${l.tone}"><span class="k k-${kk(l)}">${esc(l.kind)}</span> ${esc(l.svc)} · ${esc(l.op)}</span><span class="m">${esc(l.msg)}</span></li>`).join("")}</ul></div>
    <div class="console"><div class="bar3"><i></i><i></i><i></i><span>aws CLI</span></div>${sel&&sel.cli?`<pre id="clitext"><span class="ps">$ </span>${esc(sel.cli)}</pre>`:`<pre class="dim"># Dòng này không có lệnh aws CLI tương đương</pre>`}</div>`}
function renderLesson(){const el=document.getElementById("lesson"),L=L_();
  if(!L){el.innerHTML=lessonBar()+`<div><span class="cap eyebrow">Sandbox</span><h1>Dựng hạ tầng tự do</h1><p class="goal">Kéo thành phần AWS từ thanh bên vào canvas, nối các khối bằng chấm bên phải mỗi khối, hoặc viết CloudFormation YAML. Rồi bấm ▶ Chạy để mô phỏng traffic và xem chi phí.</p></div>
    <div class="sect"><span class="lab">Nguồn tạo tải</span><p class="note">Client (request mỗi giây), Uploader (file mỗi giờ) và EventBridge schedule là nơi sự kiện bắt đầu. Hộp thư và Monitor nhận kết quả.</p></div>
    <div class="sect"><span class="lab">Bắt đầu từ</span><div class="acts">${Object.entries(STARTERS).map(([k,t])=>`<button class="sm" data-act="loadTpl" data-arg="${k}">${esc(t.title)}</button>`).join("")}<button class="sm" data-act="askClear">Canvas trống</button></div>${LESSONS.map((l,i)=>`<button class="tplrow" data-act="copyLesson" data-arg="${i}"><b>${esc(l.tag)}</b><small>${esc(l.title)}</small></button>`).join("")}<p class="note">Mở template của một bài vào sandbox (không chấm điểm).</p></div>`;return}
  const R=UI.result,hs=L.hints(),passed=R?R.res.filter(Boolean).length:0,nT=L.tasks.length;
  /* three tiers: 1 what to do (goal, tasks, actions) · 2 why it matters (scenario, banking context) · 3 reference, collapsed */
  const lab=L.lab?`Theo FCAJ workshop ${L.lab.split(" · ").map(x=>`<a href="https://${x}.awsstudygroup.com/" target="_blank" rel="noopener">${x} ↗</a>`).join(" · ")}`:"";
  let h=lessonBar()+`<section class="ltier main" aria-label="Việc cần làm"><div><span class="cap eyebrow">${esc(L.phase||"FCAJ")} · Bài ${L.step}</span><h1>${esc(L.title)}</h1><p class="goal">${esc(L.goal)}</p></div>
  <div class="sect"><div class="th"><span class="lab">Nhiệm vụ</span><span class="cnt">${passed}/${nT}</span><span class="pbar"><i style="width:${passed/nT*100}%"></i></span></div>${L.tasks.map((t,i)=>{const c=R?(R.res[i]?"pass":"fail"):"";return`<div class="task ${c}"><span class="tm2">${R?(R.res[i]?"✓":"✕"):i+1}</span><div><b>${esc(t.t)}</b>${R&&R.res[i]?`<small>${esc(t.c)}</small>`:""}</div></div>`}).join("")}
  ${R&&UI.dirty?`<span class="chip warn dirty">Đã sửa · bấm Kiểm tra lại</span>`:""}</div>`;
  if(R)h+=`<div class="callout ${R.ok?"ok":R.skipped?"ctx":""}"><b>${R.ok?"Đạt":R.skipped?"Đã làm hộ":`Chưa đạt · lần ${UI.attempt}`}</b>${esc(R.msg)}</div>`;
  if(UI.hints)h+=hs.slice(0,UI.hints).map((x,i)=>`<div class="callout warn"><b>Gợi ý ${i+1}/${hs.length}</b>${esc(x)}</div>`).join("");
  if(R&&R.ok&&!R.skipped){const nx=UI.lesson+1<LESSONS.length;h+=`<div class="lacts">${nx?`<button class="primary" data-lesson="${UI.lesson+1}">Bài tiếp: ${esc(LESSONS[UI.lesson+1].tag)} →</button>`:`<button class="primary" data-act="openSandbox">Ra sandbox tự do →</button>`}</div>`}
  else h+=`<div class="lacts"><button class="primary" data-act="check">Kiểm tra</button><button data-act="hint" ${UI.hints>=hs.length?"disabled":""}>Gợi ý ${UI.hints}/${hs.length}</button><button class="ghost" data-act="askSkip">Làm hộ</button><button class="ghost" data-act="askReset" title="Bắt đầu lại bài này từ đầu">Từ đầu</button></div>`;
  h+=`</section><section class="ltier why" aria-label="Bối cảnh"><span class="lab">Bối cảnh</span>
  <div class="scn2"><span class="av" aria-hidden="true">${L.who[0]}</span><div><p>“${esc(L.scenario)}”</p><small class="muted">${esc(L.who[1])}</small></div></div>
  ${L.bank?`<div class="callout ctx bank"><b>Trong ngân hàng</b>${L.bank.why?`<p>${esc(L.bank.why)}</p>`:""}${(L.bank.cases||[]).length?`<ul>${L.bank.cases.map(c=>`<li>${esc(c.t)}${c.url?` <a href="${esc(c.url)}" target="_blank" rel="noopener">nguồn ↗</a>`:""}</li>`).join("")}</ul>`:""}${L.bank.rule?`<p class="rule">${esc(L.bank.rule.t)}${L.bank.rule.url?` <a href="${esc(L.bank.rule.url)}" target="_blank" rel="noopener">nguồn ↗</a>`:""}</p>`:""}${L.bank.q?`<p class="q"><b>Câu hỏi thảo luận:</b> ${esc(L.bank.q)}</p>`:""}</div>`:""}
  </section>
  <section class="ltier ref" aria-label="Tham khảo"><span class="lab">Tham khảo</span>
  <details class="more"><summary>Trong template này (${Object.keys(L.explain||{}).filter(id=>nodeOf(id)).length} khối)</summary><div class="comps">${Object.keys(L.explain||{}).filter(id=>nodeOf(id)).map(id=>{const n=nodeOf(id);return`<button class="comp${UI.sel&&UI.sel.node===id?" on":""}" data-act="selNode" data-arg="${id}" title="${esc(L.explain[id])}"><span class="side-ic" style="--cat:var(--c-${n.def.cat})" aria-hidden="true">${esc(n.def.short)}</span>${esc(id)}</button>`}).join("")}</div><button class="link" data-act="tour">${UI.tour>=0?"Dừng giới thiệu":"Giới thiệu từng khối →"}</button></details>
  <details class="more"><summary>Khái niệm (${L.concepts.length})</summary><div class="tags">${L.concepts.map(c=>`<span class="tag">${esc(c)}</span>`).join("")}</div></details>`+(L.reading?`<details class="more reading"><summary>Đọc thêm: ${esc(L.reading.title)}</summary><div class="reading-body">${L.reading.html}</div></details>`:"")+
  `${lab||L.ref?`<p class="labref">${lab}${L.ref?(lab?" · ":"")+L.ref:""}</p>`:""}
  <div class="lh"><span class="lab">Lộ trình</span><div class="ldots">${LESSONS.map((x,i)=>`<button class="ldot${DONE.has(x.id)?" done":""}${i===UI.lesson?" cur":""}" data-lesson="${i}" aria-label="Bài ${x.step}: ${esc(x.title)}${DONE.has(x.id)?" (đã đạt)":""}"><span>${x.step}</span></button>`).join("")}</div></div></section>`;
  el.innerHTML=h}
/* ---------------- inspector: fields ---------------- */
function fieldHtml(n,f){const id=n.id,p=n.props,k=f.k;if(f.when&&!f.when(p))return"";
  const val=k.startsWith("@@")?n.raw[k.slice(2)]:k.startsWith("@")?getP(n.raw,"Metadata.CloudLab."+k.slice(1)):getP(p,k);
  const lab=`<span class="fl">${esc(f.label)}</span>`,help=f.help?`<small>${esc(f.help)}</small>`:"",da=`data-field="${esc(k)}" data-fid="${id}"`;
  const opt=(o,cur)=>{const[v,l]=Array.isArray(o)?o:[o,o];return`<option value="${esc(v)}"${String(cur??"")===String(v)?" selected":""}>${esc(l)}</option>`};
  switch(f.type){
    case"text":return`<label class="fld">${lab}<input ${da} data-ftype="text" value="${esc(typeof val==="object"?fmtIntr(val):val??"")}">${help}</label>`;
    case"number":return`<label class="fld">${lab}<input ${da} data-ftype="number" type="number" ${f.min!=null?`min="${f.min}"`:""} ${f.max!=null?`max="${f.max}"`:""} step="${f.step||1}" value="${esc(val??"")}">${help}</label>`;
    case"select":return`<label class="fld">${lab}<select ${da} data-ftype="${f.num?"selnum":f.bool?"selbool":"select"}">${(k==="@@DeletionPolicy"?["Delete","Retain"]:f.options).map(o=>opt(o,val??(k==="@@DeletionPolicy"?"Delete":""))).join("")}</select>${help}</label>`;
    case"ref":{const cur=refId(val);return`<label class="fld">${lab}<select ${da} data-ftype="ref" data-att="${f.att||""}" data-dim="${f.dim?1:""}"><option value="">— không —</option>${optsOf(f.to,cur)}</select>${help}</label>`}
    case"refs":{const cur=arr(val).map(v=>refId(v)||v);const c=allNodes().filter(x=>x.id!==id&&(f.to==="*"||f.to.includes(x.type)));return`<fieldset class="fld" ${da} data-ftype="refs" data-att="${f.att||""}"><legend>${esc(f.label)}</legend>${c.map(x=>`<label class="ck"><input type="checkbox" value="${x.id}"${cur.includes(x.id)?" checked":""}> ${esc(x.id)}</label>`).join("")||'<small>Canvas chưa có khối phù hợp.</small>'}${help}</fieldset>`}
    case"env":{const o=val||{};return`<fieldset class="fld" ${da} data-ftype="env"><legend>${esc(f.label)}</legend>${Object.entries(o).map(([kk,vv])=>envRow(kk,vv)).join("")}<button class="sm" data-act="envAdd" data-arg="${id}">+ Biến</button>${help}</fieldset>`}
    case"bpa":{const c=val||{};return`<fieldset class="fld" ${da} data-ftype="bpa"><legend>${esc(f.label)}</legend>${["BlockPublicAcls","IgnorePublicAcls","BlockPublicPolicy","RestrictPublicBuckets"].map(x=>`<label class="ck"><input type="checkbox" value="${x}"${c[x]?" checked":""}> ${x}</label>`).join("")}</fieldset>`}
    case"notifs":{const L=arr(val);return`<fieldset class="fld" ${da} data-ftype="notifs"><legend>${esc(f.label)}</legend>${L.map(c=>{const rules=arr(getP(c,"Filter.S3Key.Rules")),pre=(rules.find(r=>/prefix/i.test(r.Name))||{}).Value||"",suf=(rules.find(r=>/suffix/i.test(r.Name))||{}).Value||"";
      return`<div class="frow"><select data-k="fn" aria-label="Lambda"><option value="">— Lambda —</option>${optsOf(["AWS::Lambda::Function"],refId(c.Function))}</select><input data-k="pre" placeholder="prefix" value="${esc(pre)}" aria-label="prefix"><input data-k="suf" placeholder="suffix" value="${esc(suf)}" aria-label="suffix"><button class="sm danger" data-act="rowDel" aria-label="Xóa">✕</button></div>`}).join("")}<button class="sm" data-act="rowAdd" data-arg="notifs">+ Trigger</button><small>Để trống thì mọi object mới đều gọi Lambda. Ví dụ: prefix incoming/, suffix .jpg.</small></fieldset>`}
    case"subs":{const L=arr(val);return`<fieldset class="fld" ${da} data-ftype="subs"><legend>${esc(f.label)}</legend>${L.map(s=>{const st=s&&s.Protocol==="email"?RT.subs[id+"|"+s.Endpoint]:null;return`<div class="frow"><select data-k="proto" aria-label="Protocol">${["email","lambda","sqs"].map(x=>opt(x,s.Protocol)).join("")}</select>${s.Protocol==="email"?`<input data-k="ep" value="${esc(s.Endpoint)}" aria-label="Email">`:`<select data-k="epref" aria-label="Endpoint">${optsOf(s.Protocol==="lambda"?["AWS::Lambda::Function"]:["AWS::SQS::Queue"],refId(s.Endpoint))}</select>`}${st?chip(st==="Confirmed"?"Confirmed":"Pending",st==="Confirmed"?"ok":"warn"):""}<button class="sm danger" data-act="rowDel" aria-label="Xóa">✕</button></div>`}).join("")}<button class="sm" data-act="rowAdd" data-arg="subs">+ Subscription</button></fieldset>`}
    case"trust":{const lam=arr(getP(p,"AssumeRolePolicyDocument.Statement")).some(s=>arr(s.Principal&&s.Principal.Service).includes("lambda.amazonaws.com"));return`<fieldset class="fld" ${da} data-ftype="trust"><legend>${esc(f.label)}</legend><label class="ck"><input type="radio" name="tr-${id}" value="lambda"${lam?" checked":""}> Lambda (execution role)</label><label class="ck"><input type="radio" name="tr-${id}" value="account"${lam?"":" checked"}> Người trong account (STS AssumeRole)</label></fieldset>`}
    case"managed":{const cur=arr(val).map(resolve);return`<fieldset class="fld" ${da} data-ftype="managed"><legend>${esc(f.label)}</legend>${Object.entries(MANAGED).map(([a,mp])=>`<label class="ck"><input type="checkbox" value="${a}"${cur.includes(a)?" checked":""}> ${mp.name}${mp.name==="AdministratorAccess"?' <span class="chip warn">quá rộng</span>':""}</label>`).join("")}</fieldset>`}
    case"policies":{const L=arr(val);return`<fieldset class="fld" ${da} data-ftype="policies"><legend>${esc(f.label)}</legend>${L.map((pol,pi)=>`<div class="pol" data-pi="${pi}"><div class="frow"><input data-k="pname" value="${esc(pol.PolicyName||"")}" aria-label="Tên policy"><button class="sm danger" data-act="polDel" aria-label="Xóa policy">✕</button></div>${arr(getP(pol,"PolicyDocument.Statement")).map(s=>stmtRow(s,false)).join("")}<button class="sm" data-act="stmtAdd">+ Statement</button></div>`).join("")}<button class="sm" data-act="polAdd">+ Inline policy</button><small>Resource viết được dạng !Sub \${Bucket.Arn}/* hoặc !GetAtt Table.Arn.</small></fieldset>`}
    case"statements":{const L=arr(val);return`<fieldset class="fld" ${da} data-ftype="statements"><legend>${esc(f.label)}</legend><div class="pol">${L.map(s=>stmtRow(s,true)).join("")}<button class="sm" data-act="stmtAdd">+ Statement</button></div></fieldset>`}
    case"thresholds":{const L=arr(val),th=L.map(x=>+getP(x,"Notification.Threshold")),sub=L.flatMap(x=>arr(x.Subscribers)).map(s=>refId(s.Address)).find(Boolean)||"";
      return`<fieldset class="fld" ${da} data-ftype="thresholds"><legend>${esc(f.label)}</legend><div class="acts">${[50,80,100].map(x=>`<label class="ck"><input type="checkbox" value="${x}"${th.includes(x)?" checked":""}> ${x}%</label>`).join("")}</div><label class="fld">Gửi tới SNS topic<select data-k="topic"><option value="">— chưa chọn —</option>${optsOf(["AWS::SNS::Topic"],sub)}</select></label></fieldset>`}
    case"tgtargets":{const cur=arr(val).map(t=>refId(t&&t.Id));return`<fieldset class="fld" ${da} data-ftype="tgtargets"><legend>${esc(f.label)}</legend>${allNodes().filter(x=>x.type==="AWS::EC2::Instance").map(x=>`<label class="ck"><input type="checkbox" value="${x.id}"${cur.includes(x.id)?" checked":""}> ${esc(x.id)}</label>`).join("")||"<small>Canvas chưa có EC2 nào.</small>"}</fieldset>`}
    case"ingress":{const L=arr(val);return`<fieldset class="fld" ${da} data-ftype="ingress"><legend>${esc(f.label)}</legend>${L.map(r=>{const src=refId(r.SourceSecurityGroupId);return`<div class="frow"><select data-k="proto" aria-label="Giao thức">${[["tcp","TCP"],["-1","Tất cả"]].map(o=>opt(o,String(r.IpProtocol))).join("")}</select><input data-k="port" value="${esc(r.FromPort===r.ToPort||r.ToPort==null?r.FromPort??"":r.FromPort+"-"+r.ToPort)}" placeholder="80" aria-label="Cổng" style="max-width:80px"><select data-k="src" aria-label="Nguồn"><option value="cidr:0.0.0.0/0"${!src&&r.CidrIp==="0.0.0.0/0"?" selected":""}>0.0.0.0/0 (Internet)</option><option value="cidr:10.0.0.0/16"${!src&&r.CidrIp==="10.0.0.0/16"?" selected":""}>10.0.0.0/16 (trong VPC)</option>${!src&&r.CidrIp&&!["0.0.0.0/0","10.0.0.0/16"].includes(r.CidrIp)?`<option value="cidr:${esc(r.CidrIp)}" selected>${esc(r.CidrIp)}</option>`:""}<option value="cidr:203.0.113.10/32">203.0.113.10/32 (IP của bạn)</option>${allNodes().filter(x=>x.type==="AWS::EC2::SecurityGroup").map(x=>`<option value="sg:${x.id}"${src===x.id?" selected":""}>SG ${esc(x.id)}</option>`).join("")}</select><button class="sm danger" data-act="rowDel" aria-label="Xóa">✕</button></div>`}).join("")}<button class="sm" data-act="rowAdd" data-arg="ingress">+ Rule</button><small>Chỉ mở đúng cổng cho đúng nguồn. Database chỉ nên mở cho security group của app.</small></fieldset>`}
    case"targets":{const cur=arr(val).map(t=>refId(t&&t.Arn));return`<fieldset class="fld" ${da} data-ftype="targets"><legend>${esc(f.label)}</legend>${allNodes().filter(x=>x.type==="AWS::Lambda::Function").map(x=>`<label class="ck"><input type="checkbox" value="${x.id}"${cur.includes(x.id)?" checked":""}> ${esc(x.id)}</label>`).join("")||"<small>Canvas chưa có Lambda nào.</small>"}</fieldset>`}}
  return""}
const envRow=(k,v)=>{const r=refId(v);return`<div class="frow"><input data-k="key" value="${esc(k)}" aria-label="Tên biến"><select data-k="mode" aria-label="Kiểu"><option value="text"${r?"":" selected"}>văn bản</option><option value="ref"${r?" selected":""}>!Ref</option></select>${r?`<select data-k="ref" aria-label="Tài nguyên">${optsOf("*",r)}</select>`:`<input data-k="val" value="${esc(v??"")}" aria-label="Giá trị">`}<button class="sm danger" data-act="rowDel" aria-label="Xóa">✕</button></div>`};
const stmtRow=(s,princ)=>`<div class="frow st"><select data-k="eff" aria-label="Effect"><option${s.Effect==="Allow"?" selected":""}>Allow</option><option${s.Effect==="Deny"?" selected":""}>Deny</option></select><input data-k="sid" value="${esc(s.Sid||"")}" placeholder="Sid" aria-label="Sid">${princ?`<input data-k="pr" value="${esc(typeof s.Principal==="string"?s.Principal:JSON.stringify(s.Principal||"*"))}" aria-label="Principal" title="Principal">`:""}<input data-k="act" value="${esc(arr(s.Action).join(", "))}" placeholder="s3:GetObject, …" aria-label="Action"><input data-k="res" value="${esc(fmtIntr(s.Resource))}" placeholder="Resource" aria-label="Resource"><button class="sm danger" data-act="rowDel" aria-label="Xóa">✕</button></div>`;
/* read a field's DOM back into a value */
function collect(fs){const t=fs.dataset.ftype,q=s=>[...fs.querySelectorAll(s)];
  switch(t){
    case"text":return fs.value;case"number":return fs.value===""?undefined:Number(fs.value);case"select":return fs.value;case"selnum":return Number(fs.value);case"selbool":return fs.value==="true";
    case"ref":return fs.value?(fs.dataset.att?{"Fn::GetAtt":[fs.value,fs.dataset.att]}:{Ref:fs.value}):null;
    case"refs":return q("input:checked").map(i=>fs.dataset.att?{"Fn::GetAtt":[i.value,fs.dataset.att]}:{Ref:i.value});
    case"tgtargets":return q("input:checked").map(i=>({Id:{Ref:i.value}}));
    case"ingress":return q(".frow").map(r=>{const p=r.querySelector('[data-k="proto"]').value,pt=r.querySelector('[data-k="port"]').value.trim()||"80",[a,b]=pt.split("-").map(Number),s=r.querySelector('[data-k="src"]').value,o={IpProtocol:p,FromPort:p==="-1"?-1:a,ToPort:p==="-1"?-1:(b||a)};if(s.startsWith("sg:"))o.SourceSecurityGroupId={"Fn::GetAtt":[s.slice(3),"GroupId"]};else o.CidrIp=s.slice(5);return o});
    case"env":{const o={};q(".frow").forEach(r=>{const k=r.querySelector('[data-k="key"]').value.trim();if(!k)return;const mode=r.querySelector('[data-k="mode"]').value,rs=r.querySelector('[data-k="ref"]'),vi=r.querySelector('[data-k="val"]');o[k]=mode==="ref"?{Ref:rs?rs.value:(allNodes()[0]||{}).id}:(vi?vi.value:"")});return o}
    case"bpa":return Object.fromEntries(["BlockPublicAcls","IgnorePublicAcls","BlockPublicPolicy","RestrictPublicBuckets"].map(k=>[k,!!fs.querySelector(`input[value="${k}"]`).checked]));
    case"notifs":return q(".frow").map(r=>{const fn=r.querySelector('[data-k="fn"]').value,pre=r.querySelector('[data-k="pre"]').value.trim(),suf=r.querySelector('[data-k="suf"]').value.trim(),c={Event:"s3:ObjectCreated:*",Function:fn?{"Fn::GetAtt":[fn,"Arn"]}:null};
      const rules=[...(pre?[{Name:"prefix",Value:pre}]:[]),...(suf?[{Name:"suffix",Value:suf}]:[])];if(rules.length)c.Filter={S3Key:{Rules:rules}};return c});
    case"subs":return q(".frow").map(r=>{const p=r.querySelector('[data-k="proto"]').value,ep=r.querySelector('[data-k="ep"]'),er=r.querySelector('[data-k="epref"]');return{Protocol:p,Endpoint:p==="email"?(ep?ep.value:EMAIL):(er&&er.value?{"Fn::GetAtt":[er.value,"Arn"]}:null)}});
    case"trust":{const v=(fs.querySelector("input:checked")||{}).value;return{Version:"2012-10-17",Statement:[{Effect:"Allow",Principal:v==="lambda"?{Service:"lambda.amazonaws.com"}:{AWS:{"Fn::Sub":"arn:aws:iam::${AWS::AccountId}:root"}},Action:"sts:AssumeRole"}]}}
    case"managed":return q("input:checked").map(i=>i.value);
    case"policies":return q(".pol").map(pd=>({PolicyName:pd.querySelector('[data-k="pname"]').value||"inline",PolicyDocument:{Version:"2012-10-17",Statement:[...pd.querySelectorAll(".frow.st")].map(readStmt)}}));
    case"statements":return[...fs.querySelectorAll(".frow.st")].map(readStmt);
    case"thresholds":{const tp=fs.querySelector('[data-k="topic"]').value;return q('input[type="checkbox"]:checked').map(i=>({Notification:{NotificationType:"ACTUAL",ComparisonOperator:"GREATER_THAN",Threshold:+i.value},Subscribers:tp?[{SubscriptionType:"SNS",Address:{Ref:tp}}]:[]}))}
    case"targets":return q("input:checked").map(i=>({Id:i.value,Arn:{"Fn::GetAtt":[i.value,"Arn"]}}))}}
function readStmt(r){const g=k=>{const e=r.querySelector(`[data-k="${k}"]`);return e?e.value:""};const s={};if(g("sid").trim())s.Sid=g("sid").trim();s.Effect=g("eff");
  const pr=r.querySelector('[data-k="pr"]');if(pr){let v=pr.value.trim();try{v=JSON.parse(v)}catch(_){}s.Principal=v||"*"}
  const acts=g("act").split(",").map(x=>x.trim()).filter(Boolean);s.Action=acts.length===1?acts[0]:acts;s.Resource=parseList(g("res")||"*");return s}
function applyField(fs){const id=fs.dataset.fid,k=fs.dataset.field,n=nodeOf(id);if(!n)return;const v=collect(fs);
  if(fs.dataset.ftype==="number"&&v!==undefined&&!(v>=0||(k==="Threshold"))){return}
  edit(`${id}.${k.replace(/^@+/,"")}`,()=>{const nn=nodeOf(id);
    if(k.startsWith("@@")){if(v==="Delete"||!v)delete nn.raw[k.slice(2)];else nn.raw[k.slice(2)]=v}
    else if(k.startsWith("@")){nn.raw.Metadata=nn.raw.Metadata||{};nn.raw.Metadata.CloudLab=nn.raw.Metadata.CloudLab||{};nn.raw.Metadata.CloudLab[k.slice(1)]=v}
    else if(fs.dataset.dim){nn.props.Dimensions=v?[{Name:"FunctionName",Value:v}]:[]}
    else if(k==="Environment.Variables"){setP(nn.props,"Environment",{Variables:v})}
    else setP(nn.props,k,v===null&&!["Target","Role","Bucket","As"].includes(k)?undefined:v)})}
/* ---------------- inspector: runtime ---------------- */
function costRows(id){const r=RT.n[id];if(!r||!r.costBy)return"";return kvl(Object.entries(r.costBy).map(([k,v])=>["Chi phí · "+k,money(v)]))}
const kvl=rows=>`<dl class="kv-list">${rows.map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
function rtHtml(id){const n=nodeOf(id);if(!n)return"";const r=RT.n[id]||{m:{},series:[]},m=r.m,p=n.props;let h="";
  if(!exists(id)&&!n.ext)return`<div class="empty">Chưa có trên AWS (${esc(RT.stack.status)}). Bấm Deploy để tạo.</div>`;
  if(typeof orgRt==="function")h+=orgRt(n);
  switch(n.type){
    case"AWS::Lambda::Function":{const lg=RT.logs[logName(id)]||[];h+=kvl([["Lần chạy",num(m.inv||0)],["Lỗi",num(m.err||0)],["Thời gian trung bình",m.inv?Math.round((m.dur||0)/m.inv)+" ms":"—"],["GB-giây / lần",((+p.MemorySize||128)/1024*Math.ceil((r.last||{dur:0}).dur)/1000).toFixed(3)]]);
      if(r.lastErr)h+=`<div class="callout"><b>Lỗi gần nhất</b>${esc(r.lastErr)}</div>`;
      h+=`<p class="lab">Log ${esc(logName(id))}</p>`+(lg.length?`<div class="console"><div class="bar3"><i></i><i></i><i></i><span>aws logs tail ${esc(logName(id))}</span></div><div class="body">${lg.slice(-8).map(l=>`<div class="${l.m.startsWith("REPORT")?"ps":l.m.startsWith("START")||l.m.startsWith("END")?"dim":""}"${/ERROR|timed out/.test(l.m)?' style="color:#ff8a80"':""}>${esc(l.m)}</div>`).join("")}</div></div>`:`<div class="empty">${m.inv?"Function đã chạy nhưng CloudWatch không nhận được dòng log nào: "+esc(r.noLogs||"execution role thiếu quyền logs:*")+".":"Function chưa chạy lần nào."}</div>`);break}
    case"AWS::S3::Bucket":{const o=RT.obj[id]||{},ks=Object.keys(o),junk=ks.filter(k=>k.startsWith("incoming/")&&k.endsWith(".json"));h+=kvl([["Object",num(Object.values(o).reduce((a,x)=>a+x.n,0))],["Dung lượng",kb(Object.values(o).reduce((a,x)=>a+x.kb*x.n,0))],["PUT · GET",`${num(m.put||0)} · ${num(m.get||0)}`],["Bị từ chối",num(m.denied||0)]]);
      if(m.leak)h+=`<div class="callout"><b>Đang lộ dữ liệu</b>${num(m.leak)} lần đọc ẩn danh thành công.</div>`;
      h+=`<p class="lab">Object</p>`+(ks.slice(0,10).map(k=>`<div class="stmt"><span class="muted mono">${kb(o[k].kb)}</span><span class="mono">${esc(k)}${o[k].n>1?` <span class="chip">×${num(o[k].n)}</span>`:""}</span><span></span></div>`).join("")||`<div class="empty">Bucket trống.</div>`)+(ks.length>10?`<p class="note">… và ${ks.length-10} object khác</p>`:"");
      if(junk.length)h+=`<button class="sm" data-act="cleanJunk" data-arg="${id}">Xóa ${junk.length} file .json trong incoming/</button>`;break}
    case"AWS::SNS::Topic":h+=kvl([["ARN",`<span style="font-size:11px">${esc(arnOf(id))}</span>`],["Đã publish",num(m.pub||0)]])+`<p class="lab">Subscription</p>`+(arr(p.Subscription).map(s=>{const st=s.Protocol==="email"?RT.subs[id+"|"+s.Endpoint]:"Confirmed";return`<div class="stmt">${chip(st==="Confirmed"?"Confirmed":"Pending",st==="Confirmed"?"ok":"warn")}<span>${esc(s.Protocol)} · ${esc(typeof s.Endpoint==="string"?s.Endpoint:refId(s.Endpoint))}</span><span></span></div>`}).join("")||`<div class="empty">Chưa có subscription nên tin publish vào đây không tới ai. Nối topic tới hộp thư, Lambda hoặc SQS.</div>`);break;
    case"CloudLab::Inbox":{const L=RT.inbox[id]||[],sel=L.find(x=>x.id===UI.mailOpen)||L.find(x=>x.kind==="confirm"&&!x.done)||L[0];
      h+=L.length?L.slice(0,8).map(x=>`<button class="mitem${sel&&x.id===sel.id?" on":""}${x.read?"":" unread"}" data-act="openMail" data-arg="${x.id}"><b>${esc(x.subject)}${x.n>1?` ×${num(x.n)}`:""}</b><small>${esc(x.t)} · ${esc(x.kind==="confirm"?"AWS Notifications":x.kind==="alert"?"AWS Budgets":x.kind==="alarm"?"CloudWatch":"SNS")}</small></button>`).join("")+(sel?`<div class="mread">${sel.kind==="confirm"?`<p style="margin-top:0">${esc(sel.body)}</p>${RT.subs[sel.topic+"|"+p.Address]==="Confirmed"?chip("Đã xác nhận","ok"):`<button class="primary" data-act="confirmMail" data-arg="${sel.id}">Confirm subscription</button>`}`:`<p style="margin-top:0">${esc(sel.body)}</p>`}</div>`:""):`<div class="empty">Chưa có thư nào.</div>`;break}
    case"CloudLab::Client":h+=kvl([["Đã gửi",num(m.sent||0)],["Thành công",num(m.ok||0)],["Lỗi / bị chặn",num(m.err||0)]]);if(r.lastErr)h+=`<div class="callout${p.Expect==="Deny"?" ok":""}"><b>${p.Expect==="Deny"?"Bị chặn (đúng ý)":"Lỗi gần nhất"}</b>${esc(r.lastErr)}</div>`;if(m.leak)h+=`<div class="callout"><b>Đọc được dù không đăng nhập</b>Dữ liệu đang public.</div>`;break;
    case"CloudLab::Uploader":h+=kvl([["Đã upload",num(m.sent||0)]]);break;
    case"CloudLab::Monitor":h+=arr(p.Watch).map(refId).filter(Boolean).map(w=>{const s=(RT.n[w]||{series:[],m:{}}),wn=nodeOf(w);if(!wn)return"";return`<div class="mon"><b>${esc(w)}</b>${spark(s.series,wn.type==="AWS::Lambda::Function"?"inv":wn.type==="AWS::S3::Bucket"?"put":"req")}<small>${wn.type==="AWS::Lambda::Function"?`${num(s.m.inv||0)} lần · ${num(s.m.err||0)} lỗi`:wn.type==="AWS::S3::Bucket"?`${num(s.m.put||0)} PUT`:`${num(s.m.req||s.m.inv||0)} request`} · ${money(s.cost||0)}</small></div>`}).join("")||`<div class="empty">Monitor chưa theo dõi khối nào. Nối một khối tới monitor để xem số liệu ở đây.</div>`;break;
    case"AWS::ApiGatewayV2::Api":h+=kvl([["Request",num(m.req||0)],["Lỗi",num(m.err||0)]]);if(r.lastErr)h+=`<div class="callout"><b>Lỗi</b>${esc(r.lastErr)}</div>`;break;
    case"AWS::Budgets::Budget":{const lim=+getP(p,"Budget.BudgetLimit.Amount")||0,f=(RT.budgets[id]||{fired:[]}).fired;h+=`<div class="big">${money(RT.total)} <span class="muted" style="font-size:16px">/ ${money(lim)}</span></div><div class="bar"><i class="${RT.total/lim>=.5?"hi":""}" style="width:${Math.min(100,RT.total/(lim||1)*100)}%"></i></div>`+kvl([["Ngưỡng đã vượt",f.length?f.map(x=>x+"%").join(", "):"—"]]);break}
    case"AWS::CloudWatch::Alarm":{const a=RT.alarms[id];h+=kvl([["Trạng thái",a?a.state:"INSUFFICIENT_DATA"]]);break}
    case"AWS::IAM::Role":{h+=`<p class="lab">Quyền hiện có</p>`+(roleStatements(id).map(s=>`<div class="stmt">${chip(s.Effect,s.Effect==="Allow"?"ok":"warn")}<span>${esc(arr(s.Action).join(", "))}<br><span class="muted">${esc(arr(resolve(s.Resource)).join(", "))}</span></span><span class="muted" style="font-size:11px">${esc(s._by)}</span></div>`).join("")||`<div class="empty">Role chưa có quyền nào. Thêm managed policy hoặc inline policy ở phần Cấu hình.</div>`);
      const q=UI.iamq||{a:"s3:GetObject",r:""};const res=q.r||(allNodes().find(x=>x.type==="AWS::S3::Bucket")?arnOf(allNodes().find(x=>x.type==="AWS::S3::Bucket").id)+"/report.csv":"*"),e=evalRole(id,q.a,res);
      h+=`<p class="lab">Thử quyền (policy simulator)</p><div class="frow"><input id="iq-a" value="${esc(q.a)}" aria-label="Action"><input id="iq-r" value="${esc(res)}" aria-label="Resource ARN"></div><div class="callout ${e.allow?"ok":""}"><b>${e.allow?"Allow":e.kind==="explicit"?"Explicit deny":"Implicit deny"}</b>${esc(e.by)}</div>`;break}
    case"AWS::Logs::LogGroup":{const L=RT.logs[resolve(p.LogGroupName)]||[];h+=L.length?`<div class="console"><div class="body">${L.slice(-8).map(l=>`<div>${esc(l.m)}</div>`).join("")}</div></div>`:`<div class="empty">Log group trống.</div>`;break}
    case"AWS::DynamoDB::Table":h+=kvl([["Item",num(RT.items[id]||0)],["Lần ghi",num(m.wr||0)]]);break;
    case"AWS::SQS::Queue":h+=kvl([["Đang chờ",num(RT.items[id]||0)],["Đã nhận",num(m.sent||0)]]);break}
  return h+costRows(id)}
function nodeActs(n){const id=n.id,t=n.type;let a="";
  if(t==="CloudLab::Client"&&refId(n.props.Target))a+=`<button class="sm" data-act="inject" data-arg="${id}">Gửi 1 request</button>`;
  if(t==="CloudLab::Uploader"&&refId(n.props.Target))a+=`<button class="sm" data-act="inject" data-arg="${id}">Upload 1 file</button>`;
  if(t==="AWS::SNS::Topic"&&exists(id))a+=`<button class="sm" data-act="pubTest" data-arg="${id}">Gửi tin thử</button>`;
  if(t==="AWS::S3::Bucket"&&exists(id)&&Object.keys(RT.obj[id]||{}).length)a+=`<button class="sm" data-act="askEmpty" data-arg="${id}">Empty</button>`;
  if(typeof orgActs==="function")a+=orgActs(n);
  a+=`<button class="sm" data-act="connectFrom" data-arg="${id}">Nối tới…</button><button class="sm danger" data-act="askDelNode" data-arg="${id}">${n.scope==="manual"?"Xóa khỏi account":"Xóa khối"}</button>`;return a}
let DRAWER_KEY=null;
function renderDrawer(){const el=document.getElementById("drawer");if(!el)return;const S=UI.sel;let c=null;
  if(S&&S.node&&nodeOf(S.node)){const n=nodeOf(S.node),L=L_(),ex=L&&L.explain&&L.explain[n.id],v=nodeView(n);
    c={key:"n:"+n.id,cat:n.def.cat,icon:n.def.short,eyebrow:n.def.label+(n.scope==="manual"?" · ngoài stack":n.ext?" · ngoài AWS":""),title:n.id,status:v.st?chip(v.st[1],v.st[0]):"",
      body:(typeof eli5Of==="function"&&eli5Of(n.type)?`<div class="callout eli5"><b>Hiểu nhanh</b>${esc(eli5Of(n.type))}</div>`:"")+(ex?`<div class="callout ctx"><b>Trong bài này</b>${esc(ex)}</div>`:"")+`<details class="doc"${ex||eli5Of(n.type)?"":" open"}><summary>${esc(n.def.label)} là gì?</summary><p>${esc(n.def.doc||"")}</p></details>`+
        `<p class="lab">Cấu hình</p><label class="fld"><span class="fl">Logical ID</span><input data-act="rename" id="f-lid" data-fid="${n.id}" value="${esc(n.id)}"></label>`+n.def.fields.map(f=>fieldHtml(n,f)).join("")+
        `<p class="lab">Đang chạy</p><div class="rt" id="rt">${rtHtml(n.id)}</div>`,foot:nodeActs(n)}}
  else if(S&&S.edge){const e=(GLAST?GLAST.edges:edges()).find(x=>x.id===S.edge);if(e){const v=edgeView(e),f=RT.flow[e.id]||{ok:0,err:0};
    c={key:"e:"+e.id,cat:"learn",icon:"→",eyebrow:"Mũi tên · "+e.kind,title:`${e.from} → ${e.to}`,status:chip(v.st==="ok"?"đang chạy":v.st==="stop"?"bị chặn":v.st==="blocked"?"bị chặn đúng ý":v.st==="loop"?"vòng lặp":v.st==="leak"?"lẽ ra phải bị chặn":"chưa có dữ liệu",{ok:"ok",stop:"bad",loop:"bad",leak:"bad",blocked:"ok"}[v.st]||""),
      body:`<p>${esc(REL_DOC[e.kind]||"Khối này tham chiếu tới khối kia trong template.")}</p>`+kvl([["Khai báo ở",`<span class="mono">${esc(e.owner)}.${esc(e.path)}</span>`],["Thành công",num(f.ok)],["Lỗi / bị chặn",num(f.err)]])+(v.why?`<div class="callout"><b>Lý do</b>${esc(v.why)}</div>`:""),
      foot:`<button class="sm" data-act="selNode" data-arg="${e.from}">${esc(e.from)}</button><button class="sm" data-act="selNode" data-arg="${e.to}">${esc(e.to)}</button><button class="sm danger" data-act="delEdge" data-arg="${esc(e.id)}">Xóa mũi tên</button>`}}}
  if(!c){if(DRAWER_KEY){DRAWER_KEY=null;UI.sel=null;el.hidden=true;el.innerHTML="";KIT.layer.close(el)}return}
  const ae=document.activeElement,inside=ae&&el.contains(ae)?selOf(ae):null;
  el.dataset.cat=c.cat;el.setAttribute("aria-labelledby","dt");
  el.innerHTML=`<div class="drawer-grab" aria-hidden="true"></div><div class="drawer-head"><div class="drawer-eyebrow"><span class="side-ic" style="--cat:var(--c-${c.cat})" aria-hidden="true">${esc(c.icon)}</span><span class="grow">${esc(c.eyebrow)}</span><button class="modal-x" data-act="closeDrawer" aria-label="Đóng">✕</button></div><h2 class="drawer-title" id="dt" tabindex="-1">${esc(c.title)}</h2>${c.status?`<div class="drawer-status">${c.status}</div>`:""}</div><div class="drawer-body">${c.body}</div>${c.foot?`<div class="drawer-foot">${c.foot}</div>`:""}`;
  if(!DRAWER_KEY){el.hidden=false;KIT.layer.open(el,{modal:KIT.isNarrow(),returnFocus:UI.selRet,onClose:()=>{UI.sel=null;render()},initialFocus:"#dt"})}
  else if(inside){const x=el.querySelector(inside);if(x)try{x.focus({preventScroll:true})}catch(_){}}else if(DRAWER_KEY!==c.key){const t=document.getElementById("dt");if(t)t.focus({preventScroll:true})}
  DRAWER_KEY=c.key}
function refreshRt(){const rt=document.getElementById("rt");if(!rt||!UI.sel||!UI.sel.node)return;const ae=document.activeElement;if(ae&&rt.contains(ae)&&ae.tagName==="INPUT")return;rt.innerHTML=rtHtml(UI.sel.node)}
/* ---------------- modal ---------------- */
let MODAL_SHOWN=null;
function renderModal(){const el=document.getElementById("modal"),Md=UI.modal;
  if(!Md){if(MODAL_SHOWN){MODAL_SHOWN=null;const d=el.querySelector(".modal");if(d)KIT.layer.close(d);el.innerHTML=""}return}
  if(Md===MODAL_SHOWN)return;const prev=el.querySelector(".modal");if(prev)KIT.layer.close(prev);Md.ret=Md.ret||UI.lastOpener;
  const v=modalValues();
  el.innerHTML=`<div class="scrim" data-act="scrim"><div class="modal" aria-labelledby="mt"><div class="modal-head"><h3 id="mt">${esc(Md.title)}</h3><button class="modal-x" data-act="closeModal" aria-label="Đóng">✕</button></div>${Md.body||""}
    ${(Md.fields||[]).map(f=>f.type==="checks"?`<fieldset class="fld"><legend>${esc(f.label)}</legend>${f.items.map(([k,l])=>`<label class="ck"><input type="checkbox" id="m-${k}" ${Md.init[k]?"checked":""}> ${esc(l)}</label>`).join("")}</fieldset>`:`<label class="fld">${esc(f.label)}<input id="m-${f.id}" value="${esc(Md.init[f.id]??"")}"></label>`).join("")}
    <div id="mnote">${Md.note?Md.note(v):""}</div><p class="ferr" id="merr" role="alert">${esc(Md.err||"")}</p>
    <div class="mfoot"><button class="ghost" data-act="closeModal">${esc(Md.cancel||"Hủy")}</button>${Md.submitLabel?`<button class="primary ${Md.danger?"dangerbtn":""}" data-act="submitModal">${esc(Md.submitLabel)}</button>`:""}</div></div></div>`;
  MODAL_SHOWN=Md;KIT.layer.open(el.querySelector(".modal"),{modal:true,returnFocus:Md.ret,onClose:()=>{UI.modal=null;render()},initialFocus:el.querySelector(".modal input")||el.querySelector(".mfoot .primary")})}
function modalValues(){const Md=UI.modal,v={...(Md?Md.init:{})};if(!Md)return v;for(const f of Md.fields||[]){if(f.type==="checks")f.items.forEach(([k])=>{const e=document.getElementById("m-"+k);if(e)v[k]=e.checked?1:0});else{const e=document.getElementById("m-"+f.id);if(e)v[f.id]=e.value}}return v}
function confirmModal(title,body,label,fn,danger){UI.modal={title,body:`<p>${body}</p>`,submitLabel:label,danger,cancel:danger?"Giữ nguyên":undefined,init:{},fields:[],submit:()=>{const r=fn();return r&&r.ok===false?r:{ok:true}}}}
/* ---------------- render ---------------- */
function render(){syncHash();const ae=document.activeElement,keep=ae&&ae!==document.body&&!(ae.closest&&ae.closest("#modal"))?selOf(ae):null;
  document.querySelector("[data-shell]").classList.toggle("no-lesson",false);
  renderSide();renderTop();renderBar();renderCanvas();renderCode();renderSim();renderLog();renderLesson();renderDrawer();renderModal();
  const now=document.activeElement;if(keep&&(!now||now===document.body)){const n=document.querySelector(keep);if(n)try{n.focus({preventScroll:true})}catch(_){}}
  if(UI.gfocus){const f=document.querySelector(UI.gfocus);UI.gfocus=null;if(f)try{f.focus({preventScroll:true})}catch(_){}}
  keepVisible();if(window.Kit&&Kit.shellSync)Kit.shellSync()}
let SEEN=null;
function keepVisible(){const id=UI.sel&&UI.sel.node;if(!id||id===SEEN||KIT.isNarrow()){if(!id)SEEN=null;return}SEEN=id;
  const el=document.querySelector(`.gnode[data-gid="${id}"]`),dw=document.getElementById("drawer"),gx=document.querySelector(".gx");if(!el||!dw||dw.hidden||!gx||!el.getBoundingClientRect)return;
  const r=el.getBoundingClientRect(),d=dw.getBoundingClientRect(),g=gx.getBoundingClientRect();if(!d.width)return;const over=r.right-Math.min(d.left,g.right)+24;
  if(over>0){gFreeze();GCUR.pan=[GCUR.pan[0]-over,GCUR.pan[1]];gs().pan=[...GCUR.pan];gApply()}}
function onModelChanged(label,cli){if(stackUp()&&!QUIET){RT.stack.status="UPDATE_COMPLETE";syncRuntime();log("CLI","cloudformation","deploy",`${M.name} · UPDATE_COMPLETE${label?" · "+label:""}`,"ok",cli||`aws cloudformation deploy \\\n  --stack-name ${M.name} \\\n  --template-file template.yaml`)}
  YAML_ERR=null;saveSandbox();render()}
function onSimTick(){gRefresh();renderSim();refreshRt();if(UI.panel==="log"&&LOG.length&&LOG[0].id!==onSimTick.last){onSimTick.last=LOG[0].id;renderLog()}}
function saveSandbox(){if(UI.mode!=="sandbox")return;store.set("sandbox",{yaml:toYaml(),pos:M.pos,manual:M.manual,name:M.name})}
/* ---------------- simulation clock ---------------- */
let TIMER=null;
function simPlay(on){RT.running=!!on;if(on){if(!stackUp()&&Object.keys(M.res).length&&RT.stack.status!=="DELETE_COMPLETE")deploy();if(!TIMER)TIMER=setInterval(()=>{if(document.hidden)return;step(SPEEDS[UI.speed][1]*0.25);onSimTick()},250)}
  else if(TIMER){clearInterval(TIMER);TIMER=null}renderSim();gRefresh()}
/* ---------------- modes ---------------- */
function resetUi(){if(TIMER){clearInterval(TIMER);TIMER=null}if(RT)RT.running=false;UI.sel=null;UI.result=null;UI.hints=0;UI.attempt=0;UI.dirty=false;UI.gmenu=null;UI.gdrag=null;UI.tour=-1;UI.mailOpen=null;if(UI.g){UI.g.zoom=null;UI.g.trace=false}UNDO=[];REDO=[]}
function startLesson(i,quiet){const L=LESSONS[i];resetUi();UI.mode="lesson";UI.picker=null;UI.lesson=i;UI.speed=L.speed??2;
  M=loadTemplate(L.yaml,L.layout,"lab-"+L.id,L.manual);RT=freshRuntime();QUIET++;deploy();QUIET--;RT.stack.status="CREATE_COMPLETE";syncRuntime();
  store.set("mode",{mode:"lesson",i});if(!quiet)log("Bài học","lesson","setup",`Bài ${L.step}: ${L.title} · stack ${M.name} đã deploy`,"")}
function startSandbox(m){resetUi();UI.mode="sandbox";UI.picker=libPref()==="closed"?null:{q:"",active:0};UI.lesson=-1;UI.speed=2;
  if(m)M=m;else{const s=store.get("sandbox",null);let ok=false;if(s&&s.yaml){const r=fromYaml(s.yaml,{name:s.name||"sandbox",pos:s.pos,manual:s.manual});if(r.ok){M=r.model;ok=true}}if(!ok)M=loadTemplate(STARTER.yaml,STARTER.layout,"sandbox")}
  RT=freshRuntime();if(Object.keys(M.res).length){QUIET++;deploy();QUIET--;RT.stack.status="CREATE_COMPLETE";syncRuntime()}store.set("mode",{mode:"sandbox"});saveSandbox();
  log("CloudLab","sandbox","open",`Sandbox · ${Object.keys(M.res).length} resource`,"")}
function check(){const L=L_();if(!L)return;UI.attempt++;UI.dirty=false;const res=L.tasks.map(t=>{try{return!!t.test()}catch(e){console.error(e);return false}}),ok=res.every(Boolean);
  const cause=res.join()+"|"+(L.diagnose?L.diagnose(0):"");UI.ladder=cause===UI.lastCause?(UI.ladder||0)+1:0;UI.lastCause=cause;
  UI.result={ok,res,msg:ok?L.pass:L.diagnose(UI.ladder)};log("Bài học","lesson","check",ok?`Đạt ${res.length}/${res.length}`:`Chưa đạt · lần ${UI.attempt} · ${res.filter(Boolean).length}/${res.length}`,ok?"ok":"bad");
  if(ok){DONE.add(L.id);store.set("done",[...DONE])}}
/* ---------------- events ---------------- */
document.addEventListener("click",e=>{
  const t=e.target.closest("[data-act],[data-lesson],[data-log],[data-node],[data-edge],[data-ptype]");if(!t||t.closest("[inert]"))return;
  if((t.dataset.node||t.dataset.gconnect||t.dataset.edge)&&Date.now()-GSUP<350)return;
  UI.lastOpener=selOf(t);
  if(t.dataset.ptype){const[x,y]=freeSpot(...viewCenter());let id;edit("add "+t.dataset.ptype,()=>{id=addNode(t.dataset.ptype,x,y)});log("CloudLab","editor","add",`${id} (${T[t.dataset.ptype].label})`,"ok");UI.sel={node:id};UI.selRet=`[data-node="${id}"]`;if(KIT.isNarrow()&&document.querySelector("[data-shell]").hasAttribute("data-side-open"))document.querySelector("[data-shell]").removeAttribute("data-side-open");render();return}
  if(t.dataset.node){UI.gmenu=null;UI.sel={node:t.dataset.node};UI.selRet=`[data-node="${t.dataset.node}"]`;render();return}
  if(t.dataset.edge){UI.sel={edge:t.dataset.edge};UI.selRet=null;render();return}
  if(t.dataset.lesson!==undefined&&t.dataset.act===undefined){const i=+t.dataset.lesson;if(UI.mode==="lesson"&&i===UI.lesson)return;
    if(UNDO.length&&UI.mode==="lesson"&&!(UI.result&&UI.result.ok)){confirmModal("Chuyển sang bài khác?","Những gì bạn đã sửa trong bài này sẽ mất. Event log vẫn giữ.","Chuyển bài",()=>startLesson(i));render();return}startLesson(i);render();return}
  if(t.dataset.log){UI.logSel=+t.dataset.log;renderLog();return}
  const a=t.dataset.act,arg=t.dataset.arg;
  if(a==="closeModal"){UI.modal=null;render();return}if(a==="scrim"){if(e.target===t){UI.modal=null;render()}return}
  if(a==="rename")return;
  const A={
    undo,redo,deploy(){deploy();gs().zoom=null},askDelete(){const sb=UI.mode==="sandbox";UI.modal={title:`Xóa stack ${M.name}?`,submitLabel:"Xóa stack",cancel:"Giữ stack",danger:true,init:{wipe:0},
      body:`<p>CloudFormation sẽ xóa ${RT.stack.status==="DELETE_FAILED"?(RT.stack.left||[]).length:Object.keys(M.res).length} tài nguyên của stack và ngừng tính tiền cho chúng. Tài nguyên có <code>DeletionPolicy: Retain</code> được giữ lại và vẫn tính tiền.</p><p>Template giữ nguyên: các khối ở lại trên canvas với trạng thái “Đã xóa”, bấm Deploy để tạo lại lúc nào cũng được.</p><p class="note"><code>aws cloudformation delete-stack --stack-name ${esc(M.name)}</code></p>`,
      fields:sb?[{type:"checks",label:"Canvas",items:[["wipe","Xóa luôn các khối khỏi canvas (template trống)"]]}]:[],
      submit:v=>{simPlay(false);deleteStack();if(sb&&+v.wipe&&RT.stack.status==="DELETE_COMPLETE"){edit("xóa canvas",()=>{M.res={};M.ext={}});RT.stack.status="NOT_DEPLOYED";log("CloudLab","editor","clear","Template trống · tài nguyên tạo tay và bucket Retain vẫn còn","ok")}return{ok:true}}}},
    vMode(){UI.code=arg!=="graph";UI.split=arg==="split";YAML_ERR=null},
    simToggle(){simPlay(!RT.running);return true},simReset(){const was=RT.running;simPlay(false);if(UI.mode==="lesson")startLesson(UI.lesson,true);else{RT=freshRuntime();if(Object.keys(M.res).length){QUIET++;deploy();QUIET--;RT.stack.status="CREATE_COMPLETE";syncRuntime()}}log("CloudLab","sim","reset","đặt lại thời gian, chi phí và dữ liệu mô phỏng","");if(was)simPlay(true)},
    logToggle(){UI.panel=UI.panel?null:"log";UI.logOpen=!!UI.panel},picker(){UI.picker=UI.picker?null:{q:"",active:0};libSave(!!UI.picker);UI.gfocus=UI.picker?"#pkq":null;gs().zoom=null},
    loadTpl(){const t=STARTERS[arg];confirmModal(`Mở mẫu “${t.title}”?`,`${esc(t.desc)}<br><br>Mẫu này sẽ thay toàn bộ canvas sandbox hiện tại.`,"Mở mẫu",()=>{startSandbox(loadTemplate(t.yaml,t.layout,"sandbox"));UI.sideTab="comp";gs().zoom=null})},
    gFit(){const G=gs();G.zoom=null},gNoteClose(){UI.gnote=null},lessonWide(){const wide=lessonW()>=Math.min(lwMax(),window.innerWidth*0.5);setLessonW(wide?LW_DEF:Math.round(window.innerWidth*0.55),true);gs().zoom=null},orgAct(){const k=arg.indexOf(":");ORG_ACTS[arg.slice(0,k)](arg.slice(k+1))},gZoom(){gZoomAt(GCUR.z*(arg==="1"?1.2:1/1.2));return true},gTrace(){gs().trace=!gs().trace},gView(){gs().view=arg;UI.gmenu=null},
    gMenu(){UI.gmenu=UI.gmenu&&UI.gmenu.from===arg?null:{from:arg,active:0};UI.gfocus=UI.gmenu?"#glist":`[data-gconnect="${arg}"]`},
    connectFrom(){UI.sel=null;UI.code=false;UI.gmenu={from:arg,active:0};UI.gfocus="#glist"},
    gPick(){if(!UI.gmenu||!connectRule(UI.gmenu.from,arg))return true;doConnect(UI.gmenu.from,arg);UI.gmenu=null},
    closeDrawer(){UI.sel=null},selNode(){UI.sel={node:arg};UI.selRet=null;UI.gfocus="#dt"},
    delEdge(){const e=edges().find(x=>x.id===arg);if(e){edit("xóa mũi tên",()=>removeEdge(e));log("CloudLab","editor","disconnect",`${e.from} → ${e.to}`,"warn")}UI.sel=null},
    askDelNode(){const n=nodeOf(arg);if(!n)return;if(n.type==="AWS::S3::Bucket"&&n.scope==="manual"&&Object.keys(RT.obj[arg]||{}).length){log("API","s3","DeleteBucket","BucketNotEmpty: The bucket you tried to delete is not empty.","bad",`aws s3 rb s3://${physName(n)}`);gNote(`BucketNotEmpty: ${arg} còn object nên chưa xóa được. Bấm Empty trong khung chi tiết, rồi xóa lại.`,"warn");UI.modal=null;return}
      const refs=edges().filter(e=>e.to===arg||e.from===arg).length;confirmModal(`Xóa ${arg}?`,`${esc(n.def.label)} sẽ bị bỏ khỏi ${n.scope==="manual"?"account":"template"}${refs?`, cùng ${refs} mũi tên nối với nó`:""}.`,n.scope==="manual"?"Xóa khỏi account":"Xóa khối",()=>{edit("xóa "+arg,()=>removeNode(arg));if(n.scope==="manual"){log("API","s3","DeleteBucket",physName(n),"warn",`aws s3 rb s3://${physName(n)}`);delete RT.obj[arg];delete RT.n[arg]}UI.sel=null},true)},
    askEmpty(){const n=nodeOf(arg);confirmModal(`Empty bucket ${arg}?`,`Toàn bộ ${num(Object.values(RT.obj[arg]||{}).reduce((a,x)=>a+x.n,0))} object trong ${esc(physName(n))} sẽ bị xóa vĩnh viễn.`,"Empty bucket",()=>{RT.obj[arg]={};log("API","s3","DeleteObjects",`${physName(n)}: làm rỗng`,"warn",`aws s3 rm s3://${physName(n)} --recursive`);UI.dirty=true},true)},
    cleanJunk(){const st=RT.obj[arg]||{},ks=Object.keys(st).filter(k=>k.startsWith("incoming/")&&k.endsWith(".json"));ks.forEach(k=>delete st[k]);log("API","s3","DeleteObjects",`${ks.length} file .json trong incoming/`,"warn",`aws s3 rm s3://${physName(nodeOf(arg))}/incoming/ --recursive --exclude "*" --include "*.json"`);UI.dirty=true},
    inject(){const n=nodeOf(arg);if(!stackUp()&&Object.keys(M.res).length&&RT.stack.status==="NOT_DEPLOYED")deploy();inject(n,1);log("Thử","sim",n.type==="CloudLab::Uploader"?"upload":"request",`${arg}: 1 ${n.type==="CloudLab::Uploader"?"file":"request"}`,"")},
    pubTest(){push({at:RT.t,to:arg,w:1,type:"pub",data:{subject:"Tin thử từ CloudLab",body:"Bạn đọc được thư này nghĩa là subscription đang hoạt động."}});drain();log("Thử","sns","Publish",`tin thử tới ${arg}`,"",`aws sns publish --topic-arn ${arnOf(arg)} --message "test"`)},
    openMail(){UI.mailOpen=arg;for(const L of Object.values(RT.inbox)){const m=L.find(x=>x.id===arg);if(m)m.read=true}},
    confirmMail(){for(const[ib,L]of Object.entries(RT.inbox)){const m=L.find(x=>x.id===arg);if(m&&m.topic){if(confirmSub(m.topic,(nodeOf(ib).props||{}).Address))m.done=true}}UI.dirty=true},
    check(){check()},hint(){UI.hints=Math.min(UI.hints+1,L_().hints().length);log("Bài học","lesson","hint",`mở gợi ý ${UI.hints}`,"")},
    askSkip(){confirmModal("Làm hộ bài này?","CloudLab sẽ sửa template giúp bạn và ghi từng bước vào Event log. Bài được tính là đã xem, không tính là đạt.","Làm hộ",()=>{const L=L_();L.solve();check();if(UI.result.ok){DONE.delete(L.id);store.set("done",[...DONE]);UI.result.skipped=true;UI.result.msg="Mở YAML và Event log để xem từng thay đổi. Bài được tính là đã xem, chưa đạt."}})},
    askReset(){confirmModal("Bắt đầu lại bài này?","Template và dữ liệu mô phỏng quay về như lúc mở bài. Event log giữ nguyên.","Bắt đầu lại",()=>startLesson(UI.lesson),true)},
    openSandbox(){if(UI.mode!=="sandbox")startSandbox()},loadStarter(){confirmModal("Mở mẫu API → Lambda → DynamoDB?","Mẫu này sẽ thay toàn bộ canvas sandbox hiện tại.","Mở mẫu",()=>startSandbox(loadTemplate(STARTER.yaml,STARTER.layout,"sandbox")))},
    askClear(){confirmModal("Xóa hết canvas?","Mọi khối trong sandbox sẽ bị xóa. Không hoàn tác được.","Xóa hết",()=>startSandbox(emptyModel("sandbox")),true)},
    copyLesson(){const L=LESSONS[+arg];confirmModal(`Mở template “${L.tag}” trong sandbox?`,"Template này sẽ thay canvas sandbox hiện tại. Sandbox không chấm điểm.","Mở trong sandbox",()=>startSandbox(loadTemplate(L.yaml,L.layout,"sandbox",L.manual)))},
    tour(){const L=L_();const ids=Object.keys(L.explain||{}).filter(id=>nodeOf(id));if(UI.tour>=0){UI.tour=-1;UI.sel=null;return}UI.tour=0;UI.sel={node:ids[0]};UI.gfocus="#dt"},
    codeTab(){UI.codeTab=arg;renderCode(true);return true},
    copyCode(){const X=EXPORTS[UI.codeTab||"cfn"];try{navigator.clipboard.writeText(X.edit?toYaml():X.gen());t.textContent="Đã copy"}catch(_){}return true},
    dlCode(){const X=EXPORTS[UI.codeTab||"cfn"];download(X.file,X.edit?toYaml():X.gen());log("CloudLab","iac","export",X.file,"ok");return true},
    panel(){UI.panel=UI.panel===arg?null:arg;UI.logOpen=!!UI.panel},
    envAdd(){edit("env",()=>{const n=nodeOf(arg);const v=getP(n.props,"Environment.Variables")||{};v["VAR_"+(Object.keys(v).length+1)]="";setP(n.props,"Environment",{Variables:v})})},
    rowAdd(){const fs=t.closest("[data-ftype]"),n=nodeOf(fs.dataset.fid),k=fs.dataset.field;edit("thêm dòng",()=>{const cur=arr(getP(n.props,k));setP(n.props,k,cur.concat([arg==="subs"?{Protocol:"email",Endpoint:EMAIL}:arg==="ingress"?{IpProtocol:"tcp",FromPort:80,ToPort:80,CidrIp:"0.0.0.0/0"}:{Event:"s3:ObjectCreated:*",Function:null}]))})},
    rowDel(){const fs=t.closest("[data-ftype]");t.closest(".frow").remove();applyField(fs)},
    polAdd(){const fs=t.closest("[data-ftype]"),n=nodeOf(fs.dataset.fid);edit("thêm policy",()=>{n.props.Policies=arr(n.props.Policies).concat([{PolicyName:"inline-"+(arr(n.props.Policies).length+1),PolicyDocument:{Version:"2012-10-17",Statement:[{Effect:"Allow",Action:"s3:GetObject",Resource:"*"}]}}])})},
    polDel(){const fs=t.closest("[data-ftype]");t.closest(".pol").remove();applyField(fs)},
    stmtAdd(){const fs=t.closest("[data-ftype]"),pol=t.closest(".pol");pol.insertAdjacentHTML("beforeend","");const tmp=document.createElement("div");tmp.innerHTML=stmtRow({Effect:"Allow",Action:"s3:GetObject",Resource:"*"},fs.dataset.ftype==="statements");pol.insertBefore(tmp.firstChild,t);applyField(fs)},
    submitModal(){const Md=UI.modal,v=modalValues(),r=Md.submit(v);if(r&&r.ok===false){Md.err=r.err;const er=document.getElementById("merr");if(er)er.textContent=r.err;return true}if(UI.modal===Md)UI.modal=null},
  };
  if(A[a]){const keep=A[a]();if(keep!==true)render()}});
document.addEventListener("change",e=>{const t=e.target;
  if(t.id==="speed"){UI.speed=+t.value;return}
  if(t.id==="f-lid"){const a=t.dataset.fid,b=t.value.trim();let r;edit("đổi tên",()=>{r=renameNode(a,b)});if(!r.ok){undo();UNDO.pop();t.setAttribute("aria-invalid","true");log("CloudLab","editor","rename",r.err,"bad");return}UI.sel={node:b};render();return}
  if(t.id==="iq-a"||t.id==="iq-r"){UI.iamq={a:document.getElementById("iq-a").value,r:document.getElementById("iq-r").value};refreshRt();return}
  const fs=t.closest("[data-ftype]");if(fs&&fs.closest("#drawer"))applyField(fs);
  if(t.closest(".modal")){const n=document.getElementById("mnote");if(n&&UI.modal&&UI.modal.note)n.innerHTML=UI.modal.note(modalValues())}});
document.addEventListener("input",e=>{if(e.target.id==="psearch"){UI.psearch=e.target.value;renderSide();const f=document.getElementById("psearch");if(f){f.focus();f.setSelectionRange(f.value.length,f.value.length)}return}
  if(e.target.id==="pkq"){UI.picker.q=e.target.value;UI.picker.active=0;renderCanvas();const f=document.getElementById("pkq");if(f){f.focus();f.setSelectionRange(f.value.length,f.value.length)}return}
  if(e.target.id!=="yaml")return;clearTimeout(YAML_T);const ta=e.target;YAML_T=setTimeout(()=>{const r=fromYaml(ta.value,{name:M.name,pos:M.pos,manual:M.manual});
  if(!r.ok){YAML_ERR=r;const st=document.getElementById("ystat");if(st)st.innerHTML=ystat();return}YAML_ERR=null;const nm=r.model;edit("YAML",()=>{M=nm})},500)});
/* palette drag & drop */
/* drag a component from the menu (or the ＋ picker) onto the canvas. Pointer events, not HTML5 drag-and-drop:
   Chromium never starts a native drag from these buttons, and pointer events also work with touch and pen. */
function dropComponent(type,cx,cy){const[x,y]=toWorld(cx,cy);let id;gFreeze();edit("add "+type,()=>{id=addNode(type,x-GW/2,y-30)});log("CloudLab","editor","add",`${id} (${T[type].label})`,"ok");
  const ob=GLAST&&boxAt(GLAST.boxes,x,y,"ou");if(ob&&type==="AWS::Organizations::Account")moveAcctTo(id,ob.id);const sb=GLAST&&boxAt(GLAST.boxes,x,y,"subnet"),vb=GLAST&&boxAt(GLAST.boxes,x,y,"vpc");if(sb)placeIn(id,sb.id);else if(vb&&PLACEABLE.includes(type))autoSubnet(id,vb.id);
  else if(vb&&["AWS::EC2::Subnet","AWS::EC2::SecurityGroup","AWS::ElasticLoadBalancingV2::TargetGroup"].includes(type))edit("vpc",()=>{nodeOf(id).props.VpcId={Ref:vb.id}});
  UI.sel={node:id};UI.selRet=`[data-node="${id}"]`;saveSandbox();render();return id}
let PD=null,PD_SUPPRESS=0;
document.addEventListener("pointerdown",e=>{if(e.button!==0||!e.target.closest)return;const it=e.target.closest("[data-ptype]");if(!it)return;PD={type:it.dataset.ptype,x0:e.clientX,y0:e.clientY,el:it,ghost:null,pid:e.pointerId}});
document.addEventListener("pointermove",e=>{if(!PD||e.pointerId!==PD.pid)return;
  if(!PD.ghost){if(Math.hypot(e.clientX-PD.x0,e.clientY-PD.y0)<6)return;const d=T[PD.type],g=document.createElement("div");g.className="pal-ghost";g.setAttribute("aria-hidden","true");
    g.innerHTML=`<span class="side-ic" style="--cat:var(--c-${d.cat})">${esc(d.short)}</span><span>${esc(d.label)}</span>`;document.body.appendChild(g);PD.ghost=g;document.body.classList.add("pal-dragging");
    try{PD.el.releasePointerCapture&&PD.el.releasePointerCapture(e.pointerId)}catch(_){}}
  e.preventDefault();PD.ghost.style.transform=`translate(${e.clientX+12}px,${e.clientY+12}px)`;
  const el=document.elementFromPoint(e.clientX,e.clientY),gx=el&&el.closest&&el.closest(".gx");PD.ghost.classList.toggle("ok",!!gx);
  document.querySelectorAll(".gx").forEach(x=>x.classList.toggle("pal-over",x===gx));
  /* show which VPC/subnet the drop would land in */
  let hb=null;if(gx&&GLAST){const[wx,wy]=toWorld(e.clientX,e.clientY);const b=boxAt(GLAST.boxes,wx,wy,"subnet")||boxAt(GLAST.boxes,wx,wy,"vpc");hb=b?b.id:null}
  document.querySelectorAll(".gbox").forEach(x=>x.classList.toggle("drop",x.dataset.gid===hb))},{passive:false});
function palEnd(e,cancel){if(!PD)return;const d=PD;PD=null;document.body.classList.remove("pal-dragging");document.querySelectorAll(".gx.pal-over").forEach(x=>x.classList.remove("pal-over"));document.querySelectorAll(".gbox.drop").forEach(x=>x.classList.remove("drop"));
  if(!d.ghost)return;d.ghost.remove();PD_SUPPRESS=Date.now();setTimeout(()=>{PD_SUPPRESS=0},0);if(cancel)return;
  const el=document.elementFromPoint(e.clientX,e.clientY);if(el&&el.closest&&el.closest(".gx"))dropComponent(d.type,e.clientX,e.clientY);
  if(KIT.isNarrow()){const sh=document.querySelector("[data-shell]");if(sh&&sh.hasAttribute("data-side-open"))sh.removeAttribute("data-side-open")}}
document.addEventListener("pointerup",e=>palEnd(e,false));document.addEventListener("pointercancel",e=>palEnd(e,true));
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&PD&&PD.ghost){palEnd(e,true)}},true);
/* a drag that ends is not also a click on the menu item */
document.addEventListener("click",e=>{if(PD_SUPPRESS&&Date.now()-PD_SUPPRESS<400&&e.target.closest&&e.target.closest("[data-ptype]")){e.stopPropagation();e.preventDefault();PD_SUPPRESS=0}},true);
/* canvas pointer: pan, drag nodes, drag-to-connect */
document.addEventListener("pointerdown",e=>{if(e.button!==0||!e.target.closest)return;const gx=e.target.closest(".gx");if(!gx||e.target.closest(".gmenu"))return;
  const port=e.target.closest("[data-gconnect]"),node=e.target.closest(".gnode"),boxh=e.target.closest(".gbox-h");
  GD={kind:port?"connect":node?"node":boxh?"box":e.target.closest("[data-edge]")?"edge":"pan",id:port?port.dataset.gconnect:node?node.dataset.gid:boxh?boxh.closest(".gbox").dataset.gid:null,x0:e.clientX,y0:e.clientY,moved:false,pan0:[...GCUR.pan],gx,boxes:GLAST?GLAST.boxes:[]};
  if(GD.kind==="node"){GD.pos0=[...(M.pos[GD.id]||[0,0])]}
  if(GD.kind==="box"){const b=GLAST&&GLAST.by[GD.id];GD.pos0={};for(const k of [GD.id,...((b&&b.members)||[])])if(M.pos[k])GD.pos0[k]=[...M.pos[k]]}
  if(GD.kind==="pan")e.preventDefault()});
/* which subnet box contains a world point (smallest first) */
function boxAt(boxes,x,y,kind){return boxes.filter(b=>(!kind||b.box===kind)&&x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h).sort((a,b)=>a.w*a.h-b.w*b.h)[0]||null}
const PLACEABLE=["AWS::EC2::Instance","AWS::RDS::DBInstance"];
/* EC2/RDS can't sit in a VPC directly — they live in a subnet. Dropped on a VPC area with no subnet: create one there. */
function autoSubnet(id,vpc){let sid;edit(`tạo subnet cho ${id}`,()=>{sid=newSubnetIn(vpc);const p=M.pos[id]||[0,0];M.pos[sid]=[p[0]-20,p[1]-40]});placeIn(id,sid);
  gNote(`${id} cần nằm trong một subnet, nên CloudLab đã tạo ${sid} (${M.res[sid].Properties.CidrBlock}, private) trong ${vpc}. Cần public thì đổi trong khung chi tiết của ${sid}.`,"info")}
/* short message on the canvas, e.g. why a connection was refused */
let GNOTE_T=0;function gNote(text,kind){UI.gnote={text,kind:kind||"warn"};clearTimeout(GNOTE_T);GNOTE_T=setTimeout(()=>{UI.gnote=null;render()},7000)}
function placeIn(id,sid){const n=nodeOf(id);if(!n||!PLACEABLE.includes(n.type))return false;const cur=subnetsOf(n)[0]||null;if(cur===sid)return false;
  edit(sid?`đặt ${id} vào ${sid}`:`đưa ${id} ra khỏi subnet`,()=>{const nn=nodeOf(id);
    if(nn.type==="AWS::EC2::Instance")nn.props.SubnetId=sid?{Ref:sid}:null;
    else{let g=refId(nn.props.DBSubnetGroupName);if(!sid){if(g&&nodeOf(g))nodeOf(g).props.SubnetIds=[];return}if(!g||!nodeOf(g)){g=freeId(id+"Subnets");M.res[g]={Type:"AWS::RDS::DBSubnetGroup",Properties:{DBSubnetGroupDescription:kebab(id)+" subnets",SubnetIds:[]}};nn.props.DBSubnetGroupName={Ref:g}}
      const G=nodeOf(g);G.props.SubnetIds=[{Ref:sid},...arr(G.props.SubnetIds).filter(x=>refId(x)!==sid)].slice(0,3)}});
  log("CloudLab","editor","place",sid?`${id} → subnet ${sid}`:`${id} ra khỏi subnet`,"ok");return true}
document.addEventListener("pointermove",e=>{if(!GD||GD.kind==="edge")return;const dx=e.clientX-GD.x0,dy=e.clientY-GD.y0;if(!GD.moved&&Math.hypot(dx,dy)<5)return;
  if(!GD.moved){GD.moved=true;gFreeze();UI.gmenu=null;if(GD.kind==="connect")UI.gdrag={from:GD.id}}const z=GCUR.z;
  if(GD.kind==="pan"){GCUR.pan=[GD.pan0[0]+dx,GD.pan0[1]+dy];gs().pan=[...GCUR.pan];gApply()}
  else if(GD.kind==="node"){M.pos[GD.id]=[Math.round(GD.pos0[0]+dx/z),Math.round(GD.pos0[1]+dy/z)];const n=nodeOf(GD.id);
    if(n&&n.type==="AWS::Organizations::Account"){const c=[M.pos[GD.id][0]+GW/2,M.pos[GD.id][1]+40],b=boxAt(GD.boxes,c[0],c[1],"ou");UI.gdropBox=b?b.id:null}
    if(n&&PLACEABLE.includes(n.type)){const c=[M.pos[GD.id][0]+GW/2,M.pos[GD.id][1]+40],b=boxAt(GD.boxes.filter(x=>!x.members.includes(GD.id)||x.box==="subnet"),c[0],c[1],"subnet");UI.gdropBox=b?b.id:null}gRefresh()}
  else if(GD.kind==="box"){for(const k of Object.keys(GD.pos0))M.pos[k]=[Math.round(GD.pos0[k][0]+dx/z),Math.round(GD.pos0[k][1]+dy/z)];gRefresh()}
  else{const el=document.elementFromPoint&&document.elementFromPoint(e.clientX,e.clientY),on=el&&el.closest&&el.closest(".gnode");UI.gdrag.at=toWorld(e.clientX,e.clientY);UI.gdrag.over=on?on.dataset.gid:null;gRefresh();GD.gx.classList.add("connecting")}});
function gEnd(cancel){if(!GD)return;const d=GD;GD=null;if(!d.moved)return;GSUP=Date.now();
  if(d.kind==="node"){const n=nodeOf(d.id);if(n&&n.type==="AWS::Organizations::Account"){const c=[M.pos[d.id][0]+GW/2,M.pos[d.id][1]+40],ob=boxAt(d.boxes,c[0],c[1],"ou");if(ob)moveAcctTo(d.id,ob.id)}
    if(n&&PLACEABLE.includes(n.type)){const c=[M.pos[d.id][0]+GW/2,M.pos[d.id][1]+40],sb=boxAt(d.boxes,c[0],c[1],"subnet"),cur=subnetsOf(n)[0]||null;
      const vb=!sb&&boxAt(d.boxes,c[0],c[1],"vpc");
      if(sb&&sb.id!==cur)placeIn(d.id,sb.id);else if(vb&&!cur)autoSubnet(d.id,vb.id);else if(!sb&&cur&&!vb)placeIn(d.id,null)}UI.gdropBox=null;saveSandbox();render()}
  if(d.kind==="box")saveSandbox();
  if(d.kind==="connect"){const over=!cancel&&UI.gdrag&&UI.gdrag.over;UI.gdrag=null;if(over&&over!==d.id){if(connectRule(d.id,over))doConnect(d.id,over);else{const why=whyNot(d.id,over);gNote(`Không nối được ${d.id} → ${over}. ${why}.`,"warn");log("CloudLab","editor","connect",`${d.id} → ${over}: ${why}`,"warn")}}render()}}
document.addEventListener("pointerup",()=>gEnd(false));document.addEventListener("pointercancel",()=>gEnd(true));
/* wheel on the canvas: scroll zooms at the cursor (pinch on a trackpad too); Shift + scroll or a sideways swipe pans */
document.addEventListener("wheel",e=>{const gx=e.target.closest&&e.target.closest(".gx");if(!gx||e.target.closest(".gmenu"))return;e.preventDefault();
  const k=e.deltaMode===1?33:e.deltaMode===2?400:1,dx=e.deltaX*k,dy=e.deltaY*k;
  if(e.shiftKey||(!e.ctrlKey&&!e.metaKey&&Math.abs(dx)>Math.abs(dy))){gFreeze();const h=e.shiftKey&&!dx?dy:dx,v=e.shiftKey&&!dx?0:dy;GCUR.pan=[GCUR.pan[0]-h,GCUR.pan[1]-(Math.abs(dx)>Math.abs(dy)?v:0)];gs().pan=[...GCUR.pan];gApply();return}
  const r=gx.getBoundingClientRect(),step=Math.max(-120,Math.min(120,dy));gZoomAt(GCUR.z*Math.exp(-step*(e.ctrlKey||e.metaKey?.01:.0025)),e.clientX-r.left,e.clientY-r.top)},{passive:false});
window.addEventListener("keydown",e=>{const tag=(e.target.tagName||"").toLowerCase(),typing=tag==="input"||tag==="textarea"||tag==="select";
  if(UI.picker&&e.target.id==="pkq"){const P=UI.picker,n=(P.flat||[]).length;
    if(e.key==="Escape"){e.preventDefault();e.stopPropagation();UI.picker=null;libSave(false);gs().zoom=null;renderCanvas();return}
    if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();P.active=((P.active||0)+(e.key==="ArrowDown"?1:-1)+n)%Math.max(1,n);renderCanvas();const f=document.getElementById("pkq");if(f){f.focus();f.setSelectionRange(f.value.length,f.value.length)}return}
    if(e.key==="Enter"){e.preventDefault();const ty=P.flat&&P.flat[P.active||0];if(ty){const b=document.createElement("button");b.dataset.ptype=ty;document.body.appendChild(b);b.click();b.remove()}return}return}
  if(!typing&&e.key==="/"&&UI.page!=="x"&&document.querySelector(".gx")){e.preventDefault();UI.picker={q:"",active:0};renderCanvas();const f=document.getElementById("pkq");if(f)f.focus();return}
  const menu=UI.gmenu&&e.target.closest&&e.target.closest(".gmenu");
  if(menu){const Mn=UI.gmenu,n=(Mn.ids||[]).length;
    if(e.key==="Escape"){e.preventDefault();e.stopPropagation();const f=Mn.from;UI.gmenu=null;UI.gfocus=`[data-gconnect="${f}"]`;render();return}
    if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();Mn.active=((Mn.active||0)+(e.key==="ArrowDown"?1:-1)+n)%Math.max(1,n);renderCanvas();const f=document.getElementById("glist");if(f)f.focus();return}
    if(e.key==="Enter"||e.key===" "){e.preventDefault();e.stopPropagation();const to=Mn.ids[Mn.active||0];if(to&&connectRule(Mn.from,to)){doConnect(Mn.from,to);UI.gmenu=null;render()}return}return}
  if(!typing&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();e.shiftKey?redo():undo();return}
  if(!typing&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y"){e.preventDefault();redo();return}
  const nd=e.target.closest&&e.target.closest(".gnode .gn[data-node]");if(!nd)return;const id=nd.dataset.node;
  if(e.key.startsWith("Arrow")){e.preventDefault();if(e.shiftKey){const p=M.pos[id],d={ArrowRight:[16,0],ArrowLeft:[-16,0],ArrowDown:[0,16],ArrowUp:[0,-16]}[e.key];M.pos[id]=[p[0]+d[0],p[1]+d[1]];saveSandbox();gRefresh();const el=document.querySelector(`.gn[data-node="${id}"]`);if(el)el.focus()}
    else{const nb=gNeighbor(id,e.key);if(nb){const el=document.querySelector(`.gn[data-node="${nb}"]`);if(el)el.focus()}}return}
  if(e.key==="Delete"||e.key==="Backspace"){e.preventDefault();UI.lastOpener=`[data-node="${id}"]`;const b=document.createElement("button");b.dataset.act="askDelNode";b.dataset.arg=id;document.body.appendChild(b);b.click();b.remove();return}
  if((e.key==="c"||e.key==="C")&&!e.ctrlKey&&!e.metaKey){e.preventDefault();UI.gmenu={from:id,active:0};UI.gfocus="#glist";render();return}
  if((e.key==="t"||e.key==="T")&&!e.ctrlKey&&!e.metaKey){e.preventDefault();gs().trace=!gs().trace;UI.gfocus=`.gn[data-node="${id}"]`;render()}},true);
document.addEventListener("keydown",e=>{const g=e.target.closest&&e.target.closest("[data-log]");if(g&&(e.key==="Enter"||e.key===" ")){e.preventDefault();g.click()}});
let RZ=0;window.addEventListener("resize",()=>{clearTimeout(RZ);RZ=setTimeout(()=>{if(!gs().zoom)renderCanvas()},150)});
/* the tour moves through the lesson's components when the drawer closes or "tiếp" is used */
document.addEventListener("click",e=>{const L=L_();if(!L||UI.tour<0)return;const nx=e.target.closest&&e.target.closest('[data-act="closeDrawer"]');if(!nx)return;const ids=Object.keys(L.explain||{}).filter(id=>nodeOf(id));UI.tour++;if(UI.tour>=ids.length){UI.tour=-1;return}setTimeout(()=>{UI.sel={node:ids[UI.tour]};render()},0)},true);
/* ---------------- boot ---------------- */
/* URL routes: #/lesson/<id> and #/sandbox, so a lesson can be linked, shared, and opened from learn.html */
function routeFromHash(){const m=/^#\/(lesson)\/([\w-]+)|^#\/(sandbox)/.exec(location.hash||"");if(!m)return null;if(m[3])return{mode:"sandbox"};const i=LESSONS.findIndex(l=>l.id===m[2]);return i<0?null:{mode:"lesson",i}}
function syncHash(){const h=UI.mode==="sandbox"?"#/sandbox":L_()?"#/lesson/"+L_().id:"";if(h&&location.hash!==h)try{history.replaceState(null,"",h)}catch(_){}}
window.addEventListener("hashchange",()=>{const r=routeFromHash();if(!r)return;if(r.mode==="sandbox"&&UI.mode!=="sandbox")startSandbox();else if(r.mode==="lesson"&&(UI.mode!=="lesson"||UI.lesson!==r.i))startLesson(r.i);render()});
(function boot(){const s=routeFromHash()||store.get("mode",{mode:"lesson",i:0});try{if(s.mode==="sandbox")startSandbox();else startLesson(Math.min(s.i||0,LESSONS.length-1))}catch(err){console.error(err);startLesson(0)}render();
  const btn=document.getElementById("theme");if(btn){const root=document.documentElement,cur=()=>root.dataset.theme||(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");
    const paint=()=>{btn.textContent=cur()==="dark"?"☀":"☾"};paint();btn.addEventListener("click",()=>{root.dataset.theme=cur()==="dark"?"light":"dark";store.set("theme",root.dataset.theme);paint()})}})();
window.CloudLab={STARTERS,get M(){return M},set M(v){M=v},get RT(){return RT},LESSONS,UI,T,step,deploy,deleteStack,startLesson,startSandbox,check,render,toYaml,fromYaml,edges,connectRule,doConnect,addNode,removeNode,evalRole,evalS3,inject,simPlay,probe,confirmSub,nodeOf,allNodes,edit,problems,EXPORTS,toTerraform,toCdk,cfnForAws};

/* ---------------- resizable right panel: lessons and context can take most of the screen, the canvas becomes the reference ---------------- */
function lwMax(){const side=(document.querySelector("#side")||{}).offsetWidth||0;return Math.max(LW_MIN,window.innerWidth-side-360)}
function lessonW(){let w=LW_DEF;try{const v=+localStorage.getItem("cloudlab:lessonW");if(v)w=v}catch(_){}return Math.min(Math.max(w,LW_MIN),lwMax())}
function setLessonW(w,save){w=Math.round(Math.min(Math.max(w,LW_MIN),lwMax()));document.documentElement.style.setProperty("--lesson-w",w+"px");
  const h=document.getElementById("lessonResize");if(h){h.setAttribute("aria-valuenow",w);h.setAttribute("aria-valuemin",LW_MIN);h.setAttribute("aria-valuemax",lwMax())}
  if(save)try{localStorage.setItem("cloudlab:lessonW",w)}catch(_){}return w}
function lessonBar(){const wide=lessonW()>=Math.min(lwMax(),window.innerWidth*0.5);
  return`<div class="lbar"><button class="sm ghost" data-act="lessonWide" aria-pressed="${wide}" title="${wide?"Thu hẹp khung này, trả chỗ cho canvas":"Mở rộng khung này để đọc thoải mái, canvas thu nhỏ lại"}">${wide?"⇥ Thu hẹp":"⇤ Mở rộng"}</button></div>`}
function lessonRelayout(){if(!gs().zoom)renderCanvas();renderLesson()}
setLessonW(lessonW(),false);
(function(){const h=document.getElementById("lessonResize");if(!h)return;let drag=null;
  h.addEventListener("pointerdown",e=>{if(e.button!==0)return;e.preventDefault();h.setPointerCapture(e.pointerId);drag={x0:e.clientX,w0:lessonW()};document.body.classList.add("lw-dragging")});
  h.addEventListener("pointermove",e=>{if(!drag)return;setLessonW(drag.w0+(drag.x0-e.clientX),false)});
  const end=()=>{if(!drag)return;drag=null;document.body.classList.remove("lw-dragging");setLessonW(parseInt(getComputedStyle(document.documentElement).getPropertyValue("--lesson-w"))||LW_DEF,true);lessonRelayout()};
  h.addEventListener("pointerup",end);h.addEventListener("pointercancel",end);
  h.addEventListener("dblclick",()=>{setLessonW(LW_DEF,true);lessonRelayout()});
  h.addEventListener("keydown",e=>{const k={ArrowLeft:32,ArrowRight:-32,Home:9999,End:-9999}[e.key];if(k===undefined)return;e.preventDefault();setLessonW(lessonW()+k,true);lessonRelayout()});
  window.addEventListener("resize",()=>setLessonW(lessonW(),false))})();
