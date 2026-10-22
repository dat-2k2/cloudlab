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
    if(!b)return["Không còn budget nào.","Kéo AWS Budget từ thanh bên vào canvas.","Đặt budget $20, rồi nối nó tới billing-alerts."][Math.min(n,2)];
    if(!conf)return["Hộp thư chưa nhận cảnh báo nào, dù chi tiêu đã vượt 50%. Bấm ▶ Chạy rồi xem mũi tên topic → hộp thư.","Mũi tên billing-alerts → MyInbox báo ✕. Mở MyInbox.","Subscription vẫn PendingConfirmation. Mở thư xác nhận trong MyInbox, bấm Confirm subscription."][Math.min(n,2)];
    return["50% có email, 80% và 100% thì không.","Xem ngưỡng của MonthlyBudget.","Thêm notification 80 và 100% (lab 000007), cùng subscriber billing-alerts."][Math.min(n,2)]},
  hints:()=>["Budget chỉ báo ở ngưỡng có trong NotificationsWithSubscribers, và SNS chỉ gửi tới email đã xác nhận.","MonthlyBudget → thêm ngưỡng 80 và 100. MyInbox → thư xác nhận → Confirm subscription. Rồi bấm ▶ Chạy ở tốc độ 1 ngày mỗi giây."],
  solve(){const b=firstOf("AWS::Budgets::Budget");edit("budget 80/100",()=>{const tp=firstOf("AWS::SNS::Topic");b.props.NotificationsWithSubscribers=[50,80,100].map(x=>({Notification:{NotificationType:"ACTUAL",ComparisonOperator:"GREATER_THAN",Threshold:x},Subscribers:[{SubscriptionType:"SNS",Address:{Ref:tp.id}}]}))});
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
    if(!nodeOf("ReadOnlyRole")||!nodeOf("DataBucket"))return["Thiếu role hoặc bucket.","Bấm Hoàn tác (Ctrl+Z) để lấy lại.","Bấm Từ đầu để mở lại bài như lúc đầu."][Math.min(n,2)];
    if(!g.allow)return["Đọc report.csv vẫn bị 403. Bấm ▶ Chạy và xem mũi tên LanReads → DataBucket.","Lý do nằm trên mũi tên ✕ và trong khung chi tiết của ReadOnlyRole.",`Bị chặn bởi ${g.by} (${g.kind==="explicit"?"explicit deny":"không có Allow"}).`][Math.min(n,2)];
    return["Role ghi hoặc xóa được: quyền đang mở quá rộng.","Xem lại statement Deny.","Deny vẫn phải chặn s3:PutObject và s3:DeleteObject."][Math.min(n,2)]},
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
    if(leak)return["Người lạ vẫn đọc được invoice. Bấm ▶ Chạy và xem mũi tên Stranger → ShareBucket.","Quyền công khai đến từ resource policy gắn vào bucket.","SharePolicy cho Principal \"*\", trong khi Block Public Access đang tắt."][Math.min(n,2)];
    if(!evalS3({role:"LanRole"},"ShareBucket","s3:GetObject","invoice-0925.pdf").allow)return["Đã chặn người ngoài, nhưng Lan cũng mất quyền.","Xem policy của LanRole.","LanRole cần s3:GetObject trên invoice-*."][Math.min(n,2)];
    return["Block Public Access chưa bật đủ.","Mở ShareBucket.","Bật cả 4 tùy chọn Block Public Access."][Math.min(n,2)]},
  hints:()=>["Principal \"*\" nghĩa là ai cũng đọc được. Lan không cần nó vì đã có quyền qua role.","Xóa khối SharePolicy (hoặc statement PublicRead), rồi bật cả 4 tùy chọn Block Public Access trên ShareBucket."],
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
    if(r&&(evalRole(r,"iam:CreateUser","*").allow||evalRole(r,"s3:DeleteObject","arn:aws:s3:::lab-images-111122223333/x.jpg").allow))return["Role đang mở quá rộng.","Xem AWS managed policy của extract-role.","Bỏ AdministratorAccess, chỉ gắn AWSLambdaBasicExecutionRole."][Math.min(n,2)];
    const la=`arn:aws:logs:${REGION}:${ACCT}:log-group:/aws/lambda/extract:*`;
    if(r&&!["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"].every(a=>evalRole(r,a,la).allow))return["Không thấy log nào của extract.","Lambda ghi log bằng quyền nào?","extract-role thiếu logs:*. Gắn AWSLambdaBasicExecutionRole."][Math.min(n,2)];
    if(fn){const need=+(getP(fn.raw,"Metadata.CloudLab.WorkMs")||300)*128/(+fn.props.MemorySize||128);if(need>(+fn.props.Timeout||3)*1000)return["Có log rồi: Task timed out.","So Duration trong dòng REPORT với Timeout.",`Code cần ~${Math.round(need)} ms nhưng Timeout chỉ ${fn.props.Timeout} s. Tăng Timeout lên 10 hoặc Memory lên 256.`][Math.min(n,2)]}
    return["Gần xong.","Bấm ▶ Chạy, hoặc chọn Tester rồi bấm Gửi 1 request.","Bấm Kiểm tra lại."][Math.min(n,2)]},
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
    if(p.n>1)return[`1 upload làm Lambda chạy ${num(p.n)} lần. Bấm ▶ Chạy và nhìn hai mũi tên giữa ImagesBucket và extract.`,"Lambda ghi kết quả vào đâu, và trigger bắt những object nào?",`Lambda ghi vào ${pre||"(prefix trống)"}, trigger bắt mọi object mới → kết quả lại kích hoạt Lambda.`][Math.min(n,2)];
    if(p.n===0)return["Upload ảnh vào incoming/ không làm Lambda chạy.","Xem filter của event notification trên ImagesBucket.","Filter cần prefix incoming/ và suffix .jpg."][Math.min(n,2)];
    if(!p.outs.every(k=>k.startsWith("processed/")))return["Hết lặp, nhưng kết quả chưa nằm ở processed/.","Xem biến môi trường của extract.","Đặt OUTPUT_PREFIX = processed/."][Math.min(n,2)];
    return[`incoming/ còn ${junk().length} file .json rác.`,"Mở khung chi tiết của ImagesBucket.",`Bấm nút “Xóa ${junk().length} file .json trong incoming/”.`][Math.min(n,2)]},
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
    if((RT.stack.kept||[]).length)return["Stack xóa xong nhưng bucket vẫn còn (khối “Retained”).","Xem DeletionPolicy của ImagesBucket trong YAML.","DeletionPolicy: Retain. Xóa bucket bị giữ lại (Empty → Xóa khỏi account), hoặc deploy lại với Delete rồi xóa stack lần nữa."][Math.min(n,2)];
    if(stackUp())return["Stack vẫn đang chạy, đồng hồ chi phí vẫn tăng.","Cả stack xóa được bằng một lệnh.","Trên thanh stack, bấm Xóa stack."][Math.min(n,2)];
    return[`Còn ${Object.keys(M.manual).length} tài nguyên ngoài stack.`,"Xóa stack chỉ xóa những gì stack tạo ra.","Mở lab-scratch → Empty → Xóa khỏi account."][Math.min(n,2)]},
  hints:()=>["Stack chỉ xóa những gì nó tạo ra. DeletionPolicy: Retain giữ bucket lại; bucket còn object thì CloudFormation không xóa được.","ImagesBucket: DeletionPolicy Delete, rồi Empty. Xóa stack. Rồi lab-scratch: Empty → Xóa khỏi account."],
  solve(){if(stackUp()){edit("deletion policy",()=>{nodeOf("ImagesBucket").raw.DeletionPolicy="Delete"});RT.obj.ImagesBucket={};deleteStack()}
    for(const id of Object.keys(M.manual)){RT.obj[id]={};edit("delete manual",()=>{removeNode(id)})}},
  pass:"Stack xóa sạch bằng một lệnh, nhưng chỉ thứ nó tạo, và tôn trọng DeletionPolicy. Thứ tạo tay phải tự dọn — đồng hồ chi phí là nơi kiểm tra cuối cùng."},
];

