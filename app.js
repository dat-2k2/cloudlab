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

function emptyWorld(){return{spend:0,budgets:[],topics:[],mail:[],roles:[],policies:{},buckets:[],links:[],identity:"sso",flags:{}}}
function log(kind,svc,op,msg,tone,cli){LOG.unshift({id:LOG.length+1,t:now(),kind,svc,op,msg,tone:tone||"",cli:cli||""});UI.logSel=LOG[0].id}
function mutate(fn){UNDO.push(clone(W));if(UNDO.length>50)UNDO.shift();fn();UI.dirty=true}

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
  simulate(principal,action,key){const b=W.buckets[0];const res=action==="s3:ListBucket"?bArn(b.name):bArn(b.name,key);const e=evalIam(W,principal,action,res);
    log("Thử","iam","SimulatePrincipalPolicy",`${action} → ${e.allow?"allowed":e.kind==="explicit"?"explicitDeny":"implicitDeny"} (${e.by})`,e.allow?"ok":"bad",
      principal==="sso"?"":`aws iam simulate-principal-policy \\\n  --policy-source-arn ${roleArn(principal.slice(5))} \\\n  --action-names ${action} \\\n  --resource-arns ${res}`);UI.simResult=e;},
  /* S3 data plane as the current identity */
  s3(action,bucket,key){const res=action==="s3:ListBucket"?bArn(bucket):bArn(bucket,key);const e=evalIam(W,W.identity,action,res);
    const cliMap={"s3:ListBucket":`aws s3 ls s3://${bucket}/`,"s3:GetObject":`aws s3 cp s3://${bucket}/${key} .`,"s3:PutObject":`aws s3 cp ${key} s3://${bucket}/${key}`,"s3:DeleteObject":`aws s3 rm s3://${bucket}/${key}`};
    const op={"s3:ListBucket":"ListObjectsV2","s3:GetObject":"GetObject","s3:PutObject":"PutObject","s3:DeleteObject":"DeleteObject"}[action];
    if(!e.allow){log("API","s3",op,"403 · "+denyText(W,action,res,e),"bad",cliMap[action]);return false}
    if(action==="s3:PutObject"){mutate(()=>{const bb=W.buckets.find(x=>x.name===bucket);if(!bb.objects.some(o=>o.key===key))bb.objects.push({key,size:"1 KB"})})}
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

/* ================= lessons ================= */
const SEED={
  guard(w){w.topics.push({name:"billing-alerts",subs:[{id:"sub-seed",protocol:"email",endpoint:EMAIL,status:"Confirmed"}],published:0});
    w.budgets.push({name:"monthly-20usd",limit:20,thresholds:[50,80,100],topic:"billing-alerts",fired:[]})},
};
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
  goal:"Khi chi tiêu vượt 50%, 80% và 100% của $20, email cảnh báo về tới hộp thư.",
  concepts:["AWS Budgets","SNS topic","subscription","xác nhận email","ngưỡng cảnh báo"],
  pages:["arch","budgets","billing","sns","mail"],
  setup(){return emptyWorld()},
  tasks:[
    {t:"Có budget $20 mỗi tháng",c:"budget có BudgetLimit = 20 USD, TimeUnit = MONTHLY",test:w=>w.budgets.some(b=>b.limit===20)},
    {t:"Email cảnh báo 50% về tới hộp thư",c:"mô phỏng chi tiêu 55%: budget → SNS → email đã xác nhận",test:w=>trace0(w,55).stop===null},
    {t:"Cảnh báo cả ở 80% và 100%",c:"budget có ngưỡng 80% và 100%, cùng đường gửi như trên",test:w=>{const b=w.budgets.find(x=>x.limit===20);return!!b&&b.thresholds.includes(80)&&b.thresholds.includes(100)&&trace0(w,105).stop===null}},
  ],
  diagnose(w,n){const tr=trace0(w,55);
    if(!w.budgets.some(b=>b.limit===20))return["Chưa có budget $20 nào.","Mở Budgets để tạo.","Budgets → Tạo budget, số tiền 20."][Math.min(n,2)];
    if(tr.stop){return[ "Hộp thư vẫn trống dù chi tiêu đã vượt 50%. Bấm “Thử” để tự xem.",`Cảnh báo dừng ở ${NODE_NAME[tr.stop]}. Nhìn node đó trên sơ đồ.`,`Cảnh báo dừng ở ${NODE_NAME[tr.stop]}: ${tr.why}`][Math.min(n,2)]}
    return["Ngưỡng 50% đã chạy, nhưng 80% hoặc 100% thì chưa.","Xem lại các ngưỡng của budget.","Budget phải bật cả ngưỡng 80% và 100%."][Math.min(n,2)]},
  hints(w){const s=(trace0(w,55).stop)||(trace0(w,105).stop)||"budget";return({
    spend:["Budget là thứ theo dõi chi tiêu. Chưa có budget thì không ai báo cả.","Budgets → Tạo budget: $20/tháng, bật ngưỡng 50/80/100%, gửi tới SNS topic."],
    budget:["Budget chỉ báo khi chi tiêu vượt một ngưỡng và có nơi để gửi.","Sửa budget: bật đủ ngưỡng 50/80/100% và chọn SNS topic để gửi."],
    topic:["SNS topic chỉ là trạm phát. Phải có người đăng ký (subscription) thì mới có người nhận.",`SNS → topic → Thêm subscription email ${EMAIL}.`],
    sub:["SNS không gửi gì tới email chưa xác nhận, để không spam người lạ.","Mở Hộp thư mô phỏng, mở thư “Subscription Confirmation” và bấm Confirm subscription."]})[s]},
  solve(){if(!W.topics.some(t=>t.name==="billing-alerts"))API.createTopic("billing-alerts");
    const t=W.topics.find(x=>x.name==="billing-alerts");if(!t.subs.some(s=>s.endpoint===EMAIL))API.subscribe("billing-alerts",EMAIL);
    const m=W.mail.find(x=>x.kind==="confirm"&&x.topic==="billing-alerts");if(m)API.confirm(m.id);
    const b=W.budgets.find(x=>x.limit===20);UI.editBudget=b&&b.name;API.saveBudget({name:b?b.name:"monthly-20usd",limit:20,t50:1,t80:1,t100:1,topic:"billing-alerts"},!b)},
  pass:"Budget theo dõi chi tiêu, SNS topic phát cảnh báo, và chỉ những email đã xác nhận mới nhận được. Xác nhận là cách AWS chống gửi thư rác tới người không đăng ký.",
  tries:[["Thử: chi tiêu 55%",()=>API.spendTo(55)],["85%",()=>API.spendTo(85)],["105%",()=>API.spendTo(105)],["Sang tháng mới",()=>API.newMonth()]],
},
{ id:"iam",step:1,title:"AccessDenied không còn ngẫu nhiên",tag:"IAM + STS",
  who:["L","Lan · data"],
  scenario:"Anh Minh tạo sẵn role lab-readonly-s3 để mình đọc dữ liệu mà không ghi nhầm. Mình assume role rồi mà đọc report.csv vẫn báo AccessDenied. Bạn xem giúp?",
  goal:"Dùng role lab-readonly-s3 thì đọc được dữ liệu, nhưng vẫn không ghi hoặc xóa được gì.",
  concepts:["IAM role","trust policy","STS AssumeRole","explicit deny","least privilege","policy simulator"],
  pages:["arch","budgets","billing","sns","mail","iam","sim","s3"],
  setup(){const w=emptyWorld();SEED.guard(w);const b="lab-data-"+ACCT;
    w.buckets.push({name:b,bpa:true,policy:[],objects:[{key:"report.csv",size:"18 KB"},{key:"scan-001.png",size:"240 KB"}]});
    w.policies["lab-s3-read"]={statements:[{sid:"ListLabData",effect:"Allow",actions:["s3:ListBucket"],resources:[bArn(b)]},{sid:"ReadObjects",effect:"Allow",actions:["s3:GetObject"],resources:[bArn(b,"*")]}]};
    w.policies["lab-guardrail"]={statements:[{sid:"NoObjectChanges",effect:"Deny",actions:["s3:*Object"],resources:[bArn(b,"*")]}]};
    w.roles.push({name:"lab-readonly-s3",trust:"sso",policies:["lab-s3-read","lab-guardrail"]});return w},
  tasks:[
    {t:"Đăng nhập được bằng role lab-readonly-s3",c:"sts:AssumeRole thành công ít nhất một lần",test:w=>!!w.flags.assumed},
    {t:"Dùng role thì đọc được report.csv",c:"s3:GetObject trên report.csv được Allow với role",test:w=>evalIam(w,"role:lab-readonly-s3","s3:GetObject",bArn("lab-data-"+ACCT,"report.csv")).allow},
    {t:"Dùng role thì vẫn không ghi, không xóa được",c:"s3:PutObject và s3:DeleteObject đều bị Deny",test:w=>["s3:PutObject","s3:DeleteObject"].every(a=>!evalIam(w,"role:lab-readonly-s3",a,bArn("lab-data-"+ACCT,"x.txt")).allow)},
  ],
  diagnose(w,n){const b="lab-data-"+ACCT,g=evalIam(w,"role:lab-readonly-s3","s3:GetObject",bArn(b,"report.csv"));
    if(!w.flags.assumed)return["Bạn chưa thử dùng role lab-readonly-s3.","Mở IAM → Roles và Assume role.","IAM → lab-readonly-s3 → Assume role, rồi thử đọc file trong S3."][Math.min(n,2)];
    if(!g.allow)return["Dùng role thì đọc report.csv vẫn bị AccessDenied.","Quyết định nằm trong các policy gắn vào role. Thử Policy simulator với s3:GetObject.",`s3:GetObject bị chặn bởi ${g.by} (${g.kind==="explicit"?"explicit deny":"không có Allow"}).`][Math.min(n,2)];
    return["Role đang mở quá rộng: ghi hoặc xóa được.","Kiểm tra lại statement Deny.","Deny phải vẫn chặn s3:PutObject và s3:DeleteObject."][Math.min(n,2)]},
  hints(){return["Explicit Deny luôn thắng Allow, kể cả khi Allow nằm ở policy khác. Policy simulator sẽ chỉ ra statement nào quyết định.","lab-guardrail chặn s3:*Object, tức là chặn cả GetObject. Sửa Action thành s3:PutObject, s3:DeleteObject để chỉ chặn ghi và xóa."]},
  solve(){API.editStatement("lab-guardrail",0,{effect:"Deny",actions:"s3:PutObject, s3:DeleteObject",resources:bArn("lab-data-"+ACCT,"*")});
    if(W.identity==="sso")API.assumeRole("lab-readonly-s3");API.s3("s3:GetObject","lab-data-"+ACCT,"report.csv")},
  pass:"Mỗi request đi qua thứ tự: có Deny nào khớp thì chặn ngay; không có thì cần ít nhất một Allow; không có Allow thì bị chặn ngầm định. Wildcard như s3:*Object rất dễ chặn nhiều hơn bạn định.",
  tries:[["Thử: đọc report.csv",()=>API.s3("s3:GetObject","lab-data-"+ACCT,"report.csv")],["Thử: ghi notes.txt",()=>API.s3("s3:PutObject","lab-data-"+ACCT,"notes.txt")]],
},
{ id:"s3",step:2,title:"Chia sẻ file mà không public bucket",tag:"S3",
  who:["L","Lan · kế toán"],
  scenario:"Mình cần file invoice-0925.pdf. Hôm trước có người mở public cả bucket lab-share để gửi nhanh. Làm sao để mình vẫn tải được mà người ngoài thì không?",
  goal:"Chỉ người có link mới tải được invoice-0925.pdf, link tự hết hạn, và không ai ngoài đọc được gì trong bucket.",
  concepts:["S3 bucket","bucket policy","Principal \"*\"","Block Public Access","presigned URL"],
  pages:["arch","budgets","billing","sns","mail","iam","sim","s3"],
  setup(){const w=emptyWorld();SEED.guard(w);const b="lab-share-"+ACCT;
    w.buckets.push({name:b,bpa:false,policy:[{sid:"PublicRead",effect:"Allow",principal:"*",actions:["s3:GetObject"],resources:[bArn(b,"*")]}],objects:[{key:"invoice-0925.pdf",size:"96 KB"},{key:"internal-notes.txt",size:"4 KB"}]});return w},
  tasks:[
    {t:"Người ngoài không đọc được gì trong bucket",c:"GET ẩn danh tới mọi object đều 403",test:w=>w.buckets[0].objects.every(o=>!anonCan(w,w.buckets[0].name,o.key).allow)},
    {t:"Lan tải được invoice bằng link có hạn",c:"có presigned URL cho invoice-0925.pdf, hạn ≤ 7 ngày",test:w=>!!linkValid(w,"invoice-0925.pdf")},
    {t:"Block Public Access đang bật",c:"cả 4 tùy chọn Block Public Access = true",test:w=>w.buckets[0].bpa},
  ],
  diagnose(w,n){const b=w.buckets[0],leak=b.objects.some(o=>anonCan(w,b.name,o.key).allow);
    if(leak)return["Người lạ vẫn mở được file bằng URL thường. Bấm “Thử: người lạ mở file”.","Quyền đọc công khai đến từ bucket, mục Permissions.","Bucket policy PublicRead cho Principal \"*\", và Block Public Access đang tắt."][Math.min(n,2)];
    if(!linkValid(w,"invoice-0925.pdf"))return["Đã chặn người ngoài, nhưng Lan chưa có cách nào để tải file.","Lan cần một link có hạn cho đúng file đó.","S3 → bucket → invoice-0925.pdf → Tạo presigned URL."][Math.min(n,2)];
    return["Block Public Access vẫn đang tắt.","Bật nó để lần sau không ai lỡ tay public lại.","S3 → bucket → Permissions → Block Public Access: bật."][Math.min(n,2)]},
  hints(){return["Bucket policy với Principal \"*\" nghĩa là bất kỳ ai trên Internet. Muốn chia sẻ có kiểm soát thì dùng presigned URL thay vì public.","Bật Block Public Access, xóa statement PublicRead, rồi tạo presigned URL cho invoice-0925.pdf (ví dụ 60 phút)."]},
  solve(){const b=W.buckets[0].name;if(!W.buckets[0].bpa)API.setBpa(b,true);if(W.buckets[0].policy.some(s=>s.sid==="PublicRead"))API.deleteBucketStmt(b,"PublicRead");
    if(!linkValid(W,"invoice-0925.pdf"))API.presign(b,"invoice-0925.pdf",60)},
  pass:"Presigned URL mang theo quyền của người ký và hết hạn sau thời gian đặt, nên chia sẻ đúng một file cho đúng người mà bucket vẫn private. Block Public Access là chốt chặn ở cấp bucket để không ai lỡ tay public lại.",
  tries:[["Thử: người lạ mở file",()=>API.tryStranger()],["Thử: Lan mở link",()=>API.tryLan()]],
},
];
const LOCKED=[["Lambda","lambda",3],["DynamoDB","dynamodb",6],["API Gateway","apigw",7],["Step Functions","sfn",8]];

