"use strict";
/* Kubernetes pack · the Problems panel (like a reviewer reading the manifest: kube-linter / Polaris style checks) and
   the export tabs. */
function problems(){const out=[],add=(sev,id,msg)=>out.push({sev,id,msg});
  for(const n of allNodes()){if(n.ext)continue;const id=n.id,p=n.props,ns=nsOf(n);for(const f of LINT_K)f(n,add);
    if(ns&&!nsExists(ns))add("error",id,`${id}: namespace ${ns} chưa có. Tạo Namespace ${ns} trước (kubectl apply sẽ báo namespaces "${ns}" not found)`);
    if(WORKLOADS.includes(n.type)||["CronJob","Job","DaemonSet"].includes(n.type)){const c=ctrOf(n)||{},img=imgParse(c.image),ck=imageCheck(c.image),res=c.resources||{};
      if(WORKLOADS.includes(n.type)){const sel=getP(p,"spec.selector.matchLabels")||{};if(!matches(sel,podLabels(n)))add("error",id,`${id}: selector ${labelText(sel)} không khớp nhãn pod ${labelText(podLabels(n))}: API server từ chối`)}
      if(ck.err)add("error",id,`${id}: ${ck.err} · ${ck.msg}`);else if(img.tag==="latest"||!String(c.image||"").includes(":"))add("warn",id,`${id}: image dùng tag latest: không biết chắc đang chạy bản nào, khó quay lại bản cũ. Ghi rõ phiên bản`);
      for(const m of envOf(n).missing)add("error",id,`${id}: ${m}`);
      if(!getP(res,"requests.cpu")||!getP(res,"requests.memory"))add("warn",id,`${id}: chưa khai báo requests CPU / memory: scheduler xếp pod mù, HPA không tính được`);
      if(!getP(res,"limits.memory"))add("info",id,`${id}: chưa có limits.memory: một pod rò rỉ memory có thể chiếm cả node`);
      else if(ck.app&&memQ(res.limits.memory)<ck.app.mem)add("error",id,`${id}: limits.memory ${res.limits.memory} thấp hơn mức app cần (khoảng ${ck.app.mem}Mi): sẽ bị OOMKilled`);
      if(WORKLOADS.includes(n.type)&&ck.app&&!ck.app.db&&!c.readinessProbe)add("warn",id,`${id}: chưa có readinessProbe: pod nhận traffic ngay khi container chạy, kể cả lúc app chưa sẵn sàng`);
      if(c.livenessProbe&&ck.app&&!c.startupProbe&&(c.livenessProbe.initialDelaySeconds||0)+(c.livenessProbe.periodSeconds||10)*((c.livenessProbe.failureThreshold||3)-1)<ck.app.start)add("error",id,`${id}: liveness probe giết container trước khi app kịp khởi động (app cần khoảng ${ck.app.start}s). Thêm startupProbe`);
      const r=cpuQ(getP(res,"requests.cpu")),T_=NODE_TYPES[poolSpec().it];if(r&&r>allocOf(T_).cpu)add("error",id,`${id}: xin ${r}m CPU, một node ${poolSpec().it} chỉ có ${allocOf(T_).cpu}m cho pod: pod sẽ Pending mãi`);
      for(const d of depsOf(n))if(!d.ok)add("error",id,`${id}: ${d.env}=${d.host}: ${d.why}`);
      if(WORKLOADS.includes(n.type)&&(+getP(p,"spec.replicas")||1)<2&&ck.app&&!ck.app.db&&!allNodes().some(h=>h.type==="HorizontalPodAutoscaler"&&getP(h.props,"spec.scaleTargetRef.name")===nmOf(n)))add("info",id,`${id}: chỉ 1 pod: pod đó khởi động lại hoặc node hỏng là dịch vụ gián đoạn`);
      if(ck.app&&ck.app.db&&!pvcClaims(n).length&&!(n.type==="StatefulSet"&&arr(getP(p,"spec.volumeClaimTemplates")).length))add("error",id,`${id}: database không gắn ổ đĩa bền (PVC): khởi động lại là mất dữ liệu`);
      for(const e of arr(c.env))if(e&&e.value&&SECRETY.test(e.name))add("error",id,`${id}: biến ${e.name} ghi thẳng giá trị trong manifest: dùng Secret (valueFrom.secretKeyRef)`);
      if(n.type==="CronJob"&&(getP(p,"spec.concurrencyPolicy")||"Allow")==="Allow")add("warn",id,`${id}: concurrencyPolicy Allow: lần chạy chậm sẽ chồng lên lần sau`);
      for(const cl of pvcClaims(n)){const v=findObj("PersistentVolumeClaim",cl,ns);if(!v)add("error",id,`${id}: PVC ${cl} không có trong namespace ${ns}`);else if(WORKLOADS.includes(n.type)&&(+getP(p,"spec.replicas")||1)>1&&(getP(v.props,"spec.accessModes.0")||"ReadWriteOnce")==="ReadWriteOnce")add("warn",id,`${id}: ${getP(p,"spec.replicas")} pod dùng chung PVC ReadWriteOnce: pod ở node khác sẽ kẹt Multi-Attach`)}}
    if(n.type==="Service"){const ws=selected(n),ty=getP(p,"spec.type")||"ClusterIP";if(!ws.length)add("error",id,`${id}: selector ${labelText(getP(p,"spec.selector"))||"(trống)"} không khớp pod nào trong namespace ${ns}: Service không có endpoint (503)`);
      else for(const sp of arr(getP(p,"spec.ports"))){const w=ws[0],tp=portNum(w,sp.targetPort??sp.port),app=imageCheck((ctrOf(w)||{}).image).app;if(app&&tp!==app.port)add("error",id,`${id}: targetPort ${sp.targetPort??sp.port} nhưng app trong ${w.id} nghe cổng ${app.port}: connection refused`)}
      if(ty==="LoadBalancer")add("warn",id,`${id}: kiểu LoadBalancer: một load balancer và IP công khai riêng (tính tiền theo giờ). Nhiều dịch vụ web nên đi chung một Ingress`)}
    if(n.type==="Ingress"){arr(getP(p,"spec.rules")).forEach(r=>arr(getP(r||{},"http.paths")).forEach(x=>{const nm=getP(x||{},"backend.service.name"),s=findObj("Service",nm,ns);if(!s)add("error",id,`${id}: luật ${(r&&r.host)||"*"}${(x&&x.path)||"/"} trỏ tới Service ${nm} không có trong namespace ${ns}`);else if(!arr(getP(s.props,"spec.ports")).some(q=>+q.port===+getP(x,"backend.service.port.number")))add("error",id,`${id}: Service ${nm} không mở cổng ${getP(x,"backend.service.port.number")}`)}));
      if(!getP(p,"spec.tls"))add("warn",id,`${id}: chưa bật TLS: khách gửi thông tin đăng nhập qua HTTP`)}
    if(n.type==="ConfigMap")for(const k of Object.keys(p.data||{}))if(SECRETY.test(k))add("error",id,`${id}: khóa ${k} trông như mật khẩu: ConfigMap ai đọc được namespace cũng đọc được. Chuyển sang Secret`);
    if(n.type==="HorizontalPodAutoscaler"){const r=getP(p,"spec.scaleTargetRef")||{},w=r.name&&findObj(r.kind||"Deployment",r.name,ns);if(!w)add("error",id,`${id}: scaleTargetRef ${r.kind||"Deployment"} "${r.name||""}" không có`);
      else if(!cpuQ(getP(ctrOf(w)||{},"resources.requests.cpu")))add("error",id,`${id}: ${w.id} chưa khai báo requests.cpu: HPA không tính được % CPU, sẽ không co giãn`)}
    if(n.type==="PersistentVolumeClaim"&&!scOf(getP(p,"spec.storageClassName")))add("error",id,`${id}: storage class ${getP(p,"spec.storageClassName")} không tồn tại (có: ${STORAGE_CLASSES.join(", ")}): PVC Pending`);
    if(n.type==="Namespace"&&String(labelsOf(n).pci)==="true"&&!allNodes().some(x=>x.type==="NetworkPolicy"&&nsOf(x)===nmOf(n)))add("warn",id,`${id}: namespace chứa dữ liệu thẻ (pci=true) nhưng chưa có NetworkPolicy: pod ở mọi namespace đều gọi vào được`)}
    for(const c of allNodes())if(c.type==="CloudLab::IngressController"&&getP(c.props,"spec.controller")!=="aws-load-balancer-controller")add("info",c.id,`${c.id}: ingress-nginx đã ngừng bảo trì từ tháng 3/2026 (không còn bản vá bảo mật). Cluster đang chạy vẫn hoạt động; hệ thống mới nên dùng Gateway API (xem mẫu “Canary 90 / 10 với Gateway API”)`);
    return out.sort((a,b)=>({error:0,warn:1,info:2})[a.sev]-({error:0,warn:1,info:2})[b.sev])}
const EXPORTS={yaml:{label:"Manifest (CloudLab)",file:"manifests.cloudlab.yaml",edit:true,aria:"Kubernetes manifest (YAML)",note:`Sửa YAML là sửa canvas, và ngược lại. Phần mô phỏng (client, node pool) là các tài liệu <span class="mono">apiVersion: cloudlab.dev/v1</span> ở cuối.`},
  kubectl:{label:"Cho cluster thật",file:"manifests.yaml",gen:()=>toYaml(M,{clean:true}),note:"Đã bỏ phần mô phỏng. Chạy kubectl apply --dry-run=server -f manifests.yaml để API server kiểm tra trước khi apply thật."}};
