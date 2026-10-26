"use strict";
/* Canvas: free-form node editor over the template. Nodes = resources/actors with live status + cost;
   edges = references (typed, coloured by what the simulation saw). Pan, zoom, drag nodes, drag from the
   out-port to connect (or click it / press C for the keyboard list), drop palette items to create, list view on phones. */
/* DOMAIN.compact: small cards (icon, type, name, one status pill) drawn in a shape that says what kind of thing the
   block is; the numbers live in the drawer and the hover title. Otherwise: the big card with live rows. */
const CMP=!!DOMAIN.compact,GHEAD=CMP?64:62,GW=CMP?212:260;
/* the block's icon: DOMAIN.iconOf(def) → {src, tile?} (an image), else the text badge. A broken image turns back into the badge. */
function icHtml(d,cls){const s=DOMAIN.iconOf&&d?DOMAIN.iconOf(d):null,c=cls?" "+cls:"",cat=`style="--cat:var(--c-${d?d.cat:"learn"})"`;
  if(!s)return`<span class="side-ic${c}" ${cat} aria-hidden="true">${esc(d?d.short:"?")}</span>`;
  return`<span class="side-ic ic-img${s.tile?" tile":""}${c}" ${cat} aria-hidden="true"><img src="${esc(s.src)}" alt="" decoding="async" data-t="${esc(d.short)}" onerror="var p=this.parentNode;p.classList.remove('ic-img','tile');p.textContent=this.dataset.t"></span>`}
/* shape outlines: rect (compute), cyl (stored data), pipe (messaging), hex (entry / edge), cut (policy, rule), pill (outside) */
const SHAPE_KINDS={rect:"Chạy code / máy",cyl:"Lưu dữ liệu",pipe:"Hàng đợi, luồng tin",hex:"Cửa vào, định tuyến",cut:"Quyền, chính sách, quy tắc",pill:"Bên ngoài (người dùng, hộp thư)"};
function shapeSvg(k,w,h){const a=.75,W=w-a,H=h-a,ry=6,rx=11,c=k==="hex"?15:10;let d,lip="";
  switch(k){case"cyl":d=`M${a},${ry+a} A${w/2-a},${ry} 0 0 1 ${W},${ry+a} V${H-ry} A${w/2-a},${ry} 0 0 1 ${a},${H-ry} Z`;lip=`M${a},${ry+a} A${w/2-a},${ry} 0 0 0 ${W},${ry+a}`;break;
    case"pipe":d=`M${rx},${a} H${w-rx} A${rx-a},${h/2-a} 0 0 1 ${w-rx},${H} H${rx} A${rx-a},${h/2-a} 0 0 1 ${rx},${a} Z`;lip=`M${w-rx},${a} A${rx-a},${h/2-a} 0 0 0 ${w-rx},${H}`;break;
    case"hex":d=`M${c},${a} H${w-c} L${W},${h/2} L${w-c},${H} H${c} L${a},${h/2} Z`;break;
    case"cut":d=`M${c},${a} H${w-c} L${W},${c} V${h-c} L${w-c},${H} H${c} L${a},${h-c} V${c} Z`;break;
    case"pill":d=`M${h/2},${a} H${w-h/2} A${h/2-a},${h/2-a} 0 0 1 ${w-h/2},${H} H${h/2} A${h/2-a},${h/2-a} 0 0 1 ${h/2},${a} Z`;break;
    default:d=`M${10+a},${a} H${w-10-a} Q${W},${a} ${W},${10+a} V${h-10-a} Q${W},${H} ${w-10-a},${H} H${10+a} Q${a},${H} ${a},${h-10-a} V${10+a} Q${a},${a} ${10+a},${a} Z`}
  return`<svg class="gshape k-${k}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path class="sh" d="${d}"/>${lip?`<path class="sh2" d="${lip}"/>`:""}</svg>`}
const kindOf=n=>CMP&&DOMAIN.kindOf?DOMAIN.kindOf(n)||"rect":"rect";
let GCUR={z:1,pan:[0,0]},GD=null,GSUP=0;
const gs=()=>UI.g||(UI.g={view:null,zoom:null,pan:[0,0],trace:false});
/* ---------- what a node shows ---------- */
function nodeView(n){const r=RT.n[n.id]||{m:{},tk:{},series:[]},m=r.m,p=n.props,up=exists(n.id),rows=[];let st=null;
  const rate=k=>{const L=r.series.slice(-4),dt=L.reduce((a,x)=>a+x.dt,0);return dt?L.reduce((a,x)=>a+(x[k]||0),0)/dt:0};
  const perS=k=>{const v=rate(k);return v>=1?num(v)+"/s":v*60>=1?num(v*60)+"/phút":v*3600>=1?num(v*3600)+"/giờ":v>0?num(v*86400)+"/ngày":"—"};
  const cx={r,m,p,up,perS,rate};
  if(DOMAIN.view){const s=DOMAIN.view(n,rows,cx);if(s)st=s}
  if(n.def.view){const s2=n.def.view(n,rows,cx);if(s2)st=s2}
  if(n.scope==="manual")st=DOMAIN.manualStatus?DOMAIN.manualStatus(n):["warn",TX("manualShort")];
  else if(!up&&!n.ext)st=["off",RT.stack.status==="DELETE_COMPLETE"?TX("ghostDeleted"):TX("ghostNew")];
  const cost=r.cost||0,pr=n.ext?null:priceOf(n),ph=pr&&pr.h>0?pr.h:0,show=cost>0||ph>0,out=rows.slice(0,show?3:4);
  if(cost>0)out.push(["Chi phí",money(cost)+(ph?` · ${money(ph)}/giờ`:""),"cost"]);else if(ph)out.push(["Giá",`${money(ph)}/giờ · ${money(ph*HOURS_MO)}/tháng`,"cost"]);
  return{st,rows:out,cost,ghost:!up&&!n.ext}}
