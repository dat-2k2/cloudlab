"use strict";
/* ================= utilities ================= */
const ACCT="111122223333",REGION="ap-southeast-2",EMAIL="dat@example.com";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clone=o=>JSON.parse(JSON.stringify(o));
const rid=p=>p+"-"+Math.random().toString(16).slice(2,10);
let clock=11*3600+2*60;
const now=()=>{clock+=2+Math.floor(Math.random()*9);return[Math.floor(clock/3600),Math.floor(clock%3600/60),clock%60].map(n=>String(n).padStart(2,"0")).join(":")};
const store={get(k,d){try{const v=localStorage.getItem("cloudlab:"+k);return v===null?d:JSON.parse(v)}catch(_){return d}},set(k,v){try{localStorage.setItem("cloudlab:"+k,JSON.stringify(v))}catch(_){}}};
const glob=p=>new RegExp("^"+p.replace(/[.+^${}()|[\]\\]/g,"\\$&").replace(/\*/g,".*").replace(/\?/g,".")+"$","i");
const matchAny=(pats,v)=>pats.some(p=>glob(p).test(v));
const topicArn=t=>`arn:aws:sns:${REGION}:${ACCT}:${t}`;
const roleArn=r=>`arn:aws:iam::${ACCT}:role/${r}`;
const bArn=(b,k)=>k?`arn:aws:s3:::${b}/${k}`:`arn:aws:s3:::${b}`;
const money=v=>"$"+(Math.round(v*100)/100).toFixed(2);

/* ================= state ================= */
let W;               // the simulated AWS account
const LOG=[];        // event log, newest first
let UNDO=[];
const UI={page:"arch",sel:null,logSel:null,lesson:0,attempt:0,result:null,hints:0,dirty:false,flow:null,mailOpen:null,bucket:null,modal:null,trySpend:0,sim:{principal:"role:lab-readonly-s3",action:"s3:GetObject",key:"report.csv"}};
const DONE=new Set(store.get("done",[]));

function emptyWorld(){return{spend:0,budgets:[],topics:[],mail:[],roles:[],policies:{},buckets:[],links:[],fns:[],logGroups:[],stack:null,seq:0,identity:"sso",flags:{}}}
let QUIET=0; // >0 while dry-running a simulation for task checks
function log(kind,svc,op,msg,tone,cli){if(QUIET)return;LOG.unshift({id:LOG.length+1,t:now(),kind,svc,op,msg,tone:tone||"",cli:cli||""});UI.logSel=LOG[0].id}
function mutate(fn){if(QUIET){fn();return}UNDO.push(clone(W));if(UNDO.length>50)UNDO.shift();fn();UI.dirty=true}
function dry(w,f){const sw=W;W=clone(w);QUIET++;try{return f()}finally{QUIET--;W=sw}}

/* ================= SNS / Budgets / Billing ================= */
const API={
  createTopic(name){
    name=(name||"").trim();
    if(!/^[A-Za-z0-9_-]{1,256}$/.test(name))return fail("sns","CreateTopic","Tên topic chỉ gồm chữ, số, - và _.");
    if(W.topics.some(t=>t.name===name)){log("API","sns","CreateTopic",`${name} đã tồn tại, trả về topic cũ`,"",`aws sns create-topic --name ${name}`);return ok()}
    mutate(()=>W.topics.push({name,subs:[],published:0}));
    log("API","sns","CreateTopic",name,"ok",`aws sns create-topic --name ${name}`);return ok();
  },
  deleteTopic(name){mutate(()=>{W.topics=W.topics.filter(t=>t.name!==name)});log("API","sns","DeleteTopic",name,"warn",`aws sns delete-topic --topic-arn ${topicArn(name)}`);return ok()},
  subscribe(topic,endpoint){
    endpoint=(endpoint||"").trim();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(endpoint))return fail("sns","Subscribe","Endpoint phải là một địa chỉ email.");
    const t=W.topics.find(x=>x.name===topic);if(!t)return fail("sns","Subscribe","Topic không tồn tại.");
    const id=rid("sub");
    mutate(()=>{W.topics.find(x=>x.name===topic).subs.push({id,protocol:"email",endpoint,status:"PendingConfirmation"});
      W.mail.unshift({id:rid("m"),t:now(),from:"AWS Notifications <no-reply@sns.amazonaws.com>",subject:"AWS Notification - Subscription Confirmation",kind:"confirm",topic,subId:id,to:endpoint,read:false})});
    log("API","sns","Subscribe",`${endpoint} → PendingConfirmation`,"ok",`aws sns subscribe \\\n  --topic-arn ${topicArn(topic)} \\\n  --protocol email \\\n  --notification-endpoint ${endpoint}`);
    log("Sự kiện","sns","confirmation",`gửi thư xác nhận tới ${endpoint}`,"");return ok();
  },
  confirm(mailId){
    const m=W.mail.find(x=>x.id===mailId);if(!m)return;
    const t=W.topics.find(x=>x.name===m.topic),s=t&&t.subs.find(x=>x.id===m.subId);
    if(!s){log("API","sns","ConfirmSubscription","subscription không còn tồn tại","bad");return}
    if(s.status==="Confirmed"){log("API","sns","ConfirmSubscription","đã xác nhận từ trước","");return}
    mutate(()=>{const tt=W.topics.find(x=>x.name===m.topic);tt.subs.find(x=>x.id===m.subId).status="Confirmed"});
    log("API","sns","ConfirmSubscription",`${s.endpoint} → Confirmed`,"ok",`aws sns confirm-subscription \\\n  --topic-arn ${topicArn(m.topic)} \\\n  --token <token-trong-email>`);
  },
  unsubscribe(topic,id){const t=W.topics.find(x=>x.name===topic),s=t&&t.subs.find(x=>x.id===id);if(!s)return;
    mutate(()=>{const tt=W.topics.find(x=>x.name===topic);tt.subs=tt.subs.filter(x=>x.id!==id)});
    log("API","sns","Unsubscribe",s.endpoint,"warn",`aws sns unsubscribe --subscription-arn ${topicArn(topic)}:${id}`)},
  publishTest(topic){mutate(()=>deliver(topic,"Tin thử từ CloudLab","Đây là tin thử. Nếu bạn đọc được, subscription đang hoạt động.","test"));},
  saveBudget(v,isNew){
    const limit=Number(v.limit);
    if(!v.name||!/^[A-Za-z0-9_.:-]{1,100}$/.test(v.name))return fail("budgets",isNew?"CreateBudget":"UpdateBudget","Tên budget không hợp lệ.");
    if(!(limit>0))return fail("budgets",isNew?"CreateBudget":"UpdateBudget","Số tiền phải lớn hơn 0.");
    if(isNew&&W.budgets.some(b=>b.name===v.name))return fail("budgets","CreateBudget",`Budget ${v.name} đã tồn tại.`);
    const th=[50,80,100].filter(x=>v["t"+x]);
    mutate(()=>{const b={name:v.name,limit,thresholds:th,topic:v.topic||null,fired:[]};
      if(isNew)W.budgets.push(b);else W.budgets=W.budgets.map(x=>x.name===UI.editBudget?{...b,fired:x.fired}:x)});
    const notif=th.map(x=>`${x}%`).join(", ")||"không có ngưỡng";
    log("API","budgets",isNew?"CreateBudget":"UpdateBudget",`${v.name} · ${money(limit)}/tháng · ${notif}${v.topic?" → "+v.topic:" · chưa gửi đi đâu"}`,"ok",
      `aws budgets ${isNew?"create-budget":"update-budget"} \\\n  --account-id ${ACCT} \\\n  --budget '{"BudgetName":"${v.name}","BudgetLimit":{"Amount":"${limit}","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST"}'`+(isNew&&v.topic?` \\\n  --notifications-with-subscribers file://alerts-${th.join("-")||"none"}.json`:""));
    return ok();
  },
  deleteBudget(name){mutate(()=>{W.budgets=W.budgets.filter(b=>b.name!==name)});log("API","budgets","DeleteBudget",name,"warn",`aws budgets delete-budget --account-id ${ACCT} --budget-name ${name}`)},
  spendTo(pct){ // ungraded try: synthetic spend
    const lim=(W.budgets[0]&&W.budgets[0].limit)||20,amount=lim*pct/100;
    mutate(()=>{W.spend=amount;
      log("Thử","billing","spend",`chi tiêu giả lập đạt ${money(amount)} (${pct}%)`,"warn");
      for(const b of W.budgets){const crossed=b.thresholds.filter(t=>t<=amount/b.limit*100&&!b.fired.includes(t));
        for(const t of crossed){b.fired.push(t);
          if(!b.topic){log("Sự kiện","budgets","alert",`${b.name} vượt ${t}% nhưng không có nơi gửi`,"bad");continue}
          log("Sự kiện","budgets","alert",`${b.name} vượt ${t}% → publish tới ${b.topic}`,"ok");
          deliver(b.topic,`AWS Budgets: ${b.name} has exceeded your alert threshold`,`You requested that we alert you when the ACTUAL Cost associated with your ${b.name} budget is greater than ${t}.00% of ${money(b.limit)} for the current month. The ACTUAL Cost associated with this budget is ${money(amount)}.`,"alert")}}});
    UI.flow=trace0(W,pct);
  },
  newMonth(){mutate(()=>{W.spend=0;W.budgets.forEach(b=>b.fired=[])});log("Thử","billing","new-month","sang tháng mới: chi tiêu về $0, ngưỡng đặt lại","");UI.flow=null},
};
function deliver(topic,subject,body,kind){
  const t=W.topics.find(x=>x.name===topic);
  if(!t){log("Sự kiện","sns","publish",`topic ${topic} không tồn tại, cảnh báo bị mất`,"bad");return}
  t.published++;const live=t.subs.filter(s=>s.status==="Confirmed");
  for(const s of live)W.mail.unshift({id:rid("m"),t:now(),from:kind==="alert"?"AWS Budgets <budgets@costalerts.amazonaws.com>":`${topic} <no-reply@sns.amazonaws.com>`,subject,body,kind,to:s.endpoint,read:false});
  const pend=t.subs.length-live.length;
  log("Sự kiện","sns","publish",`${live.length} email gửi đi`+(pend?`, ${pend} subscription chưa xác nhận bị bỏ qua`:"")+(t.subs.length?"":" (topic chưa có subscription)"),live.length?"ok":"bad");
}
function ok(){return{ok:true}}
function fail(svc,op,msg){log("API",svc,op,"400 · "+msg,"bad");return{ok:false,err:msg}}

/* ================= IAM / STS ================= */
function evalIam(w,principal,action,resource){
  if(principal==="sso")return{allow:true,kind:"admin",by:"AccountFullAccessRole (SSO) cho phép mọi thao tác"};
  const r=w.roles.find(x=>"role:"+x.name===principal);if(!r)return{allow:false,kind:"implicit",by:"role không tồn tại"};
  let allowBy=null;
  for(const pn of r.policies){const p=w.policies[pn];if(!p)continue;
    for(const s of p.statements){if(matchAny(s.actions,action)&&matchAny(s.resources,resource)){
      if(s.effect==="Deny")return{allow:false,kind:"explicit",by:`${pn} · ${s.sid}`,stmt:s};
      allowBy=allowBy||`${pn} · ${s.sid}`}}}
  return allowBy?{allow:true,kind:"allow",by:allowBy}:{allow:false,kind:"implicit",by:"không statement nào cho phép"};
}
const who=w=>w.identity==="sso"?`arn:aws:sts::${ACCT}:assumed-role/AccountFullAccessRole/dat`:`arn:aws:sts::${ACCT}:assumed-role/${w.identity.slice(5)}/lab`;
const denyText=(w,action,res,e)=>`AccessDenied: User: ${who(w)} is not authorized to perform: ${action} on resource: ${res} `+(e.kind==="explicit"?"with an explicit deny in an identity-based policy":`because no identity-based policy allows the ${action} action`);
Object.assign(API,{
  assumeRole(name){const r=W.roles.find(x=>x.name===name);if(!r)return;
    const cli=`aws sts assume-role \\\n  --role-arn ${roleArn(name)} \\\n  --role-session-name lab`;
    if(r.trust!=="sso"){log("API","sts","AssumeRole",`AccessDenied: trust policy của ${name} không cho phép bạn`,"bad",cli);return}
    mutate(()=>{W.identity="role:"+name;W.flags.assumed=true});log("API","sts","AssumeRole",`đang dùng ${name} · credential hết hạn sau 1 giờ`,"ok",cli)},
  backToSso(){mutate(()=>{W.identity="sso"});log("API","sts","—","quay về SSO (AccountFullAccessRole)","")},
  editStatement(pn,i,v){const acts=v.actions.split(",").map(s=>s.trim()).filter(Boolean),res=v.resources.split(",").map(s=>s.trim()).filter(Boolean);
    if(!acts.length||!res.length)return fail("iam","PutRolePolicy","Action và Resource không được trống.");
    if(acts.some(a=>!/^[a-z0-9-]+:[A-Za-z*?]+$/.test(a)))return fail("iam","PutRolePolicy","Action có dạng service:Tên, ví dụ s3:GetObject.");
    mutate(()=>{const s=W.policies[pn].statements[i];s.effect=v.effect;s.actions=acts;s.resources=res;if(v.sid)s.sid=v.sid});
    const role=W.roles.find(r=>r.policies.includes(pn));
    log("API","iam","PutRolePolicy",`${pn}: ${v.effect} ${acts.join(", ")}`,"ok",`aws iam put-role-policy \\\n  --role-name ${role?role.name:"?"} \\\n  --policy-name ${pn} \\\n  --policy-document file://${pn}.json`);return ok()},
  deleteStatement(pn,i){const s=W.policies[pn].statements[i];mutate(()=>{W.policies[pn].statements.splice(i,1)});
    const role=W.roles.find(r=>r.policies.includes(pn));
    log("API","iam","PutRolePolicy",`${pn}: xóa statement ${s.sid}`,"warn",`aws iam put-role-policy \\\n  --role-name ${role?role.name:"?"} \\\n  --policy-name ${pn} \\\n  --policy-document file://${pn}.json`)},
  simulate(principal,action,key){const b=W.buckets[0];if(!action.startsWith("logs:")&&!b)return;
    const res=action.startsWith("logs:")?lgArn((W.fns[0]||{name:"extract"}).name):action==="s3:ListBucket"?bArn(b.name):bArn(b.name,key);const e=evalIam(W,principal,action,res);
    log("Thử","iam","SimulatePrincipalPolicy",`${action} → ${e.allow?"allowed":e.kind==="explicit"?"explicitDeny":"implicitDeny"} (${e.by})`,e.allow?"ok":"bad",
      principal==="sso"?"":`aws iam simulate-principal-policy \\\n  --policy-source-arn ${roleArn(principal.slice(5))} \\\n  --action-names ${action} \\\n  --resource-arns ${res}`);UI.simResult=e;},
  /* S3 data plane as the current identity */
  s3(action,bucket,key){const res=action==="s3:ListBucket"?bArn(bucket):bArn(bucket,key);const e=evalIam(W,W.identity,action,res);
    const cliMap={"s3:ListBucket":`aws s3 ls s3://${bucket}/`,"s3:GetObject":`aws s3 cp s3://${bucket}/${key} .`,"s3:PutObject":`aws s3 cp ${key} s3://${bucket}/${key}`,"s3:DeleteObject":`aws s3 rm s3://${bucket}/${key}`};
    const op={"s3:ListBucket":"ListObjectsV2","s3:GetObject":"GetObject","s3:PutObject":"PutObject","s3:DeleteObject":"DeleteObject"}[action];
    if(!e.allow){log("API","s3",op,"403 · "+denyText(W,action,res,e),"bad",cliMap[action]);return false}
    if(action==="s3:PutObject"){mutate(()=>{putObj(bucket,key,"1 KB");chain(bucket,key)})}
    if(action==="s3:DeleteObject"){mutate(()=>{const bb=W.buckets.find(x=>x.name===bucket);bb.objects=bb.objects.filter(o=>o.key!==key)})}
    if(action==="s3:GetObject"&&W.identity!=="sso")W.flags.readAsRole=true;
    log("API","s3",op,`200 · ${key||bucket}`+(W.identity==="sso"?"":` (bằng ${W.identity.slice(5)})`),"ok",cliMap[action]);return true},
});

/* ================= S3 sharing ================= */
function anonCan(w,bucket,key){const b=w.buckets.find(x=>x.name===bucket);if(!b)return{allow:false,by:"không có bucket"};
  const pub=b.policy.find(s=>s.effect==="Allow"&&s.principal==="*"&&matchAny(s.actions,"s3:GetObject")&&matchAny(s.resources,bArn(bucket,key)));
  if(pub&&b.bpa)return{allow:false,by:"Block Public Access chặn policy public",pub:true};
  if(pub)return{allow:true,by:`bucket policy · ${pub.sid} (Principal "*")`,pub:true};
  return{allow:false,by:"không có quyền công khai"}}
