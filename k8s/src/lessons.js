"use strict";
/* Kubernetes pack · lessons. Each lesson is a manifest with a planted problem, an explanation of every object in this
   context, tasks checked against the manifest and a simulation run (on a throw-away copy), and a feedback ladder
   (symptom → where → why). The bank story and "Trong ngân hàng" block are added by bank.js. */
const first=t=>allNodes().find(n=>n.type===t);
const byName=(t,nm)=>allNodes().find(n=>n.type===t&&nmOf(n)===nm)||null;
const clientNamed=nm=>allNodes().find(n=>n.type==="CloudLab::Client"&&nmOf(n)===nm)||null;
/* run the cluster forward on a copy and read the result */
/* checks look at the cluster once it has settled: 60 s for new pods to start (no traffic counted), then the measured run */
const kRun=(sec,fn,st)=>probe(()=>{if(!stackUp())deploy();RT.q=[];let t=0;while(t<60){step(5,true);t+=5}
  for(const k in RT.n)RT.n[k]={cost:0,m:{},tk:{},series:[],last:null};RT.flow={};RT.why={};t=0;const s=st||5;while(t<sec){step(Math.min(s,sec-t));t+=s}return fn()});
const readyAll=n=>!!n&&desiredOf(n)>0&&(RT.pods[n.id]||[]).filter(p=>p.ready).length>=desiredOf(n);
const okShare=n=>{if(!n)return 0;const m=(RT.n[n.id]||{m:{}}).m,t=(m.ok||0)+(m.err||0);return t?(m.ok||0)/t:0};
const errOf=n=>n?((RT.n[n.id]||{m:{}}).m.err||0):0;
const curRestarts=n=>(RT.pods[n.id]||[]).filter(p=>p.rev===revOf(n)).reduce((a,p)=>a+(p.restarts||0),0);
function ladder(steps,i){const s=steps.find(x=>!x[0]());if(!s)return"Cấu hình đã đúng. Chạy mô phỏng thêm một lúc cho pod mới lên hết, rồi bấm Kiểm tra lại.";const m=s[1];return m[Math.min(i,m.length-1)]}
const solveLog=msg=>log("Bài học","lesson","solve",msg,"ok");
const fixCtr=(id,fn,label)=>{const n=nodeOf(id)||byName(id.split("/")[0]==="sts"?"StatefulSet":"Deployment",id.split("/").pop());if(!n)return;edit(label,()=>fn(ctrOf(nodeOf(n.id)),nodeOf(n.id)));solveLog(`${n.id}: ${label}`)};
const POOL=(n,it,mx)=>`---
apiVersion: cloudlab.dev/v1
kind: NodePool
metadata:
  name: nodes
spec:
  instanceType: ${it||"t3.medium"}
  nodes: ${n||3}
  maxNodes: ${mx||n||3}
`;
const CLIENT=(name,target,extra)=>`---
apiVersion: cloudlab.dev/v1
kind: Client
metadata:
  name: ${name}
spec:
  target: ${target}
${extra||"  ratePerSecond: 20"}
`;

/* ---------------- sandbox starters ---------------- */
const STARTER={id:"ib",title:"Internet Banking cơ bản",tag:"Ingress → Service → Deployment",desc:"Khách vào ib.anphat.vn qua Ingress, tới web (3 pod), web gọi API thanh toán qua DNS. Cấu hình ở ConfigMap, node pool 3 × t3.medium.",
  yaml:`# CloudLab Kubernetes · sandbox · Internet Banking cơ bản
apiVersion: v1
kind: ConfigMap
metadata:
  name: ib-config
data:
  LOG_LEVEL: info
  PAYMENT_API_URL: http://payment-api:80
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ib-web
spec:
  replicas: 3
  selector:
    matchLabels: {app: ib-web}
  template:
    metadata:
      labels: {app: ib-web}
    spec:
      containers:
        - name: ib-web
          image: ${REG}/ib-web:2.4.1
          ports: [{containerPort: 8080}]
          envFrom: [{configMapRef: {name: ib-config}}]
          resources:
            requests: {cpu: 250m, memory: 256Mi}
            limits: {cpu: 500m, memory: 512Mi}
          readinessProbe:
            httpGet: {path: /healthz, port: 8080}
            periodSeconds: 5
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
spec:
  replicas: 2
  selector:
    matchLabels: {app: payment-api}
  template:
    metadata:
      labels: {app: payment-api}
    spec:
      containers:
        - name: payment-api
          image: ${REG}/payment-api:3.1.2
          ports: [{containerPort: 8080}]
          resources:
            requests: {cpu: 250m, memory: 256Mi}
            limits: {cpu: 500m, memory: 512Mi}
          readinessProbe:
            httpGet: {path: /healthz, port: 8080}
---
apiVersion: v1
kind: Service
metadata:
  name: ib-web
spec:
  selector: {app: ib-web}
  ports: [{port: 80, targetPort: 8080}]
---
apiVersion: v1
kind: Service
metadata:
  name: payment-api
spec:
  selector: {app: payment-api}
  ports: [{port: 80, targetPort: 8080}]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: public
spec:
  ingressClassName: nginx
  rules:
    - host: ib.anphat.vn
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: {name: ib-web, port: {number: 80}}
`+CLIENT("customers","ing/public","  ratePerSecond: 40\n  host: ib.anphat.vn\n  path: /")+POOL(3),
  layout:{"client/customers":[40,80],"nodepool/nodes":[40,420],"ing/public":[380,80],"svc/ib-web":[720,80],"deploy/ib-web":[1060,80],"cm/ib-config":[1400,80],"svc/payment-api":[1060,420],"deploy/payment-api":[1400,420]}};
const STATEFUL={id:"ledger",title:"Database có ổ đĩa riêng",tag:"StatefulSet + PVC + Secret",desc:"API tra soát ghi vào PostgreSQL chạy bằng StatefulSet; mỗi pod database có PVC riêng, mật khẩu ở Secret.",
  yaml:`# CloudLab Kubernetes · sandbox · Database có ổ đĩa riêng
apiVersion: v1
kind: Secret
metadata:
  name: ledger-db
type: Opaque
stringData:
  password: doi-mat-khau-nay
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: ledger-db
spec:
  serviceName: ledger-db
  replicas: 1
  selector:
    matchLabels: {app: ledger-db}
  template:
    metadata:
      labels: {app: ledger-db}
    spec:
      containers:
        - name: postgres
          image: postgres:16
          ports: [{containerPort: 5432}]
          env:
            - name: POSTGRES_PASSWORD
              valueFrom: {secretKeyRef: {name: ledger-db, key: password}}
          volumeMounts: [{name: data, mountPath: /var/lib/postgresql/data}]
          resources:
            requests: {cpu: 250m, memory: 512Mi}
            limits: {memory: 1Gi}
  volumeClaimTemplates:
    - metadata: {name: data}
      spec:
        accessModes: [ReadWriteOnce]
        storageClassName: gp3
        resources: {requests: {storage: 20Gi}}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dispute-api
spec:
  replicas: 2
  selector:
    matchLabels: {app: dispute-api}
  template:
    metadata:
      labels: {app: dispute-api}
    spec:
      containers:
        - name: dispute-api
          image: ${REG}/loan-api:2.2.0
          ports: [{containerPort: 8080}]
          env:
            - {name: DB_HOST, value: ledger-db}
            - name: DB_PASSWORD
              valueFrom: {secretKeyRef: {name: ledger-db, key: password}}
          resources:
            requests: {cpu: 250m, memory: 256Mi}
            limits: {cpu: 500m, memory: 512Mi}
          readinessProbe:
            httpGet: {path: /healthz, port: 8080}
---
apiVersion: v1
kind: Service
metadata:
  name: ledger-db
spec:
  selector: {app: ledger-db}
  ports: [{port: 5432, targetPort: 5432}]
---
apiVersion: v1
kind: Service
metadata:
  name: dispute-api
spec:
  type: LoadBalancer
  selector: {app: dispute-api}
  ports: [{port: 80, targetPort: 8080}]
`+CLIENT("customers","svc/dispute-api","  ratePerSecond: 10")+POOL(3),
  layout:{"client/customers":[40,80],"nodepool/nodes":[40,420],"svc/dispute-api":[380,80],"deploy/dispute-api":[720,80],"secret/ledger-db":[1060,420],"svc/ledger-db":[720,420],"sts/ledger-db":[1060,80]}};
const STARTERS={ib:STARTER,ledger:STATEFUL};

