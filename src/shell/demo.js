"use strict";
/* "Làm hộ" as a demo: CloudLab plays the answer on screen. For each step a pointer moves to the block, opens it,
   points at the field (or drags the arrow, or drops the block into its box, or takes it from the library), the change
   happens, then the drawer closes and the next step starts. The learner watches it done in the UI they will use.

   A step's gestures are step.demo: [[verb, ...args], …]; args may be functions (ids known only at run time).
     select id          click a block (or a box header) → its drawer opens
     field key [say]    point at the drawer field data-field=key (highlighted)
     button act [arg]   point at a button data-act=act (data-arg=arg), drawer first
     bar act            point at a stack bar button (Deploy, Xóa stack)
     connect a b        drag an arrow from a's out-port to b (block or box)
     drop a box         drag block a into box
     add type x y       ＋ Thành phần → the type → drag it to world (x, y)
     apply              make the change now (default: after the last gesture)
   Without step.demo: select step.at, then apply. The change itself is always step.run() (same as "Làm hộ bước này"). */
const DEMO={on:false,paused:false,fast:false,speed:1,tok:0,cap:"",title:"",focus:new Set(),trace0:false};
/* while it plays the canvas is in Trace mode on the blocks this step touches, and nothing else takes input:
   clicks are off (CSS), keys too, except Space (pause) and Esc (stop) */
document.addEventListener("keydown",e=>{if(!DEMO.on)return;const t=e.target;if(t&&t.closest&&t.closest(".demo-ctl"))return;
  if(e.key==="Escape"){demoStop()}else if(e.key===" "){DEMO.paused=!DEMO.paused;dBar()}else if(e.key==="Tab")return;e.preventDefault();e.stopPropagation()},true);
const DEMO_STOP={stop:1};
const dArg=v=>typeof v==="function"?v():v;
const reduced=()=>!!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches);
function dSleep(ms){return new Promise(r=>setTimeout(r,DEMO.fast?0:ms/DEMO.speed))}
async function dCheck(tok){while(DEMO.paused&&DEMO.tok===tok)await new Promise(r=>setTimeout(r,120));if(DEMO.tok!==tok)throw DEMO_STOP}
function dEl(id,html,cls){let e=document.getElementById(id);if(!e){e=document.createElement("div");e.id=id;e.className=cls;e.innerHTML=html;document.body.appendChild(e)}return e}
const dCursor=()=>dEl("dcur",`<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.4-3.4-6.7L4 20z"/></svg><i></i><span hidden></span>`,"dcur");
/* no bar: the screen is blocked while it plays, so what is being done rides with the pointer, the step list in the
   lesson panel shows progress, and the panel's Dừng button (or Esc; Space pauses) stops it */
function dBar(){const c=dCursor();c.classList.toggle("paused",DEMO.paused);dSay(DEMO.cap)}
function dSay(t){DEMO.cap=t||"";const c=document.getElementById("dcur");if(c){const s=c.querySelector("span");if(s){s.textContent=DEMO.paused?"Tạm dừng · Space để tiếp":DEMO.cap;s.hidden=!s.textContent}}}
const dCenter=el=>{const r=el.getBoundingClientRect();return[r.left+r.width/2,r.top+r.height/2]};
const dVisible=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth};
async function dMove(el,tok,pt){if(!el)return;if(!dVisible(el)){el.scrollIntoView({block:"center",inline:"center"});await dSleep(120)}
  const[x,y]=pt||dCenter(el),c=dCursor();c.hidden=false;c.style.transitionDuration=reduced()||DEMO.fast?"0ms":Math.round(560/DEMO.speed)+"ms";c.style.transform=`translate(${x}px,${y}px)`;await dSleep(620);await dCheck(tok)}
