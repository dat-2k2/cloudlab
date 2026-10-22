"use strict";
/* GCP pack · Terraform (HCL native syntax) reader and writer, enough for the configurations a learner or Gemini writes:
   blocks with labels, attributes, nested blocks, strings with ${…} interpolation, heredocs, numbers, bools, null,
   lists, maps, and any other expression (references, function calls, conditionals) kept verbatim.
   Values in the model: a literal is a JS value; an expression is {"$":"google_compute_network.vpc.id"};
   a nested block is an object (or an array of objects when it repeats). Which keys are blocks is known from the
   catalog (BLOCK_KEYS) plus every block name seen while parsing, so a file round-trips. */
const BLOCK_KEYS=new Set(["boot_disk","initialize_params","network_interface","access_config","allow","deny","template","containers","scaling","ports","resources",
  "env","value_source","secret_key_ref","vpc_access","network_interfaces","capacity_config","gcp_config","access_config","network_configs","rebalance_config",
  "amount","specified_amount","threshold_rules","all_updates_rule","budget_filter","labels_block","lifecycle_rule","condition","action","versioning","website",
  "persistence_config","maintenance_policy","weekly_maintenance_window","start_time","service_account","scheduling","shielded_instance_config","traffic",
  "settings","ip_configuration","backup_configuration","database_flags","psc_auto_connections","psc_config","discovery_endpoints","log_config","timeouts","lifecycle",
  "required_providers","backend","startup_probe","liveness_probe","http_get","tcp_socket","volume_mounts","volumes","cloud_sql_instance","binding","condition_block",
  "push_config","dead_letter_policy","retry_policy","message_storage_policy","cors","uniform_bucket_level_access_block","sensitive_labels","custom_period","calendar_period"]);
