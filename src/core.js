"use strict";
/* CloudLab v2 — core: constants, helpers, state containers, event log, undo.
   Files load in order: core → catalog → model → iam → sim → lessons → editor → ui (all classic scripts, shared globals). */
const ACCT="111122223333",REGION="ap-southeast-2",EMAIL="dat@example.com";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clone=o=>o===undefined?undefined:JSON.parse(JSON.stringify(o));
const store={get(k,d){try{const v=localStorage.getItem("cloudlab:"+k);return v===null?d:JSON.parse(v)}catch(_){return d}},set(k,v){try{localStorage.setItem("cloudlab:"+k,JSON.stringify(v))}catch(_){}}};
const glob=p=>new RegExp("^"+String(p).replace(/[.+^${}()|[\]\\]/g,"\\$&").replace(/\*/g,".*").replace(/\?/g,".")+"$","i");
const matchAny=(pats,v)=>[].concat(pats||[]).some(p=>glob(p).test(v));
const arr=v=>v===undefined||v===null?[]:Array.isArray(v)?v:[v];
/* money with enough precision to see a meter tick */
const money=v=>{v=v||0;const a=Math.abs(v);return"$"+(a>=100?v.toFixed(0):a>=1?v.toFixed(2):a>=0.01?v.toFixed(3):a>0?v.toFixed(5):"0.00")};
const num=v=>{v=v||0;return v>=1e9?(v/1e9).toFixed(1)+"B":v>=1e6?(v/1e6).toFixed(1)+"M":v>=1e4?(v/1e3).toFixed(1)+"k":v>=100?Math.round(v).toLocaleString("en-US"):String(Math.round(v*10)/10)};
const kb=v=>v>=1048576?(v/1048576).toFixed(1)+" GB":v>=1024?(v/1024).toFixed(1)+" MB":Math.round(v)+" KB";
/* path helpers for nested CloudFormation properties: "NotificationConfiguration.LambdaConfigurations.0.Function" */
const getP=(o,p)=>p.split(".").reduce((a,k)=>a==null?undefined:a[k],o);
function setP(o,p,v){const ks=p.split(".");let a=o;for(let i=0;i<ks.length-1;i++){const k=ks[i],nk=ks[i+1];if(a[k]==null||typeof a[k]!=="object")a[k]=/^\d+$/.test(nk)?[]:{};a=a[k]}
  const last=ks[ks.length-1];if(v===undefined){if(Array.isArray(a))a.splice(+last,1);else delete a[last]}else a[last]=v}

/* ---------------- state ---------------- */
let M=null;          // the infrastructure template being edited (see model.js)
let RT=null;         // runtime: what is deployed + simulation counters (see sim.js)
const LOG=[];        // event log, newest first
let UNDO=[],REDO=[];
const UI={mode:"sandbox",lesson:-1,sel:null,view:null,code:false,attempt:0,result:null,hints:0,dirty:false,modal:null,drawer:null,logOpen:false,logSel:null,speed:3,tour:-1};
const DONE=new Set(store.get("done",[]));
let QUIET=0; // >0 while probing a copy for task checks

let CLK=0;const stamp=()=>{const t=RT?RT.t:0,d=Math.floor(t/86400),h=Math.floor(t%86400/3600),m=Math.floor(t%3600/60);return`N${d+1} ${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`};
function log(kind,svc,op,msg,tone,cli){if(QUIET)return;LOG.unshift({id:++CLK,t:stamp(),kind,svc,op,msg,tone:tone||"",cli:cli||""});if(LOG.length>400)LOG.length=400;UI.logSel=null}
/* every template edit goes through edit(): snapshot for undo, then mutate */
function edit(label,fn,cli){if(QUIET){fn();return}UNDO.push(clone(M));if(UNDO.length>80)UNDO.shift();REDO=[];fn();UI.dirty=true;if(typeof onModelChanged==="function")onModelChanged(label,cli)}
function undo(){if(!UNDO.length)return;REDO.push(clone(M));M=UNDO.pop();UI.dirty=true;log("CloudLab","editor","undo","hoàn tác thay đổi gần nhất","warn");if(typeof onModelChanged==="function")onModelChanged(null)}
function redo(){if(!REDO.length)return;UNDO.push(clone(M));M=REDO.pop();UI.dirty=true;log("CloudLab","editor","redo","làm lại","");if(typeof onModelChanged==="function")onModelChanged(null)}