async function dClick(tok){const c=dCursor();c.classList.remove("tap");void c.offsetWidth;c.classList.add("tap");await dSleep(260);await dCheck(tok)}
/* bring a block of the canvas into view (graph view, centred if it is off screen) */
async function dReveal(id,tok){const G=gs();if(UI.code&&!UI.split){UI.code=false;render()}if(G.view==="list"||(KIT.isNarrow()&&G.view!=="graph")){G.view="graph";render();await dSleep(150)}
  const gx=document.querySelector(".gx"),L=GLAST,n=L&&L.by[id];if(!gx||!n)return;const r=gx.getBoundingClientRect(),z=GCUR.z;
  const sx=r.left+GCUR.pan[0]+n.x*z,sy=r.top+GCUR.pan[1]+n.y*z,inside=sx>=r.left+8&&sy>=r.top+8&&sx+n.w*z<=r.right-8&&sy+Math.min(n.h,80)*z<=r.bottom-8;
  if(!inside){G.zoom=z;G.pan=[r.width/2-(n.x+n.w/2)*z,r.height/2-(n.y+Math.min(n.h,80)/2)*z];GCUR.pan=G.pan.slice();gApply();await dSleep(200)}
  if(!dVisible(gx))gx.scrollIntoView({block:"nearest"});await dCheck(tok)}
const dNodeEl=id=>document.querySelector(`.gnode[data-gid="${id}"] .gn`)||document.querySelector(`.gbox[data-gid="${id}"] .gbox-h`)||document.querySelector(`[data-node="${id}"]`);
const dLabel=el=>{const f=el&&el.closest(".fld");const l=f&&(f.querySelector(".fl,legend"));return l?l.textContent.trim():""};
function dHl(el,on){const f=el&&(el.closest(".fld")||el);if(f)f.classList.toggle("demo-hl",on)}
/* a line from a to the pointer while dragging, and a ghost of a dragged block */
function dLine(a,b){const s=dEl("dline",`<svg width="100%" height="100%"><line/></svg>`,"dline");const l=s.querySelector("line");s.hidden=false;
  l.setAttribute("x1",a[0]);l.setAttribute("y1",a[1]);l.setAttribute("x2",a[0]);l.setAttribute("y2",a[1]);
  l.style.transition=reduced()||DEMO.fast?"none":`all ${Math.round(560/DEMO.speed)}ms ease`;requestAnimationFrame(()=>{l.setAttribute("x2",b[0]);l.setAttribute("y2",b[1])})}
function dGhost(el){const g=dEl("dghost","","dghost");const r=el.getBoundingClientRect();g.innerHTML=el.outerHTML;g.style.cssText=`left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;transform:none`;g.hidden=false;return g}
function dGhostTo(g,x,y){const r=g.getBoundingClientRect();g.style.transition=reduced()||DEMO.fast?"none":`transform ${Math.round(560/DEMO.speed)}ms ease`;g.style.transform=`translate(${x-r.left-r.width/2}px,${y-r.top-Math.min(r.height,60)/2}px)`}
function dClean(){for(const id of["dline","dghost"]){const e=document.getElementById(id);if(e)e.hidden=true}document.querySelectorAll(".demo-hl").forEach(e=>e.classList.remove("demo-hl"))}
/* world (canvas) point → screen */
function dWorld(x,y){const gx=document.querySelector(".gx");if(!gx)return[innerWidth/2,innerHeight/2];const r=gx.getBoundingClientRect();return[r.left+GCUR.pan[0]+x*GCUR.z,r.top+GCUR.pan[1]+y*GCUR.z]}