/* ================= lesson engine ================= */
function startLesson(i,quiet){
  UI.lesson=i;UI.attempt=0;UI.ladder=0;UI.lastCause=null;UI.result=null;UI.hints=0;UI.dirty=false;UI.flow=null;UI.mailOpen=null;UI.page="arch";UI.simResult=null;UI.bucket=null;
  W=LESSONS[i].setup();UNDO=[];store.set("lesson",i);
  if(!quiet)log("Bài học","lesson","setup",`Bài ${LESSONS[i].step}: ${LESSONS[i].title}`,"");
}
function check(){const L=LESSONS[UI.lesson];UI.attempt++;UI.dirty=false;
  const res=L.tasks.map(t=>!!t.test(W));const ok=res.every(Boolean);
  if(L.id==="guardrails")UI.flow=trace0(W,55);
  // feedback ladder (symptom → where → why) restarts whenever the cause of failure changes
  const cause=res.join()+"|"+(L.id==="guardrails"?trace0(W,55).stop:"")+"|"+(W.identity||"");
  UI.ladder=cause===UI.lastCause?(UI.ladder||0)+1:0;UI.lastCause=cause;
  UI.result={ok,res,msg:ok?L.pass:L.diagnose(W,UI.ladder)};
  log("Bài học","lesson","check",ok?`Đạt ${res.length}/${res.length}`:`Chưa đạt · lần ${UI.attempt} · ${res.filter(Boolean).length}/${res.length} nhiệm vụ`,ok?"ok":"bad");
  if(ok){DONE.add(L.id);store.set("done",[...DONE])}}
