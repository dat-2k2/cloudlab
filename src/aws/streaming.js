"use strict";
/* AWS pack · streaming, messaging and realtime: Amazon MSK (provisioned and Serverless), ElastiCache Serverless (Valkey /
   Redis OSS), Amazon MQ for RabbitMQ, and API Gateway WebSocket APIs. Plus list prices for every block (def.price), so each
   block shows $/hour and $/month before anything runs. Prices: src/prices.js (AP = PRICES.aws). */
const AP=PRICES.aws;
const MSK_TYPES={"kafka.t3.small":{mbps:5},"kafka.m7g.large":{mbps:40},"kafka.m5.large":{mbps:40}};/* CloudLab estimate: MB/s of producer traffic per broker */
const MQ_TYPES={"mq.m7g.medium":{mps:3000,cluster:true},"mq.m7g.large":{mps:6000,cluster:true},"mq.m5.large":{mps:6000,cluster:true},"mq.t3.micro":{mps:800,cluster:false,gone:true}};/* CloudLab estimate: messages/s */
Object.assign(REL,{routes:{style:"flow"},pushes:{style:"flow"}});
def("AWS::MSK::Cluster",{label:"Amazon MSK (Kafka)",short:"MSK",cat:"notify",
  doc:"Apache Kafka do AWS vận hành: bạn chọn loại và số broker (bội số của số subnet / AZ), AWS lo cài đặt, bản sao, vá lỗi. Tính theo broker-giờ + GB ổ đĩa mỗi broker, chạy suốt kể cả khi không có message. Client trong VPC kết nối cổng 9098 (xác thực IAM).",
  defaults:id=>({ClusterName:kebab(id),KafkaVersion:"3.6.0",NumberOfBrokerNodes:2,BrokerNodeGroupInfo:{InstanceType:"kafka.t3.small",ClientSubnets:[],SecurityGroups:[],StorageInfo:{EBSStorageInfo:{VolumeSize:100}}},
    ClientAuthentication:{Sasl:{Iam:{Enabled:true}}}}),name:p=>p.ClusterName,
  fields:[{k:"BrokerNodeGroupInfo.InstanceType",label:"Loại broker",type:"select",options:Object.keys(MSK_TYPES)},{k:"NumberOfBrokerNodes",label:"Số broker",type:"number",min:2,help:"Bội số của số subnet (2 hoặc 3 AZ)."},
    {k:"BrokerNodeGroupInfo.StorageInfo.EBSStorageInfo.VolumeSize",label:"Ổ đĩa mỗi broker (GB)",type:"number",min:1},{k:"BrokerNodeGroupInfo.ClientSubnets",label:"Subnet",type:"refs",to:["AWS::EC2::Subnet"]},
    {k:"BrokerNodeGroupInfo.SecurityGroups",label:"Security group",type:"refs",to:["AWS::EC2::SecurityGroup"],att:"GroupId"}],
  rel:{"BrokerNodeGroupInfo.ClientSubnets.*":{kind:"contains",label:""},"BrokerNodeGroupInfo.SecurityGroups.*":{kind:"secured",label:"SG"}}});
def("AWS::MSK::ServerlessCluster",{label:"MSK Serverless",short:"MSK∞",cat:"notify",
  doc:"Kafka không phải chọn broker: tự co giãn, trả theo giờ cluster + giờ mỗi partition + GB vào / ra. Chỉ xác thực IAM. Rẻ hơn MSK có broker khi lưu lượng nhỏ, nhưng vẫn có phí cluster-giờ chạy suốt.",
  defaults:id=>({ClusterName:kebab(id),VpcConfigs:[{SubnetIds:[],SecurityGroups:[]}],ClientAuthentication:{Sasl:{Iam:{Enabled:true}}}}),meta:{Partitions:6},name:p=>p.ClusterName,
  fields:[{k:"VpcConfigs.0.SubnetIds",label:"Subnet",type:"refs",to:["AWS::EC2::Subnet"]},{k:"VpcConfigs.0.SecurityGroups",label:"Security group",type:"refs",to:["AWS::EC2::SecurityGroup"],att:"GroupId"},
    {k:"@Partitions",label:"Số partition (tổng các topic)",type:"number",min:1,help:"Mỗi partition tính tiền theo giờ."}],
  rel:{"VpcConfigs.*.SubnetIds.*":{kind:"contains",label:""},"VpcConfigs.*.SecurityGroups.*":{kind:"secured",label:"SG"}}});