/* ---------------- lessons ---------------- */
const L_PODS={id:"pods",phase:"Nền tảng",step:1,title:"Pod không chạy: đọc trạng thái",tag:"Deployment + ConfigMap",who:["L","Lan · dev"],speed:1,
  scenario:"Bản web mới không lên.",goal:"Cả 3 pod của ib-web chạy (Running, Ready) và khách vào được web.",
  concepts:["Pod","Deployment","image và tag","ImagePullBackOff","ConfigMap","envFrom","CreateContainerConfigError"],
  yaml:`# CloudLab Kubernetes · lab-pods · Bản Internet Banking mới không chạy
apiVersion: v1
kind: ConfigMap
metadata:
  name: ib-config
data:
  LOG_LEVEL: info
  BRAND_NAME: An Phat
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ib-web
spec:
  replicas: 3
  selector:
    matchLabels: {app: ib-web}
  template:
    metadata:
      labels: {app: ib-web}
    spec:
      containers:
        - name: ib-web
          image: ${REG}/ib-web:2.4.2
          ports: [{containerPort: 8080}]
          envFrom: [{configMapRef: {name: ib-web-config}}]
          resources:
            requests: {cpu: 250m, memory: 256Mi}
            limits: {cpu: 500m, memory: 512Mi}
          readinessProbe:
            httpGet: {path: /healthz, port: 8080}
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: ib-web
spec:
  type: LoadBalancer
  selector: {app: ib-web}
  ports: [{port: 80, targetPort: 8080}]
`+CLIENT("customers","svc/ib-web","  ratePerSecond: 30")+POOL(3),
  layout:{"client/customers":[40,80],"nodepool/nodes":[40,400],"svc/ib-web":[380,80],"deploy/ib-web":[720,80],"cm/ib-config":[1060,80]},
  explain:{"client/customers":"Khách mở trang Internet Banking, khoảng 30 lượt mỗi giây.","svc/ib-web":"Địa chỉ cố định khách gọi tới; chia request cho các pod ib-web đang Ready.",
    "deploy/ib-web":"Bản web mới: giữ 3 pod chạy image ib-web. Bấm vào để xem từng pod và lý do pod không lên.","cm/ib-config":"Cấu hình của web (mức log, tên thương hiệu), nạp vào pod thành biến môi trường.","nodepool/nodes":"3 máy chủ của cluster, nơi các pod chạy."},
  tasks:[{t:"Image trỏ đúng một bản có trong registry",c:"Kubelet kéo được image về node.",test:()=>{const d=first("Deployment");return!!d&&!imageCheck((ctrOf(d)||{}).image).err}},
    {t:"Pod tìm thấy ConfigMap nó cần",c:"envFrom trỏ đúng tên ConfigMap có trong namespace.",test:()=>{const d=first("Deployment");return!!d&&!envOf(d).missing.length}},
    {t:"3/3 pod Ready, khách vào được web",c:"Service có đủ endpoint, request trả về 200.",test:()=>kRun(120,()=>readyAll(first("Deployment"))&&okShare(clientNamed("customers"))>0.95)}],
  hints:()=>["Bấm khối ib-web, xem bảng Pod: cột Trạng thái nói pod đang kẹt ở bước nào.","ImagePullBackOff nghĩa là không kéo được image: so tag trong Image với các tag registry có (thông báo lỗi liệt kê sẵn).","Sửa image xong thì pod qua bước kéo image và gặp lỗi tiếp theo: CreateContainerConfigError. Tên ConfigMap trong envFrom phải trùng tên khối ConfigMap."],
  diagnose:i=>ladder([[()=>!imageCheck((ctrOf(first("Deployment"))||{}).image).err,["Pod của ib-web vẫn ImagePullBackOff: chưa có pod nào chạy được.","Lỗi nằm ở dòng Image của Deployment ib-web.",`Tag 2.4.2 không có trong registry (chỉ có ${IMAGES[REG+"/ib-web"].tags.join(", ")}). Đổi Image thành ${REG}/ib-web:2.4.1.`]],
    [()=>!envOf(first("Deployment")).missing.length,["Image đã kéo được, nhưng pod báo CreateContainerConfigError.","Lỗi nằm ở envFrom của ib-web: nó tìm ConfigMap tên ib-web-config.","Namespace chỉ có ConfigMap ib-config. Sửa envFrom cho đúng tên (hoặc đổi tên ConfigMap thành ib-web-config)."]],
    [()=>kRun(120,()=>readyAll(first("Deployment"))),["Pod chưa Ready hết.","Xem bảng Pod của ib-web.","Bấm ▶ Chạy để pod mới có thời gian khởi động, rồi kiểm tra lại."]]],i),
  solve(){fixCtr("deploy/ib-web",c=>{c.image=REG+"/ib-web:2.4.1";c.envFrom=[{configMapRef:{name:"ib-config"}}]},"image 2.4.1, envFrom ib-config")},
  pass:"Pod đi qua từng bước: được xếp lên node → kéo image → tạo container (lúc này mới đọc ConfigMap / Secret) → chạy → Ready. Đọc cột Trạng thái là biết pod kẹt ở bước nào, và thông báo lỗi thường nói luôn cách sửa."};

const L_SVC={id:"service",phase:"Nền tảng",step:2,title:"Service không có endpoint",tag:"Service + selector",who:["H","Hà · vận hành"],speed:1,
  scenario:"Khách báo lỗi 503.",goal:"Service ib-web chọn đúng pod và gửi request vào đúng cổng app nghe; khách vào được web.",
  concepts:["Service","label","selector","endpoint","port và targetPort","503 no endpoints","connection refused"],
  yaml:`# CloudLab Kubernetes · lab-service · Pod chạy nhưng khách nhận 503
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ib-web
spec:
  replicas: 3
  selector:
    matchLabels: {app: ib-web}
  template:
    metadata:
      labels: {app: ib-web, tier: frontend}
    spec:
      containers:
        - name: ib-web
          image: ${REG}/ib-web:2.4.1
          ports: [{containerPort: 8080}]
          resources:
            requests: {cpu: 250m, memory: 256Mi}
            limits: {cpu: 500m, memory: 512Mi}
          readinessProbe:
            httpGet: {path: /healthz, port: 8080}
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: ib-web
spec:
  type: LoadBalancer
  selector: {app: internet-banking}
  ports: [{port: 80, targetPort: 80}]
`+CLIENT("customers","svc/ib-web","  ratePerSecond: 30")+POOL(3),
  layout:{"client/customers":[40,80],"nodepool/nodes":[40,400],"svc/ib-web":[380,80],"deploy/ib-web":[760,80]},
  explain:{"client/customers":"Khách mở trang Internet Banking.","svc/ib-web":"Tổng đài: tìm pod theo nhãn (selector) rồi nối máy vào cổng targetPort của pod. Bấm vào để xem endpoint.","deploy/ib-web":"3 pod web đang chạy bình thường, nhãn app=ib-web, app nghe cổng 8080."},
  tasks:[{t:"Selector của Service khớp nhãn pod",c:"Service tìm thấy pod: có endpoint.",test:()=>{const s=first("Service");return!!s&&selected(s).length>0}},
    {t:"targetPort trỏ vào cổng app đang nghe",c:"Request tới được app, không còn connection refused.",test:()=>{const s=first("Service"),w=s&&selected(s)[0];return!!w&&arr(getP(s.props,"spec.ports")).every(p=>portNum(w,p.targetPort??p.port)===((imageCheck(ctrOf(w).image).app||{}).port))}},
    {t:"Khách vào được web",c:"Hơn 95% request thành công.",test:()=>kRun(90,()=>okShare(clientNamed("customers"))>0.95)}],
  hints:()=>["Bấm khối Service ib-web, xem mục Endpoint: Service đang tìm pod có nhãn gì?","Nhãn pod của ib-web là app=ib-web. Selector của Service phải dùng đúng nhãn đó (hoặc kéo từ chấm của Service sang Deployment để CloudLab điền giúp).","Có endpoint rồi mà vẫn lỗi: Service gửi tới targetPort 80, nhưng app trong pod nghe 8080."],
  diagnose:i=>ladder([[()=>selected(first("Service")).length>0,["Khách nhận 503: Service không có endpoint nào.","Selector của Service ib-web là app=internet-banking.","Không pod nào mang nhãn đó: pod của ib-web có app=ib-web. Sửa selector của Service thành app: ib-web."]],
    [()=>{const s=first("Service"),w=selected(s)[0];return arr(getP(s.props,"spec.ports")).every(p=>portNum(w,p.targetPort??p.port)===8080)},["Service đã có endpoint nhưng request bị connection refused.","Cổng: Service nhận ở port 80 rồi gửi vào targetPort 80 của pod.","App ib-web nghe cổng 8080 (cổng container). Đặt targetPort: 8080."]]],i),
  solve(){const s=first("Service");edit("selector + targetPort",()=>{const n=nodeOf(s.id);n.props.spec.selector={app:"ib-web"};n.props.spec.ports=[{port:80,targetPort:8080}]});solveLog("svc/ib-web: selector app=ib-web, targetPort 8080")},
  pass:"Service không biết Deployment là gì: nó chỉ tìm pod theo nhãn, rồi nối vào cổng targetPort. Sai nhãn thì 503 (không có endpoint); sai cổng thì connection refused. Hai lỗi này rất phổ biến vì Kubernetes không báo lỗi lúc apply."};

