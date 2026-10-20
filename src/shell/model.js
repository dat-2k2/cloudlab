"use strict";
/* The model being edited, shared by every domain:
   M = { name, desc, res:{Id:{Type,Properties,…}},   // resources the domain deploys (stack, manifests…)
         ext:{Id:{Type,Properties}},                // simulation-only actors outside the system (clients, monitors)
         manual:{Id:{…}},                           // created by hand outside the deployment (on the canvas only)
         pos:{Id:[x,y]} }
   Edges, YAML, adding, connecting and renaming are the domain's (aws/cfn.js, k8s/src/model.js). */
function emptyModel(name){return{name:name||"sandbox",desc:"",res:{},ext:{},manual:{},pos:{}}}
function scopeOf(id){return M.res[id]?"res":M.ext[id]?"ext":M.manual[id]?"manual":null}
function rawOf(id){return M.res[id]||M.ext[id]||M.manual[id]||null}
function nodeOf(id){const r=rawOf(id);if(!r)return null;const d=T[r.Type]||{label:r.Type,short:"?",cat:"infra",fields:[],rel:{},doc:"Loại tài nguyên CloudLab chưa mô phỏng."};
  return{id,type:r.Type,props:r.Properties||(r.Properties={}),raw:r,def:d,scope:scopeOf(id),ext:!!d.ext}}
function allNodes(){return[...Object.keys(M.ext),...Object.keys(M.res),...Object.keys(M.manual)].map(nodeOf).filter(n=>n&&!n.def.edge)}
const physName=n=>{try{return(n.def.name&&n.def.name(n.props))||n.id}catch(_){return n.id}};
function freeId(base){let i=1;while(rawOf(base+i))i++;return base+i}
