"use strict";
const ACCT="111122223333",REGION="ap-southeast-2",EMAIL="dat@example.com";
/* Component catalog: AWS resource types (CloudFormation) + external actors (CloudLab::*, kept in Metadata).
   Each type says how it looks, its default properties, how its references become edges, which fields the
   inspector edits, and a short "what is it" text. Simulation behaviour lives in sim.js. */
const kebab=id=>id.replace(/([a-z0-9])([A-Z])/g,"$1-$2").replace(/_/g,"-").toLowerCase();
const MANAGED={
  "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole":{name:"AWSLambdaBasicExecutionRole",st:[{Sid:"Logs",Effect:"Allow",Action:["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"],Resource:"*"}]},
  "arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess":{name:"AmazonS3ReadOnlyAccess",st:[{Sid:"S3Read",Effect:"Allow",Action:["s3:Get*","s3:List*"],Resource:"*"}]},
  "arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess":{name:"AmazonDynamoDBFullAccess",st:[{Sid:"Ddb",Effect:"Allow",Action:["dynamodb:*"],Resource:"*"}]},
  "arn:aws:iam::aws:policy/AdministratorAccess":{name:"AdministratorAccess",st:[{Sid:"All",Effect:"Allow",Action:"*",Resource:"*"}]},
};
const RUNTIMES=["python3.12","nodejs20.x","java21","provided.al2023"];
/* palette groups, in order */
const GROUPS=[["ext","Bên ngoài AWS"],["infra","Mạng & phân phối"],["comp","Compute"],["store","Lưu trữ"],["db","Database"],["notify","Tích hợp"],["sec","Bảo mật"],["mon","Giám sát"],["cost","Chi phí"]];
const T={};
function def(type,spec){T[type]=Object.assign({type,fields:[],rel:{}},spec)}
const R=id=>({Ref:id}),GA=(id,a)=>({"Fn::GetAtt":[id,a||"Arn"]});

/* ---------------- external actors (outside AWS): sources of traffic and sinks of reports ---------------- */
def("CloudLab::Client",{label:"Client / người dùng",short:"⇢",cat:"ext",ext:true,src:true,
  doc:"Người hoặc chương trình gọi vào hệ thống từ Internet: gửi request tới API, hoặc đọc object trong S3. Đặt tần suất để tạo tải khi mô phỏng.",
  defaults:()=>({Target:null,RatePerSecond:1}),
  fields:[{k:"Target",label:"Gọi tới",type:"ref",to:["AWS::ApiGatewayV2::Api","AWS::S3::Bucket","AWS::ElasticLoadBalancingV2::LoadBalancer","AWS::CloudFront::Distribution","AWS::Route53::RecordSet","AWS::EC2::Instance"]},
    {k:"RatePerSecond",label:"Request mỗi giây",type:"number",step:"any",min:0},
    {k:"Action",label:"Thao tác (khi gọi S3)",type:"select",options:["s3:GetObject","s3:PutObject","s3:DeleteObject"],when:p=>p.Target&&tgtType(p.Target)==="AWS::S3::Bucket"},
    {k:"Key",label:"Object key (khi gọi S3)",type:"text",when:p=>p.Target&&tgtType(p.Target)==="AWS::S3::Bucket"},
    {k:"Port",label:"Cổng (khi gọi thẳng EC2)",type:"number",min:1,max:65535,when:p=>p.Target&&tgtType(p.Target)==="AWS::EC2::Instance",help:"80 = web, 22 = SSH."},
    {k:"SourceIp",label:"IP nguồn",type:"text",when:p=>p.Target&&tgtType(p.Target)==="AWS::EC2::Instance",help:"Để so với rule CIDR của security group, ví dụ 203.0.113.10."},
    {k:"As",label:"Danh tính (assume role)",type:"ref",to:["AWS::IAM::Role"],att:"Arn",help:"Để trống = ẩn danh (anonymous)."},
    {k:"Expect",label:"Kỳ vọng",type:"select",options:[["","Nên thành công"],["Deny","Nên bị chặn"]],help:"Chọn “Nên bị chặn” khi request này lẽ ra phải bị từ chối. Mũi tên sẽ tô xanh khi nó bị chặn đúng."}],
  rel:{Target:{kind:"calls",label:"gọi"},As:{kind:"assumes",label:"assume"}}});
def("CloudLab::Uploader",{label:"Uploader",short:"⇪",cat:"ext",ext:true,src:true,
  doc:"Một nguồn đẩy file vào bucket theo lịch, như app di động hay máy quét tài liệu. Mỗi file là một s3:PutObject.",
  defaults:()=>({Target:null,PerHour:60,Prefix:"incoming/",Suffix:".jpg",SizeKB:240}),
  fields:[{k:"Target",label:"Bucket đích",type:"ref",to:["AWS::S3::Bucket"]},{k:"PerHour",label:"File mỗi giờ",type:"number",min:0,step:"any"},
    {k:"Prefix",label:"Prefix của key",type:"text"},{k:"Suffix",label:"Đuôi file",type:"text"},{k:"SizeKB",label:"Cỡ file (KB)",type:"number",min:1}],
  rel:{Target:{kind:"uploads",label:"upload"}}});
