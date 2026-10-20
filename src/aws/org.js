"use strict";
/* Multi-account: AWS Organizations + Control Tower, for the brownfield landing-zone lessons
   (moved here from the old landing-zone-sim page).

   What is modelled:
   - Organization (FeatureSet), OUs drawn as boxes, member accounts placed in an OU, SCPs attached to OUs.
   - The existing state of each account lives in Metadata.CloudLab, because it was not created by this template:
     ExecutionRole (AWSControlTowerExecution present), LegacyConfigRecorder, LegacyTrail, Origin.
   - AWS::ControlTower::LandingZone, AWS::ControlTower::EnabledBaseline (= register an OU) and
     AWS::ControlTower::EnabledControl. Both of the latter are drawn as edges from the landing zone to the OU.
   - Enrollment is worked out from the template: an account in a registered OU is enrolled when the
     prechecks pass (execution role, no old Config recorder, no SCP that blocks config:*), and fails otherwise.
   Simplified: no nested OUs, no Account Factory, re-enrolling is automatic once a blocker is fixed. */

const CT_REGION="ap-southeast-2";
const CT_BASELINE=`arn:aws:controltower:${CT_REGION}::baseline/17BSJV3IGJ2QSGA2`;
const ctControl=name=>`arn:aws:controltower:${CT_REGION}::control/${name}`;
/* reference prices: AWS Config $0.003 per configuration item, CloudTrail $2.00 per 100,000 management events
   for each copy after the first. Per-account volumes are rough assumptions. */
const ORG_PRICE={configItem:0.003,itemsMo:1000,trailCopy:2/100000,eventsMo:200000};
const CONTROLS=[["AWS-GR_RESTRICT_ROOT_USER","Không cho dùng root user (preventive)"],["AWS-GR_REGION_DENY","Chặn region ngoài danh sách được phép (preventive)"],
  ["AWS-GR_AUDIT_BUCKET_PUBLIC_READ_PROHIBITED","Phát hiện bucket log đọc công khai (detective)"],["AWS-GR_ENCRYPTED_VOLUMES","Phát hiện EBS volume không mã hóa (detective)"]];

/* edge-type resources (EnabledBaseline, EnabledControl) are not in allNodes(), so read the template directly */
const orgNodes=t=>Object.keys({...M.res,...M.manual}).map(nodeOf).filter(n=>n&&n.type===t);
const meta=(n,k,d)=>{const v=getP(n.raw,"Metadata.CloudLab."+k);return v===undefined?d:v};
function lzNode(){return orgNodes("AWS::ControlTower::LandingZone")[0]||null}
function orgNode(){return orgNodes("AWS::Organizations::Organization")[0]||null}
function parentOu(n){return refId(arr(n.props.ParentIds)[0])}
function ouName(id){const o=nodeOf(id);return o?(o.props.Name||id):id}

/* state of the landing zone: none | failed | drift | ready */
function lzState(){const lz=lzNode();if(!lz)return{st:"none",why:"Chưa có landing zone"};
  if(!exists(lz.id))return{st:"none",why:"Landing zone chưa được deploy"};
  const org=orgNode();if(!org||org.props.FeatureSet!=="ALL")return{st:"failed",why:"Setup lỗi: organization chưa bật All features"};
  const la=refId(getP(lz.props,"Manifest.centralizedLogging.accountId")),au=refId(getP(lz.props,"Manifest.securityRoles.accountId"));
  if(!la||!nodeOf(la))return{st:"failed",why:"Setup lỗi: manifest chưa chỉ định account log archive"};
  if(!au||!nodeOf(au))return{st:"failed",why:"Setup lỗi: manifest chưa chỉ định account audit"};
  if(la===au)return{st:"failed",why:"Setup lỗi: log archive và audit phải là hai account khác nhau"};
  if(meta(lz,"Drift",false))return{st:"drift",la,au,why:"Drift: có người sửa tài nguyên Control Tower ngoài Control Tower. Register và enroll bị khóa tới khi repair."};
  return{st:"ready",la,au}}

