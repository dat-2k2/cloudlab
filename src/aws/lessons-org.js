"use strict";
/* Landing zone track: brownfield Control Tower rollout, moved from the old landing-zone-sim page.
   Same org as before (o-7f3k2pq9xd, management 1111-2222-3333, OU Legacy + Workloads, four accounts), split into
   three lessons that follow the rollout phases: prepare → set up and enroll in waves → contract. */
const LZ_SRC=[["AWS Architecture Blog: Field Notes, enroll existing AWS accounts into AWS Control Tower","https://aws.amazon.com/blogs/architecture/field-notes-enroll-existing-aws-accounts-into-aws-control-tower"],
  ["AWS docs: Prerequisites for enrollment","https://docs.aws.amazon.com/controltower/latest/userguide/enrollment-prerequisites.html"],
  ["AWS docs: Guidance for creating and modifying AWS Control Tower resources","https://docs.aws.amazon.com/controltower/latest/userguide/getting-started-guidance.html"],
  ["AWS APN Blog: Seamless transition from AWS Landing Zone to AWS Control Tower","https://aws.amazon.com/blogs/apn/seamless-transition-from-an-aws-landing-zone-to-aws-control-tower"],
  ["HCLTech: AWS migration from landing zone to Control Tower and CloudOps","https://www.hcltech.com/case-study/aws-migration-from-landing-zone-to-control-tower-and-cloudops"],
  ["AWS Cloud Operations Blog: Migrating a custom landing zone with RAM to AWS Control Tower","https://aws.amazon.com/blogs/mt/migrating-custom-landing-zone-with-ram-to-aws-control-tower"],
  ["Scale Factory: When Control Tower drifts","https://scalefactory.com/blog/2025/04/30/when-control-tower-drifts"]];
const lzSrc=(...i)=>`<h4>Nguồn</h4><ul>${i.map(k=>`<li><a href="${LZ_SRC[k][1]}" target="_blank" rel="noopener">${esc(LZ_SRC[k][0])}</a></li>`).join("")}</ul>`;
const ACC=(id,name,ou,no,m)=>`  ${id}:
    Type: AWS::Organizations::Account
    Metadata:
      CloudLab: {AccountNo: "${no}"${m?", "+m:""}}
    Properties: {AccountName: ${name}, Email: ${name}@example.com, ParentIds: [!Ref ${ou}]}
`;
const OU=(id,name)=>`  ${id}:
    Type: AWS::Organizations::OrganizationalUnit
    Properties: {Name: ${name}, ParentId: !GetAtt Org.RootId}
`;
const SCP_DENY=`  DenyConfigChanges:
    Type: AWS::Organizations::Policy
    Properties:
      Name: DenyConfigChanges
      Type: SERVICE_CONTROL_POLICY
      TargetIds: [!Ref Legacy]
      Content:
        Version: "2012-10-17"
        Statement: [{Sid: DenyConfig, Effect: Deny, Action: "config:*", Resource: "*"}]
`;
const LZ_RES=(audit,drift)=>`  LandingZone:
    Type: AWS::ControlTower::LandingZone
${drift?`    Metadata:
      CloudLab: {Drift: true}