function gH(n,v){if(CMP)return GHEAD+(n.def.keepRows&&v.rows.length?12+v.rows.length*22:0);return GHEAD+(v.rows.length?19+v.rows.length*20:0)}
/* edge look from what the simulation saw this tick and before */
function edgeView(e){const f=RT.flow[e.id],from=nodeOf(e.from),style=(REL[e.kind]||{style:"role"}).style;let st="idle",label=e.label||"",why=RT.why[e.id]||"";
  /* a source marked Expect: Deny should be blocked: blocked is green, getting through is a leak */
  const expectDeny=!!(from&&from.props&&from.props.Expect==="Deny");
  if(e.deny)st="deny";
  if(f){if(f.tke&&!f.tk)st=expectDeny?"blocked":"stop";else if(f.tk)st="ok";else if(f.err&&!f.ok)st=expectDeny?"blocked":"stop"}
  if(f&&f.ok&&expectDeny)st="leak";
  if(DOMAIN.edgeState)st=DOMAIN.edgeState(e,f,st,from)||st;
  if(st==="stop"&&why)label="✕ "+why.split(" (")[0].slice(0,46);else if(st==="blocked")label="✕ bị chặn (đúng ý)";else if(st==="leak")label="! lẽ ra phải bị chặn";else if(st==="loop")label="↻ "+label;
  else if(st==="ok"&&f&&RT.running){const s=RT.n[e.to]&&RT.n[e.to].series.slice(-4),dt=s?s.reduce((a,x)=>a+x.dt,0):0;if(dt&&f.tk){const v=f.tk/(s.slice(-1)[0]||{dt:1}).dt;label+=" · "+(v>=1?num(v)+"/s":num(v*3600)+"/giờ")}}
  return{st,style,label,why}}
/* ---------- geometry ---------- */
function layoutModel(){const all=allNodes(),cont=all.filter(n=>n.def.container);
  const nodes=all.filter(n=>!n.def.container).map(n=>{const v=nodeView(n),p=M.pos[n.id]||(M.pos[n.id]=[40,40]);return{...n,v,x:p[0],y:p[1],w:GW,h:gH(n,v)}});
  const by={};nodes.forEach(n=>by[n.id]=n);
  /* containers (a domain's boxes: VPC > subnet, OU, namespace…): DOMAIN.parentOf(x) names the container a node or
     a container sits in. Boxes are built innermost first so an outer box wraps the inner ones; drawn outermost first. */
  const cids=new Set(cont.map(c=>c.id)),parent={};
  for(const x of [...nodes,...cont]){const q=DOMAIN.parentOf?DOMAIN.parentOf(x):null;parent[x.id]=q&&q!==x.id&&cids.has(q)?q:null}
  const depth=id=>{let d=0,c=parent[id];const seen=new Set();while(c&&!seen.has(c)){seen.add(c);d++;c=parent[c]}return d};
  const bbox=(items,pad,head,def,id)=>{if(!items.length){const p=M.pos[id]||(M.pos[id]=[40,40]);return{x:p[0],y:p[1],w:def[0],h:def[1]}}
    const x0=Math.min(...items.map(i=>i.x))-pad,y0=Math.min(...items.map(i=>i.y))-pad-head,x1=Math.max(...items.map(i=>i.x+i.w))+pad,y1=Math.max(...items.map(i=>i.y+i.h))+pad;M.pos[id]=[x0,y0];return{x:x0,y:y0,w:x1-x0,h:y1-y0}};
  const inner=[...cont].sort((a,b)=>depth(b.id)-depth(a.id));
  for(const c of inner){const kids=[...nodes.filter(n=>parent[n.id]===c.id),...inner.filter(x=>parent[x.id]===c.id).map(x=>by[x.id]).filter(Boolean)],bx=c.def.box||{};
    const b={...c,...bbox(kids,bx.pad??22,bx.head??30,bx.size||[300,170],c.id),members:kids.flatMap(k=>k.box?[k.id,...k.members]:[k.id]),box:c.def.container,depth:depth(c.id)};
    if(c.def.boxExtra)Object.assign(b,c.def.boxExtra(b));by[c.id]=b}
  const boxes=inner.map(c=>by[c.id]).reverse();
  /* DOMAIN.layout({nodes,boxes,by}) may seat a node on a box edge (n.door) or fold it into a box (n.docked: not drawn
     as a block; its edges are not drawn either) and returns {plates, lines} drawn with the boxes */
  const decor=(DOMAIN.layout&&DOMAIN.layout({nodes,boxes,by}))||{plates:[],lines:[]},shown=nodes.filter(n=>!n.docked);
  const es=edges().filter(e=>!e.hidden&&by[e.from]&&by[e.to]&&!by[e.from].docked&&!by[e.to].docked);const ext=[...shown,...boxes];
  const minX=Math.min(20,...ext.map(n=>n.x)),minY=Math.min(20,...ext.map(n=>n.y));
  if(minX<20||minY<20){const dx=20-minX,dy=20-minY;for(const k of Object.keys(M.pos))M.pos[k]=[M.pos[k][0]+dx,M.pos[k][1]+dy];return layoutModel()}
  const W_=Math.max(800,...ext.map(n=>n.x+n.w))+60,H_=Math.max(420,...ext.map(n=>n.y+n.h))+60;return{nodes:shown,boxes,by,edges:es,decor,W:W_,H:H_}}
