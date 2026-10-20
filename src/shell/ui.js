"use strict";
const LW_DEF=380,LW_MIN=300;   /* right panel width: default and minimum (px) */
let LW_SNAP=null;              /* lwMax() measured once per render() instead of once per call (avoids layout reads) */
/* UI: shell (kit layout), palette + templates sidebar, stack bar, canvas / YAML, simulation bar with live cost meter,
   inspector drawer (properties, explanation, runtime), lesson pane, modals, events, boot. */
const KIT=window.Kit||{layer:{open(){},close(){},isOpen(){return false},top(){return null}},isNarrow(){return false}};
const L_=()=>UI.mode==="lesson"?LESSONS[UI.lesson]:null;
/* ---------------- helpers ---------------- */
function selOf(el){if(!el||el===document.body||!el.closest)return null;if(el.id)return"#"+el.id;const box=el.closest("#drawer")?"#drawer ":el.closest("#canvas")?"#canvas ":el.closest("#lesson")?"#lesson ":el.closest("#bar")?"#bar ":el.closest("#side")?"#side ":el.closest("#simbar")?"#simbar ":"";
  const q=v=>String(v).replace(/\\/g,"\\\\").replace(/"/g,'\\"');for(const k of ["node","act","edge","ptype","lesson","log","field"]){const v=el.getAttribute&&el.getAttribute("data-"+k);if(v!=null){let s=`${box}[data-${k}="${q(v)}"]`;const a=el.getAttribute("data-arg");if(a!=null)s+=`[data-arg="${q(a)}"]`;return s}}return null}
const optsOf=(types,cur)=>allNodes().filter(n=>types==="*"||types.includes(n.type)).map(n=>`<option value="${n.id}"${cur===n.id?" selected":""}>${esc(n.id)} · ${esc(n.def.label)}</option>`).join("");
const chip=(t,c)=>`<span class="chip ${c||""}">${esc(t)}</span>`;
/* write markup into a pane only when it changed: re-parsing an identical pane costs style + layout for nothing,
   and leaves focus, scroll and open menus where they were */
function setHtml(el,h){if(el.__h===h)return false;el.innerHTML=h;el.__h=h;return true}
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
  let ph="";LESSONS.forEach((l,i)=>{if(l.phase!==ph){ph=l.phase;h+=`<p class="side-group">${l.lab?esc(TX("labGroup")):""}${esc(ph)}</p>`}
    h+=`<button class="side-item lsn" data-lesson="${i}" data-cat="learn" title="${esc(l.title)}"${UI.mode==="lesson"&&UI.lesson===i?' aria-current="page"':""}><span class="side-ic" aria-hidden="true">${l.step}</span><span class="side-label">${esc(l.tag)}<small>${l.lab?"lab "+esc(l.lab):esc(l.sub||"")}</small></span>${DONE.has(l.id)?'<span class="side-badge chip ok">✓</span>':""}</button>`});
  h+=`<button class="side-collapse" data-shell-toggle aria-controls="side" title="Thu gọn / mở"><span aria-hidden="true">«</span><span class="side-label">Thu gọn</span></button>`;
  setHtml(document.getElementById("side"),h)}
/* component library docked beside the canvas (＋ Thành phần, or the / key): search, starter templates, grouped
   components; click to add, drag onto the canvas, Enter adds the highlighted one. Stays open while you build. */
function pickerHtml(){if(!UI.picker)return"";const q=UI.picker.q||"",groups=palItems(q,true),flat=groups.flatMap(g=>g[2]);UI.picker.flat=flat.map(t=>t.type);const ai=Math.min(UI.picker.active||0,Math.max(0,flat.length-1));let i=-1;
  const tpl=q?"":`<li class="pkg" role="presentation">Bắt đầu từ mẫu</li>`+Object.entries(STARTERS).map(([k,t])=>`<li role="presentation"><button class="gopt tplopt" data-act="loadTpl" data-arg="${k}" title="${esc(t.desc)}"><span class="side-ic" aria-hidden="true">▦</span><span class="gtt"><b>${esc(t.title)}</b><small>${esc(t.tag)}</small></span></button></li>`).join("")+`<li role="presentation"><button class="gopt tplopt" data-act="importYaml" title="${esc(TX("importHint"))}"><span class="side-ic" aria-hidden="true">⇩</span><span class="gtt"><b>Dán template…</b><small>Từ Gemini hoặc file YAML của bạn</small></span></button></li>`;
  return`<aside class="gpicker glib" aria-label="Thư viện thành phần"><div class="glib-h"><div><b>Thành phần</b><small>Kéo vào canvas, hoặc bấm để thêm</small></div><button class="sm ghost" data-act="picker" aria-label="Đóng thư viện thành phần" title="Đóng (Esc)">×</button></div>
    <input id="pkq" type="search" placeholder="${esc(TX("searchPh"))}" value="${esc(q)}" autocomplete="off" aria-label="Tìm thành phần" aria-controls="pklist" aria-activedescendant="pk-${ai}">
    <ul id="pklist" role="listbox" aria-label="Thành phần">${tpl}${groups.map(([g,name,items])=>`<li class="pkg" role="presentation">${esc(name)}</li>`+items.map(t=>{i++;return`<li id="pk-${i}" role="option" aria-selected="${i===ai}" class="gopt${i===ai?" on":""}" data-ptype="${t.type}" title="${esc(t.label)}"><span class="side-ic" style="--cat:var(--c-${t.cat})" aria-hidden="true">${esc(t.short)}</span><span class="gtt"><b>${esc(t.label)}</b><small>${esc((t.doc||"").split(". ")[0])}</small></span></li>`}).join("")).join("")||`<li class="gopt bad">Không có thành phần nào khớp “${esc(q)}”. ${esc(TX("searchNone"))}</li>`}</ul>
    <p class="cap gmf">↑↓ · Enter thêm · Esc đóng</p></aside>`}
const libPref=()=>{try{return localStorage.getItem("cloudlab:lib")}catch(_){return null}};
const libSave=open=>{try{localStorage.setItem("cloudlab:lib",open?"open":"closed")}catch(_){}};
function renderTop(){const cr=document.getElementById("crumb");if(!cr)return;const L=L_();setHtml(cr,L?`<span class="cc">Bài ${L.step} · ${esc(L.tag)}</span> /<b>${esc(L.title)}</b>`:`<span class="cc">Sandbox</span> /<b>${esc(M.name)}</b>`)}
function renderBar(){const s=(DOMAIN.texts.status||{})[RT.stack.status]||["",RT.stack.status],up=stackUp(),v=UI.code?(UI.split?"split":"code"):"graph";
  setHtml(document.getElementById("bar"),`<span class="stk"><span class="cap">${esc(TX("stack"))}</span><b class="mono">${esc(M.name)}</b>${chip(s[1],s[0])}</span>
    ${UI.mode==="sandbox"&&!up&&Object.keys(M.res).length+Object.keys(M.ext).length?`<button class="sm ghost" data-act="askClear" title="Xóa mọi khối khỏi canvas">Xóa canvas</button>`:""}${up?`<button class="sm danger" data-act="askDelete" title="${esc(TX("deleteTitle"))}">${esc(TX("deleteLabel"))}</button>`:`<button class="sm primary" data-act="deploy" title="${esc(TX("deployTitle"))}">${esc(TX("deployLabel"))}</button>`}
    <span class="grow"></span><div class="seg" role="group" aria-label="Chế độ sửa"><button class="${v==="graph"?"on":""}" data-act="vMode" data-arg="graph" aria-pressed="${v==="graph"}">Canvas</button><button class="${v==="split"?"on":""} hide-s" data-act="vMode" data-arg="split" aria-pressed="${v==="split"}">Chia đôi</button><button class="${v==="code"?"on":""}" data-act="vMode" data-arg="code" aria-pressed="${v==="code"}">YAML</button></div>
    <button class="icon-btn" data-act="undo" ${UNDO.length?"":"disabled"} title="Hoàn tác (Ctrl+Z)" aria-label="Hoàn tác">↶</button><button class="icon-btn" data-act="redo" ${REDO.length?"":"disabled"} title="Làm lại (Ctrl+Y)" aria-label="Làm lại">↷</button><button class="icon-btn" data-act="fullscreen" aria-pressed="${!!UI.fs}" title="${UI.fs?"Thoát toàn màn hình (Esc)":"Toàn màn hình: editor phủ màn hình, công cụ và phần giải thích nổi phía trên (phím F)"}" aria-label="${UI.fs?"Thoát toàn màn hình":"Toàn màn hình"}">${UI.fs?"⤡":"⤢"}</button>`)}
function renderCanvas(){const el=document.getElementById("canvas");if(!el)return;el.hidden=UI.code&&!UI.split;if(el.hidden)return;
  const c=canvasParts(),cv=el.__cv,w=c.world&&document.getElementById("gworld"),ul=c.rows&&el.querySelector(".glist");
  if(w&&cv&&cv.pre===c.pre&&cv.post===c.post&&el.contains(w)){gSetStyle(w,c.ws);gPatchWorld(w,c.world)}
  else if(ul&&cv&&cv.lpre===c.lpre&&cv.lpost===c.lpost&&cv.rows&&cv.rows.length===c.rows.length&&ul.children.length===c.rows.length&&cv.rows.every((r,i)=>r.id===c.rows[i].id)){const k=ul.children;c.rows.forEach((r,i)=>{if(cv.rows[i].h!==r.h)k[i].outerHTML=r.h})}
  else{el.innerHTML=canvasJoin(c);const w2=c.world&&document.getElementById("gworld");if(w2)gSnap(w2,c.world)}
  el.__cv=c.world?{pre:c.pre,post:c.post}:{lpre:c.lpre,lpost:c.lpost,rows:c.rows}}
let YAML_ERR=null,YAML_T=0;
function renderCode(force){const el=document.getElementById("code");if(!el)return;el.hidden=!UI.code;if(el.hidden)return;
  const ta=document.getElementById("yaml");if(ta&&document.activeElement===ta&&!force){const st=document.getElementById("ystat");if(st)st.innerHTML=ystat();return}
  const tab=UI.codeTab||"cfn",X=EXPORTS[tab],text=X.edit?toYaml():X.gen();
  el.innerHTML=`<div class="ctabs" role="tablist" aria-label="Định dạng IaC">${Object.entries(EXPORTS).map(([k,x])=>`<button role="tab" class="${k===tab?"on":""}" aria-selected="${k===tab}" data-act="codeTab" data-arg="${k}">${esc(x.label)}</button>`).join("")}</div>
    <div class="code-head"><span class="cap mono">${esc(X.file)}</span>${X.edit?`<span id="ystat">${ystat()}</span>`:`<span class="chip">chỉ đọc · sinh từ canvas</span>`}<span class="grow"></span><button class="sm" data-act="copyCode">Copy</button><button class="sm" data-act="dlCode">Tải xuống</button></div>
    ${X.edit?`<textarea id="yaml" class="yaml" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="${esc(X.aria||X.label)}">${esc(text)}</textarea>`:`<pre class="yaml ro" tabindex="0" aria-label="${esc(X.label)}">${esc(text)}</pre>`}
    ${X.note?`<p class="note">${X.note}</p>`:""}`}
const ystat=()=>YAML_ERR?`<span class="chip bad">Lỗi${YAML_ERR.line?" dòng "+YAML_ERR.line:""}: ${esc(YAML_ERR.err)}</span>`:`<span class="chip ok">Hợp lệ · ${Object.keys(M.res).length} tài nguyên</span>`;
function clockText(){const t=RT.t,d=Math.floor(t%MONTH/86400),h=Math.floor(t%86400/3600),m=Math.floor(t%3600/60);return`Tháng ${RT.month} · ngày ${d+1} · ${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`}
let SIM_PC="";
function renderSim(tick){const el=document.getElementById("simbar");if(!el)return;const r=rateNow();
  /* problems only change with the template (never inside a tick), so a tick reuses the last count */
  const pc=tick&&el.__s?SIM_PC:(SIM_PC=(()=>{const pr=problems(),e=pr.filter(x=>x.sev==="error").length,w=pr.filter(x=>x.sev==="warn").length;return`<button class="sm${UI.panel==="problems"?" on":""}" data-act="panel" data-arg="problems" aria-expanded="${UI.panel==="problems"}">Vấn đề <span class="chip ${e?"bad":w?"warn":"ok"}">${e||w||0}</span></button>`})());
  const A=`<button class="${RT.running?"":"primary "}play" data-act="simToggle" aria-pressed="${!!RT.running}" title="${RT.running?"Tạm dừng":"Chạy mô phỏng"}">${RT.running?"❚❚ Tạm dừng":"▶ Chạy"}</button>
    <label class="spd"><span class="cap hide-s">Tốc độ</span><select id="speed" aria-label="Tốc độ mô phỏng">${SPEEDS.map(([l],i)=>`<option value="${i}"${i===UI.speed?" selected":""}>${l}</option>`).join("")}</select></label>
    `,meter=`<span class="cap">Chi phí · ${clockText()}</span><b class="mono">${money(RT.total)}</b><small class="mono">${r>0?`≈ ${money(r)}/giờ · ${money(r*720)}/tháng`:"không có gì đang tính tiền"}</small>`,label=`Chi phí tháng này ${money(RT.total)}`,C=`
    <span class="grow"></span><button class="sm" data-act="simReset" title="Đặt lại thời gian, chi phí và dữ liệu mô phỏng">⟲<span class="hide-s"> Đặt lại</span></button>
    ${pc}
    `,D=`<button class="sm${UI.panel==="log"?" on":""}" data-act="panel" data-arg="log" aria-expanded="${UI.panel==="log"}">Event log <span class="chip">${LOG.length}</span></button>`;
  const S=el.__s;if(S&&S.A===A&&S.C===C&&el.querySelector(".meter")){
    if(S.meter!==meter||S.label!==label){const m=el.querySelector(".meter");m.setAttribute("aria-label",label);m.innerHTML=meter}
    if(S.D!==D)el.lastElementChild.outerHTML=D}
  else el.innerHTML=A+`<span class="meter" role="status" aria-label="${label}">`+meter+`</span>`+C+D;
  el.__s={A,meter,label,C,D}}
function renderLog(){const el=document.getElementById("log");if(!el)return;el.hidden=!UI.panel;if(el.hidden)return;
  if(UI.panel==="problems"){const pr=problems(),ic={error:"✕",warn:"!",info:"i"};el.classList.add("probs");setHtml(el,pr.length?`<ul class="plist">${pr.map(x=>`<li><button class="prob ${x.sev}" data-act="selNode" data-arg="${esc(x.id)}"><span class="pi" aria-hidden="true">${ic[x.sev]}</span><span class="pm">${esc(x.msg)}</span><span class="pid mono">${esc(x.id)}</span></button></li>`).join("")}</ul>`:`<div class="empty">Không có vấn đề nào. Template chưa có lỗi cấu hình hay rủi ro nào CloudLab nhận ra.</div>`);return}
  el.classList.remove("probs");const sel=LOG.find(l=>l.id===UI.logSel)||LOG.find(l=>l.cli)||LOG[0];
  const kk=l=>l.kind==="API"||l.kind==="CLI"?"api":l.kind==="Sự kiện"?"evt":"les";
  setHtml(el,`<div class="logl"><ul class="log">${LOG.slice(0,120).map(l=>`<li class="${l.id===(sel&&sel.id)?"sel":""}" data-log="${l.id}" tabindex="0"><span class="t">${l.t}</span><span class="ev ${l.tone}"><span class="k k-${kk(l)}">${esc(l.kind)}</span> ${esc(l.svc)} · ${esc(l.op)}</span><span class="m">${esc(l.msg)}</span></li>`).join("")}</ul></div>
    <div class="console"><div class="bar3"><i></i><i></i><i></i><span>${esc(TX("cli"))}</span></div>${sel&&sel.cli?`<pre id="clitext"><span class="ps">$ </span>${esc(sel.cli)}</pre>`:`<pre class="dim"># ${esc(TX("noCli"))}</pre>`}</div>`)}
function renderLesson(){const el=document.getElementById("lesson"),L=L_();
  if(!L){setHtml(el,lessonBar()+`${TX("sandboxIntro")}
    <div class="sect"><span class="lab">Bắt đầu từ</span><div class="acts">${Object.entries(STARTERS).map(([k,t])=>`<button class="sm" data-act="loadTpl" data-arg="${k}">${esc(t.title)}</button>`).join("")}<button class="sm" data-act="askClear">Canvas trống</button><button class="sm" data-act="importYaml">Dán template…</button></div>${LESSONS.map((l,i)=>`<button class="tplrow" data-act="copyLesson" data-arg="${i}"><b>${esc(l.tag)}</b><small>${esc(l.title)}</small></button>`).join("")}<p class="note">Mở template của một bài vào sandbox (không chấm điểm).</p></div>`);return}
  const R=UI.result,hs=L.hints(),passed=R?R.res.filter(Boolean).length:0,nT=L.tasks.length;
  /* three tiers: 1 what to do (goal, tasks, actions) · 2 why it matters (scenario, banking context) · 3 reference, collapsed */
  const lab=DOMAIN.lessonRef?DOMAIN.lessonRef(L):"";
  let h=lessonBar()+`<section class="ltier main" aria-label="Việc cần làm"><div><span class="cap eyebrow">${esc(L.phase||TX("phaseDefault"))} · Bài ${L.step}</span><h1>${esc(L.title)}</h1><p class="goal">${esc(L.goal)}</p></div>
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
  setHtml(el,h)}
/* ---------------- inspector: fields ---------------- */
function fieldHtml(n,f){const id=n.id,p=n.props,k=f.k;if(f.when&&!f.when(p))return"";
  const val=k.startsWith("@@")?n.raw[k.slice(2)]:k.startsWith("@")?getP(n.raw,"Metadata.CloudLab."+k.slice(1)):getP(p,k);
  const lab=`<span class="fl">${esc(f.label)}</span>`,help=f.help?`<small>${esc(f.help)}</small>`:"",da=`data-field="${esc(k)}" data-fid="${id}"`;
  const opt=(o,cur)=>{const[v,l]=Array.isArray(o)?o:[o,o];return`<option value="${esc(v)}"${String(cur??"")===String(v)?" selected":""}>${esc(l)}</option>`};
  switch(f.type){
    case"text":return`<label class="fld">${lab}<input ${da} data-ftype="text" value="${esc(typeof val==="object"&&val?(DOMAIN.fmt?DOMAIN.fmt(val):JSON.stringify(val)):val??"")}">${help}</label>`;
    case"number":return`<label class="fld">${lab}<input ${da} data-ftype="number" type="number" ${f.min!=null?`min="${f.min}"`:""} ${f.max!=null?`max="${f.max}"`:""} step="${f.step||1}" value="${esc(val??"")}">${help}</label>`;
    case"select":return`<label class="fld">${lab}<select ${da} data-ftype="${f.num?"selnum":f.bool?"selbool":"select"}">${f.options.map(o=>opt(o,val??f.dflt??"")).join("")}</select>${help}</label>`}
  /* domain field types: DOMAIN.fields[type].html(node, field, {val,lab,help,da,opt}) */
  const F=DOMAIN.fields[f.type];return F?F.html(n,f,{val,lab,help,da,opt,id,p,k}):""}
/* read a field's DOM back into a value */
function collect(fs){const t=fs.dataset.ftype;
  switch(t){
    case"text":return fs.value;case"number":return fs.value===""?undefined:Number(fs.value);case"select":return fs.value;case"selnum":return Number(fs.value);case"selbool":return fs.value==="true"}
  const F=DOMAIN.fields[t];return F?F.read(fs):undefined}
function applyField(fs){const id=fs.dataset.fid,k=fs.dataset.field,n=nodeOf(id);if(!n)return;const v=collect(fs);
  if(fs.dataset.ftype==="number"&&v!==undefined&&!(v>=0||(k==="Threshold"))){return}
  edit(`${id}.${k.replace(/^@+/,"")}`,()=>{const nn=nodeOf(id),F=DOMAIN.fields[fs.dataset.ftype];
    if(k.startsWith("@@")){if(v==="Delete"||!v)delete nn.raw[k.slice(2)];else nn.raw[k.slice(2)]=v}
    else if(k.startsWith("@")){nn.raw.Metadata=nn.raw.Metadata||{};nn.raw.Metadata.CloudLab=nn.raw.Metadata.CloudLab||{};nn.raw.Metadata.CloudLab[k.slice(1)]=v}
    else if(F&&F.write)F.write(nn,k,v,fs);
    else setP(nn.props,k,v===null&&!(DOMAIN.keepNull||[]).includes(k)?undefined:v)})}
/* ---------------- inspector: runtime ---------------- */
function costRows(id){const r=RT.n[id];if(!r||!r.costBy)return"";return kvl(Object.entries(r.costBy).map(([k,v])=>["Chi phí · "+k,money(v)]))}
const kvl=rows=>`<dl class="kv-list">${rows.map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
function rtHtml(id){const n=nodeOf(id);if(!n)return"";const r=RT.n[id]||{m:{},series:[]},m=r.m,p=n.props;
  if(!exists(id)&&!n.ext)return`<div class="empty">${esc(TX("notDeployed",RT.stack.status))}</div>`;
  return(DOMAIN.rt?DOMAIN.rt(n,{r,m,p}):"")+costRows(id)}
function nodeActs(n){const id=n.id;return(DOMAIN.nodeActs?DOMAIN.nodeActs(n):"")+`<button class="sm" data-act="connectFrom" data-arg="${id}">Nối tới…</button><button class="sm danger" data-act="askDelNode" data-arg="${id}">${esc(n.scope==="manual"?TX("deleteManual"):"Xóa khối")}</button>`}
let DRAWER_KEY=null;
function renderDrawer(){const el=document.getElementById("drawer");if(!el)return;const S=UI.sel;let c=null;
  if(S&&S.node&&nodeOf(S.node)){const n=nodeOf(S.node),L=L_(),ex=L&&L.explain&&L.explain[n.id],v=nodeView(n);
    c={key:"n:"+n.id,cat:n.def.cat,icon:n.def.short,eyebrow:n.def.label+(n.scope==="manual"?" · "+TX("manualTag"):n.ext?" · "+TX("extTag"):""),title:n.id,status:v.st?chip(v.st[1],v.st[0]):"",
      body:(DOMAIN.eli5&&DOMAIN.eli5(n.type)?`<div class="callout eli5"><b>Hiểu nhanh</b>${esc(DOMAIN.eli5(n.type))}</div>`:"")+(ex?`<div class="callout ctx"><b>Trong bài này</b>${esc(ex)}</div>`:"")+`<details class="doc"${ex||(DOMAIN.eli5&&DOMAIN.eli5(n.type))?"":" open"}><summary>${esc(n.def.label)} là gì?</summary><p>${esc(n.def.doc||"")}</p></details>`+
        `<p class="lab">Cấu hình</p><label class="fld"><span class="fl">${esc(TX("idLabel"))}</span><input data-act="rename" id="f-lid" data-fid="${n.id}" value="${esc(n.id)}"></label>`+n.def.fields.map(f=>fieldHtml(n,f)).join("")+
        `<p class="lab">Đang chạy</p><div class="rt" id="rt">${rtHtml(n.id)}</div>`,foot:nodeActs(n)}}
  else if(S&&S.edge){const e=(GLAST?GLAST.edges:edges()).find(x=>x.id===S.edge);if(e){const v=edgeView(e),f=RT.flow[e.id]||{ok:0,err:0};
    c={key:"e:"+e.id,cat:"learn",icon:"→",eyebrow:"Mũi tên · "+e.kind,title:`${e.from} → ${e.to}`,status:chip(v.st==="ok"?"đang chạy":v.st==="stop"?"bị chặn":v.st==="blocked"?"bị chặn đúng ý":v.st==="loop"?"vòng lặp":v.st==="leak"?"lẽ ra phải bị chặn":"chưa có dữ liệu",{ok:"ok",stop:"bad",loop:"bad",leak:"bad",blocked:"ok"}[v.st]||""),
      body:`<p>${esc((DOMAIN.relDoc||{})[e.kind]||"Khối này tham chiếu tới khối kia.")}</p>`+kvl([["Khai báo ở",`<span class="mono">${esc(e.owner)}.${esc(e.path)}</span>`],["Thành công",num(f.ok)],["Lỗi / bị chặn",num(f.err)]])+(v.why?`<div class="callout"><b>Lý do</b>${esc(v.why)}</div>`:""),
      foot:`<button class="sm" data-act="selNode" data-arg="${e.from}">${esc(e.from)}</button><button class="sm" data-act="selNode" data-arg="${e.to}">${esc(e.to)}</button><button class="sm danger" data-act="delEdge" data-arg="${esc(e.id)}">Xóa mũi tên</button>`}}}
  if(!c){if(DRAWER_KEY){DRAWER_KEY=null;UI.sel=null;el.hidden=true;el.innerHTML="";KIT.layer.close(el)}return}
  const ae=document.activeElement,inside=ae&&el.contains(ae)?selOf(ae):null;
  el.dataset.cat=c.cat;el.setAttribute("aria-labelledby","dt");
  el.innerHTML=`<div class="drawer-grab" aria-hidden="true"></div><div class="drawer-head"><div class="drawer-eyebrow"><span class="side-ic" style="--cat:var(--c-${c.cat})" aria-hidden="true">${esc(c.icon)}</span><span class="grow">${esc(c.eyebrow)}</span><button class="modal-x" data-act="closeDrawer" aria-label="Đóng">✕</button></div><h2 class="drawer-title" id="dt" tabindex="-1">${esc(c.title)}</h2>${c.status?`<div class="drawer-status">${c.status}</div>`:""}</div><div class="drawer-body">${c.body}</div>${c.foot?`<div class="drawer-foot">${c.foot}</div>`:""}`;
  if(!DRAWER_KEY){el.hidden=false;KIT.layer.open(el,{modal:KIT.isNarrow(),returnFocus:UI.selRet,onClose:()=>{UI.sel=null;render()},initialFocus:"#dt"})}
  else if(inside){const x=el.querySelector(inside);if(x)try{x.focus({preventScroll:true})}catch(_){}}else if(DRAWER_KEY!==c.key){const t=document.getElementById("dt");if(t)t.focus({preventScroll:true})}
  DRAWER_KEY=c.key}
function refreshRt(){const rt=document.getElementById("rt");if(!rt||!UI.sel||!UI.sel.node)return;const ae=document.activeElement;if(ae&&rt.contains(ae)&&ae.tagName==="INPUT")return;setHtml(rt,rtHtml(UI.sel.node))}
/* ---------------- modal ---------------- */
let MODAL_SHOWN=null;
function renderModal(){const el=document.getElementById("modal"),Md=UI.modal;
  if(!Md){if(MODAL_SHOWN){MODAL_SHOWN=null;const d=el.querySelector(".modal");if(d)KIT.layer.close(d);el.innerHTML=""}return}
  if(Md===MODAL_SHOWN)return;const prev=el.querySelector(".modal");if(prev)KIT.layer.close(prev);Md.ret=Md.ret||UI.lastOpener;
  const v=modalValues();
  el.innerHTML=`<div class="scrim" data-act="scrim"><div class="modal" aria-labelledby="mt"><div class="modal-head"><h3 id="mt">${esc(Md.title)}</h3><button class="modal-x" data-act="closeModal" aria-label="Đóng">✕</button></div>${Md.body||""}
    ${(Md.fields||[]).map(f=>f.type==="checks"?`<fieldset class="fld"><legend>${esc(f.label)}</legend>${f.items.map(([k,l])=>`<label class="ck"><input type="checkbox" id="m-${k}" ${Md.init[k]?"checked":""}> ${esc(l)}</label>`).join("")}</fieldset>`:f.type==="textarea"?`<label class="fld">${esc(f.label)}<textarea id="m-${f.id}" rows="${f.rows||12}" spellcheck="false" class="mono" placeholder="${esc(f.ph||"")}">${esc(Md.init[f.id]??"")}</textarea></label>`:`<label class="fld">${esc(f.label)}<input id="m-${f.id}" value="${esc(Md.init[f.id]??"")}"></label>`).join("")}
    <div id="mnote">${Md.note?Md.note(v):""}</div><p class="ferr" id="merr" role="alert">${esc(Md.err||"")}</p>
    <div class="mfoot"><button class="ghost" data-act="closeModal">${esc(Md.cancel||"Hủy")}</button>${Md.submitLabel?`<button class="primary ${Md.danger?"dangerbtn":""}" data-act="submitModal">${esc(Md.submitLabel)}</button>`:""}</div></div></div>`;
  MODAL_SHOWN=Md;KIT.layer.open(el.querySelector(".modal"),{modal:true,returnFocus:Md.ret,onClose:()=>{UI.modal=null;render()},initialFocus:el.querySelector(".modal input")||el.querySelector(".mfoot .primary")})}
function modalValues(){const Md=UI.modal,v={...(Md?Md.init:{})};if(!Md)return v;for(const f of Md.fields||[]){if(f.type==="checks")f.items.forEach(([k])=>{const e=document.getElementById("m-"+k);if(e)v[k]=e.checked?1:0});else{const e=document.getElementById("m-"+f.id);if(e)v[f.id]=e.value}}return v}
function confirmModal(title,body,label,fn,danger){UI.modal={title,body:`<p>${body}</p>`,submitLabel:label,danger,cancel:danger?"Giữ nguyên":undefined,init:{},fields:[],submit:()=>{const r=fn();return r&&r.ok===false?r:{ok:true}}}}
/* ---------------- render ---------------- */
function render(){LW_SNAP=null;LW_SNAP=lwMax();try{renderAll()}finally{LW_SNAP=null}if(UI.fs)fsMeasure()}
function renderAll(){syncHash();const ae=document.activeElement,keep=ae&&ae!==document.body&&!(ae.closest&&ae.closest("#modal"))?selOf(ae):null;
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
function onModelChanged(label,cli){if(stackUp()&&!QUIET&&DOMAIN.redeploy)DOMAIN.redeploy(label,cli);
  YAML_ERR=null;saveSandbox();render()}
function onSimTick(){gRefresh();renderSim(true);refreshRt();if(UI.panel==="log"&&LOG.length&&LOG[0].id!==onSimTick.last){onSimTick.last=LOG[0].id;renderLog()}}
function saveSandbox(){if(UI.mode!=="sandbox")return;store.set("sandbox",{yaml:toYaml(),pos:M.pos,manual:M.manual,name:M.name})}
/* ---------------- simulation clock ---------------- */
let TIMER=null;
function simPlay(on){RT.running=!!on;if(on){if(!stackUp()&&Object.keys(M.res).length&&RT.stack.status!=="DELETE_COMPLETE")deploy();if(!TIMER)TIMER=setInterval(()=>{if(document.hidden)return;step(SPEEDS[UI.speed][1]*0.25);onSimTick()},250)}
  else if(TIMER){clearInterval(TIMER);TIMER=null}renderSim();gRefresh()}
/* ---------------- modes ---------------- */
function resetUi(){if(TIMER){clearInterval(TIMER);TIMER=null}if(RT)RT.running=false;UI.sel=null;UI.result=null;UI.hints=0;UI.attempt=0;UI.dirty=false;UI.gmenu=null;UI.gdrag=null;UI.tour=-1;UI.mailOpen=null;if(UI.g){UI.g.zoom=null;UI.g.trace=false}UNDO=[];REDO=[]}
function startLesson(i,quiet){const L=LESSONS[i];resetUi();UI.mode="lesson";UI.picker=null;UI.lesson=i;UI.speed=L.speed??2;
  M=loadTemplate(L.yaml,L.layout,"lab-"+L.id,L.manual);RT=freshRuntime();QUIET++;deploy();QUIET--;RT.stack.status="CREATE_COMPLETE";syncRuntime();
  store.set("mode",{mode:"lesson",i});if(!quiet)log("Bài học","lesson","setup",`Bài ${L.step}: ${L.title} · ${TX("lessonReady",M.name)}`,"")}
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
    undo,redo,deploy(){deploy();gs().zoom=null},
    vMode(){UI.code=arg!=="graph";UI.split=arg==="split";YAML_ERR=null},
    simToggle(){simPlay(!RT.running);return true},simReset(){const was=RT.running;simPlay(false);if(UI.mode==="lesson")startLesson(UI.lesson,true);else{RT=freshRuntime();if(Object.keys(M.res).length){QUIET++;deploy();QUIET--;RT.stack.status="CREATE_COMPLETE";syncRuntime()}}log("CloudLab","sim","reset","đặt lại thời gian, chi phí và dữ liệu mô phỏng","");if(was)simPlay(true)},
    logToggle(){UI.panel=UI.panel?null:"log";UI.logOpen=!!UI.panel},picker(){UI.picker=UI.picker?null:{q:"",active:0};libSave(!!UI.picker);UI.gfocus=UI.picker?"#pkq":null;gs().zoom=null},
    loadTpl(){const t=STARTERS[arg];confirmModal(`Mở mẫu “${t.title}”?`,`${esc(t.desc)}<br><br>Mẫu này sẽ thay toàn bộ canvas sandbox hiện tại.`,"Mở mẫu",()=>{startSandbox(loadTemplate(t.yaml,t.layout,"sandbox"));UI.sideTab="comp";gs().zoom=null})},
    gFit(){const G=gs();G.zoom=null},gNoteClose(){UI.gnote=null},fullscreen(){setFullscreen(!UI.fs)},descMin(){UI.descMin=!UI.descMin;applyFs()},importYaml(){openImport()},lessonWide(){const wide=lessonW()>=Math.min(lwMax(),window.innerWidth*0.5);setLessonW(wide?LW_DEF:Math.round(window.innerWidth*0.55),true);gs().zoom=null},gZoom(){gZoomAt(GCUR.z*(arg==="1"?1.2:1/1.2));return true},gTrace(){gs().trace=!gs().trace},gView(){gs().view=arg;UI.gmenu=null},
    gMenu(){UI.gmenu=UI.gmenu&&UI.gmenu.from===arg?null:{from:arg,active:0};UI.gfocus=UI.gmenu?"#glist":`[data-gconnect="${arg}"]`},
    connectFrom(){UI.sel=null;UI.code=false;UI.gmenu={from:arg,active:0};UI.gfocus="#glist"},
    gPick(){if(!UI.gmenu||!connectRule(UI.gmenu.from,arg))return true;doConnect(UI.gmenu.from,arg);UI.gmenu=null},
    closeDrawer(){UI.sel=null},selNode(){UI.sel={node:arg};UI.selRet=null;UI.gfocus="#dt"},
    delEdge(){const e=edges().find(x=>x.id===arg);if(e){edit("xóa mũi tên",()=>removeEdge(e));log("CloudLab","editor","disconnect",`${e.from} → ${e.to}`,"warn")}UI.sel=null},
    askDelNode(){const n=nodeOf(arg);if(!n)return;if(DOMAIN.beforeDelete&&DOMAIN.beforeDelete(n)===false){UI.modal=null;return}
      const refs=edges().filter(e=>e.to===arg||e.from===arg).length;confirmModal(`Xóa ${arg}?`,`${esc(n.def.label)} sẽ bị bỏ khỏi ${n.scope==="manual"?esc(TX("manualWhere")):esc(TX("modelWhere"))}${refs?`, cùng ${refs} mũi tên nối với nó`:""}.`,n.scope==="manual"?TX("deleteManual"):"Xóa khối",()=>{edit("xóa "+arg,()=>removeNode(arg));if(DOMAIN.afterDelete)DOMAIN.afterDelete(n);UI.sel=null},true)},
    check(){check()},hint(){UI.hints=Math.min(UI.hints+1,L_().hints().length);log("Bài học","lesson","hint",`mở gợi ý ${UI.hints}`,"")},
    askSkip(){confirmModal("Làm hộ bài này?","CloudLab sẽ sửa template giúp bạn và ghi từng bước vào Event log. Bài được tính là đã xem, không tính là đạt.","Làm hộ",()=>{const L=L_();L.solve();check();if(UI.result.ok){DONE.delete(L.id);store.set("done",[...DONE]);UI.result.skipped=true;UI.result.msg="Mở YAML và Event log để xem từng thay đổi. Bài được tính là đã xem, chưa đạt."}})},
    askReset(){confirmModal("Bắt đầu lại bài này?","Template và dữ liệu mô phỏng quay về như lúc mở bài. Event log giữ nguyên.","Bắt đầu lại",()=>startLesson(UI.lesson),true)},
    openSandbox(){if(UI.mode!=="sandbox")startSandbox()},
    askClear(){confirmModal("Xóa hết canvas?","Mọi khối trong sandbox sẽ bị xóa. Không hoàn tác được.","Xóa hết",()=>startSandbox(emptyModel("sandbox")),true)},
    copyLesson(){const L=LESSONS[+arg];confirmModal(`Mở template “${L.tag}” trong sandbox?`,"Template này sẽ thay canvas sandbox hiện tại. Sandbox không chấm điểm.","Mở trong sandbox",()=>startSandbox(loadTemplate(L.yaml,L.layout,"sandbox",L.manual)))},
    tour(){const L=L_();const ids=Object.keys(L.explain||{}).filter(id=>nodeOf(id));if(UI.tour>=0){UI.tour=-1;UI.sel=null;return}UI.tour=0;UI.sel={node:ids[0]};UI.gfocus="#dt"},
    codeTab(){UI.codeTab=arg;renderCode(true);return true},
    copyCode(){const X=EXPORTS[UI.codeTab||"cfn"];try{navigator.clipboard.writeText(X.edit?toYaml():X.gen());t.textContent="Đã copy"}catch(_){}return true},
    dlCode(){const X=EXPORTS[UI.codeTab||"cfn"];download(X.file,X.edit?toYaml():X.gen());log("CloudLab","iac","export",X.file,"ok");return true},
    panel(){UI.panel=UI.panel===arg?null:arg;UI.logOpen=!!UI.panel},
    rowDel(){const fs=t.closest("[data-ftype]");t.closest(".frow").remove();applyField(fs)},
    submitModal(){const Md=UI.modal,v=modalValues(),r=Md.submit(v);if(r&&r.ok===false){Md.err=r.err;const er=document.getElementById("merr");if(er)er.textContent=r.err;return true}if(UI.modal===Md)UI.modal=null},
  };
  const h=A[a]||(DOMAIN.actions[a]&&(()=>DOMAIN.actions[a](arg,t,e)));if(h){const keep=h();if(keep!==true)render()}});
document.addEventListener("change",e=>{const t=e.target;
  if(t.id==="speed"){UI.speed=+t.value;return}
  if(t.id==="f-lid"){const a=t.dataset.fid,b=t.value.trim();let r;edit("đổi tên",()=>{r=renameNode(a,b)});if(!r.ok){undo();UNDO.pop();t.setAttribute("aria-invalid","true");log("CloudLab","editor","rename",r.err,"bad");return}UI.sel={node:b};render();return}
  if(DOMAIN.onChange&&DOMAIN.onChange(t)===true)return;
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
  if(DOMAIN.onDrop&&GLAST)DOMAIN.onDrop(id,type,x,y,GLAST.boxes);
  UI.sel={node:id};UI.selRet=`[data-node="${id}"]`;saveSandbox();render();return id}
let PD=null,PD_SUPPRESS=0;
document.addEventListener("pointerdown",e=>{if(e.button!==0||!e.target.closest)return;const it=e.target.closest("[data-ptype]");if(!it)return;PD={type:it.dataset.ptype,x0:e.clientX,y0:e.clientY,el:it,ghost:null,pid:e.pointerId}});
document.addEventListener("pointermove",e=>{if(!PD||e.pointerId!==PD.pid)return;
  if(!PD.ghost){if(Math.hypot(e.clientX-PD.x0,e.clientY-PD.y0)<6)return;const d=T[PD.type],g=document.createElement("div");g.className="pal-ghost";g.setAttribute("aria-hidden","true");
    g.innerHTML=`<span class="side-ic" style="--cat:var(--c-${d.cat})">${esc(d.short)}</span><span>${esc(d.label)}</span>`;document.body.appendChild(g);PD.ghost=g;document.body.classList.add("pal-dragging");
    try{PD.el.releasePointerCapture&&PD.el.releasePointerCapture(e.pointerId)}catch(_){}}
  e.preventDefault();PD.ghost.style.transform=`translate(${e.clientX+12}px,${e.clientY+12}px)`;
  const el=document.elementFromPoint(e.clientX,e.clientY),gx=el&&el.closest&&el.closest(".gx");PD.ghost.classList.toggle("ok",!!gx);
  gDirty();document.querySelectorAll(".gx").forEach(x=>x.classList.toggle("pal-over",x===gx));
  /* show which container (VPC/subnet, namespace…) the drop would land in */
  let hb=null;if(gx&&GLAST&&DOMAIN.dropHint){const[wx,wy]=toWorld(e.clientX,e.clientY);hb=DOMAIN.dropHint(PD.type,wx,wy,GLAST.boxes)}
  document.querySelectorAll(".gbox").forEach(x=>x.classList.toggle("drop",x.dataset.gid===hb))},{passive:false});
function palEnd(e,cancel){if(!PD)return;const d=PD;PD=null;gDirty();document.body.classList.remove("pal-dragging");document.querySelectorAll(".gx.pal-over").forEach(x=>x.classList.remove("pal-over"));document.querySelectorAll(".gbox.drop").forEach(x=>x.classList.remove("drop"));
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
/* short message on the canvas, e.g. why a connection was refused */
let GNOTE_T=0;function gNote(text,kind){UI.gnote={text,kind:kind||"warn"};clearTimeout(GNOTE_T);GNOTE_T=setTimeout(()=>{UI.gnote=null;render()},7000)}
document.addEventListener("pointermove",e=>{if(!GD||GD.kind==="edge")return;const dx=e.clientX-GD.x0,dy=e.clientY-GD.y0;if(!GD.moved&&Math.hypot(dx,dy)<5)return;
  if(!GD.moved){GD.moved=true;gFreeze();UI.gmenu=null;if(GD.kind==="connect")UI.gdrag={from:GD.id}}const z=GCUR.z;
  if(GD.kind==="pan"){GCUR.pan=[GD.pan0[0]+dx,GD.pan0[1]+dy];gs().pan=[...GCUR.pan];gApply()}
  else if(GD.kind==="node"){M.pos[GD.id]=[Math.round(GD.pos0[0]+dx/z),Math.round(GD.pos0[1]+dy/z)];const n=nodeOf(GD.id);
    if(n&&DOMAIN.dragHint){const c=[M.pos[GD.id][0]+GW/2,M.pos[GD.id][1]+40],h=DOMAIN.dragHint(n,c,GD.boxes);if(h!==undefined)UI.gdropBox=h}gRefresh()}
  else if(GD.kind==="box"){for(const k of Object.keys(GD.pos0))M.pos[k]=[Math.round(GD.pos0[k][0]+dx/z),Math.round(GD.pos0[k][1]+dy/z)];gRefresh()}
  else{const el=document.elementFromPoint&&document.elementFromPoint(e.clientX,e.clientY),on=el&&el.closest&&el.closest(".gnode");UI.gdrag.at=toWorld(e.clientX,e.clientY);UI.gdrag.over=on?on.dataset.gid:null;gRefresh();GD.gx.classList.add("connecting");gDirty()}});
function gEnd(cancel){if(!GD)return;const d=GD;GD=null;if(!d.moved)return;GSUP=Date.now();
  if(d.kind==="node"){const n=nodeOf(d.id);if(n&&DOMAIN.onDragEnd)DOMAIN.onDragEnd(n,[M.pos[d.id][0]+GW/2,M.pos[d.id][1]+40],d.boxes);UI.gdropBox=null;saveSandbox();render()}
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
window.CloudLab=Object.assign({STARTERS,get M(){return M},set M(v){M=v},get RT(){return RT},LESSONS,UI,T,DOMAIN,step,deploy,deleteStack,startLesson,startSandbox,check,render,toYaml,fromYaml,edges,connectRule,doConnect,addNode,removeNode,inject,simPlay,probe,nodeOf,allNodes,edit,problems,EXPORTS},DOMAIN.api||{});

/* ---------------- resizable right panel: lessons and context can take most of the screen, the canvas becomes the reference ---------------- */
function lwMax(){if(LW_SNAP!=null)return LW_SNAP;const side=(document.querySelector("#side")||{}).offsetWidth||0;return Math.max(LW_MIN,window.innerWidth-side-360)}
function lessonW(){let w=LW_DEF;try{const v=+localStorage.getItem("cloudlab:lessonW");if(v)w=v}catch(_){}return Math.min(Math.max(w,LW_MIN),lwMax())}
function setLessonW(w,save){w=Math.round(Math.min(Math.max(w,LW_MIN),lwMax()));document.documentElement.style.setProperty("--lesson-w",w+"px");
  const h=document.getElementById("lessonResize");if(h){h.setAttribute("aria-valuenow",w);h.setAttribute("aria-valuemin",LW_MIN);h.setAttribute("aria-valuemax",lwMax())}
  if(save)try{localStorage.setItem("cloudlab:lessonW",w)}catch(_){}return w}
function lessonBar(){const wide=lessonW()>=Math.min(lwMax(),window.innerWidth*0.5);
  return`<div class="lbar">${UI.fs?`<button class="sm ghost fs-only" data-act="descMin" aria-pressed="${!!UI.descMin}" title="${UI.descMin?"Mở lại phần giải thích":"Thu nhỏ phần giải thích để nhìn trọn sơ đồ"}">${UI.descMin?"▾ Mở giải thích":"▴ Thu nhỏ"}</button>`:""}<button class="sm ghost" data-act="lessonWide" aria-pressed="${wide}" title="${wide?"Thu hẹp khung này, trả chỗ cho canvas":"Mở rộng khung này để đọc thoải mái, canvas thu nhỏ lại"}">${wide?"⇥ Thu hẹp":"⇤ Mở rộng"}</button></div>`}
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

/* paste a template (CloudFormation, Kubernetes manifests… whatever the domain's fromYaml reads; for example one Gemini or another assistant wrote for the learner's own case,
   following learn.html#gemini) into the sandbox; #/import opens this directly */
function openImport(){UI.modal={title:"Dán template vào sandbox",submitLabel:"Mở trong sandbox",init:{yaml:""},
  body:TX("importBody"),
  fields:[{type:"textarea",id:"yaml",label:"Template (YAML)",rows:14,ph:TX("importPh")}],
  submit:v=>{const y=String(v.yaml||"").trim();if(!y)return{ok:false,err:"Chưa có nội dung. Dán YAML vào ô trên."};
    const r=fromYaml(y,{name:"sandbox"});if(!r.ok)return{ok:false,err:`YAML lỗi${r.line?` ở dòng ${r.line}`:""}: ${r.err}`};
    if(!Object.keys(r.model.res).length&&!Object.keys(r.model.ext).length)return{ok:false,err:TX("importEmpty")};
    startSandbox(r.model);gs().zoom=null;log("CloudLab","editor","import",`Mở template dán vào · ${Object.keys(r.model.res).length} tài nguyên`,"ok");return{ok:true}}};render()}
window.addEventListener("hashchange",()=>{if(/^#\/import/.test(location.hash))setTimeout(openImport,0)});
if(/^#\/import/.test(location.hash))setTimeout(openImport,0);

/* ---------------- full screen: the editor covers the screen; toolbars, library, simulation bar and the description
   panel float above it. Uses the browser Fullscreen API when available (Esc exits), else just the layout. ---------------- */
/* full screen: measure the floating bars so the panels below them start where they end (bars wrap on narrow screens) */
let FS_RO=null;
function fsMeasure(){const sh=document.querySelector("[data-shell]");if(!sh||!UI.fs)return;const q=s=>document.querySelector(s),h=e=>e&&!e.hidden?Math.ceil(e.getBoundingClientRect().height):0;
  const tools=h(q(".gx-tools")),stack=h(q("#bar")),sim=h(q("#simbar")),top=12+tools+8+stack;
  const set=(k,v)=>{if(sh.style.getPropertyValue(k)!==v)sh.style.setProperty(k,v)};set("--fs-tools-h",tools+"px");set("--fs-top",top+"px");set("--fs-sim-h",sim+"px");
  if(!FS_RO&&window.ResizeObserver){FS_RO=new ResizeObserver(()=>{if(UI.fs)fsMeasure()});["#bar","#simbar"].forEach(s=>{const e=q(s);if(e)FS_RO.observe(e)})}}
function applyFs(){const sh=document.querySelector("[data-shell]");if(!sh)return;sh.toggleAttribute("data-fs",!!UI.fs);sh.toggleAttribute("data-desc-min",!!(UI.fs&&UI.descMin));gs().zoom=null;render()}
function setFullscreen(on){UI.fs=!!on;if(!on)UI.descMin=false;const sh=document.querySelector("[data-shell]");
  /* the whole document goes full screen, so the inspector drawer and dialogs (outside the shell) stay visible */
  try{const de=document.documentElement;if(on&&de.requestFullscreen&&!document.fullscreenElement)de.requestFullscreen().catch(()=>{});else if(!on&&document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen().catch(()=>{})}catch(_){}
  applyFs()}
document.addEventListener("fullscreenchange",()=>{if(!document.fullscreenElement&&UI.fs){UI.fs=false;UI.descMin=false;applyFs()}});
document.addEventListener("keydown",e=>{const typing=/^(INPUT|TEXTAREA|SELECT)$/.test((e.target||{}).tagName||"")||(e.target&&e.target.isContentEditable);
  if(typing||e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.key==="f"||e.key==="F"){if(document.querySelector("#modal .modal, .tour-card"))return;e.preventDefault();setFullscreen(!UI.fs)}
  else if(e.key==="Escape"&&UI.fs&&!document.fullscreenElement&&!UI.modal&&!UI.picker&&!UI.sel){setFullscreen(false)}});
