"use strict";
/* CloudLab shell — core: helpers, state containers, event log, undo, and the DOMAIN registry.
   The shell (src/shell/*) is the editor, layout, lesson panel, simulation clock and tour. It knows nothing about AWS or
   Kubernetes: a domain pack (src/aws/*, k8s/src/*) fills DOMAIN and defines the contract functions listed in
   src/shell/README.md. All files are classic scripts sharing globals; load order is in index.html and build.py. */
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clone=o=>o===undefined?undefined:JSON.parse(JSON.stringify(o));
/* which app this page is (<meta name="cloudlab-app" content="k8s">): each app keeps its own sandbox, progress and
   tour flag in localStorage. The AWS app has no meta and keeps the original keys. */
const APP_ID=(()=>{try{const m=document.querySelector('meta[name="cloudlab-app"]');return m&&m.content||""}catch(_){return""}})();
const STORE_NS="cloudlab:"+(APP_ID?APP_ID+":":"");
const store={get(k,d){try{const v=localStorage.getItem(STORE_NS+k);return v===null?d:JSON.parse(v)}catch(_){return d}},set(k,v){try{localStorage.setItem(STORE_NS+k,JSON.stringify(v))}catch(_){}}};
/* glob pattern → RegExp, compiled once per pattern (simulations evaluate patterns for every event) */
const GLOB_RE=new Map();
const glob=p=>{const k=String(p);let r=GLOB_RE.get(k);if(!r){if(GLOB_RE.size>2000)GLOB_RE.clear();r=new RegExp("^"+k.replace(/[.+^${}()|[\]\\]/g,"\\$&").replace(/\*/g,".*").replace(/\?/g,".")+"$","i");GLOB_RE.set(k,r)}return r};
const matchAny=(pats,v)=>[].concat(pats||[]).some(p=>glob(p).test(v));
const arr=v=>v===undefined||v===null?[]:Array.isArray(v)?v:[v];
/* money with enough precision to see a meter tick */
const money=v=>{v=v||0;const a=Math.abs(v);return"$"+(a>=100?v.toFixed(0):a>=1?v.toFixed(2):a>=0.01?v.toFixed(3):a>0?v.toFixed(5):"0.00")};
const num=v=>{v=v||0;return v>=1e9?(v/1e9).toFixed(1)+"B":v>=1e6?(v/1e6).toFixed(1)+"M":v>=1e4?(v/1e3).toFixed(1)+"k":v>=100?Math.round(v).toLocaleString("en-US"):String(Math.round(v*10)/10)};
const kb=v=>v>=1048576?(v/1048576).toFixed(1)+" GB":v>=1024?(v/1024).toFixed(1)+" MB":Math.round(v)+" KB";
/* path helpers for nested properties: "NotificationConfiguration.LambdaConfigurations.0.Function" */
const getP=(o,p)=>p.split(".").reduce((a,k)=>a==null?undefined:a[k],o);
function setP(o,p,v){const ks=p.split(".");let a=o;for(let i=0;i<ks.length-1;i++){const k=ks[i],nk=ks[i+1];if(a[k]==null||typeof a[k]!=="object")a[k]=/^\d+$/.test(nk)?[]:{};a=a[k]}
  const last=ks[ks.length-1];if(v===undefined){if(Array.isArray(a))a.splice(+last,1);else delete a[last]}else a[last]=v}
function download(name,text){try{const b=new Blob([text],{type:"text/plain"}),u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000)}catch(_){}}

/* ---------------- domain registry ----------------
   texts: every user-facing string that names the domain (stack vs cluster, Deploy vs kubectl apply, CLI name…)
   fields: inspector field types beyond text / number / select   {html(n,f,c), read(fs), write?(node,k,v,fs)}
   actions: data-act handlers beyond the shell's own              (arg, el, event) → true keeps the page as is
   optional hooks (all may be absent): view, rt, nodeActs, edgeState, parentOf, dropHint, onDrop, dragHint, onDragEnd,
   beforeDelete, afterDelete, onChange, redeploy, runtime, onNewMonth, manualStatus, lessonRef, api */
const DOMAIN={id:APP_ID||"aws",texts:{},fields:{},actions:{}};
const TX=(k,...a)=>{const v=DOMAIN.texts[k];return typeof v==="function"?v(...a):v??""};

/* ---------------- state ---------------- */
let M=null;          // the model being edited: {name, desc, res, ext, manual, pos} (src/shell/model.js)
let RT=null;         // runtime: what is deployed + simulation counters (src/shell/sim.js + the domain's sim)
const LOG=[];        // event log, newest first
let UNDO=[],REDO=[];
const UI={mode:"sandbox",lesson:-1,sel:null,view:null,code:false,attempt:0,result:null,hints:0,dirty:false,modal:null,drawer:null,logOpen:false,logSel:null,speed:3,tour:-1};
const DONE=new Set(store.get("done",[]));
let QUIET=0; // >0 while probing a copy for task checks

let CLK=0;const stamp=()=>{const t=RT?RT.t:0,d=Math.floor(t/86400),h=Math.floor(t%86400/3600),m=Math.floor(t%3600/60);return`N${d+1} ${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`};
function log(kind,svc,op,msg,tone,cli){if(QUIET)return;LOG.unshift({id:++CLK,t:stamp(),kind,svc,op,msg,tone:tone||"",cli:cli||""});if(LOG.length>400)LOG.length=400;UI.logSel=null}
/* every model edit goes through edit(): snapshot for undo, then mutate */
function edit(label,fn,cli){if(QUIET){fn();return}UNDO.push(clone(M));if(UNDO.length>80)UNDO.shift();REDO=[];fn();UI.dirty=true;if(typeof onModelChanged==="function")onModelChanged(label,cli)}
function undo(){if(!UNDO.length)return;REDO.push(clone(M));M=UNDO.pop();UI.dirty=true;log("CloudLab","editor","undo","hoàn tác thay đổi gần nhất","warn");if(typeof onModelChanged==="function")onModelChanged(null)}
function redo(){if(!REDO.length)return;UNDO.push(clone(M));M=REDO.pop();UI.dirty=true;log("CloudLab","editor","redo","làm lại","");if(typeof onModelChanged==="function")onModelChanged(null)}
