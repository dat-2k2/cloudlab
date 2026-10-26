"use strict";
/* AWS pack · simulation: the template deployed as a CloudFormation stack (the clock, queue and counters are in
   shell/sim.js). Sources (clients, uploaders, schedules) emit events; events flow along relations; every hop checks
   configuration and IAM, updates metrics and charges cost. */
/* list prices USD, ap-southeast-2 where a source was found (API Gateway HTTP, S3, DynamoDB: third-party 2026 pages),
   us-east-1 otherwise (Lambda, SNS, SQS, CloudWatch). No free tier. Reference values for learning, not a quote. */
const PRICE={lambdaReq:0.20/1e6,lambdaGBs:0.0000166667,apiReq:1.29/1e6,s3Put:0.0055/1000,s3Get:0.00044/1000,s3GBmo:0.025,
  ddbWrite:0.7125/1e6,ddbRead:0.1425/1e6,snsPub:0.50/1e6,snsEmail:2.00/1e5,sqsReq:0.40/1e6,logsGB:0.57,alarmMo:0.10,
  ec2:{"t3.micro":0.0132,"t3.small":0.0264,"t3.medium":0.0528,"m5.large":0.12,"c5.large":0.111},albH:0.0252,albLCU:0.008,
  rds:{"db.t3.micro":0.028,"db.t3.small":0.056,"db.t3.medium":0.112,"db.m5.large":0.247},rdsGB:0.138,cache:{"cache.t3.micro":0.025,"cache.t3.small":0.05},ipv4H:0.005,
  cfReq:0.0125/1e4,cfGB:0.114,r53Zone:0.50,dtoGB:0.114,note:"Giá tham khảo ap-southeast-2 (một số theo us-east-1), không tính free tier."};
DOMAIN.runtime=()=>({obj:{},items:{},logs:{},subs:{},inbox:{},alarms:{},budgets:{},loop:{},ws:{}});
DOMAIN.onNewMonth=()=>{for(const b of Object.values(RT.budgets))b.fired=[]};
const stackUp=()=>["CREATE_COMPLETE","UPDATE_COMPLETE","DELETE_FAILED"].includes(RT.stack.status);
function exists(id){const s=scopeOf(id);if(!s)return false;if(s==="ext"||s==="manual")return true;if(RT.stack.status==="DELETE_FAILED")return!!RT.stack.left&&RT.stack.left.includes(id);return stackUp()}
const metaOf=n=>(n.raw.Metadata&&n.raw.Metadata.CloudLab)||{};
const logName=fnId=>"/aws/lambda/"+physName(nodeOf(fnId));
function logLine(fnId,lines){const g=logName(fnId),L=RT.logs[g]||(RT.logs[g]=[]);for(const m of lines)L.push({t:stamp(),m});if(L.length>300)L.splice(0,L.length-300)}
/* ---------------- deploy / delete (CloudFormation) ---------------- */
function syncRuntime(){if(!stackUp())return;
  for(const n of allNodes()){if(!exists(n.id))continue;
    if(n.type==="AWS::S3::Bucket"&&!RT.obj[n.id]){RT.obj[n.id]={};for(const o of arr(metaOf(n).Objects))RT.obj[n.id][o.Key]={kb:o.SizeKB||1,n:1}}
    if(n.type==="AWS::SNS::Topic")arr(n.props.Subscription).forEach(s=>{if(!s||s.Protocol!=="email")return;const k=n.id+"|"+s.Endpoint;if(RT.subs[k])return;
      RT.subs[k]=metaOf(n).Confirmed&&arr(metaOf(n).Confirmed).includes(s.Endpoint)?"Confirmed":"PendingConfirmation";
      if(RT.subs[k]==="PendingConfirmation"){log("Sự kiện","sns","Subscribe",`${s.Endpoint} → PendingConfirmation, đã gửi thư xác nhận`,"");mail(s.Endpoint,{kind:"confirm",subject:"AWS Notification - Subscription Confirmation",topic:n.id,body:`You have chosen to subscribe to the topic ${arnOf(n.id)}. To confirm this subscription, click the link below.`})}})}}
function deploy(){const clash=Object.values(M.res).filter(r=>r.Type==="AWS::S3::Bucket").map(r=>(r.Properties||{}).BucketName).find(nm=>Object.values(M.manual).some(m=>(m.Properties||{}).BucketName===nm));
  const cli="aws cloudformation deploy \\\n  --stack-name "+M.name+" \\\n  --template-file template.yaml \\\n  --capabilities CAPABILITY_IAM";
  if(clash){RT.stack={status:"ROLLBACK_COMPLETE"};log("CLI","cloudformation","deploy",`${M.name} · ROLLBACK_COMPLETE`,"bad",cli);log("Sự kiện","cloudformation","CREATE_FAILED",`${clash} already exists (bucket cùng tên đã có ngoài stack: xóa bucket đó hoặc đổi BucketName)`,"bad");return false}
  const was=stackUp();RT.stack={status:was?"UPDATE_COMPLETE":"CREATE_COMPLETE"};syncRuntime();
  log("CLI","cloudformation","deploy",`${M.name} · ${RT.stack.status} · ${Object.keys(M.res).length} tài nguyên`,"ok",cli);return true}
