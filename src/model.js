"use strict";
/* The template model (one CloudFormation stack + external actors + layout).
   M = { name, desc, res:{Id:{Type,Properties,DeletionPolicy?,Metadata?}}, ext:{Id:{Type,Properties}},
         manual:{Id:{...}}  // created by hand outside the stack: on the canvas, not in the YAML
         pos:{Id:[x,y]} }
   Relations are never stored separately: an edge exists because a property references another resource
   (!Ref / !GetAtt / !Sub "${X}"), exactly like in a real template. */
function emptyModel(name){return{name:name||"sandbox",desc:"",res:{},ext:{},manual:{},pos:{}}}
const ATT={"AWS::S3::Bucket":"Arn","AWS::Lambda::Function":"Arn","AWS::IAM::Role":"Arn","AWS::SNS::Topic":"TopicArn","AWS::SQS::Queue":"Arn","AWS::DynamoDB::Table":"Arn"};
function scopeOf(id){return M.res[id]?"res":M.ext[id]?"ext":M.manual[id]?"manual":null}
function rawOf(id){return M.res[id]||M.ext[id]||M.manual[id]||null}
function nodeOf(id){const r=rawOf(id);if(!r)return null;const d=T[r.Type]||{label:r.Type,short:"?",cat:"infra",fields:[],rel:{},doc:"Loại tài nguyên CloudLab chưa mô phỏng."};
  return{id,type:r.Type,props:r.Properties||(r.Properties={}),raw:r,def:d,scope:scopeOf(id),ext:!!d.ext}}
function allNodes(){return[...Object.keys(M.ext),...Object.keys(M.res),...Object.keys(M.manual)].map(nodeOf).filter(n=>n&&!n.def.edge)}
const physName=n=>{try{return(n.def.name&&n.def.name(n.props))||n.id}catch(_){return n.id}};
function arnOf(id){const n=nodeOf(id);if(!n)return"";const nm=physName(n);
  return({"AWS::S3::Bucket":`arn:aws:s3:::${nm}`,"AWS::Lambda::Function":`arn:aws:lambda:${REGION}:${ACCT}:function:${nm}`,"AWS::IAM::Role":`arn:aws:iam::${ACCT}:role/${nm}`,
    "AWS::SNS::Topic":`arn:aws:sns:${REGION}:${ACCT}:${nm}`,"AWS::SQS::Queue":`arn:aws:sqs:${REGION}:${ACCT}:${nm}`,"AWS::DynamoDB::Table":`arn:aws:dynamodb:${REGION}:${ACCT}:table/${nm}`,
    "AWS::Logs::LogGroup":`arn:aws:logs:${REGION}:${ACCT}:log-group:${nm}:*`})[n.type]||`arn:aws:cloudformation:${REGION}:${ACCT}:${id}`}
function refValue(id){const n=nodeOf(id);if(!n)return"";if(["AWS::SNS::Topic"].includes(n.type))return arnOf(id);if(n.type==="AWS::SQS::Queue")return`https://sqs.${REGION}.amazonaws.com/${ACCT}/${physName(n)}`;return physName(n)}
/* resolve intrinsics to plain strings (for IAM evaluation and display) */
function resolve(v){if(v==null)return v;if(typeof v!=="object")return v;
  if(Array.isArray(v))return v.map(resolve);
  if("Ref" in v)return v.Ref==="AWS::AccountId"?ACCT:v.Ref==="AWS::Region"?REGION:refValue(v.Ref);
  if("Fn::GetAtt" in v){const[a]=arr(v["Fn::GetAtt"]).length===1?String(v["Fn::GetAtt"]).split("."):v["Fn::GetAtt"];return arnOf(a)}
  if("Fn::Sub" in v){const s=Array.isArray(v["Fn::Sub"])?v["Fn::Sub"][0]:v["Fn::Sub"];return String(s).replace(/\$\{([^}]+)\}/g,(_,x)=>x==="AWS::AccountId"?ACCT:x==="AWS::Region"?REGION:x.includes(".")?arnOf(x.split(".")[0]):refValue(x))}
  if("Fn::Join" in v){const[sep,list]=v["Fn::Join"];return arr(list).map(resolve).join(sep)}
  const o={};for(const k in v)o[k]=resolve(v[k]);return o}