def("AWS::ElastiCache::ServerlessCache",{label:"ElastiCache Serverless",short:"EC∞",cat:"db",
  doc:"Cache Valkey hoặc Redis OSS không phải chọn node: trả theo GB dữ liệu đang lưu mỗi giờ (có mức tối thiểu) và theo ECPU (đơn vị tính cho mỗi lệnh). Valkey rẻ hơn Redis OSS và có mức tối thiểu thấp hơn.",
  defaults:id=>({ServerlessCacheName:kebab(id),Engine:"valkey",SubnetIds:[],SecurityGroupIds:[]}),meta:{DataGB:0.1,HitRatio:0.8},name:p=>p.ServerlessCacheName,
  fields:[{k:"Engine",label:"Engine",type:"select",options:[["valkey","Valkey"],["redis","Redis OSS"]]},{k:"@DataGB",label:"Dữ liệu đang lưu (GB)",type:"number",step:"any",min:0},{k:"@HitRatio",label:"Tỉ lệ trúng cache (0–1)",type:"number",step:"0.05",min:0,max:1},
    {k:"SubnetIds",label:"Subnet",type:"refs",to:["AWS::EC2::Subnet"]},{k:"SecurityGroupIds",label:"Security group",type:"refs",to:["AWS::EC2::SecurityGroup"],att:"GroupId"}],
  rel:{"SubnetIds.*":{kind:"contains",label:""},"SecurityGroupIds.*":{kind:"secured",label:"SG"}}});
def("AWS::AmazonMQ::Broker",{label:"Amazon MQ (RabbitMQ)",short:"MQ",cat:"notify",
  doc:"RabbitMQ do AWS vận hành: AWS lo cài đặt, vá lỗi, sao lưu cấu hình. Một node mq.m7g.medium để học (mq.t3.micro không tạo mới được nữa); cluster 3 node ở 3 AZ cho production. Tính theo broker-giờ + GB lưu message. Cổng 5671 (AMQPS).",
  defaults:id=>({BrokerName:kebab(id),EngineType:"RABBITMQ",EngineVersion:"3.13",HostInstanceType:"mq.m7g.medium",DeploymentMode:"SINGLE_INSTANCE",PubliclyAccessible:false,AutoMinorVersionUpgrade:true,
    SubnetIds:[],SecurityGroups:[],Users:[{Username:"app",Password:"{{resolve:secretsmanager:mq-app:SecretString:password}}"}]}),name:p=>p.BrokerName,
  fields:[{k:"BrokerName",label:"Tên broker",type:"text",help:"Đổi chế độ triển khai hay subnet thì AWS tạo broker mới: tên phải khác tên cũ."},{k:"HostInstanceType",label:"Loại broker",type:"select",options:Object.keys(MQ_TYPES)},{k:"DeploymentMode",label:"Triển khai",type:"select",options:[["SINGLE_INSTANCE","Một node"],["CLUSTER_MULTI_AZ","Cluster 3 node (3 AZ)"]]},
    {k:"PubliclyAccessible",label:"Public",type:"select",options:[[false,"Không"],[true,"Có (không nên)"]],bool:true},{k:"SubnetIds",label:"Subnet",type:"refs",to:["AWS::EC2::Subnet"]},{k:"SecurityGroups",label:"Security group",type:"refs",to:["AWS::EC2::SecurityGroup"],att:"GroupId"}],
  rel:{"SubnetIds.*":{kind:"contains",label:""},"SecurityGroups.*":{kind:"secured",label:"SG"}}});
