"use strict";
/* GCP pack · the Problems panel (what a reviewer of the .tf would flag) and the export tabs. */
const ADMIN_PORTS={22:"SSH",15672:"trang quản trị RabbitMQ",5672:"AMQP (RabbitMQ)",6379:"Redis",9092:"Kafka",3389:"RDP"};
function problems(){const out=[],add=(sev,id,msg)=>out.push({sev,id,msg});const all=allNodes();
  for(const n of all){const p=n.props,id=n.id;
    switch(n.type){
      case"cloudlab_client":{const t=refOf(p.target),tn=t&&nodeOf(t);if(!tn)break;
        if(tn.type==="google_cloud_run_v2_service"&&!isPublicRun(tn)&&p.expect!=="deny")add("error",id,`${id} gọi ${t} từ Internet, nhưng service chưa cho allUsers quyền roles/run.invoker: khách sẽ nhận 403. Thêm “Quyền gọi Cloud Run” (member allUsers)`);
        if(p.protocol==="websocket"&&tn.type==="google_cloud_run_v2_service"){const S=runSpec(tn),need=Math.ceil((+p.connections||0)/S.conc);if(need>S.max)add("error",t,`${t}: ${num(+p.connections||0)} kết nối cần ${need} instance (${S.conc} kết nối mỗi instance) nhưng max_instance_count = ${S.max}: số còn lại bị từ chối`)}
        break}
      case"google_cloud_run_v2_service":{const S=runSpec(n);
        if(p.deletion_protection!==false)add("warn",id,`${id}: provider google 6.x đặt deletion_protection = true mặc định: terraform destroy sẽ lỗi. Đặt deletion_protection = false cho môi trường học`);
        if(S.ws&&S.timeout<3600)add("warn",id,`${id}: WebSocket bị cắt mỗi ${S.timeout} giây (timeout). Mọi khách kết nối lại cùng lúc. Đặt timeout = "3600s" (tối đa)`);
        if(S.ws&&S.conc<=100)add("warn",id,`${id}: WebSocket với ${S.conc} kết nối mỗi instance: 1.000 khách cần ${Math.ceil(1000/S.conc)} instance chạy suốt. Một server WebSocket nhẹ giữ được hàng trăm kết nối; tăng max_instance_request_concurrency (tối đa 1000)`);
        if(S.min>0)add("info",id,`${id}: ${S.min} instance tối thiểu được tính tiền cả khi không ai gọi (≈ ${money(gcpPrice(n).h*HOURS_MO)}/tháng)`);
        if(!runSa(n))add("warn",id,`${id}: chưa chọn service account nên chạy bằng Compute Engine default service account (thường có roles/editor: quá rộng). Tạo service account riêng và chỉ gán role cần dùng`);
        for(const d of depsOfApp(n)){const net=netPath(n,d.id);if(!net.ok)add("error",id,`${id} → ${d.id}: ${net.why}`);const dn=nodeOf(d.id),role=dn&&ROLE_FOR[dn.type];if(role){const r=appRole(n,role);if(!r.ok)add("error",id,`${id} → ${d.id}: ${r.why}`)}}
        break}
      case"google_compute_instance":{for(const f of fwFor(n))for(const r of arr(f.props.allow))for(const x of arr(r.ports)){const port=+String(x).split("-")[0];if(ADMIN_PORTS[port]&&arr(f.props.source_ranges).includes("0.0.0.0/0")&&arr(getP(p,"network_interface.access_config")).length)add(port===80||port===443?"info":"error",id,`${id}: ${f.id} mở ${ADMIN_PORTS[port]} (tcp/${port}) cho cả Internet. Bot quét cổng này liên tục; giới hạn source_ranges ở subnet của app hoặc IP của bạn`)}
        if(arr(getP(p,"network_interface.access_config")).length&&appOf(n)!=="web")add("info",id,`${id}: VM ${appOf(n)} có IP public (${money(GP.ipv4H*HOURS_MO)}/tháng). App trong VPC gọi qua IP nội bộ, không cần IP public`);
        for(const d of depsOfApp(n)){const net=netPath(n,d.id);if(!net.ok)add("error",id,`${id} → ${d.id}: ${net.why}`)}break}
      case"google_redis_instance":if(!refAt(n,"authorized_network"))add("error",id,`${id}: chưa có authorized_network (VPC được vào Redis)`);if(p.tier==="STANDARD_HA")add("info",id,`${id}: Standard HA đắt gấp đôi Basic; để học và làm cache có thể mất dữ liệu, Basic là đủ`);break;
      case"google_managed_kafka_cluster":{const v=+getP(p,"capacity_config.vcpu_count")||0;if(v<3)add("error",id,`${id}: tối thiểu 3 vCPU`);
        add("info",id,`${id}: cluster nhỏ nhất (3 vCPU, 3 GiB) ≈ ${money((3*GP.kafka.vcpuH+3*GP.kafka.gibH)*HOURS_MO)}/tháng chạy suốt, kể cả không có message. Với $300 credit: chỉ bật khi học, destroy khi xong`);break}
      case"google_project_iam_member":if(/roles\/(owner|editor)$/.test(p.role||""))add("warn",id,`${id}: ${p.role} cho app là quá rộng (đọc, sửa, xóa gần như mọi thứ trong project). Chỉ gán role app cần`);if(!refAt(n,"member")&&!/^(user|group|domain):/.test(p.member||""))add("warn",id,`${id}: member chưa trỏ tới service account nào`);break;
      case"google_billing_budget":{const inc=String(getP(p,"budget_filter.credit_types_treatment")||"INCLUDE_ALL_CREDITS")!=="EXCLUDE_ALL_CREDITS";
        if(inc&&RT.trial)add("warn",id,`${id}: budget đang trừ credit (mặc định). Trong thời gian dùng thử credit trả hết nên budget thấy $0 và không báo. Đặt budget_filter.credit_types_treatment = "EXCLUDE_ALL_CREDITS"`);
        if(!arr(getP(p,"all_updates_rule.monitoring_notification_channels")).length&&getP(p,"all_updates_rule.disable_default_iam_recipients")===true)add("error",id,`${id}: đã tắt người nhận mặc định mà chưa có notification channel: không ai nhận cảnh báo`);break}}}
  if(RT.trial&&all.some(n=>!n.ext&&gcpPrice(n).h>0)&&!all.some(n=>n.type==="google_billing_budget"))add("info",null,"Chưa có budget. Với tài khoản dùng thử, đặt budget không trừ credit để biết credit bị đốt tới đâu");
  for(const h of (M.tf&&M.tf.head)||[])if(h.type==="data")add("info",null,`data "${h.labels.join('" "')}": CloudLab không mô phỏng data source, giữ nguyên khi xuất`);
  return out.sort((a,b)=>({error:0,warn:1,info:2})[a.sev]-({error:0,warn:1,info:2})[b.sev])}
const EXPORTS={tf:{label:"Terraform (CloudLab)",file:"main.cloudlab.tf",edit:true,aria:"Terraform (HCL)",note:`Sửa Terraform là sửa canvas, và ngược lại. Phần mô phỏng là các resource <span class="mono">cloudlab_*</span> ở cuối file.`},
  terraform:{label:"Cho project thật",file:"main.tf",gen:()=>toYaml(M,{clean:true}),note:"Đã bỏ cloudlab_*. Chạy terraform init && terraform plan với project của bạn (gcloud auth application-default login trước). Nhớ terraform destroy khi học xong để không đốt credit."}};