function refId(v){if(!v||typeof v!=="object")return null;if("Ref" in v)return v.Ref;if("Fn::GetAtt" in v){const g=v["Fn::GetAtt"];return Array.isArray(g)?g[0]:String(g).split(".")[0]}return null}
/* visit every reference inside a value: cb(path, targetId) */
function walkRefs(v,path,cb){if(v==null||typeof v!=="object")return;
  const id=refId(v);if(id){cb(path,id);return}
  if("Fn::Sub" in v){const s=Array.isArray(v["Fn::Sub"])?v["Fn::Sub"][0]:v["Fn::Sub"];String(s).replace(/\$\{([^}]+)\}/g,(_,x)=>{if(!x.startsWith("AWS::"))cb(path,x.split(".")[0]);return""});return}
  for(const k of Object.keys(v))walkRefs(v[k],path?path+"."+k:k,cb)}
const relRe={};const relMatch=(pat,path)=>(relRe[pat]||(relRe[pat]=new RegExp("^"+pat.replace(/\./g,"\\.").replace(/\*/g,"[^.]+")+"(\\..*)?$"))).test(path);
/* all edges, derived from references */
function edges(){const out=[],seen=new Set(),add=e=>{const k=e.from+">"+e.to+">"+e.kind;if(seen.has(k)||!nodeOf(e.from)||!nodeOf(e.to)||e.from===e.to)return;seen.add(k);e.id=k;out.push(e)};
  const nodes=[...Object.keys(M.ext),...Object.keys(M.res),...Object.keys(M.manual)];
  for(const id of nodes){const n=nodeOf(id);if(!n)continue;
    if(n.def.edge){if(n.def.edgeOf)for(const e of n.def.edgeOf(n.props,id)||[])if(e.from&&e.to)add({...e,owner:id,path:"*"});continue}
    walkRefs(n.props,"",(path,to)=>{if(!rawOf(to))return;const tn0=nodeOf(to);if(tn0.def.edge){if(!tn0.def.proxy)return;to=tn0.def.proxy(tn0.props);if(!to||!rawOf(to))return}const spec=Object.entries(n.def.rel||{}).find(([p])=>relMatch(p,path)),r=spec?spec[1]:{kind:"ref",label:path.split(".").pop()};
      const tn=nodeOf(to);let label=r.label;
      if(r.kind==="uses")label=(USE_LABEL[tn.type]||"dùng")+" · "+path.split(".").pop();
      if(r.kind==="grants"){const ks=path.split("."),si=ks.indexOf("Statement"),st=si>0?getP(n.props,ks.slice(0,si+2).join(".")):null;label=st?(st.Effect==="Deny"?"deny ":"")+arr(st.Action).join(", "):"cho phép";if(label.length>34)label=label.slice(0,33)+"…"}
      if(typeof label==="function")label=label(n.props,path,to);
      const e=r.reverse?{from:to,to:id}:{from:id,to};add({...e,kind:r.kind,label:label||"",owner:id,path,hidden:r.kind==="contains",deny:r.kind==="grants"&&/^deny /.test(label||"")})});
    arr(getP(n.raw,"Metadata.CloudLab.Uses")).forEach(u=>{const t=refId(u)||(typeof u==="string"?u:null);if(t&&rawOf(t))add({from:id,to:t,kind:"uses",label:"app gọi",owner:id,path:"@Uses"})});
    if(n.type==="AWS::SNS::Topic")arr(n.props.Subscription).forEach((s,i)=>{if(s&&s.Protocol==="email")for(const x of Object.keys(M.ext))if(M.ext[x].Type==="CloudLab::Inbox"&&(M.ext[x].Properties||{}).Address===s.Endpoint)add({from:id,to:x,kind:"delivers",label:"email",owner:id,path:"Subscription."+i})})}
  return out}