const L_PROBES={id:"probes",phase:"Nền tảng",step:3,title:"Readiness và liveness probe",tag:"Probe + khởi động chậm",who:["M","Minh · mentor"],speed:1,
  scenario:"Core API khởi động xong lại tắt.",goal:"core-api khởi động xong và ở yên (không restart), chỉ nhận request khi đã sẵn sàng; giao dịch viên gọi được.",
  concepts:["liveness probe","readiness probe","startup probe","CrashLoopBackOff","initialDelaySeconds","failureThreshold"],
  yaml:`# CloudLab Kubernetes · lab-probes · Core API cứ khởi động lại
apiVersion: v1
kind: Secret
metadata:
  name: core-db
type: Opaque
stringData:
  password: doi-mat-khau-nay
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: core-api
spec:
  replicas: 2
  selector:
    matchLabels: {app: core-api}
  template:
    metadata:
      labels: {app: core-api}
    spec:
      containers:
        - name: core-api
          image: ${REG}/core-api:5.3.0
          ports: [{containerPort: 8080}]
          env:
            - {name: DB_HOST, value: core-db.internal}
            - name: DB_PASSWORD
              valueFrom: {secretKeyRef: {name: core-db, key: password}}
          resources:
            requests: {cpu: 500m, memory: 512Mi}
            limits: {cpu: "1", memory: 768Mi}
          livenessProbe:
            httpGet: {path: /healthz, port: 8080}
            initialDelaySeconds: 10
            periodSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet: {path: /health, port: 8080}
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: core-api
spec:
  selector: {app: core-api}
  ports: [{port: 80, targetPort: 8080}]
`+CLIENT("tellers","svc/core-api","  ratePerSecond: 15\n  from:\n    namespace: default\n    labels: {app: teller-portal}")+POOL(3),
  layout:{"client/tellers":[40,80],"nodepool/nodes":[40,400],"svc/core-api":[380,80],"deploy/core-api":[720,80],"secret/core-db":[1060,80]},
  explain:{"client/tellers":"Ứng dụng của giao dịch viên chạy trong cùng cluster, gọi core API khoảng 15 lần mỗi giây.","svc/core-api":"Địa chỉ nội bộ (ClusterIP) của core API.",
    "deploy/core-api":"Core API: cần khoảng 45 giây để nạp dữ liệu tham chiếu rồi mới trả lời. Phục vụ /healthz (còn sống) và /ready (sẵn sàng nhận việc).","secret/core-db":"Mật khẩu database của core API."},
  tasks:[{t:"Liveness không giết app khi app còn đang khởi động",c:"Pod mới chạy liền mạch, không restart.",test:()=>kRun(180,()=>{const d=first("Deployment");return readyAll(d)&&curRestarts(d)===0})},
    {t:"Readiness probe hỏi đúng đường dẫn app phục vụ",c:"Pod chuyển Ready khi app sẵn sàng.",test:()=>{const d=first("Deployment"),c=ctrOf(d)||{};return!!c.readinessProbe&&probeOk(c.readinessProbe,imageCheck(c.image).app||{},c)}},
    {t:"Giao dịch viên gọi được core API",c:"Hơn 95% request thành công.",test:()=>kRun(180,()=>okShare(clientNamed("tellers"))>0.95)}],
  hints:()=>["Bấm core-api, xem cột Restart và dòng “Lần lỗi gần nhất”: ai đã khởi động lại container?","Liveness bắt đầu hỏi sau 10 giây, chịu 3 lần lỗi cách nhau 5 giây: tới giây 20 là giết container. App cần 45 giây mới trả lời.","Cách chuẩn cho app khởi động chậm: thêm startup probe (ví dụ /healthz, mỗi 5 giây, chịu 12 lần = 60 giây). Readiness thì app phục vụ /ready, không phải /health."],
  diagnose:i=>ladder([[()=>kRun(150,()=>curRestarts(first("Deployment"))===0),["core-api bị khởi động lại liên tục (CrashLoopBackOff), chưa lần nào chạy xong.","Thủ phạm là liveness probe: lý do restart ghi “Liveness probe failed: connection refused”.","App cần 45 giây; liveness chỉ chờ 10 + 2 × 5 = 20 giây. Thêm startup probe chờ đủ lâu (failureThreshold × periodSeconds ≥ 45), hoặc tăng initialDelaySeconds của liveness lên 60."]],
    [()=>{const c=ctrOf(first("Deployment"))||{};return!!c.readinessProbe&&probeOk(c.readinessProbe,imageCheck(c.image).app||{},c)},["App đã chạy ổn nhưng pod không bao giờ Ready, Service không có endpoint.","Readiness probe hỏi GET /health.","App phục vụ /ready (và /healthz), không có /health. Đổi đường dẫn readiness thành /ready."]]],i),
  solve(){fixCtr("deploy/core-api",c=>{c.startupProbe={httpGet:{path:"/healthz",port:8080},periodSeconds:5,failureThreshold:12};c.readinessProbe={httpGet:{path:"/ready",port:8080},periodSeconds:5}},"startup probe 60s, readiness /ready")},
  pass:"Ba probe ba việc: startup chờ app khởi động, liveness khởi động lại app bị treo, readiness quyết định pod có nhận traffic không. Liveness quá vội biến app chậm thành app chết; thiếu readiness thì khách bị gửi vào app chưa sẵn sàng."};

const L_ING={id:"ingress",phase:"Ra Internet",step:4,title:"Một cửa vào: Ingress",tag:"Ingress thay LoadBalancer",who:["T","Tuấn · bảo mật"],speed:1,
  scenario:"Năm IP công khai.",goal:"Khách và đối tác vào qua một Ingress duy nhất; back-office không còn mở ra Internet; không còn Service kiểu LoadBalancer.",
  concepts:["Ingress","ingress controller","host và đường dẫn","Service ClusterIP","LoadBalancer","bề mặt tấn công","chi phí load balancer"],
  yaml:`# CloudLab Kubernetes · lab-ingress · Mỗi dịch vụ một IP công khai
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ib-web
spec:
  replicas: 2
  selector:
    matchLabels: {app: ib-web}
  template:
    metadata:
      labels: {app: ib-web}
    spec:
      containers:
        - name: ib-web
          image: ${REG}/ib-web:2.4.1
          ports: [{containerPort: 8080}]
          resources: {requests: {cpu: 250m, memory: 256Mi}, limits: {cpu: 500m, memory: 512Mi}}
          readinessProbe: {httpGet: {path: /healthz, port: 8080}}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
spec:
  replicas: 2
  selector:
    matchLabels: {app: payment-api}
  template:
    metadata:
      labels: {app: payment-api}
    spec:
      containers:
        - name: payment-api
          image: ${REG}/payment-api:3.1.2
          ports: [{containerPort: 8080}]
          resources: {requests: {cpu: 250m, memory: 256Mi}, limits: {cpu: 500m, memory: 512Mi}}
          readinessProbe: {httpGet: {path: /healthz, port: 8080}}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: admin-portal
spec:
  replicas: 1
  selector:
    matchLabels: {app: admin-portal}
  template:
    metadata:
      labels: {app: admin-portal}
    spec:
      containers:
        - name: admin-portal
          image: ${REG}/admin-portal:4.0.2
          ports: [{containerPort: 3000}]
          resources: {requests: {cpu: 100m, memory: 128Mi}, limits: {cpu: 250m, memory: 256Mi}}
          readinessProbe: {httpGet: {path: /health, port: 3000}}
---
apiVersion: v1
kind: Service
metadata:
  name: ib-web
spec:
  type: LoadBalancer
  selector: {app: ib-web}
  ports: [{port: 80, targetPort: 8080}]
---
apiVersion: v1
kind: Service
metadata:
  name: payment-api
spec:
  type: LoadBalancer
  selector: {app: payment-api}
  ports: [{port: 80, targetPort: 8080}]
---
apiVersion: v1
kind: Service
metadata:
  name: admin-portal
spec:
  type: LoadBalancer
  selector: {app: admin-portal}
  ports: [{port: 80, targetPort: 3000}]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: public
spec:
  ingressClassName: nginx
  tls: [{hosts: [ib.anphat.vn], secretName: ib-tls}]
  rules:
    - host: ib.anphat.vn
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: {name: ib-web, port: {number: 80}}
          - path: /api
            pathType: Prefix
            backend:
              service: {name: payment-api, port: {number: 80}}
`+CLIENT("customers","svc/ib-web","  ratePerSecond: 30")+CLIENT("partners","svc/payment-api","  ratePerSecond: 10")+CLIENT("internet-scanner","svc/admin-portal","  ratePerSecond: 0.2\n  expect: Deny")+POOL(3),
  layout:{"client/customers":[40,60],"client/partners":[40,330],"client/internet-scanner":[40,620],"nodepool/nodes":[40,900],"ing/public":[400,330],"svc/ib-web":[760,60],"svc/payment-api":[760,330],"svc/admin-portal":[760,620],"deploy/ib-web":[1100,60],"deploy/payment-api":[1100,330],"deploy/admin-portal":[1100,620]},
  explain:{"client/customers":"Khách vào web Internet Banking, hiện gọi thẳng IP của Service ib-web.","client/partners":"Đối tác (ví điện tử, sàn TMĐT) gọi API thanh toán, hiện gọi thẳng IP của Service payment-api.",
    "client/internet-scanner":"Một máy quét lạ trên Internet thử mở trang quản trị. Request này lẽ ra phải bị chặn.","ing/public":"Ingress đã được dựng sẵn: ib.anphat.vn/ → web, /api → API thanh toán, có TLS. Chưa ai dùng nó.",
    "svc/admin-portal":"Back-office cho nhân viên duyệt hồ sơ. Kiểu LoadBalancer = có IP công khai, ai cũng mở được trang đăng nhập.","svc/ib-web":"Kiểu LoadBalancer: một load balancer riêng, tính tiền theo giờ.","svc/payment-api":"Kiểu LoadBalancer: thêm một load balancer và IP công khai nữa."},
  tasks:[{t:"Khách và đối tác đi qua Ingress",c:"Hai client gọi Ingress public, và vẫn thành công.",test:()=>{const a=clientNamed("customers"),b=clientNamed("partners");return!!a&&!!b&&[a,b].every(x=>(nodeOf(getP(x.props,"spec.target"))||{}).type==="Ingress")&&String(getP(b.props,"spec.path")||"").startsWith("/api")&&kRun(60,()=>okShare(clientNamed("customers"))>0.95&&okShare(clientNamed("partners"))>0.95)}},
    {t:"Không còn Service kiểu LoadBalancer",c:"Chỉ còn một load balancer (của ingress controller).",test:()=>!allNodes().some(n=>n.type==="Service"&&getP(n.props,"spec.type")==="LoadBalancer")},
    {t:"Back-office không mở ra Internet",c:"Máy quét bị chặn; Ingress không có luật nào tới admin-portal.",test:()=>!allNodes().some(n=>n.type==="Ingress"&&arr(getP(n.props,"spec.rules")).some(r=>arr(getP(r||{},"http.paths")).some(x=>getP(x||{},"backend.service.name")==="admin-portal")))&&kRun(60,()=>{const s=clientNamed("internet-scanner");return!!s&&errOf(s)>0&&!((RT.n[s.id]||{m:{}}).m.ok)})}],
  hints:()=>["Đếm số khối Service có pill “IP public”: mỗi cái là một load balancer, một IP công khai, và một cửa vào phải canh.","Kéo từ chấm của client customers sang Ingress public (đối tác cũng vậy, đặt đường dẫn /api). Ingress chia request theo đường dẫn tới đúng Service.","Khi khách đã đi qua Ingress, đổi kiểu cả ba Service về ClusterIP. Back-office thì không thêm vào Ingress: nhân viên vào qua mạng nội bộ / VPN."],
  diagnose:i=>ladder([[()=>["customers","partners"].every(nm=>{const x=clientNamed(nm);return x&&(nodeOf(getP(x.props,"spec.target"))||{}).type==="Ingress"}),["Khách và đối tác vẫn gọi thẳng IP của từng Service.","Hai client đang trỏ tới Service, bỏ qua Ingress public đã dựng sẵn.","Nối customers → Ingress public (host ib.anphat.vn, đường dẫn /) và partners → Ingress public (đường dẫn /api)."]],
    [()=>!allNodes().some(n=>n.type==="Service"&&getP(n.props,"spec.type")==="LoadBalancer"),["Vẫn còn Service kiểu LoadBalancer: vẫn có IP công khai mở thẳng vào app.","Xem pill “IP public” trên các khối Service.","Đổi Kiểu của từng Service thành ClusterIP. Ingress vẫn gọi được chúng từ bên trong cluster."]],
    [()=>kRun(60,()=>okShare(clientNamed("customers"))>0.95&&okShare(clientNamed("partners"))>0.95),["Khách hoặc đối tác bị lỗi khi đi qua Ingress.","Xem mũi tên đỏ từ Ingress và lý do lỗi.","Host của client phải là ib.anphat.vn và đường dẫn khớp một luật (/ cho web, /api cho đối tác)."]]],i),
  solve(){edit("đi qua Ingress, bỏ LoadBalancer",()=>{for(const[nm,path]of [["customers","/"],["partners","/api"]]){const c=clientNamed(nm);c.props.spec.target="ing/public";c.props.spec.host="ib.anphat.vn";c.props.spec.path=path}for(const s of allNodes())if(s.type==="Service")s.props.spec.type="ClusterIP"});solveLog("clients → ing/public; mọi Service → ClusterIP")},
  pass:"Một Ingress, một load balancer, một chỗ đặt TLS và tường lửa ứng dụng; mọi Service khác là ClusterIP, chỉ có địa chỉ bên trong cluster. Công cụ nội bộ không cần nằm trên Internet chỉ vì tiện."};

