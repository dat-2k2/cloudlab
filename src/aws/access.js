"use strict";
/* AWS pack · resource-based access between services, as on AWS:
   - AWS::Lambda::Permission: API Gateway, S3, SNS and EventBridge may invoke a function only if its resource policy says so.
     Without it API Gateway answers 500, S3 cannot even save the notification (CloudFormation fails the bucket), SNS and
     EventBridge drop the delivery.
   - AWS::SNS::TopicPolicy: AWS Budgets publishes to a topic only if the topic policy allows budgets.amazonaws.com.
     (CloudWatch alarms in the same account do not need it.)
   - AWS::CloudFront::OriginAccessControl: CloudFront signs its requests to a private S3 origin; the bucket policy then
     allows the service principal cloudfront.amazonaws.com, limited to that distribution by AWS:SourceArn.
   All three are template resources that the canvas does not draw as blocks; the connect rules add them. */
def("AWS::Lambda::Permission",{label:"Lambda permission",short:"PERM",cat:"sec",edge:true,
  doc:"Resource-based policy của function: cho một dịch vụ (API Gateway, S3, SNS, EventBridge) gọi function. Thiếu nó thì dịch vụ đó gọi Lambda bị từ chối, dù execution role đúng.",
  defaults:()=>({Action:"lambda:InvokeFunction",FunctionName:null,Principal:"apigateway.amazonaws.com",SourceArn:null}),
  edgeOf:p=>[{from:targetOf(p.SourceArn)||refId(p.SourceArn),to:refId(p.FunctionName),kind:"permits",label:"",hidden:true}]});
def("AWS::SNS::TopicPolicy",{label:"Topic policy",short:"TPOL",cat:"sec",edge:true,
  doc:"Resource policy của SNS topic: cho dịch vụ khác (AWS Budgets, S3, EventBridge) publish vào topic.",
  defaults:()=>({Topics:[],PolicyDocument:{Version:"2012-10-17",Statement:[]}}),edgeOf:p=>arr(p.Topics).map(t=>({from:refId(t),to:refId(t),kind:"permits",hidden:true}))});
def("AWS::CloudFront::OriginAccessControl",{label:"Origin access control",short:"OAC",cat:"sec",edge:true,
  doc:"CloudFront ký mọi request tới S3 origin (SigV4), để bucket vẫn private mà CloudFront đọc được. Bucket policy cho phép service principal cloudfront.amazonaws.com, giới hạn đúng distribution bằng điều kiện AWS:SourceArn.",
  defaults:id=>({OriginAccessControlConfig:{Name:kebab(id),OriginAccessControlOriginType:"s3",SigningBehavior:"always",SigningProtocol:"sigv4"}}),edgeOf:()=>[]});
Object.assign(BASE_ID,{"AWS::Lambda::Permission":"Permission","AWS::SNS::TopicPolicy":"TopicPolicy","AWS::CloudFront::OriginAccessControl":"Oac"});
REL.permits={style:"role"};

const PRINCIPAL={api:"apigateway.amazonaws.com",s3:"s3.amazonaws.com",sns:"sns.amazonaws.com",rule:"events.amazonaws.com"};
const permissionsOf=fn=>Object.keys(M.res).filter(k=>M.res[k].Type==="AWS::Lambda::Permission"&&refId(M.res[k].Properties.FunctionName)===fn);
/* may `principal` (calling from resource `src`) invoke function `fn`? */
function canInvoke(fn,principal,src){for(const k of permissionsOf(fn)){const p=M.res[k].Properties;
    if(p.Principal!==principal||!/^lambda:(InvokeFunction|\*)$/.test(String(p.Action||"")))continue;
    if(p.SourceArn==null)return{ok:true,by:k};const s=targetOf(p.SourceArn)||refId(p.SourceArn);if(!src||s===src)return{ok:true,by:k};
    /* SourceArn written as text (arn:aws:s3:::bucket-name), the usual way to avoid a dependency cycle */
    if(!s&&src&&srcArnText(src)&&glob(String(resolve(p.SourceArn))).test(srcArnText(src)))return{ok:true,by:k}}
  return{ok:false,why:`${fn} chưa cho ${principal} gọi: thiếu AWS::Lambda::Permission (Principal ${principal}${src?", SourceArn "+src:""})`}}