async function demoGesture(g,s,tok,apply){const[v,...a0]=g,a=a0.map(dArg);let el;
  if(["select","connect","drop"].includes(v)){for(const x of a.slice(0,2))if(typeof x==="string"&&nodeOf(x))DEMO.focus.add(x);gRefresh()}
  switch(v){
    case"select":{await dReveal(a[0],tok);el=dNodeEl(a[0]);dSay(`Bấm ${a[0]}`);await dMove(el,tok);await dClick(tok);UI.sel={node:a[0]};UI.selRet=null;render();await dSleep(450);return}
    case"field":{el=document.querySelector(`#drawer [data-field="${a[0]}"]`);if(!el)return;el.scrollIntoView({block:"center"});await dSleep(150);dSay(a[1]||`${dLabel(el)||a[0]}`);dHl(el,true);await dMove(el,tok);await dClick(tok);await dSleep(350);return}
    case"button":case"bar":{const sel=`[data-act="${a[0]}"]${a[1]?`[data-arg="${a[1]}"]`:""}`;el=(v==="button"&&document.querySelector("#drawer "+sel))||document.querySelector(sel);if(!el)return;
      dSay(a[2]||`Bấm “${el.textContent.trim()}”`);dHl(el,true);await dMove(el,tok);await dClick(tok);return}
    case"connect":{await dReveal(a[0],tok);const p=document.querySelector(`[data-gconnect="${a[0]}"]`);dSay(`Kéo mũi tên từ ${a[0]} tới ${a[1]}`);await dMove(p,tok);
      const t=dNodeEl(a[1]);if(!t)return;const from=dCenter(p),to=dCenter(t);dLine(from,to);await dMove(t,tok,to);await dClick(tok);return}
    case"drop":{await dReveal(a[0],tok);const n=document.querySelector(`.gnode[data-gid="${a[0]}"]`),box=document.querySelector(`.gbox[data-gid="${a[1]}"]`);if(!n||!box)return;
      dSay(`Kéo ${a[0]} thả vào khung ${a[1]}`);await dMove(n.querySelector(".gn"),tok);const gh=dGhost(n),r=box.getBoundingClientRect(),to=[r.left+r.width/2,r.top+Math.min(r.height-40,r.height/2)];
      requestAnimationFrame(()=>dGhostTo(gh,to[0],to[1]));await dMove(box,tok,to);await dClick(tok);return}
    case"add":{const d=T[a[0]];dSay(`＋ Thành phần → ${d?d.label:a[0]}`);if(!UI.picker){const pb=document.querySelector('[data-act="picker"]');await dMove(pb,tok);await dClick(tok);UI.picker={q:"",active:0};render();await dSleep(300)}
      el=document.querySelector(`[data-ptype="${a[0]}"]`);if(el){el.scrollIntoView({block:"center"});await dSleep(120);await dMove(el,tok);const gh=dGhost(el),to=dWorld(a[1]+GW/2,a[2]+30);requestAnimationFrame(()=>dGhostTo(gh,to[0],to[1]));dSay(`Kéo ${d?d.label:a[0]} vào canvas`);await dMove(document.querySelector(".gx"),tok,to);await dClick(tok)}
      UI.picker=null;return}
    case"apply":return apply()}}
/* one step: its gestures, the change, a moment to see the result, close the drawer */
async function demoStep(s,k,n,tok){const L=L_(),W=UI.walk;DEMO.title=`Làm hộ · bước ${k+1}/${n} · ${s.t}`;DEMO.fast=false;dBar();
  DEMO.focus=new Set([atOf(s)].filter(Boolean));render();
  let done=false;const apply=()=>{if(done)return;done=true;walkApply(k)};
  const G=s.demo||(atOf(s)?[["select",s.at]]:[]);
  for(const g of G){await dCheck(tok);await demoGesture(g,s,tok,apply)}
  apply();const at=atOf(s);if(at)DEMO.focus.add(at);render();
  /* show the result on the same field / block for a moment */
  const last=G.filter(g=>g[0]==="field").pop();if(last&&UI.sel){const el=document.querySelector(`#drawer [data-field="${dArg(last[1])}"]`);if(el){dHl(el,true);dSay("Xong: "+(dLabel(el)||s.t))}}
  else dSay("Xong: "+s.t);
  await dSleep(900);await dCheck(tok);dClean();if(UI.sel){UI.sel=null;render()}await dSleep(250)}