function skip(){const L=LESSONS[UI.lesson];log("Bài học","lesson","skip","Skip: CloudLab làm hộ từng bước, xem các dòng API bên dưới","warn");L.solve();UI.skipped=true;check();if(UI.result.ok){DONE.delete(L.id);store.set("done",[...DONE]);UI.result.msg="Đã làm hộ. Đọc lại các dòng API trong Event log để thấy từng bước. Bài tính là đã xem, chưa tính là đạt.";UI.result.skipped=true}}

/* ================= architecture views ================= */
function views(){const L=LESSONS[UI.lesson];
  if(L.id==="guardrails"){const b=W.budgets.find(x=>x.limit===20)||W.budgets[0],t=b&&W.topics.find(x=>x.name===b.topic)||W.topics[0],sub=t&&t.subs[0];
    const lim=b?b.limit:20,pct=Math.round(W.spend/lim*100),fl=UI.flow,inbox=W.mail.filter(m=>m.kind==="alert").length;
    const reached=k=>fl&&(fl.stop===null||["spend","budget","topic","sub","mail"].indexOf(k)<=["spend","budget","topic","sub","mail"].indexOf(fl.stop));
    const nodes=[
      {id:"spend",x:20,y:36,w:250,title:"Chi tiêu tháng này",chip:[pct+"%",pct>=50?"warn":""],page:"billing",big:`${money(W.spend)} / ${money(lim)}`,meter:Math.min(pct,100),note:"Chi phí giả do nút “Thử” tạo ra"},
      {id:"budget",x:310,y:36,w:250,title:b?b.name:"Chưa có budget",chip:["Budget",""],page:"budgets",border:b?"":"off",rows:b?[[ "Ngưỡng 50%",b.thresholds.includes(50)?(b.fired.includes(50)?"đã vượt":"chưa tới"):"tắt",b.thresholds.includes(50)?(b.fired.includes(50)?"warn":"none"):"bad"],["Ngưỡng 80%",b.thresholds.includes(80)?(b.fired.includes(80)?"đã vượt":"chưa tới"):"tắt",b.thresholds.includes(80)?(b.fired.includes(80)?"warn":"none"):"bad"],["Ngưỡng 100%",b.thresholds.includes(100)?(b.fired.includes(100)?"đã vượt":"chưa tới"):"tắt",b.thresholds.includes(100)?(b.fired.includes(100)?"warn":"none"):"bad"],["Gửi tới",b.topic||"chưa chọn",b.topic?"ok":"bad"]]:[["Tạo ở trang","Budgets","none"]]},
      {id:"topic",x:600,y:36,w:250,title:t?t.name:"Chưa có topic",chip:["SNS topic",""],page:"sns",border:t?"":"off",rows:t?[["Message đã nhận",String(t.published),t.published?"ok":"none"],["Subscription",String(t.subs.length),t.subs.length?"ok":"bad"],["Region",REGION,"ok"]]:[["Tạo ở trang","SNS","none"]]},
      {id:"sub",x:600,y:250,w:250,title:"Subscription",chip:[sub?(sub.status==="Confirmed"?"Confirmed":"Pending"):"Chưa có",sub?(sub.status==="Confirmed"?"ok":"warn"):""],page:"sns",border:sub?(sub.status==="Confirmed"?"":"warn"):"off",rows:sub?[["Endpoint",sub.endpoint,"ok"],["Protocol","email","ok"],["Trạng thái",sub.status,sub.status==="Confirmed"?"ok":"warn"]]:[["Thêm ở trang","SNS","none"]]},
      {id:"mail",x:200,y:250,w:250,title:"Hộp thư mô phỏng",chip:[inbox+" cảnh báo",inbox?"ok":""],page:"mail",rows:[["Thư cảnh báo",String(inbox),inbox?"ok":"none"],["Thư khác",String(W.mail.length-inbox),"none"]]}];
    const st=(from,to)=>!fl?"off":(reached(to)?"ok":(fl.stop===from?"stop":"off"));
    const edges=[{a:"spend",b:"budget",as:"r",bs:"l",s:st("spend","budget")},{a:"budget",b:"topic",as:"r",bs:"l",s:st("budget","topic"),label:"vượt ngưỡng → publish"},{a:"topic",b:"sub",as:"b",bs:"t",s:st("topic","sub")},{a:"sub",b:"mail",as:"l",bs:"r",s:st("sub","mail"),stopLabel:"không gửi được"}];
    return{nodes,edges,hint:fl?(fl.stop?`Lần thử gần nhất dừng ở ${NODE_NAME[fl.stop]}.`:"Lần thử gần nhất: cảnh báo đi tới hộp thư."):"Bấm “Thử” trên thanh công cụ để xem cảnh báo đi tới đâu."}}
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
    return{nodes,edges,hint:"Mỗi dòng trong khối S3 là kết quả đánh giá quyền của role. Xanh là đúng như mục tiêu, đỏ là chưa."}}
  /* s3 */
  const b=W.buckets[0],inv="invoice-0925.pdf",an=anonCan(W,b.name,inv),ln=linkValid(W,inv);
  const nodes=[
    {id:"stranger",x:20,y:36,w:230,title:"Người lạ",chip:["không đăng nhập",""],rows:[["Mở URL thường",an.allow?"đọc được":"403",an.allow?"bad":"ok"]]},
    {id:"lan",x:20,y:236,w:230,title:"Lan",chip:["kế toán",""],rows:[["Link có hạn",ln?`${ln.expires} phút`:"chưa có",ln?"ok":"none"]]},
    {id:"bucket",x:310,y:116,w:260,title:b.name.slice(0,24)+"…",chip:[b.bpa?"private":"PUBLIC",b.bpa&&!b.policy.some(s=>s.principal==="*")?"ok":"bad"],page:"s3",rows:[["Block Public Access",b.bpa?"bật":"tắt",b.bpa?"ok":"bad"],["Bucket policy",b.policy.length?b.policy.map(s=>s.sid).join(", "):"không có",b.policy.some(s=>s.principal==="*")?"bad":"ok"],["Object",String(b.objects.length),"ok"]]},
    {id:"obj",x:620,y:116,w:240,title:inv,chip:["object",""],page:"s3",rows:[["Người lạ đọc được",an.allow?"có · bị lộ":"không",an.allow?"bad":"ok"],["Lan đọc được",ln?"có":"chưa",ln?"ok":"none"]]}];
  const edges=[{a:"stranger",b:"bucket",as:"r",bs:"l",s:an.allow?"leak":"blocked",stopLabel:"bị chặn"},{a:"bucket",b:"obj",as:"r",bs:"l",s:an.allow?"leak":"ok"},{a:"lan",b:"obj",as:"r",bs:"b",s:ln?"ok":"off",label:ln?"presigned URL":"chưa có link"}];
  return{nodes,edges,hint:"Đường đỏ là dữ liệu đang bị lộ ra ngoài. Đường xanh là truy cập đúng người."}
}
function nodeH(n){return n.big?118:44+(n.rows?n.rows.length*20+10:0)}
function anchor(n,side){const h=nodeH(n);return side==="r"?[n.x+n.w,n.y+Math.min(40,h/2)]:side==="l"?[n.x,n.y+Math.min(40,h/2)]:side==="b"?[n.x+n.w/2,n.y+h]:[n.x+n.w/2,n.y]}
function svgView(){const v=views(),byId={};v.nodes.forEach(n=>byId[n.id]=n);
  const H=Math.max(...v.nodes.map(n=>n.y+nodeH(n)))+40,Wd=880;
  const col={ok:"var(--accent)",stop:"var(--bad)",off:"var(--line)",warn:"var(--warn)",leak:"var(--bad)",blocked:"var(--accent)"};
  let s=`<svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="Sơ đồ kiến trúc của bài học"><title>Sơ đồ kiến trúc</title>`;
  for(const e of v.edges){const A=byId[e.a],B=byId[e.b];let[x1,y1]=anchor(A,e.as),[x2,y2]=anchor(B,e.bs),d;
    if(e.as==="r"&&e.bs==="l"){const m=(x1+x2)/2;d=`M${x1} ${y1} H${m} V${y2} H${x2}`}
    else if(e.as==="l"&&e.bs==="r"){const m=(x1+x2)/2;d=`M${x1} ${y1} H${m} V${y2} H${x2}`}
    else if(e.as==="r"&&e.bs==="b"){d=`M${x1} ${y1} H${x2} V${y2}`}
    else{const m=(y1+y2)/2;d=`M${x1} ${y1} V${m} H${x2} V${y2}`}
    const c=col[e.s]||col.off,dash=e.s==="stop"||e.s==="off"?"5 4":e.thin?"3 3":"";
    if(e.s==="stop"||e.s==="blocked"){const mx=(x1+x2)/2,my=(y1+y2)/2,ex=e.s==="blocked"?x2-14:mx,ey=e.s==="blocked"?y2:my;
      s+=`<path d="M${x1} ${y1} ${e.s==="blocked"?`H${ex}`:`L${ex} ${ey}`}" stroke="${c}" stroke-width="1.8" fill="none" stroke-dasharray="${e.s==="stop"?"5 4":""}"/>`;
      s+=`<circle cx="${ex}" cy="${ey}" r="11" fill="${e.s==="blocked"?"var(--accent)":"var(--bad)"}"/><text x="${ex}" y="${ey+4}" text-anchor="middle" class="mk">✕</text>`;
      if(e.stopLabel)s+=`<text x="${ex}" y="${ey+28}" text-anchor="middle" class="el" style="fill:${e.s==="blocked"?"var(--accent)":"var(--bad)"}">${esc(e.stopLabel)}</text>`;continue}
    s+=`<path d="${d}" stroke="${c}" stroke-width="${e.thin?1.2:1.8}" fill="none"${dash?` stroke-dasharray="${dash}"`:""}/>`;
    if(e.s!=="off"&&!e.thin)s+=`<circle cx="${x2}" cy="${y2}" r="3.5" fill="${c}"/>`;
    if(e.label)s+=`<text x="${(x1+x2)/2}" y="${(e.as==="r"&&e.bs==="l")?Math.min(A.y,B.y)-10:Math.min(y1,y2)-8}" text-anchor="middle" class="el" style="fill:${e.s==="off"?"var(--muted)":c}">${esc(e.label)}</text>`}
  for(const n of v.nodes){const h=nodeH(n),bc=n.border==="off"?"var(--line)":n.border==="warn"?"var(--warn)":"var(--accent)";
    s+=`<g class="nd${n.page?" click":""}"${n.page?` data-go="${n.page}" tabindex="0" role="button" aria-label="Mở ${esc(n.title)}"`:""}><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${h}" rx="10" class="nodebox" style="stroke:${bc}"${n.border==="off"?' stroke-dasharray="5 4"':""}/>`;
    s+=`<text x="${n.x+12}" y="${n.y+24}" class="nt">${esc(n.title)}</text>`;
    if(n.chip&&n.chip[0]){const cw=n.chip[0].length*6.6+16,cx=n.x+n.w-12-cw,cls=n.chip[1]||"plain";s+=`<rect x="${cx}" y="${n.y+11}" width="${cw}" height="18" rx="9" class="cb ${cls}"/><text x="${cx+cw/2}" y="${n.y+24}" text-anchor="middle" class="ct ${cls}">${esc(n.chip[0])}</text>`}
    if(n.big){s+=`<text x="${n.x+12}" y="${n.y+60}" class="big">${esc(n.big)}</text><rect x="${n.x+12}" y="${n.y+74}" width="${n.w-24}" height="6" rx="3" class="mtr"/><rect x="${n.x+12}" y="${n.y+74}" width="${(n.w-24)*n.meter/100}" height="6" rx="3" style="fill:${n.meter>=50?"var(--warn)":"var(--accent)"}"/><text x="${n.x+12}" y="${n.y+102}" class="rl">${esc(n.note)}</text>`}
    if(n.rows){s+=`<line x1="${n.x+12}" x2="${n.x+n.w-12}" y1="${n.y+40}" y2="${n.y+40}" class="dv"/>`;
      n.rows.forEach((r,i)=>{const y=n.y+60+i*20,dc={ok:"var(--accent)",bad:"var(--bad)",warn:"var(--warn)"}[r[2]]||"var(--line)";
        s+=`<circle cx="${n.x+16}" cy="${y-4}" r="4" fill="${dc}"/><text x="${n.x+26}" y="${y}" class="rl">${esc(r[0])}</text><text x="${n.x+n.w-12}" y="${y}" text-anchor="end" class="rv ${r[2]}">${esc(r[1].length>26?r[1].slice(0,25)+"…":r[1])}</text>`})}
    s+=`</g>`}
  return s+"</svg>"+`<p class="arch-hint">${esc(v.hint)}</p>`}