const srcArnText=src=>{const n=nodeOf(src);if(!n)return null;if(n.type==="AWS::ApiGatewayV2::Api")return`arn:aws:execute-api:${REGION}:${ACCT}:${physName(n)}/prod/POST/x`;return arnOf(src)};
/* the source ARN as CloudFormation would write it; a bucket by name, since the bucket itself depends on the permission */
function sourceArnOf(src){const n=nodeOf(src);if(!n)return null;if(n.type==="AWS::S3::Bucket")return`arn:aws:s3:::${physName(n)}`;
  if(n.type==="AWS::ApiGatewayV2::Api")return{"Fn::Sub":`arn:aws:execute-api:\${AWS::Region}:\${AWS::AccountId}:\${${src}}/*`};
  if(n.type==="AWS::S3::Bucket"||n.type==="AWS::Events::Rule")return GA(src,"Arn");if(n.type==="AWS::SNS::Topic")return R(src);return null}
/* add the permission if it is missing; returns its logical id */
function grantInvoke(fn,kind,src){const pr=PRINCIPAL[kind];if(canInvoke(fn,pr,src).ok)return permissionsOf(fn).find(k=>M.res[k].Properties.Principal===pr);
  const id=freeId(src+"Invoke"+fn);M.res[id]={Type:"AWS::Lambda::Permission",Properties:{Action:"lambda:InvokeFunction",FunctionName:GA(fn,"Arn"),Principal:pr,SourceArn:sourceArnOf(src)}};
  if(kind==="s3")M.res[id].Properties.SourceAccount={Ref:"AWS::AccountId"};return id}
/* S3 validates the notification target when the bucket is saved, so the bucket must be created after the permission */
function bucketDependsOn(bucket,perm){const r=M.res[bucket];if(!r||!perm)return;const d=arr(r.DependsOn);if(!d.includes(perm))d.push(perm);r.DependsOn=d.length===1?d[0]:d}

/* SNS topic policy: who may publish */
const topicPolicies=tp=>Object.keys(M.res).filter(k=>M.res[k].Type==="AWS::SNS::TopicPolicy"&&arr(M.res[k].Properties.Topics).some(t=>refId(t)===tp));
function topicAllows(tp,service){for(const k of topicPolicies(tp))for(const s of arr(getP(M.res[k].Properties,"PolicyDocument.Statement"))){
    if(s.Effect!=="Allow"||!arr(getP(s,"Principal.Service")).includes(service))continue;if(arr(s.Action).some(a=>/^sns:(publish|\*)$/i.test(a)))return{ok:true,by:k}}
  return{ok:false,why:`Topic policy của ${tp} chưa cho ${service} publish (thiếu AWS::SNS::TopicPolicy với Principal Service ${service}, Action SNS:Publish)`}}
function grantPublish(tp,service,sid){if(topicAllows(tp,service).ok)return;let k=topicPolicies(tp)[0];
  if(!k){k=freeId(tp+"Policy");M.res[k]={Type:"AWS::SNS::TopicPolicy",Properties:{Topics:[R(tp)],PolicyDocument:{Version:"2012-10-17",Statement:[]}}}}
  const st=M.res[k].Properties.PolicyDocument.Statement=arr(M.res[k].Properties.PolicyDocument.Statement);
  st.push({Sid:sid||"AllowPublish",Effect:"Allow",Principal:{Service:service},Action:"SNS:Publish",Resource:R(tp)})}

/* CloudFront → private S3 through OAC */
const s3Origins=cf=>arr(getP(nodeOf(cf)||{props:{}},"props.DistributionConfig.Origins")).filter(o=>(nodeOf(refId(o.DomainName))||{}).type==="AWS::S3::Bucket");
const oacOf=o=>{const id=refId(o&&o.OriginAccessControlId);return id&&M.res[id]&&M.res[id].Type==="AWS::CloudFront::OriginAccessControl"?id:null};
const cfArn=cf=>({"Fn::Sub":`arn:aws:cloudfront::\${AWS::AccountId}:distribution/\${${cf}}`});
function useOac(cf,bucket){const o=s3Origins(cf).find(x=>refId(x.DomainName)===bucket);if(!o||oacOf(o))return;
  const id=freeId(bucket+"Oac");M.res[id]={Type:"AWS::CloudFront::OriginAccessControl",Properties:{OriginAccessControlConfig:{Name:kebab(bucket)+"-oac",OriginAccessControlOriginType:"s3",SigningBehavior:"always",SigningProtocol:"sigv4"}}};
  o.OriginAccessControlId=GA(id,"Id");o.S3OriginConfig={OriginAccessIdentity:""}}
