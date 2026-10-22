"use strict";
/* Classic infrastructure: VPC, subnets, gateways, security groups, EC2, load balancer, RDS, ElastiCache, CloudFront, Route 53.
   Templates stay valid CloudFormation; two simplifications, stated in the docs: no route tables (a subnet is public when
   MapPublicIpOnLaunch is true and the VPC has an attached internet gateway), and app behaviour of EC2 lives in Metadata.CloudLab. */
const AZS=["ap-southeast-2a","ap-southeast-2b","ap-southeast-2c"];
const EC2_TYPES={"t3.micro":{cap:40,vcpu:2,mem:1},"t3.small":{cap:80,vcpu:2,mem:2},"t3.medium":{cap:160,vcpu:2,mem:4},"m5.large":{cap:320,vcpu:2,mem:8},"c5.large":{cap:380,vcpu:2,mem:4}};
const RDS_TYPES={"db.t3.micro":{qps:300},"db.t3.small":{qps:600},"db.t3.medium":{qps:1200},"db.m5.large":{qps:3000}};
const CACHE_TYPES={"cache.t4g.micro":{},"cache.t4g.small":{},"cache.t3.micro":{},"cache.t3.small":{}};
const AL2023="{{resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64}}";
Object.assign(REL,{contains:{style:"role"},attaches:{style:"role"},secured:{style:"role"},allows:{style:"grant"},forwards:{style:"flow"},listens:{style:"flow"},origin:{style:"flow"},alias:{style:"flow"}});
const nameTag=id=>[{Key:"Name",Value:kebab(id)}];
const tagName=p=>(arr(p.Tags).find(t=>t&&t.Key==="Name")||{}).Value;
const portOfRule=r=>r.FromPort===r.ToPort?String(r.FromPort):`${r.FromPort}-${r.ToPort}`;

/* ---------------- network ---------------- */
def("AWS::EC2::VPC",{label:"VPC",short:"VPC",cat:"infra",container:"vpc",
  doc:"Mạng riêng của bạn trong AWS, có dải IP (CIDR) riêng. Mọi EC2, RDS, load balancer nằm trong một VPC, chia nhỏ thành subnet theo Availability Zone.",
  defaults:id=>({CidrBlock:"10.0.0.0/16",EnableDnsHostnames:true,EnableDnsSupport:true,Tags:nameTag(id)}),name:p=>tagName(p),
  fields:[{k:"CidrBlock",label:"CIDR",type:"text",help:"Ví dụ 10.0.0.0/16 (65.536 địa chỉ)."}]});
def("AWS::EC2::Subnet",{label:"Subnet",short:"SN",cat:"infra",container:"subnet",
  doc:"Một dải IP con của VPC, nằm trong đúng một Availability Zone. Public subnet có đường ra Internet qua internet gateway; private subnet thì không — nơi đặt database và app server.",
  defaults:id=>({VpcId:null,CidrBlock:"10.0.1.0/24",AvailabilityZone:"ap-southeast-2a",MapPublicIpOnLaunch:false,Tags:nameTag(id)}),name:p=>tagName(p),
  fields:[{k:"VpcId",label:"VPC",type:"ref",to:["AWS::EC2::VPC"]},{k:"CidrBlock",label:"CIDR",type:"text"},{k:"AvailabilityZone",label:"Availability Zone",type:"select",options:AZS},
    {k:"MapPublicIpOnLaunch",label:"Public subnet",type:"select",options:[[true,"Public (gán IP public, ra Internet qua IGW)"],[false,"Private"]],bool:true}],
  rel:{VpcId:{kind:"contains",label:""}}});
def("AWS::EC2::InternetGateway",{label:"Internet gateway",short:"IGW",cat:"infra",
  doc:"Cửa ra vào Internet của VPC. Gắn vào VPC (VPCGatewayAttachment) thì các public subnet mới nhận và gửi được traffic Internet. Miễn phí.",
  defaults:id=>({Tags:nameTag(id)}),name:p=>tagName(p),fields:[]});
def("AWS::EC2::VPCGatewayAttachment",{label:"Gateway attachment",short:"ATT",cat:"infra",edge:true,
  doc:"Gắn internet gateway vào VPC.",defaults:()=>({VpcId:null,InternetGatewayId:null}),edgeOf:p=>[{from:refId(p.InternetGatewayId),to:refId(p.VpcId),kind:"attaches",label:"attach"}]});