function deleteStack(){if(!stackUp()){log("CLI","cloudformation","delete-stack","Stack chưa được deploy","bad");return}
  const left=[],kept=[],cli=`aws cloudformation delete-stack --stack-name ${M.name}`;
  for(const[id,r]of Object.entries(M.res)){if(RT.stack.status==="DELETE_FAILED"&&!(RT.stack.left||[]).includes(id))continue;
    if(r.Type==="AWS::S3::Bucket"){const objs=Object.keys(RT.obj[id]||{}).length;
      if(r.DeletionPolicy==="Retain"){const nid=id+"Retained";M.manual[nid]=clone(r);delete M.manual[nid].DeletionPolicy;M.manual[nid].Metadata={CloudLab:{Retained:true}};M.pos[nid]=[(M.pos[id]||[0,0])[0]+30,(M.pos[id]||[0,0])[1]+30];RT.obj[nid]=RT.obj[id];RT.n[nid]=RT.n[id];kept.push(id);delete RT.obj[id];continue}
      if(objs){left.push(id);continue}}
    delete RT.obj[id];delete RT.n[id];delete RT.items[id];if(r.Type==="AWS::Lambda::Function")delete RT.logs[logName(id)]}
  RT.q=RT.q.filter(e=>scopeOf(e.to)!=="res"||left.includes(e.to));
  RT.stack=left.length?{status:"DELETE_FAILED",left}:{status:"DELETE_COMPLETE",kept};
  log("CLI","cloudformation","delete-stack",`${M.name} · ${RT.stack.status}`,left.length?"bad":kept.length?"warn":"ok",cli);
  kept.forEach(id=>log("Sự kiện","cloudformation","DELETE_SKIPPED",`${id} · DeletionPolicy: Retain → bucket vẫn còn, vẫn tính tiền`,"warn"));
  left.forEach(id=>log("Sự kiện","cloudformation","DELETE_FAILED",`${id} · The bucket you tried to delete is not empty (Empty bucket rồi xóa stack lại)`,"bad"))}
/* ---------------- email ---------------- */
function mail(addr,m){for(const id of Object.keys(M.ext))if(M.ext[id].Type==="CloudLab::Inbox"&&(M.ext[id].Properties||{}).Address===addr){const L=RT.inbox[id]||(RT.inbox[id]=[]);L.unshift({id:"m"+(++RT.seq),t:stamp(),read:false,...m,n:(m.n||1)});if(L.length>50)L.length=50;bump(id,"mail",1)}}
function confirmSub(topicId,addr){const k=topicId+"|"+addr;if(RT.subs[k]!=="PendingConfirmation")return false;RT.subs[k]="Confirmed";
  log("API","sns","ConfirmSubscription",`${addr} → Confirmed`,"ok",`aws sns confirm-subscription \\\n  --topic-arn ${arnOf(topicId)} \\\n  --token <token-trong-email>`);return true}