/* ================= rendering ================= */
const PAGES={arch:["Sơ đồ bài học","Kiến trúc"],budgets:["Budgets","Chi phí"],billing:["Billing","Chi phí"],sns:["SNS","Thông báo"],mail:["Hộp thư mô phỏng","Thông báo"],iam:["IAM roles","Bảo mật"],sim:["Policy simulator","Bảo mật"],s3:["S3","Lưu trữ"]};
const unlocked=p=>LESSONS[UI.lesson].pages.includes(p);
function renderSide(){const groups=[["Bài học",["arch"]],["Chi phí",["budgets","billing"]],["Thông báo",["sns","mail"]],["Bảo mật",["iam","sim"]],["Lưu trữ",["s3"]]];
  const unread=W.mail.filter(m=>!m.read).length;
  let h=`<div class="brand"><div class="logo" aria-hidden="true">CL</div><div><b>CloudLab</b><small>Sandbox học AWS</small></div></div>
  <div class="proj"><small class="muted">Account sandbox</small><b class="mono">lab-account</b><small class="mono muted">${REGION} · Sydney</small></div>`;
  for(const[g,ps] of groups){h+=`<div class="ng">${g}</div>`;
    for(const p of ps){const lockStep=p==="iam"||p==="sim"||p==="s3"?1:0,isU=unlocked(p);
      const badge=p==="mail"&&unread?`<span class="chip bad">${unread}</span>`:p==="sns"&&W.topics.length?`<span class="chip">${W.topics.length}</span>`:"";
      h+=isU?`<button class="nav${UI.page===p?" on":""}" data-go="${p}"><span>${PAGES[p][0]}</span>${badge}</button>`:`<button class="nav locked" disabled title="Mở ở Bài ${lockStep}"><span>${PAGES[p][0]}</span><span class="chip">Bài ${lockStep}</span></button>`}}
  h+=`<div class="ng">Sắp có</div>`+LOCKED.map(([n,,s])=>`<button class="nav locked" disabled><span>${n}</span><span class="chip">Bài ${s}</span></button>`).join("");
  document.getElementById("side").innerHTML=h}