/* ---------------- edits ---------------- */
const BASE_ID={"AWS::Lambda::Function":"Function","AWS::S3::Bucket":"Bucket","AWS::IAM::Role":"Role","AWS::SNS::Topic":"Topic","AWS::SQS::Queue":"Queue","AWS::DynamoDB::Table":"Table","AWS::ApiGatewayV2::Api":"Api",
  "AWS::Events::Rule":"Schedule","AWS::Logs::LogGroup":"LogGroup","AWS::CloudWatch::Alarm":"Alarm","AWS::Budgets::Budget":"Budget","AWS::S3::BucketPolicy":"BucketPolicy","AWS::Lambda::EventSourceMapping":"Mapping",
  "CloudLab::Client":"Client","CloudLab::Uploader":"Uploader","CloudLab::Inbox":"Inbox","CloudLab::Monitor":"Monitor"};
function freeId(base){let i=1;while(rawOf(base+i))i++;return base+i}
function addNode(type,x,y,id){const d=T[type];id=id||freeId(BASE_ID[type]||"Resource");const raw={Type:type,Properties:clone(d.defaults(id))};
  if(d.meta)raw.Metadata={CloudLab:clone(d.meta)};
  (d.ext?M.ext:M.res)[id]=raw;M.pos[id]=[Math.round(x),Math.round(y)];return id}
/* drop every reference to `id` (used when deleting a node) */
function stripRefs(v,id){if(v==null||typeof v!=="object")return v;if(refId(v)===id)return undefined;
  if("Fn::Sub" in v){const s=Array.isArray(v["Fn::Sub"])?v["Fn::Sub"][0]:v["Fn::Sub"];return new RegExp("\\$\\{"+id+"[.}]").test(s)?undefined:v}
  if(Array.isArray(v)){const o=[];for(const x of v){const y=stripRefs(x,id);if(y!==undefined&&!(y&&typeof y==="object"&&!Array.isArray(y)&&Object.keys(y).length===0&&Object.keys(x).length>0&&Object.values(x).some(z=>refId(z)===id)))o.push(y)}return o}
  const o={};for(const k of Object.keys(v)){const y=stripRefs(v[k],id);if(y!==undefined)o[k]=y;else if(["Target","Role","Bucket","As"].includes(k))o[k]=null}return o}
function removeNode(id){const sc=scopeOf(id);if(!sc)return;delete M[sc][id];delete M.pos[id];
  for(const s of ["res","ext","manual"])for(const k of Object.keys(M[s])){const r=M[s][k];
    r.Properties=stripRefs(r.Properties||{},id);const mu=getP(r,"Metadata.CloudLab.Uses");if(mu)r.Metadata.CloudLab.Uses=arr(mu).filter(u=>(refId(u)||u)!==id);
    const d=T[r.Type];if(d&&d.edge&&d.edgeOf&&!(d.edgeOf(r.Properties,k)||[]).some(e=>e.from&&e.to))delete M[s][k]}}
function renameRefs(v,a,b){if(v==null||typeof v!=="object")return v;
  if(Array.isArray(v))return v.map(x=>renameRefs(x,a,b));
  if("Ref" in v&&v.Ref===a)return{Ref:b};
  if("Fn::GetAtt" in v){const g=v["Fn::GetAtt"];if(Array.isArray(g)&&g[0]===a)return{"Fn::GetAtt":[b,...g.slice(1)]};if(typeof g==="string"&&g.split(".")[0]===a)return{"Fn::GetAtt":b+g.slice(a.length)}}
  if("Fn::Sub" in v){const re=new RegExp("\\$\\{"+a+"([.}])","g"),f=s=>String(s).replace(re,"${"+b+"$1");return{"Fn::Sub":Array.isArray(v["Fn::Sub"])?[f(v["Fn::Sub"][0]),renameRefs(v["Fn::Sub"][1],a,b)]:f(v["Fn::Sub"])}}
  const o={};for(const k of Object.keys(v))o[k]=renameRefs(v[k],a,b);return o}