const L_RES={id:"resources",phase:"Tải và tài nguyên",step:5,title:"Requests và limits",tag:"OOMKilled + Pending",who:["H","Hà · vận hành"],speed:1,
  scenario:"Sao kê gián đoạn.",goal:"statement-api không còn bị OOMKilled; statement-export được xếp lên node và chạy.",
  concepts:["requests","limits","OOMKilled","Pending","Insufficient cpu","node allocatable"],
  yaml:`# CloudLab Kubernetes · lab-resources · Pod bị tắt ngang, pod mới không lên
apiVersion: apps/v1
kind: Deployment
metadata:
  name: statement-api
spec:
  replicas: 2
  selector:
    matchLabels: {app: statement-api}
  template:
    metadata:
      labels: {app: statement-api}
    spec:
      containers:
        - name: statement-api
          image: ${REG}/statement-api:1.9.0
          ports: [{containerPort: 8080}]
          resources:
            requests: {cpu: 250m, memory: 256Mi}
            limits: {cpu: 500m, memory: 256Mi}
          readinessProbe: {httpGet: {path: /healthz, port: 8080}}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: statement-export
spec:
  replicas: 1
  selector:
    matchLabels: {app: statement-export}
  template:
    metadata:
      labels: {app: statement-export}
    spec:
      containers:
        - name: statement-export
          image: ${REG}/statement-api:1.9.0
          ports: [{containerPort: 8080}]
          resources:
            requests: {cpu: "3", memory: 1Gi}
            limits: {cpu: "3", memory: 2Gi}
          readinessProbe: {httpGet: {path: /healthz, port: 8080}}
---
apiVersion: v1
kind: Service
metadata:
  name: statement-api
spec:
  type: LoadBalancer
  selector: {app: statement-api}
  ports: [{port: 80, targetPort: 8080}]
`+CLIENT("customers","svc/statement-api","  ratePerSecond: 20")+POOL(3),
  layout:{"client/customers":[40,80],"nodepool/nodes":[40,400],"svc/statement-api":[380,80],"deploy/statement-api":[720,80],"deploy/statement-export":[720,400]},
  explain:{"deploy/statement-api":"API tra cứu sao kê. Khi chạy, app dùng khoảng 350Mi memory.","deploy/statement-export":"Xuất sao kê PDF cuối tháng: xin 3 vCPU cho mỗi pod.","nodepool/nodes":"3 node t3.medium: mỗi node 2 vCPU, 4 GiB; trừ phần hệ thống còn 1800m CPU và 3200Mi cho pod.","svc/statement-api":"Khách xem sao kê qua đây.","client/customers":"Khách xem sao kê trên app."},
  tasks:[{t:"statement-api không còn bị OOMKilled",c:"limits.memory đủ cho app (≥ 350Mi); pod không restart.",test:()=>kRun(150,()=>{const d=byName("Deployment","statement-api");return readyAll(d)&&curRestarts(d)===0})},
    {t:"statement-export được xếp lên node",c:"requests.cpu vừa một node (≤ 1800m) và pod Ready.",test:()=>kRun(120,()=>readyAll(byName("Deployment","statement-export")))},
    {t:"Khách xem được sao kê",c:"Hơn 95% request thành công.",test:()=>kRun(150,()=>okShare(clientNamed("customers"))>0.95)}],
  hints:()=>["Bấm statement-api: lý do restart là OOMKilled. App cần bao nhiêu memory, limit đang cho bao nhiêu?","Bấm statement-export: pod Pending, lý do ghi “Insufficient cpu”. Xin 3 vCPU trong khi một node chỉ có 1800m cho pod.","Đặt limits.memory của statement-api ≥ 350Mi (ví dụ 512Mi). Hạ requests.cpu của statement-export xuống (ví dụ 1) hoặc chọn node lớn hơn trong node pool (tốn tiền hơn)."],
  diagnose:i=>ladder([[()=>(memQ(getP(ctrOf(byName("Deployment","statement-api"))||{},"resources.limits.memory"))??1e9)>=350,["statement-api cứ chạy được vài giây lại bị tắt (OOMKilled → CrashLoopBackOff).","Lỗi ở resources.limits.memory của statement-api: 256Mi.","App cần khoảng 350Mi. Vượt limit là kernel giết container. Đặt limits.memory 512Mi."]],
    [()=>kRun(90,()=>readyAll(byName("Deployment","statement-export"))),["statement-export không bao giờ chạy: pod nằm Pending.","Scheduler báo 0/3 nodes are available: Insufficient cpu.","Pod xin 3000m CPU, một node t3.medium chỉ còn 1800m cho pod. Giảm requests.cpu (ví dụ 1), hoặc đổi node pool sang m5.xlarge (4 vCPU)."]]],i),
  solve(){fixCtr("deploy/statement-api",c=>{c.resources.limits.memory="512Mi"},"limits.memory 512Mi");fixCtr("deploy/statement-export",c=>{c.resources={requests:{cpu:"1",memory:"1Gi"},limits:{cpu:"1500m",memory:"2Gi"}}},"requests.cpu 1")},
  pass:"requests là chỗ đặt trước khi xếp pod lên node; limits là trần lúc chạy. Memory vượt trần thì bị giết (OOMKilled); xin nhiều hơn một node có thì không bao giờ được xếp (Pending). Cả hai con số nên đo từ mức dùng thật."};

