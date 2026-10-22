"use strict";
/* Simulation engine shared by every domain: the clock, the event queue, counters, flows along edges and cost.
   Batched: an event carries a weight w (how many real requests it stands for), so high traffic stays cheap to simulate.
   The domain's sim defines what happens: sources(t0,dt) emits events, handle(ev,t1) processes one, periodic(t0,dt) runs
   per tick (hourly cost, controllers…), fire(node,count,at) emits from one source; plus deploy(), deleteStack(),
   stackUp(), exists(id), syncRuntime(). DOMAIN.runtime() adds the domain's own runtime fields. */
const MONTH=30*86400;
const SPEEDS=[["Thời gian thật",1],["1 phút mỗi giây",60],["1 giờ mỗi giây",3600],["6 giờ mỗi giây",21600],["1 ngày mỗi giây",86400]];
function freshRuntime(){return Object.assign({t:0,month:1,running:false,q:[],n:{},acc:{},flow:{},why:{},total:0,stack:{status:"NOT_DEPLOYED"},seq:0,ops:0},DOMAIN.runtime?DOMAIN.runtime():{})}
const nrt=id=>RT.n[id]||(RT.n[id]={cost:0,m:{},tk:{},series:[],last:null});
function bump(id,k,w){const r=nrt(id);r.m[k]=(r.m[k]||0)+w;r.tk[k]=(r.tk[k]||0)+w}
function charge(id,usd,what){if(!usd)return;const r=nrt(id);r.cost+=usd;r.tk.cost=(r.tk.cost||0)+usd;RT.total+=usd;RT.spent=(RT.spent||0)+usd;r.costBy=r.costBy||{};r.costBy[what]=(r.costBy[what]||0)+usd}
function flow(a,b,kind,w,err){const k=a+">"+b+">"+kind,f=RT.flow[k]||(RT.flow[k]={ok:0,err:0,tot:0,tk:0,tke:0});if(err){f.err+=w;f.tke+=w;RT.why[k]=err}else{f.ok+=w;f.tk+=w}f.tot+=w}
function push(ev){RT.q.push(ev)}
let TICK_DT=1;
/* advance the clock by dt simulated seconds */
function step(dt,noSources){TICK_DT=dt;const t0=RT.t,t1=t0+dt;for(const k in RT.n)RT.n[k].tk={};for(const k in RT.flow){RT.flow[k].tk=0;RT.flow[k].tke=0}RT.ops=0;
  if(!noSources)sources(t0,dt);
  RT.q.sort((a,b)=>a.at-b.at);let guard=0;
  while(RT.q.length&&RT.q[0].at<=t1&&guard<4000){const ev=RT.q.shift();handle(ev,t1);guard++;if(RT.q.length&&RT.q[RT.q.length-1].at<RT.q[0].at)RT.q.sort((a,b)=>a.at-b.at)}
  RT.q.sort((a,b)=>a.at-b.at);periodic(t0,dt);RT.t=t1;
  if(RT.t>=RT.month*MONTH){RT.month++;RT.total=0;for(const id in RT.n)RT.n[id].cost=0;if(DOMAIN.onNewMonth)DOMAIN.onNewMonth();log("CloudLab","billing","new-month",`Sang tháng ${RT.month}: chi tiêu tháng về $0`,"")}
  for(const k in RT.n){const r=RT.n[k];r.series.push({t:t1,dt,...r.tk});if(r.series.length>40)r.series.shift()}}
/* after the template changes, counters and arrow states start again so what the canvas shows describes the new
   configuration (an old "not blocked" from before a fix is gone); cost and state (objects, pods, mail) stay */
function restartCounts(){for(const k in RT.n){const r=RT.n[k];r.m={};r.tk={};r.series=[];r.lastErr=null}RT.flow={};RT.why={}}
/* run everything queued now (manual actions while paused), without starting sources */
function drain(){let g=0;const t=RT.t;while(RT.q.length&&g<400){RT.q.sort((a,b)=>a.at-b.at);const ev=RT.q.shift();if(ev.at>t+120)ev.at=t;handle(ev,t+120);g++}}
function inject(n,c){fire(n,c||1,RT.t);drain()}
/* list price of a block: def.price(n) → {h: fixed USD per hour, parts:[[label, USD/h]], usage:[text], note} or null.
   Fixed = what you pay for it existing (instance hours, minimum capacity); usage = per request / GB, charged as it happens. */
const HOURS_MO=730;
function priceOf(n){const f=n&&(n.def.price||(T[n.type]||{}).price);if(!f)return null;try{return f(n)||null}catch(_){return null}}
/* fixed hourly price of everything deployed (or, before the first deploy, of everything declared) */
function fixedRate(){const up=stackUp();let h=0;for(const n of allNodes()){if(n.ext||n.scope==="manual"&&!up)continue;if(up&&!exists(n.id))continue;const p=priceOf(n);if(p)h+=p.h||0}return h}
/* the monthly run-rate the meter shows next to the total */
function rateNow(){let s=0,dt=0;for(const id in RT.n){const L=RT.n[id].series;if(!L.length)continue;const last=L.slice(-8);s+=last.reduce((a,x)=>a+(x.cost||0),0);dt=Math.max(dt,last.reduce((a,x)=>a+x.dt,0))}return dt?s/dt*3600:0}
/* probe: run a callback against a throw-away copy of the template + runtime (task checks) */
function probe(fn){const sM=M,sR=RT;M=clone(M);RT=clone(RT);RT.q=[];RT.running=false;QUIET++;try{return fn()}finally{QUIET--;M=sM;RT=sR}}