/* WebSocket API: the same CloudFormation type as the HTTP API, shown as its own block. A WebSocket API has no quick-create
   Target: connecting it to a Lambda adds an Integration, a $default Route and an auto-deployed Stage. */
const WS_DEF={alias:"AWS::ApiGatewayV2::Api",label:"API Gateway (WebSocket)",short:"WS",cat:"notify",
  doc:"Giữ kết nối hai chiều với trình duyệt / app: server đẩy dữ liệu xuống mà khách không phải hỏi lại. Tính theo phút-kết nối và số message (mỗi 32 KB là một message). Kết nối tối đa 2 giờ, im lặng 10 phút là bị đóng. Lambda đẩy tin xuống qua @connections API (cần quyền execute-api:ManageConnections).",
  defaults:id=>({Name:kebab(id),ProtocolType:"WEBSOCKET",RouteSelectionExpression:"$request.body.action"}),name:p=>p.Name,
  fields:[{k:"Name",label:"Tên API",type:"text"},{k:"RouteSelectionExpression",label:"Chọn route theo",type:"text"}]};
def("AWS::ApiGatewayV2::Api#ws",WS_DEF);
T["AWS::ApiGatewayV2::Api"].variant=p=>p.ProtocolType==="WEBSOCKET"?"AWS::ApiGatewayV2::Api#ws":null;
def("AWS::ApiGatewayV2::Integration",{label:"Integration",short:"INT",cat:"notify",edge:true,doc:"Nơi API chuyển message tới (thường là Lambda).",
  defaults:()=>({ApiId:null,IntegrationType:"AWS_PROXY",IntegrationUri:null}),edgeOf:p=>[{from:refId(p.ApiId),to:targetOf(p.IntegrationUri),kind:"invokes",label:"route → Lambda"}]});