async function demoPlay(all){const L=L_();if(!L)return;if(!UI.walk)UI.walk={i:0,res:null,by:[],helped:0};if(DEMO.on)return;
  DEMO.on=true;DEMO.paused=false;const tok=++DEMO.tok;DEMO.trace0=!!gs().trace;gs().trace=true;DEMO.focus=new Set();document.body.classList.add("demoing");
  if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();render();
  try{do{const S=stepsOf(L),k=UI.walk.i;if(k>=S.length)break;await demoStep(S[k],k,S.length,tok)}while(all)}
  catch(e){if(e!==DEMO_STOP)console.error(e)}
  finally{if(DEMO.tok===tok)demoEnd()}}
function demoEnd(){DEMO.on=false;DEMO.paused=false;DEMO.fast=false;gs().trace=DEMO.trace0;DEMO.focus=new Set();dClean();{const e=document.getElementById("dcur");if(e)e.hidden=true}document.body.classList.remove("demoing");
  if(typeof walkFinish==="function")walkFinish();render()}
function demoStop(){DEMO.tok++;demoEnd()}
/* leaving the lesson (Từ đầu, another lesson): stop without re-rendering */
function demoHalt(){if(!DEMO.on)return;DEMO.tok++;DEMO.on=false;DEMO.paused=false;gs().trace=DEMO.trace0;DEMO.focus=new Set();dClean();{const e=document.getElementById("dcur");if(e)e.hidden=true}document.body.classList.remove("demoing")}

/* ---------------- Gợi ý: point at what to do next ----------------
   The next step not done yet: the canvas goes into Trace mode on its blocks, and a pointer (with one line of text)
   sits on the thing to press now: the block, then (drawer open) the field or button, the out-port for an arrow, the
   library for a new block. It follows the learner: open the block and it moves to the field; finish the step and it
   moves to the next one. Nothing is changed for them. */
const HINT={el:null,also:[],say:"",key:null};
function hintStepOf(L){if(!L||!L.steps)return null;const S=stepsOf(L);for(let k=0;k<S.length;k++)if(!stepDone(S[k]))return{s:S[k],k,n:S.length};return null}
const gestures=s=>s.demo||(atOf(s)?[["select",s.at]]:[]);
/* the blocks of the step (for Trace), without touching the DOM: used while the canvas is built */
function hintFocus(){if(!UI.hintFx||(typeof DEMO!=="undefined"&&DEMO.on))return null;const h=hintStepOf(L_());if(!h)return null;const f=new Set([atOf(h.s)].filter(Boolean));
  for(const g of gestures(h.s)){const[v,...a0]=g;if(!["select","connect","drop"].includes(v))continue;for(const x of a0.slice(0,2).map(dArg))if(typeof x==="string"&&nodeOf(x))f.add(x)}return f}
function hintTarget(s){let el=null,also=[],say="";
  for(const g of gestures(s)){const[v,...a0]=g,a=a0.map(dArg);
    if(v==="select"){if(UI.sel&&UI.sel.node===a[0])continue;el=dNodeEl(a[0]);say=`Bấm ${a[0]}`;break}
    if(v==="field"){const f=document.querySelector(`#drawer [data-field="${a[0]}"]`);if(!f)continue;if(!el){el=f;say=a[1]||dLabel(f)}else also.push(f);continue}
    if(el)break;
    if(v==="button"||v==="bar"){const sel=`[data-act="${a[0]}"]${a[1]?`[data-arg="${a[1]}"]`:""}`;el=(v==="button"&&document.querySelector("#drawer "+sel))||document.querySelector(sel);say=el?`Bấm “${el.textContent.trim()}”`:"";break}
    if(v==="connect"){el=document.querySelector(`[data-gconnect="${a[0]}"]`);const t=dNodeEl(a[1]);if(t)also.push(t);say=`Kéo từ chấm bên phải ${a[0]} tới ${a[1]}`;break}
    if(v==="drop"){el=dNodeEl(a[0]);const b=document.querySelector(`.gbox[data-gid="${a[1]}"] .gbox-h`);if(b)also.push(b);say=`Kéo ${a[0]} thả vào khung ${a[1]}`;break}
    if(v==="add"){const d=T[a[0]];el=UI.picker?document.querySelector(`[data-ptype="${a[0]}"]`):document.querySelector('[data-act="picker"]');say=UI.picker?`Kéo ${d?d.label:a[0]} vào canvas`:`Mở ＋ Thành phần, tìm ${d?d.label:a[0]}`;break}
    if(v==="apply")break}
  return{el,also,say}}