/* ---------------- starter templates for the sandbox ---------------- */
const SG_IN=(port,src)=>src==="world"?`{IpProtocol: tcp, FromPort: ${port}, ToPort: ${port}, CidrIp: 0.0.0.0/0}`:`{IpProtocol: tcp, FromPort: ${port}, ToPort: ${port}, SourceSecurityGroupId: !GetAtt ${src}.GroupId}`;
const WEB3={id:"web3",title:"Web app 3 tầng",tag:"VPC · ALB · EC2 · RDS",desc:"Route 53 → ALB ở public subnet → 2 EC2 ở private subnet (2 AZ) → RDS PostgreSQL. Security group nối thành chuỗi Internet → ALB → web → DB.",
  yaml:`Description: Web app 3 tầng · ALB → EC2 → RDS trong VPC 2 AZ
Metadata:
  CloudLab:
    External:
      Users:
        Type: CloudLab::Client
        Properties:
          Target: !Ref AppDns
          RatePerSecond: 30
      Dashboard:
        Type: CloudLab::Monitor
        Properties:
          Watch: [!Ref Alb, !Ref Web1, !Ref Web2, !Ref Db]
Resources:
  Vpc:
    Type: AWS::EC2::VPC
    Properties:
      CidrBlock: 10.0.0.0/16
      EnableDnsHostnames: true
      EnableDnsSupport: true
      Tags: [{Key: Name, Value: web-vpc}]
  Igw:
    Type: AWS::EC2::InternetGateway
    Properties:
      Tags: [{Key: Name, Value: web-igw}]
  IgwAttach:
    Type: AWS::EC2::VPCGatewayAttachment
    Properties:
      VpcId: !Ref Vpc
      InternetGatewayId: !Ref Igw
  PublicA:
    Type: AWS::EC2::Subnet
    Properties: {VpcId: !Ref Vpc, CidrBlock: 10.0.1.0/24, AvailabilityZone: ap-southeast-2a, MapPublicIpOnLaunch: true}
  PublicB:
    Type: AWS::EC2::Subnet
    Properties: {VpcId: !Ref Vpc, CidrBlock: 10.0.2.0/24, AvailabilityZone: ap-southeast-2b, MapPublicIpOnLaunch: true}
  PrivateA:
    Type: AWS::EC2::Subnet
    Properties: {VpcId: !Ref Vpc, CidrBlock: 10.0.11.0/24, AvailabilityZone: ap-southeast-2a, MapPublicIpOnLaunch: false}
  PrivateB:
    Type: AWS::EC2::Subnet
    Properties: {VpcId: !Ref Vpc, CidrBlock: 10.0.12.0/24, AvailabilityZone: ap-southeast-2b, MapPublicIpOnLaunch: false}
  AlbSg:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: alb-sg
      VpcId: !Ref Vpc
      SecurityGroupIngress: [${SG_IN(80,"world")}]
  WebSg:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: web-sg
      VpcId: !Ref Vpc
      SecurityGroupIngress: [${SG_IN(80,"AlbSg")}]
  DbSg:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: db-sg
      VpcId: !Ref Vpc
      SecurityGroupIngress: [${SG_IN(5432,"WebSg")}]
  Alb:
    Type: AWS::ElasticLoadBalancingV2::LoadBalancer
    Properties:
      Name: web-alb
      Type: application
      Scheme: internet-facing
      Subnets: [!Ref PublicA, !Ref PublicB]
      SecurityGroups: [!GetAtt AlbSg.GroupId]
  WebTargets:
    Type: AWS::ElasticLoadBalancingV2::TargetGroup
    Properties:
      Port: 80
      Protocol: HTTP
      VpcId: !Ref Vpc
      TargetType: instance
      HealthCheckPath: /
      Targets: [{Id: !Ref Web1}, {Id: !Ref Web2}]
  AlbListener:
    Type: AWS::ElasticLoadBalancingV2::Listener
    Properties:
      LoadBalancerArn: !Ref Alb
      Port: 80
      Protocol: HTTP
      DefaultActions: [{Type: forward, TargetGroupArn: !Ref WebTargets}]
  Web1:
    Type: AWS::EC2::Instance
    Metadata:
      CloudLab: {AppPort: 80, Uses: [!Ref Db]}
    Properties:
      InstanceType: t3.micro
      ImageId: "${AL2023}"
      SubnetId: !Ref PrivateA
      SecurityGroupIds: [!GetAtt WebSg.GroupId]
      Tags: [{Key: Name, Value: web-1}]
  Web2:
    Type: AWS::EC2::Instance
    Metadata:
      CloudLab: {AppPort: 80, Uses: [!Ref Db]}
    Properties:
      InstanceType: t3.micro
      ImageId: "${AL2023}"
      SubnetId: !Ref PrivateB
      SecurityGroupIds: [!GetAtt WebSg.GroupId]
      Tags: [{Key: Name, Value: web-2}]
  DbSubnets:
    Type: AWS::RDS::DBSubnetGroup
    Properties:
      DBSubnetGroupDescription: db subnets
      SubnetIds: [!Ref PrivateA, !Ref PrivateB]
  Db:
    Type: AWS::RDS::DBInstance
    DeletionPolicy: Snapshot
    Properties:
      Engine: postgres
      EngineVersion: "16"
      DBInstanceClass: db.t3.micro
      AllocatedStorage: 20
      MultiAZ: false
      PubliclyAccessible: false
      MasterUsername: app
      ManageMasterUserPassword: true
      DBSubnetGroupName: !Ref DbSubnets
      VPCSecurityGroups: [!GetAtt DbSg.GroupId]
  AppDns:
    Type: AWS::Route53::RecordSet
    Properties:
      HostedZoneName: example.com.
      Name: app.example.com.
      Type: A
      AliasTarget: {DNSName: !GetAtt Alb.DNSName, HostedZoneId: !GetAtt Alb.CanonicalHostedZoneID}
`,layout:{Users:[40,330],AppDns:[40,80],Igw:[40,600],Vpc:[380,20],PublicA:[420,80],PublicB:[420,560],Alb:[440,330],AlbSg:[440,820],PrivateA:[820,80],PrivateB:[820,560],Web1:[860,130],Web2:[860,610],WebTargets:[860,330],Db:[1200,130],WebSg:[860,820],DbSg:[1200,820],Dashboard:[1600,330]}};
const STATIC={id:"static",title:"Website tĩnh",tag:"Route 53 · CloudFront · S3",desc:"Tên miền → CloudFront cache ở edge → S3 bucket chứa file. 90% request trúng cache, S3 chỉ nhận phần còn lại.",
  yaml:`Description: Website tĩnh · Route 53 → CloudFront → S3
Metadata:
  CloudLab:
    External:
      Visitors:
        Type: CloudLab::Client
        Properties:
          Target: !Ref SiteDns
          RatePerSecond: 50
Resources:
  SiteBucket:
    Type: AWS::S3::Bucket
    Metadata:
      CloudLab:
        Objects: [{Key: index.html, SizeKB: 12}, {Key: app.js, SizeKB: 180}]
    Properties:
      BucketName: my-site-111122223333
      PublicAccessBlockConfiguration: {BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true}
  Cdn:
    Type: AWS::CloudFront::Distribution
    Metadata:
      CloudLab: {HitRatio: 0.9}
    Properties:
      DistributionConfig:
        Enabled: true
        DefaultRootObject: index.html
        Origins:
          - Id: SiteBucket
            DomainName: !GetAtt SiteBucket.RegionalDomainName
            S3OriginConfig: {OriginAccessIdentity: ""}
        DefaultCacheBehavior:
          TargetOriginId: SiteBucket
          ViewerProtocolPolicy: redirect-to-https
          CachePolicyId: 658327ea-f89d-4fab-a63d-7e88639e58f6
  SiteDns:
    Type: AWS::Route53::RecordSet
    Properties:
      HostedZoneName: example.com.
      Name: www.example.com.
      Type: A
      AliasTarget: {DNSName: !GetAtt Cdn.DomainName, HostedZoneId: Z2FDTNDATAQYW2}
`,layout:{Visitors:[40,120],SiteDns:[400,120],Cdn:[760,120],SiteBucket:[1120,120]}};
STARTER.title="Serverless API";STARTER.tag="API Gateway · Lambda · DynamoDB";STARTER.desc="Client → API Gateway → Lambda → DynamoDB, không server nào chạy khi không có request.";
const STARTERS={web3:WEB3,static:STATIC,serverless:STARTER};