/* ---------------- handlers ---------------- */
function lambdaRun(ev,T1){const id=ev.to,n=nodeOf(id),w=ev.w,d=ev.data||{};
  if(!exists(id)){if(ev.from)flow(ev.from,id,ev.kind||"invokes",w,"ResourceNotFound: function chưa được deploy");return{ok:false,err:"ResourceNotFound"}}
  const p=n.props,mem=+p.MemorySize||128,to=(+p.Timeout||3)*1000,work=+(metaOf(n).WorkMs||300),need=Math.round(work*128/mem),timed=need>to,dur=timed?to:need,role=refId(p.Role);
  /* a self-feeding S3 loop at its fixed point: fold the hops that fit in this tick into one batch */
  let k=1,delay=dur/1000;const vars=getP(p,"Environment.Variables")||{},outBucket=Object.values(vars).map(refOrName).find(x=>x&&(nodeOf(x)||{}).type==="AWS::S3::Bucket");
  const outKey=d.key&&outBucket?(vars.OUTPUT_PREFIX||"")+d.key.split("/").pop()+".json":null;
  if(d.src==="s3"&&outBucket===d.bucket&&outKey&&depthCap(outKey)===d.key){const per=dur/1000+0.3;k=Math.max(1,Math.floor((T1-ev.at)/per)+1);delay=k*per-0.3}
  const W=w*k;if(d.src==="s3"&&outBucket===d.bucket&&/\.json$/.test(d.key||"")){bump(id,"loop",W);RT.loop[id]=(RT.loop[id]||0)+W}bump(id,"inv",W);charge(id,W*PRICE.lambdaReq,"request");charge(id,W*mem/1024*Math.ceil(dur)/1000*PRICE.lambdaGBs,"GB-giây");bump(id,"dur",W*dur);
  if(ev.from)flow(ev.from,id,ev.kind||"invokes",W);
  const rq=(Math.random().toString(16)+"00000000").slice(2,10),lines=[`START RequestId: ${rq} Version: $LATEST`];let err=null;
  if(!role){err="Function chưa có execution role (nối function tới một IAM role)"}
  else if(timed){err=`Task timed out after ${(to/1000).toFixed(2)} seconds`;lines.push(`${rq} ${err}`)}
  else{if(role)flow(id,role,"assumes",W);
    if(d.src==="s3"){const e=evalRole(role,"s3:GetObject",arnOf(d.bucket)+"/"+d.key);lines.push(`[INFO] đọc s3://${refValue(d.bucket)}/${d.key}`);if(!e.allow){err=`AccessDenied: s3:GetObject trên ${d.key} (${e.by})`;lines.push("[ERROR] "+err)}}
    if(!err)for(const[name,v]of Object.entries(vars)){const x=refOrName(v),xn=x&&nodeOf(x);if(!xn)continue;
      if(xn.type==="AWS::S3::Bucket"){const key=outKey||((vars.OUTPUT_PREFIX||"")+"result-"+(++RT.seq)+".json"),e=evalRole(role,"s3:PutObject",arnOf(x)+"/"+depthCap(key));
        if(!e.allow){err=`AccessDenied: s3:PutObject (${e.by})`;flow(id,x,"uses",W,err);lines.push("[ERROR] "+err);break}
        lines.push(`[INFO] ghi s3://${refValue(x)}/${depthCap(key)}`);push({at:ev.at+delay,to:x,from:id,kind:"uses",w,type:"s3",data:{action:"s3:PutObject",key:depthCap(key),kb:1,who:{role},by:id}})}
      else if(xn.type==="AWS::DynamoDB::Table"){const e=evalRole(role,"dynamodb:PutItem",arnOf(x));if(!e.allow){err=`AccessDenied: dynamodb:PutItem (${e.by})`;flow(id,x,"uses",W,err);break}
        push({at:ev.at+delay,to:x,from:id,kind:"uses",w,type:"ddb"})}
      else if(xn.type==="AWS::SNS::Topic"){const e=evalRole(role,"sns:Publish",arnOf(x));if(!e.allow){err=`AccessDenied: sns:Publish (${e.by})`;flow(id,x,"uses",W,err);break}
        push({at:ev.at+delay,to:x,from:id,kind:"uses",w,type:"pub",data:{subject:`Message from ${physName(n)}`,body:"Kết quả xử lý."}})}
      else if(xn.type==="AWS::SQS::Queue"){const e=evalRole(role,"sqs:SendMessage",arnOf(x));if(!e.allow){err=`AccessDenied: sqs:SendMessage (${e.by})`;flow(id,x,"uses",W,err);break}
        push({at:ev.at+delay,to:x,from:id,kind:"uses",w,type:"sqs"})}}}
  lines.push(`END RequestId: ${rq}`,`REPORT RequestId: ${rq}  Duration: ${dur.toFixed(2)} ms  Billed Duration: ${Math.ceil(dur)} ms  Memory Size: ${mem} MB  Max Memory Used: 61 MB`);
  if(err){bump(id,"err",W);if(ev.from)RT.why[ev.from+">"+id+">"+(ev.kind||"invokes")]=err;nrt(id).lastErr=err}
  /* logs need the role: CreateLogGroup (unless declared), CreateLogStream, PutLogEvents */
  const lg=logName(id),la=`arn:aws:logs:${REGION}:${ACCT}:log-group:${lg}:*`,declared=allNodes().find(x=>x.type==="AWS::Logs::LogGroup"&&resolve(x.props.LogGroupName)===lg&&exists(x.id));
  const can=role&&["logs:CreateLogStream","logs:PutLogEvents"].every(a=>evalRole(role,a,la).allow)&&(declared||RT.logs[lg]||evalRole(role,"logs:CreateLogGroup",la).allow);
  if(can){logLine(id,lines);const gid=declared?declared.id:id;charge(gid,W*0.6/1048576*PRICE.logsGB,"log");if(declared){flow(id,declared.id,"logs",W);bump(declared.id,"lines",W*lines.length)}}
  else{nrt(id).noLogs=role?"execution role thiếu quyền logs:*. Gắn managed policy AWSLambdaBasicExecutionRole vào role":"function chưa có execution role";if(declared)flow(id,declared.id,"logs",W,"Role thiếu quyền ghi log (cần logs:CreateLogStream và logs:PutLogEvents)")}
  nrt(id).last={ok:!err,err,dur,timed};return{ok:!err,err}}