function renderTop(){const L=LESSONS[UI.lesson],p=PAGES[UI.page];
  const id=W.identity==="sso"?`<span class="idpill">Đang dùng: <b>SSO admin</b></span>`:`<span class="idpill on">Đang dùng role: <b>${esc(W.identity.slice(5))}</b> <button class="link" data-act="backToSso">Quay về SSO</button></span>`;
  document.getElementById("top").innerHTML=`<div class="crumb">${esc(p[1])} /<b>${esc(p[0])}</b></div>${L.id==="iam"||W.identity!=="sso"?id:""}
    <div class="tries" role="group" aria-label="Thử, không tính điểm">${L.tries.map((t,i)=>`<button data-try="${i}">${esc(t[0])}</button>`).join("")}</div>
    <button data-act="undo" ${UNDO.length?"":"disabled"} title="Hoàn tác thao tác gần nhất">↶ Undo</button><button data-act="askReset">Reset bài…</button>`}
function tbl(head,rows,empty){return rows.length?`<div class="tw"><table><thead><tr>${head.map(x=>`<th>${x}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`:`<div class="tw"><div class="empty">${empty}</div></div>`}
function renderPage(){const el=document.getElementById("page"),P=UI.page;let h="";
  if(P==="arch"){h=`<div class="ph"><h2>Sơ đồ bài học</h2><p>Bấm vào một khối để mở trang của nó. Sơ đồ cập nhật theo mọi thao tác của bạn.</p></div><div class="arch">${svgView()}</div>`}
  else if(P==="budgets"){h=`<div class="ph"><h2>Budgets</h2><button class="primary" data-act="newBudget">Tạo budget</button><p>Budget theo dõi chi tiêu và gửi cảnh báo khi vượt ngưỡng.</p></div>`+
    tbl(["Tên","Số tiền / tháng","Ngưỡng","Gửi tới","Đã vượt",""],W.budgets.map(b=>`<tr><td><b>${esc(b.name)}</b></td><td class="mono">${money(b.limit)}</td><td class="mono">${b.thresholds.map(x=>x+"%").join(", ")||"—"}</td><td class="mono">${esc(b.topic||"—")}</td><td class="mono">${b.fired.map(x=>x+"%").join(", ")||"—"}</td><td><div class="acts"><button class="sm" data-act="editBudget" data-arg="${esc(b.name)}">Sửa</button><button class="sm danger" data-act="delBudget" data-arg="${esc(b.name)}">Xóa</button></div></td></tr>`),"Chưa có budget nào. Bắt đầu bằng nút Tạo budget.")}
  else if(P==="billing"){const lim=(W.budgets[0]&&W.budgets[0].limit)||20;h=`<div class="ph"><h2>Billing</h2><p>Chi tiêu ở đây là giả lập. Dùng các nút “Thử” trên thanh công cụ để bơm chi phí, không tính điểm.</p></div>
    <div class="grid3"><div class="card q"><span class="muted">Chi tiêu tháng này</span><br><b>${money(W.spend)}</b><div class="bar"><i class="${W.spend/lim>=.5?"hi":""}" style="width:${Math.min(100,W.spend/lim*100)}%"></i></div></div>
    <div class="card q"><span class="muted">Free Tier</span><br><b>—</b><p class="note">Sandbox không tính Free Tier.</p></div></div>`}
  else if(P==="sns"){h=`<div class="ph"><h2>SNS topics</h2><button class="primary" data-act="newTopic">Tạo topic</button><p>Topic là trạm phát; subscription là người nhận. Email phải được xác nhận mới nhận tin.</p></div>`+
    (W.topics.length?W.topics.map(t=>`<div class="card sgc"><div class="ph" style="margin:0"><h2 style="font-size:1rem">${esc(t.name)}</h2><button class="sm" data-act="newSub" data-arg="${esc(t.name)}">Thêm subscription</button><button class="sm" data-act="pubTest" data-arg="${esc(t.name)}">Thử: gửi tin</button><button class="sm danger" data-act="delTopic" data-arg="${esc(t.name)}">Xóa topic</button><p class="mono">${esc(topicArn(t.name))}</p></div>`+
      tbl(["Protocol","Endpoint","Trạng thái",""],t.subs.map(s=>`<tr><td class="mono">email</td><td class="mono">${esc(s.endpoint)}</td><td><span class="chip ${s.status==="Confirmed"?"ok":"warn"}">${s.status}</span></td><td><button class="sm danger" data-act="unsub" data-arg="${esc(t.name)}|${s.id}">Hủy</button></td></tr>`),"Chưa có subscription.")+`</div>`).join(""):`<div class="tw"><div class="empty">Chưa có topic nào.</div></div>`)}
  else if(P==="mail"){const m=W.mail.find(x=>x.id===UI.mailOpen);
    h=`<div class="ph"><h2>Hộp thư mô phỏng</h2><p>Hộp thư của ${EMAIL}. Thư từ AWS trong sandbox về đây.</p></div><div class="mailbox"><ul class="mlist">${W.mail.length?W.mail.map(x=>`<li><button class="mitem${x.id===UI.mailOpen?" on":""}${x.read?"":" unread"}" data-act="openMail" data-arg="${x.id}"><b>${esc(x.subject)}</b><small>${esc(x.from)} · ${x.t}</small></button></li>`).join(""):`<li class="empty">Chưa có thư nào.</li>`}</ul>
      <div class="mread">${m?`<h3>${esc(m.subject)}</h3><p class="muted mono">Từ: ${esc(m.from)}<br>Tới: ${esc(m.to)}</p>`+(m.kind==="confirm"?`<p>You have chosen to subscribe to the topic:<br><span class="mono">${esc(topicArn(m.topic))}</span></p><p>To confirm this subscription, click the link below (if this was in error no action is necessary):</p><button class="primary" data-act="confirm" data-arg="${m.id}">Confirm subscription</button>`:`<p>${esc(m.body)}</p>`):`<p class="muted">Chọn một thư để đọc.</p>`}</div></div>`}
  else if(P==="iam"){h=`<div class="ph"><h2>IAM roles</h2><p>Role là danh tính tạm thời. Ai được dùng role do trust policy quyết định; role làm được gì do các policy gắn vào quyết định.</p></div>`+
    W.roles.map(r=>`<div class="card sgc"><div class="ph" style="margin:0"><h2 style="font-size:1rem">${esc(r.name)}</h2>${W.identity==="role:"+r.name?`<span class="chip ok">đang dùng</span>`:`<button class="primary sm" data-act="assume" data-arg="${esc(r.name)}">Assume role</button>`}<p class="mono">${esc(roleArn(r.name))} · trust: AccountFullAccessRole (SSO) của bạn</p></div>`+
      r.policies.map(pn=>`<h3 class="pt">${esc(pn)}</h3>`+tbl(["Sid","Effect","Action","Resource",""],(W.policies[pn]?W.policies[pn].statements:[]).map((s,i)=>`<tr><td class="mono">${esc(s.sid)}</td><td><span class="chip ${s.effect==="Allow"?"ok":"warn"}">${s.effect}</span></td><td class="mono">${esc(s.actions.join(", "))}</td><td class="mono">${esc(s.resources.join(", "))}</td><td><div class="acts"><button class="sm" data-act="editStmt" data-arg="${esc(pn)}|${i}">Sửa</button><button class="sm danger" data-act="delStmt" data-arg="${esc(pn)}|${i}">Xóa</button></div></td></tr>`),"Policy trống.")).join("")+`</div>`).join("")}
  else if(P==="sim"){const sm=UI.sim,r=UI.simResult,b=W.buckets[0];
    h=`<div class="ph"><h2>Policy simulator</h2><p>Hỏi IAM “principal này có được làm việc này không, và vì sao”, mà không cần làm thật. Không tính điểm.</p></div>
    <div class="card"><div class="frow"><label class="fld">Principal<select id="sim-p">${[["sso","SSO admin"],...W.roles.map(r=>["role:"+r.name,"role "+r.name])].map(([v,l])=>`<option value="${v}"${sm.principal===v?" selected":""}>${esc(l)}</option>`).join("")}</select></label>
      <label class="fld">Action<select id="sim-a">${["s3:ListBucket","s3:GetObject","s3:PutObject","s3:DeleteObject"].map(a=>`<option${sm.action===a?" selected":""}>${a}</option>`).join("")}</select></label>
      <label class="fld">Object<select id="sim-k">${(b?b.objects:[]).map(o=>`<option${sm.key===o.key?" selected":""}>${esc(o.key)}</option>`).join("")}</select></label></div>
      <div class="mfoot" style="justify-content:flex-start;margin-top:10px"><button class="primary" data-act="simulate">Chạy mô phỏng</button></div>
      ${r?`<div class="callout ${r.allow?"ok":""}" style="margin-top:12px"><b>${r.allow?"allowed":r.kind==="explicit"?"explicitDeny":"implicitDeny"}</b>Quyết định bởi: <span class="mono">${esc(r.by)}</span></div>`:""}</div>
    <p class="note" style="margin-top:12px">Thứ tự đánh giá: có Deny nào khớp thì chặn ngay → không thì cần một Allow → không có Allow thì chặn ngầm định.</p>`}
  else if(P==="s3"){const b=UI.bucket&&W.buckets.find(x=>x.name===UI.bucket)||W.buckets[0];
    if(!b){h=`<div class="ph"><h2>S3</h2></div><div class="tw"><div class="empty">Không có bucket trong bài này.</div></div>`}
    else{h=`<div class="ph"><h2>${esc(b.name)}</h2><span class="chip ${b.bpa?"ok":"bad"}">${b.bpa?"Block Public Access: bật":"Block Public Access: tắt"}</span><p>Region ${REGION}. Thao tác dưới đây chạy bằng danh tính hiện tại${W.identity==="sso"?" (SSO admin)":" (role "+esc(W.identity.slice(5))+")"}.</p></div>
      <h3 class="pt">Objects</h3>`+tbl(["Key","Kích thước",""],b.objects.map(o=>`<tr><td class="mono">${esc(o.key)}</td><td class="mono">${o.size}</td><td><div class="acts"><button class="sm" data-act="s3get" data-arg="${esc(o.key)}">Tải xuống</button>${LESSONS[UI.lesson].id==="s3"?`<button class="sm" data-act="presign" data-arg="${esc(o.key)}">Tạo presigned URL</button>`:""}<button class="sm danger" data-act="s3del" data-arg="${esc(o.key)}">Xóa</button></div></td></tr>`),"Bucket trống.")+
      `<div class="acts" style="margin-top:8px"><button class="sm" data-act="s3list">Liệt kê lại</button><button class="sm" data-act="s3put">Tải lên notes.txt</button></div>
      <h3 class="pt">Permissions</h3><div class="card"><div class="ph" style="margin:0"><h2 style="font-size:.95rem">Block Public Access</h2><button class="sm ${b.bpa?"":"primary"}" data-act="bpa" data-arg="${b.bpa?0:1}">${b.bpa?"Tắt":"Bật"}</button><p>Chốt chặn cấp bucket: khi bật, policy hay ACL public đều bị bỏ qua.</p></div></div>
      <h3 class="pt">Bucket policy</h3>`+tbl(["Sid","Effect","Principal","Action","Resource",""],b.policy.map(s=>`<tr><td class="mono">${esc(s.sid)}</td><td><span class="chip ${s.effect==="Allow"?"ok":"warn"}">${s.effect}</span></td><td class="mono">${s.principal==="*"?'"*" · bất kỳ ai':esc(s.principal)}</td><td class="mono">${esc(s.actions.join(", "))}</td><td class="mono">${esc(s.resources.join(", "))}</td><td><button class="sm danger" data-act="delBStmt" data-arg="${esc(s.sid)}">Xóa</button></td></tr>`),"Không có bucket policy.")+
      (W.links.length?`<h3 class="pt">Presigned URL đã tạo</h3>`+tbl(["Object","Hạn","URL",""],W.links.map(l=>`<tr><td class="mono">${esc(l.key)}</td><td class="mono">${l.expires} phút</td><td class="mono url">https://${esc(l.bucket)}.s3.${REGION}.amazonaws.com/${esc(l.key)}?X-Amz-Algorithm=AWS4-HMAC-SHA256&amp;X-Amz-Expires=${l.expires*60}&amp;X-Amz-Signature=…</td><td><button class="sm" data-act="revoke" data-arg="${l.id}">Bỏ</button></td></tr>`),""):"")}}
  el.innerHTML=h}