/* ================= FCAJ (First Cloud AI Journey) lesson track =================
   Same order as the FCJ/FCAJ Phase 1 hub (cloudjourney.awsstudygroup.com), then serverless and IaC.
   Each lesson points at its workshop number; CIDRs and names follow the labs. */
const simStats=(sec,st)=>probe(()=>{if(!stackUp())deploy();RT.q=[];for(const k in RT.n)RT.n[k]={cost:0,m:{},tk:{},series:[],last:null};RT.flow={};runFor(sec,st||10);return clone(RT.n)});
const okOf=(S,id)=>(S[id]||{m:{}}).m.ok||0,errOf=(S,id)=>(S[id]||{m:{}}).m.err||0;
const VPC10=`  Vpc:
    Type: AWS::EC2::VPC
    Properties: {CidrBlock: 10.10.0.0/16, EnableDnsHostnames: true, EnableDnsSupport: true, Tags: [{Key: Name, Value: ASG}]}
  Igw:
    Type: AWS::EC2::InternetGateway
    Properties: {Tags: [{Key: Name, Value: ASG-igw}]}
  PublicA:
    Type: AWS::EC2::Subnet
    Properties: {VpcId: !Ref Vpc, CidrBlock: 10.10.1.0/24, AvailabilityZone: ap-southeast-2a, MapPublicIpOnLaunch: true}
  PublicB:
    Type: AWS::EC2::Subnet
    Properties: {VpcId: !Ref Vpc, CidrBlock: 10.10.2.0/24, AvailabilityZone: ap-southeast-2b, MapPublicIpOnLaunch: true}
  PrivateA:
    Type: AWS::EC2::Subnet
    Properties: {VpcId: !Ref Vpc, CidrBlock: 10.10.3.0/24, AvailabilityZone: ap-southeast-2a, MapPublicIpOnLaunch: false}
  PrivateB:
    Type: AWS::EC2::Subnet
    Properties: {VpcId: !Ref Vpc, CidrBlock: 10.10.4.0/24, AvailabilityZone: ap-southeast-2b, MapPublicIpOnLaunch: false}
`;
const ATTACH=`  IgwAttach:
    Type: AWS::EC2::VPCGatewayAttachment
    Properties: {VpcId: !Ref Vpc, InternetGatewayId: !Ref Igw}
`;
const EC2=(id,subnet,sg,uses,extra)=>`  ${id}:
    Type: AWS::EC2::Instance
    Metadata:
      CloudLab: {AppPort: 80, Uses: [${uses||""}]}
    Properties:
      InstanceType: t3.micro
      ImageId: "${AL2023}"
${subnet?`      SubnetId: !Ref ${subnet}\n`:""}      SecurityGroupIds: [!GetAtt ${sg}.GroupId]
${extra||""}      Tags: [{Key: Name, Value: ${kebab(id)}}]
`;
const L_VPC={id:"vpc",lab:"000003",step:2,title:"VPC: public, private và tường lửa",tag:"VPC + Security group",who:["M","Minh · mentor"],speed:1,
  scenario:"Theo lab 000003: VPC ASG 10.10.0.0/16, 2 public + 2 private subnet. Web ở public phải vào được từ Internet, còn SSH chỉ từ IP của em. Hiện web không vào được, còn bot thì SSH vào được.",
  goal:"Web public vào được; SSH chỉ từ IP của bạn; private subnet chỉ nhận SSH từ public SG.",
  concepts:["VPC CIDR","public vs private subnet","Internet gateway","security group","bastion","NAT gateway (lab)"],
  yaml:`Description: Lab 000003 · VPC ASG
Metadata:
  CloudLab:
    External:
      Visitors:
        Type: CloudLab::Client
        Properties: {Target: !Ref PublicEc2, Port: 80, RatePerSecond: 1}
      You:
        Type: CloudLab::Client
        Properties: {Target: !Ref PublicEc2, Port: 22, SourceIp: 203.0.113.10, RatePerSecond: 0.05}
      ScanBot:
        Type: CloudLab::Client
        Properties: {Target: !Ref PublicEc2, Port: 22, SourceIp: 198.51.100.7, RatePerSecond: 0.2, Expect: Deny}
Resources:
${VPC10}  PublicSg:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: Public subnet - SG
      VpcId: !Ref Vpc
      SecurityGroupIngress: [{IpProtocol: tcp, FromPort: 80, ToPort: 80, CidrIp: 0.0.0.0/0}, {IpProtocol: tcp, FromPort: 22, ToPort: 22, CidrIp: 0.0.0.0/0}]
  PrivateSg:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: Private subnet - SG
      VpcId: !Ref Vpc
      SecurityGroupIngress: [{IpProtocol: tcp, FromPort: 22, ToPort: 22, CidrIp: 0.0.0.0/0}]
${EC2("PublicEc2","PublicA","PublicSg")}${EC2("PrivateEc2","PrivateB","PrivateSg")}`,
  layout:{Visitors:[40,80],You:[40,320],ScanBot:[40,560],Igw:[40,800],Vpc:[400,20],PublicA:[440,60],PublicB:[440,470],PrivateA:[820,60],PrivateB:[820,470],PublicEc2:[460,110],PrivateEc2:[840,520],PublicSg:[460,760],PrivateSg:[840,760]},
  explain:{Vpc:"VPC “ASG” 10.10.0.0/16 như lab. Lab 000003 còn thêm NAT gateway mỗi AZ để EC2 private ra được Internet (ping amazon.com); CloudLab chưa mô phỏng traffic đi ra.",
    Igw:"Internet gateway đã tạo nhưng CHƯA gắn vào VPC — nên public subnet chưa thật sự public.",PublicA:"Public subnet: MapPublicIpOnLaunch = true, cần IGW gắn vào VPC.",PrivateB:"Private subnet: không có IP public, Internet không vào thẳng được.",
    PublicSg:"Mở 80 cho mọi người là đúng (web). Nhưng 22 (SSH) cũng mở 0.0.0.0/0 — bot quét cổng sẽ thử đăng nhập.",PrivateSg:"Lab: SSH vào private chỉ được từ public SG (máy public làm bastion), không phải từ Internet.",
    Visitors:"Khách vào web trên PublicEc2, cổng 80.",You:"Bạn SSH từ IP 203.0.113.10 — rule SSH nên chỉ mở cho /32 này.",ScanBot:"Bot từ IP lạ thử SSH. Ta muốn bị chặn (✕ xanh).",PublicEc2:"Web server + bastion.",PrivateEc2:"App server, chỉ vào được qua bastion."},
  tasks:[
    {t:"Khách vào được web",c:"IGW gắn VPC → public subnet có đường Internet",test:()=>{const S=simStats(600);return okOf(S,"Visitors")>0&&!errOf(S,"Visitors")}},
    {t:"SSH chỉ từ IP của bạn",c:"You vào được, ScanBot bị chặn",test:()=>{const S=simStats(600);return okOf(S,"You")>0&&!errOf(S,"You")&&!okOf(S,"ScanBot")}},
    {t:"Private chỉ nhận SSH từ public SG",c:"không có 0.0.0.0/0 trên PrivateSg",test:()=>{const g=nodeOf("PrivateSg");const L=arr(g&&g.props.SecurityGroupIngress);return L.length>0&&L.every(r=>refId(r.SourceSecurityGroupId)==="PublicSg"||(r.CidrIp&&r.CidrIp!=="0.0.0.0/0"&&r.CidrIp.startsWith("10.10.")))}}],
  diagnose(n){if(!igwOf("Vpc"))return["Khách vẫn không vào được web.","Bấm ▶ Chạy và đọc lý do trên mũi tên Visitors → PublicEc2.","Internet gateway chưa gắn vào VPC: kéo khối Igw thả vào khung VPC (hoặc kéo mũi tên từ chấm bên phải Igw tới khung VPC)."][Math.min(n,2)];
    if(arr(getP(nodeOf("PublicSg")||{props:{}},"props.SecurityGroupIngress")).some(r=>+r.FromPort===22&&r.CidrIp==="0.0.0.0/0"))return["Bot quét vẫn SSH vào được PublicEc2.","Xem rule cổng 22 của PublicSg.","Đổi nguồn của rule SSH thành 203.0.113.10/32 (IP của bạn)."][Math.min(n,2)];
    return["PrivateSg vẫn mở SSH cho Internet.","Ai nên SSH được vào máy private?","Rule 22 của PrivateSg: nguồn = SG PublicSg."][Math.min(n,2)]},
  hints:()=>["Subnet chỉ public khi VPC có internet gateway gắn vào. Security group: mở đúng cổng cho đúng nguồn.","Kéo Igw thả vào khung VPC (hoặc kéo mũi tên Igw → khung VPC). PublicSg: rule 22 nguồn 203.0.113.10/32. PrivateSg: rule 22 nguồn SG PublicSg."],
  solve(){edit("fix vpc",()=>{M.res.IgwAttach={Type:"AWS::EC2::VPCGatewayAttachment",Properties:{VpcId:{Ref:"Vpc"},InternetGatewayId:{Ref:"Igw"}}};
    nodeOf("PublicSg").props.SecurityGroupIngress=[{IpProtocol:"tcp",FromPort:80,ToPort:80,CidrIp:"0.0.0.0/0"},{IpProtocol:"tcp",FromPort:22,ToPort:22,CidrIp:"203.0.113.10/32"}];
    nodeOf("PrivateSg").props.SecurityGroupIngress=[{IpProtocol:"tcp",FromPort:22,ToPort:22,SourceSecurityGroupId:{"Fn::GetAtt":["PublicSg","GroupId"]}}]})},
  pass:"Public subnet = có IGW. Security group là tường lửa theo nguồn: Internet cho web, /32 cho SSH, và SG-tới-SG cho máy bên trong. Lab thật còn có NAT gateway để private đi ra."};