const linkValid=(w,key)=>w.links.find(l=>l.key===key&&l.expires<=10080&&l.expires>0);
Object.assign(API,{
  setBpa(bucket,on){mutate(()=>{W.buckets.find(x=>x.name===bucket).bpa=on});
    log("API","s3","PutPublicAccessBlock",`${bucket}: Block Public Access ${on?"bật":"tắt"}`,on?"ok":"warn",`aws s3api put-public-access-block \\\n  --bucket ${bucket} \\\n  --public-access-block-configuration \\\n  BlockPublicAcls=${on},IgnorePublicAcls=${on},BlockPublicPolicy=${on},RestrictPublicBuckets=${on}`)},
  deleteBucketStmt(bucket,sid){mutate(()=>{const b=W.buckets.find(x=>x.name===bucket);b.policy=b.policy.filter(s=>s.sid!==sid)});
    const b=W.buckets.find(x=>x.name===bucket);
    log("API","s3",b.policy.length?"PutBucketPolicy":"DeleteBucketPolicy",`${bucket}: xóa statement ${sid}`,"ok",b.policy.length?`aws s3api put-bucket-policy --bucket ${bucket} --policy file://policy.json`:`aws s3api delete-bucket-policy --bucket ${bucket}`)},
  presign(bucket,key,min){min=Number(min);
    if(!(min>0))return fail("s3","presign","Thời hạn phải lớn hơn 0 phút.");
    if(min>10080)return fail("s3","presign","Presigned URL tạo bằng IAM credential dài nhất 7 ngày (10080 phút).");
    const e=evalIam(W,W.identity,"s3:GetObject",bArn(bucket,key));
    if(!e.allow)return fail("s3","presign","Người ký không có quyền s3:GetObject nên link sẽ không mở được.");
    const id=rid("lnk");mutate(()=>W.links.push({id,bucket,key,expires:min}));
    log("CLI","s3","presign",`link cho ${key}, hết hạn sau ${min} phút`,"ok",`aws s3 presign s3://${bucket}/${key} --expires-in ${min*60}`);return ok()},
  revoke(id){mutate(()=>{W.links=W.links.filter(l=>l.id!==id)});log("Thử","s3","presign","bỏ link (thực tế link hết hiệu lực khi hết hạn hoặc khi credential ký bị thu hồi)","")},
  tryStranger(){const b=W.buckets[0];const r=anonCan(W,b.name,"invoice-0925.pdf");
    log("Thử","http","GET",`người lạ mở https://${b.name}.s3.${REGION}.amazonaws.com/invoice-0925.pdf → ${r.allow?"200 · đọc được, dữ liệu bị lộ":"403 · AccessDenied"}`,r.allow?"bad":"ok");UI.flow={stranger:r.allow}},
  tryLan(){const l=linkValid(W,"invoice-0925.pdf");log("Thử","http","GET",l?`Lan mở presigned URL → 200 · tải được invoice-0925.pdf`:"Lan chưa có link nào để mở","" +(l?"ok":"bad"))},
});

/* ================= Lambda · CloudWatch Logs · S3 events ================= */
const IMG="lab-images-"+ACCT,SCRATCH="lab-scratch-"+ACCT,CAP=20,BASE_MS=4200;
const lgName=f=>"/aws/lambda/"+f,lgArn=f=>`arn:aws:logs:${REGION}:${ACCT}:log-group:${lgName(f)}:*`,fnArn=f=>`arn:aws:lambda:${REGION}:${ACCT}:function:${f}`;
const durOf=f=>Math.round(BASE_MS*128/f.memory); // more memory = more CPU = faster
const MANAGED={
  AWSLambdaBasicExecutionRole:{arn:"arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",statements:[{sid:"Logs",effect:"Allow",actions:["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"],resources:["*"]}]},
  AmazonS3ReadOnlyAccess:{arn:"arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess",statements:[{sid:"S3Read",effect:"Allow",actions:["s3:Get*","s3:List*"],resources:["*"]}]},
  AdministratorAccess:{arn:"arn:aws:iam::aws:policy/AdministratorAccess",statements:[{sid:"All",effect:"Allow",actions:["*"],resources:["*"]}]},
};
const isManaged=pn=>!!MANAGED[pn];
function canLog(w,fname){const f=w.fns.find(x=>x.name===fname);if(!f)return{ok:false,why:"không có function"};
  const p="role:"+f.role,a=lgArn(fname),has=x=>evalIam(w,p,x,a).allow,exists=w.logGroups.some(g=>g.name===lgName(fname));
  if(!exists&&!has("logs:CreateLogGroup"))return{ok:false,why:`role ${f.role} thiếu logs:CreateLogGroup`};
  if(!has("logs:CreateLogStream")||!has("logs:PutLogEvents"))return{ok:false,why:`role ${f.role} thiếu logs:CreateLogStream / PutLogEvents`};
  return{ok:true}}
function putObj(bucket,key,size){const b=W.buckets.find(x=>x.name===bucket);if(!b)return false;if(!b.objects.some(o=>o.key===key))b.objects.push({key,size:size||"1 KB"});return true}
/* run one invocation (mutates W; caller wraps in mutate) */
function execFn(fname,ev,kind,cli){const f=W.fns.find(x=>x.name===fname);if(!f)return{ok:false,err:"ResourceNotFoundException"};
  const rq=Math.random().toString(16).slice(2,10)+"-"+Math.random().toString(16).slice(2,6);
  const need=durOf(f),timedOut=need>f.timeout*1000,dur=timedOut?f.timeout*1000:need;
  const lines=[`START RequestId: ${rq} Version: $LATEST`];let ok=!timedOut,err=null,out=null;
  if(timedOut){err=`Task timed out after ${f.timeout.toFixed(2)} seconds`;lines.push(`${rq} ${err}`)}
  else{lines.push(`[INFO] đọc s3://${ev.bucket}/${ev.key}`);
    const g=evalIam(W,"role:"+f.role,"s3:GetObject",bArn(ev.bucket,ev.key));
    if(!g.allow){ok=false;err=`AccessDenied: s3:GetObject trên ${ev.key}`;lines.push("[ERROR] "+err)}
    else if(f.env.OUTPUT_PREFIX){const k=f.env.OUTPUT_PREFIX+ev.key.split("/").pop()+".json";
      if(!evalIam(W,"role:"+f.role,"s3:PutObject",bArn(ev.bucket,k)).allow){ok=false;err=`AccessDenied: s3:PutObject trên ${k}`;lines.push("[ERROR] "+err)}
      else{out=k;lines.push(`[INFO] ghi kết quả s3://${ev.bucket}/${k}`)}}
    else lines.push(`[INFO] labels: ["cat"]`)}
  lines.push(`END RequestId: ${rq}`,`REPORT RequestId: ${rq}  Duration: ${dur.toFixed(2)} ms  Billed Duration: ${Math.ceil(dur)} ms  Memory Size: ${f.memory} MB  Max Memory Used: 61 MB`);
  f.invocations++;if(!ok)f.errors++;f.gbs+=f.memory/1024*Math.ceil(dur)/1000;f.last={ok,err,dur};
  const cl=canLog(W,fname);
  if(cl.ok){let g=W.logGroups.find(x=>x.name===lgName(fname));if(!g){g={name:lgName(fname),lines:[]};W.logGroups.push(g)}
    const t=now();lines.forEach(m=>g.lines.push({t,m}));if(g.lines.length>300)g.lines.splice(0,g.lines.length-300)}
  log(kind,"lambda","Invoke",`${fname} · ${ok?"200":err} · ${Math.ceil(dur)} ms`+(cl.ok?"":" · CloudWatch không nhận được log"),ok?"ok":"bad",cli||"");
  return{ok,err,out,dur}}
/* an object was created: fire matching notifications, follow the chain (sandbox stops at CAP) */
function chain(bucket,key){const q=[[bucket,key]],outs=[];let n=0,capped=false;
  while(q.length){const[bk,k]=q.shift(),b=W.buckets.find(x=>x.name===bk);if(!b)continue;
    for(const nt of b.notifs||[]){if(!k.startsWith(nt.prefix||"")||!k.endsWith(nt.suffix||""))continue;
      if(n>=CAP){capped=true;q.length=0;break}
      n++;const r=execFn(nt.fn,{bucket:bk,key:k},"Sự kiện");if(r.out){putObj(bk,r.out,"1 KB");outs.push(r.out);q.push([bk,r.out])}}}
  return{n,outs,capped}}
function runUpload(bucket,key){if(!putObj(bucket,key,"240 KB"))return null;return{key,...chain(bucket,key)}}
const isUp=s=>!!s&&["CREATE_COMPLETE","UPDATE_COMPLETE","DELETE_FAILED"].includes(s.status);
Object.assign(API,{
  invoke(fname){const f=W.fns.find(x=>x.name===fname);if(!f){log("API","lambda","Invoke",`ResourceNotFoundException: ${fname}`,"bad");return}
    const b=W.buckets.find(x=>x.name===IMG);
    mutate(()=>{const r=execFn(fname,{bucket:IMG,key:"incoming/sample.jpg"},"API",`aws lambda invoke \\\n  --function-name ${fname} \\\n  --cli-binary-format raw-in-base64-out \\\n  --payload file://event.json out.json`);
      if(r.out&&b){putObj(IMG,r.out);chain(IMG,r.out)}})},
  updateFn(name,v){const f=W.fns.find(x=>x.name===name);const mem=Number(v.memory),to=Number(v.timeout);
    if(!(to>=1&&to<=900&&Number.isInteger(to)))return fail("lambda","UpdateFunctionConfiguration","Timeout là số nguyên từ 1 đến 900 giây.");
    const hasEnv="OUTPUT_PREFIX" in f.env,pre=(v.prefix||"").trim();
    if(hasEnv&&pre&&!pre.endsWith("/"))return fail("lambda","UpdateFunctionConfiguration","OUTPUT_PREFIX nên kết thúc bằng /, ví dụ processed/.");
    mutate(()=>{f.memory=mem;f.timeout=to;if(hasEnv)f.env.OUTPUT_PREFIX=pre});
    log("API","lambda","UpdateFunctionConfiguration",`${name}: ${mem} MB · ${to} s`+(hasEnv?` · OUTPUT_PREFIX=${pre||"(trống)"}`:""),"ok",`aws lambda update-function-configuration \\\n  --function-name ${name} \\\n  --memory-size ${mem} --timeout ${to}`+(hasEnv?` \\\n  --environment "Variables={OUTPUT_PREFIX=${pre}}"`:""));return ok()},
  attachPolicy(role,pn){const r=W.roles.find(x=>x.name===role);if(!r||r.policies.includes(pn))return fail("iam","AttachRolePolicy",`${pn} đã gắn vào ${role}.`);
    mutate(()=>{if(!W.policies[pn])W.policies[pn]={managed:true,statements:clone(MANAGED[pn].statements)};W.roles.find(x=>x.name===role).policies.push(pn)});
    log("API","iam","AttachRolePolicy",`${role} ← ${pn}`,pn==="AdministratorAccess"?"warn":"ok",`aws iam attach-role-policy \\\n  --role-name ${role} \\\n  --policy-arn ${MANAGED[pn].arn}`);return ok()},
  detachPolicy(role,pn){mutate(()=>{const r=W.roles.find(x=>x.name===role);r.policies=r.policies.filter(x=>x!==pn)});
    log("API","iam","DetachRolePolicy",`${role} → bỏ ${pn}`,"warn",`aws iam detach-role-policy \\\n  --role-name ${role} \\\n  --policy-arn ${MANAGED[pn].arn}`)},
  setNotif(bucket,id,v){const pre=(v.prefix||"").trim(),suf=(v.suffix||"").trim();
    mutate(()=>{const n=W.buckets.find(x=>x.name===bucket).notifs.find(x=>x.id===id);n.prefix=pre;n.suffix=suf});
    log("API","s3","PutBucketNotificationConfiguration",`${id}: prefix "${pre||"*"}" · suffix "${suf||"*"}" → extract`,"ok",`aws s3api put-bucket-notification-configuration \\\n  --bucket ${bucket} \\\n  --notification-configuration file://notification.json`);return ok()},
  upload(bucket){const b=W.buckets.find(x=>x.name===bucket);if(!b){log("Thử","s3","PutObject",`bucket ${bucket} không tồn tại`,"bad");return}
    const key=`incoming/photo-${W.seq+1}.jpg`;log("Thử","s3","PutObject",`tải lên ${key}`,"",`aws s3 cp photo.jpg s3://${bucket}/${key}`);
    let st;mutate(()=>{W.seq++;st=runUpload(bucket,key)});UI.flow=st;
    log("Sự kiện","s3","ObjectCreated",`1 upload → Lambda chạy ${st.n}${st.capped?"+":""} lần`+(st.capped?` (sandbox dừng ở ${CAP}, AWS thật không dừng)`:""),st.n===1?"ok":st.n?"bad":"")},
  deleteObjects(bucket,keys){if(!keys.length)return;mutate(()=>{const b=W.buckets.find(x=>x.name===bucket);b.objects=b.objects.filter(o=>!keys.includes(o.key))});
    log("API","s3","DeleteObjects",`${bucket}: xóa ${keys.length} object`,"warn",`aws s3api delete-objects \\\n  --bucket ${bucket} \\\n  --delete file://keys.json`);UI.selKeys=[]},
  emptyBucket(name){const b=W.buckets.find(x=>x.name===name);if(!b||!b.objects.length)return;const n=b.objects.length;mutate(()=>{W.buckets.find(x=>x.name===name).objects=[]});
    log("API","s3","DeleteObjects",`${name}: làm rỗng (${n} object)`,"warn",`aws s3 rm s3://${name} --recursive`)},
  deleteBucket(name){const b=W.buckets.find(x=>x.name===name);if(!b)return;
    if(b.objects.length)return fail("s3","DeleteBucket","BucketNotEmpty: The bucket you tried to delete is not empty.");
    mutate(()=>{W.buckets=W.buckets.filter(x=>x.name!==name)});if(UI.bucket===name)UI.bucket=null;
    log("API","s3","DeleteBucket",name,"warn",`aws s3 rb s3://${name}`);return ok()},
  /* CDK */
  cdkEdit(v){const removal=v.removal,auto=!!+v.autoDelete;
    if(auto&&removal!=="DESTROY")return fail("cdk","synth","Cannot use 'autoDeleteObjects' property on a bucket without setting removal policy to 'DESTROY'.");
    mutate(()=>{W.stack.code={removal,autoDelete:auto}});log("CLI","cdk","edit",`lib/pipeline-stack.ts · removalPolicy ${removal}${auto?" · autoDeleteObjects":""}`,"");return ok()},
  cdkDeploy(){const s=W.stack,cli="cdk deploy CloudLabPipeline";
    if(isUp(s)){mutate(()=>{W.stack.deployed=clone(W.stack.code);W.stack.status="UPDATE_COMPLETE"});log("CLI","cdk","deploy","CloudLabPipeline · UPDATE_COMPLETE","ok",cli);return}
    const clash=W.buckets.find(b=>b.name===IMG);
    if(clash){mutate(()=>{W.stack.status="ROLLBACK_COMPLETE"});log("CLI","cdk","deploy","CloudLabPipeline · ROLLBACK_COMPLETE","bad",cli);
      log("Sự kiện","cloudformation","CREATE_FAILED",`Images · ${IMG} already exists`,"bad");return}
    mutate(()=>{const S=W.stack;S.deployed=clone(S.code);S.status="CREATE_COMPLETE";W.flags.deployed=true;
      W.buckets.push({name:IMG,bpa:true,policy:[],objects:[],stack:true,notifs:[{id:"ExtractOnUpload",prefix:"incoming/",suffix:".jpg",fn:"extract"}]});
      W.policies["ExtractS3"]={statements:[{sid:"ReadWriteImages",effect:"Allow",actions:["s3:GetObject","s3:PutObject"],resources:[bArn(IMG,"*")]}]};
      W.policies["AWSLambdaBasicExecutionRole"]={managed:true,statements:clone(MANAGED.AWSLambdaBasicExecutionRole.statements)};
      W.roles.push({name:"CloudLabPipeline-ExtractRole",trust:"lambda",policies:["AWSLambdaBasicExecutionRole","ExtractS3"],stack:true});
      W.fns.push({name:"extract",runtime:"python3.12",handler:"app.handler",memory:256,timeout:10,role:"CloudLabPipeline-ExtractRole",env:{OUTPUT_PREFIX:"processed/"},invocations:0,errors:0,gbs:0,last:null,stack:true})});
    log("CLI","cdk","deploy","CloudLabPipeline · CREATE_COMPLETE · 4 tài nguyên","ok",cli)},
  cdkDestroy(){const s=W.stack;if(!isUp(s)){log("CLI","cdk","destroy","Stack CloudLabPipeline chưa được deploy","bad","cdk destroy CloudLabPipeline --force");return}
    const d=s.deployed,retained=[],failed=[];
    mutate(()=>{W.buckets.forEach(b=>{if(b.stack)b.notifs=[]});
      W.fns=W.fns.filter(f=>!f.stack);W.roles=W.roles.filter(r=>!r.stack);
      const b=W.buckets.find(x=>x.name===IMG&&x.stack);
      if(b){if(d.removal!=="DESTROY"){retained.push(IMG);b.stack=false}
        else if(b.objects.length&&!d.autoDelete)failed.push(IMG);
        else W.buckets=W.buckets.filter(x=>x!==b)}
      W.stack.status=failed.length?"DELETE_FAILED":"DELETE_COMPLETE";if(!failed.length)W.stack.deployed=null;
      W.stack.lastDestroy={retained,failed};W.flags.destroyed=true});
    log("CLI","cdk","destroy",`CloudLabPipeline · ${W.stack.status}`,failed.length?"bad":retained.length?"warn":"ok","cdk destroy CloudLabPipeline --force");
    retained.forEach(n=>log("Sự kiện","cloudformation","DELETE_SKIPPED",`Images (${n}) · DeletionPolicy: Retain`,"warn"));
    failed.forEach(n=>log("Sự kiện","cloudformation","DELETE_FAILED",`Images (${n}) · The bucket you tried to delete is not empty`,"bad"))},
});
function cdkTs(c){const L=[
  ["import * as cdk from 'aws-cdk-lib';"],["import * as s3 from 'aws-cdk-lib/aws-s3';"],["import * as lambda from 'aws-cdk-lib/aws-lambda';"],["import * as s3n from 'aws-cdk-lib/aws-s3-notifications';"],[""],
  ["export class CloudLabPipelineStack extends cdk.Stack {"],["  constructor(scope: cdk.App, id: string) {"],["    super(scope, id, { env: { region: 'ap-southeast-2' } });"],[""],
  ["    const images = new s3.Bucket(this, 'Images', {"],[`      bucketName: '${IMG}',`],["      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,"],
  [c.removal==="DESTROY"?"      removalPolicy: cdk.RemovalPolicy.DESTROY,":"      // removalPolicy: không ghi → mặc định RETAIN",1]];
  if(c.autoDelete)L.push(["      autoDeleteObjects: true,",1]);
  L.push(["    });"],[""],["    const extract = new lambda.Function(this, 'Extract', {"],["      functionName: 'extract',"],["      runtime: lambda.Runtime.PYTHON_3_12,"],["      handler: 'app.handler',"],["      code: lambda.Code.fromAsset('lambda/extract'),"],
    ["      memorySize: 256,"],["      timeout: cdk.Duration.seconds(10),"],["      environment: { OUTPUT_PREFIX: 'processed/' },"],["    });"],[""],
    ["    images.grantRead(extract);"],["    images.grantPut(extract);"],["    images.addEventNotification(s3.EventType.OBJECT_CREATED,"],["      new s3n.LambdaDestination(extract), { prefix: 'incoming/', suffix: '.jpg' });"],["  }"],["}"]);return L}