`:""}    Properties:
      Version: "3.3"
      Manifest:
        governedRegions: [ap-southeast-2]
        organizationStructure: {security: {name: Security}}
        centralizedLogging:
          accountId: !GetAtt LogArchive.AccountId
          enabled: true
          configurations: {loggingBucket: {retentionDays: 365}, accessLoggingBucket: {retentionDays: 3650}}
        securityRoles: {accountId: ${audit?"!GetAtt Audit.AccountId":"null"}}
        accessManagement: {enabled: true}
`;
const REG=(ou)=>`  Register${ou}:
    Type: AWS::ControlTower::EnabledBaseline
    Properties: {BaselineIdentifier: "${CT_BASELINE}", BaselineVersion: "4.0", TargetIdentifier: !GetAtt ${ou}.Arn}
`;
const LZ_LAYOUT={Org:[660,20],LandingZone:[1000,20],DenyConfigChanges:[20,300],LegacyBilling:[340,300],AcquiredStartup:[640,300],AppDev:[1000,300],AppProd:[1300,300],LogArchive:[660,600],Audit:[960,600]};
const accs=()=>orgNodes("AWS::Organizations::Account").filter(a=>!["LogArchive","Audit"].includes(a.id));
const enrolledIn=ou=>{const A=orgNodes("AWS::Organizations::Account").filter(a=>parentOu(a)===ou);return A.length>0&&A.every(a=>acctState(a).st==="enrolled")};
const LZ_EXPLAIN={Org:"Organization o-7f3k2pq9xd. Management account 1111-2222-3333 được dùng lại (đường in-place), org ID không đổi.",
  LegacyBilling:"legacy-billing: tạo từ Organizations, có execution role, nhưng còn Config recorder cũ.",AcquiredStartup:"acquired-startup: công ty mua lại, được mời vào org. Account mời vào thường không có role AWSControlTowerExecution, và còn trail riêng.",
  AppDev:"app-dev: sạch, đi đợt đầu được.",AppProd:"app-prod: còn recorder cũ và trail riêng. Prod đi sau non-prod.",DenyConfigChanges:"SCP cũ trên OU Legacy, chặn config:* để không ai tắt recorder. Nó chặn luôn cả role của Control Tower.",
  Legacy:"OU cũ. Landing zone không đụng tới cho tới khi bạn register.",Workloads:"OU cũ của các app.",Security:"OU do landing zone dùng cho account log archive và audit.",
  LogArchive:"log-archive: nhận org trail của mọi account đã enroll.",Audit:"audit: Config aggregator và quyền đọc cho đội security.",LandingZone:"Control Tower chạy trong management account. Mỗi đường register xuống OU nghĩa là OU đó đã được quản lý."};