function renameNode(a,b){if(a===b)return{ok:true};if(!/^[A-Za-z][A-Za-z0-9]{0,254}$/.test(b))return{ok:false,err:"Logical ID chỉ gồm chữ và số, bắt đầu bằng chữ."};if(rawOf(b))return{ok:false,err:`${b} đã tồn tại.`};
  const sc=scopeOf(a);const reb=o=>{const n={};for(const k of Object.keys(o))n[k===a?b:k]=o[k];return n};M[sc]=reb(M[sc]);M.pos=reb(M.pos);
  for(const s of ["res","ext","manual"])for(const k of Object.keys(M[s])){M[s][k].Properties=renameRefs(M[s][k].Properties||{},a,b);if(M[s][k].Metadata)M[s][k].Metadata=renameRefs(M[s][k].Metadata,a,b)}return{ok:true}}
/* remove the reference an edge comes from */
function removeEdge(e){const o=nodeOf(e.owner);if(!o)return;
  if(o.def.edge){delete M[o.scope][o.id];return}
  if(e.path==="@Uses"){o.raw.Metadata.CloudLab.Uses=arr(o.raw.Metadata.CloudLab.Uses).filter(u=>(refId(u)||u)!==e.to);return}
  if(e.kind==="delivers"&&e.path.startsWith("Subscription.")){o.props.Subscription.splice(+e.path.split(".")[1],1);return}
  const ks=e.path.split(".");
  // array element that holds the reference (Targets.0.Arn → remove Targets.0)
  for(let i=ks.length-1;i>0;i--)if(/^\d+$/.test(ks[i])){const parent=getP(o.props,ks.slice(0,i).join("."));if(Array.isArray(parent)){parent.splice(+ks[i],1);return}}
  const cur=getP(o.props,e.path);if(["Target","Role","Bucket","As"].includes(ks[0])&&ks.length===1){o.props[ks[0]]=null;return}
  if(cur!==undefined)setP(o.props,e.path,undefined)}
/* ---------------- connecting two nodes (canvas drag / "Kết nối tới…") ---------------- */
function addStmt(roleId,actions,resource,sid){const r=nodeOf(roleId);if(!r)return;r.props.Policies=r.props.Policies||[];
  let p=r.props.Policies.find(x=>x.PolicyName==="cloudlab-access");if(!p){p={PolicyName:"cloudlab-access",PolicyDocument:{Version:"2012-10-17",Statement:[]}};r.props.Policies.push(p)}
  p.PolicyDocument.Statement.push({Sid:sid||("Allow"+p.PolicyDocument.Statement.length),Effect:"Allow",Action:actions,Resource:resource})}