const L_ROLE={id:"ec2role",lab:"000048",step:3,title:"EC2 dùng IAM role, không dùng access key",tag:"EC2 + IAM role",who:["L","Lan · dev"],speed:1,
  scenario:"App trên EC2 cần ghi file vào bucket uploads. Lab 000048 cho thấy dán access key vào máy là sai. Role đã có nhưng chưa gắn vào máy, và quyền thì quá rộng.",
  goal:"App ghi được vào bucket bằng instance role; role chỉ có quyền cần thiết.",
  concepts:["instance profile","IAM role cho EC2","credential tạm","least privilege"],
  yaml:`Description: Lab 000048 · IAM role cho EC2
Metadata:
  CloudLab:
    External:
      Users:
        Type: CloudLab::Client
        Properties: {Target: !Ref AppEc2, RatePerSecond: 2}
Resources:
  AppSg:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: app-sg
      SecurityGroupIngress: [{IpProtocol: tcp, FromPort: 80, ToPort: 80, CidrIp: 0.0.0.0/0}]
${EC2("AppEc2",null,"AppSg","!Ref UploadsBucket")}  UploadsBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: fcaj-uploads-111122223333
      PublicAccessBlockConfiguration: {BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true}
  AppRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: fcaj-app-role
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement: [{Effect: Allow, Principal: {Service: ec2.amazonaws.com}, Action: sts:AssumeRole}]
      Policies:
        - PolicyName: s3-everything
          PolicyDocument:
            Version: "2012-10-17"
            Statement: [{Sid: AllS3, Effect: Allow, Action: "s3:*", Resource: "*"}]
`,layout:{Users:[40,120],AppSg:[400,380],AppEc2:[400,120],UploadsBucket:[780,120],AppRole:[780,380]},
  explain:{AppEc2:"App ghi file vào UploadsBucket mỗi request. Không có instance profile → không có credential → AccessDenied.",AppRole:"Role có sẵn nhưng chưa gắn vào EC2, và s3:* trên * là quá rộng (xóa được mọi bucket).",
    UploadsBucket:"Bucket private, chỉ cần PutObject từ app.",Users:"Người dùng upload qua app.",AppSg:"Mở cổng 80 cho web."},
  tasks:[
    {t:"EC2 có instance role",c:"IamInstanceProfile → AppRole",test:()=>{const p=nodeOf(refId(nodeOf("AppEc2").props.IamInstanceProfile));return!!p&&refId(arr(p.props.Roles)[0])==="AppRole"}},
    {t:"App ghi được vào bucket",c:"request → PutObject 200",test:()=>{const S=simStats(300);return okOf(S,"Users")>0&&!errOf(S,"Users")}},
    {t:"Role chỉ có quyền cần thiết",c:"không xóa bucket, không ghi bucket khác",test:()=>!evalRole("AppRole","s3:DeleteBucket",arnOf("UploadsBucket")).allow&&!evalRole("AppRole","s3:PutObject","arn:aws:s3:::other-bucket/x").allow}],
  diagnose(n){if(!refId(nodeOf("AppEc2").props.IamInstanceProfile))return["App báo lỗi ở mọi request. Bấm ▶ Chạy và xem mũi tên AppEc2 → UploadsBucket.","Máy lấy credential từ đâu để gọi S3?","Gắn AppRole vào AppEc2: nối AppEc2 → AppRole, CloudLab tạo instance profile."][Math.min(n,2)];
    if(evalRole("AppRole","s3:DeleteBucket",arnOf("UploadsBucket")).allow)return["Role vẫn làm được mọi thứ với S3.","Xem policy s3-everything.","Chỉ cho s3:PutObject (và GetObject nếu cần) trên !Sub ${UploadsBucket.Arn}/*."][Math.min(n,2)];return["Gần xong.","Bấm ▶ Chạy thử.","Bấm Kiểm tra lại."][Math.min(n,2)]},
  hints:()=>["EC2 nhận credential tạm từ instance profile, không cần access key nằm trên máy.","Nối AppEc2 → AppRole. Trong AppRole, thay statement s3:* bằng s3:PutObject trên !Sub ${UploadsBucket.Arn}/*."],
  solve(){edit("fix role",()=>{M.res.AppRoleProfile={Type:"AWS::IAM::InstanceProfile",Properties:{Roles:[{Ref:"AppRole"}]}};nodeOf("AppEc2").props.IamInstanceProfile={Ref:"AppRoleProfile"};
    nodeOf("AppRole").props.Policies=[{PolicyName:"uploads-write",PolicyDocument:{Version:"2012-10-17",Statement:[{Sid:"WriteUploads",Effect:"Allow",Action:"s3:PutObject",Resource:{"Fn::Sub":"${UploadsBucket.Arn}/*"}}]}}]})},
  pass:"Instance profile đưa credential tạm, tự xoay vòng vào máy — không có key nào để lộ. Quyền chỉ vừa đủ: PutObject đúng một bucket."};