function sidesFor(A,B){const ax=A.x+A.w/2,ay=A.y+A.h/2,bx=B.x+B.w/2,by=B.y+B.h/2,dx=bx-ax,dy=by-ay;
  if(Math.abs(dx)>=Math.abs(dy)*0.9||Math.abs(dx)>A.w*0.9)return dx>=0?["r","l"]:["l","r"];return dy>=0?["b","t"]:["t","b"]}
function gAnchor(n,s,i,cnt){const off=cnt>1?(i-(cnt-1)/2)*14:0,my=n.door?n.y+n.h/2:n.y+GHEAD/2;return s==="r"?[n.x+n.w,my+off]:s==="l"?[n.x,my+off]:s==="b"?[n.x+n.w/2+off*2,n.y+n.h]:[n.x+n.w/2+off*2,n.y]}
const GDIR={r:[1,0],l:[-1,0],b:[0,1],t:[0,-1]};
function gCurve(p1,s1,p2,s2){const k=Math.max(40,Math.hypot(p2[0]-p1[0],p2[1]-p1[1])*.4),a=GDIR[s1],b=s2?GDIR[s2]:[-a[0],-a[1]];
  const c1=[p1[0]+a[0]*k,p1[1]+a[1]*k],c2=[p2[0]+b[0]*k,p2[1]+b[1]*k],r=v=>Math.round(v*10)/10;
  const at=t=>{const u=1-t;return[0,1].map(i=>u*u*u*p1[i]+3*u*u*t*c1[i]+3*u*t*t*c2[i]+t*t*t*p2[i])};
  return{d:`M${r(p1[0])} ${r(p1[1])} C${r(c1[0])} ${r(c1[1])} ${r(c2[0])} ${r(c2[1])} ${r(p2[0])} ${r(p2[1])}`,at}}
function spark(series,key){const pts=series.map(x=>(x[key]||0)/(x.dt||1)),mx=Math.max(1e-9,...pts);if(!pts.length)return"";const w=120,h=22;
  return`<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts.map((v,i)=>`${(i/(Math.max(1,pts.length-1))*w).toFixed(1)},${(h-2-v/mx*(h-4)).toFixed(1)}`).join(" ")}"/></svg>`}
/* ---------- render ---------- */
/* the world is built as keyed parts (boxes, edge svg, nodes, chips) so a refresh can patch only what changed:
   a simulation tick or a drag usually touches a few nodes, and the rest of the DOM (and its focus) stays put.
   gWorld(L) still returns the whole markup, identical to joining the parts. */