/* SCPs attached to an OU (or to the root) that deny AWS Config: they stop Control Tower from placing its recorder */
function blockingScps(ou){const root=getP(orgNode()||{props:{}},"props")&&orgNode()?orgNode().id:null;
  return orgNodes("AWS::Organizations::Policy").filter(p=>(p.props.Type||"SERVICE_CONTROL_POLICY")==="SERVICE_CONTROL_POLICY"&&arr(p.props.TargetIds).some(t=>{const r=refId(t);return r===ou||(root&&r===root)})&&
    arr(getP(p.props,"Content.Statement")).some(s=>s.Effect==="Deny"&&matchAny(s.Action,"config:PutConfigurationRecorder")))}
const baselineOf=ou=>orgNodes("AWS::ControlTower::EnabledBaseline").find(b=>refId(b.props.TargetIdentifier)===ou&&exists(b.id))||null;
const controlsOf=ou=>orgNodes("AWS::ControlTower::EnabledControl").filter(c=>refId(c.props.TargetIdentifier)===ou&&exists(c.id));
function ouRegistered(ou){const s=lzState();if(s.st!=="ready"&&s.st!=="drift")return false;if(baselineOf(ou))return true;
  /* the OU holding log archive and audit is the landing zone's own Security OU */
  return[s.la,s.au].some(a=>a&&parentOu(nodeOf(a))===ou)}

/* why an account would fail Control Tower's enrollment prechecks */
function acctBlockers(n){const r=[],ou=parentOu(n);
  if(meta(n,"ExecutionRole",true)===false)r.push({k:"role",t:"Thiếu role AWSControlTowerExecution",fix:"Tạo role AWSControlTowerExecution trong account (account được mời vào org thường chưa có)."});
  if(meta(n,"LegacyConfigRecorder",false)===true)r.push({k:"config",t:"Còn Config recorder cũ",fix:"Mỗi region chỉ có một recorder. Xóa recorder và delivery channel cũ để Control Tower đặt recorder của nó."});
  for(const p of blockingScps(ou))r.push({k:"scp",t:`SCP ${p.props.Name||p.id} chặn config:*`,fix:`SCP trên OU ${ouName(ou)} chặn cả role của Control Tower. Gỡ ${p.props.Name||p.id} khỏi OU (hoặc thêm ngoại lệ cho AWSControlTowerExecution).`});
  return r}
/* enrolled | failed | unmanaged | shared (log archive / audit) */
function acctState(n){const s=lzState();if((s.st==="ready"||s.st==="drift")&&(n.id===s.la||n.id===s.au))return{st:"enrolled",shared:n.id===s.la?"log archive":"audit",blockers:[]};
  const ou=parentOu(n),b=acctBlockers(n);if(!ou||!ouRegistered(ou))return{st:"unmanaged",blockers:b};
  return b.length?{st:"failed",blockers:b}:{st:"enrolled",blockers:[]}}
function orgCoverage(){const A=orgNodes("AWS::Organizations::Account");const e=A.filter(a=>acctState(a).st==="enrolled").length;return{enrolled:e,total:A.length}}
/* accounts whose own trail still runs next to the org trail: logs land in two places, and the second copy is billed */
const dualTrails=()=>orgNodes("AWS::Organizations::Account").filter(a=>meta(a,"LegacyTrail",false)===true&&acctState(a).st==="enrolled");

/* ---------------- component catalog ---------------- */
const ACC_META=[{k:"@Origin",label:"Nguồn gốc",type:"select",options:[["created","Tạo từ Organizations"],["invited","Được mời vào org"]]},
  {k:"@ExecutionRole",label:"Role AWSControlTowerExecution",type:"select",bool:true,options:[[true,"Có"],[false,"Thiếu"]],help:"Control Tower vào account qua role này để đặt baseline."},
  {k:"@LegacyConfigRecorder",label:"Config recorder cũ",type:"select",bool:true,options:[[false,"Không có"],[true,"Có (chặn enroll)"]]},
  {k:"@LegacyTrail",label:"CloudTrail riêng",type:"select",bool:true,options:[[false,"Không có"],[true,"Có (sau enroll sẽ ghi hai nơi)"]]}];