const L_CF={id:"s3cf",lab:"000057 · 000094",step:4,title:"Website S3 qua CloudFront",tag:"S3 + CloudFront",who:["L","Lan · marketing"],speed:2,
  scenario:"Lab 000057 dựng web tĩnh bằng cách mở public bucket. Giờ chặn public lại và cho khách đi qua CloudFront (lab 000094) để nhanh hơn và an toàn hơn.",
  goal:"Khách đọc web qua CloudFront; bucket không còn public.",
  concepts:["S3 static website","Block Public Access","CloudFront origin","cache hit ratio"],
  yaml:`Description: Lab 000057 + 000094 · Website tĩnh
Metadata:
  CloudLab:
    External:
      Visitors:
        Type: CloudLab::Client
        Properties: {Target: !Ref SiteBucket, Action: s3:GetObject, Key: index.html, RatePerSecond: 20}
Resources:
  SiteBucket:
    Type: AWS::S3::Bucket
    Metadata:
      CloudLab:
        Objects: [{Key: index.html, SizeKB: 12}, {Key: app.js, SizeKB: 180}]
    Properties:
      BucketName: fcaj-site-111122223333
      WebsiteConfiguration: {IndexDocument: index.html}
      PublicAccessBlockConfiguration: {BlockPublicAcls: false, BlockPublicPolicy: false, IgnorePublicAcls: false, RestrictPublicBuckets: false}
  SitePolicy:
    Type: AWS::S3::BucketPolicy
    Properties:
      Bucket: !Ref SiteBucket
      PolicyDocument:
        Version: "2012-10-17"
        Statement: [{Sid: PublicRead, Effect: Allow, Principal: "*", Action: s3:GetObject, Resource: !Sub "\${SiteBucket.Arn}/*"}]
`,layout:{Visitors:[40,120],SiteBucket:[780,120],SitePolicy:[780,380]},
  explain:{Visitors:"Khách đang đọc thẳng từ S3. Sau khi sửa, nối Visitors → CloudFront.",SiteBucket:"Bucket đang public để làm website. Sau khi có CloudFront thì bật lại Block Public Access.",
    SitePolicy:"Principal \"*\" cho cả Internet đọc. Khi đi qua CloudFront thì không cần policy này nữa."},
  tasks:[
    {t:"Khách đi qua CloudFront",c:"Visitors → CloudFront → SiteBucket, không lỗi",test:()=>{const v=nodeOf("Visitors"),t=v&&nodeOf(refId(v.props.Target));if(!t||t.type!=="AWS::CloudFront::Distribution")return false;const S=simStats(300);return okOf(S,"Visitors")>0&&!errOf(S,"Visitors")}},
    {t:"Bucket không còn đọc công khai",c:"GET ẩn danh index.html → 403",test:()=>!evalS3({anon:true},"SiteBucket","s3:GetObject","index.html").allow},
    {t:"Block Public Access bật cả 4",c:"4 tùy chọn = true",test:()=>{const c=(nodeOf("SiteBucket").props.PublicAccessBlockConfiguration)||{};return["BlockPublicAcls","IgnorePublicAcls","BlockPublicPolicy","RestrictPublicBuckets"].every(k=>c[k]===true)}}],
  diagnose(n){const v=nodeOf("Visitors"),t=v&&nodeOf(refId(v.props.Target));if(!t||t.type!=="AWS::CloudFront::Distribution")return["Khách vẫn đọc thẳng từ S3.","Thêm CloudFront từ tab Thành phần.","Thêm CloudFront, nối CloudFront → SiteBucket (origin), rồi nối Visitors → CloudFront."][Math.min(n,2)];
    if(evalS3({anon:true},"SiteBucket","s3:GetObject","index.html").allow)return["Bucket vẫn public.","Ai đang cho phép Principal \"*\"?","Xóa SitePolicy và bật Block Public Access."][Math.min(n,2)];return["Block Public Access chưa bật đủ.","Mở SiteBucket.","Bật cả 4 tùy chọn Block Public Access."][Math.min(n,2)]},
  hints:()=>["CloudFront đọc bucket bằng quyền riêng (OAC), nên bucket không cần public.","＋ Thêm → CloudFront. Nối CloudFront → SiteBucket, Visitors → CloudFront. Xóa SitePolicy, bật cả 4 tùy chọn Block Public Access."],
  solve(){edit("cloudfront",()=>{M.res.Cdn={Type:"AWS::CloudFront::Distribution",Metadata:{CloudLab:{HitRatio:0.9}},Properties:{DistributionConfig:{Enabled:true,DefaultRootObject:"index.html",Origins:[{Id:"SiteBucket",DomainName:{"Fn::GetAtt":["SiteBucket","RegionalDomainName"]},S3OriginConfig:{OriginAccessIdentity:""}}],DefaultCacheBehavior:{TargetOriginId:"SiteBucket",ViewerProtocolPolicy:"redirect-to-https",CachePolicyId:"658327ea-f89d-4fab-a63d-7e88639e58f6"}}}};M.pos.Cdn=[400,120];
    nodeOf("Visitors").props.Target={Ref:"Cdn"};delete nodeOf("Visitors").props.Action;delete nodeOf("Visitors").props.Key;removeNode("SitePolicy");nodeOf("SiteBucket").props.PublicAccessBlockConfiguration={BlockPublicAcls:true,BlockPublicPolicy:true,IgnorePublicAcls:true,RestrictPublicBuckets:true}})},
  pass:"CloudFront cache ở edge nên 90% request không chạm tới S3, và bucket quay về private. Public bucket chỉ hợp cho demo."};