function gParts(L){const G=gs(),sel=UI.sel||{},drag=UI.gdrag;
  /* a connection can end on a block or on a box (VPC, subnet, namespace…) */
  const valid=drag?Object.fromEntries([...L.nodes,...L.boxes].map(n=>[n.id,n.id!==drag.from&&connectRule(drag.from,n.id)])):null;
  /* edge bundling per side so several edges into one side don't overlap */
  /* DOMAIN.edgeVia(e) names a block the edge is drawn through (a request from the Internet passes the VPC's gateway) */
  const viaOf=e=>{const v=DOMAIN.edgeVia&&DOMAIN.edgeVia(e,L),V=v&&L.by[v];return V&&!V.docked&&v!==e.from&&v!==e.to?V:null};
  /* edges drawn through the same block to the same target share one slot at both ends: they are one path there */
  const sideUse={},slot=(k,x)=>{const a=sideUse[k]=sideUse[k]||[];if(!a.includes(x))a.push(x)};const plan=L.edges.map(e=>{const V=viaOf(e),A=V||L.by[e.from],B=L.by[e.to],[sa,sb]=sidesFor(A,B),ka=A.id+sa,kb2=e.to+sb,sk=V?"via>"+V.id+">"+e.to:e.id;slot(ka,sk);slot(kb2,sk);return{e,A,B,sa,sb,ka,kb:kb2,V,sk}});
  const hf=typeof hintFocus==="function"?hintFocus():null;
  const trace=typeof DEMO!=="undefined"&&DEMO.on?DEMO.focus:hf||(G.trace?new Set(L.edges.filter(e=>{const f=RT.flow[e.id];return f&&(f.tk||f.tke)}).flatMap(e=>[e.from,e.to])):null);
  let svg=`<svg class="gedges" width="${L.W}" height="${L.H}"><defs>${G_MARKERS}</defs>`,chips="";
  for(const{e,A,B,sa,sb,ka,kb,V,sk}of plan){const v=edgeView(e),ia=sideUse[ka].indexOf(sk),ib=sideUse[kb].indexOf(sk);let lab=null;
    const p1=gAnchor(A,sa,ia,sideUse[ka].length),p2=gAnchor(B,sb,ib,sideUse[kb].length),c=gCurve(p1,sa,p2,sb),isSel=sel.edge===e.id,dim=trace&&!(trace.has(e.from)&&trace.has(e.to))?" dim":"";
    /* through a block: source → the block's near side, straight through it, then on from the far side */
    if(V){const S=L.by[e.from],[s0,s1]=V.door?(S.x+S.w/2<V.x+V.w/2?["r","l"]:["l","r"]):sidesFor(S,V),q0=gAnchor(S,s0,0,1),q1=V.door?[V.x+V.w/2+GDIR[s1][0]*V.w/2,V.y+V.h/2+GDIR[s1][1]*V.h/2]:gAnchor(V,s1,0,1),c0=gCurve(q0,s0,q1,s1);c.d=c0.d+" L"+c.d.slice(1);lab=c0.at(.5)}
    const st=isSel?"sel":v.st;
    svg+=`<path d="${c.d}" class="ge s-${v.st} k-${v.style}${v.st==="ok"&&RT.running?" run":""}${isSel?" is-sel":""}${dim}" marker-end="url(#ga-${st})"/><path d="${c.d}" class="ge-hit" data-edge="${esc(e.id)}"><title>${esc(e.from+" → "+e.to+": "+(v.why||e.label||e.kind))}</title></path>`;
    if(v.label&&(v.st!=="idle"||v.style==="flow"||isSel)){const rev=L.edges.some(x=>x.from===e.to&&x.to===e.from),q=lab||c.at(rev?.3:.5);chips+=`<span class="gchip s-${v.st}${isSel?" is-sel":""}${dim}" style="left:${q[0]}px;top:${q[1]}px">${esc(v.label)}</span>`}}
  /* domain decor: plates sit on a box edge and open a block's drawer; lines join a plate to a block */
  const D=L.decor||{plates:[],lines:[]};
  for(const l of D.lines){const c=gCurve(l.a,l.sa,l.b,l.sb),dim=trace&&!l.ids.some(i=>trace.has(i))?" dim":"";svg+=`<path d="${c.d}" class="gline ${l.cls||""}${dim}"><title>${esc(l.title||"")}</title></path>`}
  for(const t of D.plates){const dim=trace&&!trace.has(t.node)&&!trace.has(t.box)?" dim":"";
    chips+=`<button class="gplate ${t.cls||""}${sel.node===t.node?" sel":""}${walkAt()===t.node?" walk":""}${dim}" data-node="${esc(t.node)}" style="left:${t.x}px;top:${t.y}px" title="${esc(t.title||"")}" aria-label="${esc(t.title||t.text)}">${t.icon?icHtml(t.icon):""}<span>${esc(t.text)}</span></button>`}
  if(drag&&drag.at){const A=L.by[drag.from],over=drag.over&&valid[drag.over]?L.by[drag.over]:null,p1=gAnchor(A,"r",0,1),p2=over?gAnchor(over,"l",0,1):drag.at,c=gCurve(p1,"r",p2,over?"l":null);
    svg+=`<path d="${c.d}" class="ge s-drag" marker-end="url(#ga-drag)"/>`;if(over){const q=c.at(.5);chips+=`<span class="gchip s-drag" style="left:${q[0]}px;top:${q[1]}px">thả để nối · ${esc(valid[drag.over].label)}</span>`}}
  const boxes=[];for(const b of L.boxes){const d=b.def,label=d.boxLabel?d.boxLabel(b):`${d.label} · ${b.id}`;
    boxes.push({id:b.id,a:`<div class="gbox ${b.box}${d.boxClass?d.boxClass(b):""}${sel.node===b.id?" sel":""}${walkAt()===b.id?" walk":""}${UI.gdropBox===b.id||(drag&&drag.over===b.id&&valid[b.id])?" drop":""}" data-gid="${b.id}" data-box="${b.box}"`,st:`left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px`,
      b:`><button class="gbox-h" data-node="${b.id}" aria-label="${esc(label)}">${icHtml(DOMAIN.boxIconDef?DOMAIN.boxIconDef(b):d)}${esc(label)}</button>${b.members.length?"":`<span class="gbox-empty">${esc(d.boxEmpty||"")}</span>`}</div>`})}
  const nodes=[];for(const n of L.nodes){const v=n.v,isSel=sel.node===n.id,vt=valid?(n.id===drag.from?"":valid[n.id]?" valid":" invalid"):"",dim=trace&&!trace.has(n.id)?" dim":"";
    const desc=`${n.id}, ${n.def.label}${v.st?", "+v.st[1]:""}`;
    if(CMP&&n.door){nodes.push({id:n.id,a:`<div class="gnode cmp door c-${n.def.cat}${isSel?" sel":""}${walkAt()===n.id?" walk":""}${v.st?" st-"+(v.st[0]||"none"):""}${vt}${dim}" data-gid="${n.id}"`,st:`left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px`,
      b:`><button class="gn" data-node="${n.id}" aria-label="${esc(desc)}" aria-controls="drawer" aria-expanded="${isSel}" title="${esc(n.id+" · "+n.def.label+(n.doorTip?"\n"+n.doorTip:""))}">${icHtml(n.def)}</button><span class="gdoor-n" aria-hidden="true">${esc(n.id)}</span>`+
      `<span class="gp in" aria-hidden="true"></span><button class="gp out" data-act="gMenu" data-arg="${n.id}" data-gconnect="${n.id}" aria-label="Nối ${esc(n.id)} tới…" title="Kéo tới khối khác để nối, hoặc bấm để chọn từ danh sách"></button></div>`});continue}
    if(CMP){const k=kindOf(n),keep=n.def.keepRows&&v.rows.length,tip=v.rows.filter(r=>!r[3]).map(r=>`${r[0]}: ${r[1]}`).join("\n");
      const rowsK=keep?`<span class="gm">${v.rows.map(r=>r[3]?`<span class="gr"><span>${esc(r[0])}</span>${spark(r[3],"inv")||spark(r[3],"req")}</span>`:`<span class="gr"><span>${esc(r[0])}</span><span class="v ${r[2]}">${esc(r[1])}</span></span>`).join("")}</span>`:"";
      nodes.push({id:n.id,a:`<div class="gnode cmp k-${k} c-${n.def.cat}${v.ghost?" ghost":""}${n.scope==="manual"?" manual":""}${isSel?" sel":""}${walkAt()===n.id?" walk":""}${v.st?" st-"+(v.st[0]||"none"):""}${vt}${dim}" data-gid="${n.id}"`,st:`left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px`,
        b:`>${shapeSvg(k,n.w,n.h)}<button class="gn" data-node="${n.id}" aria-label="${esc(desc)}" aria-controls="drawer" aria-expanded="${isSel}"${tip?` title="${esc(n.id+"\n"+tip)}"`:""}><span class="gh">${icHtml(n.def)}<span class="gtt"><small>${esc(n.def.label)}</small><b>${esc(n.id)}</b></span></span>${rowsK}</button>`+
        (v.st?`<span class="gpill s-${v.st[0]||"none"}" aria-hidden="true"><i></i>${esc(v.st[1])}</span>`:"")+
        `<span class="gp in" aria-hidden="true"></span><button class="gp out" data-act="gMenu" data-arg="${n.id}" data-gconnect="${n.id}" aria-label="Nối ${esc(n.id)} tới…" title="Kéo tới khối khác để nối, hoặc bấm để chọn từ danh sách"></button></div>`});continue}
    const rowsH=v.rows.length?`<span class="gm">${v.rows.map(r=>r[3]?`<span class="gr"><span>${esc(r[0])}</span>${spark(r[3],"inv")||spark(r[3],"req")}</span>`:`<span class="gr"><span>${esc(r[0])}</span><span class="v ${r[2]}">${esc(String(r[1]).length>26?String(r[1]).slice(0,25)+"…":r[1])}</span></span>`).join("")}</span>`:"";
    nodes.push({id:n.id,a:`<div class="gnode c-${n.def.cat}${v.ghost?" ghost":""}${n.scope==="manual"?" manual":""}${isSel?" sel":""}${walkAt()===n.id?" walk":""}${v.st?" st-"+(v.st[0]||"none"):""}${vt}${dim}" data-gid="${n.id}"`,st:`left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px`,
      b:`><button class="gn" data-node="${n.id}" aria-label="${esc(desc)}" aria-controls="drawer" aria-expanded="${isSel}"><span class="gh"><span class="side-ic" style="--cat:var(--c-${n.def.cat})" aria-hidden="true">${esc(n.def.short)}</span><span class="gtt"><b>${esc(n.id)}</b><small>${esc(n.ext?n.def.label:(physName(n)!==n.id?physName(n):n.def.label))}</small></span></span>${rowsH}</button>`+
      (v.st?`<span class="gpill s-${v.st[0]||"none"}" aria-hidden="true"><i></i>${esc(v.st[1])}</span>`:"")+
      `<span class="gp in" aria-hidden="true"></span><button class="gp out" data-act="gMenu" data-arg="${n.id}" data-gconnect="${n.id}" aria-label="Nối ${esc(n.id)} tới…" title="Kéo tới khối khác để nối, hoặc bấm để chọn từ danh sách"></button></div>`})}
  return{boxes,svg:svg+"</svg>",nodes,chips}}