function cfnYaml(c){const p=c.removal==="DESTROY"?"Delete":"Retain";const L=[["Resources:"],["  Images:"],["    Type: AWS::S3::Bucket"],["    Properties:"],[`      BucketName: ${IMG}`],[`    UpdateReplacePolicy: ${p}`,1],[`    DeletionPolicy: ${p}`,1]];
  if(c.autoDelete)L.push(["  ImagesAutoDeleteObjects:",1],["    Type: Custom::S3AutoDeleteObjects",1]);
  L.push(["  ExtractServiceRole:"],["    Type: AWS::IAM::Role"],["  Extract:"],["    Type: AWS::Lambda::Function"],["    Properties:"],["      FunctionName: extract"],["      Runtime: python3.12"],["      MemorySize: 256"],["      Timeout: 10"],["  ImagesNotifications:"],["    Type: Custom::S3BucketNotifications"]);return L}

/* ================= lessons ================= */
const SEED={
  guard(w){w.topics.push({name:"billing-alerts",subs:[{id:"sub-seed",protocol:"email",endpoint:EMAIL,status:"Confirmed"}],published:0});
    w.budgets.push({name:"monthly-20usd",limit:20,thresholds:[50,80,100],topic:"billing-alerts",fired:[]})},
  pipe(w,fixed){ // lab-images bucket + extract function + its role
    w.buckets.push({name:IMG,bpa:true,policy:[],objects:[{key:"incoming/sample.jpg",size:"240 KB"}],notifs:[]});
    w.policies["extract-s3"]={statements:[{sid:"ReadImages",effect:"Allow",actions:fixed?["s3:GetObject","s3:PutObject"]:["s3:GetObject"],resources:[bArn(IMG,"*")]}]};
    if(fixed)w.policies["AWSLambdaBasicExecutionRole"]={managed:true,statements:clone(MANAGED.AWSLambdaBasicExecutionRole.statements)};
    w.roles.push({name:"extract-role",trust:"lambda",policies:fixed?["AWSLambdaBasicExecutionRole","extract-s3"]:["extract-s3"]});
    w.fns.push({name:"extract",runtime:"python3.12",handler:"app.handler",memory:fixed?256:128,timeout:fixed?10:3,role:"extract-role",env:{},invocations:0,errors:0,gbs:0,last:null})},
};
const junkIn=w=>{const b=w.buckets.find(x=>x.name===IMG);return b?b.objects.filter(o=>o.key.startsWith("incoming/")&&o.key.endsWith(".json")):[]};
const probe=w=>dry(w,()=>runUpload(IMG,"incoming/check.jpg"))||{n:0,outs:[]};
const testInvoke=w=>dry(w,()=>execFn("extract",{bucket:IMG,key:"incoming/sample.jpg"},"API"));
const billable=w=>w.buckets.length+w.fns.length;
function trace0(w,pct){const b=w.budgets.find(x=>x.limit===20)||w.budgets[0];
  if(!b)return{stop:"spend",why:"Chưa có budget nào theo dõi chi tiêu."};
  if(!b.thresholds.some(t=>t<=pct))return{stop:"budget",why:`Budget ${b.name} không có ngưỡng nào ≤ ${pct}%.`};
  if(!b.topic)return{stop:"budget",why:`Budget ${b.name} chưa gửi cảnh báo tới SNS topic nào.`};
  const t=w.topics.find(x=>x.name===b.topic);if(!t)return{stop:"budget",why:`Topic ${b.topic} không còn tồn tại.`};
  if(!t.subs.length)return{stop:"topic",why:`Topic ${t.name} chưa có subscription nào.`};
  if(!t.subs.some(s=>s.status==="Confirmed"))return{stop:"sub",why:"Subscription email vẫn ở trạng thái PendingConfirmation."};
  return{stop:null}}
const NODE_NAME={spend:"Chi tiêu",budget:"Budget",topic:"SNS topic",sub:"Subscription",mail:"Hộp thư"};