def("CloudLab::Inbox",{label:"Hộp thư email",short:"@",cat:"ext",ext:true,sink:true,
  doc:"Hộp thư của bạn. Nhận email từ SNS (thư xác nhận subscription, cảnh báo budget, alarm). Email chỉ tới khi subscription đã được xác nhận.",
  defaults:()=>({Address:EMAIL}),fields:[{k:"Address",label:"Địa chỉ email",type:"text"}]});
def("CloudLab::Monitor",{label:"Monitor / dashboard",short:"▤",cat:"ext",ext:true,sink:true,
  doc:"Bảng theo dõi nhận số liệu từ các khối được nối vào: request, lỗi, thời gian chạy, chi phí. Giống một CloudWatch dashboard đặt trên màn hình.",
  defaults:()=>({Watch:[]}),fields:[{k:"Watch",label:"Theo dõi",type:"refs",to:"*"}],rel:{Watch:{kind:"reports",label:"số liệu",reverse:true}}});

/* ---------------- AWS ---------------- */
def("AWS::ApiGatewayV2::Api",{label:"API Gateway (HTTP API)",short:"API",cat:"notify",
  doc:"Cửa vào HTTPS cho client. Nhận request, chuyển tới integration (thường là Lambda) rồi trả kết quả. Tính tiền theo số request.",
  defaults:id=>({Name:kebab(id),ProtocolType:"HTTP",Target:null}),name:p=>p.Name,
  fields:[{k:"Name",label:"Tên API",type:"text"},{k:"Target",label:"Integration (Lambda)",type:"ref",to:["AWS::Lambda::Function"],att:"Arn"}],
  rel:{Target:{kind:"invokes",label:(p,path,to)=>(nodeOf(to)||{}).type==="AWS::Lambda::Function"?"invoke":"HTTP"}}});
def("AWS::Lambda::Function",{label:"Lambda function",short:"λ",cat:"comp",
  doc:"Đoạn code chạy khi có sự kiện, không cần quản lý server. Chạy bằng quyền của execution role. Tính tiền theo số lần gọi và GB-giây (memory × thời gian).",
  defaults:id=>({FunctionName:kebab(id),Runtime:"python3.12",Handler:"app.handler",MemorySize:128,Timeout:3,Role:null,Environment:{Variables:{}}}),
  meta:{WorkMs:300},name:p=>p.FunctionName,
  fields:[{k:"FunctionName",label:"Tên function",type:"text"},{k:"Runtime",label:"Runtime",type:"select",options:RUNTIMES},
    {k:"MemorySize",label:"Memory (MB)",type:"select",options:[128,256,512,1024,2048],num:true,help:"Thêm memory thì thêm CPU, chạy nhanh hơn."},
    {k:"Timeout",label:"Timeout (giây)",type:"number",min:1,max:900},{k:"Role",label:"Execution role",type:"ref",to:["AWS::IAM::Role"],att:"Arn"},
    {k:"Environment.Variables",label:"Biến môi trường",type:"env",help:"Đặt giá trị là !Ref tới một bucket, table, topic hoặc queue thì code sẽ dùng tài nguyên đó (ghi file, ghi item, publish, gửi message)."},
    {k:"@WorkMs",label:"Thời gian code chạy ở 128 MB (ms)",type:"number",min:1,help:"Giả lập độ nặng của code. Ở 256 MB chạy nhanh gấp đôi."}],
  rel:{Role:{kind:"assumes",label:"role"},"Environment.Variables.*":{kind:"uses"}}});
def("AWS::IAM::Role",{label:"IAM role",short:"IAM",cat:"sec",
  doc:"Một bộ quyền mà dịch vụ (Lambda) hoặc người (qua STS AssumeRole) mượn để gọi AWS API. Trust policy nói ai được mượn; các policy nói được làm gì. Deny luôn thắng Allow.",
  defaults:id=>({RoleName:kebab(id),AssumeRolePolicyDocument:{Version:"2012-10-17",Statement:[{Effect:"Allow",Principal:{Service:"lambda.amazonaws.com"},Action:"sts:AssumeRole"}]},ManagedPolicyArns:[],Policies:[]}),
  name:p=>p.RoleName,
  fields:[{k:"RoleName",label:"Tên role",type:"text"},{k:"AssumeRolePolicyDocument",label:"Ai được dùng role (trust)",type:"trust"},
    {k:"ManagedPolicyArns",label:"AWS managed policy",type:"managed"},{k:"Policies",label:"Inline policy",type:"policies"}],
  rel:{"Policies.*":{kind:"grants",label:"cho phép"}}});
