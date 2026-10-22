"use strict";
/* AWS pack · realtime and messaging lessons: WebSocket API pricing and permissions; Amazon MQ vs MSK sizing and cost.
   Same bank (Ngân hàng An Phát), prices from src/prices.js. */
const monthlyAws=id=>{const n=nodeOf(id);return n?(awsPrice(n).h||0)*HOURS_MO:0};
const wsMonth=(sec)=>probe(()=>{if(!stackUp())deploy();RT.q=[];for(const k in RT.n)RT.n[k]={cost:0,m:{},tk:{},series:[],last:null};RT.flow={};RT.why={};const t0=RT.total;runFor(sec,60);return(RT.total-t0)*MONTH/sec});
const L_WSAPI={id:"wsapi",step:0,sub:"WebSocket · giá theo message",title:"Bảng tỷ giá realtime qua WebSocket API",tag:"API Gateway WebSocket",who:["T","Tú · sản phẩm"],speed:2,
  scenario:"App mobile mới có bảng tỷ giá cập nhật tức thì cho 2.000 khách. Mở bảng thì có kết nối nhưng không thấy giá nào nhảy. Bên tài chính hỏi thêm: ước tính tiền API Gateway mỗi tháng là bao nhiêu?",
  goal:"Khách nhận được giá mới đẩy xuống; Lambda chỉ có đúng quyền đẩy tin vào API này; chi phí WebSocket không quá $200/tháng.",
  concepts:["WebSocket API","route $default","@connections API","execute-api:ManageConnections","giá theo phút-kết nối và message"],
  yaml:`Description: Bảng tỷ giá realtime
Metadata:
  CloudLab:
    External:
      Customers:
        Type: CloudLab::Client
        Properties: {Target: !Ref RateSocket, Protocol: websocket, Connections: 2000, MessagesPerMinute: 12}
Resources:
  RateSocket:
    Type: AWS::ApiGatewayV2::Api
    Properties: {Name: fx-rates, ProtocolType: WEBSOCKET, RouteSelectionExpression: $request.body.action}
  RateIntegration:
    Type: AWS::ApiGatewayV2::Integration
    Properties:
      ApiId: !Ref RateSocket
      IntegrationType: AWS_PROXY
      IntegrationUri: !Sub arn:aws:apigateway:\${AWS::Region}:lambda:path/2015-03-31/functions/\${RateFn.Arn}/invocations
  RateRoute:
    Type: AWS::ApiGatewayV2::Route
    Properties: {ApiId: !Ref RateSocket, RouteKey: $default, Target: !Sub "integrations/\${RateIntegration}"}
  RateStage:
    Type: AWS::ApiGatewayV2::Stage
    Properties: {ApiId: !Ref RateSocket, StageName: prod, AutoDeploy: true}
  RateFn:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: fx-push
      Runtime: python3.12
      Handler: index.handler
      Code: {ZipFile: "def handler(event, context):\\n    return {'statusCode': 200}"}
      MemorySize: 128
      Timeout: 10
      Role: !GetAtt RateRole.Arn
  RateRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: fx-push-role
${ASSUME_LAMBDA}
      ManagedPolicyArns: [${BASIC}]
${API_INVOKE("RateSocket","RateFn")}`,layout:{Customers:[40,120],RateSocket:[400,120],RateFn:[760,120],RateRole:[760,400]},
  explain:{Customers:"2.000 khách mở bảng tỷ giá, mỗi người nhận 12 lần cập nhật mỗi phút.",RateSocket:"WebSocket API: giữ kết nối với từng khách. Tính tiền theo phút-kết nối và theo từng message.",
    RateFn:"Lambda đẩy tỷ giá mới xuống mọi kết nối qua @connections API.",RateRole:"Role của Lambda: mới có quyền ghi log."},
  tasks:[{t:"Khách nhận được giá mới",c:"Lambda đẩy tin xuống kết nối không bị AccessDenied.",test:()=>{const S=simStats(300,60);return((S.Customers||{m:{}}).m.recv||0)>0&&!((S.Customers||{m:{}}).m.err)}},
    {t:"Lambda chỉ đẩy tin vào đúng API này",c:"Có execute-api:ManageConnections trên API fx-rates; không có execute-api:* trên mọi API.",test:()=>evalRole("RateRole","execute-api:ManageConnections",`arn:aws:execute-api:${REGION}:${ACCT}:fx-rates/prod/POST/@connections/x`).allow&&!evalRole("RateRole","execute-api:ManageConnections",`arn:aws:execute-api:${REGION}:${ACCT}:other-api/prod/POST/@connections/x`).allow&&!evalRole("RateRole","execute-api:Invoke",`arn:aws:execute-api:${REGION}:${ACCT}:other-api/prod/GET/x`).allow},
    {t:"WebSocket ≤ $200/tháng",c:"Chạy 30 phút mô phỏng, quy ra tháng; vẫn đủ 2.000 khách.",test:()=>wsMonth(1800)<=200&&(+nodeOf("Customers").props.Connections||0)>=2000}],
  hints:()=>["Bấm ▶ Chạy, bấm mũi tên RateSocket → RateFn: lỗi AccessDenied khi Lambda đẩy tin.","Nối RateSocket → RateFn để CloudLab đề nghị cấp execute-api:ManageConnections, hoặc thêm statement đó vào RateRole với Resource là API này (!Sub arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${RateSocket}/*).","Xem Giá niêm yết của RateSocket: tiền chủ yếu nằm ở số message. Tỷ giá ngân hàng chỉ đổi mỗi phút: đẩy 1 lần/phút thay vì 12."],
  diagnose(n){if(!L_WSAPI.tasks[1].test())return["Khách có kết nối nhưng không thấy giá nhảy.","Bấm mũi tên RateSocket → RateFn.","RateRole thiếu execute-api:ManageConnections trên API này nên Lambda không gọi được @connections."][Math.min(n,2)];
    return["Đẩy được tin, nhưng ước tính hơn $200/tháng.","Giá niêm yết của RateSocket.",`2.000 khách × 12 tin/phút ≈ ${num(2000*12*60*HOURS_MO)} message mỗi tháng × $1,30/triệu. Giảm số lần đẩy (MessagesPerMinute của Customers): tỷ giá không đổi 12 lần mỗi phút.`][Math.min(n,2)]},
  solve(){edit("ManageConnections + 1 tin/phút",()=>{addStmt("RateRole",["execute-api:ManageConnections"],{"Fn::Sub":"arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${RateSocket}/*"},"PushRates");nodeOf("Customers").props.MessagesPerMinute=1})},
  pass:"API Gateway WebSocket tính tiền theo phút-kết nối và từng message, nên chi phí tăng theo số khách × tần suất đẩy. Đẩy ít mà đúng lúc (khi giá thật sự đổi) quan trọng hơn chọn dịch vụ. Trên Google Cloud, Cloud Run tính theo instance giữ kết nối thay vì theo message: xem trang So sánh giá."};