def("AWS::Organizations::Organization",{label:"Organization",short:"ORG",cat:"org",
  doc:"Gom nhiều AWS account dưới một management account. Control Tower chỉ dựng được landing zone khi organization bật All features (không phải chỉ consolidated billing).",
  defaults:()=>({FeatureSet:"ALL"}),name:()=>"o-7f3k2pq9xd",
  fields:[{k:"FeatureSet",label:"Feature set",type:"select",options:[["ALL","All features"],["CONSOLIDATED_BILLING","Chỉ consolidated billing"]]}],
  view(n,rows){const all=n.props.FeatureSet==="ALL",c=orgCoverage();rows.push(["Feature set",all?"All features":"Billing only",all?"ok":"bad"],["Account enrolled",`${c.enrolled}/${c.total}`,c.total&&c.enrolled===c.total?"ok":""]);return all?null:["bad","Billing only"]}});
def("AWS::Organizations::OrganizationalUnit",{label:"Organizational unit (OU)",short:"OU",cat:"org",container:"ou",
  doc:"Nhóm account trong organization. SCP và controls áp lên OU sẽ áp cho mọi account bên trong. Register OU với Control Tower thì mọi account trong đó được enroll.",
  defaults:id=>({Name:id,ParentId:orgNode()?{"Fn::GetAtt":[orgNode().id,"RootId"]}:null}),name:p=>p.Name,
  fields:[{k:"Name",label:"Tên OU",type:"text"},{k:"ParentId",label:"Thuộc organization",type:"ref",to:["AWS::Organizations::Organization"],att:"RootId"}],
  rel:{ParentId:{kind:"contains"}}});
def("AWS::Organizations::Account",{label:"AWS account",short:"ACC",cat:"org",
  doc:"Một AWS account thành viên. Trong bài brownfield, account đã tồn tại từ trước; những gì nó đang có (role, recorder, trail) nằm ở Metadata.CloudLab vì không do template này tạo.",
  defaults:id=>({AccountName:kebab(id),Email:`${kebab(id)}@example.com`,ParentIds:[]}),name:p=>p.AccountName,
  fields:[{k:"AccountName",label:"Tên account",type:"text"},{k:"Email",label:"Email root",type:"text"},...ACC_META],
  rel:{ParentIds:{kind:"contains"}},
  view(n,rows){const s=acctState(n),role=meta(n,"ExecutionRole",true)!==false,rec=meta(n,"LegacyConfigRecorder",false)===true,tr=meta(n,"LegacyTrail",false)===true,en=s.st==="enrolled";
    rows.push(["Execution role",role?"Có":"Thiếu",role?"ok":"bad"],["Config recorder",en?"Của Control Tower":rec?"Recorder cũ":"Chưa có",en?"ok":rec?"bad":""],
      ["CloudTrail",tr?(en?"Trail riêng + org trail":"Trail riêng"):en?"Chỉ org trail":"Không có",tr?"warn":en?"ok":""],["Baseline",en?"Đã đặt":s.st==="failed"?"Fail":"Chưa có",en?"ok":s.st==="failed"?"bad":""]);
    return s.shared?["ok",s.shared]:en?["ok","Enrolled"]:s.st==="failed"?["bad","Enroll fail"]:["","Unmanaged"]},
  tick(n,dt){const s=acctState(n);if(s.st==="enrolled"||meta(n,"LegacyConfigRecorder",false)===true)charge(n.id,ORG_PRICE.configItem*ORG_PRICE.itemsMo*dt/MONTH,"AWS Config");
    if(s.st==="enrolled"&&meta(n,"LegacyTrail",false)===true)charge(n.id,ORG_PRICE.trailCopy*ORG_PRICE.eventsMo*dt/MONTH,"trail trùng")}});