/* the bucket policy statement CloudFront needs; put into the bucket's policy (made if missing) */
const cfStatement=(cf,bucket)=>({Sid:"AllowCloudFrontRead",Effect:"Allow",Principal:{Service:"cloudfront.amazonaws.com"},Action:"s3:GetObject",Resource:{"Fn::Sub":"${"+bucket+".Arn}/*"},Condition:{StringEquals:{"AWS:SourceArn":cfArn(cf)}}});
function allowCloudFront(cf,bucket){if(cfReads(cf,bucket).ok)return;let p=bucketPolicies(bucket)[0];
  if(!p){const id=freeId(bucket+"Policy");M.res[id]={Type:"AWS::S3::BucketPolicy",Properties:{Bucket:R(bucket),PolicyDocument:{Version:"2012-10-17",Statement:[]}}};p=nodeOf(id)}
  const st=getP(M.res[p.id].Properties,"PolicyDocument.Statement");M.res[p.id].Properties.PolicyDocument.Statement=arr(st).concat([cfStatement(cf,bucket)])}
/* can the distribution read the bucket: OAC on the origin + a bucket policy statement for cloudfront.amazonaws.com
   whose AWS:SourceArn is this distribution (or a public bucket, the old way) */
function cfReads(cf,bucket,key){const o=s3Origins(cf).find(x=>refId(x.DomainName)===bucket);if(!o)return{ok:false,why:`${cf} không có origin ${bucket}`};
  if(!oacOf(o)){const e=evalS3({anon:true},bucket,"s3:GetObject",key||"index.html");return e.allow?{ok:true,public:true}:{ok:false,why:`Origin ${bucket} chưa dùng Origin Access Control, nên CloudFront gọi S3 như người lạ → 403 (bật OAC cho origin trong khung chi tiết của ${cf})`}}
  const res=arnOf(bucket)+"/"+(key||"index.html");
  for(const s of bucketPolicies(bucket).flatMap(p=>arr(getP(p.props,"PolicyDocument.Statement"))))
    if(s.Effect==="Deny"&&stmtHits(s,"s3:GetObject",res)&&(isPublicPrincipal(s.Principal)||arr(getP(s,"Principal.Service")).includes("cloudfront.amazonaws.com")))return{ok:false,why:`Bucket policy deny s3:GetObject (${s.Sid||"không Sid"})`};
  for(const s of bucketPolicies(bucket).flatMap(p=>arr(getP(p.props,"PolicyDocument.Statement")))){if(s.Effect!=="Allow"||!arr(getP(s,"Principal.Service")).includes("cloudfront.amazonaws.com")||!stmtHits(s,"s3:GetObject",res))continue;
    const src=getP(s,"Condition.StringEquals")||{},v=src["AWS:SourceArn"]||src["aws:SourceArn"];if(!v)return{ok:true,loose:true};if((targetOf(v)||refId(v))===cf||String(resolve(v)).endsWith("/"+cf))return{ok:true}}
  return{ok:false,why:`Bucket policy của ${bucket} chưa cho cloudfront.amazonaws.com s3:GetObject với AWS:SourceArn = ${cf} → 403 AccessDenied`}}