const L_MQ={id:"mqmsk",step:0,sub:"RabbitMQ · Kafka · chi phí",title:"Hàng đợi lệnh: Amazon MQ và MSK",tag:"Amazon MQ + MSK",who:["M","Minh · mentor"],speed:2,
  scenario:"App đặt lệnh đẩy lệnh vào RabbitMQ (Amazon MQ) và ghi nhật ký vào Kafka cho bộ phận kiểm toán. Lệnh nào cũng lỗi, và bảng ước tính chi phí cho môi trường thử nghiệm đã gần $1.500/tháng.",
  goal:"Lệnh đặt đi qua cả hàng đợi và luồng kiểm toán; broker chỉ mở cho app; tiền messaging cố định của môi trường thử nghiệm ≤ $250/tháng.",
  concepts:["Amazon MQ for RabbitMQ (AMQPS 5671)","MSK provisioned vs Serverless","security group theo nguồn","giá cố định theo giờ"],
  yaml:`Description: Hàng đợi lệnh + nhật ký kiểm toán
Metadata:
  CloudLab:
    External:
      Traders:
        Type: CloudLab::Client
        Properties: {Target: !Ref OrderApp, RatePerSecond: 50, Port: 80}
Resources:
  Vpc: {Type: AWS::EC2::VPC, Properties: {CidrBlock: 10.0.0.0/16, EnableDnsHostnames: true, EnableDnsSupport: true}}
  PublicA: {Type: AWS::EC2::Subnet, Properties: {VpcId: !Ref Vpc, CidrBlock: 10.0.1.0/24, AvailabilityZone: ap-southeast-2a, MapPublicIpOnLaunch: true}}
  PrivateA: {Type: AWS::EC2::Subnet, Properties: {VpcId: !Ref Vpc, CidrBlock: 10.0.11.0/24, AvailabilityZone: ap-southeast-2a, MapPublicIpOnLaunch: false}}
  PrivateB: {Type: AWS::EC2::Subnet, Properties: {VpcId: !Ref Vpc, CidrBlock: 10.0.12.0/24, AvailabilityZone: ap-southeast-2b, MapPublicIpOnLaunch: false}}
  Igw: {Type: AWS::EC2::InternetGateway}
  IgwAttach: {Type: AWS::EC2::VPCGatewayAttachment, Properties: {VpcId: !Ref Vpc, InternetGatewayId: !Ref Igw}}
  PublicRt: {Type: AWS::EC2::RouteTable, Properties: {VpcId: !Ref Vpc}}
  PublicRtInternet: {Type: AWS::EC2::Route, DependsOn: IgwAttach, Properties: {RouteTableId: !Ref PublicRt, DestinationCidrBlock: 0.0.0.0/0, GatewayId: !Ref Igw}}
  PublicARoutes: {Type: AWS::EC2::SubnetRouteTableAssociation, Properties: {SubnetId: !Ref PublicA, RouteTableId: !Ref PublicRt}}
  AppSg:
    Type: AWS::EC2::SecurityGroup
    Properties: {GroupDescription: order-app, VpcId: !Ref Vpc, SecurityGroupIngress: [{IpProtocol: tcp, FromPort: 80, ToPort: 80, CidrIp: 0.0.0.0/0}]}
  BrokerSg:
    Type: AWS::EC2::SecurityGroup
    Properties: {GroupDescription: brokers, VpcId: !Ref Vpc, SecurityGroupIngress: []}
  AppRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: order-app
      AssumeRolePolicyDocument: {Version: "2012-10-17", Statement: [{Effect: Allow, Principal: {Service: ec2.amazonaws.com}, Action: sts:AssumeRole}]}
      Policies:
        - PolicyName: kafka-audit
          PolicyDocument: {Version: "2012-10-17", Statement: [{Sid: Audit, Effect: Allow, Action: [kafka-cluster:Connect, kafka-cluster:WriteData, kafka-cluster:DescribeTopic], Resource: "*"}]}
  AppProfile: {Type: AWS::IAM::InstanceProfile, Properties: {Roles: [!Ref AppRole]}}
  OrderApp:
    Type: AWS::EC2::Instance
    Metadata:
      CloudLab: {AppPort: 80, Uses: [!Ref Orders, !Ref Audit]}
    Properties: {InstanceType: t3.small, ImageId: "{{resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64}}", SubnetId: !Ref PublicA, SecurityGroupIds: [!GetAtt AppSg.GroupId], IamInstanceProfile: !Ref AppProfile}
  Orders:
    Type: AWS::AmazonMQ::Broker
    Properties: {BrokerName: orders, EngineType: RABBITMQ, EngineVersion: "3.13", HostInstanceType: mq.m5.large, DeploymentMode: CLUSTER_MULTI_AZ, PubliclyAccessible: false, AutoMinorVersionUpgrade: true, SubnetIds: [!Ref PrivateA, !Ref PrivateB], SecurityGroups: [!GetAtt BrokerSg.GroupId], Users: [{Username: app, Password: "{{resolve:secretsmanager:mq-app:SecretString:password}}"}]}
  Audit:
    Type: AWS::MSK::ServerlessCluster
    Metadata:
      CloudLab: {Partitions: 6}
    Properties: {ClusterName: audit, VpcConfigs: [{SubnetIds: [!Ref PrivateA, !Ref PrivateB], SecurityGroups: [!GetAtt BrokerSg.GroupId]}], ClientAuthentication: {Sasl: {Iam: {Enabled: true}}}}
`,layout:{Traders:[40,140],Vpc:[340,40],PublicA:[380,110],OrderApp:[410,170],PrivateA:[760,110],PrivateB:[760,420],Orders:[790,170],Audit:[790,480],AppSg:[380,700],BrokerSg:[720,860],AppRole:[1180,700],PublicRt:[380,940],Igw:[40,500]},
  explain:{Traders:"Nhà đầu tư đặt lệnh, 50 lệnh mỗi giây.",OrderApp:"App đặt lệnh: đẩy lệnh vào RabbitMQ, ghi một bản vào Kafka cho kiểm toán.",Orders:"Amazon MQ for RabbitMQ: đang là cluster 3 × mq.m5.large ở 3 AZ.",
    Audit:"MSK Serverless: Kafka không chọn broker, có phí cluster-giờ.",BrokerSg:"Security group của cả hai broker: chưa có inbound rule nào.",AppRole:"Role của app: được ghi vào Kafka (IAM)."},
  tasks:[{t:"Chỉ app vào được broker",c:"BrokerSg mở 5671 (AMQPS) và 9098 (Kafka IAM) từ AppSg, không mở cho 0.0.0.0/0.",test:()=>sgAllows("Orders",5671,{node:"OrderApp"}).ok&&sgAllows(nodeOf("Audit")?"Audit":(allNodes().find(n=>/^AWS::MSK::/.test(n.type))||{}).id,9098,{node:"OrderApp"}).ok&&!arr(getP(nodeOf("BrokerSg").props,"SecurityGroupIngress")).some(r=>r.CidrIp==="0.0.0.0/0")},
    {t:"Lệnh đặt thành công",c:"Hơn 95% request qua cả hàng đợi và Kafka.",test:()=>{const S=simStats(120,10);const ok=okOf(S,"Traders"),e=errOf(S,"Traders");return ok>0&&e/(ok+e)<0.05}},
    {t:"Messaging cố định ≤ $250/tháng",c:"Tổng giá niêm yết của broker RabbitMQ và Kafka; vẫn có cả hai.",test:()=>{const mq=allNodes().filter(n=>n.type==="AWS::AmazonMQ::Broker"),k=allNodes().filter(n=>/^AWS::MSK::/.test(n.type));return mq.length>0&&k.length>0&&[...mq,...k].reduce((a,n)=>a+monthlyAws(n.id),0)<=250}}],
  hints:()=>["Bấm ▶ Chạy rồi bấm mũi tên OrderApp → Orders: security group chặn.","Nối OrderApp → Orders và OrderApp → Audit để CloudLab đề nghị mở đúng cổng từ AppSg.","Xem Giá niêm yết: cluster 3 × mq.m5.large và MSK Serverless (phí cluster-giờ) là cỡ production. Môi trường thử: một node mq.m7g.medium, Kafka 2 broker kafka.t3.small."],
  diagnose(n){if(!L_MQ.tasks[0].test())return["Mọi lệnh đều lỗi.","Mũi tên OrderApp → Orders / Audit.","BrokerSg chưa có inbound rule: mở tcp/5671 và tcp/9098 với nguồn là AppSg (không phải 0.0.0.0/0)."][Math.min(n,2)];
    return["Chạy được nhưng quá đắt cho môi trường thử.","Giá niêm yết của Orders và Audit.",`Cluster 3 × mq.m5.large ≈ ${money(monthlyAws("Orders"))}/tháng; MSK Serverless có phí cluster-giờ ≈ ${money(PRICES.aws.mskSl.clusterH*HOURS_MO)}/tháng dù gần như không có dữ liệu. Đổi sang 1 × mq.m7g.medium và MSK có broker 2 × kafka.t3.small.`][Math.min(n,2)]},
  solve(){edit("SG từ AppSg, MQ 1 node m7g.medium, MSK 2 × t3.small",()=>{sgRule("BrokerSg","AppSg",5671).apply();sgRule("BrokerSg","AppSg",9098).apply();
    const q=nodeOf("Orders");q.props.HostInstanceType="mq.m7g.medium";q.props.DeploymentMode="SINGLE_INSTANCE";q.props.SubnetIds=[R("PrivateA")];
    delete M.res.Audit;M.res.Audit={Type:"AWS::MSK::Cluster",Properties:{ClusterName:"audit",KafkaVersion:"3.6.0",NumberOfBrokerNodes:2,BrokerNodeGroupInfo:{InstanceType:"kafka.t3.small",ClientSubnets:[R("PrivateA"),R("PrivateB")],SecurityGroups:[GA("BrokerSg","GroupId")],StorageInfo:{EBSStorageInfo:{VolumeSize:100}}},ClientAuthentication:{Sasl:{Iam:{Enabled:true}}}}}})},
  pass:"Messaging được quản lý trả theo giờ chạy, có hay không có message. Cỡ production (cluster 3 AZ, Serverless) là để chịu lỗi và tải lớn; môi trường thử dùng cỡ nhỏ nhất rồi tắt khi không dùng. Còn mạng: broker nằm ở private subnet, security group chỉ nhận đúng cổng từ security group của app."};
(function(){const PH="Realtime & messaging";[L_WSAPI,L_MQ].forEach(l=>{l.phase=PH;l.step=LESSONS.length;LESSONS.push(l)})})();