def("AWS::Organizations::Policy",{label:"Service control policy (SCP)",short:"SCP",cat:"org",
  doc:"Giới hạn quyền tối đa của mọi principal trong các account dưới OU, kể cả role của Control Tower. SCP không cấp quyền, chỉ chặn.",
  defaults:id=>({Name:id,Type:"SERVICE_CONTROL_POLICY",Content:{Version:"2012-10-17",Statement:[{Sid:"DenyLeaveOrg",Effect:"Deny",Action:"organizations:LeaveOrganization",Resource:"*"}]},TargetIds:[]}),name:p=>p.Name,
  fields:[{k:"Name",label:"Tên policy",type:"text"}],
  rel:{TargetIds:{kind:"applies",label:"áp lên"}},
  view(n,rows){const st=arr(getP(n.props,"Content.Statement")),deny=st.filter(s=>s.Effect==="Deny").flatMap(s=>arr(s.Action));
    rows.push(["Deny",deny.join(", ")||"—",""],["Áp lên",arr(n.props.TargetIds).map(refId).filter(Boolean).map(ouName).join(", ")||"chưa gắn",""]);
    const blocks=st.some(s=>s.Effect==="Deny"&&matchAny(s.Action,"config:PutConfigurationRecorder"));if(blocks&&arr(n.props.TargetIds).length)return["bad","Chặn baseline"];return null}});
def("AWS::ControlTower::LandingZone",{label:"Control Tower landing zone",short:"CT",cat:"org",
  doc:"Dựng governance cho cả organization: OU Security với account log archive và audit, org trail ghi log mọi account về log archive, Config aggregator, controls. Trên org có sẵn (brownfield), nó chỉ thêm mới, không sửa OU cũ cho tới khi bạn register.",
  defaults:()=>({Version:"3.3",Manifest:{governedRegions:[CT_REGION],organizationStructure:{security:{name:"Security"}},centralizedLogging:{accountId:null,enabled:true,configurations:{loggingBucket:{retentionDays:365},accessLoggingBucket:{retentionDays:3650}}},securityRoles:{accountId:null},accessManagement:{enabled:true}}}),
  name:()=>"landing-zone",
  fields:[{k:"Version",label:"Phiên bản",type:"select",options:["3.3","3.2"]},{k:"Manifest.centralizedLogging.accountId",label:"Account log archive",type:"ref",to:["AWS::Organizations::Account"],att:"AccountId"},
    {k:"Manifest.securityRoles.accountId",label:"Account audit",type:"ref",to:["AWS::Organizations::Account"],att:"AccountId"},
    {k:"@Drift",label:"Drift",type:"select",bool:true,options:[[false,"Không"],[true,"Có (ai đó sửa tay ngoài Control Tower)"]]}],
  rel:{"Manifest.centralizedLogging.accountId":{kind:"logs",label:"log archive"},"Manifest.securityRoles.accountId":{kind:"applies",label:"audit"}},
  view(n,rows){const s=lzState(),c=orgCoverage(),ous=orgNodes("AWS::Organizations::OrganizationalUnit"),reg=ous.filter(o=>baselineOf(o.id)).length;
    rows.push(["Trạng thái",{ready:"Đang chạy",drift:"Drift",failed:"Setup lỗi",none:"Chưa bật"}[s.st],s.st==="ready"?"ok":s.st==="none"?"":"bad"],["OU đã register",`${reg}/${ous.length}`,""],["Coverage",`${c.enrolled}/${c.total}`,c.total&&c.enrolled===c.total?"ok":""]);
    return s.st==="ready"?["ok","Landing zone"]:s.st==="drift"?["bad","Drift"]:s.st==="failed"?["bad","Setup lỗi"]:null}});
const lzEdge=(props,label)=>{const lz=lzNode(),to=refId(props.TargetIdentifier);return lz&&to?[{from:lz.id,to,kind:"governs",label:typeof label==="function"?label(props):label}]:[]};
def("AWS::ControlTower::EnabledBaseline",{label:"Register OU (baseline)",short:"REG",cat:"org",edge:true,
  doc:"Register một OU: Control Tower bật baseline AWSControlTowerBaseline trên OU và enroll từng account trong đó. Account không qua precheck thì fail riêng, account khác vẫn vào.",
  defaults:()=>({BaselineIdentifier:CT_BASELINE,BaselineVersion:"4.0",TargetIdentifier:null}),edgeOf:p=>lzEdge(p,"register")});