const roleOfFn=f=>refId((nodeOf(f)||{props:{}}).props.Role);
function connectRule(a,b){const A=nodeOf(a),B=nodeOf(b);if(!A||!B||a===b)return null;const ta=A.type,tb=B.type,Bn=physName(B);
  const say=(label,apply,grant)=>({label,apply,grant});
  if(typeof CONNECT_X==="function"){const x=CONNECT_X(a,b,A,B,say);if(x)return x}
  if(tb==="CloudLab::Monitor")return say("gửi số liệu tới monitor",()=>{B.props.Watch=arr(B.props.Watch);if(!B.props.Watch.some(x=>refId(x)===a))B.props.Watch.push(R(a))});
  switch(ta){
    case"CloudLab::Client":if(tb==="AWS::ApiGatewayV2::Api")return say("gửi request tới API",()=>{A.props.Target=R(b);delete A.props.Action;delete A.props.Key});
      if(tb==="AWS::S3::Bucket")return say("đọc object trong bucket",()=>{A.props.Target=R(b);A.props.Action=A.props.Action||"s3:GetObject";A.props.Key=A.props.Key||"report.csv"});
      if(tb==="AWS::IAM::Role")return say("assume role này (STS)",()=>{A.props.As=GA(b)});break;
    case"CloudLab::Uploader":if(tb==="AWS::S3::Bucket")return say("upload file vào bucket",()=>{A.props.Target=R(b)});break;
    case"AWS::ApiGatewayV2::Api":if(tb==="AWS::Lambda::Function")return say("integration → Lambda",()=>{A.props.Target=GA(b)});break;
    case"AWS::S3::Bucket":if(tb==="AWS::Lambda::Function")return say("ObjectCreated → gọi Lambda",()=>{setP(A.props,"NotificationConfiguration.LambdaConfigurations",arr(getP(A.props,"NotificationConfiguration.LambdaConfigurations")).concat([{Event:"s3:ObjectCreated:*",Function:GA(b)}]))});break;
    case"AWS::Lambda::Function":{const role=roleOfFn(a);
      if(tb==="AWS::IAM::Role")return say("dùng làm execution role",()=>{A.props.Role=GA(b)});
      if(tb==="AWS::Logs::LogGroup")return say("ghi log vào đây",()=>{B.props.LogGroupName={"Fn::Sub":"/aws/lambda/${"+a+"}"}});
      if(USE_ENV[tb]){const act={"AWS::S3::Bucket":["s3:PutObject"],"AWS::DynamoDB::Table":["dynamodb:PutItem"],"AWS::SNS::Topic":["sns:Publish"],"AWS::SQS::Queue":["sqs:SendMessage"]}[tb];
        const res=tb==="AWS::S3::Bucket"?{"Fn::Sub":"${"+b+".Arn}/*"}:tb==="AWS::SNS::Topic"?R(b):GA(b);
        return say(`${USE_LABEL[tb]} (biến ${USE_ENV[tb]})`,grant=>{const vars=getP(A.props,"Environment.Variables")||{};let k=USE_ENV[tb];if(vars[k]&&refId(vars[k])!==b)k=k+"_"+Object.keys(vars).length;vars[k]=R(b);setP(A.props,"Environment.Variables",vars);if(grant&&role)addStmt(role,act,res,"Use"+b)},role?{actions:act,role}:null)}
      if(tb==="CloudLab::Monitor")break;break}
    case"AWS::SNS::Topic":if(tb==="CloudLab::Inbox")return say(`subscription email → ${B.props.Address}`,()=>{A.props.Subscription=arr(A.props.Subscription).concat([{Protocol:"email",Endpoint:B.props.Address}])});
      if(tb==="AWS::Lambda::Function")return say("subscription → Lambda",()=>{A.props.Subscription=arr(A.props.Subscription).concat([{Protocol:"lambda",Endpoint:GA(b)}])});
      if(tb==="AWS::SQS::Queue")return say("subscription → SQS",()=>{A.props.Subscription=arr(A.props.Subscription).concat([{Protocol:"sqs",Endpoint:GA(b)}])});break;
    case"AWS::SQS::Queue":if(tb==="AWS::Lambda::Function")return say("Lambda đọc queue (event source mapping)",()=>{M.res[freeId(a+"To"+b)]={Type:"AWS::Lambda::EventSourceMapping",Properties:{EventSourceArn:GA(a),FunctionName:R(b),BatchSize:10}}});break;
    case"AWS::Events::Rule":if(tb==="AWS::Lambda::Function")return say("gọi Lambda theo lịch",()=>{A.props.Targets=arr(A.props.Targets).concat([{Id:b,Arn:GA(b)}])});break;
    case"AWS::CloudWatch::Alarm":if(tb==="AWS::SNS::Topic")return say("ALARM → publish tới topic",()=>{A.props.AlarmActions=arr(A.props.AlarmActions).concat([R(b)])});
      if(tb==="AWS::Lambda::Function")return say("theo dõi metric của function",()=>{A.props.Dimensions=[{Name:"FunctionName",Value:R(b)}]});break;
    case"AWS::Budgets::Budget":if(tb==="AWS::SNS::Topic")return say("vượt ngưỡng → gửi tới topic",()=>{A.props.NotificationsWithSubscribers=arr(A.props.NotificationsWithSubscribers);if(!A.props.NotificationsWithSubscribers.length)A.props.NotificationsWithSubscribers.push({Notification:{NotificationType:"ACTUAL",ComparisonOperator:"GREATER_THAN",Threshold:80},Subscribers:[]});A.props.NotificationsWithSubscribers.forEach(n=>{n.Subscribers=arr(n.Subscribers);if(!n.Subscribers.some(s=>refId(s.Address)===b))n.Subscribers.push({SubscriptionType:"SNS",Address:R(b)})})});break;
    case"AWS::S3::BucketPolicy":if(tb==="AWS::S3::Bucket")return say("áp policy cho bucket",()=>{A.props.Bucket=R(b)});break;
    case"AWS::IAM::Role":{const act={"AWS::S3::Bucket":["s3:GetObject"],"AWS::DynamoDB::Table":["dynamodb:GetItem","dynamodb:PutItem"],"AWS::SNS::Topic":["sns:Publish"],"AWS::SQS::Queue":["sqs:SendMessage"],"AWS::Logs::LogGroup":["logs:CreateLogStream","logs:PutLogEvents"]}[tb];
      if(act)return say(`cho phép ${act.join(", ")}`,()=>addStmt(a,act,tb==="AWS::S3::Bucket"?{"Fn::Sub":"${"+b+".Arn}/*"}:tb==="AWS::SNS::Topic"?R(b):GA(b),"Allow"+b));break}
  }
  return null}
