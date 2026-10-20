"use strict";
/* Templates. Each lesson is a CloudFormation template (+ external actors, layout) with a planted problem,
   an explanation of every component *in this context*, tasks checked against the template and a simulation probe,
   and the feedback ladder (symptom → where → why). The sandbox starter is a template without tasks. */
const ASSUME_LAMBDA=`      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal: {Service: lambda.amazonaws.com}
            Action: sts:AssumeRole`;
const ASSUME_ACCOUNT=`      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal: {AWS: !Sub "arn:aws:iam::\${AWS::AccountId}:root"}
            Action: sts:AssumeRole`;
const BASIC="arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole";
/* helpers used by task checks */
const nodesOf=t=>allNodes().filter(n=>n.type===t);
const budgetTh=b=>arr(b.props.NotificationsWithSubscribers).map(n=>+getP(n,"Notification.Threshold"));
const firstOf=t=>nodesOf(t)[0];
const runFor=(sec,step0,noSrc)=>{let t=0;const st=step0||3600;while(t<sec){step(Math.min(st,sec-t),noSrc);t+=st}};
const uploadProbe=()=>probe(()=>{const up=firstOf("CloudLab::Uploader"),fn=firstOf("AWS::Lambda::Function");if(!up||!fn)return{n:0,outs:[]};
  if(!stackUp())deploy();const b=refId(up.props.Target);const before=new Set(Object.keys(RT.obj[b]||{}));const inv0=(RT.n[fn.id]||{m:{}}).m.inv||0;
  RT.q=[];fire(up,1,RT.t);runFor(120,1,true);const outs=Object.keys(RT.obj[b]||{}).filter(k=>!before.has(k)&&k.endsWith(".json"));return{n:((RT.n[fn.id]||{m:{}}).m.inv||0)-inv0,outs}});
const junk=()=>{const b=firstOf("AWS::S3::Bucket");return b?Object.keys(RT.obj[b.id]||{}).filter(k=>k.startsWith("incoming/")&&k.endsWith(".json")):[]};

const STARTER={id:"starter",title:"API → Lambda → DynamoDB",tag:"Sandbox",
  yaml:`Description: Sandbox · một API ghi đơn hàng vào DynamoDB
Metadata:
  CloudLab:
    External:
      Shoppers:
        Type: CloudLab::Client
        Properties:
          Target: !Ref OrdersApi
          RatePerSecond: 5
      Dashboard:
        Type: CloudLab::Monitor
        Properties:
          Watch: [!Ref OrdersApi, !Ref OrdersFn, !Ref OrdersTable]
Resources:
  OrdersApi:
    Type: AWS::ApiGatewayV2::Api
    Properties:
      Name: orders-api
      ProtocolType: HTTP
      Target: !GetAtt OrdersFn.Arn
  OrdersFn:
    Type: AWS::Lambda::Function
    Metadata:
      CloudLab: {WorkMs: 400}
    Properties:
      FunctionName: orders
      Runtime: python3.12
      Handler: app.handler
      MemorySize: 256
      Timeout: 10
      Role: !GetAtt OrdersRole.Arn
      Environment:
        Variables:
          TABLE_NAME: !Ref OrdersTable
  OrdersRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: orders-role
${ASSUME_LAMBDA}
      ManagedPolicyArns: [${BASIC}]
      Policies:
        - PolicyName: orders-table
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Sid: WriteOrders
                Effect: Allow
                Action: dynamodb:PutItem
                Resource: !GetAtt OrdersTable.Arn
  OrdersTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: orders
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions: [{AttributeName: pk, AttributeType: S}]
      KeySchema: [{AttributeName: pk, KeyType: HASH}]
`,layout:{Shoppers:[40,80],OrdersApi:[400,80],OrdersFn:[760,80],OrdersTable:[1120,80],OrdersRole:[760,360],Dashboard:[1120,360]}};