function hintClear(){document.querySelectorAll(".hint-hl").forEach(e=>e.classList.remove("hint-hl"));const p=document.getElementById("hcur");if(p)p.hidden=true}
function hintFx(){hintClear();if(!UI.hintFx||(typeof DEMO!=="undefined"&&DEMO.on)||UI.mode!=="lesson")return;const h=hintStepOf(L_());
  /* every step done: the hint mode ends by itself (the canvas leaves Trace) */
  if(!h){UI.hintFx=false;setTimeout(()=>{if(!UI.hintFx&&typeof render==="function")render()},0);return}
  const t=hintTarget(h.s);HINT.el=t.el;HINT.also=t.also;HINT.say=`Bước ${h.k+1}/${h.n} · ${h.s.t}${t.say?" — "+t.say:""}`;
  for(const e of [t.el,...t.also])if(e)(e.closest(".fld")||e).classList.add("hint-hl");
  /* a field below the fold of the drawer: scroll it into view once, when it becomes the target */
  const key=h.k+"|"+(t.say||"");if(t.el&&key!==HINT.key&&t.el.closest("#drawer")){const f=t.el.closest(".fld")||t.el;try{f.scrollIntoView({block:"center",behavior:"instant"})}catch(_){f.scrollIntoView()}}HINT.key=key;
  hintPos()}
/* Esc leaves the hint mode when nothing else is open to close */
addEventListener("keydown",e=>{if(e.key!=="Escape"||!UI||!UI.hintFx||(typeof DEMO!=="undefined"&&DEMO.on))return;const tag=(e.target.tagName||"").toLowerCase();if(tag==="input"||tag==="textarea"||tag==="select")return;
  if(UI.sel||UI.picker||UI.modal||UI.gmenu)return;e.stopPropagation();UI.hintFx=false;hintClear();render()},true);
function hintPos(){const p=dEl("hcur",`<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.4-3.4-6.7L4 20z"/></svg><span></span>`,"hcur");
  const el=HINT.el;if(!UI.hintFx||!el||!el.isConnected){p.hidden=true;return}let r=el.getBoundingClientRect();
  if(!r.width||r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth){p.hidden=true;return}
  /* a field in the drawer: point at its label from the left so the caption sits over the canvas, not over the inputs */
  const inD=!!el.closest("#drawer");if(inD){const q=(el.closest(".fld")||el).getBoundingClientRect();if(q.width)r=q}p.hidden=false;const x=inD?r.left+8:Math.min(r.left+r.width/2,innerWidth-40),y=inD?r.top+12:r.top+r.height/2;p.style.transform=`translate(${x}px,${y}px)`;p.querySelector("span").textContent=HINT.say;
  p.classList.toggle("left",inD||x>innerWidth-300)}
addEventListener("scroll",()=>{if(UI&&UI.hintFx)hintPos()},true);addEventListener("resize",()=>{if(UI&&UI.hintFx)hintPos()});
/* bring the hinted block into view once, when the hint is first asked for */
function hintReveal(){const h=hintStepOf(L_());if(!h)return;const f=[...(hintFocus()||[])][0];if(!f||typeof GLAST==="undefined"||!GLAST||!GLAST.by[f])return;
  const gx=document.querySelector(".gx");if(!gx)return;const r=gx.getBoundingClientRect(),n=GLAST.by[f],z=GCUR.z,sx=GCUR.pan[0]+n.x*z,sy=GCUR.pan[1]+n.y*z;
  if(sx<8||sy<8||sx+n.w*z>r.width-8||sy+80*z>r.height-8){const G=gs();G.zoom=z;G.pan=[r.width/2-(n.x+n.w/2)*z,r.height/2-(n.y+40)*z];GCUR.pan=G.pan.slice();gApply()}}