def("AWS::ApiGatewayV2::Route",{label:"Route",short:"RT",cat:"notify",edge:true,doc:"Một route ($connect, $disconnect, $default hoặc tên action) trỏ tới integration.",defaults:()=>({ApiId:null,RouteKey:"$default",Target:null}),edgeOf:()=>[]});
def("AWS::ApiGatewayV2::Stage",{label:"Stage",short:"ST",cat:"notify",edge:true,doc:"Bản đã deploy của API (prod).",defaults:()=>({ApiId:null,StageName:"prod",AutoDeploy:true}),edgeOf:()=>[]});
const wsIntegrations=api=>Object.keys(M.res).filter(k=>M.res[k].Type==="AWS::ApiGatewayV2::Integration"&&refId(M.res[k].Properties.ApiId)===api);
const wsFn=api=>{const i=wsIntegrations(api)[0];return i?targetOf(M.res[i].Properties.IntegrationUri):null};
Object.assign(SG_PATH,{"AWS::MSK::Cluster":"BrokerNodeGroupInfo.SecurityGroups","AWS::MSK::ServerlessCluster":"VpcConfigs.0.SecurityGroups","AWS::ElastiCache::ServerlessCache":"SecurityGroupIds","AWS::AmazonMQ::Broker":"SecurityGroups"});
const STREAM_PORT={"AWS::MSK::Cluster":9098,"AWS::MSK::ServerlessCluster":9098,"AWS::ElastiCache::ServerlessCache":6379,"AWS::AmazonMQ::Broker":5671};
const STREAM_SUBNETS={"AWS::MSK::Cluster":"BrokerNodeGroupInfo.ClientSubnets","AWS::MSK::ServerlessCluster":"VpcConfigs.0.SubnetIds","AWS::ElastiCache::ServerlessCache":"SubnetIds","AWS::AmazonMQ::Broker":"SubnetIds"};
Object.assign(BASE_ID,{"AWS::MSK::Cluster":"Kafka","AWS::MSK::ServerlessCluster":"KafkaSl","AWS::ElastiCache::ServerlessCache":"Valkey","AWS::AmazonMQ::Broker":"Rabbit","AWS::ApiGatewayV2::Api#ws":"PriceSocket"});
Object.assign(WHY_X,{"AWS::MSK::Cluster":"subnet, security group","AWS::MSK::ServerlessCluster":"subnet, security group","AWS::ElastiCache::ServerlessCache":"subnet, security group","AWS::AmazonMQ::Broker":"subnet, security group","AWS::ApiGatewayV2::Api#ws":"Lambda"});
const MSK_ACTIONS=["kafka-cluster:Connect","kafka-cluster:WriteData","kafka-cluster:DescribeTopic"];
/* connect rules for the new types */
function CONNECT_S(a,b,A,B,say){const ta=A.type,tb=B.type;
  const sub=(path,att)=>()=>{const v=arr(getP(A.props,path));if(!v.some(x=>refId(x)===b))v.push(att?GA(b,att):R(b));setP(A.props,path,v)};
  if(STREAM_SUBNETS[ta]&&tb==="AWS::EC2::Subnet")return say("đặt vào subnet",sub(STREAM_SUBNETS[ta]));
  if(ta==="AWS::ApiGatewayV2::Api"&&A.props.ProtocolType==="WEBSOCKET"&&tb==="AWS::Lambda::Function")return say(wsFn(a)===b?"đã có route → Lambda (kiểm tra quyền)":"route $default → Lambda (integration + route + stage)",grant=>{
    if(wsFn(a)===b){grantInvoke(b,"api",a);const role=roleOfFn(b);if(grant&&role&&!evalRole(role,"execute-api:ManageConnections",`arn:aws:execute-api:${REGION}:${ACCT}:${physName(A)}/prod/POST/@connections/x`).allow)addStmt(role,["execute-api:ManageConnections"],{"Fn::Sub":`arn:aws:execute-api:\${AWS::Region}:\${AWS::AccountId}:\${${a}}/*`},"PushTo"+a);return}
    const ig=freeId(a+"Integration");M.res[ig]={Type:"AWS::ApiGatewayV2::Integration",Properties:{ApiId:R(a),IntegrationType:"AWS_PROXY",IntegrationUri:{"Fn::Sub":`arn:aws:apigateway:\${AWS::Region}:lambda:path/2015-03-31/functions/\${${b}.Arn}/invocations`}}};
    M.res[freeId(a+"Route")]={Type:"AWS::ApiGatewayV2::Route",Properties:{ApiId:R(a),RouteKey:"$default",Target:{"Fn::Sub":`integrations/\${${ig}}`}}};
    if(!Object.values(M.res).some(r=>r.Type==="AWS::ApiGatewayV2::Stage"&&refId(r.Properties.ApiId)===a))M.res[freeId(a+"Stage")]={Type:"AWS::ApiGatewayV2::Stage",Properties:{ApiId:R(a),StageName:"prod",AutoDeploy:true}};
    grantInvoke(b,"api",a);const role=roleOfFn(b);if(grant&&role)addStmt(role,["execute-api:ManageConnections"],{"Fn::Sub":`arn:aws:execute-api:\${AWS::Region}:\${AWS::AccountId}:\${${a}}/*`},"PushTo"+a)},roleOfFn(b)?{actions:["execute-api:ManageConnections"],role:roleOfFn(b)}:null);
  if(ta==="CloudLab::Client"&&tb==="AWS::ApiGatewayV2::Api"&&B.props.ProtocolType==="WEBSOCKET")return say("mở kết nối WebSocket",()=>{A.props.Target=R(b);A.props.Protocol="websocket";A.props.Connections=A.props.Connections||1000;A.props.MessagesPerMinute=A.props.MessagesPerMinute??12;delete A.props.RatePerSecond});
  if(ta==="AWS::EC2::Instance"&&STREAM_PORT[tb]){const asg=sgsOf(a)[0],bsg=sgsOf(b)[0],port=STREAM_PORT[tb],prof=nodeOf(refId(A.props.IamInstanceProfile)),role=prof&&refId(arr(prof.props.Roles)[0]),iam=/^AWS::MSK::/.test(tb);
    return say(`app dùng ${B.def.label} (tcp/${port})`,grant=>{addUse(A,b);if(grant&&asg&&bsg)sgRule(bsg,asg,port).apply();if(grant&&iam&&role)addStmt(role,MSK_ACTIONS,{"Fn::Sub":`arn:aws:kafka:\${AWS::Region}:\${AWS::AccountId}:*/\${${b}}/*`},"Kafka"+b)},
      asg&&bsg||iam&&role?{text:[asg&&bsg?sgRule(bsg,asg,port).text:null,iam&&role?`Cho ${role} quyền ${MSK_ACTIONS.join(", ")}`:null].filter(Boolean).join("; ")}:null)}
  return null}