/* connect rules that now also write the resource policy */
function CONNECT_A(a,b,A,B,say){const ta=A.type,tb=B.type;
  if(ta==="AWS::CloudFront::Distribution"&&tb==="AWS::S3::Bucket")return say("origin S3 qua Origin Access Control",grant=>{const dc=A.props.DistributionConfig;dc.Origins=arr(dc.Origins);
      if(!dc.Origins.some(x=>refId(x.DomainName)===b))dc.Origins=dc.Origins.filter(x=>x.Id!==b).concat([{Id:b,DomainName:GA(b,"RegionalDomainName"),S3OriginConfig:{OriginAccessIdentity:""}}]);
      if(!dc.DefaultCacheBehavior.TargetOriginId)dc.DefaultCacheBehavior.TargetOriginId=b;useOac(a,b);if(grant)allowCloudFront(a,b)},
    {text:`Thêm vào bucket policy của ${b}: cho cloudfront.amazonaws.com s3:GetObject, chỉ khi request đến từ ${a} (AWS:SourceArn)`});
  if(ta==="AWS::ApiGatewayV2::Api"&&A.props.ProtocolType!=="WEBSOCKET"&&tb==="AWS::Lambda::Function")return say("integration → Lambda (kèm Lambda permission cho API Gateway)",()=>{A.props.Target=GA(b);grantInvoke(b,"api",a)});
  if(ta==="AWS::S3::Bucket"&&tb==="AWS::Lambda::Function")return say("ObjectCreated → gọi Lambda (kèm Lambda permission cho S3)",()=>{literalBucket(b,a);const p=grantInvoke(b,"s3",a);setP(A.props,"NotificationConfiguration.LambdaConfigurations",arr(getP(A.props,"NotificationConfiguration.LambdaConfigurations")).filter(c=>refId(c.Function)!==b).concat([{Event:"s3:ObjectCreated:*",Function:GA(b)}]));bucketDependsOn(a,p)});
  if(ta==="AWS::SNS::Topic"&&tb==="AWS::Lambda::Function")return say("subscription → Lambda (kèm Lambda permission cho SNS)",()=>{A.props.Subscription=arr(A.props.Subscription).concat([{Protocol:"lambda",Endpoint:GA(b)}]);grantInvoke(b,"sns",a)});
  if(ta==="AWS::Events::Rule"&&tb==="AWS::Lambda::Function")return say("gọi Lambda theo lịch (kèm Lambda permission cho EventBridge)",()=>{A.props.Targets=arr(A.props.Targets).concat([{Id:b,Arn:GA(b)}]);grantInvoke(b,"rule",a)});
  if(ta==="AWS::Budgets::Budget"&&tb==="AWS::SNS::Topic")return say("vượt ngưỡng → gửi tới topic (kèm topic policy cho AWS Budgets)",()=>{A.props.NotificationsWithSubscribers=arr(A.props.NotificationsWithSubscribers);if(!A.props.NotificationsWithSubscribers.length)A.props.NotificationsWithSubscribers.push({Notification:{NotificationType:"ACTUAL",ComparisonOperator:"GREATER_THAN",Threshold:80},Subscribers:[]});A.props.NotificationsWithSubscribers.forEach(n=>{n.Subscribers=arr(n.Subscribers);if(!n.Subscribers.some(s=>refId(s.Address)===b))n.Subscribers.push({SubscriptionType:"SNS",Address:R(b)})});grantPublish(b,"budgets.amazonaws.com","AllowBudgets")});
  return null}

/* S3 notification → function means the bucket depends on the function; if the function (or its role) also points at the
   bucket with !Ref / !GetAtt / ${Bucket.Arn}, CloudFormation sees a cycle. Write the bucket by name there instead. */
function literalBucket(fn,bucket){const name=physName(nodeOf(bucket)),arn=`arn:aws:s3:::${name}`,esc_=s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const lit=v=>{if(v==null||typeof v!=="object")return v;if(Array.isArray(v))return v.map(lit);if(refId(v)===bucket)return"Fn::GetAtt" in v?arn:name;
    if("Fn::Sub" in v&&typeof v["Fn::Sub"]==="string"&&v["Fn::Sub"].includes("${"+bucket)){const s=v["Fn::Sub"].split("${"+bucket+".Arn}").join(arn).split("${"+bucket+"}").join(name);return s.includes("${")?{"Fn::Sub":s}:s}
    const o={};for(const k in v)o[k]=lit(v[k]);return o};
  const f=M.res[fn];if(f&&f.Properties.Environment)f.Properties.Environment=lit(f.Properties.Environment);
  const role=roleOfFn(fn);if(role&&M.res[role])M.res[role].Properties.Policies=lit(M.res[role].Properties.Policies)}
/* CloudFormation's dependency graph: !Ref / !GetAtt / ${X} in Properties, plus DependsOn. A cycle fails the deploy. */
function depCycles(){const ids=Object.keys(M.res),dep={};for(const id of ids){const s=new Set();walkRefs(M.res[id].Properties||{},"",(p,to)=>{if(M.res[to]&&to!==id)s.add(to)});for(const d of arr(M.res[id].DependsOn))if(M.res[d])s.add(d);dep[id]=[...s]}
  let idx=0;const st=[],on=new Set(),I={},low={},out=[];
  const sc=v=>{I[v]=low[v]=idx++;st.push(v);on.add(v);for(const w of dep[v]){if(I[w]===undefined){sc(w);low[v]=Math.min(low[v],low[w])}else if(on.has(w))low[v]=Math.min(low[v],I[w])}
    if(low[v]===I[v]){const c=[];let w;do{w=st.pop();on.delete(w);c.push(w)}while(w!==v);if(c.length>1)out.push(c.reverse())}};
  for(const v of ids)if(I[v]===undefined)sc(v);return out}