def("AWS::EC2::SecurityGroup",{label:"Security group",short:"SG",cat:"sec",
  doc:"Tường lửa gắn vào từng tài nguyên (EC2, load balancer, RDS). Mặc định chặn mọi traffic vào; mỗi inbound rule mở một cổng cho một nguồn: dải IP (0.0.0.0/0 = cả Internet) hoặc một security group khác.",
  defaults:id=>({GroupDescription:kebab(id),VpcId:null,SecurityGroupIngress:[]}),name:p=>p.GroupName||p.GroupDescription,
  fields:[{k:"GroupDescription",label:"Mô tả",type:"text"},{k:"VpcId",label:"VPC",type:"ref",to:["AWS::EC2::VPC"]},{k:"SecurityGroupIngress",label:"Inbound rule",type:"ingress"}],
  rel:{VpcId:{kind:"contains",label:""},"SecurityGroupIngress.*":{kind:"allows",reverse:true,label:(p,path)=>{const r=getP(p,path.split(".").slice(0,2).join("."));return r?"cho phép :"+portOfRule(r):"cho phép"}}}});

/* ---------------- compute / load balancing ---------------- */
def("AWS::EC2::Instance",{label:"EC2 instance",short:"EC2",cat:"comp",
  doc:"Một máy ảo chạy liên tục, tính tiền theo giờ dù có request hay không. Mỗi loại (t3.micro, m5.large…) chịu được một lượng request nhất định; quá tải thì trả lỗi.",
  defaults:id=>({InstanceType:"t3.micro",ImageId:AL2023,SubnetId:null,SecurityGroupIds:[],Tags:nameTag(id)}),meta:{AppPort:80,Uses:[]},name:p=>tagName(p),
  fields:[{k:"InstanceType",label:"Instance type",type:"select",options:Object.keys(EC2_TYPES),help:"t3.micro ≈ 40 request/giây trong CloudLab."},{k:"SubnetId",label:"Subnet",type:"ref",to:["AWS::EC2::Subnet"]},
    {k:"SecurityGroupIds",label:"Security group",type:"refs",to:["AWS::EC2::SecurityGroup"],att:"GroupId"},{k:"@AppPort",label:"App lắng nghe cổng",type:"number",min:1,max:65535},
    {k:"@Uses",label:"App gọi tới",type:"refs",to:["AWS::RDS::DBInstance","AWS::ElastiCache::CacheCluster","AWS::ElastiCache::ServerlessCache","AWS::MSK::Cluster","AWS::MSK::ServerlessCluster","AWS::AmazonMQ::Broker","AWS::S3::Bucket","AWS::DynamoDB::Table","AWS::SNS::Topic","AWS::SQS::Queue"],meta:true,help:"Mỗi request vào app sẽ gọi các tài nguyên này (RDS/ElastiCache qua mạng + security group; S3/DynamoDB/SNS/SQS qua IAM role của instance)."}],
  rel:{SubnetId:{kind:"contains",label:""},"SecurityGroupIds.*":{kind:"secured",label:"SG"},IamInstanceProfile:{kind:"assumes",label:"instance role"}}});
def("AWS::IAM::InstanceProfile",{label:"Instance profile",short:"IP",cat:"sec",edge:true,doc:"Gói một IAM role để gắn vào EC2.",defaults:()=>({Roles:[]}),proxy:p=>refId(arr(p.Roles)[0])});
def("AWS::ElasticLoadBalancingV2::LoadBalancer",{label:"Application Load Balancer",short:"ALB",cat:"infra",
  doc:"Nhận request HTTP(S) từ Internet và chia đều cho các target khỏe (EC2, Lambda). Cần ít nhất 2 subnet ở 2 Availability Zone khác nhau. Tính tiền theo giờ + LCU.",
  defaults:id=>({Type:"application",Scheme:"internet-facing",Subnets:[],SecurityGroups:[],Name:kebab(id)}),name:p=>p.Name,
  fields:[{k:"Scheme",label:"Scheme",type:"select",options:["internet-facing","internal"]},{k:"Subnets",label:"Subnet (≥ 2 AZ)",type:"refs",to:["AWS::EC2::Subnet"]},{k:"SecurityGroups",label:"Security group",type:"refs",to:["AWS::EC2::SecurityGroup"],att:"GroupId"}],
  rel:{"Subnets.*":{kind:"contains",label:""},"SecurityGroups.*":{kind:"secured",label:"SG"}}});