def("AWS::S3::Bucket",{label:"S3 bucket",short:"S3",cat:"store",
  doc:"Kho object (file) gần như không giới hạn. Tính tiền theo GB lưu mỗi tháng và theo số request PUT/GET. Có thể bắn sự kiện (event notification) khi có object mới.",
  defaults:id=>({BucketName:kebab(id)+"-"+ACCT,PublicAccessBlockConfiguration:{BlockPublicAcls:true,BlockPublicPolicy:true,IgnorePublicAcls:true,RestrictPublicBuckets:true}}),
  name:p=>p.BucketName,
  fields:[{k:"BucketName",label:"Tên bucket",type:"text"},{k:"PublicAccessBlockConfiguration",label:"Block Public Access",type:"bpa"},
    {k:"NotificationConfiguration.LambdaConfigurations",label:"Event notification → Lambda",type:"notifs"},{k:"@@DeletionPolicy",label:"DeletionPolicy (khi xóa stack)",type:"select",options:["Delete","Retain"]}],
  rel:{"NotificationConfiguration.LambdaConfigurations.*":{kind:"invokes",label:"ObjectCreated"}}});
def("AWS::S3::BucketPolicy",{label:"Bucket policy",short:"POL",cat:"sec",
  doc:"Policy gắn vào bucket (resource-based): nói AI được làm gì với bucket, kể cả người ngoài account. Principal \"*\" nghĩa là bất kỳ ai trên Internet.",
  defaults:()=>({Bucket:null,PolicyDocument:{Version:"2012-10-17",Statement:[]}}),
  fields:[{k:"Bucket",label:"Bucket",type:"ref",to:["AWS::S3::Bucket"]},{k:"PolicyDocument.Statement",label:"Statement",type:"statements",principal:true}],
  rel:{Bucket:{kind:"applies",label:"áp cho"}}});
def("AWS::DynamoDB::Table",{label:"DynamoDB table",short:"DDB",cat:"store",
  doc:"Bảng NoSQL key-value, đọc ghi vài mili-giây. Chế độ on-demand tính tiền theo mỗi lần ghi (WRU) và đọc (RRU), cộng GB lưu.",
  defaults:id=>({TableName:kebab(id),BillingMode:"PAY_PER_REQUEST",AttributeDefinitions:[{AttributeName:"pk",AttributeType:"S"}],KeySchema:[{AttributeName:"pk",KeyType:"HASH"}]}),
  name:p=>p.TableName,fields:[{k:"TableName",label:"Tên bảng",type:"text"},{k:"BillingMode",label:"Billing mode",type:"select",options:["PAY_PER_REQUEST"]}]});
def("AWS::SNS::Topic",{label:"SNS topic",short:"SNS",cat:"notify",
  doc:"Trạm phát tin: một tin publish vào topic được đẩy tới mọi subscription (email, Lambda, SQS…). Email phải được xác nhận mới nhận tin.",
  defaults:id=>({TopicName:kebab(id),Subscription:[]}),name:p=>p.TopicName,
  fields:[{k:"TopicName",label:"Tên topic",type:"text"},{k:"Subscription",label:"Subscription",type:"subs"}],
  rel:{"Subscription.*":{kind:"delivers",label:"gửi"}}});
def("AWS::SQS::Queue",{label:"SQS queue",short:"SQS",cat:"notify",
  doc:"Hàng đợi message: bên gửi và bên xử lý không cần chạy cùng lúc. Lambda đọc queue theo lô (event source mapping).",
  defaults:id=>({QueueName:kebab(id),VisibilityTimeout:30}),name:p=>p.QueueName,
  fields:[{k:"QueueName",label:"Tên queue",type:"text"},{k:"VisibilityTimeout",label:"Visibility timeout (giây)",type:"number",min:0}]});
def("AWS::Lambda::EventSourceMapping",{label:"Event source mapping",short:"ESM",cat:"comp",edge:true,edgeOf:p=>[{from:refId(p.EventSourceArn),to:refId(p.FunctionName),kind:"polls",label:"poll"}],
  doc:"Lambda tự đọc message từ queue theo lô rồi gọi function. Là một tài nguyên trong template nhưng hiện trên canvas như một mũi tên.",
  defaults:()=>({EventSourceArn:null,FunctionName:null,BatchSize:10}),
  fields:[{k:"BatchSize",label:"Batch size",type:"number",min:1,max:10000}]});