const depthCap=k=>{const m=k.match(/(\.json)+$/);return m&&m[0].length>6*5?k.slice(0,k.length-m[0].length)+".json".repeat(6):k};
function s3Op(ev){const id=ev.to,b=nodeOf(id),w=ev.w,d=ev.data,who=d.who||{admin:true};
  if(!exists(id)){if(ev.from)flow(ev.from,id,ev.kind,w,"NoSuchBucket");return{ok:false,err:"NoSuchBucket"}}
  const store=RT.obj[id]||(RT.obj[id]={}),res=arnOf(id)+"/"+d.key;
  const e=who.admin?{allow:true}:evalS3(who,id,d.action,d.key);
  const op=d.action.split(":")[1];
  if(!e.allow){const msg=`403 ${op} · ${e.kind==="explicit"?"explicit deny":e.kind==="bpa"?"Block Public Access":"không có quyền"} (${e.by})`;bump(id,"denied",w);if(ev.from)flow(ev.from,id,ev.kind,w,msg);return{ok:false,err:msg,e}}
  if(d.action==="s3:GetObject"){if(!store[d.key]){const m=`404 NoSuchKey: ${d.key}`;if(ev.from)flow(ev.from,id,ev.kind,w,m);return{ok:false,err:m}}
    bump(id,"get",w);charge(id,w*PRICE.s3Get,"GET");if(e.leak){bump(id,"leak",w);RT.leak=(RT.leak||0)+w}if(ev.from)flow(ev.from,id,ev.kind,w);return{ok:true,e}}
  if(d.action==="s3:DeleteObject"){delete store[d.key];bump(id,"del",w);if(ev.from)flow(ev.from,id,ev.kind,w);return{ok:true}}
  /* PutObject */
  const o=store[d.key]||(store[d.key]={kb:d.kb||1,n:0});o.n+=w;o.kb=d.kb||o.kb;bump(id,"put",w);charge(id,w*PRICE.s3Put,"PUT");if(ev.from)flow(ev.from,id,ev.kind,w);
  const keys=Object.keys(store);if(keys.length>400){const victim=keys.find(k=>k.startsWith("incoming/photo-"));if(victim){const v=store[victim];delete store[victim];const agg=store["…/(gộp)"]||(store["…/(gộp)"]={kb:v.kb,n:0});agg.n+=v.n}}
  for(const c of arr(getP(b.props,"NotificationConfiguration.LambdaConfigurations"))){const fn=refId(c&&c.Function);if(!fn)continue;
    const rules=arr(getP(c,"Filter.S3Key.Rules")),pre=(rules.find(r=>/prefix/i.test(r.Name))||{}).Value||"",suf=(rules.find(r=>/suffix/i.test(r.Name))||{}).Value||"";
    if(!(d.key.startsWith(pre)&&d.key.endsWith(suf)))continue;const pm=canInvoke(fn,PRINCIPAL.s3,id);if(!pm.ok){flow(id,fn,"invokes",w,"S3 không gọi được Lambda: "+pm.why);continue}
    push({at:ev.at+0.3,to:fn,from:id,kind:"invokes",w,type:"inv",data:{src:"s3",bucket:id,key:d.key}})}
  return{ok:true}}
function publish(ev){const id=ev.to,t=nodeOf(id),w=ev.w,d=ev.data||{};
  if(!exists(id)){if(ev.from)flow(ev.from,id,ev.kind,w,"NotFound: topic chưa được deploy");return}
  bump(id,"pub",w);charge(id,w*PRICE.snsPub,"publish");if(ev.from)flow(ev.from,id,ev.kind,w);
  arr(t.props.Subscription).forEach(s=>{if(!s)return;
    if(s.Protocol==="email"){const st=RT.subs[id+"|"+s.Endpoint],inb=Object.keys(M.ext).find(x=>M.ext[x].Type==="CloudLab::Inbox"&&(M.ext[x].Properties||{}).Address===s.Endpoint);
      if(st!=="Confirmed"){if(inb)flow(id,inb,"delivers",w,"PendingConfirmation: email chưa xác nhận nên SNS không gửi (mở thư xác nhận trong hộp thư, bấm Confirm subscription)");return}
      charge(id,w*PRICE.snsEmail,"email");if(inb)flow(id,inb,"delivers",w);mail(s.Endpoint,{kind:d.kind||"msg",subject:d.subject||"SNS message",body:d.body||"",n:w})}
    else if(s.Protocol==="lambda"){const f=refId(s.Endpoint);if(!f)return;const pm=canInvoke(f,PRINCIPAL.sns,id);if(!pm.ok){flow(id,f,"delivers",w,"SNS không gọi được Lambda: "+pm.why);return}push({at:ev.at+0.1,to:f,from:id,kind:"delivers",w,type:"inv",data:{src:"sns"}})}
    else if(s.Protocol==="sqs"){const q=refId(s.Endpoint);if(q)push({at:ev.at+0.1,to:q,from:id,kind:"delivers",w,type:"sqs"})}})}