def("AWS::ElasticLoadBalancingV2::TargetGroup",{label:"Target group",short:"TG",cat:"infra",
  doc:"Nhóm target mà load balancer chuyển request tới, kèm health check. Target không vượt health check (vd security group chặn load balancer) sẽ không nhận request.",
  defaults:id=>({Port:80,Protocol:"HTTP",VpcId:null,TargetType:"instance",HealthCheckPath:"/",Targets:[]}),
  fields:[{k:"Port",label:"Cổng target",type:"number",min:1,max:65535},{k:"VpcId",label:"VPC",type:"ref",to:["AWS::EC2::VPC"]},{k:"Targets",label:"Target",type:"tgtargets"}],
  rel:{VpcId:{kind:"contains",label:""},"Targets.*":{kind:"forwards",label:p=>":"+(p.Port||80)}}});
def("AWS::ElasticLoadBalancingV2::Listener",{label:"Listener",short:"LIS",cat:"infra",edge:true,doc:"Cổng load balancer lắng nghe và nơi chuyển tiếp.",
  defaults:()=>({LoadBalancerArn:null,Port:80,Protocol:"HTTP",DefaultActions:[]}),edgeOf:p=>arr(p.DefaultActions).map(a=>({from:refId(p.LoadBalancerArn),to:refId(a&&a.TargetGroupArn),kind:"listens",label:`${p.Protocol||"HTTP"} :${p.Port||80}`}))});
def("AWS::CloudFront::Distribution",{label:"CloudFront",short:"CF",cat:"infra",
  doc:"CDN: cache nội dung ở edge gần người dùng. Request trúng cache trả ngay; request trượt mới đi về origin (S3, load balancer, API). Tính tiền theo request và GB truyền ra.",
  defaults:()=>({DistributionConfig:{Enabled:true,Origins:[],DefaultCacheBehavior:{TargetOriginId:"",ViewerProtocolPolicy:"redirect-to-https",CachePolicyId:"658327ea-f89d-4fab-a63d-7e88639e58f6"}}}),meta:{HitRatio:0.9},
  fields:[{k:"@HitRatio",label:"Tỉ lệ trúng cache (0–1)",type:"number",step:"0.05",min:0,max:1},{k:"DistributionConfig.Enabled",label:"Bật",type:"select",options:[[true,"Enabled"],[false,"Disabled"]],bool:true}],
  rel:{"DistributionConfig.Origins.*":{kind:"origin",label:"origin"}}});
def("AWS::Route53::RecordSet",{label:"Route 53 record",short:"R53",cat:"infra",
  doc:"Tên miền trỏ tới tài nguyên. Alias record tới load balancer / CloudFront được truy vấn miễn phí; hosted zone tính $0,50 mỗi tháng.",
  defaults:()=>({HostedZoneName:"example.com.",Name:"app.example.com.",Type:"A",AliasTarget:null}),name:p=>p.Name,
  fields:[{k:"Name",label:"Tên",type:"text"},{k:"HostedZoneName",label:"Hosted zone",type:"text"},{k:"AliasTarget.DNSName",label:"Alias tới",type:"ref",to:["AWS::ElasticLoadBalancingV2::LoadBalancer","AWS::CloudFront::Distribution"],att:"DNSName"}],
  rel:{AliasTarget:{kind:"alias",label:"alias"}}});