const L_LZ1={id:"lz-prep",sub:"brownfield · chuẩn bị",tag:"Organizations + precheck",title:"Chuẩn bị org cũ trước khi bật Control Tower",who:["M","Minh · platform"],speed:1,
  ref:"Chuyển từ trang Brownfield rollout simulator cũ.",
  scenario:"Org đã chạy 3 năm, 4 account, chưa có governance chung. Sếp muốn bật Control Tower mà không làm gián đoạn app. Template này là bản inventory của org (bước Quét hiện trạng). Trước khi set up landing zone, phải dọn mọi thứ sẽ làm enroll fail.",
  goal:"Organization bật All features; không SCP nào chặn baseline; cả 4 account qua precheck.",
  concepts:["AWS Organizations","All features vs consolidated billing","SCP","AWSControlTowerExecution","Config recorder","inventory dạng code"],
  yaml:`Description: Brownfield org · inventory trước khi bật Control Tower
Resources:
  Org:
    Type: AWS::Organizations::Organization
    Properties: {FeatureSet: CONSOLIDATED_BILLING}
${OU("Legacy","Legacy")}${OU("Workloads","Workloads")}${SCP_DENY}${ACC("LegacyBilling","legacy-billing","Legacy","2046-1139-8821","LegacyConfigRecorder: true")}${ACC("AcquiredStartup","acquired-startup","Legacy","5590-1004-7312","Origin: invited, ExecutionRole: false, LegacyTrail: true")}${ACC("AppDev","app-dev","Workloads","7302-8411-5906")}${ACC("AppProd","app-prod","Workloads","4188-7362-0044","LegacyConfigRecorder: true, LegacyTrail: true")}`,
  layout:LZ_LAYOUT,explain:LZ_EXPLAIN,
  tasks:[
    {t:"Organization bật All features",c:"FeatureSet: ALL",test:()=>(orgNode()||{props:{}}).props.FeatureSet==="ALL"},
    {t:"Không SCP nào chặn baseline",c:"không OU nào có SCP deny config:*",test:()=>orgNodes("AWS::Organizations::OrganizationalUnit").every(o=>!blockingScps(o.id).length)},
    {t:"Cả 4 account qua precheck",c:"có execution role, không còn Config recorder cũ",test:()=>accs().every(a=>!acctBlockers(a).length)}],
  diagnose(n){if((orgNode()||{props:{}}).props.FeatureSet!=="ALL")return["Landing zone sẽ không set up được.","Xem khối Org.","Đổi FeatureSet sang All features. Account được mời phải chấp thuận handshake."][Math.min(n,2)];
    if(orgNodes("AWS::Organizations::OrganizationalUnit").some(o=>blockingScps(o.id).length))return["Mọi account trong OU Legacy sẽ fail khi register.","Có policy nào trên OU chặn AWS Config?","Gỡ DenyConfigChanges khỏi Legacy (nút Gỡ SCP trong khung chi tiết của OU, hoặc xóa mũi tên “áp lên”)."][Math.min(n,2)];
    const a=accs().find(x=>acctBlockers(x).length);if(!a)return["Gần xong.","Bấm Kiểm tra lại.","Bấm Kiểm tra lại."][Math.min(n,2)];return[`${physName(a)} vẫn sẽ fail precheck.`,"Mở tab Vấn đề hoặc chọn account để xem lý do.",acctBlockers(a)[0].fix][Math.min(n,2)]},
  hints:()=>["Enroll fail vì ba lý do: thiếu role AWSControlTowerExecution, Config recorder cũ (mỗi region chỉ một recorder), SCP chặn config:*. Org phải bật All features.","Org: All features. Gỡ DenyConfigChanges khỏi Legacy. acquired-startup: tạo execution role. legacy-billing và app-prod: xóa recorder cũ."],
  solve(){edit("prep",()=>{M.res.Org.Properties.FeatureSet="ALL";M.res.DenyConfigChanges.Properties.TargetIds=[];
    for(const a of accs()){const m=M.res[a.id].Metadata.CloudLab;m.ExecutionRole=true;m.LegacyConfigRecorder=false}})},
  pass:"Inventory trước, dọn phụ thuộc trước khi chuyển: giờ register OU nào cũng không còn ô đỏ. Trail riêng chưa cần xóa, nó còn là đường log duy nhất cho tới khi org trail chạy.",
  reading:{title:"nguyên tắc chuẩn bị và hai con đường",html:`<h4>Inventory trước mọi thứ</h4><p>Chụp lại account, OU, SCP, trail, Config recorder, RAM share và mọi policy dựa vào org ID. Lưu dạng code để diff trước và sau. Template của bài này chính là bản inventory đó.</p>
<h4>Quan sát trước, cưỡng chế sau</h4><p>Chạy detective controls (Config rules, conformance packs) để đo vi phạm. Enroll xong mới bật preventive controls, từng cái một, để thấy tác động của mỗi cái.</p>
<h4>Dọn phụ thuộc trước khi chuyển</h4><p>Gỡ những thứ làm enroll fail: Config recorder cũ, role thiếu, SCP chặn baseline. Với đường tạo org mới thì thêm RAM share và policy dựa vào org ID.</p>
<h4>Hai con đường brownfield</h4><table><tr><th></th><th>In-place</th><th>New org</th></tr><tr><td>Cách làm</td><td>Bật Control Tower trên org hiện tại</td><td>Dựng org mới rồi chuyển account sang</td></tr>
<tr><td>Org ID</td><td>Không đổi: RAM share, aws:PrincipalOrgID không vỡ</td><td>Đổi: share cấp org vỡ, policy dùng org ID phải sửa</td></tr><tr><td>Rủi ro</td><td>Thấp, nhanh hơn, nhưng mang theo nợ cũ</td><td>Sạch, thiết kế lại OU và SCP; RI/Savings Plans ở lại account đã mua, CUR cũ mất nếu không backup</td></tr></table>
<p>Bài này đi đường in-place.</p>${lzSrc(0,1)}`}};