/* an HTTP request arriving at a node: API Gateway, Route 53 alias, CloudFront, load balancer or EC2 directly */
function request(ev,T1){const id=ev.to,n=nodeOf(id),w=ev.w,kind=ev.kind||"calls",inet=!!(ev.data&&ev.data.internet);
  const fail=msg=>{if(ev.from)flow(ev.from,id,kind,w,msg);bump(id,"err",w);nrt(id).lastErr=msg;return{ok:false,err:msg}};
  /* turned away before reaching the app (no route, no public IP, security group): the block did its job, the target
     itself did not fail. Counted as "denied", not as an error of the target. */
  const deny=msg=>{if(ev.from)flow(ev.from,id,kind,w,msg);bump(id,"denied",w);nrt(id).lastDeny=msg;return{ok:false,err:msg}};
  if(!n||!exists(id))return fail("Chưa được deploy (bấm Deploy để tạo stack)");
  switch(n.type){
    case"AWS::ApiGatewayV2::Api":{bump(id,"req",w);charge(id,w*PRICE.apiReq,"request");if(ev.from)flow(ev.from,id,kind,w);const fn=targetOf(n.props.Target),tn=nodeOf(fn);
      if(!fn||!tn)return fail("404: API chưa có integration (nối API tới một Lambda)");
      if(tn.type!=="AWS::Lambda::Function"){const r=request({...ev,to:fn,from:id,kind:"invokes",data:{internet:true}},T1);if(!r.ok){bump(id,"err",r.errW||w);return{ok:false,err:"502 · "+r.err,errW:r.errW}}return{ok:true}}
      const pm=canInvoke(fn,PRINCIPAL.api,id);if(!pm.ok){flow(id,fn,"invokes",w,"API Gateway không có quyền gọi Lambda: "+pm.why);return fail("500 Internal Server Error · "+pm.why)}
      const r=lambdaRun({...ev,to:fn,from:id,kind:"invokes",data:{src:"api"}},T1);if(!r.ok){bump(id,"err",w);return{ok:false,err:"502 · "+r.err}}return{ok:true}}
    case"AWS::Route53::RecordSet":{bump(id,"req",w);if(ev.from)flow(ev.from,id,kind,w);const t=refId(getP(n.props,"AliasTarget.DNSName"));if(!t)return fail("NXDOMAIN: record chưa trỏ tới đâu (nối record tới load balancer hoặc CloudFront)");
      return request({...ev,to:t,from:id,kind:"alias"},T1)}
    case"AWS::CloudFront::Distribution":{if(getP(n.props,"DistributionConfig.Enabled")===false)return fail("Distribution đang tắt (bật lại trong khung chi tiết của CloudFront)");bump(id,"req",w);charge(id,w*PRICE.cfReq,"request");charge(id,w*20/1048576*PRICE.cfGB,"truyền ra");if(ev.from)flow(ev.from,id,kind,w);
      const h=Math.max(0,Math.min(1,+(getP(n.raw,"Metadata.CloudLab.HitRatio")??0.9))),miss=w*(1-h);bump(id,"hit",w*h);const o=arr(getP(n.props,"DistributionConfig.Origins"))[0],oid=o&&refId(o.DomainName);
      if(!oid)return fail("CloudFront chưa có origin (nối CloudFront tới S3, load balancer hoặc API)");if(miss<=0)return{ok:true};const on=nodeOf(oid);
      if(on&&on.type==="AWS::S3::Bucket"){const cr=cfReads(id,oid,"index.html");if(!cr.ok){flow(id,oid,"origin",miss,"403 AccessDenied: "+cr.why);bump(id,"err",miss);nrt(id).lastErr=cr.why;return{ok:false,err:"CloudFront trả 403 cho request trượt cache: "+cr.why,errW:miss}}
        const r=s3Op({to:oid,from:id,kind:"origin",w:miss,at:ev.at,data:{action:"s3:GetObject",key:"index.html",who:{admin:true}}});return r.ok?{ok:true}:{ok:false,err:r.err,errW:miss}}
      return request({...ev,to:oid,from:id,kind:"origin",w:miss,data:{internet:true}},T1)}
    case"AWS::ElasticLoadBalancingV2::LoadBalancer":{if(inet){const rr=reachFromInternet(id);if(!rr.ok)return deny(rr.why);const sg=sgAllows(id,80,{internet:true});if(!sg.ok)return deny(sg.why)}
      bump(id,"req",w);if(ev.from)flow(ev.from,id,kind,w);charge(id,w*20/1048576*PRICE.dtoGB,"truyền ra");
      const ts=targetsOf(id);if(!ts.length)return fail("503: load balancer chưa có target (nối load balancer tới EC2)");
      const ok=[];for(const t of ts){let why=null;if(!exists(t.id))why="Target chưa được deploy";else{const s=sgAllows(t.id,t.port,{node:id});if(!s.ok)why="Health check fail: "+s.why}
        if(why){flow(t.tg,t.id,"forwards",0.0001,why);RT.why[t.tg+">"+t.id+">forwards"]=why}else ok.push(t)}
      nrt(id).healthy=[ok.length,ts.length];if(!ok.length)return fail("503: không target nào qua health check (security group của target phải cho load balancer vào)");
      let errs=0;const share=w/ok.length;for(const t of ok){flow(id,t.tg,"listens",share);flow(t.tg,t.id,"forwards",share);const r=appRun(t.id,share,T1);errs+=r.errW||0}
      if(errs>0){bump(id,"err",errs);return{ok:errs<w,err:"Target trả lỗi 5xx",errW:errs}}return{ok:true}}
    case"AWS::EC2::Instance":{const port=(ev.data&&ev.data.port)||appPort(n);if(inet){const rr=reachFromInternet(id);if(!rr.ok)return deny(rr.why);const s=sgAllows(id,port,{internet:true,ip:ev.data&&ev.data.ip});if(!s.ok)return deny(s.why)}if(ev.from)flow(ev.from,id,kind,w);
      if(port!==appPort(n)){bump(id,"conn",w);return{ok:true}}const r=appRun(id,w,T1);return r.ok?{ok:true}:{ok:false,err:r.err,errW:r.errW}}}
  return fail(`${n.def.label} không nhận HTTP request`)}