/* one simulated hour (a full payday peak, wherever the clock is), tracking the most pods Ready at once */
const paydayRun=()=>probe(()=>{if(!stackUp())deploy();RT.q=[];for(const k in RT.n)RT.n[k]={cost:0,m:{},tk:{},series:[],last:null};RT.flow={};RT.why={};const d=byName("Deployment","payment-api")||first("Deployment");let t=0,maxReady=0,pend=0;
  while(t<3600){step(15);t+=15;const L=RT.pods[d.id]||[];maxReady=Math.max(maxReady,L.filter(p=>p.ready).length);if(L.some(p=>p.phase==="Pending"))pend++}return{maxReady,pend,ok:okShare(clientNamed("payday"))}});
const L_HPA={id:"hpa",phase:"Tải và tài nguyên",step:6,title:"Ngày lương về: HPA",tag:"HorizontalPodAutoscaler",who:["M","Minh · mentor"],speed:2,
  scenario:"Ngày lương về.",goal:"Khi tải lên gấp 8 lần, payment-api tự tăng pod và khách vẫn chuyển tiền được (lỗi dưới 1%).",
  concepts:["HorizontalPodAutoscaler","requests.cpu","% CPU utilization","minReplicas / maxReplicas","scale-up, stabilization","node pool capacity"],
  yaml:`# CloudLab Kubernetes · lab-hpa · Có HPA mà số pod vẫn đứng yên
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
spec:
  replicas: 2
  selector:
    matchLabels: {app: payment-api}
  template:
    metadata:
      labels: {app: payment-api}
    spec:
      containers:
        - name: payment-api
          image: ${REG}/payment-api:3.1.2
          ports: [{containerPort: 8080}]
          resources:
            limits: {cpu: 500m, memory: 512Mi}
          readinessProbe: {httpGet: {path: /healthz, port: 8080}}
---
apiVersion: v1
kind: Service
metadata:
  name: payment-api
spec:
  selector: {app: payment-api}
  ports: [{port: 80, targetPort: 8080}]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: public
spec:
  ingressClassName: nginx
  rules:
    - host: ib.anphat.vn
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service: {name: payment-api, port: {number: 80}}
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: payment-api
spec:
  scaleTargetRef: {apiVersion: apps/v1, kind: Deployment, name: payment-api}
  minReplicas: 2
  maxReplicas: 4
  metrics:
    - type: Resource
      resource:
        name: cpu
        target: {type: Utilization, averageUtilization: 70}
`+CLIENT("payday","ing/public","  ratePerSecond: 40\n  pattern: payday\n  peak: 8\n  host: ib.anphat.vn\n  path: /api")+POOL(2,"t3.medium",2),
  layout:{"client/payday":[40,80],"nodepool/nodes":[40,420],"ing/public":[380,80],"svc/payment-api":[720,80],"deploy/payment-api":[1060,80],"hpa/payment-api":[1060,420]},
  explain:{"client/payday":"Ngày 25: bình thường 40 lệnh chuyển tiền mỗi giây, đỉnh gấp 8 lần (320/giây) kéo dài khoảng nửa giờ, lặp lại mỗi giờ mô phỏng.","deploy/payment-api":"API chuyển tiền. Mỗi request tốn khoảng 8ms CPU: một pod với limits 500m chịu chừng 60 request/giây.",
    "hpa/payment-api":"Tự co giãn theo CPU, mục tiêu 70% của requests.cpu. Bấm vào để xem vì sao nó chưa làm gì.","nodepool/nodes":"2 node t3.medium: còn 3600m CPU cho pod.","ing/public":"Cửa vào chung; /api tới payment-api.","svc/payment-api":"Chia lệnh cho các pod payment-api."},
  tasks:[{t:"HPA đo được CPU",c:"Container khai báo resources.requests.cpu.",test:()=>!!cpuQ(getP(ctrOf(byName("Deployment","payment-api"))||{},"resources.requests.cpu"))},
    {t:"Đủ pod cho giờ cao điểm, và node đủ chỗ cho chúng",c:"Lúc đỉnh có từ 6 pod Ready trở lên.",test:()=>paydayRun().maxReady>=6},
    {t:"Khách chuyển tiền được suốt ngày lương",c:"Lỗi dưới 1% qua trọn một giờ có đỉnh tải.",test:()=>paydayRun().ok>=0.99}],
  hints:()=>["Bấm HPA payment-api: nó báo FailedGetResourceMetric, missing request for cpu. HPA tính % CPU so với requests.cpu.","Đỉnh 320 request/giây, mỗi pod (limits 500m) chịu khoảng 60: cần ít nhất 6 pod. maxReplicas đang là 4.","Thêm requests.cpu (ví dụ 250m) cho payment-api, nâng maxReplicas lên 10. 10 pod × 250m = 2500m, vừa 2 node."],
  diagnose:i=>ladder([[()=>!!cpuQ(getP(ctrOf(byName("Deployment","payment-api"))||{},"resources.requests.cpu")),["Tải tăng nhưng số pod vẫn là 2: HPA không làm gì.","HPA báo: missing request for cpu.","HPA đo CPU theo % của requests.cpu. Container chưa khai báo requests.cpu thì HPA không tính được. Thêm resources.requests.cpu: 250m."]],
    [()=>(+getP(byName("HorizontalPodAutoscaler","payment-api").props,"spec.maxReplicas")||0)>=6,["HPA đã tăng pod nhưng dừng ở 4, lỗi vẫn nhiều lúc cao điểm.","maxReplicas của HPA là 4.","320 request/giây ÷ khoảng 60 mỗi pod = 6 pod trở lên. Đặt maxReplicas 10."]],
    [()=>paydayRun().pend<4,["HPA muốn thêm pod nhưng pod mới nằm Pending.","Node pool hết CPU cho requests.","Giảm requests.cpu cho vừa (10 × 250m vừa 2 node), hoặc tăng maxNodes của node pool."]]],i),
  solve(){fixCtr("deploy/payment-api",c=>{c.resources={requests:{cpu:"250m",memory:"256Mi"},limits:{cpu:"500m",memory:"512Mi"}}},"requests.cpu 250m");const h=byName("HorizontalPodAutoscaler","payment-api");edit("maxReplicas 10",()=>{nodeOf(h.id).props.spec.maxReplicas=10});solveLog("hpa/payment-api: maxReplicas 10")},
  pass:"HPA chỉ là phép tính: % CPU = CPU đang dùng ÷ requests.cpu. Không có requests thì không có phép tính; maxReplicas quá thấp thì dừng sớm; node pool hết chỗ thì pod mới nằm Pending. Ngày cao điểm cần cả ba thứ đúng."};