function renderLog(){const sel=LOG.find(l=>l.id===UI.logSel)||LOG[0];
  document.getElementById("log").innerHTML=`<div class="logl"><div class="logh"><span class="cap">Event log</span><span class="chip">${LOG.length}</span><span class="note">API = lệnh bạn chạy · Sự kiện = AWS tự làm · Thử = không tính điểm</span></div>
    <ul class="log">${LOG.map(l=>`<li class="${l.id===(sel&&sel.id)?"sel":""}" data-log="${l.id}" tabindex="0"><span class="t">${l.t}</span><span class="ev ${l.tone}"><span class="k k-${l.kind==="API"||l.kind==="CLI"?"api":l.kind==="Sự kiện"?"evt":l.kind==="Thử"?"try":"les"}">${l.kind}</span> ${esc(l.svc)} · ${esc(l.op)}</span><span class="m">${esc(l.msg)}</span></li>`).join("")}</ul></div>
    <div class="cli"><span class="cap">Lệnh aws CLI tương đương</span>${sel&&sel.cli?`<pre id="clitext">${esc(sel.cli)}</pre><div><button class="sm" data-act="copy">Copy lệnh</button></div>`:`<p class="note">Dòng này không có lệnh CLI tương đương.</p>`}</div>`}
function renderLesson(){const L=LESSONS[UI.lesson],R=UI.result,hs=L.hints(W);
  const mark=(i)=>{if(!R)return["","",String(i+1)];return R.res[i]?["pass","✓"]:["fail","✕"]};
  let h=`<div class="lh"><span class="cap">Track 1 · Bài ${L.step} / 10 · ${esc(L.tag)}</span><div class="ldots">${LESSONS.map((x,i)=>`<button class="ldot${DONE.has(x.id)?" done":""}${i===UI.lesson?" cur":""}" data-lesson="${i}" aria-label="Bài ${x.step}: ${esc(x.title)}${DONE.has(x.id)?" (đã đạt)":""}"><span>${x.step}</span></button>`).join("")}</div></div>
  <h1>${esc(L.title)}</h1>
  <div class="scn"><div class="who"><span class="av">${L.who[0]}</span>${esc(L.who[1])}</div>“${esc(L.scenario)}”</div>
  <div class="sect"><span class="lab">Mục tiêu</span><p>${esc(L.goal)}</p></div>
  <div class="sect"><span class="lab">Nhiệm vụ</span>${L.tasks.map((t,i)=>{const[c,g]=mark(i);return`<div class="task ${c}"><span class="tm2">${R?g:i+1}</span><div><b>${esc(t.t)}</b><small>${R&&R.res[i]?"Check: "+esc(t.c):"Điều kiện check hiện ra khi đạt"}</small></div></div>`}).join("")}
  ${R&&UI.dirty?`<p class="note">Bạn đã thay đổi sau lần Check trước. Bấm Check để chấm lại.</p>`:""}</div>`;
  if(R)h+=`<div class="callout ${R.ok?"ok":R.skipped?"info":""}"><b>${R.ok?`Đạt · ${R.res.length}/${R.res.length} nhiệm vụ`:R.skipped?"Đã làm hộ":`Chưa đạt · lần ${UI.attempt}`}</b>${esc(R.msg)}</div>`;
  if(UI.hints)h+=hs.slice(0,UI.hints).map((x,i)=>`<div class="callout warn"><b>Gợi ý ${i+1} / ${hs.length}</b>${esc(x)}</div>`).join("");
  if(R&&R.ok&&!R.skipped){const nx=UI.lesson+1<LESSONS.length;h+=`<div class="lacts">${nx?`<button class="primary" data-lesson="${UI.lesson+1}">Bài tiếp: ${esc(LESSONS[UI.lesson+1].tag)} →</button>`:`<button class="primary" disabled>Đã hết P0 · các bài sau sắp có</button>`}</div><p class="note">${UI.hints?`Bạn đã dùng ${UI.hints} gợi ý. Lần sau thử đọc sơ đồ và Event log trước khi mở gợi ý.`:"Không dùng gợi ý nào."}</p>`}
  else h+=`<div class="lacts"><button class="primary" data-act="check">Check</button><button data-act="hint" ${UI.hints>=hs.length?"disabled":""}>Gợi ý ${UI.hints}/${hs.length}</button><button data-act="askSkip">Skip</button></div><p class="note">Các nút “Thử” trên thanh công cụ không tính điểm, thử bao nhiêu lần cũng được. Chỉ Check mới được chấm.</p>`;
  h+=`<div class="sect"><span class="lab">Bài này dạy</span><div class="tags">${L.concepts.map(c=>`<span class="chip">${esc(c)}</span>`).join("")}</div></div>`;
  document.getElementById("lesson").innerHTML=h}