const LESSONS=[
{ id:"guardrails",step:0,title:"Cảnh báo tiền trước khi tiêu tiền",tag:"Guardrails",
  who:["M","Minh · mentor"],
  scenario:"Trước khi dùng Bedrock, em đặt budget $20 và cho nó báo về email nhé. Lỡ quên tắt thứ gì thì ít nhất cũng có email báo.",
  goal:"Chi tiêu vượt 50 / 80 / 100% của $20 → email về hộp thư.",
  concepts:["AWS Budgets","SNS topic","subscription","xác nhận email","ngưỡng cảnh báo"],
  pages:["arch","budgets","billing","sns","mail"],
  setup(){return emptyWorld()},
  tasks:[
    {t:"Budget $20 / tháng",c:"BudgetLimit 20 USD · MONTHLY",test:w=>w.budgets.some(b=>b.limit===20)},
    {t:"Email 50% về tới hộp thư",c:"55% → budget → SNS → email đã xác nhận",test:w=>trace0(w,55).stop===null},
    {t:"Cảnh báo cả 80% và 100%",c:"ngưỡng 80 + 100%, cùng đường gửi",test:w=>{const b=w.budgets.find(x=>x.limit===20);return!!b&&b.thresholds.includes(80)&&b.thresholds.includes(100)&&trace0(w,105).stop===null}},
  ],
  diagnose(w,n){const tr=trace0(w,55);
    if(!w.budgets.some(b=>b.limit===20))return["Chưa có budget $20.","Mở Budgets.","Budgets → Tạo budget, số tiền 20."][Math.min(n,2)];
    if(tr.stop){return[ "Hộp thư vẫn trống. Bấm Thử › 55% để xem.",`Cảnh báo dừng ở ${NODE_NAME[tr.stop]} (xem sơ đồ).`,`Dừng ở ${NODE_NAME[tr.stop]}: ${tr.why}`][Math.min(n,2)]}
    return["50% chạy rồi, 80% hoặc 100% thì chưa.","Xem lại ngưỡng của budget.","Bật cả ngưỡng 80% và 100%."][Math.min(n,2)]},
  hints(w){const s=(trace0(w,55).stop)||(trace0(w,105).stop)||"budget";return({
    spend:["Chưa có budget thì không ai theo dõi chi tiêu.","Budgets → Tạo budget: $20, ngưỡng 50/80/100%, gửi tới SNS topic."],
    budget:["Budget chỉ báo khi có ngưỡng và có nơi gửi.","Sửa budget: bật 50/80/100% và chọn SNS topic."],
    topic:["Topic chỉ là trạm phát, cần subscription mới có người nhận.",`SNS → topic → Thêm subscription ${EMAIL}.`],
    sub:["SNS không gửi tới email chưa xác nhận.","Hộp thư → thư “Subscription Confirmation” → Confirm."]})[s]},
  solve(){if(!W.topics.some(t=>t.name==="billing-alerts"))API.createTopic("billing-alerts");
    const t=W.topics.find(x=>x.name==="billing-alerts");if(!t.subs.some(s=>s.endpoint===EMAIL))API.subscribe("billing-alerts",EMAIL);
    const m=W.mail.find(x=>x.kind==="confirm"&&x.topic==="billing-alerts");if(m)API.confirm(m.id);
    const b=W.budgets.find(x=>x.limit===20);UI.editBudget=b&&b.name;API.saveBudget({name:b?b.name:"monthly-20usd",limit:20,t50:1,t80:1,t100:1,topic:"billing-alerts"},!b)},
  pass:"Budget theo dõi → SNS phát → chỉ email đã xác nhận mới nhận. Xác nhận là cách AWS chống spam.",
  tries:[["55%",()=>API.spendTo(55)],["85%",()=>API.spendTo(85)],["105%",()=>API.spendTo(105)],["Tháng mới",()=>API.newMonth()]],
},
{ id:"iam",step:1,title:"AccessDenied không còn ngẫu nhiên",tag:"IAM + STS",
  who:["L","Lan · data"],
  scenario:"Anh Minh tạo sẵn role lab-readonly-s3 để mình đọc dữ liệu mà không ghi nhầm. Mình assume role rồi mà đọc report.csv vẫn báo AccessDenied. Bạn xem giúp?",
  goal:"Role đọc được dữ liệu, nhưng không ghi hay xóa được.",
  concepts:["IAM role","trust policy","STS AssumeRole","explicit deny","least privilege","policy simulator"],
  pages:["arch","budgets","billing","sns","mail","iam","sim","s3"],
  setup(){const w=emptyWorld();SEED.guard(w);const b="lab-data-"+ACCT;
    w.buckets.push({name:b,bpa:true,policy:[],objects:[{key:"report.csv",size:"18 KB"},{key:"scan-001.png",size:"240 KB"}]});
    w.policies["lab-s3-read"]={statements:[{sid:"ListLabData",effect:"Allow",actions:["s3:ListBucket"],resources:[bArn(b)]},{sid:"ReadObjects",effect:"Allow",actions:["s3:GetObject"],resources:[bArn(b,"*")]}]};
    w.policies["lab-guardrail"]={statements:[{sid:"NoObjectChanges",effect:"Deny",actions:["s3:*Object"],resources:[bArn(b,"*")]}]};
    w.roles.push({name:"lab-readonly-s3",trust:"sso",policies:["lab-s3-read","lab-guardrail"]});return w},
  tasks:[
    {t:"Assume role lab-readonly-s3",c:"sts:AssumeRole thành công",test:w=>!!w.flags.assumed},
    {t:"Role đọc được report.csv",c:"s3:GetObject → Allow",test:w=>evalIam(w,"role:lab-readonly-s3","s3:GetObject",bArn("lab-data-"+ACCT,"report.csv")).allow},
    {t:"Role không ghi, không xóa được",c:"PutObject, DeleteObject → Deny",test:w=>["s3:PutObject","s3:DeleteObject"].every(a=>!evalIam(w,"role:lab-readonly-s3",a,bArn("lab-data-"+ACCT,"x.txt")).allow)},
  ],
  diagnose(w,n){const b="lab-data-"+ACCT,g=evalIam(w,"role:lab-readonly-s3","s3:GetObject",bArn(b,"report.csv"));
    if(!w.flags.assumed)return["Bạn chưa dùng role.","IAM → Assume role.","IAM → lab-readonly-s3 → Assume role, rồi đọc file trong S3."][Math.min(n,2)];
    if(!g.allow)return["Đọc report.csv vẫn AccessDenied.","Thử Policy simulator với s3:GetObject.",`Bị chặn bởi ${g.by} (${g.kind==="explicit"?"explicit deny":"không có Allow"}).`][Math.min(n,2)];
    return["Role ghi hoặc xóa được: mở quá rộng.","Xem lại statement Deny.","Deny phải vẫn chặn PutObject và DeleteObject."][Math.min(n,2)]},
  hints(){return["Explicit Deny luôn thắng Allow. Simulator chỉ ra statement nào quyết định.","s3:*Object chặn cả GetObject. Đổi Action thành s3:PutObject, s3:DeleteObject."]},
  solve(){API.editStatement("lab-guardrail",0,{effect:"Deny",actions:"s3:PutObject, s3:DeleteObject",resources:bArn("lab-data-"+ACCT,"*")});
    if(W.identity==="sso")API.assumeRole("lab-readonly-s3");API.s3("s3:GetObject","lab-data-"+ACCT,"report.csv")},
  pass:"Deny khớp → chặn ngay. Không thì cần một Allow. Không có Allow → chặn ngầm. Wildcard như s3:*Object dễ chặn quá tay.",
  tries:[["Đọc report.csv",()=>API.s3("s3:GetObject","lab-data-"+ACCT,"report.csv")],["Ghi notes.txt",()=>API.s3("s3:PutObject","lab-data-"+ACCT,"notes.txt")]],
},
{ id:"s3",step:2,title:"Chia sẻ file mà không public bucket",tag:"S3",
  who:["L","Lan · kế toán"],
  scenario:"Mình cần file invoice-0925.pdf. Hôm trước có người mở public cả bucket lab-share để gửi nhanh. Làm sao để mình vẫn tải được mà người ngoài thì không?",
  goal:"Lan tải invoice qua link có hạn; người ngoài không đọc được gì.",
  concepts:["S3 bucket","bucket policy","Principal \"*\"","Block Public Access","presigned URL"],
  pages:["arch","budgets","billing","sns","mail","iam","sim","s3"],
  setup(){const w=emptyWorld();SEED.guard(w);const b="lab-share-"+ACCT;
    w.buckets.push({name:b,bpa:false,policy:[{sid:"PublicRead",effect:"Allow",principal:"*",actions:["s3:GetObject"],resources:[bArn(b,"*")]}],objects:[{key:"invoice-0925.pdf",size:"96 KB"},{key:"internal-notes.txt",size:"4 KB"}]});return w},
  tasks:[
    {t:"Người ngoài không đọc được gì",c:"GET ẩn danh → 403 cho mọi object",test:w=>w.buckets[0].objects.every(o=>!anonCan(w,w.buckets[0].name,o.key).allow)},
    {t:"Lan có link tải invoice",c:"presigned URL, hạn ≤ 7 ngày",test:w=>!!linkValid(w,"invoice-0925.pdf")},
    {t:"Block Public Access bật",c:"cả 4 tùy chọn = true",test:w=>w.buckets[0].bpa},
  ],
  diagnose(w,n){const b=w.buckets[0],leak=b.objects.some(o=>anonCan(w,b.name,o.key).allow);
    if(leak)return["Người lạ vẫn mở được file. Bấm Thử › Người lạ.","Quyền công khai nằm ở Permissions của bucket.","Policy PublicRead cho Principal \"*\", và BPA đang tắt."][Math.min(n,2)];
    if(!linkValid(w,"invoice-0925.pdf"))return["Đã chặn người ngoài, nhưng Lan chưa tải được.","Lan cần link có hạn cho đúng file.","S3 → invoice-0925.pdf → Presign."][Math.min(n,2)];
    return["Block Public Access vẫn tắt.","Bật để không ai lỡ tay public lại.","S3 → Permissions → Block Public Access: bật."][Math.min(n,2)]},
  hints(){return["Principal \"*\" = bất kỳ ai trên Internet. Chia sẻ có kiểm soát thì dùng presigned URL.","Bật BPA, xóa PublicRead, rồi presign invoice-0925.pdf (vd 60 phút)."]},
  solve(){const b=W.buckets[0].name;if(!W.buckets[0].bpa)API.setBpa(b,true);if(W.buckets[0].policy.some(s=>s.sid==="PublicRead"))API.deleteBucketStmt(b,"PublicRead");
    if(!linkValid(W,"invoice-0925.pdf"))API.presign(b,"invoice-0925.pdf",60)},
  pass:"Presigned URL mang quyền người ký và tự hết hạn, nên bucket vẫn private. BPA chặn việc lỡ tay public lại.",
  tries:[["Người lạ",()=>API.tryStranger()],["Lan mở link",()=>API.tryLan()]],
},
{ id:"lambda",step:3,title:"Function chạy mà không thấy log",tag:"Lambda + Logs",
  who:["M","Minh · mentor"],
  scenario:"Function extract anh viết xong rồi, em chạy thử giúp anh. Lần trước anh bấm Test thì báo lỗi, mà vào CloudWatch lại chẳng thấy dòng log nào để biết vì sao.",
  goal:"Invoke extract thành công và đọc được log của nó.",
  concepts:["Lambda function","execution role","CloudWatch Logs","timeout","memory","least privilege"],
  pages:["arch","budgets","billing","sns","mail","iam","sim","s3","lambda","logs"],
  setup(){const w=emptyWorld();SEED.guard(w);SEED.pipe(w,false);return w},
  tasks:[
    {t:"Invoke extract thành công",c:"event mẫu → 200, không timeout",test:w=>testInvoke(w).ok},
    {t:"Thấy log trong CloudWatch",c:"/aws/lambda/extract có dòng REPORT",test:w=>canLog(w,"extract").ok&&!!(w.logGroups.find(g=>g.name===lgName("extract"))||{lines:[]}).lines.some(l=>l.m.startsWith("REPORT"))},
    {t:"Role chỉ có quyền cần thiết",c:"không xóa được object, không động được IAM",test:w=>!evalIam(w,"role:extract-role","s3:DeleteObject",bArn(IMG,"x.jpg")).allow&&!evalIam(w,"role:extract-role","iam:CreateUser","*").allow},
  ],
  cause:w=>[testInvoke(w).err,canLog(w,"extract").ok].join(),
  diagnose(w,n){const r=testInvoke(w),cl=canLog(w,"extract"),f=w.fns[0];
    if(evalIam(w,"role:extract-role","iam:CreateUser","*").allow||evalIam(w,"role:extract-role","s3:DeleteObject",bArn(IMG,"x.jpg")).allow)
      return["Role mở quá rộng.","Xem các policy gắn vào extract-role.","Bỏ AdministratorAccess, chỉ giữ AWSLambdaBasicExecutionRole + extract-s3."][Math.min(n,2)];
    if(!cl.ok)return["Không thấy log nào trong CloudWatch.","Log group /aws/lambda/extract chưa tồn tại. Ai ghi nó?",`Lambda ghi log bằng execution role, mà ${cl.why}.`][Math.min(n,2)];
    if(!r.ok&&r.err.startsWith("Task"))return["Invoke lỗi: Task timed out.","So Duration trong dòng REPORT với Timeout.",`Cần khoảng ${durOf(f)} ms nhưng timeout ${f.timeout}s. Tăng timeout hoặc memory.`][Math.min(n,2)];
    if(!r.ok)return["Invoke vẫn lỗi.","Đọc dòng [ERROR] trong log.",r.err][Math.min(n,2)];
    return["Quyền đủ rồi nhưng chưa có log mới.","Invoke lại một lần.","Bấm Test ở trang Lambda."][Math.min(n,2)]},
  hints(){return["Lambda ghi log bằng chính role của nó. Thiếu quyền logs:* thì log biến mất, không báo lỗi.","Gắn AWSLambdaBasicExecutionRole cho extract-role, tăng timeout lên 10s (hoặc memory 256 MB), rồi Invoke."]},
  solve(){const r=W.roles.find(x=>x.name==="extract-role");if(r.policies.includes("AdministratorAccess"))API.detachPolicy("extract-role","AdministratorAccess");
    if(!r.policies.includes("AWSLambdaBasicExecutionRole"))API.attachPolicy("extract-role","AWSLambdaBasicExecutionRole");
    const f=W.fns[0];if(durOf(f)>f.timeout*1000)API.updateFn("extract",{memory:f.memory,timeout:10});API.invoke("extract")},
  pass:"Execution role quyết định Lambda làm được gì, kể cả ghi log. Timeout mặc định 3s; thêm memory thì thêm CPU nên chạy nhanh hơn.",
  tries:[["Invoke",()=>API.invoke("extract")]],
},
{ id:"events",step:4,title:"Upload một ảnh, gọi một lần",tag:"S3 → Lambda",
  who:["L","Lan · data"],
  scenario:"Mình upload đúng một ảnh vào incoming/ mà Lambda chạy liên tục, bucket đầy file .json lạ. Hóa đơn tháng này có sao không?",
  goal:"Mỗi ảnh vào incoming/ chạy Lambda đúng một lần, kết quả ra processed/.",
  concepts:["S3 event notification","prefix / suffix filter","vòng lặp đệ quy","biến môi trường"],
  pages:["arch","budgets","billing","sns","mail","iam","sim","s3","lambda","logs"],
  setup(){const w=emptyWorld();SEED.guard(w);SEED.pipe(w,true);const b=w.buckets[0],f=w.fns[0];
    f.env.OUTPUT_PREFIX="incoming/";f.invocations=20;b.objects=[{key:"incoming/cat.jpg",size:"240 KB"},{key:"incoming/cat.jpg.json",size:"1 KB"},{key:"incoming/cat.jpg.json.json",size:"1 KB"},{key:"incoming/cat.jpg.json.json.json",size:"1 KB"}];
    b.notifs=[{id:"extract-on-upload",prefix:"",suffix:"",fn:"extract"}];return w},
  tasks:[
    {t:"1 upload → 1 lần chạy",c:"upload incoming/x.jpg → đúng 1 invocation",test:w=>probe(w).n===1},
    {t:"Kết quả nằm ở processed/",c:"output key bắt đầu bằng processed/",test:w=>{const p=probe(w);return p.outs.length>0&&p.outs.every(k=>k.startsWith("processed/"))}},
    {t:"Dọn file rác trong incoming/",c:"incoming/ không còn file .json",test:w=>junkIn(w).length===0},
  ],
  cause:w=>{const p=probe(w);return p.n+":"+p.outs.join()},
  diagnose(w,n){const p=probe(w),f=w.fns[0];
    if(p.n>1)return[`1 upload chạy Lambda ${p.n}${p.capped?"+":""} lần. Bấm Thử › Upload.`,"Lambda ghi kết quả vào đâu, và trigger bắt những object nào?",`Lambda ghi vào ${f.env.OUTPUT_PREFIX||"(trống)"}, trigger bắt mọi object mới, nên kết quả lại kích hoạt Lambda.`][Math.min(n,2)];
    if(p.n===0)return["Upload ảnh vào incoming/ không chạy Lambda nào.","Xem filter của trigger trên bucket.","Prefix incoming/, suffix .jpg."][Math.min(n,2)];
    if(!p.outs.length||!p.outs.every(k=>k.startsWith("processed/")))return["Hết lặp, nhưng kết quả chưa ra processed/.","Xem biến môi trường của extract.","Đặt OUTPUT_PREFIX = processed/."][Math.min(n,2)];
    return[`incoming/ còn ${junkIn(w).length} file .json rác.`,"Mở bucket, chọn các file .json trong incoming/.","Tick các file .json → Xóa đã chọn."][Math.min(n,2)]},
  hints(){return["Trigger bắt mọi ObjectCreated, kể cả file Lambda vừa ghi. Ghi ra prefix khác và lọc trigger.","Trigger: prefix incoming/, suffix .jpg. Lambda: OUTPUT_PREFIX = processed/. Rồi xóa file .json rác."]},
  solve(){const b=W.buckets[0];API.setNotif(IMG,b.notifs[0].id,{prefix:"incoming/",suffix:".jpg"});
    const f=W.fns[0];API.updateFn("extract",{memory:f.memory,timeout:f.timeout,prefix:"processed/"});API.deleteObjects(IMG,junkIn(W).map(o=>o.key));API.upload(IMG)},
  pass:"Lambda ghi vào chính chỗ đang kích hoạt nó là vòng lặp tốn tiền nhất. Luôn tách prefix vào và ra, và lọc trigger.",
  tries:[["Upload ảnh",()=>API.upload(IMG)]],
},
{ id:"stack",step:5,title:"Dựng bằng code, xóa bằng một lệnh",tag:"CDK",
  who:["M","Minh · mentor"],
  scenario:"Bấm tay mãi dễ sót. Em viết pipeline thành stack CDK, deploy thử rồi destroy. Destroy xong phải không còn gì tính tiền, kể cả bucket hôm trước em tạo tay nhé.",
  goal:"cdk deploy, rồi cdk destroy sạch. Account không còn bucket hay function nào.",
  concepts:["CDK","CloudFormation stack","removalPolicy","DeletionPolicy","tài nguyên ngoài stack"],
  pages:["arch","budgets","billing","sns","mail","iam","s3","lambda","logs","stack"],
  setup(){const w=emptyWorld();SEED.guard(w);w.buckets.push({name:SCRATCH,bpa:true,policy:[],objects:[{key:"test-upload.jpg",size:"240 KB"}],notifs:[]});
    w.stack={name:"CloudLabPipeline",status:"NOT_DEPLOYED",code:{removal:"RETAIN",autoDelete:false},deployed:null,lastDestroy:null};return w},
  tasks:[
    {t:"Deploy stack thành công",c:"cdk deploy → CREATE_COMPLETE",test:w=>!!w.flags.deployed},
    {t:"Destroy xóa hết thứ stack tạo",c:"DELETE_COMPLETE, không tài nguyên nào bị giữ lại",test:w=>w.stack.status==="DELETE_COMPLETE"&&!!w.stack.lastDestroy&&!w.stack.lastDestroy.retained.length&&!w.stack.lastDestroy.failed.length},
    {t:"Không còn gì tính tiền",c:"0 bucket, 0 function",test:w=>billable(w)===0},
  ],
  cause:w=>[w.stack.status,JSON.stringify(w.stack.lastDestroy),billable(w)].join("|"),
  diagnose(w,n){const s=w.stack,ld=s.lastDestroy;
    if(!w.flags.deployed)return[s.status==="ROLLBACK_COMPLETE"?"Deploy lỗi, stack đã rollback.":"Stack chưa deploy.",s.status==="ROLLBACK_COMPLETE"?"Đọc dòng CREATE_FAILED trong Event log.":"Mở trang Stack.",s.status==="ROLLBACK_COMPLETE"?`Bucket ${IMG} đã tồn tại ngoài stack. Xóa nó rồi deploy lại.`:"Stack → cdk deploy."][Math.min(n,2)];
    if(ld&&ld.failed.length)return["Destroy lỗi ở bucket Images.","Đọc dòng DELETE_FAILED.","Bucket còn object. Thêm autoDeleteObjects: true, deploy lại rồi destroy."][Math.min(n,2)];
    if(ld&&ld.retained.length)return["Destroy xong nhưng bucket lab-images vẫn còn.","Xem DeletionPolicy ở tab CloudFormation.","Bucket mặc định RETAIN. Đặt removalPolicy DESTROY + autoDeleteObjects, deploy lại rồi destroy."][Math.min(n,2)];
    if(isUp(s)||!ld)return["Stack vẫn đang chạy.","Xóa bằng một lệnh.","Stack → cdk destroy."][Math.min(n,2)];
    return[`Còn ${w.buckets.length} bucket, ${w.fns.length} function.`,"Destroy chỉ xóa thứ stack tạo ra.",`${SCRATCH} tạo tay: S3 → Empty → Xóa bucket.`][Math.min(n,2)]},
  hints(){return["Stack chỉ xóa thứ nó tạo, và bucket S3 trong CDK mặc định được giữ lại khi destroy.","Sửa bucket: removalPolicy DESTROY + autoDeleteObjects → deploy → destroy. Rồi tự xóa lab-scratch (Empty → Xóa bucket)."]},
  solve(){const s=W.stack;if(s.code.removal!=="DESTROY"||!s.code.autoDelete)API.cdkEdit({removal:"DESTROY",autoDelete:1});
    if(W.buckets.find(b=>b.name===IMG&&!b.stack)){API.emptyBucket(IMG);API.deleteBucket(IMG)}
    if(!isUp(W.stack)||JSON.stringify(W.stack.code)!==JSON.stringify(W.stack.deployed))API.cdkDeploy();
    API.cdkDestroy();for(const b of [...W.buckets]){API.emptyBucket(b.name);API.deleteBucket(b.name)}},
  pass:"Stack giúp xóa sạch bằng một lệnh, nhưng chỉ với thứ nó tạo, và bucket mặc định RETAIN để không mất dữ liệu. Thứ tạo tay phải tự dọn.",
  tries:[["Upload ảnh",()=>API.upload(IMG)]],
},
];
const LOCKED=[["DynamoDB","dynamodb",6],["API Gateway","apigw",7],["Step Functions","sfn",8]];

/* ================= lesson engine ================= */
function startLesson(i,quiet){
  UI.lesson=i;UI.attempt=0;UI.ladder=0;UI.lastCause=null;UI.result=null;UI.hints=0;UI.dirty=false;UI.flow=null;UI.mailOpen=null;UI.page="arch";UI.simResult=null;UI.bucket=null;UI.selKeys=[];UI.s3find="";UI.lg=null;UI.stackTab="cdk";
  W=LESSONS[i].setup();UNDO=[];store.set("lesson",i);
  if(!quiet)log("Bài học","lesson","setup",`Bài ${LESSONS[i].step}: ${LESSONS[i].title}`,"");
}
function check(){const L=LESSONS[UI.lesson];UI.attempt++;UI.dirty=false;
  const res=L.tasks.map(t=>!!t.test(W));const ok=res.every(Boolean);
  if(L.id==="guardrails")UI.flow=trace0(W,55);
  // feedback ladder (symptom → where → why) restarts whenever the cause of failure changes
  const cause=res.join()+"|"+(L.id==="guardrails"?trace0(W,55).stop:L.cause?L.cause(W):"")+"|"+(W.identity||"");
  UI.ladder=cause===UI.lastCause?(UI.ladder||0)+1:0;UI.lastCause=cause;
  UI.result={ok,res,msg:ok?L.pass:L.diagnose(W,UI.ladder)};
  log("Bài học","lesson","check",ok?`Đạt ${res.length}/${res.length}`:`Chưa đạt · lần ${UI.attempt} · ${res.filter(Boolean).length}/${res.length} nhiệm vụ`,ok?"ok":"bad");
  if(ok){DONE.add(L.id);store.set("done",[...DONE])}}
function skip(){const L=LESSONS[UI.lesson];log("Bài học","lesson","skip","Skip: CloudLab làm hộ từng bước, xem các dòng API bên dưới","warn");L.solve();UI.skipped=true;check();if(UI.result.ok){DONE.delete(L.id);store.set("done",[...DONE]);UI.result.msg="Xem từng bước trong Event log. Tính là đã xem, chưa đạt.";UI.result.skipped=true}}