/* EC2 app → stream dependency: network (security group) and, for MSK, IAM on the instance role; then capacity */
function streamUse(id,u,w,n){const un=nodeOf(u);if(!exists(u))return{err:`${u} chưa được deploy`};const port=STREAM_PORT[un.type],s=sgAllows(u,port,{node:id});
  if(!s.ok){flow(id,u,"uses",w,s.why);return{err:`Không kết nối được ${un.def.label}: ${s.why}`}}
  if(/^AWS::MSK::/.test(un.type)){const prof=nodeOf(refId(n.props.IamInstanceProfile)),role=prof&&refId(arr(prof.props.Roles)[0]);const e=role?evalRole(role,"kafka-cluster:WriteData",`arn:aws:kafka:${REGION}:${ACCT}:topic/${physName(un)}/*`):{allow:false,by:"instance chưa có IAM role"};
    if(!e.allow){const why=`AccessDenied: kafka-cluster:WriteData (${e.by})`;flow(id,u,"uses",w,why);return{err:why}}if(role)flow(id,role,"assumes",w)}
  flow(id,u,"uses",w);bump(u,un.type==="AWS::ElastiCache::ServerlessCache"?"ops":"msg",w);
  const rate=(nrt(u).tk.msg||nrt(u).tk.ops||0)/TICK_DT;
  if(un.type==="AWS::MSK::Cluster"){const cap=(MSK_TYPES[getP(un.props,"BrokerNodeGroupInfo.InstanceType")]||{mbps:5}).mbps*(+un.props.NumberOfBrokerNodes||2)*1024;nrt(u).load=rate/cap;if(rate>cap)return{err:`MSK quá tải: ${num(rate)} message/s (1 KB) vượt khoảng ${num(cap)}/s của ${un.props.NumberOfBrokerNodes} broker`,errW:w*(rate-cap)/rate}}
  if(un.type==="AWS::AmazonMQ::Broker"){const cap=(MQ_TYPES[un.props.HostInstanceType]||{mps:800}).mps*(un.props.DeploymentMode==="CLUSTER_MULTI_AZ"?2:1);nrt(u).load=rate/cap;if(rate>cap)return{err:`RabbitMQ chặn publisher (memory alarm): ${num(rate)} message/s, ${un.props.HostInstanceType} xử lý khoảng ${num(cap)}/s`,errW:w*(rate-cap)/rate}}
  if(un.type==="AWS::ElastiCache::ServerlessCache")charge(u,w*AP.ecSl[un.props.Engine==="redis"?"redis":"valkey"].ecpu,"ECPU");
  if(un.type==="AWS::MSK::ServerlessCluster")charge(u,w/1048576*AP.mskSl.inGB,"GB ghi vào");
  return{}}