const L_RDS={id:"rds",lab:"000005",step:5,title:"RDS ở private subnet, chỉ app vào được",tag:"RDS + VPC",who:["M","Minh · mentor"],speed:1,
  scenario:"Lab 000005: MySQL Multi-AZ, database fcaj, security group rds-sg. Bản này chạy được nhưng DB đang public, mở 3306 cho cả Internet, chỉ một AZ.",
  goal:"App vẫn chạy; DB không public, rds-sg chỉ cho EC2; DB subnet group 2 AZ private + Multi-AZ.",
  concepts:["DB subnet group","security group tham chiếu SG","PubliclyAccessible","Multi-AZ"],
  yaml:`Description: Lab 000005 · RDS MySQL
Metadata:
  CloudLab:
    External:
      Users:
        Type: CloudLab::Client
        Properties: {Target: !Ref AppEc2, RatePerSecond: 5}
Resources:
${VPC10}${ATTACH}  Ec2Sg:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: ec2-sg
      VpcId: !Ref Vpc
      SecurityGroupIngress: [{IpProtocol: tcp, FromPort: 80, ToPort: 80, CidrIp: 0.0.0.0/0}]
  RdsSg:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: rds-sg
      VpcId: !Ref Vpc
      SecurityGroupIngress: [{IpProtocol: tcp, FromPort: 3306, ToPort: 3306, CidrIp: 0.0.0.0/0}]
${EC2("AppEc2","PublicA","Ec2Sg","!Ref Db")}  DbSubnets:
    Type: AWS::RDS::DBSubnetGroup
    Properties: {DBSubnetGroupDescription: fcaj db subnets, SubnetIds: [!Ref PublicB]}
  Db:
    Type: AWS::RDS::DBInstance
    DeletionPolicy: Snapshot
    Properties:
      DBInstanceIdentifier: fcaj
      DBName: fcaj
      Engine: mysql
      EngineVersion: "8.0"
      DBInstanceClass: db.t3.micro
      AllocatedStorage: 20
      MultiAZ: false
      PubliclyAccessible: true
      MasterUsername: admin
      ManageMasterUserPassword: true
      DBSubnetGroupName: !Ref DbSubnets
      VPCSecurityGroups: [!GetAtt RdsSg.GroupId]
`,layout:{Users:[40,120],Igw:[40,500],Vpc:[400,20],PublicA:[440,60],PublicB:[820,60],PrivateA:[440,470],PrivateB:[820,470],AppEc2:[460,110],Db:[840,110],Ec2Sg:[460,820],RdsSg:[840,820]},
  explain:{Db:"MySQL database fcaj. PubliclyAccessible = true và nằm ở public subnet: có địa chỉ Internet. Lab dùng db.m5.large Multi-AZ; ở đây db.t3.micro cho rẻ.",
    RdsSg:"rds-sg mở 3306 cho 0.0.0.0/0 — ai cũng thử đăng nhập được. Đúng ra chỉ cho Ec2Sg.",AppEc2:"App đọc ghi DB mỗi request.",Ec2Sg:"Cổng 80 cho khách vào app.",
    PrivateA:"Nơi DB nên nằm (cùng PrivateB, 2 AZ).",Users:"Khách dùng app."},
  tasks:[
    {t:"App vẫn chạy",c:"request → EC2 → RDS không lỗi",test:()=>{const S=simStats(300);return okOf(S,"Users")>0&&!errOf(S,"Users")}},
    {t:"DB không public",c:"PubliclyAccessible false, rds-sg chỉ nhận từ Ec2Sg",test:()=>{const d=nodeOf("Db"),L=arr(getP(nodeOf("RdsSg")||{props:{}},"props.SecurityGroupIngress"));return d.props.PubliclyAccessible!==true&&L.length>0&&L.every(r=>refId(r.SourceSecurityGroupId)==="Ec2Sg")}},
    {t:"2 AZ private + Multi-AZ",c:"DB subnet group gồm 2 private subnet khác AZ, MultiAZ true",test:()=>{const d=nodeOf("Db"),ss=subnetsOf(d);return d.props.MultiAZ===true&&ss.length>=2&&ss.every(s=>!isPublicSubnet(s))&&new Set(ss.map(s=>nodeOf(s).props.AvailabilityZone)).size>=2}}],
  diagnose(n){const d=nodeOf("Db"),L=arr(getP(nodeOf("RdsSg")||{props:{}},"props.SecurityGroupIngress"));const S=simStats(120);
    if(errOf(S,"Users"))return["App không kết nối được database.","Xem lý do trên mũi tên AppEc2 → Db.","rds-sg phải có rule tcp/3306 với nguồn là SG Ec2Sg."][Math.min(n,2)];
    if(d.props.PubliclyAccessible===true||L.some(r=>r.CidrIp==="0.0.0.0/0"))return["Database vẫn với tới được từ Internet.","Xem tab Vấn đề.","Db: Public = Không. rds-sg: bỏ 0.0.0.0/0, thêm 3306 từ SG Ec2Sg."][Math.min(n,2)];
    return["Database chỉ ở một AZ.","Xem DB subnet group và Multi-AZ.","Kéo Db vào PrivateA rồi nối Db → PrivateB; bật Multi-AZ."][Math.min(n,2)]},
  hints:()=>["Database nên ở private subnet, không public, và security group chỉ nhận từ security group của app.","Db: Public = Không, Multi-AZ = Có, subnet group = PrivateA + PrivateB. rds-sg: 3306 từ SG Ec2Sg."],
  solve(){edit("fix rds",()=>{const d=nodeOf("Db");d.props.PubliclyAccessible=false;d.props.MultiAZ=true;nodeOf("DbSubnets").props.SubnetIds=[{Ref:"PrivateA"},{Ref:"PrivateB"}];
    nodeOf("RdsSg").props.SecurityGroupIngress=[{IpProtocol:"tcp",FromPort:3306,ToPort:3306,SourceSecurityGroupId:{"Fn::GetAtt":["Ec2Sg","GroupId"]}}]})},
  pass:"Ba lớp: private subnet (không có đường Internet), PubliclyAccessible = false, và rds-sg chỉ tin Ec2Sg. Multi-AZ gấp đôi giá — xem đồng hồ chi phí — đổi lại DB sống khi một AZ hỏng."};