/* the app on an EC2 instance: capacity by instance type, then whatever it uses */
function appRun(id,w,T1){const n=nodeOf(id),cap=(EC2_TYPES[n.props.InstanceType]||{cap:40}).cap,r=nrt(id);bump(id,"req",w);
  const rate=(r.tk.req||0)/TICK_DT,over=rate>cap?(rate-cap)/rate:0;r.cpu=Math.min(100,Math.round(rate/cap*100));let errW=w*over,why=over?`Quá tải: ${num(rate)} request/giây, ${n.props.InstanceType} chỉ chịu ${cap} (thêm instance sau load balancer hoặc chọn loại lớn hơn)`:null;
  const okW=w-errW,uses=arr(getP(n.raw,"Metadata.CloudLab.Uses")).map(u=>refId(u)||u).filter(x=>nodeOf(x));
  const cache=uses.find(u=>nodeOf(u).type==="AWS::ElastiCache::CacheCluster");let hit=0;
  if(cache&&okW>0){const c=nodeOf(cache),s=exists(cache)?sgAllows(cache,6379,{node:id}):{ok:false,why:"ElastiCache chưa được deploy"};if(s.ok){hit=Math.max(0,Math.min(1,+(getP(c.raw,"Metadata.CloudLab.HitRatio")??0.8)));bump(cache,"req",okW);bump(cache,"hit",okW*hit);flow(id,cache,"uses",okW)}else flow(id,cache,"uses",okW,s.why)}
  for(const u of uses){const un=nodeOf(u);if(okW<=0)break;
    if(un.type==="AWS::RDS::DBInstance"){const q=okW*(cache?1-hit:1);if(!exists(u)){errW=w;why="Database chưa được deploy";flow(id,u,"uses",okW,why);continue}const s=sgAllows(u,dbPort(un),{node:id});
      if(!s.ok){errW=w;why="Không kết nối được database: "+s.why;flow(id,u,"uses",okW,s.why);continue}flow(id,u,"uses",q);bump(u,"q",q);const qps=(nrt(u).tk.q||0)/TICK_DT,qc=(RDS_TYPES[un.props.DBInstanceClass]||{qps:300}).qps;nrt(u).cpu=Math.min(100,Math.round(qps/qc*100));
      if(qps>qc){const e=okW*(qps-qc)/qps;errW+=e;why=`Database quá tải: ${num(qps)} truy vấn/giây, ${un.props.DBInstanceClass} chỉ chịu ${qc} (thêm ElastiCache hoặc chọn class lớn hơn)`}}
    else if(un.def.use){const r=un.def.use(id,u,okW,n);if(r&&r.err){errW+=r.errW!=null?r.errW:w;why=r.err}}
    else if(USE_ENV[un.type]){const prof=nodeOf(refId(n.props.IamInstanceProfile)),role=prof&&refId(arr(prof.props.Roles)[0]);
      const act={"AWS::S3::Bucket":"s3:PutObject","AWS::DynamoDB::Table":"dynamodb:PutItem","AWS::SNS::Topic":"sns:Publish","AWS::SQS::Queue":"sqs:SendMessage"}[un.type],res=un.type==="AWS::S3::Bucket"?arnOf(u)+"/uploads/item.json":arnOf(u);
      const e=role?evalRole(role,act,res):{allow:false,by:"instance chưa có IAM role, hãy nối EC2 tới một role"};if(!e.allow){errW=w;why=`AccessDenied: ${act} (${e.by})`;flow(id,u,"uses",okW,why);continue}
      if(role)flow(id,role,"assumes",okW);if(un.type==="AWS::S3::Bucket")push({at:RT.t,to:u,from:id,kind:"uses",w:okW,type:"s3",data:{action:"s3:PutObject",key:"uploads/item-"+(++RT.seq)+".json",kb:2,who:{role}}});
      else push({at:RT.t,to:u,from:id,kind:"uses",w:okW,type:un.type==="AWS::DynamoDB::Table"?"ddb":un.type==="AWS::SNS::Topic"?"pub":"sqs"})}}
  errW=Math.min(w,errW);if(errW>0){bump(id,"err",errW);r.lastErr=why}else bump(id,"ok",w);return{ok:errW<w,err:why,errW}}