/* ================= architecture views ================= */
function views(){const L=LESSONS[UI.lesson];
  if(L.id==="guardrails"){const b=W.budgets.find(x=>x.limit===20)||W.budgets[0],t=b&&W.topics.find(x=>x.name===b.topic)||W.topics[0],sub=t&&t.subs[0];
    const lim=b?b.limit:20,pct=Math.round(W.spend/lim*100),fl=UI.flow,inbox=W.mail.filter(m=>m.kind==="alert").length;
    const reached=k=>fl&&(fl.stop===null||["spend","budget","topic","sub","mail"].indexOf(k)<=["spend","budget","topic","sub","mail"].indexOf(fl.stop));
    const nodes=[
      {id:"spend",x:20,y:36,w:250,title:"Chi tiêu tháng này",chip:[pct+"%",pct>=50?"warn":""],page:"billing",big:`${money(W.spend)} / ${money(lim)}`,meter:Math.min(pct,100),note:"giả lập"},
      {id:"budget",x:310,y:36,w:250,title:b?b.name:"Chưa có budget",chip:["Budget",""],page:"budgets",border:b?"":"off",rows:b?[[ "Ngưỡng 50%",b.thresholds.includes(50)?(b.fired.includes(50)?"đã vượt":"chưa tới"):"tắt",b.thresholds.includes(50)?(b.fired.includes(50)?"warn":"none"):"bad"],["Ngưỡng 80%",b.thresholds.includes(80)?(b.fired.includes(80)?"đã vượt":"chưa tới"):"tắt",b.thresholds.includes(80)?(b.fired.includes(80)?"warn":"none"):"bad"],["Ngưỡng 100%",b.thresholds.includes(100)?(b.fired.includes(100)?"đã vượt":"chưa tới"):"tắt",b.thresholds.includes(100)?(b.fired.includes(100)?"warn":"none"):"bad"],["Gửi tới",b.topic||"chưa chọn",b.topic?"ok":"bad"]]:[["Tạo ở trang","Budgets","none"]]},
      {id:"topic",x:600,y:36,w:250,title:t?t.name:"Chưa có topic",chip:["SNS topic",""],page:"sns",border:t?"":"off",rows:t?[["Message đã nhận",String(t.published),t.published?"ok":"none"],["Subscription",String(t.subs.length),t.subs.length?"ok":"bad"],["Region",REGION,"ok"]]:[["Tạo ở trang","SNS","none"]]},
      {id:"sub",x:600,y:250,w:250,title:"Subscription",chip:[sub?(sub.status==="Confirmed"?"Confirmed":"Pending"):"Chưa có",sub?(sub.status==="Confirmed"?"ok":"warn"):""],page:"sns",border:sub?(sub.status==="Confirmed"?"":"warn"):"off",rows:sub?[["Endpoint",sub.endpoint,"ok"],["Protocol","email","ok"],["Trạng thái",sub.status,sub.status==="Confirmed"?"ok":"warn"]]:[["Thêm ở trang","SNS","none"]]},
      {id:"mail",x:200,y:250,w:250,title:"Hộp thư mô phỏng",chip:[inbox+" cảnh báo",inbox?"ok":""],page:"mail",rows:[["Thư cảnh báo",String(inbox),inbox?"ok":"none"],["Thư khác",String(W.mail.length-inbox),"none"]]}];
    const st=(from,to)=>!fl?"off":(reached(to)?"ok":(fl.stop===from?"stop":"off"));
    const edges=[{a:"spend",b:"budget",as:"r",bs:"l",s:st("spend","budget")},{a:"budget",b:"topic",as:"r",bs:"l",s:st("budget","topic"),label:"vượt ngưỡng → publish"},{a:"topic",b:"sub",as:"b",bs:"t",s:st("topic","sub")},{a:"sub",b:"mail",as:"l",bs:"r",s:st("sub","mail"),stopLabel:"không gửi được"}];
    return{nodes,edges,hint:fl?(fl.stop?["bad",`Dừng ở ${NODE_NAME[fl.stop]}`]:["ok","Cảnh báo tới hộp thư"]):["","Bấm Thử để chạy cảnh báo"]}}
  if(L.id==="iam"){const bucket="lab-data-"+ACCT,role="role:lab-readonly-s3",assumed=W.identity==="role:lab-readonly-s3";
    const ev=(a,k)=>evalIam(W,role,a,a==="s3:ListBucket"?bArn(bucket):bArn(bucket,k||"report.csv"));
    const lab=e=>e.allow?"Cho phép":e.kind==="explicit"?"Chặn · explicit deny":"Chặn · không có Allow";
    const rowE=(n,a)=>{const e=ev(a);return[n,lab(e),e.allow?(a==="s3:PutObject"||a==="s3:DeleteObject"?"bad":"ok"):(a==="s3:PutObject"||a==="s3:DeleteObject"?"ok":"bad")]};
    const pol=pn=>(W.policies[pn]?W.policies[pn].statements:[]).map(s=>[s.effect+" "+s.sid,s.actions.join(", "),s.effect==="Deny"?"warn":"ok"]);
    const nodes=[
      {id:"you",x:20,y:36,w:230,title:"Bạn",chip:[assumed?"đang dùng role":"SSO",assumed?"ok":""],page:"iam",rows:[["Danh tính",assumed?"lab-readonly-s3":"AccountFullAccessRole","ok"],["Đã assume role",W.flags.assumed?"có":"chưa",W.flags.assumed?"ok":"none"]]},
      {id:"role",x:300,y:36,w:250,title:"lab-readonly-s3",chip:["IAM role",""],page:"iam",rows:[["Trust","cho phép SSO của bạn","ok"],["Policy gắn vào","2","ok"]]},
      {id:"read",x:300,y:226,w:250,title:"lab-s3-read",chip:["policy",""],page:"iam",rows:pol("lab-s3-read")},
      {id:"guard",x:600,y:226,w:250,title:"lab-guardrail",chip:["policy","warn"],page:"iam",rows:pol("lab-guardrail")},
      {id:"bucket",x:600,y:36,w:260,title:bucket.slice(0,22)+"…",chip:["S3",""],page:"s3",rows:[rowE("ListBucket","s3:ListBucket"),rowE("GetObject","s3:GetObject"),rowE("PutObject","s3:PutObject"),rowE("DeleteObject","s3:DeleteObject")]}];
    const g=ev("s3:GetObject");
    const edges=[{a:"you",b:"role",as:"r",bs:"l",s:W.flags.assumed?"ok":"off",label:"AssumeRole"},{a:"read",b:"role",as:"t",bs:"b",s:"ok",thin:1},{a:"guard",b:"role",as:"t",bs:"b",s:"warn",thin:1},{a:"role",b:"bucket",as:"r",bs:"l",s:W.flags.assumed?(g.allow?"ok":"stop"):"off",stopLabel:"GetObject bị chặn"}];
    return{nodes,edges,legend:[["ok","đúng mục tiêu"],["bad","chưa đúng"]]}}
  if(L.id==="s3"){
  const b=W.buckets[0],inv="invoice-0925.pdf",an=anonCan(W,b.name,inv),ln=linkValid(W,inv);
  const nodes=[
    {id:"stranger",x:20,y:36,w:230,title:"Người lạ",chip:["ẩn danh",""],rows:[["Mở URL thường",an.allow?"đọc được":"403",an.allow?"bad":"ok"]]},
    {id:"lan",x:20,y:236,w:230,title:"Lan",chip:["kế toán",""],rows:[["Link có hạn",ln?`${ln.expires} phút`:"chưa có",ln?"ok":"none"]]},
    {id:"bucket",x:310,y:116,w:260,title:b.name.slice(0,24)+"…",chip:[b.bpa?"private":"public",b.bpa&&!b.policy.some(s=>s.principal==="*")?"ok":"bad"],page:"s3",rows:[["Block Public Access",b.bpa?"bật":"tắt",b.bpa?"ok":"bad"],["Bucket policy",b.policy.length?b.policy.map(s=>s.sid).join(", "):"không có",b.policy.some(s=>s.principal==="*")?"bad":"ok"],["Object",String(b.objects.length),"none"]]},
    {id:"obj",x:620,y:116,w:240,title:inv,chip:["object",""],page:"s3",rows:[["Người lạ đọc được",an.allow?"có · bị lộ":"không",an.allow?"bad":"ok"],["Lan đọc được",ln?"có":"chưa",ln?"ok":"none"]]}];
  const edges=[{a:"stranger",b:"bucket",as:"r",bs:"l",s:an.allow?"leak":"blocked",stopLabel:"bị chặn"},{a:"bucket",b:"obj",as:"r",bs:"l",s:an.allow?"leak":"ok"},{a:"lan",b:"obj",as:"r",bs:"b",s:ln?"ok":"off",label:ln?"presigned URL":"chưa có link"}];
  return{nodes,edges,legend:[["bad","bị lộ"],["ok","đúng người"]]}}
  if(L.id==="lambda"){const f=W.fns[0],cl=canLog(W,"extract"),lg=W.logGroups.find(g=>g.name===lgName("extract")),last=f.last,r=W.roles.find(x=>x.name===f.role)||{policies:[]};
    const to=last&&last.err&&last.err.startsWith("Task");
    const nodes=[
      {id:"ev",x:20,y:36,w:220,title:"Event mẫu",chip:["test",""],page:"lambda",rows:[["Key","incoming/sample.jpg","none"]]},
      {id:"fn",x:300,y:36,w:270,title:"extract",chip:[last?(last.ok?"200":"lỗi"):"chưa chạy",last?(last.ok?"ok":"bad"):""],page:"lambda",rows:[["Memory",f.memory+" MB","none"],["Timeout",f.timeout+" s",to?"bad":"none"],["Lần gần nhất",last?Math.ceil(last.dur)+" ms":"—",last?(last.ok?"ok":"bad"):"none"],["Lần chạy · lỗi",`${f.invocations} · ${f.errors}`,f.errors?"warn":"none"]]},
      {id:"logs",x:620,y:36,w:240,title:"CloudWatch Logs",chip:[lg?lg.lines.length+" dòng":"trống",lg?"ok":""],page:"logs",border:lg?"":"off",rows:[["Log group",lg?"có":"không tồn tại",lg?"ok":"bad"]]},
      {id:"role",x:300,y:250,w:270,title:f.role,chip:["execution role",""],page:"iam",rows:r.policies.map(pn=>[pn,isManaged(pn)?"AWS managed":"inline",pn==="AdministratorAccess"?"bad":"none"])}];
    const edges=[{a:"ev",b:"fn",as:"r",bs:"l",s:last?(last.ok?"ok":"stop"):"off",stopLabel:to?"timeout":"lỗi"},{a:"fn",b:"logs",as:"r",bs:"l",s:f.invocations?(cl.ok?"ok":"stop"):"off",stopLabel:"không ghi được"},{a:"role",b:"fn",as:"t",bs:"b",s:"ok",thin:1}];
    return{nodes,edges,hint:last?(last.ok?["ok","Invoke 200"]:["bad",to?"Task timed out":"Invoke lỗi"]):["","Bấm Thử › Invoke"]}}
  if(L.id==="events"){const b=W.buckets.find(x=>x.name===IMG),f=W.fns[0],nt=b&&b.notifs[0],st=UI.flow&&UI.flow.n!==undefined?UI.flow:null,junk=junkIn(W).length,loop=st&&st.n>1;
    const proc=b?b.objects.filter(o=>o.key.startsWith("processed/")).length:0,outIn=st&&st.outs.some(k=>k.startsWith("incoming/"));
    const nodes=[
      {id:"up",x:20,y:36,w:220,title:"Upload ảnh",chip:["thử",""],rows:[["Key",st?st.key.replace("incoming/",""):"chưa upload","none"]]},
      {id:"bucket",x:300,y:36,w:270,title:IMG.slice(0,22)+"…",chip:["S3",""],page:"s3",rows:[["Trigger",nt?`${nt.prefix||"*"} · ${nt.suffix||"*"}`:"không có",nt&&nt.prefix?"ok":"warn"],["incoming/*.json",String(junk),junk?"bad":"ok"],["processed/",String(proc),proc?"ok":"none"]]},
      {id:"fn",x:620,y:36,w:240,title:"extract",chip:[st?`${st.n}${st.capped?"+":""} lần`:"—",st?(st.n===1?"ok":"bad"):""],page:"lambda",rows:[["OUTPUT_PREFIX",f.env.OUTPUT_PREFIX||"(trống)",f.env.OUTPUT_PREFIX==="processed/"?"ok":"warn"],["Tổng lần chạy",String(f.invocations),"none"]]},
      {id:"out",x:620,y:236,w:240,title:"Kết quả",chip:[st&&st.outs.length?(outIn?"incoming/":"processed/"):"—",st&&st.outs.length?(outIn?"bad":"ok"):""],page:"s3",rows:[["File ghi ra",st?String(st.outs.length):"—",st?(st.outs.length===1?"ok":st.outs.length?"bad":"none"):"none"]]}];
    const edges=[{a:"up",b:"bucket",as:"r",bs:"l",s:st?"ok":"off"},{a:"bucket",b:"fn",as:"r",bs:"l",s:st&&st.n?"ok":"off",label:"ObjectCreated"},{a:"fn",b:"out",as:"b",bs:"t",s:st&&st.outs.length?(outIn?"leak":"ok"):"off"},{a:"out",b:"bucket",as:"l",bs:"b",s:loop?"leak":"off",label:loop?"kích hoạt lại":"",lx:528,ly:262}];
    return{nodes,edges,hint:st?(st.n===1?["ok","1 upload → 1 lần chạy"]:["bad",`1 upload → ${st.n}${st.capped?"+":""} lần chạy`]):["","Bấm Thử › Upload ảnh"]}}
  /* stack */
  const s=W.stack,up=isUp(s),img=W.buckets.find(x=>x.name===IMG),scr=W.buckets.find(x=>x.name===SCRATCH),f=W.fns.find(x=>x.name==="extract");
  const dirty=up&&JSON.stringify(s.code)!==JSON.stringify(s.deployed);
  const nodes=[
    {id:"img",x:40,y:84,w:250,title:"Images",chip:[img?(img.stack?"trong stack":"bị bỏ lại"):"không có",img?(img.stack?"ok":"bad"):""],page:"s3",border:img?(img.stack?"":"warn"):"off",rows:[["Objects",img?String(img.objects.length):"—","none"],["removalPolicy",s.code.removal,s.code.removal==="DESTROY"?"ok":"warn"],["autoDeleteObjects",String(s.code.autoDelete),s.code.autoDelete?"ok":"warn"]]},
    {id:"fn",x:310,y:84,w:250,title:"extract",chip:[f?"đang có":"không có",f?"ok":""],page:"lambda",border:f?"":"off",rows:[["Runtime","python3.12","none"],["Ghi ra","processed/","none"]]},
    {id:"scr",x:620,y:84,w:240,title:"lab-scratch",chip:[scr?"ngoài stack":"đã xóa",scr?"bad":"ok"],page:"s3",border:scr?"warn":"off",rows:[["Tạo bằng","console (tay)","warn"],["Objects",scr?String(scr.objects.length):"—","none"]]}];
  const edges=[{a:"img",b:"fn",as:"r",bs:"l",s:up&&f?"ok":"off"}];
  const groups=[{x:20,y:36,w:560,h:200,label:"Stack · CloudLabPipeline",chip:[s.status.replace(/_/g," ").toLowerCase()+(dirty?" · code đã sửa":""),up?(dirty?"warn":"ok"):s.status==="DELETE_COMPLETE"?"":s.status.includes("FAIL")||s.status.includes("ROLLBACK")?"bad":""],page:"stack"}];
  const left=billable(W);
  return{nodes,edges,groups,hint:[left?"bad":"ok",left?`Còn ${W.buckets.length} bucket · ${W.fns.length} function`:"Không còn gì tính tiền"]}
}
function nodeH(n){return n.big?118:44+(n.rows?n.rows.length*20+10:0)}
function anchor(n,side){const h=nodeH(n);return side==="r"?[n.x+n.w,n.y+Math.min(40,h/2)]:side==="l"?[n.x,n.y+Math.min(40,h/2)]:side==="b"?[n.x+n.w/2,n.y+h]:[n.x+n.w/2,n.y]}
const COL={ok:"var(--ok)",stop:"var(--bad)",off:"var(--line-strong)",warn:"var(--warn)",leak:"var(--bad)",blocked:"var(--ok)"};
function svgView(){const v=views(),byId={};v.nodes.forEach(n=>byId[n.id]=n);
  const H=Math.max(...v.nodes.map(n=>n.y+nodeH(n)),...(v.groups||[]).map(g=>g.y+g.h))+40,Wd=880;
  let s=`<svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="Sơ đồ kiến trúc của bài học"><title>Sơ đồ kiến trúc</title>`;
  const chip=(x,y,t,cls,right)=>{const cw=t.length*6.4+16,cx=right?x-cw:x;return`<rect x="${cx}" y="${y}" width="${cw}" height="18" rx="9" class="cb ${cls||""}"/><text x="${cx+cw/2}" y="${y+12.5}" text-anchor="middle" class="ct ${cls||""}">${esc(t)}</text>`};
  for(const g of v.groups||[]){s+=`<g class="grp${g.page?" click":""}"${g.page?` data-go="${g.page}" tabindex="0" role="button" aria-label="Mở ${esc(g.label)}"`:""}><rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="14" class="grpbox" stroke-dasharray="6 5"/><text x="${g.x+16}" y="${g.y+26}" class="gt">${esc(g.label)}</text>${g.chip?chip(g.x+g.w-14,g.y+13,g.chip[0],g.chip[1],1):""}</g>`}
  for(const e of v.edges){const A=byId[e.a],B=byId[e.b];let[x1,y1]=anchor(A,e.as),[x2,y2]=anchor(B,e.bs),d;
    if((e.as==="r"&&e.bs==="l")||(e.as==="l"&&e.bs==="r")){const m=(x1+x2)/2;d=`M${x1} ${y1} H${m} V${y2} H${x2}`}
    else if((e.as==="r"||e.as==="l")&&e.bs==="b"){d=`M${x1} ${y1} H${x2} V${y2}`}
    else{const m=(y1+y2)/2;d=`M${x1} ${y1} V${m} H${x2} V${y2}`}
    const c=COL[e.s]||COL.off,dash=e.s==="stop"||e.s==="off"?"5 4":e.thin?"3 3":"";
    if(e.s==="stop"||e.s==="blocked"){const mx=(x1+x2)/2,my=(y1+y2)/2,ex=e.s==="blocked"?x2-14:mx,ey=e.s==="blocked"?y2:my;
      s+=`<path d="M${x1} ${y1} ${e.s==="blocked"?`H${ex}`:`L${ex} ${ey}`}" stroke="${c}" stroke-width="1.6" fill="none" stroke-dasharray="${e.s==="stop"?"5 4":""}"/>`;
      s+=`<circle cx="${ex}" cy="${ey}" r="10" fill="${e.s==="blocked"?"var(--ok)":"var(--bad)"}"/><text x="${ex}" y="${ey+4}" text-anchor="middle" class="mk">✕</text>`;
      if(e.stopLabel)s+=`<text x="${ex}" y="${ey+27}" text-anchor="middle" class="el" style="fill:${e.s==="blocked"?"var(--ok)":"var(--bad)"}">${esc(e.stopLabel)}</text>`;continue}
    s+=`<path d="${d}" stroke="${c}" stroke-width="${e.thin?1.1:1.6}" fill="none"${dash?` stroke-dasharray="${dash}"`:""}/>`;
    if(e.s!=="off"&&!e.thin)s+=`<circle cx="${x2}" cy="${y2}" r="3.5" fill="${c}"/>`;
    if(e.label){const lx=e.lx||(x1+x2)/2,ly=e.ly||((e.as==="r"&&e.bs==="l")?Math.min(A.y,B.y)-10:Math.min(y1,y2)-8);s+=`<text x="${lx}" y="${ly}" text-anchor="middle" class="el" style="fill:${e.s==="off"?"var(--subtle)":c}">${esc(e.label)}</text>`}}
  for(const n of v.nodes){const h=nodeH(n),bc=n.border==="off"?"var(--line-strong)":n.border==="warn"?"var(--warn)":"var(--ink)";
    s+=`<g class="nd${n.page?" click":""}"${n.page?` data-go="${n.page}" tabindex="0" role="button" aria-label="Mở ${esc(n.title)}"`:""}><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${h}" rx="12" class="nodebox" style="stroke:${bc}"${n.border==="off"?' stroke-dasharray="5 4"':""}/>`;
    s+=`<text x="${n.x+14}" y="${n.y+25}" class="nt">${esc(n.title)}</text>`;
    if(n.chip&&n.chip[0])s+=chip(n.x+n.w-12,n.y+12,n.chip[0],n.chip[1],1);
    if(n.big){s+=`<text x="${n.x+14}" y="${n.y+64}" class="big">${esc(n.big)}</text><rect x="${n.x+14}" y="${n.y+78}" width="${n.w-28}" height="6" rx="3" class="mtr"/><rect x="${n.x+14}" y="${n.y+78}" width="${(n.w-28)*n.meter/100}" height="6" rx="3" style="fill:${n.meter>=50?"var(--warn)":"var(--accent)"}"/><text x="${n.x+14}" y="${n.y+104}" class="rl">${esc(n.note)}</text>`}
    if(n.rows){s+=`<line x1="${n.x+14}" x2="${n.x+n.w-14}" y1="${n.y+40}" y2="${n.y+40}" class="dv"/>`;
      n.rows.forEach((r,i)=>{const y=n.y+60+i*20,dc={ok:"var(--ok)",bad:"var(--bad)",warn:"var(--warn)"}[r[2]]||"var(--line-strong)";
        s+=`<circle cx="${n.x+18}" cy="${y-4}" r="3.5" fill="${dc}"/><text x="${n.x+28}" y="${y}" class="rl">${esc(r[0])}</text><text x="${n.x+n.w-14}" y="${y}" text-anchor="end" class="rv ${r[2]}">${esc(r[1].length>24?r[1].slice(0,23)+"…":r[1])}</text>`})}
    s+=`</g>`}
  const foot=v.hint?`<span class="chip ${v.hint[0]}">${esc(v.hint[1])}</span>`:(v.legend||[]).map(([c,l])=>`<span class="lg"><i class="${c}"></i>${esc(l)}</span>`).join("");
  return s+"</svg>"+`<div class="arch-hint">${foot}</div>`}