/* ---------------- databases ---------------- */
def("AWS::RDS::DBInstance",{label:"RDS database",short:"RDS",cat:"db",
  doc:"Database quan hệ (PostgreSQL, MySQL) do AWS quản lý: backup, patch, failover. Chạy theo giờ như EC2. Nên đặt ở private subnet, chỉ mở cổng cho security group của app.",
  defaults:id=>({Engine:"postgres",EngineVersion:"16",DBInstanceClass:"db.t3.micro",AllocatedStorage:20,MultiAZ:false,PubliclyAccessible:false,MasterUsername:"app",ManageMasterUserPassword:true,VPCSecurityGroups:[]}),
  name:p=>p.DBInstanceIdentifier||p.Engine,
  fields:[{k:"Engine",label:"Engine",type:"select",options:["postgres","mysql"]},{k:"DBInstanceClass",label:"Instance class",type:"select",options:Object.keys(RDS_TYPES)},{k:"AllocatedStorage",label:"Dung lượng (GB)",type:"number",min:20},
    {k:"MultiAZ",label:"Multi-AZ",type:"select",options:[[false,"Không (1 AZ)"],[true,"Có (standby ở AZ khác, giá ×2)"]],bool:true},{k:"PubliclyAccessible",label:"Public",type:"select",options:[[false,"Không"],[true,"Có (không nên)"]],bool:true},
    {k:"VPCSecurityGroups",label:"Security group",type:"refs",to:["AWS::EC2::SecurityGroup"],att:"GroupId"}],
  rel:{"VPCSecurityGroups.*":{kind:"secured",label:"SG"}}});
def("AWS::RDS::DBSubnetGroup",{label:"DB subnet group",short:"DSG",cat:"db",edge:true,doc:"Các subnet mà RDS được đặt vào.",defaults:id=>({DBSubnetGroupDescription:kebab(id),SubnetIds:[]})});
def("AWS::ElastiCache::CacheCluster",{label:"ElastiCache (Redis)",short:"RDS⚡",cat:"db",
  doc:"Cache trong bộ nhớ đặt trước database: request trúng cache không cần hỏi RDS, nên RDS nhẹ hơn và nhanh hơn. Chạy theo giờ.",
  defaults:()=>({Engine:"redis",CacheNodeType:"cache.t3.micro",NumCacheNodes:1,VpcSecurityGroupIds:[]}),meta:{HitRatio:0.8},
  fields:[{k:"CacheNodeType",label:"Node type",type:"select",options:Object.keys(CACHE_TYPES)},{k:"@HitRatio",label:"Tỉ lệ trúng cache (0–1)",type:"number",step:"0.05",min:0,max:1},{k:"VpcSecurityGroupIds",label:"Security group",type:"refs",to:["AWS::EC2::SecurityGroup"],att:"GroupId"}],
  rel:{"VpcSecurityGroupIds.*":{kind:"secured",label:"SG"}}});
T["AWS::ElastiCache::CacheCluster"].short="EC⚡";

/* ---------------- placement + network helpers ---------------- */
const SG_PATH={"AWS::EC2::Instance":"SecurityGroupIds","AWS::ElasticLoadBalancingV2::LoadBalancer":"SecurityGroups","AWS::RDS::DBInstance":"VPCSecurityGroups","AWS::ElastiCache::CacheCluster":"VpcSecurityGroupIds"};
const sgsOf=id=>{const n=nodeOf(id);if(!n)return[];const p=SG_PATH[n.type];return p?arr(getP(n.props,p)).map(refId).filter(Boolean):[]};
function subnetsOf(n){if(!n)return[];switch(n.type){
  case"AWS::EC2::Instance":return[refId(n.props.SubnetId)].filter(Boolean);
  case"AWS::ElasticLoadBalancingV2::LoadBalancer":return arr(n.props.Subnets).map(refId).filter(Boolean);
  case"AWS::RDS::DBInstance":{const g=nodeOf(refId(n.props.DBSubnetGroupName));return g?arr(g.props.SubnetIds).map(refId).filter(Boolean):[]}
  case"AWS::Lambda::Function":return arr(getP(n.props,"VpcConfig.SubnetIds")).map(refId).filter(Boolean)}
  if(typeof STREAM_SUBNETS!=="undefined"&&STREAM_SUBNETS[n.type])return arr(getP(n.props,STREAM_SUBNETS[n.type])).map(refId).filter(Boolean);return[]}
function vpcOf(n){if(!n)return null;if(n.type==="AWS::EC2::VPC")return n.id;if(["AWS::EC2::Subnet","AWS::EC2::SecurityGroup","AWS::ElasticLoadBalancingV2::TargetGroup"].includes(n.type))return refId(n.props.VpcId);
  const s=subnetsOf(n)[0];if(s)return vpcOf(nodeOf(s));const g=sgsOf(n.id)[0];return g?refId((nodeOf(g)||{props:{}}).props.VpcId):null}