const L_SEC={id:"secrets",phase:"Bảo mật",step:7,title:"Mật khẩu không để trong ConfigMap",tag:"Secret + secretKeyRef",who:["V","Vy · kiểm toán"],speed:1,
  scenario:"Mật khẩu trong file cấu hình.",goal:"Mật khẩu database của loan-api nằm trong một Secret; không ConfigMap nào còn mật khẩu; app vẫn chạy.",
  concepts:["ConfigMap","Secret","secretKeyRef","envFrom","base64 ≠ mã hóa","encryption at rest","RBAC"],
  yaml:`# CloudLab Kubernetes · lab-secrets · Mật khẩu nằm trong ConfigMap
apiVersion: v1
kind: Secret
metadata:
  name: ledger-db
type: Opaque
stringData:
  password: AnPhat@2024
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: loan-config
data:
  DB_HOST: ledger-db
  DB_PASSWORD: AnPhat@2024
  LOG_LEVEL: info
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: loan-api
spec:
  replicas: 2
  selector:
    matchLabels: {app: loan-api}
  template:
    metadata:
      labels: {app: loan-api}
    spec:
      containers:
        - name: loan-api
          image: ${REG}/loan-api:2.2.0
          ports: [{containerPort: 8080}]
          envFrom: [{configMapRef: {name: loan-config}}]
          resources: {requests: {cpu: 250m, memory: 256Mi}, limits: {cpu: 500m, memory: 512Mi}}
          readinessProbe: {httpGet: {path: /healthz, port: 8080}}
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: ledger-db
spec:
  serviceName: ledger-db
  replicas: 1
  selector:
    matchLabels: {app: ledger-db}
  template:
    metadata:
      labels: {app: ledger-db}
    spec:
      containers:
        - name: postgres
          image: postgres:16
          ports: [{containerPort: 5432}]
          env:
            - name: POSTGRES_PASSWORD
              valueFrom: {secretKeyRef: {name: ledger-db, key: password}}
          resources: {requests: {cpu: 250m, memory: 512Mi}, limits: {memory: 1Gi}}
  volumeClaimTemplates:
    - metadata: {name: data}
      spec: {accessModes: [ReadWriteOnce], storageClassName: gp3, resources: {requests: {storage: 20Gi}}}
---
apiVersion: v1
kind: Service
metadata:
  name: ledger-db
spec:
  selector: {app: ledger-db}
  ports: [{port: 5432, targetPort: 5432}]
---
apiVersion: v1
kind: Service
metadata:
  name: loan-api
spec:
  selector: {app: loan-api}
  ports: [{port: 80, targetPort: 8080}]
`+CLIENT("loan-officers","svc/loan-api","  ratePerSecond: 5\n  from:\n    namespace: default\n    labels: {app: branch-portal}")+POOL(3),
  layout:{"client/loan-officers":[40,80],"nodepool/nodes":[40,420],"svc/loan-api":[380,80],"deploy/loan-api":[720,80],"cm/loan-config":[1060,80],"svc/ledger-db":[720,420],"sts/ledger-db":[1060,420],"secret/ledger-db":[1400,420]},
  explain:{"cm/loan-config":"Cấu hình của API cho vay. Dòng DB_PASSWORD là mật khẩu database, đọc được bằng mắt thường bởi bất kỳ ai xem được cấu hình.","deploy/loan-api":"API cho vay: cần DB_HOST và DB_PASSWORD để kết nối database.",
    "sts/ledger-db":"Database PostgreSQL. Nó lấy mật khẩu đúng cách: từ Secret ledger-db qua secretKeyRef. Làm loan-api giống vậy.","secret/ledger-db":"Mật khẩu của database, đặt trong Secret.","svc/ledger-db":"Địa chỉ nội bộ của database.","svc/loan-api":"Địa chỉ nội bộ của API cho vay.","client/loan-officers":"Cổng thông tin của cán bộ tín dụng, chạy trong cluster."},
  tasks:[{t:"Không ConfigMap nào chứa mật khẩu",c:"Không còn khóa kiểu PASSWORD / SECRET / TOKEN trong ConfigMap.",test:()=>!allNodes().some(n=>n.type==="ConfigMap"&&Object.keys(n.props.data||{}).some(k=>SECRETY.test(k)))},
    {t:"loan-api lấy DB_PASSWORD từ một Secret",c:"Biến DB_PASSWORD của pod đến từ Secret.",test:()=>{const d=byName("Deployment","loan-api"),e=d&&envOf(d);return!!e&&!!e.from.DB_PASSWORD&&(nodeOf(e.from.DB_PASSWORD)||{}).type==="Secret"}},
    {t:"Cán bộ tín dụng vẫn dùng được API",c:"Pod Ready, hơn 95% request thành công.",test:()=>kRun(120,()=>readyAll(byName("Deployment","loan-api"))&&okShare(clientNamed("loan-officers"))>0.95)}],
  hints:()=>["Mở ConfigMap loan-config: pill “Có mật khẩu”. ConfigMap dành cho cấu hình thường, ai đọc được namespace là đọc được nó.","Kéo một Secret từ thư viện vào canvas, thêm khóa DB_PASSWORD với mật khẩu. Rồi nối loan-api → Secret (envFrom) hoặc thêm biến DB_PASSWORD lấy từ Secret.","Cuối cùng xóa dòng DB_PASSWORD khỏi loan-config. Nếu xóa trước khi có Secret, loan-api thiếu biến và không khởi động được (thử xem)."],
  diagnose:i=>ladder([[()=>{const d=byName("Deployment","loan-api"),e=d&&envOf(d);return!!e&&!!e.from.DB_PASSWORD&&(nodeOf(e.from.DB_PASSWORD)||{}).type==="Secret"},["DB_PASSWORD của loan-api vẫn đến từ ConfigMap.","Mở loan-api → “Biến môi trường pod thấy”: DB_PASSWORD ← cm/loan-config.","Tạo Secret (ví dụ loan-db) có khóa DB_PASSWORD, rồi nạp vào loan-api bằng envFrom (secretRef) hoặc env + secretKeyRef."]],
    [()=>!allNodes().some(n=>n.type==="ConfigMap"&&Object.keys(n.props.data||{}).some(k=>SECRETY.test(k))),["Secret đã có nhưng ConfigMap vẫn còn mật khẩu: vẫn lộ.","Khối loan-config vẫn có khóa DB_PASSWORD.","Xóa dòng DB_PASSWORD khỏi loan-config (Dữ liệu → ✕)."]],
    [()=>kRun(120,()=>readyAll(byName("Deployment","loan-api"))),["loan-api không khởi động sau khi sửa.","Xem lý do restart của pod.","App cần đủ cả DB_HOST và DB_PASSWORD. Kiểm tra Secret có đúng khóa DB_PASSWORD và loan-api đã nạp Secret đó."]]],i),
  solve(){edit("tạo Secret loan-db",()=>{M.res["secret/loan-db"]={Type:"Secret",Properties:{metadata:{name:"loan-db"},type:"Opaque",stringData:{DB_PASSWORD:"AnPhat@2024"}}};M.pos["secret/loan-db"]=[1060,240]});
    fixCtr("deploy/loan-api",c=>{c.envFrom=[{configMapRef:{name:"loan-config"}},{secretRef:{name:"loan-db"}}]},"nạp Secret loan-db");edit("bỏ mật khẩu khỏi ConfigMap",()=>{delete nodeOf("cm/loan-config").props.data.DB_PASSWORD});solveLog("cm/loan-config: bỏ DB_PASSWORD")},
  pass:"Secret tách mật khẩu ra để phân quyền riêng (ai được get secrets), không in ra log và có thể mã hóa khi lưu. Nhưng base64 không phải mã hóa: cluster thật cần bật encryption at rest và giới hạn RBAC, hoặc dùng kho bí mật bên ngoài (AWS Secrets Manager, Vault)."};