for(const t of Object.keys(STREAM_PORT))T[t].use=streamUse;
/* ---------------- WebSocket API: open connections, pushed messages, connection-minutes ---------------- */
function wsRun(ev,dt){const id=ev.to,n=nodeOf(id),want=ev.w,src=nodeOf(ev.from),c=RT.ws[ev.from]||(RT.ws[ev.from]={});
  const deny=msg=>{c.open=0;c.rej=want;flow(ev.from,id,"calls",want,msg);nrt(ev.from).lastErr=msg;nrt(id).lastErr=msg;bump(ev.from,"err",want*dt/60);return};
  if(!n||!exists(id))return deny("Chưa được deploy");if(n.props.ProtocolType!=="WEBSOCKET")return deny("API này là HTTP API, không nhận WebSocket (tạo API Gateway WebSocket)");
  if(!Object.values(M.res).some(r=>r.Type==="AWS::ApiGatewayV2::Stage"&&refId(r.Properties.ApiId)===id))return deny("API chưa có stage nên chưa có URL wss:// (nối API tới Lambda để CloudLab tạo route + stage)");
  const fn=wsFn(id);if(!fn||!nodeOf(fn))return deny("Chưa có route: kết nối mở được nhưng mọi message trả lỗi (nối API tới một Lambda)");
  const pm=canInvoke(fn,PRINCIPAL.api,id);if(!pm.ok)return deny("Route $default không gọi được Lambda: "+pm.why);
  c.open=want;c.rej=0;flow(ev.from,id,"calls",want);RT.wsConn=RT.wsConn||{};RT.wsConn[id]=(RT.wsConn[id]||0)+want;
  /* connections last at most 2 h: each reconnect is a $connect message */
  const reco=want*dt/7200,mpm=+(src.props.MessagesPerMinute||0),push_=want*mpm/60*dt;bump(ev.from,"reconnect",reco);
  charge(id,want*dt/60*AP.ws.connMin,"phút-kết nối");charge(id,(reco+push_)*AP.ws.msg,"message");bump(id,"msg",push_+reco);
  /* pushing: the integration Lambda calls @connections; needs execute-api:ManageConnections */
  if(push_>0){const role=roleOfFn(fn),e=role?evalRole(role,"execute-api:ManageConnections",`arn:aws:execute-api:${REGION}:${ACCT}:${physName(n)}/prod/POST/@connections/*`):{allow:false,by:"Lambda chưa có role"};
    if(!e.allow){const why=`Lambda không đẩy được tin: AccessDenied execute-api:ManageConnections (${e.by})`;flow(id,fn,"invokes",push_,why);nrt(id).lastErr=why;bump(ev.from,"err",push_);return}
    flow(id,fn,"invokes",push_);bump(ev.from,"recv",push_);bump(ev.from,"ok",reco||0);
    /* the pusher: one Lambda run per broadcast batch (CloudLab: 1 invocation per 100 connections per update) */
    const runs=Math.max(1,Math.round(push_/100));charge(fn,runs*PRICE.lambdaReq+runs*0.2*(+nodeOf(fn).props.MemorySize||128)/1024*PRICE.lambdaGBs,"đẩy tin");bump(fn,"inv",runs)}}