/* Problems panel */
function accessProblems(P){for(const n of allNodes()){const p=n.props,id=n.id;
  if(n.type==="AWS::ApiGatewayV2::Api"&&p.ProtocolType!=="WEBSOCKET"){const fn=targetOf(p.Target);if(fn&&(nodeOf(fn)||{}).type==="AWS::Lambda::Function"&&!canInvoke(fn,PRINCIPAL.api,id).ok)P("error",id,`${id} gọi ${fn} nhưng ${fn} chưa cho API Gateway gọi (thiếu AWS::Lambda::Permission) → mọi request trả 500. Nối lại ${id} → ${fn} để CloudLab thêm`)}
  if(n.type==="AWS::ApiGatewayV2::Api"&&p.ProtocolType==="WEBSOCKET"){const fn=wsFn(id);if(fn&&!canInvoke(fn,PRINCIPAL.api,id).ok)P("error",id,`${id}: route $default gọi ${fn} nhưng thiếu AWS::Lambda::Permission cho API Gateway → message lỗi`)}
  if(n.type==="AWS::S3::Bucket")for(const c of arr(getP(p,"NotificationConfiguration.LambdaConfigurations"))){const fn=refId(c&&c.Function);if(!fn)continue;const ok=canInvoke(fn,PRINCIPAL.s3,id);
    if(!ok.ok)P("error",id,`${id}: S3 chưa được phép gọi ${fn} (thiếu AWS::Lambda::Permission) → CloudFormation lỗi “Unable to validate the following destination configurations”. Nối lại ${id} → ${fn}`);
    else if(!arr(M.res[id]&&M.res[id].DependsOn).includes(ok.by))P("warn",id,`${id}: nên có DependsOn: ${ok.by}, để CloudFormation tạo permission trước khi lưu event notification`)}
  if(n.type==="AWS::SNS::Topic")for(const s of arr(p.Subscription))if(s&&s.Protocol==="lambda"){const fn=refId(s.Endpoint);if(fn&&!canInvoke(fn,PRINCIPAL.sns,id).ok)P("error",id,`${id}: subscription tới ${fn} thiếu AWS::Lambda::Permission cho sns.amazonaws.com → SNS không gọi được`)}
  if(n.type==="AWS::Events::Rule")for(const t of arr(p.Targets)){const fn=refId(t&&t.Arn);if(fn&&(nodeOf(fn)||{}).type==="AWS::Lambda::Function"&&!canInvoke(fn,PRINCIPAL.rule,id).ok)P("error",id,`${id}: target ${fn} thiếu AWS::Lambda::Permission cho events.amazonaws.com → lịch chạy nhưng Lambda không được gọi`)}
  if(n.type==="AWS::Budgets::Budget")for(const tp of new Set(arr(p.NotificationsWithSubscribers).flatMap(x=>arr(x.Subscribers)).map(s=>refId(s.Address)).filter(Boolean)))if(!topicAllows(tp,"budgets.amazonaws.com").ok)P("error",id,`${id} gửi cảnh báo tới ${tp} nhưng topic policy chưa cho budgets.amazonaws.com SNS:Publish → không có email nào`);
  if(n.type==="AWS::CloudFront::Distribution")for(const o of s3Origins(id)){const b=refId(o.DomainName),r=cfReads(id,b);if(!r.ok)P("error",id,`${id}: ${r.why}`);else if(r.public)P("warn",id,`${id} đọc ${b} vì bucket đang public. Dùng Origin Access Control rồi khóa bucket lại`);else if(r.loose)P("warn",b,`${b}: statement cho cloudfront.amazonaws.com không có điều kiện AWS:SourceArn, nên mọi distribution (của bất kỳ ai) đều đọc được`)}}
  for(const[k,r]of Object.entries(M.res))for(const d of arr(r&&r.DependsOn))if(!M.res[d])P("error",k,`${k}: DependsOn ${d}, nhưng template không có ${d}`);
  for(const c of depCycles())P("error",c[0],`Vòng phụ thuộc: ${c.join(" → ")} → ${c[0]}. CloudFormation không biết tạo cái nào trước (Circular dependency). Ở một chỗ, viết tên hoặc ARN thay cho !Ref, ví dụ tên bucket trong biến môi trường hay ARN trong Resource của policy`)}