const igwOf=vpc=>Object.keys({...M.res,...M.manual}).map(nodeOf).find(x=>x&&x.type==="AWS::EC2::VPCGatewayAttachment"&&refId(x.props.VpcId)===vpc);
const isPublicSubnet=s=>{const n=nodeOf(s);return!!n&&n.props.MapPublicIpOnLaunch===true&&!!igwOf(refId(n.props.VpcId))};
const dbPort=n=>n.type==="AWS::ElastiCache::CacheCluster"?6379:n.props.Engine==="mysql"?3306:5432;
const appPort=n=>n.type==="AWS::EC2::Instance"?+(getP(n.raw,"Metadata.CloudLab.AppPort")||80):n.type==="AWS::RDS::DBInstance"||n.type==="AWS::ElastiCache::CacheCluster"?dbPort(n):80;
/* is traffic from `src` ({internet:true} or {node:id}) allowed into dst on port? returns {ok, why} */
function sgAllows(dstId,port,src){const dst=nodeOf(dstId),sgs=sgsOf(dstId),srcSgs=src.node?sgsOf(src.node):[];
  const label=x=>src.internet?"Internet (0.0.0.0/0)":x;
  if(!sgs.length)return src.internet?{ok:false,why:`${dstId} chưa gắn security group nên Internet không vào được`}:{ok:true};
  for(const g of sgs){for(const r of arr(getP(nodeOf(g)||{props:{}},"props.SecurityGroupIngress"))){const proto=String(r.IpProtocol);
      if(!(proto==="-1"||((proto==="tcp"||proto==="6")&&port>=+r.FromPort&&port<=+(r.ToPort??r.FromPort))))continue;
      if(r.CidrIp==="0.0.0.0/0")return{ok:true,by:`${g} · ${proto}/${portOfRule(r)} từ 0.0.0.0/0`,open:true};
      if(src.internet&&src.ip&&r.CidrIp&&typeof ip4==="function"){const c=ip4(r.CidrIp),h=ip4(src.ip+"/32");if(c&&h&&cidrIn(h,c))return{ok:true,by:`${g} · từ ${r.CidrIp}`}}
      if(!src.internet&&r.CidrIp)return{ok:true,by:`${g} · từ ${r.CidrIp}`};
      const s=refId(r.SourceSecurityGroupId);if(s&&srcSgs.includes(s))return{ok:true,by:`${g} · từ ${s}`}}}
  return{ok:false,why:`Security group ${sgs.join(", ")} không cho phép tcp/${port} từ ${src.internet?(src.ip?"IP "+src.ip:"Internet"):(srcSgs.join(", ")||src.node||"?")}`}}
function reachFromInternet(id){const n=nodeOf(id);
  if(n.type==="AWS::ElasticLoadBalancingV2::LoadBalancer"){if(n.props.Scheme==="internal")return{ok:false,why:"Load balancer là internal nên không nhận traffic từ Internet (đổi Scheme sang internet-facing)"};const ss=subnetsOf(n);
    if(!ss.length)return{ok:false,why:"Load balancer chưa có subnet (nối nó tới 2 public subnet ở 2 AZ)"};if(!ss.some(isPublicSubnet))return{ok:false,why:"Subnet của load balancer không phải public (cần chọn Public subnet và gắn internet gateway vào VPC)"};return{ok:true}}
  if(n.type==="AWS::EC2::Instance"){const s=subnetsOf(n)[0];if(!s)return{ok:true,note:"default VPC"};if(!isPublicSubnet(s))return{ok:false,why:`${id} ở private subnet ${s} nên không có IP public (đặt vào public subnet, hoặc cho traffic đi qua load balancer)`};return{ok:true}}
  return{ok:true}}
function targetsOf(albId){const out=[];for(const id of Object.keys(M.res)){const r=M.res[id];if(r.Type!=="AWS::ElasticLoadBalancingV2::Listener"||refId(r.Properties.LoadBalancerArn)!==albId)continue;
    for(const a of arr(r.Properties.DefaultActions)){const tg=refId(a&&a.TargetGroupArn),tn=nodeOf(tg);if(!tn)continue;for(const t of arr(tn.props.Targets)){const x=refId(t&&t.Id);if(x)out.push({tg,id:x,port:+(t.Port||tn.props.Port||80)})}}}return out}