const G_MARKERS=["ok","idle","stop","warn","leak","loop","blocked","drag","deny","sel"].map(k=>`<marker id="ga-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9" class="ga s-${k}"/></marker>`).join("");
const gEl=x=>x.a+` style="${x.st}"`+x.b;
function gJoin(P){return P.boxes.map(gEl).join("")+P.svg+P.nodes.map(gEl).join("")+P.chips}
function gWorld(L){return gJoin(gParts(L))}
/* write the parts into #gworld: replace only the boxes / nodes whose markup changed, move the ones that only changed
   position, and rewrite the svg and chips when they differ. Falls back to innerHTML when the set of blocks changed. */
function gPatchWorld(w,P){const pv=w.__g,bk=P.boxes.map(x=>x.id).join("|"),nk=P.nodes.map(x=>x.id).join("|"),nb=P.boxes.length,nn=P.nodes.length;
  const ae=document.activeElement,keep=ae&&ae!==document.body&&w.contains(ae)?ae.getAttribute("data-node"):null;
  if(!pv||pv.bk!==bk||pv.nk!==nk||w.children.length!==pv.count){w.innerHTML=gJoin(P)}
  else{const kids=w.children,one=(i,o,x)=>{if(o.a!==x.a||o.b!==x.b)kids[i].outerHTML=gEl(x);else if(o.st!==x.st)kids[i].setAttribute("style",x.st)};
    for(let i=0;i<nb;i++)one(i,pv.boxes[i],P.boxes[i]);
    if(pv.svg!==P.svg)kids[nb].outerHTML=P.svg;
    for(let i=0;i<nn;i++)one(nb+1+i,pv.nodes[i],P.nodes[i]);
    if(pv.chips!==P.chips){while(kids.length>nb+1+nn)w.lastElementChild.remove();if(P.chips)w.insertAdjacentHTML("beforeend",P.chips)}}
  gSnap(w,P,bk,nk);
  if(keep&&!w.contains(document.activeElement)){const e=w.querySelector(`[data-node="${keep}"]`);if(e)e.focus({preventScroll:true})}}
