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
const DEMO={on:false,paused:false,fast:false,speed:1,tok:0,cap:"",title:""};
const DEMO_STOP={stop:1};
const dArg=v=>typeof v==="function"?v():v;
const reduced=()=>!!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches);
function dSleep(ms){return new Promise(r=>setTimeout(r,DEMO.fast?0:ms/DEMO.speed))}
async function dCheck(tok){while(DEMO.paused&&DEMO.tok===tok)await new Promise(r=>setTimeout(r,120));if(DEMO.tok!==tok)throw DEMO_STOP}
function dEl(id,html,cls){let e=document.getElementById(id);if(!e){e=document.createElement("div");e.id=id;e.className=cls;e.innerHTML=html;document.body.appendChild(e)}return e}
const dCursor=()=>dEl("dcur",`<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.4-3.4-6.7L4 20z"/></svg><i></i>`,"dcur");
/* the bar under the canvas: what is being done, and pause / next / stop */
function dBar(){const b=dEl("dbar","","dbar");b.setAttribute("role","status");
  b.innerHTML=`<div class="dbar-t"><b>${esc(DEMO.title)}</b><span>${esc(DEMO.cap)}</span></div><div class="dbar-a"><button class="sm" data-dact="pause">${DEMO.paused?"▶ Tiếp":"⏸ Dừng tạm"}</button><button class="sm" data-dact="next" title="Làm nhanh bước này">⏭</button><button class="sm ghost" data-dact="stop" aria-label="Dừng làm hộ">✕</button></div>`;
  if(!b.__on){b.__on=1;b.addEventListener("click",e=>{const a=e.target.closest("[data-dact]");if(!a)return;const k=a.dataset.dact;if(k==="pause"){DEMO.paused=!DEMO.paused;dBar()}else if(k==="next"){DEMO.fast=true;DEMO.paused=false;dBar()}else demoStop()})}
  b.hidden=false;return b}
function dSay(t){DEMO.cap=t||"";const b=document.getElementById("dbar");if(b){const s=b.querySelector(".dbar-t span");if(s)s.textContent=DEMO.cap}}
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
  let done=false;const apply=()=>{if(done)return;done=true;walkApply(k)};
  const G=s.demo||(atOf(s)?[["select",s.at]]:[]);
  for(const g of G){await dCheck(tok);await demoGesture(g,s,tok,apply)}
  apply();render();
  /* show the result on the same field / block for a moment */
  const last=G.filter(g=>g[0]==="field").pop();if(last&&UI.sel){const el=document.querySelector(`#drawer [data-field="${dArg(last[1])}"]`);if(el){dHl(el,true);dSay("Xong: "+(dLabel(el)||s.t))}}
  else dSay("Xong: "+s.t);
  await dSleep(900);await dCheck(tok);dClean();if(UI.sel){UI.sel=null;render()}await dSleep(250)}
async function demoPlay(all){const L=L_();if(!L)return;if(!UI.walk)UI.walk={i:0,res:null,by:[],helped:0};if(DEMO.on)return;
  DEMO.on=true;DEMO.paused=false;const tok=++DEMO.tok;document.body.classList.add("demoing");render();
  try{do{const S=stepsOf(L),k=UI.walk.i;if(k>=S.length)break;await demoStep(S[k],k,S.length,tok)}while(all)}
  catch(e){if(e!==DEMO_STOP)console.error(e)}
  finally{if(DEMO.tok===tok)demoEnd()}}
function demoEnd(){DEMO.on=false;DEMO.paused=false;DEMO.fast=false;dClean();for(const id of["dcur","dbar"]){const e=document.getElementById(id);if(e)e.hidden=true}document.body.classList.remove("demoing");render()}
function demoStop(){DEMO.tok++;demoEnd()}
/* leaving the lesson (Từ đầu, another lesson): stop without re-rendering */
function demoHalt(){if(!DEMO.on)return;DEMO.tok++;DEMO.on=false;DEMO.paused=false;dClean();for(const id of["dcur","dbar"]){const e=document.getElementById(id);if(e)e.hidden=true}document.body.classList.remove("demoing")}