const L_LZ2={id:"lz-enroll",sub:"brownfield · enroll theo đợt",tag:"Control Tower + register OU",title:"Set up landing zone, enroll theo đợt",who:["M","Minh · platform"],speed:1,
  scenario:"Org đã sạch phần lớn chướng ngại, landing zone đã khai báo nhưng setup lỗi. OU Workloads sẽ là đợt thí điểm, Legacy đi sau. Cẩn thận: inventory bỏ sót app-prod, và SCP cũ trên Legacy đã bị gắn lại.",
  goal:"Landing zone chạy; OU Workloads enroll 100% trước; rồi coverage 100% cả org.",
  concepts:["landing zone manifest","log archive / audit","register OU (EnableBaseline)","enroll","blast radius","đợt thí điểm"],
  yaml:`Description: Brownfield org · set up landing zone và register OU
Resources:
  Org:
    Type: AWS::Organizations::Organization
    Properties: {FeatureSet: ALL}
${OU("Legacy","Legacy")}${OU("Workloads","Workloads")}${OU("Security","Security")}${SCP_DENY}${ACC("LegacyBilling","legacy-billing","Legacy","2046-1139-8821")}${ACC("AcquiredStartup","acquired-startup","Legacy","5590-1004-7312","Origin: invited, LegacyTrail: true")}${ACC("AppDev","app-dev","Workloads","7302-8411-5906")}${ACC("AppProd","app-prod","Workloads","4188-7362-0044","LegacyConfigRecorder: true, LegacyTrail: true")}${ACC("LogArchive","log-archive","Security","8621-3550-7719")}${ACC("Audit","audit","Security","3477-9021-8843")}${LZ_RES(false)}`,
  layout:LZ_LAYOUT,explain:{...LZ_EXPLAIN,LandingZone:"Manifest đã có log archive nhưng chưa chỉ định account audit, nên setup lỗi.",AppProd:"Inventory bỏ sót: app-prod vẫn còn recorder cũ.",DenyConfigChanges:"Ai đó gắn lại SCP này lên Legacy."},
  tasks:[
    {t:"Landing zone chạy",c:"manifest có log archive + audit, org All features",test:()=>lzState().st==="ready"},
    {t:"Đợt thí điểm: Workloads enroll 100%",c:"OU Workloads đã register, mọi account enrolled",test:()=>ouRegistered("Workloads")&&enrolledIn("Workloads")},
    {t:"Coverage 100%",c:"mọi account trong org enrolled",test:()=>{const c=orgCoverage();return c.total>0&&c.enrolled===c.total}}],
  diagnose(n){const s=lzState();if(s.st!=="ready")return["Landing zone báo Setup lỗi.","Xem lý do trong khối LandingZone hoặc tab Vấn đề.","Nối LandingZone → Audit để chỉ định account audit."][Math.min(n,2)];
    if(!ouRegistered("Workloads"))return["Chưa OU nào được register.","Bắt đầu với OU ít rủi ro.","Nối LandingZone → Workloads (hoặc nút Register OU)."][Math.min(n,2)];
    if(!enrolledIn("Workloads"))return["app-prod enroll fail.","Chọn app-prod xem lý do.","Xóa Config recorder cũ của app-prod."][Math.min(n,2)];
    if(!ouRegistered("Legacy"))return["OU Legacy chưa được quản lý.","Register nó như Workloads.","Nhưng gỡ SCP DenyConfigChanges trước, không thì cả OU fail."][Math.min(n,2)];
    return["Còn account fail trong Legacy.","Xem tab Vấn đề.","Gỡ DenyConfigChanges khỏi Legacy."][Math.min(n,2)]},
  hints:()=>["Register OU = Control Tower enroll từng account trong OU. Account fail riêng, account khác vẫn vào. Đi đợt ít rủi ro trước.","Nối LandingZone → Audit. Nối LandingZone → Workloads; xóa recorder cũ của app-prod. Gỡ DenyConfigChanges khỏi Legacy rồi register Legacy."],
  solve(){edit("enroll",()=>{setP(M.res.LandingZone.Properties,"Manifest.securityRoles.accountId",{"Fn::GetAtt":["Audit","AccountId"]});M.res.AppProd.Metadata.CloudLab.LegacyConfigRecorder=false;M.res.DenyConfigChanges.Properties.TargetIds=[];
    for(const ou of["Workloads","Legacy"])M.res["Register"+ou]={Type:"AWS::ControlTower::EnabledBaseline",Properties:{BaselineIdentifier:CT_BASELINE,BaselineVersion:"4.0",TargetIdentifier:{"Fn::GetAtt":[ou,"Arn"]}}}})},
  pass:"Expand rồi backfill: landing zone thêm OU Security, org trail, aggregator mà không đụng OU cũ; rồi register từng OU, đợt ít rủi ro trước. Hai account còn trail riêng đang ghi log hai nơi, đó là việc của pha contract.",
  reading:{title:"chia đợt, bắc cầu và case thực tế",html:`<h4>Chia đợt theo blast radius</h4><p>Sandbox, rồi non-prod, rồi prod, rồi shared services (network, security). Management account luôn đi cuối. Mỗi đợt phải qua gate rồi mới mở đợt sau (go/no-go).</p>
<h4>Bắc cầu trong lúc chuyển</h4><p>Giữ cả đường cũ lẫn mới cùng chạy. Trail cũ và org trail ghi song song cho tới khi SIEM đọc từ org trail.</p>
<h4>Diễn tập và đóng băng thay đổi</h4><p>Chạy thử trên account giả để đo thời gian và tìm lỗi. Trong lúc account đang chuyển: không deploy, không scale; ghim Auto Scaling group (Min = Max = Desired), backup CUR.</p>
<h4>Case thực tế</h4><ul><li><b>Telco châu Phi · Tech Mahindra</b> (140+ account, 4 đợt, new org): sandbox → non-prod → prod → service account. Bài học: kiểm tra region sớm, lúc bắt đầu Control Tower chưa có ở Cape Town.</li>
<li><b>Media Canada · HCLTech</b> (140+ account, ALZ → Control Tower): không downtime, thiết kế lại OU, thay pipeline tạo account bằng Account Factory. Bài học: dọn thành phần ALZ còn sót là một bước riêng.</li>
<li><b>Custom landing zone có RAM · AWS</b> (~8 tuần): đổi RAM share cấp org thành cấp account, ghim Auto Scaling, management account đi cuối. Bài học: trong lúc chuyển, instance vẫn chạy nhưng không start/stop được.</li></ul>${lzSrc(0,3,4,5)}`}};