/* ---------------- connect rules for these types ---------------- */
function ensureSg(id){const n=nodeOf(id);return sgsOf(id)[0]||null}
function sgRule(dst,src,port){return{text:`Thêm inbound rule vào ${dst}: tcp/${port} từ ${src}`,apply:()=>{const g=nodeOf(dst);g.props.SecurityGroupIngress=arr(g.props.SecurityGroupIngress);if(!g.props.SecurityGroupIngress.some(r=>refId(r.SourceSecurityGroupId)===src&&+r.FromPort===port))g.props.SecurityGroupIngress.push({IpProtocol:"tcp",FromPort:port,ToPort:port,SourceSecurityGroupId:GA(src,"GroupId")})}}}
function addUse(A,b){A.raw.Metadata=A.raw.Metadata||{};A.raw.Metadata.CloudLab=A.raw.Metadata.CloudLab||{};const u=arr(A.raw.Metadata.CloudLab.Uses);if(!u.some(x=>refId(x)===b))u.push(R(b));A.raw.Metadata.CloudLab.Uses=u}
function CONNECT_X(a,b,A,B,say){const ta=A.type,tb=B.type;
  const sub=(path,att)=>()=>{const v=arr(getP(A.props,path));if(!v.some(x=>refId(x)===b))v.push(att?GA(b,att):R(b));setP(A.props,path,v)};
  if(ta==="CloudLab::Client"&&["AWS::ElasticLoadBalancingV2::LoadBalancer","AWS::CloudFront::Distribution","AWS::Route53::RecordSet","AWS::EC2::Instance"].includes(tb))return say("gửi request tới "+B.def.label,()=>{A.props.Target=R(b);delete A.props.Action;delete A.props.Key});
  if(tb==="AWS::EC2::VPC"&&["AWS::EC2::Subnet","AWS::EC2::SecurityGroup","AWS::ElasticLoadBalancingV2::TargetGroup"].includes(ta))return say("thuộc VPC này",()=>{A.props.VpcId=R(b);
    if(ta==="AWS::EC2::Subnet"){const vc=ip4(B.props.CidrBlock),c=ip4(A.props.CidrBlock),clash=allNodes().some(s=>s.id!==a&&s.type==="AWS::EC2::Subnet"&&refId(s.props.VpcId)===b&&cidrOverlap(c,ip4(s.props.CidrBlock)));
      if(vc&&(!c||!cidrIn(c,vc)||clash)){const tmp=newSubnetIn(b);A.props.CidrBlock=M.res[tmp].Properties.CidrBlock;A.props.AvailabilityZone=M.res[tmp].Properties.AvailabilityZone;delete M.res[tmp]}}});
  if(ta==="AWS::EC2::InternetGateway"&&tb==="AWS::EC2::VPC")return say("gắn vào VPC (VPCGatewayAttachment)",()=>{M.res[freeId(a+"Attach")]={Type:"AWS::EC2::VPCGatewayAttachment",Properties:{VpcId:R(b),InternetGatewayId:R(a)}}});
  if(tb==="AWS::EC2::SecurityGroup"&&SG_PATH[ta])return say("gắn security group",sub(SG_PATH[ta],"GroupId"));
  if(ta==="AWS::EC2::SecurityGroup"&&tb==="AWS::EC2::SecurityGroup")return say(`cho phép ${a} vào ${b} (tcp/80)`,()=>sgRule(b,a,80).apply());
  if(tb==="AWS::EC2::Subnet"){
    if(ta==="AWS::EC2::Instance")return say("đặt vào subnet",()=>{A.props.SubnetId=R(b)});
    if(ta==="AWS::ElasticLoadBalancingV2::LoadBalancer")return say("thêm subnet cho load balancer",sub("Subnets"));
    if(ta==="AWS::RDS::DBInstance")return say("đặt RDS vào subnet (DB subnet group)",()=>{let g=refId(A.props.DBSubnetGroupName);if(!g||!nodeOf(g)){g=freeId(a+"Subnets");M.res[g]={Type:"AWS::RDS::DBSubnetGroup",Properties:{DBSubnetGroupDescription:kebab(a)+" subnets",SubnetIds:[]}};A.props.DBSubnetGroupName=R(g)}const G=nodeOf(g);if(!G.props.SubnetIds.some(x=>refId(x)===b))G.props.SubnetIds.push(R(b))})}
  if(ta==="AWS::ElasticLoadBalancingV2::LoadBalancer"&&tb==="AWS::ElasticLoadBalancingV2::TargetGroup")return say("listener HTTP :80 → target group",()=>{M.res[freeId(a+"Listener")]={Type:"AWS::ElasticLoadBalancingV2::Listener",Properties:{LoadBalancerArn:R(a),Port:80,Protocol:"HTTP",DefaultActions:[{Type:"forward",TargetGroupArn:R(b)}]}}});
  if(ta==="AWS::ElasticLoadBalancingV2::LoadBalancer"&&tb==="AWS::EC2::Instance"){const asg=sgsOf(a)[0],bsg=sgsOf(b)[0],port=appPort(B);
    return say("chia tải tới instance (target group + listener)",grant=>{let tg=Object.keys(M.res).find(k=>M.res[k].Type==="AWS::ElasticLoadBalancingV2::TargetGroup"&&targetsOf(a).some(t=>t.tg===k));
      if(!tg){tg=freeId(a+"Targets");M.res[tg]={Type:"AWS::ElasticLoadBalancingV2::TargetGroup",Properties:{Port:port,Protocol:"HTTP",VpcId:vpcOf(B)?R(vpcOf(B)):null,TargetType:"instance",HealthCheckPath:"/",Targets:[]}};M.pos[tg]=[(M.pos[a][0]+M.pos[b][0])/2,(M.pos[a][1]+M.pos[b][1])/2+150];
        M.res[freeId(a+"Listener")]={Type:"AWS::ElasticLoadBalancingV2::Listener",Properties:{LoadBalancerArn:R(a),Port:80,Protocol:"HTTP",DefaultActions:[{Type:"forward",TargetGroupArn:R(tg)}]}}}
      const T_=M.res[tg].Properties;T_.Targets=arr(T_.Targets);if(!T_.Targets.some(t=>refId(t.Id)===b))T_.Targets.push({Id:R(b)});if(grant&&asg&&bsg)sgRule(bsg,asg,port).apply()},asg&&bsg?{text:sgRule(bsg,asg,port).text}:null)}
  if(ta==="AWS::ElasticLoadBalancingV2::TargetGroup"&&tb==="AWS::EC2::Instance")return say("thêm target",()=>{A.props.Targets=arr(A.props.Targets);if(!A.props.Targets.some(t=>refId(t.Id)===b))A.props.Targets.push({Id:R(b)})});
  if(ta==="AWS::EC2::Instance"&&tb==="AWS::IAM::Role")return say("gắn role cho instance (instance profile)",()=>{const p=freeId(b+"Profile");M.res[p]={Type:"AWS::IAM::InstanceProfile",Properties:{Roles:[R(b)]}};A.props.IamInstanceProfile=R(p);
    const tr=nodeOf(b).props.AssumeRolePolicyDocument;if(tr)tr.Statement=[{Effect:"Allow",Principal:{Service:"ec2.amazonaws.com"},Action:"sts:AssumeRole"}]});
  if(ta==="AWS::EC2::Instance"&&(tb==="AWS::RDS::DBInstance"||tb==="AWS::ElastiCache::CacheCluster")){const asg=sgsOf(a)[0],bsg=sgsOf(b)[0],port=dbPort(B);
    return say(`app gọi ${B.def.label} (tcp/${port})`,grant=>{addUse(A,b);if(grant&&asg&&bsg)sgRule(bsg,asg,port).apply()},asg&&bsg?{text:sgRule(bsg,asg,port).text}:null)}
  if(ta==="AWS::EC2::Instance"&&USE_ENV[tb]){const prof=nodeOf(refId(A.props.IamInstanceProfile)),role=prof&&refId(arr(prof.props.Roles)[0]);
    const act={"AWS::S3::Bucket":["s3:GetObject","s3:PutObject"],"AWS::DynamoDB::Table":["dynamodb:PutItem"],"AWS::SNS::Topic":["sns:Publish"],"AWS::SQS::Queue":["sqs:SendMessage"]}[tb],res=tb==="AWS::S3::Bucket"?{"Fn::Sub":"${"+b+".Arn}/*"}:tb==="AWS::SNS::Topic"?R(b):GA(b);
    return say("app dùng "+B.def.label,grant=>{addUse(A,b);if(grant&&role)addStmt(role,act,res,"Use"+b)},role?{actions:act,role}:null)}
  if(ta==="AWS::CloudFront::Distribution"&&["AWS::S3::Bucket","AWS::ElasticLoadBalancingV2::LoadBalancer","AWS::ApiGatewayV2::Api"].includes(tb))return say("origin của CloudFront",()=>{const dc=A.props.DistributionConfig;dc.Origins=arr(dc.Origins);
    const o=tb==="AWS::S3::Bucket"?{Id:b,DomainName:GA(b,"RegionalDomainName"),S3OriginConfig:{OriginAccessIdentity:""}}:{Id:b,DomainName:GA(b,tb==="AWS::ApiGatewayV2::Api"?"ApiEndpoint":"DNSName"),CustomOriginConfig:{OriginProtocolPolicy:"https-only"}};
    dc.Origins=dc.Origins.filter(x=>x.Id!==b).concat([o]);if(!dc.DefaultCacheBehavior.TargetOriginId)dc.DefaultCacheBehavior.TargetOriginId=b});
  if(ta==="AWS::Route53::RecordSet"&&["AWS::ElasticLoadBalancingV2::LoadBalancer","AWS::CloudFront::Distribution"].includes(tb))return say("alias record → "+B.def.label,()=>{A.props.AliasTarget={DNSName:GA(b,tb==="AWS::CloudFront::Distribution"?"DomainName":"DNSName"),HostedZoneId:tb==="AWS::CloudFront::Distribution"?"Z2FDTNDATAQYW2":GA(b,"CanonicalHostedZoneID")}});
  return null}