/* ================= rendering ================= */
const PAGES={arch:["Sơ đồ bài học","Kiến trúc"],budgets:["Budgets","Chi phí"],billing:["Billing","Chi phí"],sns:["SNS","Thông báo"],mail:["Hộp thư mô phỏng","Thông báo"],iam:["IAM roles","Bảo mật"],sim:["Policy simulator","Bảo mật"],s3:["S3","Lưu trữ"],lambda:["Lambda","Compute"],logs:["CloudWatch Logs","Giám sát"],stack:["Stack (CDK)","Hạ tầng"]};
const LOCK={iam:1,sim:1,s3:1,lambda:3,logs:3,stack:5};
const unlocked=p=>LESSONS[UI.lesson].pages.includes(p);
const curB=()=>UI.bucket&&W.buckets.find(x=>x.name===UI.bucket)||W.buckets[0];
const info=t=>`<span class="info" tabindex="0" role="note" aria-label="${esc(t)}" data-tip="${esc(t)}">i</span>`;
const codeBlock=(lines,cls)=>`<pre class="code ${cls||""}">${lines.map((l,i)=>`<div class="ln${l[1]?" hl":""}${l[2]?" "+l[2]:""}"><b>${i+1}</b><span>${esc(l[0])}</span></div>`).join("")}</pre>`;
function renderSide(){const groups=[["Bài học",["arch"]],["Chi phí",["budgets","billing"]],["Thông báo",["sns","mail"]],["Bảo mật",["iam","sim"]],["Lưu trữ",["s3"]],["Compute",["lambda"]],["Giám sát",["logs"]],["Hạ tầng",["stack"]]];
  const unread=W.mail.filter(m=>!m.read).length;
  let h=`<div class="proj"><span class="cap">Account sandbox</span><b>lab-account</b><span class="mono muted" style="font-size:12px">${REGION} · Sydney</span></div>`;
  for(const[g,ps] of groups){h+=`<div class="ng cap">${g}</div>`;
    for(const p of ps){const isU=unlocked(p);
      const badge=p==="mail"&&unread?`<span class="chip bad">${unread}</span>`:p==="sns"&&W.topics.length?`<span class="chip">${W.topics.length}</span>`:p==="lambda"&&W.fns.length?`<span class="chip">${W.fns.length}</span>`:"";
      h+=isU?`<button class="nav${UI.page===p?" on":""}" data-go="${p}"><span>${PAGES[p][0]}</span>${badge}</button>`:`<button class="nav locked" disabled title="Mở ở Bài ${LOCK[p]}"><span>${PAGES[p][0]}</span><span class="chip">Bài ${LOCK[p]}</span></button>`}}
  h+=`<div class="ng cap">Sắp có</div>`+LOCKED.map(([n,,s])=>`<button class="nav locked" disabled><span>${n}</span><span class="chip">Bài ${s}</span></button>`).join("");
  h+=`<div class="sfoot">Part of <a href="https://dat-2k2.github.io/">dat-2k2.github.io</a><br><a href="https://dat-2k2.github.io/">← Back to home</a></div>`;
  document.getElementById("side").innerHTML=h}
function renderTop(){const L=LESSONS[UI.lesson],p=PAGES[UI.page];
  const id=W.identity==="sso"?`<span class="idpill">Đang dùng <b>SSO admin</b></span>`:`<span class="idpill on">Role <b>${esc(W.identity.slice(5))}</b> <button class="link" data-act="backToSso">Về SSO</button></span>`;
  document.getElementById("top").innerHTML=`<div class="crumb">${esc(p[1])} /<b>${esc(p[0])}</b></div>${L.id==="iam"||W.identity!=="sso"?id:""}
    <div class="tries" role="group" aria-label="Thử, không tính điểm" title="Thử bao nhiêu lần cũng được, không tính điểm"><span class="tl">Thử</span>${L.tries.map((t,i)=>`<button data-try="${i}">${esc(t[0])}</button>`).join("")}</div>
    <button class="ic" data-act="undo" ${UNDO.length?"":"disabled"} title="Undo" aria-label="Undo">↶</button><button class="ic" data-act="askReset" title="Reset bài" aria-label="Reset bài">⟲</button>`}