const L_LZ3={id:"lz-contract",sub:"brownfield · contract",tag:"Contract + drift",title:"Dọn phần cũ và giữ landing zone không drift",who:["M","Minh · platform"],speed:3,
  scenario:"Mọi account đã enroll, nhưng rollout chưa xong: hai account vẫn ghi log hai nơi và trả phí trùng (xem đồng hồ chi phí). Sáng nay có người gỡ SCP của Control Tower bằng console, landing zone báo drift.",
  goal:"Hết drift; không còn log ghi hai nơi; bật một preventive control trên Workloads.",
  concepts:["contract","dual-write","drift","ResetLandingZone","preventive vs detective control","một cửa thay đổi"],
  yaml:`Description: Brownfield org · contract
Resources:
  Org:
    Type: AWS::Organizations::Organization
    Properties: {FeatureSet: ALL}
${OU("Legacy","Legacy")}${OU("Workloads","Workloads")}${OU("Security","Security")}${ACC("LegacyBilling","legacy-billing","Legacy","2046-1139-8821")}${ACC("AcquiredStartup","acquired-startup","Legacy","5590-1004-7312","Origin: invited, LegacyTrail: true")}${ACC("AppDev","app-dev","Workloads","7302-8411-5906")}${ACC("AppProd","app-prod","Workloads","4188-7362-0044","LegacyTrail: true")}${ACC("LogArchive","log-archive","Security","8621-3550-7719")}${ACC("Audit","audit","Security","3477-9021-8843")}${LZ_RES(true,true)}${REG("Workloads")}${REG("Legacy")}`,
  layout:LZ_LAYOUT,explain:{...LZ_EXPLAIN,LandingZone:"Drift: SCP của Control Tower bị gỡ tay. Lúc drift, không register hay enroll thêm được. Sửa bằng Repair (ResetLandingZone), không sửa tay thêm.",
    AcquiredStartup:"Đã enroll nhưng trail riêng vẫn chạy: log ghi hai nơi, bản sao thứ hai bị tính phí.",AppProd:"Cũng còn trail riêng."},
  tasks:[
    {t:"Hết drift",c:"landing zone đã repair",test:()=>lzState().st==="ready"},
    {t:"Không còn log ghi hai nơi",c:"account đã enroll không còn trail riêng",test:()=>dualTrails().length===0&&orgCoverage().enrolled===orgCoverage().total},
    {t:"Bật preventive control trên Workloads",c:"sau khi enroll xong mới cưỡng chế",test:()=>controlsOf("Workloads").some(c=>/RESTRICT_ROOT_USER|REGION_DENY/.test(String(c.props.ControlIdentifier)))}],
  diagnose(n){if(lzState().st==="drift")return["Landing zone đang drift.","Đừng sửa tay thêm.","Chọn LandingZone, bấm Repair landing zone."][Math.min(n,2)];
    if(dualTrails().length)return[`${dualTrails().map(a=>physName(a)).join(", ")} vẫn ghi log hai nơi.`,"Chọn account đó, xem dòng “Chi phí · trail trùng” trong khung chi tiết.","Xóa trail riêng của từng account (nút Xóa trail riêng trong khung chi tiết)."][Math.min(n,2)];
    return["Chưa có preventive control.","Detective đã đo đủ, giờ cưỡng chế.","Nối LandingZone → Workloads để bật control RESTRICT_ROOT_USER."][Math.min(n,2)]},
  hints:()=>["Contract là bước có chủ đích: xóa trail riêng, recorder cũ, SCP thừa sau khi đường mới đã chạy. Mọi thay đổi sau rollout đi qua Control Tower.","LandingZone: Repair. acquired-startup và app-prod: Xóa trail riêng. Nối LandingZone → Workloads (đã register) để bật control."],
  solve(){edit("contract",()=>{delete M.res.LandingZone.Metadata.CloudLab.Drift;for(const id of["AcquiredStartup","AppProd"])M.res[id].Metadata.CloudLab.LegacyTrail=false;
    M.res.ControlWorkloads={Type:"AWS::ControlTower::EnabledControl",Properties:{ControlIdentifier:ctControl("AWS-GR_RESTRICT_ROOT_USER"),TargetIdentifier:{"Fn::GetAtt":["Workloads","Arn"]}}}})},
  pass:"Rollout đạt: 0 drift, 0 log trùng, controls bật sau khi enroll xong. Từ giờ một cửa: mọi thay đổi qua Control Tower hoặc pipeline (Account Factory, AFT, CfCT). Sửa tay là drift, và drift khóa enroll.",
  reading:{title:"expand–contract, drift và thế nào là xong",html:`<h4>Expand–contract áp vào landing zone</h4><table><tr><th>Bước</th><th>Migration database</th><th>Landing zone brownfield</th></tr>
<tr><td>Expand</td><td>Thêm bảng, cột mới</td><td>Set up landing zone: OU Security, org trail, aggregator. OU cũ giữ nguyên.</td></tr><tr><td>Dual-write</td><td>Ghi cả cũ lẫn mới</td><td>Trail cũ và org trail cùng ghi. Controls ở chế độ detective.</td></tr>
<tr><td>Backfill</td><td>Chép dữ liệu cũ</td><td>Register OU, enroll account theo đợt.</td></tr><tr><td>Switch</td><td>Đọc từ chỗ mới</td><td>Bật preventive controls; SIEM và alert chuyển sang org trail.</td></tr><tr><td>Contract</td><td>Xóa cột, bảng cũ</td><td>Xóa trail riêng, recorder cũ, SCP thừa, thành phần landing zone cũ.</td></tr></table>
<h4>Thế nào là rollout thành công</h4><p>“Account đã enroll” chưa phải là xong. Đóng rollout khi qua đủ gate, mỗi gate đo bằng số và chốt ngưỡng trước: inventory không còn ô chưa biết, precheck 0 chướng ngại, workload trong SLO, coverage 100%, log đầy đủ ở log archive, không quyền nào bị nới, 0 drift, contract xong (0 trail riêng, 0 recorder cũ, 0 SCP mồ côi, không còn chi phí trùng sau một chu kỳ billing).</p>
<h4>Case: drift do default VPC thêm tay · Scale Factory</h4><p>Default VPC được tạo tay sau khi set up làm account không update được qua Control Tower. Drift chặn cả enroll account mới, nên xử lý như incident. Bài học: không sửa tài nguyên Control Tower từ ngoài; thêm Config rule hoặc EventBridge để bắt thay đổi lạ.</p>${lzSrc(2,4,6)}`}};

/* the landing zone track goes after the FCAJ track */
(function(){const PH="Landing zone · brownfield";[L_LZ1,L_LZ2,L_LZ3].forEach(l=>{l.phase=PH;l.step=LESSONS.length;LESSONS.push(l)})})();