/* next free /24 inside the VPC, alternating AZs; used when something is dropped into a VPC that has no subnet under the cursor */
function newSubnetIn(vpc){const v=nodeOf(vpc),vc=ip4(v&&v.props.CidrBlock)||ip4("10.0.0.0/16"),used=allNodes().filter(n=>n.type==="AWS::EC2::Subnet"&&refId(n.props.VpcId)===vpc);
  let cidr=null;for(let k=1;k<256&&!cidr;k++){const net=vc.net+k*256;if(net+256>vc.net+vc.size)break;const c=`${net>>>24}.${(net>>16)&255}.${(net>>8)&255}.0/24`;if(!used.some(s=>cidrOverlap(ip4(c),ip4(s.props.CidrBlock))))cidr=c}
  const id=freeId("Subnet"),az=AZS[used.length%2];
  M.res[id]={Type:"AWS::EC2::Subnet",Properties:{VpcId:{Ref:vpc},CidrBlock:cidr||"10.0.1.0/24",AvailabilityZone:az,MapPublicIpOnLaunch:false,Tags:[{Key:"Name",Value:kebab(id)}]}};return id}
const WHY_X={"AWS::EC2::VPC":"(hãy nối subnet hoặc security group tới VPC)","AWS::EC2::Subnet":"VPC","AWS::EC2::InternetGateway":"VPC","AWS::EC2::SecurityGroup":"VPC hoặc security group khác",
  "AWS::EC2::Instance":"subnet, security group, role, RDS, ElastiCache, S3, DynamoDB, SNS, SQS","AWS::ElasticLoadBalancingV2::LoadBalancer":"EC2, target group, subnet, security group",
  "AWS::ElasticLoadBalancingV2::TargetGroup":"EC2 hoặc VPC","AWS::RDS::DBInstance":"subnet, security group","AWS::ElastiCache::CacheCluster":"security group","AWS::CloudFront::Distribution":"S3, load balancer hoặc API","AWS::Route53::RecordSet":"load balancer hoặc CloudFront"};
Object.assign(BASE_ID,{"AWS::EC2::VPC":"Vpc","AWS::EC2::Subnet":"Subnet","AWS::EC2::InternetGateway":"Igw","AWS::EC2::SecurityGroup":"Sg","AWS::EC2::Instance":"Web","AWS::ElasticLoadBalancingV2::LoadBalancer":"Alb",
  "AWS::ElasticLoadBalancingV2::TargetGroup":"Targets","AWS::RDS::DBInstance":"Db","AWS::ElastiCache::CacheCluster":"Cache","AWS::CloudFront::Distribution":"Cdn","AWS::Route53::RecordSet":"Dns"});