def("AWS::ControlTower::EnabledControl",{label:"Control",short:"CTL",cat:"org",edge:true,
  doc:"Một control (guardrail) bật trên OU. Detective chỉ báo vi phạm; preventive chặn hẳn bằng SCP. Bật preventive sau khi đã enroll xong và đo tác động của từng cái.",
  defaults:()=>({ControlIdentifier:ctControl(CONTROLS[0][0]),TargetIdentifier:null}),edgeOf:p=>lzEdge(p,q=>String(q.ControlIdentifier||"").split("/").pop().replace(/^AWS-GR_/,""))});
Object.assign(BASE_ID,{"AWS::Organizations::Organization":"Org","AWS::Organizations::OrganizationalUnit":"Ou","AWS::Organizations::Account":"Account","AWS::Organizations::Policy":"Scp",
  "AWS::ControlTower::LandingZone":"LandingZone","AWS::ControlTower::EnabledBaseline":"Register","AWS::ControlTower::EnabledControl":"Control"});
if(!GROUPS.some(g=>g[0]==="org"))GROUPS.splice(GROUPS.findIndex(g=>g[0]==="sec"),0,["org","Multi-account"]);
REL.governs={style:"role"};REL.contains=REL.contains||{style:"role"};

/* ---------------- connecting ---------------- */
function CONNECT_ORG(a,b,A,B,say){const ta=A.type,tb=B.type,R=x=>({Ref:x});
  if(ta==="AWS::Organizations::Account"&&tb==="AWS::Organizations::OrganizationalUnit")return say(`chuyển vào OU ${ouName(b)}`,()=>{A.props.ParentIds=[R(b)]});
  if(ta==="AWS::Organizations::OrganizationalUnit"&&tb==="AWS::Organizations::Organization")return say("thuộc root của organization",()=>{A.props.ParentId={"Fn::GetAtt":[b,"RootId"]}});
  if(ta==="AWS::Organizations::Policy"&&["AWS::Organizations::OrganizationalUnit","AWS::Organizations::Account","AWS::Organizations::Organization"].includes(tb))
    return say(`gắn SCP lên ${tb==="AWS::Organizations::Organization"?"root":b}`,()=>{const t=tb==="AWS::Organizations::Organization"?{"Fn::GetAtt":[b,"RootId"]}:R(b);A.props.TargetIds=[...arr(A.props.TargetIds).filter(x=>refId(x)!==b),t]});
  if(ta==="AWS::ControlTower::LandingZone"&&tb==="AWS::Organizations::OrganizationalUnit"){
    if(!orgNodes("AWS::ControlTower::EnabledBaseline").some(x=>refId(x.props.TargetIdentifier)===b))return say(`register OU ${ouName(b)} (enroll mọi account trong đó)`,()=>{M.res[freeId("Register"+b)]={Type:"AWS::ControlTower::EnabledBaseline",Properties:{BaselineIdentifier:CT_BASELINE,BaselineVersion:"4.0",TargetIdentifier:{"Fn::GetAtt":[b,"Arn"]}}}});
    const used=orgNodes("AWS::ControlTower::EnabledControl").filter(x=>refId(x.props.TargetIdentifier)===b).map(x=>String(x.props.ControlIdentifier).split("/").pop()),c=CONTROLS.find(x=>!used.includes(x[0]));
    if(c)return say(`bật control ${c[0].replace("AWS-GR_","")} trên OU ${ouName(b)}`,()=>{M.res[freeId("Control"+b)]={Type:"AWS::ControlTower::EnabledControl",Properties:{ControlIdentifier:ctControl(c[0]),TargetIdentifier:{"Fn::GetAtt":[b,"Arn"]}}}})}
  if(ta==="AWS::ControlTower::LandingZone"&&tb==="AWS::Organizations::Account"){const la=refId(getP(A.props,"Manifest.centralizedLogging.accountId"));const slot=!la||la===b?"centralizedLogging":"securityRoles";
    return say(slot==="centralizedLogging"?"làm account log archive":"làm account audit",()=>{setP(A.props,`Manifest.${slot}.accountId`,{"Fn::GetAtt":[b,"AccountId"]})})}
  return null}
Object.assign(WHY_X,{"AWS::Organizations::Account":"OU","AWS::Organizations::OrganizationalUnit":"organization","AWS::Organizations::Policy":"OU, account hoặc organization (root)",
  "AWS::ControlTower::LandingZone":"OU (register / control) hoặc account (log archive, audit)","AWS::Organizations::Organization":"(hãy nối OU tới organization)"});