/* attributes that are maps even though they hold objects (never printed as blocks) */
const MAP_KEYS=new Set(["labels","metadata","tags_map","variables","annotations","default_labels","configs","node_config","credit_types","projects_map","resource_labels","user_labels","env_map","redis_configs"]);
/* blocks that are lists by nature: always kept as arrays, even with one entry */
const LIST_BLOCKS=new Set(["env","allow","deny","threshold_rules","ports","volumes","volume_mounts","lifecycle_rule","database_flags"]);
const isExpr=v=>!!v&&typeof v==="object"&&!Array.isArray(v)&&typeof v.$==="string"&&Object.keys(v).length===1;
const isBlockVal=(k,v)=>!MAP_KEYS.has(k)&&BLOCK_KEYS.has(k)&&v&&typeof v==="object"&&!isExpr(v)&&(Array.isArray(v)?v.length>0&&v.every(x=>x&&typeof x==="object"&&!Array.isArray(x)&&!isExpr(x)):true);
class HclError extends Error{constructor(msg,line){super(msg);this.line=line}}
/* ---------------- reader ---------------- */
function hclParse(src){src=String(src).replace(/\r\n?/g,"\n");let i=0,line=1;const N=src.length;
  const err=m=>{throw new HclError(m,line)};
  const peek=(o=0)=>src[i+o];
  const adv=()=>{const c=src[i++];if(c==="\n")line++;return c};
  /* whitespace and comments; nl=true also skips newlines */
  function ws(nl){for(;;){const c=src[i];
      if(c===" "||c==="\t"||(nl&&c==="\n")){adv();continue}
      if(c==="#"||(c==="/"&&src[i+1]==="/")){while(i<N&&src[i]!=="\n")i++;continue}
      if(c==="/"&&src[i+1]==="*"){i+=2;while(i<N&&!(src[i]==="*"&&src[i+1]==="/"))adv();if(i>=N)err("Chú thích /* chưa đóng");i+=2;continue}
      break}}
  const ident=()=>{const m=/^[A-Za-z_][A-Za-z0-9_-]*/.exec(src.slice(i,i+200));if(!m)return null;i+=m[0].length;return m[0]};
  function str(){/* at opening quote */adv();let out="";for(;;){if(i>=N)err("Chuỗi chưa đóng dấu \"");if(src[i]==="\n")err("Chuỗi chưa đóng dấu \" trước khi xuống dòng");const c=adv();
      if(c==="\""){return out}
      if(c==="\\"){const e=adv();out+=e==="n"?"\n":e==="t"?"\t":e==="r"?"\r":e==="\""?"\"":e==="\\"?"\\":e==="u"?String.fromCharCode(parseInt(src.slice(i,(i+=4)),16)):"\\"+e;continue}
      if((c==="$"||c==="%")&&src[i]==="{"){/* interpolation: copy through, balanced */let d=0,s=c;do{const x=adv();if(x==="{")d++;else if(x==="}")d--;s+=x;if(i>=N)err("${ chưa đóng")}while(d>0);out+=s;continue}
      out+=c}}
  function heredoc(){/* at << */i+=2;const strip=src[i]==="-";if(strip)i++;const tag=ident();if(!tag)err("Heredoc thiếu tên (ví dụ <<EOT)");
    while(src[i]!=="\n"&&i<N)i++;adv();const lines=[];for(;;){if(i>=N)err(`Heredoc ${tag} chưa đóng`);let e=src.indexOf("\n",i);if(e<0)e=N;const l=src.slice(i,e);
      i=e;if(i<N)adv();if(l.trim()===tag)break;lines.push(l)}
    if(strip){const ind=Math.min(...lines.filter(l=>l.trim()).map(l=>l.match(/^[ \t]*/)[0].length));return lines.map(l=>l.slice(isFinite(ind)?ind:0)).join("\n")+"\n"}return lines.join("\n")+"\n"}
  /* raw expression text until , or newline or a closing bracket at depth 0 */
  function rawExpr(){const st=i,stLine=line;let d=0;for(;;){if(i>=N)break;const c=src[i];
      if(c==="\""){str();continue}
      if(c==="#"||(c==="/"&&src[i+1]==="/"))break;
      if("([{".includes(c)){d++;adv();continue}
      if(")]}".includes(c)){if(d===0)break;d--;adv();continue}
      if(d===0&&(c===","||c==="\n"))break;
      if(c==="\n"&&d>0){adv();continue}
      adv()}
    const t=src.slice(st,i).trim();if(!t){line=stLine;err("Thiếu giá trị")}return{$:t}}
  function value(){ws(false);const c=src[i];
    if(c===undefined||c==="\n")err("Thiếu giá trị sau dấu =");
    if(c==="\""){const save=i,sl=line;const s=str();ws(false);if(rest()){i=save;line=sl;return rawExpr()}return s}
    if(c==="<"&&src[i+1]==="<")return heredoc();
    if(c==="["){/* list unless it is a for-expression */if(/^\[\s*for\s/.test(src.slice(i,i+40)))return rawExpr();
      const save=i,sl=line;adv();const out=[];for(;;){ws(true);if(src[i]==="]"){adv();break}out.push(value());ws(true);if(src[i]===","){adv();continue}if(src[i]==="]"){adv();break}err("Danh sách thiếu dấu , hoặc ]")}
      ws(false);if(rest()){i=save;line=sl;return rawExpr()}return out}
    if(c==="{"){if(/^\{\s*for\s/.test(src.slice(i,i+40)))return rawExpr();const save=i,sl=line;adv();const o={};for(;;){ws(true);if(src[i]==="}"){adv();break}
        let k;if(src[i]==="\"")k=str();else if(src[i]==="("){const st=i;let d=0;do{const x=adv();if(x==="(")d++;else if(x===")")d--;if(i>=N)err("Thiếu dấu )")}while(d>0);k=src.slice(st,i)}else{k=ident();if(k===null)err("Khóa của map không hợp lệ")}
        ws(false);if(src[i]!=="="&&src[i]!==":")err(`Thiếu dấu = sau khóa ${k}`);adv();o[k]=value();ws(false);if(src[i]===",")adv();ws(true)}
      ws(false);if(rest()){i=save;line=sl;return rawExpr()}return o}
    const m=/^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(i,i+40));if(m&&!/[A-Za-z_.]/.test(src[i+m[0].length]||"")){const save=i;i+=m[0].length;ws(false);if(rest()){i=save;return rawExpr()}return+m[0]}
    const w=/^(true|false|null)\b/.exec(src.slice(i,i+6));if(w){const save=i;i+=w[0].length;ws(false);if(rest()){i=save;return rawExpr()}return w[1]==="null"?null:w[1]==="true"}
    return rawExpr()}
  /* after a complete literal: is there more expression on the line (operators etc.)? */
  const rest=()=>{const c=src[i];return!(c===undefined||c==="\n"||c===","||c==="]"||c==="}"||c===")"||c==="#"||(c==="/"&&(src[i+1]==="/"||src[i+1]==="*")))};
  /* a body: attributes and blocks until } (or end of file at top level) */
  function body(top){const attrs={},blocks=[];for(;;){ws(true);if(i>=N){if(!top)err("Thiếu dấu } đóng block");break}
      if(src[i]==="}"){if(top)err("Dấu } thừa");adv();break}
      const l0=line,k=ident();if(k===null)err(`Không đọc được: “${src.slice(i,i+20).split("\n")[0]}”`);ws(false);
      if(src[i]==="="&&src[i+1]!=="="){adv();if(k in attrs)err(`Thuộc tính ${k} khai báo hai lần`);attrs[k]=value();ws(false);if(src[i]&&src[i]!=="\n"&&src[i]!=="}"&&!(src[i]==="#"||src[i]==="/"))err(`Thừa ký tự sau giá trị của ${k}`);continue}
      const labels=[];for(;;){ws(false);if(src[i]==="\""){labels.push(str());continue}if(src[i]==="{")break;const id=ident();if(id===null)err(`Sau ${k} cần dấu = (thuộc tính) hoặc { (block)`);labels.push(id)}
      adv();const b=body(false);blocks.push({type:k,labels,body:b,line:l0})}
    return{attrs,blocks}}
  return body(true)}
/* a parsed body → the model's plain object: attributes as values, nested blocks as objects / arrays */
function bodyToObj(b){const o={};for(const[k,v]of Object.entries(b.attrs))o[k]=v;
  for(const x of b.blocks){BLOCK_KEYS.add(x.type);const v=bodyToObj(x.body);if(x.labels.length)v.__label=x.labels.length===1?x.labels[0]:x.labels;
    if(x.type in o){if(!Array.isArray(o[x.type])||!isBlockVal(x.type,o[x.type]))o[x.type]=[o[x.type]];o[x.type].push(v)}else o[x.type]=LIST_BLOCKS.has(x.type)?[v]:v}
  return o}
/* ---------------- writer (terraform fmt style: 2 spaces, = aligned within a run of single-line attributes) ---------------- */
const HCL_ID=/^[A-Za-z_][A-Za-z0-9_-]*$/;
function hclStr(s){if(s.includes("\n")&&s.length>40){const body=s.replace(/\n$/,"").split("\n");return{heredoc:body}}
  return"\""+s.replace(/\\/g,"\\\\").replace(/"/g,"\\\"").replace(/\n/g,"\\n").replace(/\t/g,"\\t")+"\""}
function hclVal(v,ind){const pad="  ".repeat(ind);
  if(v===null||v===undefined)return"null";if(typeof v==="boolean"||typeof v==="number")return String(v);
  if(typeof v==="string"){const s=hclStr(v);return typeof s==="string"?s:`<<-EOT\n${s.heredoc.map(l=>pad+"  "+l).join("\n")}\n${pad}EOT`}
  if(isExpr(v))return v.$;
  if(Array.isArray(v)){if(!v.length)return"[]";const parts=v.map(x=>hclVal(x,ind+1));const flat=parts.every(p=>!p.includes("\n"));
    if(flat&&parts.join(", ").length+pad.length<90)return"["+parts.join(", ")+"]";return"[\n"+parts.map(p=>pad+"  "+p+",").join("\n")+"\n"+pad+"]"}
  const ks=Object.keys(v).filter(k=>k!=="__label"&&v[k]!==undefined);if(!ks.length)return"{}";
  const key=k=>HCL_ID.test(k)?k:JSON.stringify(k),w=Math.max(...ks.map(k=>key(k).length));
  const lines=ks.map(k=>{const x=hclVal(v[k],ind+1);return pad+"  "+key(k).padEnd(x.includes("\n")?0:w)+" = "+x});
  if(ks.length===1&&!lines[0].includes("\n")&&lines[0].length<80)return"{ "+lines[0].trim()+" }";return"{\n"+lines.join("\n")+"\n"+pad+"}"}
/* write a body: simple attributes first (aligned in runs), then blocks; keeps the order the keys have */
function hclBody(o,ind){const pad="  ".repeat(ind),out=[];let run=[];
  const flush=()=>{if(!run.length)return;const w=Math.max(...run.filter(r=>!r[1].includes("\n")).map(r=>r[0].length),0);for(const[k,x]of run)out.push(pad+(x.includes("\n")?k:k.padEnd(w))+" = "+x);run=[]};
  for(const k of Object.keys(o)){const v=o[k];if(k==="__label"||v===undefined)continue;
    if(isBlockVal(k,v)){flush();for(const b of arr(v)){const lab=b.__label!=null?" "+arr(b.__label).map(x=>JSON.stringify(x)).join(" "):"";
        const inner=hclBody(b,ind+1);if(out.length&&out[out.length-1]!=="")out.push("");out.push(`${pad}${k}${lab} {`+(inner?"\n"+inner+"\n"+pad+"}":"}"))}continue}
    if(out.length&&out[out.length-1].endsWith("}")&&!run.length)out.push("");
    run.push([HCL_ID.test(k)?k:JSON.stringify(k),hclVal(v,ind)])}
  flush();return out.join("\n")}
function hclBlock(type,labels,o){const inner=hclBody(o,1);return`${type}${labels.map(l=>" "+JSON.stringify(l)).join("")} {`+(inner?"\n"+inner+"\n}":"}")}
/* ---------------- references inside values ---------------- */
const TF_REF=/\b((?:google|cloudlab)_[a-z0-9_]+)\.([A-Za-z_][A-Za-z0-9_-]*)((?:\.[A-Za-z_][A-Za-z0-9_]*|\[[^\]]*\])*)/g;
/* visit references: cb(path, type, name, attrPath) */
function walkTf(v,path,cb){if(v==null)return;
  const scan=s=>{TF_REF.lastIndex=0;let m;while((m=TF_REF.exec(s)))cb(path,m[1],m[2],m[3]||"")};
  if(typeof v==="string"){if(v.includes("${"))String(v).replace(/\$\{([^}]*)\}/g,(_,x)=>{scan(x);return""});return}
  if(isExpr(v)){scan(v.$);return}
  if(typeof v!=="object")return;
  if(Array.isArray(v)){v.forEach((x,i)=>walkTf(x,path?path+"."+i:String(i),cb));return}
  for(const k of Object.keys(v))if(k!=="__label")walkTf(v[k],path?path+"."+k:k,cb)}