/* ---------------- list prices of every AWS block ---------------- */
function awsPrice(n){const p=n.props,parts=[],usage=[],m=k=>getP(n.raw,"Metadata.CloudLab."+k);
  switch(n.type){
    case"AWS::EC2::Instance":parts.push([`EC2 ${p.InstanceType}`,PRICE.ec2[p.InstanceType]||0]);{const s=subnetsOf(n)[0];if(!s||isPublicSubnet(s))parts.push(["IPv4 public",PRICE.ipv4H])}usage.push(`Truyền ra Internet ${money(PRICE.dtoGB)}/GB`);break;
    case"AWS::RDS::DBInstance":{const x=p.MultiAZ===true?2:1;parts.push([`RDS ${p.DBInstanceClass}${x>1?" × 2 (Multi-AZ)":""}`,(PRICE.rds[p.DBInstanceClass]||0)*x],[`Ổ đĩa ${+p.AllocatedStorage||20} GB`,(+p.AllocatedStorage||20)*PRICE.rdsGB*x/HOURS_MO]);break}
    case"AWS::ElastiCache::CacheCluster":parts.push([`${p.CacheNodeType} × ${+p.NumCacheNodes||1}`,(AP.cacheNode[p.CacheNodeType]||PRICE.cache[p.CacheNodeType]||0)*(+p.NumCacheNodes||1)]);break;
    case"AWS::ElasticLoadBalancingV2::LoadBalancer":parts.push(["Load balancer",PRICE.albH]);if(p.Scheme!=="internal")parts.push(["IPv4 public",PRICE.ipv4H*Math.max(2,subnetsOf(n).length)]);usage.push(`LCU ${money(PRICE.albLCU)}/giờ`);break;
    case"AWS::Route53::RecordSet":parts.push(["Hosted zone",PRICE.r53Zone/HOURS_MO]);break;
    case"AWS::CloudWatch::Alarm":parts.push(["Alarm",PRICE.alarmMo/HOURS_MO]);break;
    case"AWS::MSK::Cluster":{const k=+p.NumberOfBrokerNodes||2,it=getP(p,"BrokerNodeGroupInfo.InstanceType"),gb=+getP(p,"BrokerNodeGroupInfo.StorageInfo.EBSStorageInfo.VolumeSize")||100;
      parts.push([`${k} broker ${it}`,k*(AP.msk[it]||0)],[`Ổ đĩa ${k} × ${gb} GB`,k*gb*AP.msk.storGBmo/HOURS_MO]);break}
    case"AWS::MSK::ServerlessCluster":{const parts_=+(m("Partitions")||6);parts.push(["Cluster",AP.mskSl.clusterH],[`${parts_} partition`,parts_*AP.mskSl.partH]);usage.push(`${money(AP.mskSl.inGB)}/GB ghi vào · ${money(AP.mskSl.outGB)}/GB đọc ra · ${money(AP.mskSl.storGBmo)}/GB-tháng lưu`);break}
    case"AWS::ElastiCache::ServerlessCache":{const e=AP.ecSl[p.Engine==="redis"?"redis":"valkey"],gb=Math.max(e.minGB,+(m("DataGB")??0.1));parts.push([`${num(gb)} GB dữ liệu (tối thiểu ${e.minGB} GB)`,gb*e.gbH]);usage.push(`${money(e.ecpu*1e6)} / triệu ECPU (≈ mỗi lệnh GET/SET nhỏ là 1 ECPU)`);break}
    case"AWS::AmazonMQ::Broker":{const cl=p.DeploymentMode==="CLUSTER_MULTI_AZ",k=cl?3:1;parts.push([cl?`Cluster 3 × ${p.HostInstanceType}`:`1 × ${p.HostInstanceType}`,cl?(AP.mqCluster[p.HostInstanceType]||3*(AP.mq[p.HostInstanceType]||0)):(AP.mq[p.HostInstanceType]||0)],["Lưu message (20 GB mỗi node)",k*20*AP.mq.storGBmo/HOURS_MO]);break}
    case"AWS::ApiGatewayV2::Api":if(p.ProtocolType==="WEBSOCKET"){usage.push(`${money(AP.ws.connMin*1e6)} / triệu phút-kết nối`,`${money(AP.ws.msg*1e6)} / triệu message (mỗi 32 KB)`,`1.000 kết nối giữ suốt tháng ≈ ${money(1000*HOURS_MO*60*AP.ws.connMin)} phút-kết nối`)}else usage.push(`${money(PRICE.apiReq*1e6)} / triệu request`);break;
    case"AWS::Lambda::Function":usage.push(`${money(PRICE.lambdaReq*1e6)} / triệu lần gọi`,`${money(PRICE.lambdaGBs)} / GB-giây`);break;
    case"AWS::S3::Bucket":usage.push(`${money(PRICE.s3GBmo)}/GB-tháng`,`${money(PRICE.s3Put*1000)} / 1.000 PUT`);break;
    case"AWS::DynamoDB::Table":usage.push(`${money(PRICE.ddbWrite*1e6)} / triệu lần ghi`);break;
    case"AWS::SQS::Queue":usage.push(`${money(PRICE.sqsReq*1e6)} / triệu request`);break;
    case"AWS::SNS::Topic":usage.push(`${money(PRICE.snsPub*1e6)} / triệu publish`);break;
    default:return{h:0,parts:[],usage:[],note:"Không tính tiền."}}
  const h=parts.reduce((a,x)=>a+x[1],0);return{h,parts,usage}}