function moveAcctTo(id,ou){const n=nodeOf(id);if(!n||n.type!=="AWS::Organizations::Account"||parentOu(n)===ou)return false;
  edit(`chuyển ${id} vào OU ${ouName(ou)}`,()=>{nodeOf(id).props.ParentIds=[{Ref:ou}]});log("CloudLab","organizations","MoveAccount",`${physName(n)} → OU ${ouName(ou)}`,"ok");return true}

/* ---------------- quick fixes shown in the inspector (same moves as the old simulator's buttons) ---------------- */
const ORG_ACTS={
  role(id){edit("tạo execution role",()=>{setP(M.res[id],"Metadata.CloudLab.ExecutionRole",true)});log("CLI","iam","CreateRole",`AWSControlTowerExecution trong ${physName(nodeOf(id))}`,"ok")},
  recorder(id){edit("xóa recorder cũ",()=>{setP(M.res[id],"Metadata.CloudLab.LegacyConfigRecorder",false)});log("CLI","config","DeleteConfigurationRecorder",`${physName(nodeOf(id))}: xóa recorder và delivery channel cũ`,"ok")},
  trail(id){edit("xóa trail riêng",()=>{setP(M.res[id],"Metadata.CloudLab.LegacyTrail",false)});log("CLI","cloudtrail","DeleteTrail",`${physName(nodeOf(id))}: chỉ còn org trail`,"ok")},
  detach(arg){const[pid,ou]=arg.split("|");edit("gỡ SCP",()=>{const p=M.res[pid];p.Properties.TargetIds=arr(p.Properties.TargetIds).filter(t=>refId(t)!==ou)});log("CLI","organizations","DetachPolicy",`${pid} khỏi OU ${ouName(ou)}`,"ok")},
  register(ou){const lz=lzNode();if(!lz)return;const r=connectRule(lz.id,ou);if(r)edit("register OU",()=>r.apply(true));log("CLI","controltower","EnableBaseline",`OU ${ouName(ou)}: enroll ${orgNodes("AWS::Organizations::Account").filter(a=>parentOu(a)===ou).length} account`,"ok")},
  drift(id){edit("gây drift",()=>{setP(M.res[id],"Metadata.CloudLab.Drift",true)});log("Sự kiện","controltower","DriftDetected","Ai đó gỡ SCP của Control Tower khỏi một OU bằng console. Register và enroll bị khóa.","bad")},
  repair(id){edit("repair landing zone",()=>{const m=M.res[id].Metadata;if(m&&m.CloudLab)delete m.CloudLab.Drift});log("CLI","controltower","ResetLandingZone","Khôi phục controls, hết drift","ok")}};
function orgActs(n){const b=(k,arg,label,cls)=>`<button class="sm${cls?" "+cls:""}" data-act="orgAct" data-arg="${k}:${esc(arg)}">${esc(label)}</button>`;let h="";
  if(n.type==="AWS::Organizations::Account"){const s=acctState(n);if(meta(n,"ExecutionRole",true)===false)h+=b("role",n.id,"Tạo execution role","primary");if(meta(n,"LegacyConfigRecorder",false))h+=b("recorder",n.id,"Xóa recorder cũ","primary");
    if(meta(n,"LegacyTrail",false)&&s.st==="enrolled")h+=b("trail",n.id,"Xóa trail riêng");for(const p of blockingScps(parentOu(n)))h+=b("detach",p.id+"|"+parentOu(n),`Gỡ SCP ${p.props.Name||p.id}`)}
  if(n.type==="AWS::Organizations::OrganizationalUnit"){if(lzNode()&&!ouRegistered(n.id)&&!orgNodes("AWS::ControlTower::EnabledBaseline").some(x=>refId(x.props.TargetIdentifier)===n.id))h+=b("register",n.id,"Register OU","primary");for(const p of blockingScps(n.id))h+=b("detach",p.id+"|"+n.id,`Gỡ SCP ${p.props.Name||p.id}`)}
  if(n.type==="AWS::ControlTower::LandingZone"&&exists(n.id))h+=meta(n,"Drift",false)?b("repair",n.id,"Repair landing zone","primary"):b("drift",n.id,"Sửa tay trong console (gây drift)");
  return h}