/* rename / drop references to one address */
function mapTf(v,fn){if(v==null)return v;
  if(typeof v==="string")return v.includes("${")?v.replace(/\$\{([^}]*)\}/g,(_,x)=>"${"+fn(x)+"}"):v;
  if(isExpr(v))return{$:fn(v.$)};if(typeof v!=="object")return v;
  if(Array.isArray(v))return v.map(x=>mapTf(x,fn));const o={};for(const k of Object.keys(v))o[k]=mapTf(v[k],fn);return o}
const reEsc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
function renameTfRefs(v,fromAddr,toAddr){const re=new RegExp("\\b"+reEsc(fromAddr)+"(?=$|[^A-Za-z0-9_-])","g");return mapTf(v,s=>s.replace(re,toAddr))}
function refsTo(v,addr){let hit=false;walkTf(v,"",(p,t,n)=>{if(t+"."+n===addr)hit=true});return hit}
/* drop values that reference addr (an attribute set to it, a list item) */
function stripTf(v,addr){if(v==null||typeof v!=="object"||isExpr(v)){return refsTo(v,addr)?undefined:v}
  if(Array.isArray(v)){const o=[];for(const x of v){const y=stripTf(x,addr);if(y!==undefined)o.push(y)}return o}
  const o={};for(const k of Object.keys(v)){const y=stripTf(v[k],addr);if(y!==undefined)o[k]=y}return o}