function tbl(head,rows,empty){return rows.length?`<div class="tw"><table><thead><tr>${head.map(x=>`<th>${x}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`:`<div class="tw"><div class="empty">${empty}</div></div>`}
function renderPage(){const el=document.getElementById("page"),P=UI.page,Lid=LESSONS[UI.lesson].id;let h="";
  if(P==="arch"){h=`<div class="ph"><h2>Sơ đồ bài học ${info("Bấm một khối để mở trang của nó. Sơ đồ cập nhật theo mọi thao tác.")}</h2></div><div class="arch">${svgView()}</div>`}
  else if(P==="budgets"){h=`<div class="ph"><h2>Budgets ${info("Theo dõi chi tiêu, cảnh báo khi vượt ngưỡng.")}</h2><button class="primary" data-act="newBudget">Tạo budget</button></div>`+
    tbl(["Tên","Số tiền / tháng","Ngưỡng","Gửi tới","Đã vượt",""],W.budgets.map(b=>`<tr><td><b>${esc(b.name)}</b></td><td class="mono">${money(b.limit)}</td><td class="mono">${b.thresholds.map(x=>x+"%").join(", ")||"—"}</td><td class="mono">${esc(b.topic||"—")}</td><td class="mono">${b.fired.map(x=>x+"%").join(", ")||"—"}</td><td><div class="acts"><button class="sm" data-act="editBudget" data-arg="${esc(b.name)}">Sửa</button><button class="sm danger" data-act="delBudget" data-arg="${esc(b.name)}">Xóa</button></div></td></tr>`),"Chưa có budget.")}
  else if(P==="billing"){const lim=(W.budgets[0]&&W.budgets[0].limit)||20;h=`<div class="ph"><h2>Billing ${info("Chi tiêu giả lập. Bơm chi phí bằng nút Thử ở thanh trên.")}</h2></div>
    <div class="grid3"><div class="card q"><span class="cap">Tháng này</span><b>${money(W.spend)}</b><span class="muted">trên ${money(lim)}</span><div class="bar"><i class="${W.spend/lim>=.5?"hi":""}" style="width:${Math.min(100,W.spend/lim*100)}%"></i></div></div></div>`}
  else if(P==="sns"){h=`<div class="ph"><h2>SNS topics ${info("Topic phát tin, subscription nhận tin. Email phải xác nhận mới nhận.")}</h2><button class="primary" data-act="newTopic">Tạo topic</button></div>`+
    (W.topics.length?W.topics.map(t=>`<div class="card sgc"><div class="ph" style="margin:0"><h2>${esc(t.name)} ${info(topicArn(t.name))}</h2><button class="sm" data-act="newSub" data-arg="${esc(t.name)}">+ Subscription</button><button class="sm" data-act="pubTest" data-arg="${esc(t.name)}" title="Thử, không tính điểm">Gửi tin thử</button><button class="sm danger" data-act="delTopic" data-arg="${esc(t.name)}">Xóa</button></div>`+
      tbl(["Protocol","Endpoint","Trạng thái",""],t.subs.map(s=>`<tr><td class="mono">email</td><td class="mono">${esc(s.endpoint)}</td><td><span class="chip ${s.status==="Confirmed"?"ok":"warn"}">${s.status}</span></td><td><button class="sm danger" data-act="unsub" data-arg="${esc(t.name)}|${s.id}">Hủy</button></td></tr>`),"Chưa có subscription.")+`</div>`).join(""):`<div class="tw"><div class="empty">Chưa có topic.</div></div>`)}
  else if(P==="mail"){const m=W.mail.find(x=>x.id===UI.mailOpen);
    h=`<div class="ph"><h2>Hộp thư <span class="sub">${EMAIL}</span></h2></div><div class="mailbox"><ul class="mlist">${W.mail.length?W.mail.map(x=>`<li><button class="mitem${x.id===UI.mailOpen?" on":""}${x.read?"":" unread"}" data-act="openMail" data-arg="${x.id}"><b>${esc(x.subject)}</b><small>${esc(x.from)} · ${x.t}</small></button></li>`).join(""):`<li class="empty">Chưa có thư nào.</li>`}</ul>
      <div class="mread">${m?`<h3>${esc(m.subject)}</h3><p class="muted mono" style="font-size:12px">Từ: ${esc(m.from)}<br>Tới: ${esc(m.to)}</p>`+(m.kind==="confirm"?`<p>You have chosen to subscribe to the topic:<br><span class="mono">${esc(topicArn(m.topic))}</span></p><p>To confirm this subscription, click the link below (if this was in error no action is necessary):</p><button class="primary" data-act="confirm" data-arg="${m.id}">Confirm subscription</button>`:`<p>${esc(m.body)}</p>`):`<p class="muted">Chọn một thư để đọc.</p>`}</div></div>`}
  else if(P==="iam"){h=`<div class="ph"><h2>IAM roles ${info("Trust policy quyết định ai dùng được role; policy gắn vào quyết định role làm được gì.")}</h2></div>`+
    W.roles.map(r=>`<div class="card sgc"><div class="ph" style="margin:0"><h2>${esc(r.name)} ${info(roleArn(r.name))}</h2><span class="chip">trust: ${r.trust==="lambda"?"lambda.amazonaws.com":"SSO của bạn"}</span>${r.trust!=="sso"?"":W.identity==="role:"+r.name?`<span class="chip ok">đang dùng</span>`:`<button class="primary sm" data-act="assume" data-arg="${esc(r.name)}">Assume role</button>`}${r.trust==="lambda"?`<button class="sm" data-act="attachPol" data-arg="${esc(r.name)}">+ Gắn policy</button>`:""}</div>`+
      r.policies.map(pn=>{const man=isManaged(pn);return`<div class="pt" style="display:flex;gap:8px;align-items:center">${esc(pn)} ${man?`<span class="chip info">AWS managed</span><button class="sm danger" data-act="detachPol" data-arg="${esc(r.name)}|${esc(pn)}">Gỡ</button>`:`<span class="chip">inline</span>`}</div>`+tbl(["Sid","Effect","Action","Resource",""],(W.policies[pn]?W.policies[pn].statements:[]).map((s,i)=>`<tr><td class="mono">${esc(s.sid)}</td><td><span class="chip ${s.effect==="Allow"?"ok":"warn"}">${s.effect}</span></td><td class="mono">${esc(s.actions.join(", "))}</td><td class="mono">${esc(s.resources.join(", "))}</td><td>${man?"":`<div class="acts"><button class="sm" data-act="editStmt" data-arg="${esc(pn)}|${i}">Sửa</button><button class="sm danger" data-act="delStmt" data-arg="${esc(pn)}|${i}">Xóa</button></div>`}</td></tr>`),"Policy trống.")}).join("")+`</div>`).join("")}
  else if(P==="sim"){const sm=UI.sim,r=UI.simResult,b=W.buckets[0],acts=["s3:ListBucket","s3:GetObject","s3:PutObject","s3:DeleteObject",...(W.fns.length?["logs:CreateLogGroup","logs:PutLogEvents"]:[])];
    h=`<div class="ph"><h2>Policy simulator ${info("Hỏi IAM có được phép không và vì sao, mà không làm thật. Không tính điểm.")}</h2></div>
    <div class="card"><div class="frow"><label class="fld">Principal<select id="sim-p">${[["sso","SSO admin"],...W.roles.map(r=>["role:"+r.name,"role "+r.name])].map(([v,l])=>`<option value="${v}"${sm.principal===v?" selected":""}>${esc(l)}</option>`).join("")}</select></label>
      <label class="fld">Action<select id="sim-a">${acts.map(a=>`<option${sm.action===a?" selected":""}>${a}</option>`).join("")}</select></label>
      <label class="fld">Object<select id="sim-k">${(b?b.objects:[]).map(o=>`<option${sm.key===o.key?" selected":""}>${esc(o.key)}</option>`).join("")}</select></label></div>
      <div class="mfoot" style="justify-content:flex-start;margin-top:14px"><button class="primary" data-act="simulate">Chạy mô phỏng</button></div>
      ${r?`<div class="result ${r.allow?"ok":"bad"}" style="margin-top:14px">${r.allow?"allowed":r.kind==="explicit"?"explicitDeny":"implicitDeny"} · ${esc(r.by)}</div>`:""}</div>
    <div class="evalflow" aria-label="Thứ tự đánh giá"><span class="chip bad">Deny khớp → chặn</span><span>→</span><span class="chip ok">Allow khớp → cho</span><span>→</span><span class="chip">còn lại → chặn ngầm</span></div>`}
  else if(P==="s3"){const b=curB(),multi=W.buckets.length>1,sel=Lid==="events"||Lid==="stack";
    const tabs=multi?`<div class="seg" style="margin-bottom:16px">${W.buckets.map(x=>`<button class="${x===b?"on":""}" data-act="pickBucket" data-arg="${esc(x.name)}">${esc(x.name.replace("-"+ACCT,""))}</button>`).join("")}</div>`:"";
    if(!b){h=`<div class="ph"><h2>S3</h2></div><div class="tw"><div class="empty">Không có bucket nào.</div></div>`}
    else{const n=UI.selKeys.length,fq=UI.s3find||"",objs=b.objects.filter(o=>o.key.startsWith(fq)),allOn=sel&&objs.length>0&&objs.every(o=>UI.selKeys.includes(o.key));
      h=tabs+`<div class="ph"><h2>${esc(b.name)} ${info("Region "+REGION+". Thao tác chạy bằng danh tính hiện tại.")}</h2>${b.stack===false&&Lid==="stack"?`<span class="chip warn">ngoài stack</span>`:b.stack?`<span class="chip acc">stack</span>`:""}<span class="chip">${W.identity==="sso"?"SSO admin":"role "+esc(W.identity.slice(5))}</span><span class="chip ${b.bpa?"ok":"bad"}">BPA ${b.bpa?"bật":"tắt"}</span>${Lid==="stack"?`<button class="sm" data-act="emptyB" data-arg="${esc(b.name)}">Empty</button><button class="sm danger" data-act="delB" data-arg="${esc(b.name)}">Xóa bucket</button>`:""}</div>
      <div class="pt" style="display:flex;align-items:center;gap:8px"><span style="flex:1">Objects · ${b.objects.length}</span>${sel?`<button class="sm danger" data-act="delSel" ${n?"":"disabled"}>Xóa đã chọn${n?" ("+n+")":""}</button>`:""}</div>`+
      (sel?`<label class="fld" style="margin-bottom:10px;max-width:360px"><input id="s3find" placeholder="Tìm theo prefix, ví dụ incoming/" value="${esc(fq)}" autocomplete="off" aria-label="Tìm object theo prefix"></label>`:"")+
      tbl([...(sel?[`<input type="checkbox" data-act="selAll" aria-label="Chọn tất cả object đang hiện" ${allOn?"checked":""}>`]:[]),"Key","Kích thước",""],objs.map(o=>`<tr>${sel?`<td style="width:36px"><input type="checkbox" data-act="selObj" data-arg="${esc(o.key)}" aria-label="Chọn ${esc(o.key)}" ${UI.selKeys.includes(o.key)?"checked":""}></td>`:""}<td class="mono">${esc(o.key)}</td><td class="mono">${o.size}</td><td><div class="acts"><button class="sm" data-act="s3get" data-arg="${esc(o.key)}">Tải</button>${Lid==="s3"?`<button class="sm" data-act="presign" data-arg="${esc(o.key)}">Presign</button>`:""}<button class="sm danger" data-act="s3del" data-arg="${esc(o.key)}">Xóa</button></div></td></tr>`),"Bucket trống.")+
      `<div class="acts" style="margin-top:10px"><button class="sm" data-act="s3list">Liệt kê</button>${Lid==="events"||Lid==="stack"?"":`<button class="sm" data-act="s3put">Tải lên notes.txt</button>`}</div>`+
      (b.notifs&&(b.notifs.length||Lid==="events")?`<div class="pt">Event notifications</div>`+tbl(["Tên","Sự kiện","Prefix","Suffix","Đích",""],b.notifs.map(nt=>`<tr><td class="mono">${esc(nt.id)}</td><td class="mono">ObjectCreated:*</td><td class="mono">${esc(nt.prefix||"(mọi key)")}</td><td class="mono">${esc(nt.suffix||"(mọi key)")}</td><td class="mono">λ ${esc(nt.fn)}</td><td>${b.stack?"":`<button class="sm" data-act="editNotif" data-arg="${esc(nt.id)}">Sửa</button>`}</td></tr>`),"Không có trigger."):"")+
      `<div class="pt">Permissions</div><div class="card"><div class="ph" style="margin:0"><h2>Block Public Access ${info("Khi bật, mọi policy hay ACL public đều bị bỏ qua.")}</h2><button class="sm ${b.bpa?"":"primary"}" data-act="bpa" data-arg="${b.bpa?0:1}">${b.bpa?"Tắt":"Bật"}</button></div></div>`+
      (b.policy.length||Lid==="s3"?`<div class="pt">Bucket policy</div>`+tbl(["Sid","Effect","Principal","Action","Resource",""],b.policy.map(s=>`<tr><td class="mono">${esc(s.sid)}</td><td><span class="chip ${s.effect==="Allow"?"ok":"warn"}">${s.effect}</span></td><td class="mono">${s.principal==="*"?'"*" · bất kỳ ai':esc(s.principal)}</td><td class="mono">${esc(s.actions.join(", "))}</td><td class="mono">${esc(s.resources.join(", "))}</td><td><button class="sm danger" data-act="delBStmt" data-arg="${esc(s.sid)}">Xóa</button></td></tr>`),"Không có bucket policy."):"")+
      (W.links.length?`<div class="pt">Presigned URL</div>`+tbl(["Object","Hạn","URL",""],W.links.map(l=>`<tr><td class="mono">${esc(l.key)}</td><td class="mono">${l.expires} phút</td><td class="mono url">https://${esc(l.bucket)}.s3.${REGION}.amazonaws.com/${esc(l.key)}?X-Amz-Algorithm=AWS4-HMAC-SHA256&amp;X-Amz-Expires=${l.expires*60}&amp;X-Amz-Signature=…</td><td><button class="sm" data-act="revoke" data-arg="${l.id}">Bỏ</button></td></tr>`),""):"")}}
  else if(P==="lambda"){const f=W.fns[0];
    if(!f)h=`<div class="ph"><h2>Lambda</h2></div><div class="tw"><div class="empty">Chưa có function.</div></div>`;
    else{const last=f.last,cost=f.invocations*0.2/1e6+f.gbs*0.0000166667;
      h=`<div class="ph"><h2>${esc(f.name)} ${info(fnArn(f.name))}</h2><span class="chip">${f.runtime}</span>${f.stack?`<span class="chip acc">stack</span>`:""}<button class="sm" data-act="editFn" ${f.stack?"disabled title='Sửa trong code CDK'":""}>Sửa cấu hình</button><button class="primary" data-act="invoke">Test</button></div>
      <div class="grid3"><div class="card q"><span class="cap">Memory</span><b>${f.memory}<span class="muted" style="font-size:14px"> MB</span></b></div><div class="card q"><span class="cap">Timeout</span><b>${f.timeout}<span class="muted" style="font-size:14px"> s</span></b></div><div class="card q"><span class="cap">Lần chạy · lỗi</span><b>${f.invocations}<span class="muted" style="font-size:14px"> · ${f.errors}</span></b><span class="muted mono" style="font-size:12px">≈ $${cost.toFixed(6)}</span></div></div>
      ${last?`<div class="result ${last.ok?"ok":"bad"}" style="margin-top:12px">${last.ok?"200 · "+Math.ceil(last.dur)+" ms":esc(last.err)}</div>`:""}
      <div class="pt">Cấu hình</div><div class="card"><div class="kv"><span class="kt">Handler</span><span class="kd">${f.handler}</span><span></span><span class="kt">Execution role</span><span class="kd">${esc(f.role)}</span><span><button class="sm" data-go="iam">Mở IAM</button></span>${Object.keys(f.env).map(k=>`<span class="kt">${k}</span><span class="kd">${esc(f.env[k]||"(trống)")}</span><span></span>`).join("")}<span class="kt">Log group</span><span class="kd">${lgName(f.name)}</span><span><button class="sm" data-go="logs">Xem log</button></span></div></div>`}}
  else if(P==="logs"){const g=UI.lg&&W.logGroups.find(x=>x.name===UI.lg)||W.logGroups[0];
    h=`<div class="ph"><h2>CloudWatch Logs ${info("Lambda tự ghi log vào /aws/lambda/<tên>, nếu execution role cho phép.")}</h2>${g?`<button class="sm" data-act="refresh">Làm mới</button>`:""}</div>`+
    (g?(W.logGroups.length>1?`<div class="seg" style="margin-bottom:12px">${W.logGroups.map(x=>`<button class="${x===g?"on":""}" data-act="pickLg" data-arg="${esc(x.name)}">${esc(x.name)}</button>`).join("")}</div>`:"")+
      `<div class="console" style="max-height:none"><div class="bar3"><i></i><i></i><i></i><span>aws logs tail ${esc(g.name)}</span></div><div class="body">${g.lines.slice(-80).map(l=>`<div><span class="dim">${l.t}</span>  <span class="${l.m.startsWith("REPORT")?"ps":l.m.includes("ERROR")||l.m.includes("timed out")?"err":l.m.startsWith("START")||l.m.startsWith("END")?"dim":""}"${l.m.includes("ERROR")||l.m.includes("timed out")?' style="color:#ff8a80"':""}>${esc(l.m)}</span></div>`).join("")}</div></div>`
     :`<div class="tw"><div class="empty">Không có log group nào.</div></div>`)}
  else if(P==="stack"){const s=W.stack,up=isUp(s),dirty=up&&JSON.stringify(s.code)!==JSON.stringify(s.deployed),tab=UI.stackTab;
    const res=up?[["Images","AWS::S3::Bucket",IMG],["ExtractServiceRole","AWS::IAM::Role","CloudLabPipeline-ExtractRole"],["Extract","AWS::Lambda::Function","extract"],["ImagesNotifications","Custom::S3BucketNotifications","—"]]:[];
    h=`<div class="ph"><h2>CloudLabPipeline ${info("cdk deploy dựng mọi thứ trong code; cdk destroy xóa đúng những thứ stack đã tạo.")}</h2><span class="chip ${up?(dirty?"warn":"ok"):s.status.includes("FAIL")||s.status.includes("ROLLBACK")?"bad":""}">${s.status.replace(/_/g," ")}</span>${dirty?`<span class="chip warn">code đã sửa</span>`:""}
      <button class="sm" data-act="cdkEdit">Sửa bucket</button><button class="primary" data-act="cdkDeploy">cdk deploy</button><button class="sm danger" data-act="askDestroy" ${up?"":"disabled"}>cdk destroy</button></div>
      <div class="seg" style="margin-bottom:12px"><button class="${tab==="cdk"?"on":""}" data-act="stackTab" data-arg="cdk">lib/pipeline-stack.ts</button><button class="${tab==="cfn"?"on":""}" data-act="stackTab" data-arg="cfn">CloudFormation</button></div>
      ${codeBlock(tab==="cdk"?cdkTs(s.code):cfnYaml(s.code))}
      <div class="pt">Tài nguyên trong stack</div>`+tbl(["Logical ID","Type","Physical ID","Status"],res.map(r=>`<tr><td class="mono">${r[0]}</td><td class="mono">${r[1]}</td><td class="mono">${esc(r[2])}</td><td><span class="chip ok">${s.status==="UPDATE_COMPLETE"?"update complete":"create complete"}</span></td></tr>`),s.lastDestroy?`Stack đã xóa${s.lastDestroy.retained.length?" · giữ lại: "+s.lastDestroy.retained.join(", "):""}${s.lastDestroy.failed.length?" · lỗi: "+s.lastDestroy.failed.join(", "):""}`:"Chưa deploy.")}
  el.innerHTML=h}