const L_NP={id:"netpol",phase:"Bảo mật",step:8,title:"NetworkPolicy: cô lập vùng dữ liệu thẻ",tag:"NetworkPolicy + DNS giữa namespace",who:["T","Tuấn · bảo mật"],speed:1,
  scenario:"Marketing gọi được kho thẻ.",goal:"Chỉ namespace payments gọi được card-vault; marketing bị chặn; thanh toán của khách vẫn chạy.",
  concepts:["Namespace","NetworkPolicy","default deny","namespaceSelector","DNS: service.namespace","PCI DSS segmentation"],
  yaml:`# CloudLab Kubernetes · lab-netpol · Ai cũng gọi được kho dữ liệu thẻ
apiVersion: v1
kind: Namespace
metadata:
  name: card
  labels: {pci: "true"}
---
apiVersion: v1
kind: Namespace
metadata:
  name: payments
  labels: {team: payments}
---
apiVersion: v1
kind: Namespace
metadata:
  name: marketing
  labels: {team: marketing}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: card-vault
  namespace: card
spec:
  replicas: 2
  selector:
    matchLabels: {app: card-vault}
  template:
    metadata:
      labels: {app: card-vault}
    spec:
      containers:
        - name: card-vault
          image: ${REG}/card-vault:1.7.0
          ports: [{containerPort: 8443}]
          resources: {requests: {cpu: 250m, memory: 256Mi}, limits: {cpu: 500m, memory: 512Mi}}
          readinessProbe: {httpGet: {path: /healthz, port: 8443}}
---
apiVersion: v1
kind: Service
metadata:
  name: card-vault
  namespace: card
spec:
  selector: {app: card-vault}
  ports: [{port: 443, targetPort: 8443}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
  namespace: payments
spec:
  replicas: 2
  selector:
    matchLabels: {app: payment-api}
  template:
    metadata:
      labels: {app: payment-api}
    spec:
      containers:
        - name: payment-api
          image: ${REG}/payment-api:3.1.2
          ports: [{containerPort: 8080}]
          env:
            - {name: VAULT_URL, value: "https://card-vault:443"}
          resources: {requests: {cpu: 250m, memory: 256Mi}, limits: {cpu: 500m, memory: 512Mi}}
          readinessProbe: {httpGet: {path: /healthz, port: 8080}}
---
apiVersion: v1
kind: Service
metadata:
  name: payment-api
  namespace: payments
spec:
  selector: {app: payment-api}
  ports: [{port: 80, targetPort: 8080}]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: checkout
  namespace: payments
spec:
  ingressClassName: nginx
  rules:
    - host: pay.anphat.vn
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: {name: payment-api, port: {number: 80}}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: campaign-api
  namespace: marketing
spec:
  replicas: 1
  selector:
    matchLabels: {app: campaign-api}
  template:
    metadata:
      labels: {app: campaign-api}
    spec:
      containers:
        - name: campaign-api
          image: ${REG}/campaign-api:1.2.0
          ports: [{containerPort: 8080}]
          resources: {requests: {cpu: 100m, memory: 128Mi}, limits: {cpu: 250m, memory: 256Mi}}
`+CLIENT("checkout","ing/checkout","  ratePerSecond: 10\n  host: pay.anphat.vn\n  path: /")+CLIENT("from-marketing","svc/card-vault","  ratePerSecond: 0.5\n  expect: Deny\n  from:\n    namespace: marketing\n    labels: {app: campaign-api}")+POOL(3),
  layout:{"client/checkout":[40,80],"client/from-marketing":[40,620],"nodepool/nodes":[40,900],"ing/checkout":[440,80],"svc/payment-api":[440,340],"deploy/payment-api":[800,80],"svc/card-vault":[1240,80],"deploy/card-vault":[1240,340],"deploy/campaign-api":[440,700],"ns/card":[1200,20],"ns/payments":[400,20],"ns/marketing":[400,640]},
  explain:{"ns/card":"Vùng dữ liệu thẻ (cardholder data environment). Nhãn pci=true.","ns/payments":"Khối Thanh toán, nhãn team=payments: được phép gọi kho thẻ.","ns/marketing":"Khối Marketing, nhãn team=marketing: không có lý do gì để chạm dữ liệu thẻ.",
    "deploy/card-vault":"Kho token hóa số thẻ. Nghe cổng 8443.","svc/card-vault":"Địa chỉ của kho thẻ: card-vault.card.svc.cluster.local.","deploy/payment-api":"API thanh toán: gọi kho thẻ qua biến VAULT_URL.",
    "client/checkout":"Khách thanh toán trên pay.anphat.vn.","client/from-marketing":"Thử nghiệm xâm nhập: đứng từ một pod của campaign-api gọi thẳng kho thẻ. Lẽ ra phải bị chặn.","deploy/campaign-api":"API chiến dịch khuyến mãi của Marketing."},
  tasks:[{t:"payment-api tìm thấy card-vault",c:"VAULT_URL dùng tên DNS có namespace.",test:()=>{const d=byName("Deployment","payment-api");return!!d&&depsOf(d).some(x=>x.ok&&nmOf(nodeOf(x.svc))==="card-vault")}},
    {t:"Marketing không gọi được kho thẻ",c:"Có NetworkPolicy trong namespace card; request từ marketing bị chặn.",test:()=>kRun(60,()=>{const c=clientNamed("from-marketing");return!!c&&errOf(c)>0&&!((RT.n[c.id]||{m:{}}).m.ok)})},
    {t:"Khách vẫn thanh toán được",c:"Hơn 95% request thanh toán thành công (payments vẫn được vào kho thẻ).",test:()=>kRun(90,()=>okShare(clientNamed("checkout"))>0.95)}],
  hints:()=>["Bấm payment-api: request lỗi “could not resolve host card-vault”. Tên Service ngắn chỉ có nghĩa trong cùng namespace.","Đổi VAULT_URL thành https://card-vault.card:443. Giờ thanh toán chạy, nhưng marketing cũng vẫn gọi được kho thẻ.","Kéo một NetworkPolicy vào khung namespace card: mặc định nó chặn hết. Thêm một luật cho phép: namespace có nhãn team=payments, cổng 8443."],
  diagnose:i=>ladder([[()=>depsOf(byName("Deployment","payment-api")).some(x=>x.ok),["Thanh toán lỗi: payment-api không gọi được kho thẻ.","Mũi tên payment-api → card-vault ghi “DNS ✕”.","payment-api ở namespace payments, card-vault ở namespace card. Gọi tên ngắn card-vault chỉ tìm trong payments. Dùng card-vault.card (hoặc card-vault.card.svc.cluster.local)."]],
    [()=>allNodes().some(n=>n.type==="NetworkPolicy"&&nsOf(n)==="card"),["Marketing vẫn gọi được kho thẻ: mặc định pod nào cũng gọi được pod nào.","Namespace card chưa có NetworkPolicy nào.","Thêm NetworkPolicy vào namespace card (kéo vào khung card). Policy chọn pod là bật “chặn trừ khi được phép”."]],
    [()=>kRun(60,()=>{const c=clientNamed("from-marketing");return errOf(c)>0&&!((RT.n[c.id]||{m:{}}).m.ok)}),["Có policy nhưng marketing vẫn lọt vào.","Xem luật cho phép của NetworkPolicy.","Luật đang cho phép quá rộng. Chỉ cho namespace có nhãn team=payments."]],
    [()=>kRun(90,()=>okShare(clientNamed("checkout"))>0.95),["Marketing đã bị chặn, nhưng thanh toán của khách cũng bị chặn luôn.","Mũi tên vào card-vault báo NetworkPolicy chặn payments.","Thêm luật cho phép: namespaceSelector team=payments, cổng 8443 (cổng của pod, không phải cổng 443 của Service)."]]],i),
  solve(){fixCtr("deploy/payment-api",c=>{c.env=[{name:"VAULT_URL",value:"https://card-vault.card:443"}]},"VAULT_URL card-vault.card");
    edit("NetworkPolicy chỉ cho payments",()=>{M.res["netpol/only-payments"]={Type:"NetworkPolicy",Properties:{metadata:{name:"only-payments",namespace:"card"},spec:{podSelector:{},policyTypes:["Ingress"],ingress:[{from:[{namespaceSelector:{matchLabels:{team:"payments"}}}],ports:[{port:8443}]}]}}};M.pos["netpol/only-payments"]=[1600,80]});solveLog("netpol/only-payments trong namespace card")},
  pass:"Namespace chỉ là cách đặt tên; nó không chặn gì cả. NetworkPolicy mới là tường lửa giữa các pod: một khi policy chọn pod, mọi traffic không được cho phép đều bị chặn. Và từ namespace khác, phải gọi Service bằng tên đầy đủ (service.namespace)."};

const L_PVC={id:"pvc",phase:"Dữ liệu và tác vụ",step:9,title:"Dữ liệu sống sót khi pod khởi động lại",tag:"PersistentVolumeClaim",who:["H","Hà · vận hành"],speed:1,
  scenario:"Yêu cầu tra soát biến mất.",goal:"Database tra soát lưu dữ liệu trên ổ đĩa bền: khởi động lại pod database, dữ liệu vẫn còn.",
  concepts:["PersistentVolumeClaim","StatefulSet","volumeMounts","emptyDir và dữ liệu tạm","ReadWriteOnce","storage class"],
  yaml:`# CloudLab Kubernetes · lab-pvc · Database mất dữ liệu sau khi khởi động lại
apiVersion: v1
kind: Secret
metadata:
  name: dispute-db
type: Opaque
stringData:
  password: doi-mat-khau-nay
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dispute-db
spec:
  replicas: 1
  selector:
    matchLabels: {app: dispute-db}
  template:
    metadata:
      labels: {app: dispute-db}
    spec:
      containers:
        - name: postgres
          image: postgres:16
          ports: [{containerPort: 5432}]
          env:
            - name: POSTGRES_PASSWORD
              valueFrom: {secretKeyRef: {name: dispute-db, key: password}}
          resources: {requests: {cpu: 250m, memory: 512Mi}, limits: {memory: 1Gi}}
---
apiVersion: v1
kind: Service
metadata:
  name: dispute-db
spec:
  selector: {app: dispute-db}
  ports: [{port: 5432, targetPort: 5432}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dispute-api
spec:
  replicas: 2
  selector:
    matchLabels: {app: dispute-api}
  template:
    metadata:
      labels: {app: dispute-api}
    spec:
      containers:
        - name: dispute-api
          image: ${REG}/loan-api:2.2.0
          ports: [{containerPort: 8080}]
          env:
            - {name: DB_HOST, value: dispute-db}
            - name: DB_PASSWORD
              valueFrom: {secretKeyRef: {name: dispute-db, key: password}}
          resources: {requests: {cpu: 250m, memory: 256Mi}, limits: {cpu: 500m, memory: 512Mi}}
          readinessProbe: {httpGet: {path: /healthz, port: 8080}}
---
apiVersion: v1
kind: Service
metadata:
  name: dispute-api
spec:
  selector: {app: dispute-api}
  ports: [{port: 80, targetPort: 8080}]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: public
spec:
  ingressClassName: nginx
  rules:
    - host: ib.anphat.vn
      http:
        paths:
          - path: /tra-soat
            pathType: Prefix
            backend:
              service: {name: dispute-api, port: {number: 80}}
`+CLIENT("customers","ing/public","  ratePerSecond: 2\n  host: ib.anphat.vn\n  path: /tra-soat")+POOL(3),
  layout:{"client/customers":[40,80],"nodepool/nodes":[40,420],"ing/public":[380,80],"svc/dispute-api":[720,80],"deploy/dispute-api":[1060,80],"svc/dispute-db":[1060,400],"deploy/dispute-db":[1400,400],"secret/dispute-db":[1400,80]},
  explain:{"deploy/dispute-db":"PostgreSQL lưu yêu cầu tra soát, chạy bằng Deployment, không gắn ổ đĩa nào: dữ liệu nằm trong container. Bấm Restart để thấy chuyện gì xảy ra.","deploy/dispute-api":"API nhận yêu cầu tra soát của khách, ghi vào database.",
    "svc/dispute-db":"Địa chỉ nội bộ của database.","secret/dispute-db":"Mật khẩu database.","client/customers":"Khách gửi yêu cầu tra soát (giao dịch lỗi, bị trừ tiền hai lần…).","ing/public":"Cửa vào: /tra-soat tới API tra soát.","svc/dispute-api":"Chia yêu cầu cho các pod API."},
  tasks:[{t:"Database ghi dữ liệu lên ổ đĩa bền",c:"Pod database gắn một PersistentVolumeClaim (hoặc là StatefulSet có volumeClaimTemplates).",test:()=>{const d=allNodes().find(n=>WORKLOADS.includes(n.type)&&(imageCheck((ctrOf(n)||{}).image).app||{}).db);return!!d&&(pvcClaims(d).length>0||(d.type==="StatefulSet"&&arr(getP(d.props,"spec.volumeClaimTemplates")).length>0))}},
    {t:"Khởi động lại database, dữ liệu vẫn còn",c:"Sau rollout restart, số bản ghi không về 0.",test:()=>probe(()=>{const d=allNodes().find(n=>WORKLOADS.includes(n.type)&&(imageCheck((ctrOf(n)||{}).image).app||{}).db);if(!d)return false;if(!stackUp())deploy();let t=0;while(t<120){step(5);t+=5}
      const rows=()=>{const dd=nodeOf(d.id);return(RT.pods[d.id]||[]).filter(p=>p.rev===revOf(dd)).reduce((a,p)=>a+((RT.vol[volKey(dd,p)]||{}).rows||0),0)},before=rows();
      setP(nodeOf(d.id).props,"spec.template.metadata.annotations",{"kubectl.kubernetes.io/restartedAt":"probe"});syncRuntime();t=0;while(t<60){step(5,true);t+=5}return before>0&&rows()>=before})},
    {t:"Khách vẫn gửi được yêu cầu tra soát",c:"Hơn 95% request thành công.",test:()=>kRun(120,()=>okShare(clientNamed("customers"))>0.95)}],
  hints:()=>["Bấm dispute-db, bấm Restart, rồi xem “Bản ghi đang có”: dữ liệu nằm “trong pod”. Pod mới là một container mới, trống trơn.","Cần một ổ đĩa sống lâu hơn pod: PersistentVolumeClaim. Kéo PVC từ thư viện vào canvas (storage class gp3).","Nối dispute-db → PVC: CloudLab gắn ổ đĩa vào /var/lib/postgresql/data, đúng chỗ PostgreSQL ghi dữ liệu. (Cách chuẩn hơn cho database: StatefulSet có volumeClaimTemplates, xem mẫu “Database có ổ đĩa riêng”.)"],
  diagnose:i=>ladder([[()=>{const d=allNodes().find(n=>WORKLOADS.includes(n.type)&&(imageCheck((ctrOf(n)||{}).image).app||{}).db);return!!d&&(pvcClaims(d).length>0||(d.type==="StatefulSet"&&arr(getP(d.props,"spec.volumeClaimTemplates")).length>0))},["Database khởi động lại là mất hết yêu cầu tra soát.","dispute-db không gắn ổ đĩa nào: dữ liệu ghi vào lớp tạm của container.","Tạo một PersistentVolumeClaim (gp3, ví dụ 20Gi) rồi gắn vào dispute-db (nối dispute-db → PVC)."]],
    [()=>allNodes().filter(n=>n.type==="PersistentVolumeClaim").every(n=>STORAGE_CLASSES.includes(getP(n.props,"spec.storageClassName")||"gp3")),["Pod database nằm Pending sau khi gắn ổ đĩa.","PVC đang Pending: storage class không tồn tại.","Chọn storage class gp3 (cluster này có gp3 và standard)."]]],i),
  solve(){edit("tạo PVC dispute-data",()=>{M.res["pvc/dispute-data"]={Type:"PersistentVolumeClaim",Properties:{metadata:{name:"dispute-data"},spec:{accessModes:["ReadWriteOnce"],storageClassName:"gp3",resources:{requests:{storage:"20Gi"}}}}};M.pos["pvc/dispute-data"]=[1400,720]});
    fixCtr("deploy/dispute-db",(c,n)=>{const s=podSpec(n);s.volumes=[{name:"data",persistentVolumeClaim:{claimName:"dispute-data"}}];c.volumeMounts=[{name:"data",mountPath:"/var/lib/postgresql/data"}]},"gắn PVC dispute-data")},
  pass:"Container là dùng xong bỏ: khởi động lại là một container mới. Thứ gì phải sống lâu hơn pod (database, file khách tải lên) phải nằm trên PersistentVolume. Và vẫn phải sao lưu: ổ đĩa bền không thay được bản sao lưu."};