for(const k of Object.keys(T))if(!T[k].ext&&!T[k].edge)T[k].price=awsPrice;
/* hourly charges for the new types (sim.js charges the older ones) */
const tickStream=(n,dt)=>{const pr=awsPrice(n);for(const[label,h]of pr.parts)charge(n.id,h*dt/3600,label)};
for(const t of ["AWS::MSK::Cluster","AWS::MSK::ServerlessCluster","AWS::ElastiCache::ServerlessCache","AWS::AmazonMQ::Broker"])T[t].tick=tickStream;
/* ---------------- checks for the Problems panel ---------------- */
function streamProblems(P){for(const n of allNodes()){const p=n.props,id=n.id;
  if(STREAM_SUBNETS[n.type]&&!arr(getP(p,STREAM_SUBNETS[n.type])).length)P("error",id,`${id}: ${n.def.label} cần subnet (đặt trong VPC)`);
  if(n.type==="AWS::MSK::Cluster"){const k=+p.NumberOfBrokerNodes||0,ss=arr(getP(p,"BrokerNodeGroupInfo.ClientSubnets")).length;if(ss&&k%ss)P("error",id,`${id}: số broker (${k}) phải là bội số của số subnet (${ss})`);if(ss&&ss<2)P("error",id,`${id}: MSK cần ít nhất 2 subnet ở 2 AZ`)}
  if(n.type==="AWS::AmazonMQ::Broker"&&(MQ_TYPES[p.HostInstanceType]||{}).gone)P("error",id,`${id}: mq.t3.micro không tạo broker mới được nữa (AWS ngừng hỗ trợ từ 1/10/2026). Dùng mq.m7g.medium`);
  if(n.type==="AWS::AmazonMQ::Broker"){const ns=arr(p.SubnetIds).length;if(p.DeploymentMode==="SINGLE_INSTANCE"&&ns!==1)P("error",id,`${id}: broker một node cần đúng 1 subnet (đang có ${ns})`);if(p.DeploymentMode==="CLUSTER_MULTI_AZ"&&ns<2)P("error",id,`${id}: cluster cần subnet ở nhiều AZ`)}
  if(n.type==="AWS::AmazonMQ::Broker"){if(p.DeploymentMode==="CLUSTER_MULTI_AZ"&&!(MQ_TYPES[p.HostInstanceType]||{}).cluster)P("error",id,`${id}: ${p.HostInstanceType} chỉ chạy được một node; cluster cần mq.m7g.large trở lên`);if(p.PubliclyAccessible===true)P("warn",id,`${id}: broker public: cổng AMQPS và trang quản trị mở ra Internet`)}
  if(n.type==="AWS::ApiGatewayV2::Api"&&p.ProtocolType==="WEBSOCKET"){const fn=wsFn(id);if(!fn)P("warn",id,`${id}: WebSocket API chưa có route. Nối API tới một Lambda`);else{const role=roleOfFn(fn);if(role&&!evalRole(role,"execute-api:ManageConnections",`arn:aws:execute-api:${REGION}:${ACCT}:${physName(n)}/prod/POST/@connections/*`).allow)P("error",fn,`${fn}: role ${role} thiếu execute-api:ManageConnections nên không đẩy được tin xuống kết nối WebSocket`)}}
  if(n.type==="AWS::EC2::SecurityGroup")for(const r of arr(p.SecurityGroupIngress))if(r.CidrIp==="0.0.0.0/0"&&[9092,9094,9098,5671,15671].some(x=>x>=+r.FromPort&&x<=+(r.ToPort??r.FromPort)))P("error",id,`${id}: cổng Kafka / RabbitMQ mở cho cả Internet. Chỉ mở cho security group của app`)}}