const L_ALB={id:"alb",lab:"000006",step:6,title:"Load balancer chia tải qua 2 AZ",tag:"ALB + Auto Scaling",who:["L","Lan · ops"],speed:1,
  scenario:"Lab 000006 dựng launch template + target group + ALB + Auto Scaling group. Bản đang chạy chỉ có một t3.micro sau ALB, ALB lại chỉ ở một subnet, và giờ cao điểm có 60 request/giây.",
  goal:"ALB ở 2 AZ, ≥ 2 target ở 2 AZ, chịu được 60 req/s mà gần như không lỗi.",
  concepts:["Application Load Balancer","target group","health check","high availability","capacity"],
  yaml:`Description: Lab 000006 · ALB + web tier
Metadata:
  CloudLab:
    External:
      Users:
        Type: CloudLab::Client
        Properties: {Target: !Ref Alb, RatePerSecond: 60}
      Dashboard:
        Type: CloudLab::Monitor
        Properties: {Watch: [!Ref Alb, !Ref Web1]}
Resources:
${VPC10}${ATTACH}  AlbSg:
    Type: AWS::EC2::SecurityGroup
    Properties: {GroupDescription: alb-sg, VpcId: !Ref Vpc, SecurityGroupIngress: [{IpProtocol: tcp, FromPort: 80, ToPort: 80, CidrIp: 0.0.0.0/0}]}
  WebSg:
    Type: AWS::EC2::SecurityGroup
    Properties: {GroupDescription: web-sg, VpcId: !Ref Vpc, SecurityGroupIngress: [{IpProtocol: tcp, FromPort: 80, ToPort: 80, SourceSecurityGroupId: !GetAtt AlbSg.GroupId}]}
  Alb:
    Type: AWS::ElasticLoadBalancingV2::LoadBalancer
    Properties: {Name: fcaj-alb, Type: application, Scheme: internet-facing, Subnets: [!Ref PublicA], SecurityGroups: [!GetAtt AlbSg.GroupId]}
  WebTargets:
    Type: AWS::ElasticLoadBalancingV2::TargetGroup
    Properties: {Port: 80, Protocol: HTTP, VpcId: !Ref Vpc, TargetType: instance, HealthCheckPath: /, Targets: [{Id: !Ref Web1}]}
  AlbListener:
    Type: AWS::ElasticLoadBalancingV2::Listener
    Properties: {LoadBalancerArn: !Ref Alb, Port: 80, Protocol: HTTP, DefaultActions: [{Type: forward, TargetGroupArn: !Ref WebTargets}]}
${EC2("Web1","PrivateA","WebSg")}`,
  layout:{Users:[40,300],Dashboard:[40,560],Igw:[40,80],Vpc:[400,20],PublicA:[440,60],PublicB:[440,560],PrivateA:[820,60],PrivateB:[820,560],Alb:[460,300],WebTargets:[840,300],Web1:[840,110],AlbSg:[460,820],WebSg:[840,820]},
  explain:{Alb:"Chỉ ở PublicA. AWS bắt buộc ALB có ≥ 2 subnet ở 2 AZ (xem tab Vấn đề).",Web1:"Một t3.micro chịu ~40 req/s trong CloudLab. 60 req/s → quá tải, trả 5xx.",
    WebTargets:"Health check: target nào security group không cho ALB vào thì bị loại.",Users:"Cao điểm 60 request/giây.",Dashboard:"Xem request và lỗi theo thời gian.",
    WebSg:"Chỉ nhận cổng 80 từ alb-sg — đúng.",PrivateB:"AZ thứ hai, đang trống. Lab dùng Auto Scaling group trải đều 2 AZ; CloudLab dùng instance cố định."},
  tasks:[
    {t:"ALB ở 2 AZ",c:"≥ 2 subnet, khác Availability Zone",test:()=>{const ss=subnetsOf(nodeOf("Alb"));return ss.length>=2&&new Set(ss.map(s=>nodeOf(s).props.AvailabilityZone)).size>=2}},
    {t:"Chịu 60 req/s",c:"lỗi < 1% trong 10 phút",test:()=>{const S=simStats(600);const o=okOf(S,"Users"),e=errOf(S,"Users");return o>0&&e/(o+e)<0.01}},
    {t:"Target ở 2 AZ",c:"target group có instance ở 2 AZ",test:()=>{const azs=new Set(arr(nodeOf("WebTargets").props.Targets).map(t=>nodeOf(refId(t.Id))).filter(Boolean).map(n=>(nodeOf(subnetsOf(n)[0])||{props:{}}).props.AvailabilityZone).filter(Boolean));return azs.size>=2}}],
  diagnose(n){const ss=subnetsOf(nodeOf("Alb"));if(ss.length<2)return["Tab Vấn đề báo lỗi ở Alb.","ALB cần mấy subnet?","Nối Alb → PublicB."][Math.min(n,2)];
    const S=simStats(300),o=okOf(S,"Users"),e=errOf(S,"Users");if(e/(o+e||1)>=0.01)return[`${Math.round(e/(o+e)*100)}% request lỗi 5xx.`,"Nhìn CPU của Web1.","Thêm Web2 (EC2, WebSg) vào PrivateB rồi nối Alb → Web2."][Math.min(n,2)];
    return["Có hai target nhưng cùng một AZ.","AZ đó hỏng thì sao?","Đặt instance thứ hai ở PrivateB."][Math.min(n,2)]},
  hints:()=>["Load balancer chia tải và loại target hỏng. Nhiều instance ở nhiều AZ thì vừa chịu được tải, vừa chạy tiếp khi một AZ hỏng.","Nối Alb → PublicB. ＋ Thêm EC2 vào PrivateB, gắn WebSg, rồi nối Alb → EC2 mới (EC2 tự vào target group)."],
  solve(){edit("scale out",()=>{nodeOf("Alb").props.Subnets=[{Ref:"PublicA"},{Ref:"PublicB"}];M.res.Web2=clone(M.res.Web1);M.res.Web2.Properties.SubnetId={Ref:"PrivateB"};M.res.Web2.Properties.Tags=[{Key:"Name",Value:"web-2"}];M.pos.Web2=[840,610];nodeOf("WebTargets").props.Targets.push({Id:{Ref:"Web2"}})})},
  pass:"ALB trải 2 AZ, target ở 2 AZ: thêm máy là thêm sức chịu tải, mất một AZ vẫn chạy. Lab thật dùng Auto Scaling group để tự thêm/bớt máy theo CPU."};