const L_CRON={id:"cronjob",phase:"Dữ liệu và tác vụ",step:10,title:"Đối soát không được chạy hai lần",tag:"CronJob + concurrencyPolicy",who:["V","Vy · kiểm toán"],speed:2,
  scenario:"Bút toán bị ghi hai lần.",goal:"Job đối soát với NAPAS chạy mỗi 20 phút nhưng không bao giờ có hai lần chạy chồng nhau, và mỗi lần chạy đều xong.",
  concepts:["CronJob","Job","lịch cron","concurrencyPolicy: Allow / Forbid / Replace","activeDeadlineSeconds","idempotent"],
  yaml:`# CloudLab Kubernetes · lab-cronjob · Hai lần đối soát chạy chồng nhau
apiVersion: v1
kind: ConfigMap
metadata:
  name: recon-config
data:
  DB_HOST: ledger-db.internal
  SOURCE: napas
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: napas-recon
spec:
  schedule: "*/20 * * * *"
  concurrencyPolicy: Allow
  jobTemplate:
    spec:
      backoffLimit: 1
      template:
        metadata:
          labels: {app: napas-recon}
        spec:
          restartPolicy: Never
          containers:
            - name: recon
              image: ${REG}/recon-job:2.0.0
              envFrom: [{configMapRef: {name: recon-config}}]
              resources:
                requests: {cpu: 500m, memory: 512Mi}
                limits: {memory: 512Mi}
`+POOL(3),
  layout:{"cj/napas-recon":[380,80],"cm/recon-config":[760,80],"nodepool/nodes":[40,80]},
  explain:{"cj/napas-recon":"Đối soát giao dịch với NAPAS, theo lịch mỗi 20 phút. Mỗi lần chạy khoảng 25 phút (ban đêm lâu hơn vì nhiều giao dịch).","cm/recon-config":"Nguồn dữ liệu đối soát.","nodepool/nodes":"Node chạy pod của job đối soát."},
  tasks:[{t:"Lần trước chưa xong thì không chạy thêm",c:"concurrencyPolicy: Forbid.",test:()=>getP(first("CronJob").props,"spec.concurrencyPolicy")==="Forbid"},
    {t:"Không có hai lần đối soát chồng nhau",c:"Chạy 3 giờ mô phỏng, không lần nào chồng.",test:()=>kRun(10800,()=>!((RT.n[first("CronJob").id]||{m:{}}).m.dup),30)},
    {t:"Mỗi lần chạy đều xong",c:"Không job nào bị dừng giữa chừng (Failed).",test:()=>kRun(10800,()=>{const L=RT.pods[first("CronJob").id]||[];return L.some(p=>p.phase==="Completed")&&!L.some(p=>p.phase==="Failed"||p.phase==="Error")},30)}],
  hints:()=>["Bấm ▶ Chạy rồi xem Event log: “Overlap … hai job cùng đối soát một dữ liệu”. Mỗi lần chạy 25 phút, lịch lại gọi mỗi 20 phút.","concurrencyPolicy: Allow nghĩa là cứ tới giờ là chạy thêm, kể cả khi lần trước chưa xong. Đối soát mà chạy hai lần là ghi bút toán hai lần.","Đặt concurrencyPolicy: Forbid (bỏ qua lần mới khi lần cũ chưa xong). Đừng dùng Replace: nó dừng lần cũ giữa chừng. Nếu đặt activeDeadlineSeconds, phải đủ dài cho lần chạy chậm nhất."],
  diagnose:i=>ladder([[()=>getP(first("CronJob").props,"spec.concurrencyPolicy")==="Forbid",["Có lúc hai job đối soát cùng chạy: bút toán bị ghi hai lần.","concurrencyPolicy của napas-recon là "+getP(first("CronJob").props,"spec.concurrencyPolicy")+".","Allow cho chạy chồng; Replace dừng lần đang chạy giữa chừng (đối soát dở dang). Chọn Forbid: lần mới bị bỏ qua cho tới khi lần cũ xong."]],
    [()=>kRun(10800,()=>!(RT.pods[first("CronJob").id]||[]).some(p=>p.phase==="Failed"),30),["Không còn chạy chồng, nhưng có lần đối soát bị dừng giữa chừng.","Job báo DeadlineExceeded.","activeDeadlineSeconds ngắn hơn thời gian chạy thật (25 phút, ban đêm khoảng 40 phút). Bỏ đi, hoặc đặt dài hơn (ví dụ 3600)."]]],i),
  solve(){const c=first("CronJob");edit("concurrencyPolicy Forbid",()=>{const n=nodeOf(c.id);n.props.spec.concurrencyPolicy="Forbid";delete n.props.spec.jobTemplate.spec.activeDeadlineSeconds});solveLog("cj/napas-recon: concurrencyPolicy Forbid")},
  pass:"Tác vụ theo lịch phải trả lời được: lần này chạy lâu hơn chu kỳ thì sao? Forbid bỏ qua lần mới, Replace dừng lần cũ, Allow cho chạy chồng. Với đối soát, chạy chồng là ghi hai lần; và job nên idempotent, vì Kubernetes cũng có lúc tạo hai Job cho một lần lịch."};

const LESSONS=[L_PODS,L_SVC,L_PROBES,L_ING,L_RES,L_HPA,L_SEC,L_NP,L_PVC,L_CRON];