const LESSONS=[
{id:"guardrails",step:0,title:"Cảnh báo tiền trước khi tiêu tiền",tag:"Budgets + SNS",who:["M","Minh · mentor"],speed:4,
  scenario:"API đặt hàng đang chạy thật, mỗi ngày tốn chút ít. Em đặt budget $20 cho account, báo về email ở 50, 80 và 100% nhé. Lỡ có gì chạy quá tay thì ít nhất có email.",
  goal:"Chi tiêu vượt 50 / 80 / 100% của $20 → email về hộp thư của bạn.",
  concepts:["AWS Budgets","SNS topic","subscription email","xác nhận subscription","GB-giây của Lambda"],
  yaml:`Description: Bài 0 · Budget báo về email khi chi tiêu tăng
Metadata:
  CloudLab:
    External:
      Customers:
        Type: CloudLab::Client
        Properties:
          Target: !Ref OrdersApi
          RatePerSecond: 2
      MyInbox:
        Type: CloudLab::Inbox
        Properties:
          Address: dat@example.com
Resources:
  OrdersApi:
    Type: AWS::ApiGatewayV2::Api
    Properties:
      Name: orders-api
      ProtocolType: HTTP
      Target: !GetAtt OrdersFn.Arn
  OrdersFn:
    Type: AWS::Lambda::Function
    Metadata:
      CloudLab: {WorkMs: 3600}
    Properties:
      FunctionName: orders
      Runtime: python3.12
      Handler: app.handler
      MemorySize: 512
      Timeout: 10
      Role: !GetAtt OrdersRole.Arn
  OrdersRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: orders-role
${ASSUME_LAMBDA}
      ManagedPolicyArns: [${BASIC}]
  BillingAlerts:
    Type: AWS::SNS::Topic
    Properties:
      TopicName: billing-alerts
      Subscription:
        - Protocol: email
          Endpoint: dat@example.com
  MonthlyBudget:
    Type: AWS::Budgets::Budget
    Properties:
      Budget:
        BudgetName: monthly-20usd
        BudgetLimit: {Amount: 20, Unit: USD}
        TimeUnit: MONTHLY
        BudgetType: COST
      NotificationsWithSubscribers:
        - Notification: {NotificationType: ACTUAL, ComparisonOperator: GREATER_THAN, Threshold: 50}
          Subscribers:
            - SubscriptionType: SNS
              Address: !Ref BillingAlerts
`,layout:{Customers:[40,80],OrdersApi:[400,80],OrdersFn:[760,80],OrdersRole:[760,360],MonthlyBudget:[40,360],BillingAlerts:[400,360],MyInbox:[400,620]},
  explain:{Customers:"Khách đặt hàng qua app, khoảng 2 request mỗi giây. Đây là thứ làm hóa đơn tăng dần trong tháng — bấm ▶ để xem đồng hồ chi phí chạy.",
    OrdersApi:"Mỗi request vào API Gateway tính một ít tiền rồi chuyển cho Lambda orders.",
    OrdersFn:"512 MB × khoảng 0,9 giây mỗi lần. Phần lớn chi phí của hệ thống nằm ở GB-giây của function này.",
    OrdersRole:"Quyền của orders: chỉ ghi log. Không liên quan tới cảnh báo, nhưng mọi Lambda đều cần một role.",
    MonthlyBudget:"Budget nhìn tổng chi tiêu cả account trong tháng, không gắn với tài nguyên nào. Hiện chỉ có ngưỡng 50%.",
    BillingAlerts:"Budget không gửi email trực tiếp ở đây mà publish vào topic; topic chuyển tới mọi subscription.",
    MyInbox:"Hộp thư của bạn. SNS đã gửi một thư “Subscription Confirmation”. Chưa bấm Confirm thì SNS không gửi gì tới địa chỉ này."},
  tasks:[
    {t:"Budget $20 · ngưỡng 50, 80, 100%",c:"BudgetLimit 20 USD, 3 notification",test:()=>nodesOf("AWS::Budgets::Budget").some(b=>+getP(b.props,"Budget.BudgetLimit.Amount")===20&&[50,80,100].every(x=>budgetTh(b).includes(x)))},
    {t:"Email đã xác nhận",c:"subscription Confirmed",test:()=>Object.entries(RT.subs).some(([k,v])=>k.endsWith("|"+EMAIL)&&v==="Confirmed")},
    {t:"Chạy cả tháng: 3 email cảnh báo về hộp thư",c:"50%, 80%, 100% → SNS → email",test:()=>probe(()=>{if(!stackUp())deploy();const ib=firstOf("CloudLab::Inbox");if(!ib)return false;RT.inbox={};RT.budgets={};RT.total=0;runFor(MONTH,21600);return(RT.inbox[ib.id]||[]).filter(m=>m.kind==="alert").length>=3})}],
  diagnose(n){const b=firstOf("AWS::Budgets::Budget"),conf=Object.entries(RT.subs).some(([k,v])=>k.endsWith("|"+EMAIL)&&v==="Confirmed");
    if(!b)return["Không còn budget nào.","Kéo AWS Budget từ palette vào.","Budget $20, nối tới billing-alerts."][Math.min(n,2)];
    if(!conf)return["Hộp thư chưa nhận cảnh báo nào, dù chi tiêu đã vượt 50%. Bấm ▶ rồi xem cạnh topic → hộp thư.","Cạnh billing-alerts → MyInbox báo ✕. Mở MyInbox.","Subscription vẫn PendingConfirmation. Mở thư xác nhận trong MyInbox → Confirm."][Math.min(n,2)];
    return["50% có email, 80% và 100% thì không.","Xem ngưỡng của MonthlyBudget.","Thêm notification 80 và 100%, cùng subscriber billing-alerts."][Math.min(n,2)]},
  hints:()=>["Budget chỉ báo ở ngưỡng có trong NotificationsWithSubscribers, và SNS chỉ gửi tới email đã xác nhận.","MonthlyBudget → thêm ngưỡng 80 và 100. MyInbox → thư xác nhận → Confirm. Rồi ▶ chạy ở tốc độ 1 ngày/giây."],
  solve(){const b=firstOf("AWS::Budgets::Budget");edit("budget 50/80/100",()=>{const tp=firstOf("AWS::SNS::Topic");b.props.NotificationsWithSubscribers=[50,80,100].map(x=>({Notification:{NotificationType:"ACTUAL",ComparisonOperator:"GREATER_THAN",Threshold:x},Subscribers:[{SubscriptionType:"SNS",Address:{Ref:tp.id}}]}))});
    for(const k of Object.keys(RT.subs))if(k.endsWith("|"+EMAIL))confirmSub(k.split("|")[0],EMAIL)},
  pass:"Budget theo dõi cả account → publish vào SNS → chỉ email đã xác nhận mới nhận. Đồng hồ chi phí cho thấy tiền đến từ đâu: phần lớn là GB-giây của Lambda."},

{id:"iam",step:1,title:"AccessDenied không còn ngẫu nhiên",tag:"IAM + STS",who:["L","Lan · data"],speed:2,
  scenario:"Anh Minh tạo role chỉ-đọc cho mình. Mình assume role rồi mà đọc report.csv vẫn AccessDenied. Bạn xem giúp? Nhớ là mình không được ghi hay xóa gì trong bucket đó.",
  goal:"Lan (qua role) đọc được report.csv, nhưng vẫn không ghi hay xóa được.",
  concepts:["IAM role","trust policy","STS AssumeRole","explicit deny","least privilege"],
  yaml:`Description: Bài 1 · Role chỉ-đọc cho Lan
Metadata:
  CloudLab:
    External:
      LanReads:
        Type: CloudLab::Client
        Properties:
          Target: !Ref DataBucket
          Action: s3:GetObject
          Key: report.csv
          RatePerSecond: 0.02
          As: !GetAtt ReadOnlyRole.Arn
      LanWrites:
        Type: CloudLab::Client
        Properties:
          Target: !Ref DataBucket
          Action: s3:PutObject
          Key: notes.txt
          RatePerSecond: 0.01
          As: !GetAtt ReadOnlyRole.Arn
          Expect: Deny
Resources:
  DataBucket:
    Type: AWS::S3::Bucket
    Metadata:
      CloudLab:
        Objects: [{Key: report.csv, SizeKB: 18}, {Key: scan-001.png, SizeKB: 240}]
    Properties:
      BucketName: lab-data-111122223333
      PublicAccessBlockConfiguration: {BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true}
  ReadOnlyRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: lab-readonly-s3
${ASSUME_ACCOUNT}
      Policies:
        - PolicyName: lab-s3-read
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Sid: ListLabData
                Effect: Allow
                Action: s3:ListBucket
                Resource: !GetAtt DataBucket.Arn
              - Sid: ReadObjects
                Effect: Allow
                Action: s3:GetObject
                Resource: !Sub "\${DataBucket.Arn}/*"
        - PolicyName: lab-guardrail
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Sid: NoObjectChanges
                Effect: Deny
                Action: s3:*Object
                Resource: !Sub "\${DataBucket.Arn}/*"
`,layout:{LanReads:[40,80],LanWrites:[40,360],ReadOnlyRole:[400,200],DataBucket:[760,80]},
  explain:{LanReads:"Lan đọc report.csv. Lan không có quyền gì trực tiếp: Lan assume role lab-readonly-s3 (STS cấp credential tạm), rồi gọi S3 bằng quyền của role.",
    LanWrites:"Lan thử ghi notes.txt. Ta MUỐN lệnh này bị chặn — role chỉ được đọc. Cạnh ✕ xanh lá nghĩa là chặn đúng ý.",
    ReadOnlyRole:"Trust policy cho người trong account assume. Hai policy: lab-s3-read cho phép đọc, lab-guardrail cấm thay đổi object. Deny luôn thắng Allow.",
    DataBucket:"Bucket private. Không có bucket policy, nên quyền hoàn toàn nằm ở identity policy của role."},
  tasks:[
    {t:"Lan đọc được report.csv",c:"s3:GetObject qua role → Allow",test:()=>evalS3({role:"ReadOnlyRole"},"DataBucket","s3:GetObject","report.csv").allow},
    {t:"Lan không ghi được",c:"s3:PutObject → Deny",test:()=>!evalS3({role:"ReadOnlyRole"},"DataBucket","s3:PutObject","notes.txt").allow},
    {t:"Lan không xóa được",c:"s3:DeleteObject → Deny",test:()=>!evalS3({role:"ReadOnlyRole"},"DataBucket","s3:DeleteObject","report.csv").allow}],
  diagnose(n){const g=evalS3({role:"ReadOnlyRole"},"DataBucket","s3:GetObject","report.csv");
    if(!nodeOf("ReadOnlyRole")||!nodeOf("DataBucket"))return["Thiếu role hoặc bucket.","Undo để lấy lại.","Bấm Reset bài."][Math.min(n,2)];
    if(!g.allow)return["Đọc report.csv vẫn 403. Bấm ▶ và xem cạnh LanReads → DataBucket.","Lý do nằm trên cạnh ✕ và trong inspector của ReadOnlyRole.",`Bị chặn bởi ${g.by} (${g.kind==="explicit"?"explicit deny":"không có Allow"}).`][Math.min(n,2)];
    return["Role ghi hoặc xóa được: mở quá rộng.","Xem lại statement Deny.","Deny phải vẫn chặn s3:PutObject và s3:DeleteObject."][Math.min(n,2)]},
  hints:()=>["Explicit Deny luôn thắng Allow. s3:*Object khớp cả GetObject.","ReadOnlyRole → lab-guardrail → đổi Action thành s3:PutObject, s3:DeleteObject."],
  solve(){edit("narrow deny",()=>{const r=nodeOf("ReadOnlyRole");const p=r.props.Policies.find(x=>x.PolicyName==="lab-guardrail");p.PolicyDocument.Statement[0].Action=["s3:PutObject","s3:DeleteObject"]})},
  pass:"Deny khớp → chặn ngay. Không thì cần một Allow. Không có Allow → chặn ngầm. Wildcard như s3:*Object dễ chặn quá tay."},

{id:"s3",step:2,title:"Chia sẻ file mà không public bucket",tag:"S3",who:["L","Lan · kế toán"],speed:2,
  scenario:"Hôm trước có người mở public cả bucket lab-share để gửi nhanh invoice cho mình. Giờ làm sao để mình vẫn tải được mà người ngoài thì không?",
  goal:"Người lạ không đọc được gì; Lan vẫn tải được invoice bằng quyền của mình.",
  concepts:["bucket policy","Principal \"*\"","Block Public Access","identity vs resource policy","presigned URL"],
  yaml:`Description: Bài 2 · Bucket lỡ bị public
Metadata:
  CloudLab:
    External:
      Stranger:
        Type: CloudLab::Client
        Properties:
          Target: !Ref ShareBucket
          Action: s3:GetObject
          Key: invoice-0925.pdf
          RatePerSecond: 0.05
          Expect: Deny
      Lan:
        Type: CloudLab::Client
        Properties:
          Target: !Ref ShareBucket
          Action: s3:GetObject
          Key: invoice-0925.pdf
          RatePerSecond: 0.01
          As: !GetAtt LanRole.Arn
Resources:
  ShareBucket:
    Type: AWS::S3::Bucket
    Metadata:
      CloudLab:
        Objects: [{Key: invoice-0925.pdf, SizeKB: 96}, {Key: internal-notes.txt, SizeKB: 4}]
    Properties:
      BucketName: lab-share-111122223333
      PublicAccessBlockConfiguration: {BlockPublicAcls: false, BlockPublicPolicy: false, IgnorePublicAcls: false, RestrictPublicBuckets: false}
  SharePolicy:
    Type: AWS::S3::BucketPolicy
    Properties:
      Bucket: !Ref ShareBucket
      PolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Sid: PublicRead
            Effect: Allow
            Principal: "*"
            Action: s3:GetObject
            Resource: !Sub "\${ShareBucket.Arn}/*"
  LanRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: lan-accounting
${ASSUME_ACCOUNT}
      Policies:
        - PolicyName: read-invoices
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Sid: ReadInvoices
                Effect: Allow
                Action: s3:GetObject
                Resource: !Sub "\${ShareBucket.Arn}/invoice-*"
`,layout:{Stranger:[40,80],Lan:[40,360],LanRole:[400,360],ShareBucket:[760,80],SharePolicy:[760,360]},
  explain:{Stranger:"Một người bất kỳ trên Internet, không đăng nhập (anonymous). Ta muốn cạnh này luôn ✕.",
    Lan:"Lan đăng nhập và dùng role lan-accounting. Quyền đọc của Lan đến từ identity policy của role, không cần bucket public.",
    LanRole:"Chỉ cho đọc object có tên invoice-*. Đủ cho Lan, không lộ internal-notes.txt.",
    ShareBucket:"Block Public Access đang tắt cả 4 tùy chọn — lớp bảo vệ cuối cùng bị gỡ.",
    SharePolicy:"Resource policy gắn vào bucket: Principal \"*\" = bất kỳ ai. Đây là chỗ làm lộ dữ liệu."},
  tasks:[
    {t:"Người lạ không đọc được object nào",c:"GET ẩn danh → 403",test:()=>["invoice-0925.pdf","internal-notes.txt"].every(k=>!evalS3({anon:true},"ShareBucket","s3:GetObject",k).allow)},
    {t:"Block Public Access bật cả 4",c:"BlockPublicAcls, IgnorePublicAcls, BlockPublicPolicy, RestrictPublicBuckets",test:()=>{const b=nodeOf("ShareBucket");const c=b&&b.props.PublicAccessBlockConfiguration||{};return["BlockPublicAcls","BlockPublicPolicy","IgnorePublicAcls","RestrictPublicBuckets"].every(k=>c[k]===true)}},
    {t:"Lan vẫn tải được invoice",c:"GetObject qua lan-accounting → Allow",test:()=>evalS3({role:"LanRole"},"ShareBucket","s3:GetObject","invoice-0925.pdf").allow}],
  diagnose(n){const leak=["invoice-0925.pdf","internal-notes.txt"].some(k=>evalS3({anon:true},"ShareBucket","s3:GetObject",k).allow);
    if(leak)return["Người lạ vẫn đọc được invoice. Bấm ▶ và xem cạnh Stranger → ShareBucket.","Quyền công khai đến từ resource policy gắn vào bucket.","SharePolicy cho Principal \"*\", và Block Public Access đang tắt."][Math.min(n,2)];
    if(!evalS3({role:"LanRole"},"ShareBucket","s3:GetObject","invoice-0925.pdf").allow)return["Đã chặn người ngoài, nhưng Lan cũng mất quyền.","Xem policy của LanRole.","LanRole cần s3:GetObject trên invoice-*."][Math.min(n,2)];
    return["Block Public Access chưa bật đủ.","Mở ShareBucket.","Bật cả 4 tùy chọn Block Public Access."][Math.min(n,2)]},
  hints:()=>["Principal \"*\" nghĩa là ai cũng đọc được. Lan không cần nó vì đã có quyền qua role.","Xóa node SharePolicy (hoặc statement PublicRead), rồi bật cả 4 tùy chọn Block Public Access trên ShareBucket."],
  solve(){edit("private bucket",()=>{removeNode("SharePolicy");const b=nodeOf("ShareBucket");b.props.PublicAccessBlockConfiguration={BlockPublicAcls:true,BlockPublicPolicy:true,IgnorePublicAcls:true,RestrictPublicBuckets:true}})},
  pass:"Bucket private + quyền qua identity policy là cách chia sẻ trong công ty. Cần gửi cho người ngoài thì dùng presigned URL có hạn. BPA chặn việc lỡ tay public lại."},

{id:"lambda",step:3,title:"Function lỗi mà không thấy log",tag:"Lambda + CloudWatch",who:["M","Minh · mentor"],speed:1,
  scenario:"API extract báo lỗi 502 liên tục. Dashboard thấy lỗi tăng, alarm đã gửi email, mà vào CloudWatch lại không có dòng log nào để biết vì sao.",
  goal:"Request qua API thành công, có log trong CloudWatch, role không thừa quyền.",
  concepts:["execution role","CloudWatch Logs","timeout","memory = CPU","CloudWatch alarm","least privilege"],
  yaml:`Description: Bài 3 · Lambda lỗi, không có log
Metadata:
  CloudLab:
    External:
      Tester:
        Type: CloudLab::Client
        Properties:
          Target: !Ref ExtractApi
          RatePerSecond: 0.2
      OpsDashboard:
        Type: CloudLab::Monitor
        Properties:
          Watch: [!Ref ExtractFn]
      MyInbox:
        Type: CloudLab::Inbox
        Properties:
          Address: dat@example.com
Resources:
  ExtractApi:
    Type: AWS::ApiGatewayV2::Api
    Properties:
      Name: extract-api
      ProtocolType: HTTP
      Target: !GetAtt ExtractFn.Arn
  ExtractFn:
    Type: AWS::Lambda::Function
    Metadata:
      CloudLab: {WorkMs: 4200}
    Properties:
      FunctionName: extract
      Runtime: python3.12
      Handler: app.handler
      MemorySize: 128
      Timeout: 3
      Role: !GetAtt ExtractRole.Arn
  ExtractRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: extract-role
${ASSUME_LAMBDA}
      Policies:
        - PolicyName: extract-s3
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Sid: ReadImages
                Effect: Allow
                Action: s3:GetObject
                Resource: arn:aws:s3:::lab-images-111122223333/*
  ErrorsAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: extract-errors
      Namespace: AWS/Lambda
      MetricName: Errors
      Dimensions: [{Name: FunctionName, Value: !Ref ExtractFn}]
      Statistic: Sum
      Period: 60
      EvaluationPeriods: 1
      Threshold: 0
      ComparisonOperator: GreaterThanThreshold
      AlarmActions: [!Ref OpsAlerts]
  OpsAlerts:
    Type: AWS::SNS::Topic
    Metadata:
      CloudLab: {Confirmed: [dat@example.com]}
    Properties:
      TopicName: ops-alerts
      Subscription:
        - Protocol: email
          Endpoint: dat@example.com
`,layout:{Tester:[40,80],ExtractApi:[400,80],ExtractFn:[760,80],ExtractRole:[760,360],OpsDashboard:[1120,80],ErrorsAlarm:[1120,360],OpsAlerts:[1120,620],MyInbox:[760,620]},
  explain:{Tester:"Gửi request thử mỗi 5 giây, như health check.",ExtractApi:"Trả 502 khi Lambda lỗi.",
    ExtractFn:"Code cần khoảng 4,2 giây ở 128 MB, nhưng Timeout là 3 giây (mặc định). Thêm memory thì thêm CPU nên chạy nhanh hơn.",
    ExtractRole:"Lambda ghi log bằng chính role này. Role chỉ có quyền đọc S3, thiếu logs:CreateLogGroup / CreateLogStream / PutLogEvents → log mất mà không báo lỗi.",
    OpsDashboard:"Monitor nhận số liệu từ extract: lần chạy, lỗi, thời gian. Nhìn đây để thấy lỗi tăng theo thời gian.",
    ErrorsAlarm:"Errors > 0 trong 1 phút → ALARM → publish tới ops-alerts. Monitor tự động, không cần ai ngồi nhìn.",
    OpsAlerts:"Subscription email đã xác nhận sẵn, nên alarm về tới hộp thư.",MyInbox:"Email ALARM sẽ về đây khi function lỗi."},
  tasks:[
    {t:"Request qua API thành công",c:"Lambda chạy xong trong timeout → 200",test:()=>probe(()=>{if(!stackUp())deploy();const fn=firstOf("AWS::Lambda::Function"),api=firstOf("AWS::ApiGatewayV2::Api"),c=firstOf("CloudLab::Client");if(!fn||!api||!c)return false;RT.q=[];fire(c,1,RT.t);runFor(30,1,true);return!!(RT.n[fn.id]&&RT.n[fn.id].last&&RT.n[fn.id].last.ok)})},
    {t:"Có log trong CloudWatch",c:"/aws/lambda/extract có dòng REPORT",test:()=>probe(()=>{if(!stackUp())deploy();const c=firstOf("CloudLab::Client"),fn=firstOf("AWS::Lambda::Function");if(!c||!fn)return false;RT.logs={};RT.q=[];fire(c,1,RT.t);runFor(30,1,true);return(RT.logs[logName(fn.id)]||[]).some(l=>l.m.startsWith("REPORT"))})},
    {t:"Role không thừa quyền",c:"không xóa được object, không động được IAM",test:()=>{const r=refId((firstOf("AWS::Lambda::Function")||{props:{}}).props.Role);return!!r&&!evalRole(r,"s3:DeleteObject","arn:aws:s3:::lab-images-111122223333/x.jpg").allow&&!evalRole(r,"iam:CreateUser","*").allow}}],
  diagnose(n){const fn=firstOf("AWS::Lambda::Function"),r=fn&&refId(fn.props.Role);
    if(r&&(evalRole(r,"iam:CreateUser","*").allow||evalRole(r,"s3:DeleteObject","arn:aws:s3:::lab-images-111122223333/x.jpg").allow))return["Role mở quá rộng.","Xem ManagedPolicyArns của extract-role.","Bỏ AdministratorAccess, chỉ gắn AWSLambdaBasicExecutionRole."][Math.min(n,2)];
    const la=`arn:aws:logs:${REGION}:${ACCT}:log-group:/aws/lambda/extract:*`;
    if(r&&!["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"].every(a=>evalRole(r,a,la).allow))return["Không thấy log nào của extract.","Lambda ghi log bằng quyền nào?","extract-role thiếu logs:*. Gắn AWSLambdaBasicExecutionRole."][Math.min(n,2)];
    if(fn){const need=+(getP(fn.raw,"Metadata.CloudLab.WorkMs")||300)*128/(+fn.props.MemorySize||128);if(need>(+fn.props.Timeout||3)*1000)return["Có log rồi: Task timed out.","So Duration trong dòng REPORT với Timeout.",`Cần ~${Math.round(need)} ms nhưng timeout ${fn.props.Timeout}s. Tăng Timeout lên 10 hoặc Memory lên 256.`][Math.min(n,2)]}
    return["Gần xong.","Bấm ▶ hoặc Gửi 1 request ở Tester.","Check lại."][Math.min(n,2)]},
  hints:()=>["Lambda ghi log bằng chính execution role. Thiếu quyền logs:* thì log biến mất, không báo lỗi.","ExtractRole → thêm managed policy AWSLambdaBasicExecutionRole. ExtractFn → Timeout 10 (hoặc Memory 256)."],
  solve(){edit("fix extract",()=>{const r=nodeOf("ExtractRole");r.props.ManagedPolicyArns=[BASIC];const f=nodeOf("ExtractFn");f.props.Timeout=10;f.props.MemorySize=256})},
  pass:"Execution role quyết định Lambda làm được gì, kể cả ghi log. Monitor + alarm cho bạn biết có lỗi; log cho bạn biết vì sao."},

{id:"events",step:4,title:"Upload một ảnh, gọi một lần",tag:"S3 → Lambda",who:["L","Lan · data"],speed:2,
  scenario:"Mình upload ảnh vào incoming/ mà Lambda chạy liên tục, bucket đầy file .json lạ. Đồng hồ chi phí cứ nhảy. Hóa đơn tháng này có sao không?",
  goal:"Mỗi ảnh vào incoming/ chạy Lambda đúng một lần, kết quả ra processed/.",
  concepts:["S3 event notification","prefix / suffix filter","vòng lặp đệ quy","biến môi trường"],
  yaml:`Description: Bài 4 · Pipeline xử lý ảnh
Metadata:
  CloudLab:
    External:
      PhoneApp:
        Type: CloudLab::Uploader
        Properties:
          Target: !Ref ImagesBucket
          PerHour: 30
          Prefix: incoming/
          Suffix: .jpg
          SizeKB: 240
      OpsDashboard:
        Type: CloudLab::Monitor
        Properties:
          Watch: [!Ref ImagesBucket, !Ref ExtractFn]
Resources:
  ImagesBucket:
    Type: AWS::S3::Bucket
    Metadata:
      CloudLab:
        Objects: [{Key: incoming/cat.jpg, SizeKB: 240}, {Key: incoming/cat.jpg.json, SizeKB: 1}, {Key: incoming/cat.jpg.json.json, SizeKB: 1}]
    Properties:
      BucketName: lab-images-111122223333
      NotificationConfiguration:
        LambdaConfigurations:
          - Event: s3:ObjectCreated:*
            Function: !GetAtt ExtractFn.Arn
  ExtractFn:
    Type: AWS::Lambda::Function
    Metadata:
      CloudLab: {WorkMs: 4200}
    Properties:
      FunctionName: extract
      Runtime: python3.12
      Handler: app.handler
      MemorySize: 256
      Timeout: 10
      Role: !GetAtt ExtractRole.Arn
      Environment:
        Variables:
          OUTPUT_BUCKET: !Ref ImagesBucket
          OUTPUT_PREFIX: incoming/
  ExtractRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: extract-role
${ASSUME_LAMBDA}
      ManagedPolicyArns: [${BASIC}]
      Policies:
        - PolicyName: extract-s3
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Sid: ReadWriteImages
                Effect: Allow
                Action: [s3:GetObject, s3:PutObject]
                Resource: !Sub "\${ImagesBucket.Arn}/*"
`,layout:{PhoneApp:[40,80],ImagesBucket:[400,80],ExtractFn:[760,80],ExtractRole:[760,360],OpsDashboard:[400,360]},
  explain:{PhoneApp:"App điện thoại upload ảnh vào incoming/, khoảng 30 ảnh mỗi giờ.",
    ImagesBucket:"Event notification gọi extract cho MỌI object mới — không có prefix hay suffix filter, nên cả file kết quả .json cũng kích hoạt.",
    ExtractFn:"Đọc ảnh, ghi kết quả <tên>.json vào OUTPUT_BUCKET/OUTPUT_PREFIX. OUTPUT_PREFIX đang là incoming/ — đúng chỗ đang bắn sự kiện.",
    ExtractRole:"Đủ quyền đọc và ghi bucket, nên vòng lặp không bị gì chặn lại.",
    OpsDashboard:"Nhìn số lần chạy so với số ảnh upload: lẽ ra 1:1."},
  tasks:[
    {t:"1 upload → 1 lần chạy",c:"upload incoming/x.jpg → đúng 1 invocation",test:()=>uploadProbe().n===1},
    {t:"Kết quả nằm ở processed/",c:"output .json bắt đầu bằng processed/",test:()=>{const p=uploadProbe();return p.outs.length>0&&p.outs.every(k=>k.startsWith("processed/"))}},
    {t:"Dọn file rác trong incoming/",c:"incoming/ không còn .json",test:()=>junk().length===0}],
  diagnose(n){const p=uploadProbe(),f=firstOf("AWS::Lambda::Function");const pre=f?getP(f.props,"Environment.Variables.OUTPUT_PREFIX"):"";
    if(p.n>1)return[`1 upload chạy Lambda ${num(p.n)} lần. Bấm ▶ và nhìn cạnh ImagesBucket ↔ extract.`,"Lambda ghi kết quả vào đâu, và trigger bắt những object nào?",`Ghi vào ${pre||"(trống)"}, trigger bắt mọi object mới → kết quả lại kích hoạt Lambda.`][Math.min(n,2)];
    if(p.n===0)return["Upload ảnh vào incoming/ không chạy Lambda nào.","Xem filter của event notification.","Prefix incoming/, suffix .jpg."][Math.min(n,2)];
    if(!p.outs.every(k=>k.startsWith("processed/")))return["Hết lặp, nhưng kết quả chưa ra processed/.","Xem biến môi trường của extract.","OUTPUT_PREFIX = processed/."][Math.min(n,2)];
    return[`incoming/ còn ${junk().length} file .json rác.`,"Mở ImagesBucket trong inspector.","Bấm “Xóa .json trong incoming/”."][Math.min(n,2)]},
  hints:()=>["Trigger bắt mọi ObjectCreated, kể cả file Lambda vừa ghi. Ghi ra prefix khác và lọc trigger.","ImagesBucket: filter prefix incoming/, suffix .jpg. ExtractFn: OUTPUT_PREFIX = processed/. Rồi xóa .json rác."],
  solve(){edit("fix loop",()=>{const b=nodeOf("ImagesBucket");b.props.NotificationConfiguration.LambdaConfigurations[0].Filter={S3Key:{Rules:[{Name:"prefix",Value:"incoming/"},{Name:"suffix",Value:".jpg"}]}};nodeOf("ExtractFn").props.Environment.Variables.OUTPUT_PREFIX="processed/"});
    const st=RT.obj.ImagesBucket||{};for(const k of Object.keys(st))if(k.startsWith("incoming/")&&k.endsWith(".json"))delete st[k]},
  pass:"Lambda ghi vào chính chỗ đang kích hoạt nó là vòng lặp tốn tiền nhất — đồng hồ chi phí cho thấy nó tăng không dừng. Luôn tách prefix vào/ra và lọc trigger."},

{id:"stack",step:5,title:"Xóa stack mà vẫn bị tính tiền",tag:"CloudFormation",who:["M","Minh · mentor"],speed:4,
  scenario:"Pipeline xong việc rồi, em xóa stack đi cho đỡ tốn. Nhớ kiểm tra: sau khi xóa, đồng hồ chi phí phải về 0 — kể cả cái bucket lab-scratch hôm trước em tạo tay.",
  goal:"Xóa stack sạch: không tài nguyên nào bị giữ lại, không còn gì tính tiền.",
  concepts:["CloudFormation stack","DeletionPolicy","bucket phải rỗng mới xóa được","tài nguyên ngoài stack"],
  yaml:`Description: Bài 5 · Pipeline sắp gỡ bỏ
Resources:
  ImagesBucket:
    Type: AWS::S3::Bucket
    DeletionPolicy: Retain
    Metadata:
      CloudLab:
        Objects: [{Key: archive/2025.zip, SizeKB: 209715200}, {Key: processed/cat.json, SizeKB: 1}]
    Properties:
      BucketName: lab-images-111122223333
      NotificationConfiguration:
        LambdaConfigurations:
          - Event: s3:ObjectCreated:*
            Function: !GetAtt ExtractFn.Arn
            Filter: {S3Key: {Rules: [{Name: prefix, Value: incoming/}, {Name: suffix, Value: .jpg}]}}
  ExtractFn:
    Type: AWS::Lambda::Function
    Metadata:
      CloudLab: {WorkMs: 4200}
    Properties:
      FunctionName: extract
      Runtime: python3.12
      Handler: app.handler
      MemorySize: 256
      Timeout: 10
      Role: !GetAtt ExtractRole.Arn
      Environment:
        Variables:
          OUTPUT_BUCKET: !Ref ImagesBucket
          OUTPUT_PREFIX: processed/
  ExtractRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: extract-role
${ASSUME_LAMBDA}
      ManagedPolicyArns: [${BASIC}]
      Policies:
        - PolicyName: extract-s3
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Sid: ReadWriteImages
                Effect: Allow
                Action: [s3:GetObject, s3:PutObject]
                Resource: !Sub "\${ImagesBucket.Arn}/*"
`,layout:{ImagesBucket:[40,80],ExtractFn:[400,80],ExtractRole:[400,360],ScratchBucket:[760,80]},
  manual:{ScratchBucket:{Type:"AWS::S3::Bucket",Metadata:{CloudLab:{Objects:[{Key:"test-upload.jpg",SizeKB:52428800}]}},Properties:{BucketName:"lab-scratch-111122223333"}}},
  explain:{ImagesBucket:"DeletionPolicy: Retain → khi xóa stack, CloudFormation bỏ qua bucket này: nó còn đó và vẫn tính tiền 200 GB. Kể cả đổi thành Delete, CloudFormation không xóa được bucket còn object.",
    ExtractFn:"Function và role sẽ bị xóa cùng stack.",ExtractRole:"Role không tốn tiền, nhưng nên đi cùng stack.",
    ScratchBucket:"Bucket tạo tay trên console, không thuộc stack nào. Xóa stack không đụng tới nó — 50 GB vẫn bị tính."},
  tasks:[
    {t:"Stack xóa xong, không bỏ sót",c:"DELETE_COMPLETE, không gì bị Retain",test:()=>RT.stack.status==="DELETE_COMPLETE"&&!(RT.stack.kept||[]).length},
    {t:"Không còn tài nguyên ngoài stack",c:"lab-scratch đã xóa",test:()=>!Object.keys(M.manual).length},
    {t:"Đồng hồ chi phí về 0",c:"không còn GB nào đang lưu",test:()=>!stackUp()&&!Object.keys(M.manual).length}],
  diagnose(n){const st=RT.stack.status;
    if(st==="DELETE_FAILED")return["Xóa stack lỗi ở ImagesBucket.","Đọc dòng DELETE_FAILED trong Event log.","Bucket còn object. Mở ImagesBucket → Empty, rồi xóa stack lại."][Math.min(n,2)];
    if((RT.stack.kept||[]).length)return["Stack xóa xong nhưng bucket vẫn còn (node “Retained”).","Xem DeletionPolicy của ImagesBucket trong YAML.","DeletionPolicy: Retain. Xóa bucket bị giữ lại (Empty → Xóa), hoặc Deploy lại với Delete rồi làm lại."][Math.min(n,2)];
    if(stackUp())return["Stack vẫn đang chạy, đồng hồ vẫn nhảy.","Xóa bằng một lệnh.","Thanh stack → Xóa stack."][Math.min(n,2)];
    return[`Còn ${Object.keys(M.manual).length} tài nguyên ngoài stack.`,"Xóa stack chỉ xóa thứ stack tạo.","Mở lab-scratch → Empty → Xóa bucket."][Math.min(n,2)]},
  hints:()=>["Stack chỉ xóa thứ nó tạo. DeletionPolicy: Retain giữ bucket lại; bucket còn object thì CloudFormation không xóa được.","ImagesBucket: DeletionPolicy Delete + Empty. Xóa stack. Rồi lab-scratch: Empty → Xóa bucket."],
  solve(){if(stackUp()){edit("deletion policy",()=>{nodeOf("ImagesBucket").raw.DeletionPolicy="Delete"});RT.obj.ImagesBucket={};deleteStack()}
    for(const id of Object.keys(M.manual)){RT.obj[id]={};edit("delete manual",()=>{removeNode(id)})}},
  pass:"Stack xóa sạch bằng một lệnh, nhưng chỉ thứ nó tạo, và tôn trọng DeletionPolicy. Thứ tạo tay phải tự dọn — đồng hồ chi phí là nơi kiểm tra cuối cùng."},
];