const L_API={id:"apiddb",lab:"000079",step:9,title:"API → Lambda → DynamoDB",tag:"API Gateway + DynamoDB",who:["L","Lan · dev"],speed:1,
  scenario:"Book Store lab 000079: frontend gọi API Gateway → Lambda → DynamoDB. API trả 502, bảng books vẫn trống.",
  goal:"Request qua API thành công, sách được ghi vào bảng, role chỉ ghi đúng bảng đó.",
  concepts:["API Gateway HTTP API","Lambda integration","DynamoDB PutItem","execution role"],
  yaml:`Description: Lab 000079 · Book Store API
Metadata:
  CloudLab:
    External:
      Frontend:
        Type: CloudLab::Client
        Properties: {Target: !Ref BooksApi, RatePerSecond: 3}
Resources:
  BooksApi:
    Type: AWS::ApiGatewayV2::Api
    Properties: {Name: books-api, ProtocolType: HTTP, Target: !GetAtt BooksFn.Arn}
  BooksFn:
    Type: AWS::Lambda::Function
    Metadata:
      CloudLab: {WorkMs: 300}
    Properties:
      FunctionName: books
      Runtime: python3.12
      Handler: app.handler
      MemorySize: 256
      Timeout: 10
      Role: !GetAtt BooksRole.Arn
      Environment:
        Variables: {TABLE_NAME: !Ref BooksTable}
  BooksRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: books-role
${ASSUME_LAMBDA}
      ManagedPolicyArns: [${BASIC}]
  BooksTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: books
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions: [{AttributeName: id, AttributeType: S}]
      KeySchema: [{AttributeName: id, KeyType: HASH}]
`,layout:{Frontend:[40,120],BooksApi:[400,120],BooksFn:[760,120],BooksTable:[1120,120],BooksRole:[760,380]},
  explain:{BooksFn:"Ghi mỗi request thành một item vào bảng trong biến TABLE_NAME.",BooksRole:"Chỉ có quyền ghi log. Thiếu dynamodb:PutItem → AccessDenied → API trả 502.",BooksTable:"On-demand: trả tiền theo mỗi lần ghi.",BooksApi:"HTTP API chuyển request cho Lambda.",Frontend:"Trang web Book Store gọi API."},
  tasks:[
    {t:"API trả 200",c:"Frontend → API → Lambda không lỗi",test:()=>{const S=simStats(120);return okOf(S,"Frontend")>0&&!errOf(S,"Frontend")}},
    {t:"Sách vào bảng",c:"DynamoDB có item mới",test:()=>probe(()=>{if(!stackUp())deploy();RT.items={};RT.q=[];runFor(120,10);return(RT.items.BooksTable||0)>0})},
    {t:"Role chỉ ghi đúng bảng",c:"PutItem bảng books; không xóa bảng, không ghi bảng khác",test:()=>evalRole("BooksRole","dynamodb:PutItem",arnOf("BooksTable")).allow&&!evalRole("BooksRole","dynamodb:DeleteTable",arnOf("BooksTable")).allow&&!evalRole("BooksRole","dynamodb:PutItem",`arn:aws:dynamodb:${REGION}:${ACCT}:table/other`).allow}],
  diagnose(n){if(!evalRole("BooksRole","dynamodb:PutItem",arnOf("BooksTable")).allow)return["API trả 502.","Bấm ▶ Chạy và đọc lỗi trên mũi tên BooksFn → BooksTable.","books-role thiếu dynamodb:PutItem trên bảng books."][Math.min(n,2)];
    return["Role đang mở quá rộng.","Xem statement vừa thêm.","Resource = !GetAtt BooksTable.Arn, Action = dynamodb:PutItem."][Math.min(n,2)]},
  hints:()=>["Lambda chạy bằng role của nó; gọi DynamoDB cần quyền đúng action trên đúng bảng.","Nối BooksRole → BooksTable (cho phép GetItem, PutItem) hoặc thêm statement dynamodb:PutItem trên !GetAtt BooksTable.Arn."],
  solve(){edit("grant",()=>addStmt("BooksRole",["dynamodb:PutItem"],{"Fn::GetAtt":["BooksTable","Arn"]},"PutBooks"))},
  pass:"API Gateway → Lambda → DynamoDB là xương sống serverless: không máy nào chạy khi không có request, và quyền gói trong role của từng function."};

/* adjust existing lessons to their FCAJ labs, then order the track */
(function(){const by=Object.fromEntries(LESSONS.map(l=>[l.id,l]));
  Object.assign(by.guardrails,{lab:"000007",tag:"Budgets + SNS",goal:"Chi tiêu vượt 80% và 100% của $20 → email về hộp thư của bạn (như lab 000007)."});
  by.guardrails.tasks[0]={t:"Budget $20 · ngưỡng 80% và 100%",c:"BudgetLimit 20 USD, notification 80 + 100",test:()=>nodesOf("AWS::Budgets::Budget").some(b=>+getP(b.props,"Budget.BudgetLimit.Amount")===20&&[80,100].every(x=>budgetTh(b).includes(x)))};
  by.guardrails.tasks[2]={t:"Chạy cả tháng: cảnh báo 80% và 100% về hộp thư",c:"budget → SNS → email đã xác nhận",test:()=>probe(()=>{if(!stackUp())deploy();const ib=firstOf("CloudLab::Inbox");if(!ib)return false;RT.inbox={};RT.budgets={};RT.total=0;runFor(MONTH,21600);return(RT.inbox[ib.id]||[]).filter(m=>m.kind==="alert").length>=2})};
  Object.assign(by.iam,{lab:"000002",tag:"IAM role + switch role"});Object.assign(by.lambda,{lab:"000008",tag:"CloudWatch"});Object.assign(by.events,{lab:"000078",tag:"S3 → Lambda"});Object.assign(by.stack,{lab:"000037 · 000038",tag:"CloudFormation / CDK"});
  const order=[by.guardrails,by.iam,L_VPC,L_ROLE,L_CF,L_RDS,L_ALB,by.lambda,by.events,L_API,by.stack];order.forEach((l,i)=>l.step=i);
  const PH={guardrails:"Phase 1 · Explore",iam:"Phase 1 · Explore",vpc:"Phase 1 · Explore",ec2role:"Phase 1 · Explore",s3cf:"Phase 1 · Explore",rds:"Phase 1 · Explore",alb:"Phase 1 · Explore",lambda:"Phase 1 · Explore",events:"Serverless",apiddb:"Serverless",stack:"Hạ tầng dưới dạng code"};
  order.forEach(l=>l.phase=PH[l.id]);LESSONS.splice(0,LESSONS.length,...order)})();