function handle(ev,T1){RT.ops++;
  switch(ev.type){
    case"req":{const r=request({...ev,data:{...(ev.data||{}),internet:true}},T1),src=ev.from;if(src&&nodeOf(src)&&nodeOf(src).ext){const e=r.ok?(r.errW||0):ev.w;bump(src,"ok",ev.w-e);if(e>0){bump(src,"err",e);nrt(src).lastErr=r.err||"lỗi"}}return}
    case"inv":lambdaRun(ev,T1);return;
    case"s3":{const r=s3Op(ev);const src=ev.data&&ev.data.client;if(src){bump(src,r.ok?"ok":"err",ev.w);if(!r.ok)nrt(src).lastErr=r.err;if(r.ok&&r.e&&r.e.leak)bump(src,"leak",ev.w)}return}
    case"pub":publish(ev);return;
    case"ddb":if(!exists(ev.to)){flow(ev.from,ev.to,"uses",ev.w,"ResourceNotFound");return}RT.items[ev.to]=(RT.items[ev.to]||0)+ev.w;bump(ev.to,"wr",ev.w);charge(ev.to,ev.w*PRICE.ddbWrite,"ghi");flow(ev.from,ev.to,"uses",ev.w);return;
    case"ws":if(typeof wsRun==="function")wsRun(ev,TICK_DT||1);return;
    case"sqs":if(!exists(ev.to))return;bump(ev.to,"sent",ev.w);charge(ev.to,ev.w*PRICE.sqsReq,"request");if(ev.from)flow(ev.from,ev.to,ev.kind,ev.w);RT.items[ev.to]=(RT.items[ev.to]||0)+ev.w;return}}
/* ---------------- sources, schedules, alarms, budgets ---------------- */
const rateOf=s=>{const m=/rate\((\d+)\s*(minute|minutes|hour|hours|day|days)\)/.exec(s||"");if(!m)return 0;return 1/(+m[1]*({minute:60,minutes:60,hour:3600,hours:3600,day:86400,days:86400})[m[2]])};
function sources(t0,dt){RT.wsConn={};for(const n of allNodes()){let rate=0;
    if(n.type==="CloudLab::Client"&&n.props.Protocol==="websocket"){const tg=refId(n.props.Target),c=+n.props.Connections||0;if(tg&&c>0){bump(n.id,"sent",0);push({at:t0+dt/2,to:tg,from:n.id,kind:"calls",w:c,type:"ws"})}continue}
    if(n.type==="CloudLab::Client")rate=+n.props.RatePerSecond||0;else if(n.type==="CloudLab::Uploader")rate=(+n.props.PerHour||0)/3600;else if(n.type==="AWS::Events::Rule"&&exists(n.id)&&n.props.State!=="DISABLED")rate=rateOf(n.props.ScheduleExpression);
    if(!rate)continue;const a=(RT.acc[n.id]||0)+rate*dt,c=Math.floor(a);RT.acc[n.id]=a-c;if(!c)continue;fire(n,c,t0+dt/2)}
  /* queues drained by event source mappings */
  for(const[id,r]of Object.entries(M.res))if(r.Type==="AWS::Lambda::EventSourceMapping"&&exists(id)){const q=refId(r.Properties.EventSourceArn),f=refId(r.Properties.FunctionName),n=RT.items[q]||0;
    if(n>0&&exists(f)){const b=+r.Properties.BatchSize||10,inv=Math.ceil(n/b);RT.items[q]=0;charge(q,n*2*PRICE.sqsReq,"receive+delete");push({at:t0+dt/2,to:f,from:q,kind:"polls",w:inv,type:"inv",data:{src:"sqs"}})}}}
function fire(n,c,at){const p=n.props,tg=refId(p.Target);bump(n.id,"sent",c);
  if(n.type==="CloudLab::Client"){if(!tg)return;const tn=nodeOf(tg);if(!tn)return;
    if(tn.type!=="AWS::S3::Bucket")push({at,to:tg,from:n.id,kind:"calls",w:c,type:"req",data:{port:+p.Port||0,ip:p.SourceIp||null}});
    else if(tn.type==="AWS::S3::Bucket"){const role=refId(p.As),who=role?{role}:{anon:true};if(role)flow(n.id,role,"assumes",c);push({at,to:tg,from:n.id,kind:"calls",w:c,type:"s3",data:{action:p.Action||"s3:GetObject",key:p.Key||"report.csv",who,client:n.id,kb:1}})}}
  else if(n.type==="CloudLab::Uploader"){if(!tg)return;const key=(p.Prefix||"")+"photo-"+(++RT.seq)+(p.Suffix||"");push({at,to:tg,from:n.id,kind:"uploads",w:c,type:"s3",data:{action:"s3:PutObject",key,kb:+p.SizeKB||240,client:n.id}})}
  else if(n.type==="AWS::Events::Rule")for(const t of arr(p.Targets)){const f=refId(t&&t.Arn);if(!f)continue;const pm=canInvoke(f,PRINCIPAL.rule,n.id);if(!pm.ok){flow(n.id,f,"invokes",c,"EventBridge không gọi được Lambda: "+pm.why);continue}push({at,to:f,from:n.id,kind:"invokes",w:c,type:"inv",data:{src:"rule"}})}}