function whyNot(a,b){const A=nodeOf(a),B=nodeOf(b);if(!A||!B)return"";
  const can={"CloudLab::Client":"API, bucket hoặc role","CloudLab::Uploader":"S3 bucket","AWS::ApiGatewayV2::Api":"Lambda function","AWS::S3::Bucket":"Lambda (event notification)",
    "AWS::Lambda::Function":"role, bucket, table, topic, queue, log group","AWS::SNS::Topic":"hộp thư, Lambda hoặc SQS","AWS::SQS::Queue":"Lambda","AWS::Events::Rule":"Lambda",
    "AWS::CloudWatch::Alarm":"SNS topic hoặc Lambda","AWS::Budgets::Budget":"SNS topic","AWS::S3::BucketPolicy":"S3 bucket","AWS::IAM::Role":"bucket, table, topic, queue, log group"}[A.type];
  const c2=can||(typeof WHY_X!=="undefined"&&WHY_X[A.type]);return c2?`${A.def.label} chỉ nối tới ${c2}`:`${A.def.label} không có quan hệ đi ra`}

/* ---------------- YAML (CloudFormation short-form intrinsics) ---------------- */
const CFN=(()=>{if(typeof jsyaml==="undefined")return null;
  const fn=(tag,key,kinds)=>kinds.map(kind=>new jsyaml.Type("!"+tag,{kind,construct:d=>({[key]:tag==="GetAtt"&&typeof d==="string"?d.split("."):d}),
    predicate:o=>o&&typeof o==="object"&&!Array.isArray(o)&&Object.keys(o).length===1&&key in o&&(kind==="scalar"?typeof o[key]==="string"||(tag==="GetAtt"&&Array.isArray(o[key])&&o[key].length===2):Array.isArray(o[key])&&!(tag==="GetAtt")),
    represent:o=>tag==="GetAtt"?(Array.isArray(o[key])?o[key].join("."):o[key]):o[key]}));
  return jsyaml.DEFAULT_SCHEMA.extend([...fn("Ref","Ref",["scalar"]),...fn("GetAtt","Fn::GetAtt",["scalar","sequence"]),...fn("Sub","Fn::Sub",["scalar","sequence"]),...fn("Join","Fn::Join",["sequence"]),...fn("Select","Fn::Select",["sequence"]),...fn("Split","Fn::Split",["sequence"]),...fn("ImportValue","Fn::ImportValue",["scalar"])])})();