function gSnap(w,P,bk,nk){w.__g={bk:bk!=null?bk:P.boxes.map(x=>x.id).join("|"),nk:nk!=null?nk:P.nodes.map(x=>x.id).join("|"),boxes:P.boxes,svg:P.svg,nodes:P.nodes,chips:P.chips,count:w.children.length}}
const gWorldStyle=(W,H,pan,z)=>`width:${W}px;height:${H}px;transform:translate(${pan[0]}px,${pan[1]}px) scale(${z})`;
function gSetStyle(w,s){if(w.getAttribute("style")!==s)w.setAttribute("style",s)}
function gMenuHtml(L,list){const M_=UI.gmenu;if(!M_||!L.by[M_.from])return"";const src=L.by[M_.from];
  const opts=[...L.nodes,...L.boxes].filter(n=>n.id!==M_.from).map(n=>({n,r:connectRule(M_.from,n.id)})).sort((a,b)=>(b.r?1:0)-(a.r?1:0));M_.ids=opts.map(o=>o.n.id);const ai=Math.min(M_.active||0,opts.length-1);
  let style="";if(!list){const z=GCUR.z,cw=(document.querySelector(".gx")||{}).clientWidth||880,l=(src.x+src.w)*z+GCUR.pan[0]+10;style=` style="left:${Math.max(8,Math.min(l,cw-316))}px;top:${Math.max(8,src.y*z+GCUR.pan[1])}px"`}
  return`<div class="gmenu${list?" inline":""}"${style}><p class="cap">Nối từ</p><b class="gmt">${esc(src.id)} →</b>
    <ul class="gopts" id="glist" role="listbox" tabindex="0" aria-label="Chọn khối để nối" aria-activedescendant="gopt-${ai}">${opts.map(({n,r},i)=>`<li id="gopt-${i}" role="option" class="gopt${r?"":" bad"}${i===ai?" on":""}" aria-selected="${i===ai}" aria-disabled="${!r}" data-act="gPick" data-arg="${n.id}">${icHtml(n.def)}<span class="gtt"><b>${esc(n.id)}</b><small>${esc(r?r.label:whyNot(M_.from,n.id))}</small></span><span class="k" aria-hidden="true">${r?(i===ai?"↵":""):"✕"}</span></li>`).join("")||`<li class="gopt bad">Canvas chưa có khối nào khác để nối</li>`}</ul>
    <p class="cap gmf">↑↓ chọn · Enter nối · Esc hủy</p></div>`}