function renderModal(){const el=document.getElementById("modal"),M=UI.modal;if(!M){el.innerHTML="";return}
  const v=modalValues();const cli=M.cli?M.cli(v):"",note=M.note?M.note(v):"";
  el.innerHTML=`<div class="scrim" data-act="closeModal"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mt" data-stop="1"><h3 id="mt">${esc(M.title)}</h3>${M.body||""}
    ${(M.fields||[]).map(f=>f.type==="checks"?`<fieldset class="fld"><legend>${esc(f.label)}</legend><div class="acts">${f.items.map(([k,l])=>`<label class="ck"><input type="checkbox" id="f-${k}" ${M.init[k]?"checked":""}> ${esc(l)}</label>`).join("")}</div></fieldset>`
      :`<label class="fld">${esc(f.label)}${f.type==="select"?`<select id="f-${f.id}">${f.options.map(([o,l])=>`<option value="${esc(o)}"${String(M.init[f.id])===String(o)?" selected":""}>${esc(l)}</option>`).join("")}</select>`:`<input id="f-${f.id}" type="${f.type||"text"}" value="${esc(M.init[f.id]??"")}" autocomplete="off">`}${f.help?`<small>${esc(f.help)}</small>`:""}</label>`).join("")}
    <div id="mnote">${note}</div>${M.cli?`<div class="cli"><span class="cap">Lệnh sẽ chạy</span><pre id="mcli">${esc(cli)}</pre></div>`:""}<p class="ferr" id="merr" role="alert">${esc(M.err||"")}</p>
    <div class="mfoot"><button data-act="closeModal">${esc(M.cancel||"Hủy")}</button>${M.submitLabel?`<button class="primary ${M.danger?"dangerbtn":""}" data-act="submitModal">${esc(M.submitLabel)}</button>`:""}</div></div></div>`;
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
    note:v=>v.topic?"":`<div class="callout warn"><b>Chưa chọn nơi gửi</b>Budget vẫn theo dõi chi tiêu, nhưng vượt ngưỡng thì không ai được báo.</div>`,
    submit:v=>API.saveBudget(v,!b)};render()}