/* the inspector's "Đang chạy" block */
function orgRt(n){if(n.type==="AWS::Organizations::Account"){const s=acctState(n);
    if(s.st==="failed")return`<div class="callout bad"><b>Enroll fail: ${esc(s.blockers.map(x=>x.t).join(", "))}</b>${s.blockers.map(x=>esc(x.fix)).join(" ")}</div>`;
    if(s.st==="unmanaged")return`<div class="callout"><b>Chưa được Control Tower quản lý</b>${s.blockers.length?`Khi register OU sẽ fail vì: ${esc(s.blockers.map(x=>x.t).join(", "))}.`:"Precheck sạch. Register OU của nó để enroll."}</div>`;
    if(meta(n,"LegacyTrail",false))return`<div class="callout warn"><b>Đã enroll, log đang ghi hai nơi</b>Trail riêng và org trail cùng chạy (bước dual-write). Khi SIEM đã đọc từ org trail thì xóa trail riêng để hết phí trùng.</div>`;
    return`<div class="callout ok"><b>Đã được quản lý${s.shared?" · "+esc(s.shared):""}</b>Log của account về log archive qua org trail.</div>`}
  if(n.type==="AWS::ControlTower::LandingZone"){const s=lzState();return s.st==="ready"?`<div class="callout ok"><b>Landing zone đang chạy</b>OU cũ giữ nguyên tới khi register.</div>`:`<div class="callout ${s.st==="none"?"":"bad"}"><b>${esc({drift:"Drift",failed:"Setup lỗi",none:"Chưa bật"}[s.st])}</b>${esc(s.why||"")}</div>`}
  if(n.type==="AWS::Organizations::OrganizationalUnit"){const reg=ouRegistered(n.id),acc=orgNodes("AWS::Organizations::Account").filter(a=>parentOu(a)===n.id),f=acc.filter(a=>acctState(a).st==="failed");
    return`<div class="callout ${reg?(f.length?"bad":"ok"):""}"><b>${reg?`Đã register · ${acc.length-f.length}/${acc.length} account enrolled`:"Chưa register"}</b>${f.length?`Fail: ${esc(f.map(a=>physName(a)).join(", "))}.`:reg?"":"Register để enroll mọi account trong OU."}${controlsOf(n.id).length?` Controls: ${esc(controlsOf(n.id).map(c=>String(c.props.ControlIdentifier).split("/").pop()).join(", "))}.`:""}</div>`}
  return""}
/* Problems panel */
function orgProblems(P){const s=lzState(),lz=lzNode(),org=orgNode();
  if(lz&&org&&org.props.FeatureSet!=="ALL")P("error",org.id,"Organization đang chỉ bật consolidated billing: Control Tower cần All features");
  if(lz&&s.st==="failed")P("error",lz.id,s.why);if(lz&&s.st==="drift")P("error",lz.id,s.why);
  for(const a of orgNodes("AWS::Organizations::Account")){const st=acctState(a);
    if(st.st==="failed")P("error",a.id,`${physName(a)}: enroll fail · ${st.blockers.map(x=>x.t).join(", ")}`);
    else if(st.st==="unmanaged"&&st.blockers.length&&lz)P("warn",a.id,`${physName(a)}: sẽ fail khi register OU · ${st.blockers.map(x=>x.t).join(", ")}`);
    if(st.st==="enrolled"&&meta(a,"LegacyTrail",false))P("info",a.id,`${physName(a)}: trail riêng vẫn chạy cạnh org trail (log trùng, trả phí bản sao thứ hai)`);
    if(!parentOu(a))P("info",a.id,`${physName(a)}: đang ở root, chưa thuộc OU nào`)}
  for(const c of orgNodes("AWS::ControlTower::EnabledControl")){const ou=refId(c.props.TargetIdentifier);if(ou&&!baselineOf(ou))P("warn",c.id,`Control ${String(c.props.ControlIdentifier).split("/").pop()} trên OU chưa register`)}}