const ORDER=["Type","DeletionPolicy","UpdateReplacePolicy","DependsOn","Metadata","Properties"];
function ordered(r){const o={};for(const k of ORDER)if(r[k]!==undefined&&!(k==="Properties"&&r[k]&&!Object.keys(r[k]).length))o[k]=r[k];for(const k of Object.keys(r))if(!(k in o)&&!ORDER.includes(k))o[k]=r[k];return o}
function clean(v){if(Array.isArray(v))return v.map(clean);if(v&&typeof v==="object"){const o={};for(const k of Object.keys(v)){if(v[k]===null||v[k]===undefined)continue;o[k]=clean(v[k])}return o}return v}
function toYaml(m){m=m||M;const doc={AWSTemplateFormatVersion:"2010-09-09",Description:m.desc||`CloudLab · ${m.name}`};
  if(Object.keys(m.ext).length)doc.Metadata={CloudLab:{External:Object.fromEntries(Object.entries(m.ext).map(([k,v])=>[k,ordered(clean(v))]))}};
  doc.Resources=Object.fromEntries(Object.entries(m.res).map(([k,v])=>[k,ordered(clean(v))]));
  if(!CFN)return JSON.stringify(doc,null,2);
  return jsyaml.dump(doc,{schema:CFN,lineWidth:110,noRefs:true,sortKeys:false})}
function fromYaml(text,keep){let doc;
  try{doc=CFN?jsyaml.load(text,{schema:CFN}):JSON.parse(text)}catch(e){const ln=e.mark?e.mark.line+1:null;return{ok:false,err:(e.reason||e.message||"YAML lỗi").split("\n")[0],line:ln}}
  if(!doc||typeof doc!=="object")return{ok:false,err:"Template phải là một mapping YAML."};
  if(!doc.Resources||typeof doc.Resources!=="object")return{ok:false,err:"Thiếu mục Resources."};
  const m=emptyModel((keep||{}).name);m.desc=doc.Description||"";m.manual=clone((keep||{}).manual||{});
  for(const[k,v]of Object.entries(doc.Resources)){if(!/^[A-Za-z][A-Za-z0-9]*$/.test(k))return{ok:false,err:`Logical ID ${k} không hợp lệ (chỉ chữ và số).`};
    if(!v||typeof v!=="object"||!v.Type)return{ok:false,err:`${k}: thiếu Type.`};m.res[k]=Object.assign({Properties:{}},v)}
  const ex=doc.Metadata&&doc.Metadata.CloudLab&&doc.Metadata.CloudLab.External||{};
  for(const[k,v]of Object.entries(ex)){if(!v||!v.Type)return{ok:false,err:`External ${k}: thiếu Type.`};if(m.res[k])return{ok:false,err:`${k} vừa là resource vừa là external.`};m.ext[k]=Object.assign({Properties:{}},v)}
  const old=(keep||{}).pos||{};const ids=[...Object.keys(m.ext),...Object.keys(m.res),...Object.keys(m.manual)];let nx=0;
  const maxX=Math.max(40,...Object.values(old).map(p=>p[0]+300));
  for(const id of ids){if(old[id])m.pos[id]=old[id];else{m.pos[id]=[maxX,60+nx*170];nx++}}
  return{ok:true,model:m}}
/* lesson templates are authored as YAML + a layout table */
function loadTemplate(yaml,layout,name,manual){const r=fromYaml(yaml,{name,pos:layout||{},manual:manual||{}});if(!r.ok)throw new Error(name+": "+r.err+(r.line?" @"+r.line:""));return r.model}