function periodic(t0,dt){const t1=t0+dt,h=dt/3600,zones=new Set();
  for(const n of allNodes()){if(!exists(n.id))continue;const p=n.props;if(n.def.tick)n.def.tick(n,dt);
    if(n.type==="AWS::EC2::Instance"){charge(n.id,(PRICE.ec2[p.InstanceType]||0.0132)*h,"giờ chạy");const s=subnetsOf(n)[0];if(!s||isPublicSubnet(s))charge(n.id,PRICE.ipv4H*h,"IPv4 public")}
    if(n.type==="AWS::ElasticLoadBalancingV2::LoadBalancer"){charge(n.id,PRICE.albH*h,"giờ chạy");if(p.Scheme!=="internal")charge(n.id,PRICE.ipv4H*Math.max(2,subnetsOf(n).length)*h,"IPv4 public");const rate=(nrt(n.id).tk.req||0)/dt;charge(n.id,Math.max(rate/25,0)*PRICE.albLCU*h,"LCU")}
    if(n.type==="AWS::RDS::DBInstance"){charge(n.id,(PRICE.rds[p.DBInstanceClass]||0.028)*(p.MultiAZ===true?2:1)*h,"giờ chạy");charge(n.id,(+p.AllocatedStorage||20)*PRICE.rdsGB*dt/MONTH*(p.MultiAZ===true?2:1),"lưu trữ")}
    if(n.type==="AWS::ElastiCache::CacheCluster")charge(n.id,(PRICES.aws.cacheNode[p.CacheNodeType]||PRICE.cache[p.CacheNodeType]||0.026)*(+p.NumCacheNodes||1)*h,"giờ chạy");
    if(n.type==="AWS::Route53::RecordSet"&&!zones.has(p.HostedZoneName)){zones.add(p.HostedZoneName);charge(n.id,PRICE.r53Zone*dt/MONTH,"hosted zone")}
    if(n.type==="AWS::S3::Bucket"){const gb=Object.values(RT.obj[n.id]||{}).reduce((s,o)=>s+o.kb*o.n,0)/1048576;charge(n.id,gb*PRICE.s3GBmo*dt/MONTH,"lưu trữ");nrt(n.id).gb=gb}
    if(n.type==="AWS::CloudWatch::Alarm"){charge(n.id,PRICE.alarmMo*dt/MONTH,"alarm");const a=RT.alarms[n.id]||(RT.alarms[n.id]={state:"OK",next:t0+(+n.props.Period||60),base:null});
      const fn=refId(getP(n.props,"Dimensions.0.Value")),met={Errors:"err",Invocations:"inv",Throttles:"thr",Duration:"dur"}[n.props.MetricName]||"err";
      const cur=fn?((RT.n[fn]||{m:{}}).m[met]||0):0;if(a.base===null)a.base=cur;
      while(t1>=a.next){const v=cur-a.base;a.base=cur;a.next+=+n.props.Period||60;const breach=v>(+n.props.Threshold||0);
        if(breach&&a.state!=="ALARM"){a.state="ALARM";log("Sự kiện","cloudwatch","ALARM",`${physName(n)}: ${n.props.MetricName} = ${num(v)} > ${n.props.Threshold}`,"bad");
          for(const x of arr(n.props.AlarmActions)){const tp=refId(x);if(tp)push({at:t1,to:tp,from:n.id,kind:"notifies",w:1,type:"pub",data:{kind:"alarm",subject:`ALARM: "${physName(n)}" in Asia Pacific (Sydney)`,body:`${n.props.MetricName} của ${fn?physName(nodeOf(fn)):"?"} vượt ngưỡng ${n.props.Threshold}.`}})}}
        else if(!breach&&a.state==="ALARM"){a.state="OK";log("Sự kiện","cloudwatch","OK",`${physName(n)} về OK`,"ok")}}}
    if(n.type==="AWS::Budgets::Budget"){const lim=+getP(n.props,"Budget.BudgetLimit.Amount")||0,b=RT.budgets[n.id]||(RT.budgets[n.id]={fired:[]});if(!lim)continue;
      for(const ns of arr(n.props.NotificationsWithSubscribers)){const th=+getP(ns,"Notification.Threshold")||0;if(!th||b.fired.includes(th)||RT.total<lim*th/100)continue;b.fired.push(th);
        const subj=`AWS Budgets: ${getP(n.props,"Budget.BudgetName")} has exceeded your alert threshold (${th}%)`,body=`ACTUAL cost ${money(RT.total)} > ${th}% of ${money(lim)}.`;
        const subs=arr(ns.Subscribers);if(!subs.length)log("Sự kiện","budgets","alert",`${getP(n.props,"Budget.BudgetName")} vượt ${th}% nhưng chưa có nơi nhận cảnh báo (nối budget tới một SNS topic)`,"bad");else log("Sự kiện","budgets","alert",`vượt ${th}% (${money(RT.total)} / ${money(lim)})`,"warn");
        for(const s of subs){const tp=refId(s.Address);if(tp){const ta=topicAllows(tp,"budgets.amazonaws.com");if(!ta.ok){flow(n.id,tp,"notifies",1,"AWS Budgets không publish được: "+ta.why);log("Sự kiện","budgets","alert",`vượt ${th}% nhưng không gửi được tới ${tp}: ${ta.why}`,"bad");continue}push({at:t1,to:tp,from:n.id,kind:"notifies",w:1,type:"pub",data:{kind:"alert",subject:subj,body}})}else if(s.SubscriptionType==="EMAIL")mail(s.Address,{kind:"alert",subject:subj,body})}}}}}