function relText(L,n){const out=L.edges.filter(e=>e.from===n.id).map(e=>`→ ${e.to} (${e.label||e.kind})`),inn=L.edges.filter(e=>e.to===n.id).map(e=>`← ${e.from}`);return[...inn,...out].join(" · ")||"chưa nối với khối nào"}
let GLAST=null,GWH=[0,0];
/* canvas markup in three pieces: everything before the world, the world (parts), everything after it */
function canvasParts(){const L=layoutModel(),G=gs();GLAST=L;const view=G.view||(KIT.isNarrow()?"list":"graph"),host=document.getElementById("canvas");
  const gxo=document.querySelector(".gx"),cw=(gxo&&gxo.clientWidth)||((host&&host.clientWidth)||0)||900,ch=(gxo&&gxo.clientHeight)||((host&&host.clientHeight)||0)||520;
  const fitZ=Math.max(.4,Math.min(1,(cw-24)/L.W,(ch-24)/L.H)),z=G.zoom||fitZ,pan=G.zoom?G.pan:[Math.max(8,(cw-L.W*z)/2),Math.max(8,(ch-L.H*z)/2)];GCUR={z,pan};
  const tools=`<div class="gx-tools" role="toolbar" aria-label="Công cụ canvas"><button class="sm${UI.picker?" on":" primary"}" data-act="picker" aria-pressed="${!!UI.picker}" title="Thư viện thành phần (phím /)">＋ Thành phần</button>${view==="graph"?`<button class="sm" data-act="gFit" title="Vừa khung">⤢<span class="hide-s"> Vừa khung</span></button><button class="sm" data-act="gZoom" data-arg="-1" aria-label="Thu nhỏ" title="Thu nhỏ (hoặc cuộn chuột trên canvas)">−</button><span class="gz mono">${Math.round(z*100)}%</span><button class="sm" data-act="gZoom" data-arg="1" aria-label="Phóng to" title="Phóng to (hoặc cuộn chuột trên canvas)">+</button>${typeof hintFocus==="function"&&hintFocus()?`<button class="sm on hint-off" data-act="hintOff" aria-pressed="true" title="Đang ở chế độ gợi ý: chỉ sáng khối của bước kế tiếp. Bấm (hoặc Esc) để tắt">◎ Gợi ý · Tắt ✕</button>`:`<button class="sm${G.trace?" on":""}" data-act="gTrace" aria-pressed="${!!G.trace}" title="Chỉ làm nổi các khối và mũi tên vừa có dữ liệu chạy qua (phím T)">◎ Trace</button>`}${CMP?`<button class="sm${UI.legend?" on":""}" data-act="gLegend" aria-pressed="${!!UI.legend}" aria-controls="glegend" title="Mỗi hình khối là một loại thành phần">◇<span class="hide-s"> Chú giải</span></button>`:""}`:""}<span class="grow"></span><div class="seg" role="group" aria-label="Kiểu xem"><button class="${view==="graph"?"on":""}" data-act="gView" data-arg="graph" aria-pressed="${view==="graph"}">Sơ đồ</button><button class="${view==="list"?"on":""}" data-act="gView" data-arg="list" aria-pressed="${view==="list"}">Danh sách</button></div></div>`;
  if(view==="list"){const rows=L.nodes.map(n=>({id:n.id,h:`<li class="glrow${n.v.ghost?" ghost":""}"><button class="gl" data-node="${n.id}">${icHtml(n.def)}<span class="gtt"><span class="gl-top"><b>${esc(n.id)}</b>${n.v.st?`<span class="gpill s-${n.v.st[0]||"none"}"><i></i>${esc(n.v.st[1])}</span>`:""}${n.v.cost>0?`<span class="gcost">${money(n.v.cost)}</span>`:""}</span><small>${esc(n.def.label)} · ${esc(relText(L,n))}</small></span><span class="chev" aria-hidden="true">›</span></button><button class="sm" data-act="gMenu" data-arg="${n.id}" data-gconnect="${n.id}">Nối…</button></li>`}));
    return{lpre:tools+`<div class="gx-row">`+pickerHtml()+`<div class="glist-wrap">`+gMenuHtml(L,true)+`<ul class="glist" aria-label="Các khối và mũi tên">`,rows:rows.length?rows:[{id:"",h:`<li class="glrow"><div class="gl">Canvas trống. Mở ＋ Thành phần để thêm.</div></li>`}],lpost:`</ul></div></div>`}}
  const empty=!L.nodes.length&&!L.boxes.length?`<div class="gx-empty"><b>Canvas trống</b><span>${esc(TX("emptyCanvas"))}</span></div>`:"";
  GWH=[L.W,L.H];const ws=gWorldStyle(L.W,L.H,pan,z);
  return{pre:tools+`<div class="gx-row">`+pickerHtml()+`<div class="gx${UI.gdrag?" connecting":""}" data-gx>`,ws,world:gParts(L),
    post:`</div>${empty}${CMP&&UI.legend&&view==="graph"?legendHtml():""}${UI.gnote?`<div class="gx-note callout ${UI.gnote.kind==="info"?"ctx":"warn"}" role="status"><span>${esc(UI.gnote.text)}</span><button class="sm ghost" data-act="gNoteClose" aria-label="Đóng">×</button></div>`:""}${gMenuHtml(L,false)}</div></div>`}}
function legendHtml(){return`<div class="glegend" id="glegend" role="note" aria-label="Chú giải hình khối"><b>Hình khối</b><ul>${Object.entries(SHAPE_KINDS).map(([k,t])=>`<li>${shapeSvg(k,38,18)}<span>${esc(t)}</span></li>`).join("")}</ul>${DOMAIN.legendExtra?DOMAIN.legendExtra():""}<small>${esc(TX("iconCredit")||"")}</small></div>`}
const canvasJoin=c=>c.rows?c.lpre+c.rows.map(r=>r.h).join("")+c.lpost:c.pre+`<div class="gx-world" id="gworld" style="${c.ws}">`+gJoin(c.world)+c.post;
function canvasHtml(){return canvasJoin(canvasParts())}
/* code that changes canvas DOM directly (pan/zoom, drag highlights) calls this so the next render rewrites it */
function gDirty(){const c=document.getElementById("canvas");if(c)c.__cv=null}
function gRefresh(){const w=document.getElementById("gworld");if(!w){const c=document.getElementById("canvas");if(c&&!UI.code||UI.split)renderCanvas();return}
  const L=layoutModel();GLAST=L;GWH=[L.W,L.H];gSetStyle(w,gWorldStyle(L.W,L.H,GCUR.pan,GCUR.z));gPatchWorld(w,gParts(L));if(UI.hintFx&&typeof hintFx==="function")hintFx()}