function stmtModal(pn,i){const s=W.policies[pn].statements[i];
  UI.modal={title:`Sửa statement ${s.sid} trong ${pn}`,submitLabel:"Lưu policy",init:{sid:s.sid,effect:s.effect,actions:s.actions.join(", "),resources:s.resources.join(", ")},
    fields:[{id:"sid",label:"Sid"},{id:"effect",label:"Effect",type:"select",options:[["Allow","Allow"],["Deny","Deny"]]},{id:"actions",label:"Action (ngăn cách bằng dấu phẩy)",help:"Dấu * khớp mọi ký tự, ví dụ s3:*Object khớp GetObject, PutObject, DeleteObject…"},{id:"resources",label:"Resource (ARN, ngăn cách bằng dấu phẩy)"}],
    note:v=>{const acts=v.actions.split(",").map(x=>x.trim()).filter(Boolean),hit=["s3:GetObject","s3:PutObject","s3:DeleteObject","s3:ListBucket"].filter(a=>matchAny(acts,a));return hit.length?`<p class="note">Statement này khớp: <span class="mono">${hit.join(", ")}</span></p>`:""},
    cli:()=>`aws iam put-role-policy \\\n  --role-name lab-readonly-s3 \\\n  --policy-name ${pn} \\\n  --policy-document file://${pn}.json`,
    submit:v=>API.editStatement(pn,i,v)};render()}
function presignModal(key){const b=W.buckets[0];
  UI.modal={title:`Tạo presigned URL cho ${key}`,submitLabel:"Tạo link",init:{min:60},fields:[{id:"min",label:"Hết hạn sau (phút)",type:"number",help:"Tối đa 10080 phút (7 ngày) với IAM credential."}],
    cli:v=>`aws s3 presign s3://${b.name}/${key} --expires-in ${Number(v.min||0)*60}`,
    note:()=>`<p class="note">Link mang theo quyền của người ký (${W.identity==="sso"?"SSO admin":esc(W.identity.slice(5))}). Ai có link đều mở được cho tới khi hết hạn, nên đặt hạn ngắn nhất đủ dùng.</p>`,
    submit:v=>API.presign(b.name,key,v.min)};render()}
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
    askReset(){confirmModal("Reset bài này?","Mọi thứ bạn đã tạo trong bài sẽ về trạng thái ban đầu. Event log vẫn giữ lại.","Reset bài",()=>{const i=UI.lesson;startLesson(i,true);log("Bài học","lesson","reset",`Bài ${LESSONS[i].step} về trạng thái ban đầu`,"warn")},true)},
    askSkip(){confirmModal("Skip bài này?","CloudLab sẽ làm hộ các bước còn lại và ghi từng lệnh vào Event log. Bài được tính là đã xem, không tính là đạt.","Làm hộ",()=>skip())},
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
    s3get(){API.s3("s3:GetObject",W.buckets[0].name,arg)},s3del(){API.s3("s3:DeleteObject",W.buckets[0].name,arg)},s3put(){API.s3("s3:PutObject",W.buckets[0].name,"notes.txt")},s3list(){API.s3("s3:ListBucket",W.buckets[0].name)},
    bpa(){API.setBpa(W.buckets[0].name,arg==="1")},delBStmt(){API.deleteBucketStmt(W.buckets[0].name,arg)},presign(){presignModal(arg)},revoke(){API.revoke(arg)},
    copy(){const txt=(document.getElementById("clitext")||{}).textContent||"";try{navigator.clipboard.writeText(txt).then(()=>{t.textContent="Đã copy"},()=>selectCli())}catch(_){selectCli()}return true},
    submitModal(){const M=UI.modal,v=modalValues(),r=M.submit(v);if(r&&r.ok===false){M.init=v;M.err=r.err;render();return true}UI.modal=null},
  };
  if(A[a]){const keep=A[a]();if(keep!==true)render()}
});
function selectCli(){const p=document.getElementById("clitext");if(!p)return;const r=document.createRange();r.selectNodeContents(p);const s=getSelection();s.removeAllRanges();s.addRange(r)}
document.addEventListener("input",e=>{if(e.target.closest(".modal"))refreshModalPreview()});
document.addEventListener("change",e=>{if(e.target.closest(".modal"))refreshModalPreview()});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&UI.modal){UI.modal=null;render();return}
  const g=e.target.closest&&e.target.closest("[data-go][role=button],[data-log]");
  if(g&&(e.key==="Enter"||e.key===" ")){e.preventDefault();g.click()}});

/* ================= boot ================= */
startLesson(Math.min(store.get("lesson",0),LESSONS.length-1),false);render();
window.CloudLab={get W(){return W},LESSONS,API,UI,check,skip,startLesson,render,evalIam,anonCan,trace0};