def("AWS::Events::Rule",{label:"EventBridge schedule",short:"⏱",cat:"notify",src:true,
  doc:"Lịch hẹn giờ (cron / rate) gọi target định kỳ, ví dụ chạy báo cáo mỗi 5 phút. Rule theo lịch không tính phí.",
  defaults:id=>({Name:kebab(id),ScheduleExpression:"rate(5 minutes)",State:"ENABLED",Targets:[]}),name:p=>p.Name,
  fields:[{k:"ScheduleExpression",label:"Lịch",type:"text",help:"rate(5 minutes), rate(1 hour)…"},{k:"State",label:"Trạng thái",type:"select",options:["ENABLED","DISABLED"]},
    {k:"Targets",label:"Target (Lambda)",type:"targets"}],
  rel:{"Targets.*":{kind:"invokes",label:"theo lịch"}}});
def("AWS::Logs::LogGroup",{label:"CloudWatch log group",short:"CW",cat:"mon",
  doc:"Nơi lưu log. Lambda ghi vào /aws/lambda/<tên function>, nhưng chỉ khi execution role có quyền logs:*. Tính tiền theo GB log ghi vào.",
  defaults:()=>({LogGroupName:"/aws/lambda/fn",RetentionInDays:14}),name:p=>p.LogGroupName,
  fields:[{k:"LogGroupName",label:"Tên log group",type:"text"},{k:"RetentionInDays",label:"Giữ log (ngày)",type:"select",options:[1,3,7,14,30,90,365],num:true}],
  rel:{LogGroupName:{kind:"logs",label:"log",reverse:true}}});
def("AWS::CloudWatch::Alarm",{label:"CloudWatch alarm",short:"ALM",cat:"mon",
  doc:"Theo dõi một metric (vd Errors của Lambda). Vượt ngưỡng trong một khoảng thời gian thì chuyển ALARM và báo tới SNS topic.",
  defaults:id=>({AlarmName:kebab(id),Namespace:"AWS/Lambda",MetricName:"Errors",Dimensions:[],Statistic:"Sum",Period:60,EvaluationPeriods:1,Threshold:0,ComparisonOperator:"GreaterThanThreshold",AlarmActions:[]}),
  name:p=>p.AlarmName,
  fields:[{k:"MetricName",label:"Metric",type:"select",options:["Errors","Invocations","Throttles","Duration"]},{k:"Dimensions.0.Value",label:"Function",type:"ref",to:["AWS::Lambda::Function"],dim:true},
    {k:"Threshold",label:"Ngưỡng",type:"number"},{k:"Period",label:"Chu kỳ (giây)",type:"select",options:[60,300,3600],num:true},{k:"AlarmActions",label:"Báo tới",type:"refs",to:["AWS::SNS::Topic"]}],
  rel:{"Dimensions.*":{kind:"metrics",label:"metric",reverse:true},"AlarmActions.*":{kind:"notifies",label:"ALARM"}}});
def("AWS::Budgets::Budget",{label:"AWS Budget",short:"$",cat:"cost",
  doc:"Theo dõi chi tiêu cả account trong tháng. Khi chi tiêu thực tế vượt một % của hạn mức, budget gửi thông báo tới SNS topic hoặc email.",
  defaults:()=>({Budget:{BudgetName:"monthly",BudgetLimit:{Amount:20,Unit:"USD"},TimeUnit:"MONTHLY",BudgetType:"COST"},NotificationsWithSubscribers:[]}),
  name:p=>p.Budget&&p.Budget.BudgetName,
  fields:[{k:"Budget.BudgetName",label:"Tên budget",type:"text"},{k:"Budget.BudgetLimit.Amount",label:"Hạn mức mỗi tháng (USD)",type:"number",min:1},{k:"NotificationsWithSubscribers",label:"Ngưỡng cảnh báo",type:"thresholds"}],
  rel:{"NotificationsWithSubscribers.*":{kind:"notifies",label:"vượt ngưỡng"}}});

/* relation look: line style + direction semantics */
const REL={calls:{style:"flow"},uploads:{style:"flow"},invokes:{style:"flow"},delivers:{style:"flow"},notifies:{style:"flow"},uses:{style:"data"},logs:{style:"data"},
  assumes:{style:"role"},grants:{style:"grant"},applies:{style:"role"},metrics:{style:"role"},reports:{style:"role"},polls:{style:"flow"}};
/* default label for a "uses" edge depends on what is used */
const USE_LABEL={"AWS::S3::Bucket":"ghi object","AWS::DynamoDB::Table":"ghi item","AWS::SNS::Topic":"publish","AWS::SQS::Queue":"gửi message"};
const USE_ENV={"AWS::S3::Bucket":"OUTPUT_BUCKET","AWS::DynamoDB::Table":"TABLE_NAME","AWS::SNS::Topic":"TOPIC_ARN","AWS::SQS::Queue":"QUEUE_URL"};
function tgtType(v){const id=refId(v);const n=id&&M&&nodeOf(id);return n?n.type:null}