function gApply(){const w=document.getElementById("gworld");if(w)gSetStyle(w,gWorldStyle(GWH[0],GWH[1],GCUR.pan,GCUR.z));if(UI.hintFx&&typeof hintPos==="function")hintPos();const zl=document.querySelector(".gx-tools .gz");if(zl){const t=Math.round(GCUR.z*100)+"%";if(zl.textContent!==t){zl.textContent=t;gDirty()}}}
function gFreeze(){const G=gs();G.zoom=GCUR.z;G.pan=[...GCUR.pan]}
function gZoomAt(nz,cx,cy){const G=gs();nz=Math.max(.3,Math.min(2,nz));const z=GCUR.z,p=GCUR.pan;if(cx===undefined){const gx=document.querySelector(".gx");cx=gx?gx.clientWidth/2:300;cy=gx?gx.clientHeight/2:200}
  const wx=(cx-p[0])/z,wy=(cy-p[1])/z;G.zoom=nz;G.pan=[cx-wx*nz,cy-wy*nz];GCUR={z:nz,pan:G.pan};gApply()}
function toWorld(cx,cy){const gx=document.querySelector(".gx");if(!gx)return[100,100];const r=gx.getBoundingClientRect();return[(cx-r.left-GCUR.pan[0])/GCUR.z,(cy-r.top-GCUR.pan[1])/GCUR.z]}
/* nearest spot to (x,y) that doesn't overlap a node or a VPC/subnet box */
function freeSpot(x,y){const L=typeof GLAST!=="undefined"&&GLAST;if(!L)return[x,y];const W=GW+30,H=170,rects=[...L.nodes.map(n=>({x:n.x,y:n.y,w:GW,h:n.h||150})),...(L.boxes||[])];
  const hit=(px,py)=>rects.some(r=>px<r.x+r.w+20&&px+W>r.x-20&&py<r.y+r.h+20&&py+H>r.y-20);
  for(let ring=0;ring<12;ring++)for(const[dx,dy]of[[0,0],[1,0],[0,1],[-1,0],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){const px=x+dx*ring*W/1.5,py=y+dy*ring*H/1.5;if(!hit(px,py))return[Math.round(px),Math.round(py)]}
  return[x,y]}
function viewCenter(){const gx=document.querySelector(".gx");if(!gx)return[80+Object.keys(M.pos).length*30,80+Object.keys(M.pos).length*20];return[(gx.clientWidth/2-GCUR.pan[0])/GCUR.z-GW/2,(gx.clientHeight/2-GCUR.pan[1])/GCUR.z-50]}
function gNeighbor(id,key){const L=GLAST;if(!L||!L.by[id])return null;const n=L.by[id],c=[n.x+n.w/2,n.y+n.h/2],dir={ArrowRight:[1,0],ArrowLeft:[-1,0],ArrowDown:[0,1],ArrowUp:[0,-1]}[key];
  const linked=new Set(L.edges.filter(e=>e.from===id||e.to===id).map(e=>e.from===id?e.to:e.from));let best=null,bs=Infinity;
  for(const o of L.nodes){if(o.id===id)continue;const d=[o.x+o.w/2-c[0],o.y+o.h/2-c[1]],along=d[0]*dir[0]+d[1]*dir[1];if(along<=8)continue;const s=Math.hypot(...d)+Math.abs(d[0]*dir[1]-d[1]*dir[0])*1.5-(linked.has(o.id)?120:0);if(s<bs){bs=s;best=o}}return best&&best.id}
/* connect a → b via the catalog rule; asks first when a permission can be granted at the same time */
function doConnect(a,b){const r=connectRule(a,b);if(!r)return false;UI.gmenu=null;UI.gnote=null;UI.lastOpener=`[data-gconnect="${a}"]`;
  if(r.grant){const role=r.grant.role,net=!!r.grant.text;UI.modal={title:`Nối ${a} → ${b}`,submitLabel:"Nối",init:{grant:1},body:`<p>${esc(r.label)}.</p>`,fields:[{type:"checks",label:net?"Security group":"Quyền",items:[["grant",net?r.grant.text:`Thêm ${r.grant.actions.join(", ")} vào role ${role}`]]}],
    note:v=>v.grant?"":`<div class="callout warn"><b>${net?"Không mở security group":"Không cấp quyền"}</b>Mô phỏng sẽ báo ${net?"lỗi kết nối":"AccessDenied"} ở mũi tên này. Bạn có thể tự sửa sau, đó cũng là một cách học ${net?"security group":"IAM"}.</div>`,
    submit:v=>{edit(`${a} → ${b}`,()=>r.apply(!!+v.grant));log("CloudLab","editor","connect",`${a} → ${b}: ${r.label}`,"ok");return{ok:true}}};return true}
  edit(`${a} → ${b}`,()=>r.apply(true));log("CloudLab","editor","connect",`${a} → ${b}: ${r.label}`,"ok");return true}