function renderLog(){const sel=LOG.find(l=>l.id===UI.logSel)||LOG[0];
  const KT={api:"Lệnh bạn chạy",evt:"AWS tự làm",try:"Thử, không tính điểm",les:"Bài học"},kk=l=>l.kind==="API"||l.kind==="CLI"?"api":l.kind==="Sự kiện"?"evt":l.kind==="Thử"?"try":"les";
  document.getElementById("log").innerHTML=`<div class="logl"><div class="logh"><span class="cap">Event log</span><span class="chip">${LOG.length}</span></div>
    <ul class="log">${LOG.map(l=>`<li class="${l.id===(sel&&sel.id)?"sel":""}" data-log="${l.id}" tabindex="0"><span class="t">${l.t}</span><span class="ev ${l.tone}"><span class="k k-${kk(l)}" title="${KT[kk(l)]}">${l.kind}</span> ${esc(l.svc)} · ${esc(l.op)}</span><span class="m">${esc(l.msg)}</span></li>`).join("")}</ul></div>
    <div class="console"><div class="bar3"><i></i><i></i><i></i><span>aws CLI</span>${sel&&sel.cli?`<button data-act="copy">Copy</button>`:""}</div>${sel&&sel.cli?`<pre id="clitext"><span class="ps">$ </span>${esc(sel.cli)}</pre>`:`<pre class="dim"># không có lệnh tương đương</pre>`}</div>`}
function renderLesson(){const L=LESSONS[UI.lesson],R=UI.result,hs=L.hints(W);
  const mark=(i)=>{if(!R)return["","",String(i+1)];return R.res[i]?["pass","✓"]:["fail","✕"]};
  const passed=R?R.res.filter(Boolean).length:0,nT=L.tasks.length;
  let h=`<div class="lh"><span class="lab">Track 1</span><div class="ldots">${LESSONS.map((x,i)=>`<button class="ldot${DONE.has(x.id)?" done":""}${i===UI.lesson?" cur":""}" data-lesson="${i}" aria-label="Bài ${x.step}: ${esc(x.title)}${DONE.has(x.id)?" (đã đạt)":""}"><span>${x.step}</span></button>`).join("")}</div></div>
  <div><span class="cap eyebrow">Bài ${L.step} · ${esc(L.tag)}</span><h1>${esc(L.title)}</h1><p class="goal">${esc(L.goal)}</p></div>
  <details class="scn"><summary><span class="av">${L.who[0]}</span><span class="q">${esc(L.who[1].split(" · ")[0])}: “${esc(L.scenario)}”</span></summary><p>“${esc(L.scenario)}”</p><small class="muted">${esc(L.who[1])}</small></details>
  <div class="sect"><div class="th"><span class="lab">Nhiệm vụ</span><span class="cnt">${passed}/${nT}</span><span class="pbar"><i style="width:${passed/nT*100}%"></i></span></div>${L.tasks.map((t,i)=>{const[c,g]=mark(i);return`<div class="task ${c}"><span class="tm2">${R?g:i+1}</span><div><b>${esc(t.t)}</b>${R&&R.res[i]?`<small>${esc(t.c)}</small>`:""}</div></div>`}).join("")}
  ${R&&UI.dirty?`<span class="chip warn dirty">Đã sửa · Check lại</span>`:""}</div>`;
  if(R)h+=`<div class="callout ${R.ok?"ok":R.skipped?"info":""}"><b>${R.ok?"Đạt":R.skipped?"Đã làm hộ":`Chưa đạt · lần ${UI.attempt}`}</b>${esc(R.msg)}</div>`;
  if(UI.hints)h+=hs.slice(0,UI.hints).map((x,i)=>`<div class="callout warn"><b>Gợi ý ${i+1}/${hs.length}</b>${esc(x)}</div>`).join("");
  if(R&&R.ok&&!R.skipped){const nx=UI.lesson+1<LESSONS.length;h+=`<div class="lacts">${nx?`<button class="primary" data-lesson="${UI.lesson+1}">Bài tiếp: ${esc(LESSONS[UI.lesson+1].tag)} →</button>`:`<button class="primary" disabled>Hết P1 · bài sau sắp có</button>`}</div>${UI.hints?`<p class="note">Dùng ${UI.hints} gợi ý</p>`:""}`}
  else h+=`<div class="lacts"><button class="primary" data-act="check">Check</button><button data-act="hint" ${UI.hints>=hs.length?"disabled":""}>Gợi ý ${UI.hints}/${hs.length}</button><button class="ghost" data-act="askSkip">Skip</button></div>`;
  h+=`<details class="more"><summary>Khái niệm (${L.concepts.length})</summary><div class="tags">${L.concepts.map(c=>`<span class="tag">${esc(c)}</span>`).join("")}</div></details>`;
  document.getElementById("lesson").innerHTML=h}
function renderModal(){const el=document.getElementById("modal"),M=UI.modal;if(!M){el.innerHTML="";return}
  const v=modalValues();const cli=M.cli?M.cli(v):"",note=M.note?M.note(v):"";
  el.innerHTML=`<div class="scrim" data-act="closeModal"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mt" data-stop="1"><h3 id="mt">${esc(M.title)}</h3>${M.body||""}
    ${(M.fields||[]).map(f=>f.type==="checks"?`<fieldset class="fld"><legend>${esc(f.label)}</legend><div class="acts">${f.items.map(([k,l])=>`<label class="ck"><input type="checkbox" id="f-${k}" ${M.init[k]?"checked":""}> ${esc(l)}</label>`).join("")}</div></fieldset>`
      :`<label class="fld">${esc(f.label)}${f.type==="select"?`<select id="f-${f.id}">${f.options.map(([o,l])=>`<option value="${esc(o)}"${String(M.init[f.id])===String(o)?" selected":""}>${esc(l)}</option>`).join("")}</select>`:`<input id="f-${f.id}" type="${f.type||"text"}" value="${esc(M.init[f.id]??"")}" autocomplete="off">`}${f.help?`<small>${esc(f.help)}</small>`:""}</label>`).join("")}
    <div id="mnote">${note}</div>${M.cli?`<div class="console"><div class="bar3"><i></i><i></i><i></i><span>Lệnh sẽ chạy</span></div><pre><span class="ps">$ </span><span id="mcli">${esc(cli)}</span></pre></div>`:""}<p class="ferr" id="merr" role="alert">${esc(M.err||"")}</p>
    <div class="mfoot"><button class="ghost" data-act="closeModal">${esc(M.cancel||"Hủy")}</button>${M.submitLabel?`<button class="primary ${M.danger?"dangerbtn":""}" data-act="submitModal">${esc(M.submitLabel)}</button>`:""}</div></div></div>`;
  const first=el.querySelector("input,select,.primary");if(first)first.focus()}
function modalValues(){const M=UI.modal,v={...(M?M.init:{})};if(!M)return v;
  for(const f of M.fields||[]){if(f.type==="checks"){f.items.forEach(([k])=>{const e=document.getElementById("f-"+k);if(e)v[k]=e.checked?1:0})}else{const e=document.getElementById("f-"+f.id);if(e)v[f.id]=e.value}}return v}
function render(){renderSide();renderTop();renderPage();renderLog();renderLesson();renderModal()}
function refreshModalPreview(){const M=UI.modal;if(!M)return;const v=modalValues();if(M.cli){const c=document.getElementById("mcli");if(c)c.textContent=M.cli(v)}if(M.note){const n=document.getElementById("mnote");if(n)n.innerHTML=M.note(v)}const e=document.getElementById("merr");if(e)e.textContent=""}

/* ================= modals ================= */
function budgetModal(b){UI.editBudget=b&&b.name;
  UI.modal={title:b?`Sửa budget ${b.name}`:"Tạo budget",submitLabel:b?"Lưu":"Tạo budget",
    init:b?{name:b.name,limit:b.limit,t50:+b.thresholds.includes(50),t80:+b.thresholds.includes(80),t100:+b.thresholds.includes(100),topic:b.topic||""}:{name:"monthly-20usd",limit:20,t50:1,t80:0,t100:0,topic:""},
    fields:[{id:"name",label:"Tên budget"},{id:"limit",label:"Số tiền mỗi tháng (USD)",type:"number"},{type:"checks",label:"Cảnh báo khi chi tiêu thực tế vượt",items:[["t50","50%"],["t80","80%"],["t100","100%"]]},
      {id:"topic",label:"Gửi cảnh báo tới SNS topic",type:"select",options:[["","— chưa chọn —"],...W.topics.map(t=>[t.name,t.name])],help:W.topics.length?"":"Chưa có topic nào. Tạo ở trang SNS trước."}],
    cli:v=>`aws budgets ${b?"update-budget":"create-budget"} \\\n  --account-id ${ACCT} \\\n  --budget '{"BudgetName":"${v.name}","BudgetLimit":{"Amount":"${v.limit}","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST"}'`,
    note:v=>v.topic?"":`<div class="callout warn"><b>Chưa chọn nơi gửi</b>Vượt ngưỡng sẽ không ai được báo.</div>`,
    submit:v=>API.saveBudget(v,!b)};render()}
function stmtModal(pn,i){const s=W.policies[pn].statements[i];
  UI.modal={title:`Sửa statement ${s.sid} trong ${pn}`,submitLabel:"Lưu policy",init:{sid:s.sid,effect:s.effect,actions:s.actions.join(", "),resources:s.resources.join(", ")},
    fields:[{id:"sid",label:"Sid"},{id:"effect",label:"Effect",type:"select",options:[["Allow","Allow"],["Deny","Deny"]]},{id:"actions",label:"Action (ngăn cách bằng dấu phẩy)",help:"* khớp mọi ký tự: s3:*Object = Get/Put/DeleteObject…"},{id:"resources",label:"Resource (ARN, ngăn cách bằng dấu phẩy)"}],
    note:v=>{const acts=v.actions.split(",").map(x=>x.trim()).filter(Boolean),hit=["s3:GetObject","s3:PutObject","s3:DeleteObject","s3:ListBucket"].filter(a=>matchAny(acts,a));return hit.length?`<p class="note">Statement này khớp: <span class="mono">${hit.join(", ")}</span></p>`:""},
    cli:()=>`aws iam put-role-policy \\\n  --role-name lab-readonly-s3 \\\n  --policy-name ${pn} \\\n  --policy-document file://${pn}.json`,
    submit:v=>API.editStatement(pn,i,v)};render()}
function presignModal(key){const b=W.buckets[0];
  UI.modal={title:`Tạo presigned URL cho ${key}`,submitLabel:"Tạo link",init:{min:60},fields:[{id:"min",label:"Hết hạn sau (phút)",type:"number",help:"Tối đa 10080 phút (7 ngày) với IAM credential."}],
    cli:v=>`aws s3 presign s3://${b.name}/${key} --expires-in ${Number(v.min||0)*60}`,
    note:()=>`<p class="note">Ký bằng ${W.identity==="sso"?"SSO admin":esc(W.identity.slice(5))}. Ai có link đều mở được tới khi hết hạn.</p>`,
    submit:v=>API.presign(b.name,key,v.min)};render()}
function fnModal(){const f=W.fns[0],hasEnv="OUTPUT_PREFIX" in f.env;
  UI.modal={title:`Cấu hình ${f.name}`,submitLabel:"Lưu",init:{memory:f.memory,timeout:f.timeout,prefix:f.env.OUTPUT_PREFIX||""},
    fields:[{id:"memory",label:"Memory (MB)",type:"select",options:[128,256,512,1024].map(m=>[m,m+" MB"]),help:"Thêm memory thì thêm CPU."},{id:"timeout",label:"Timeout (giây)",type:"number",help:"1 đến 900. Mặc định 3."},...(hasEnv?[{id:"prefix",label:"Biến môi trường OUTPUT_PREFIX",help:"Nơi ghi kết quả, ví dụ processed/."}]:[])],
    cli:v=>`aws lambda update-function-configuration \\\n  --function-name ${f.name} \\\n  --memory-size ${v.memory} --timeout ${v.timeout}`+(hasEnv?` \\\n  --environment "Variables={OUTPUT_PREFIX=${v.prefix}}"`:""),
    submit:v=>API.updateFn(f.name,v)};render()}
function attachModal(role){const r=W.roles.find(x=>x.name===role),opts=Object.keys(MANAGED).filter(p=>!r.policies.includes(p));
  UI.modal={title:`Gắn policy vào ${role}`,submitLabel:"Gắn policy",init:{pn:opts[0]||""},fields:[{id:"pn",label:"AWS managed policy",type:"select",options:opts.map(p=>[p,p])}],
    note:v=>v.pn?`<div class="code" style="padding:8px 12px">${MANAGED[v.pn].statements.map(s=>`<div class="ln"><span>${esc(s.effect)} ${esc(s.actions.join(", "))} on ${esc(s.resources.join(", "))}</span></div>`).join("")}</div>`:"",
    cli:v=>`aws iam attach-role-policy \\\n  --role-name ${role} \\\n  --policy-arn ${v.pn?MANAGED[v.pn].arn:""}`,submit:v=>API.attachPolicy(role,v.pn)};render()}
function notifModal(id){const b=curB(),n=b.notifs.find(x=>x.id===id);
  UI.modal={title:`Trigger ${id}`,submitLabel:"Lưu",init:{prefix:n.prefix,suffix:n.suffix},fields:[{id:"prefix",label:"Prefix",help:"Chỉ object có key bắt đầu bằng chuỗi này. Trống = mọi key."},{id:"suffix",label:"Suffix",help:"Ví dụ .jpg. Trống = mọi key."}],
    note:v=>{const hit=k=>k.startsWith(v.prefix||"")&&k.endsWith(v.suffix||"");return`<p class="note">incoming/cat.jpg ${hit("incoming/cat.jpg")?"→ chạy":"→ bỏ qua"} · processed/cat.jpg.json ${hit("processed/cat.jpg.json")?"→ chạy":"→ bỏ qua"}</p>`},
    cli:()=>`aws s3api put-bucket-notification-configuration \\\n  --bucket ${b.name} \\\n  --notification-configuration file://notification.json`,submit:v=>API.setNotif(b.name,id,v)};render()}
function cdkModal(){const c=W.stack.code;
  UI.modal={title:"Sửa bucket Images",submitLabel:"Lưu code",init:{removal:c.removal,autoDelete:+c.autoDelete},
    fields:[{id:"removal",label:"removalPolicy",type:"select",options:[["RETAIN","RETAIN (mặc định)"],["DESTROY","DESTROY"]],help:"Destroy stack thì bucket bị giữ lại hay bị xóa."},{type:"checks",label:"Tùy chọn",items:[["autoDelete","autoDeleteObjects: xóa hết object trước khi xóa bucket"]]}],
    note:v=>`<p class="note">Lưu xong phải cdk deploy thì stack mới đổi.</p>`,submit:v=>API.cdkEdit(v)};render()}
function confirmModal(title,body,label,fn,danger){UI.modal={title,body:`<p>${body}</p>`,submitLabel:label,danger,init:{},fields:[],submit:()=>{fn();return ok()}};render()}

/* ================= events ================= */
document.addEventListener("click",e=>{
  const t=e.target.closest("[data-act],[data-go],[data-try],[data-lesson],[data-log]");
  if(!t){return}
  if(t.dataset.stop&&!t.dataset.act)return;
  if(t.dataset.go){if(!unlocked(t.dataset.go))return;UI.page=t.dataset.go;render();return}
  if(t.dataset.try){LESSONS[UI.lesson].tries[+t.dataset.try][1]();render();return}
  if(t.dataset.lesson!==undefined&&t.dataset.act===undefined){const i=+t.dataset.lesson;if(i===UI.lesson&&!(UI.result&&UI.result.ok))return;startLesson(i);render();return}
  if(t.dataset.log){UI.logSel=+t.dataset.log;renderLog();return}
  const a=t.dataset.act,arg=t.dataset.arg;
  if(a==="closeModal"){if(e.target.closest("[data-stop]")&&t.classList.contains("scrim"))return;UI.modal=null;render();return}
  const A={
    undo(){if(!UNDO.length)return;W=UNDO.pop();UI.dirty=true;log("Bài học","sandbox","undo","hoàn tác thao tác gần nhất","warn")},
    askReset(){confirmModal("Reset bài này?","Bài về trạng thái ban đầu. Event log giữ nguyên.","Reset bài",()=>{const i=UI.lesson;startLesson(i,true);log("Bài học","lesson","reset",`Bài ${LESSONS[i].step} về trạng thái ban đầu`,"warn")},true)},
    askSkip(){confirmModal("Skip bài này?","CloudLab làm hộ và ghi từng lệnh vào Event log. Tính là đã xem, không tính đạt.","Làm hộ",()=>skip())},
    check(){check()},hint(){UI.hints=Math.min(UI.hints+1,LESSONS[UI.lesson].hints(W).length);log("Bài học","lesson","hint",`mở gợi ý ${UI.hints}`,"")},
    newBudget(){budgetModal(null)},editBudget(){budgetModal(W.budgets.find(b=>b.name===arg))},delBudget(){confirmModal("Xóa budget?",`Budget ${esc(arg)} sẽ ngừng theo dõi chi tiêu.`,"Xóa",()=>API.deleteBudget(arg),true)},
    newTopic(){UI.modal={title:"Tạo SNS topic",submitLabel:"Tạo topic",init:{name:"billing-alerts"},fields:[{id:"name",label:"Tên topic",help:"Chữ, số, - và _."}],cli:v=>`aws sns create-topic --name ${v.name}`,submit:v=>API.createTopic(v.name)}},
    newSub(){UI.modal={title:`Thêm subscription vào ${arg}`,submitLabel:"Tạo subscription",init:{ep:EMAIL},fields:[{id:"ep",label:"Email nhận",help:"AWS sẽ gửi thư xác nhận tới địa chỉ này."}],cli:v=>`aws sns subscribe \\\n  --topic-arn ${topicArn(arg)} \\\n  --protocol email \\\n  --notification-endpoint ${v.ep}`,submit:v=>API.subscribe(arg,v.ep)}},
    delTopic(){confirmModal("Xóa topic?",`Mọi subscription của ${esc(arg)} cũng bị xóa. Budget đang gửi tới topic này sẽ mất nơi gửi.`,"Xóa",()=>API.deleteTopic(arg),true)},
    unsub(){const[tp,id]=arg.split("|");API.unsubscribe(tp,id)},pubTest(){API.publishTest(arg)},
    openMail(){UI.mailOpen=arg;const m=W.mail.find(x=>x.id===arg);if(m)m.read=true},confirm(){API.confirm(arg)},
    assume(){API.assumeRole(arg)},backToSso(){API.backToSso()},editStmt(){const[p,i]=arg.split("|");stmtModal(p,+i)},
    delStmt(){const[p,i]=arg.split("|");confirmModal("Xóa statement?",`Statement ${esc(W.policies[p].statements[+i].sid)} sẽ bị xóa khỏi ${esc(p)}.`,"Xóa",()=>API.deleteStatement(p,+i),true)},
    simulate(){UI.sim={principal:document.getElementById("sim-p").value,action:document.getElementById("sim-a").value,key:document.getElementById("sim-k").value};API.simulate(UI.sim.principal,UI.sim.action,UI.sim.key)},
    s3get(){API.s3("s3:GetObject",curB().name,arg)},s3del(){API.s3("s3:DeleteObject",curB().name,arg)},s3put(){API.s3("s3:PutObject",curB().name,"notes.txt")},s3list(){API.s3("s3:ListBucket",curB().name)},
    bpa(){API.setBpa(curB().name,arg==="1")},delBStmt(){API.deleteBucketStmt(curB().name,arg)},presign(){presignModal(arg)},revoke(){API.revoke(arg)},
    pickBucket(){UI.bucket=arg;UI.selKeys=[];UI.s3find=""},
    selAll(){const b=curB(),keys=b.objects.filter(o=>o.key.startsWith(UI.s3find||"")).map(o=>o.key),all=keys.every(k=>UI.selKeys.includes(k));UI.selKeys=all?UI.selKeys.filter(k=>!keys.includes(k)):[...new Set([...UI.selKeys,...keys])]},selObj(){UI.selKeys=UI.selKeys.includes(arg)?UI.selKeys.filter(k=>k!==arg):[...UI.selKeys,arg]},
    delSel(){const n=UI.selKeys.length;confirmModal(`Xóa ${n} object?`,"Không hoàn tác được trên AWS thật (trừ khi bật versioning).","Xóa",()=>API.deleteObjects(curB().name,UI.selKeys),true)},
    editNotif(){notifModal(arg)},emptyB(){confirmModal("Làm rỗng bucket?",`Mọi object trong ${esc(arg)} sẽ bị xóa.`,"Empty",()=>API.emptyBucket(arg),true)},
    delB(){const r=API.deleteBucket(arg);if(r&&r.ok===false){}},
    invoke(){API.invoke(W.fns[0].name)},editFn(){fnModal()},attachPol(){attachModal(arg)},detachPol(){const[r,p]=arg.split("|");API.detachPolicy(r,p)},
    pickLg(){UI.lg=arg},refresh(){},stackTab(){UI.stackTab=arg},cdkEdit(){cdkModal()},cdkDeploy(){API.cdkDeploy()},
    askDestroy(){confirmModal("cdk destroy?","Xóa mọi tài nguyên stack CloudLabPipeline đã tạo.","Destroy",()=>API.cdkDestroy(),true)},
    copy(){const txt=(document.getElementById("clitext")||{}).textContent||"";try{navigator.clipboard.writeText(txt).then(()=>{t.textContent="Đã copy"},()=>selectCli())}catch(_){selectCli()}return true},
    submitModal(){const M=UI.modal,v=modalValues(),r=M.submit(v);if(r&&r.ok===false){M.init=v;M.err=r.err;render();return true}UI.modal=null},
  };
  if(A[a]){const keep=A[a]();if(keep!==true)render()}
});
function selectCli(){const p=document.getElementById("clitext");if(!p)return;const r=document.createRange();r.selectNodeContents(p);const s=getSelection();s.removeAllRanges();s.addRange(r)}
document.addEventListener("input",e=>{if(e.target.closest(".modal"))refreshModalPreview();
  if(e.target.id==="s3find"){UI.s3find=e.target.value;renderPage();const f=document.getElementById("s3find");if(f){f.focus();f.setSelectionRange(f.value.length,f.value.length)}}});
document.addEventListener("change",e=>{if(e.target.closest(".modal"))refreshModalPreview()});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&UI.modal){UI.modal=null;render();return}
  const g=e.target.closest&&e.target.closest("[data-go][role=button],[data-log]");
  if(g&&(e.key==="Enter"||e.key===" ")){e.preventDefault();g.click()}});

/* ================= boot ================= */
startLesson(Math.min(store.get("lesson",0),LESSONS.length-1),false);render();
(function(){const btn=document.getElementById("theme");if(!btn)return;const root=document.documentElement;
  const cur=()=>root.dataset.theme||(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");
  const paint=()=>{btn.textContent=cur()==="dark"?"☀":"☾"};paint();
  btn.addEventListener("click",()=>{root.dataset.theme=cur()==="dark"?"light":"dark";store.set("theme",root.dataset.theme);paint()})})();
window.CloudLab={get W(){return W},LESSONS,API,UI,check,skip,startLesson,render,evalIam,anonCan,trace0};
