"use strict";
/* Problems panel: static checks on the template, like an IDE linter. sev: error (sẽ lỗi khi deploy hoặc chạy),
   warn (rủi ro bảo mật / chi phí), info (gợi ý thiết kế). */
const ip4=s=>{const m=/^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(String(s||"").trim());if(!m)return null;const a=((+m[1]<<24)>>>0)+(+m[2]<<16)+(+m[3]<<8)+(+m[4]),b=+m[5];if(b>32)return null;const mask=b?(~0<<(32-b))>>>0:0;return{net:(a&mask)>>>0,bits:b,size:2**(32-b)}};
const cidrIn=(a,b)=>a&&b&&a.bits>=b.bits&&a.net>=b.net&&a.net+a.size<=b.net+b.size;
const cidrOverlap=(a,b)=>a&&b&&a.net<b.net+b.size&&b.net<a.net+a.size;
function problems(){const out=[],P=(sev,id,msg)=>out.push({sev,id,msg});if(!M)return out;
  const nodes=Object.keys({...M.res,...M.ext}).map(nodeOf).filter(Boolean);
  for(const n of nodes){walkRefs(n.props,"",(path,to)=>{if(!rawOf(to))P("error",n.id,`${n.id}.${path} tham chiếu tới ${to}, nhưng template không có ${to}`)});const p=n.props;
    switch(n.type){
      case"AWS::Lambda::Function":if(!refId(p.Role))P("error",n.id,`${n.id}: Lambda cần execution role. Nối function tới một IAM role`);else{const need=+(getP(n.raw,"Metadata.CloudLab.WorkMs")||300)*128/(+p.MemorySize||128);if(need>(+p.Timeout||3)*1000)P("warn",n.id,`${n.id}: code cần ~${Math.round(need)} ms nhưng Timeout chỉ ${p.Timeout||3} s → sẽ timeout. Tăng Timeout hoặc Memory`)}
        {const outB=Object.values(getP(p,"Environment.Variables")||{}).map(refId).find(x=>x&&(nodeOf(x)||{}).type==="AWS::S3::Bucket");if(outB){const nb=nodeOf(outB);const hit=arr(getP(nb.props,"NotificationConfiguration.LambdaConfigurations")).find(c=>refId(c.Function)===n.id);
          if(hit){const rules=arr(getP(hit,"Filter.S3Key.Rules")),pre=(rules.find(r=>/prefix/i.test(r.Name))||{}).Value||"",op=getP(p,"Environment.Variables.OUTPUT_PREFIX")||"";if(!pre||String(op).startsWith(pre))P("error",n.id,`${n.id} ghi vào ${outB} đúng chỗ đang kích hoạt nó → vòng lặp vô tận. Ghi ra prefix khác và lọc trigger`)}}}break;
      case"AWS::ApiGatewayV2::Api":if(!targetOf(p.Target))P("warn",n.id,`${n.id}: chưa có integration nên mọi request trả 404. Nối API tới một Lambda`);break;
      case"AWS::ElasticLoadBalancingV2::LoadBalancer":{const ss=subnetsOf(n),azs=new Set(ss.map(s=>(nodeOf(s)||{props:{}}).props.AvailabilityZone));
        if(ss.length<2||azs.size<2)P("error",n.id,`${n.id}: Application Load Balancer cần ít nhất 2 subnet ở 2 Availability Zone khác nhau`);
        if(!sgsOf(n.id).length)P("warn",n.id,`${n.id}: chưa gắn security group`);
        if(!Object.values(M.res).some(r=>r.Type==="AWS::ElasticLoadBalancingV2::Listener"&&refId(r.Properties.LoadBalancerArn)===n.id))P("warn",n.id,`${n.id}: chưa có listener nên không nhận request nào. Nối load balancer tới target group hoặc EC2`);break}
      case"AWS::ElasticLoadBalancingV2::TargetGroup":if(!arr(p.Targets).length)P("warn",n.id,`${n.id}: target group trống, chưa có EC2 nào nhận request`);break;
      case"AWS::EC2::Subnet":{const v=refId(p.VpcId),vn=nodeOf(v);if(!vn){P("error",n.id,`${n.id}: subnet phải thuộc một VPC. Nối subnet tới VPC`);break}
        const c=ip4(p.CidrBlock),vc=ip4(vn.props.CidrBlock);if(!c)P("error",n.id,`${n.id}: CIDR ${p.CidrBlock} không hợp lệ`);else if(!cidrIn(c,vc))P("error",n.id,`${n.id}: ${p.CidrBlock} nằm ngoài ${vn.props.CidrBlock} của ${v}`);
        for(const o of nodes)if(o.type==="AWS::EC2::Subnet"&&o.id<n.id&&refId(o.props.VpcId)===v&&cidrOverlap(c,ip4(o.props.CidrBlock)))P("error",n.id,`${n.id} và ${o.id} trùng dải IP. Đổi CIDR của một trong hai`);
        if(p.MapPublicIpOnLaunch===true&&!igwOf(v))P("warn",n.id,`${n.id} đánh dấu public nhưng ${v} chưa gắn internet gateway. Nối internet gateway tới ${v}`);break}
      case"AWS::EC2::SecurityGroup":for(const r of arr(p.SecurityGroupIngress)){if(r.CidrIp!=="0.0.0.0/0")continue;const lo=+r.FromPort,hi=+(r.ToPort??r.FromPort),has=x=>r.IpProtocol==="-1"||(x>=lo&&x<=hi);
          if([5432,3306,6379].some(has))P("error",n.id,`${n.id}: cổng database mở cho cả Internet (0.0.0.0/0)`);else if([22,3389].some(has))P("warn",n.id,`${n.id}: SSH/RDP mở cho cả Internet — dùng Session Manager hoặc giới hạn IP`);else if(r.IpProtocol==="-1")P("warn",n.id,`${n.id}: mở mọi cổng cho Internet`)}break;
      case"AWS::RDS::DBInstance":if(p.PubliclyAccessible===true)P("warn",n.id,`${n.id}: database public — nên để private, chỉ mở cho security group của app`);if(!refId(p.DBSubnetGroupName))P("info",n.id,`${n.id}: chưa chọn DB subnet group → AWS đặt vào default VPC`);if(p.MultiAZ!==true)P("info",n.id,`${n.id}: một AZ — AZ hỏng là mất database; Multi-AZ gấp đôi giá`);break;
      case"AWS::S3::Bucket":{const c=p.PublicAccessBlockConfiguration||{};if(!["BlockPublicAcls","IgnorePublicAcls","BlockPublicPolicy","RestrictPublicBuckets"].every(k=>c[k]===true))P("warn",n.id,`${n.id}: Block Public Access chưa bật đủ 4 tùy chọn`);break}
      case"AWS::S3::BucketPolicy":if(arr(getP(p,"PolicyDocument.Statement")).some(s=>s.Effect==="Allow"&&isPublicPrincipal(s.Principal)))P("warn",n.id,`${n.id}: Principal "*" — ai trên Internet cũng dùng được`);break;
      case"AWS::IAM::Role":if(arr(p.ManagedPolicyArns).map(resolve).includes("arn:aws:iam::aws:policy/AdministratorAccess"))P("warn",n.id,`${n.id}: AdministratorAccess — quá rộng cho một workload`);break;
      case"AWS::Budgets::Budget":if(!arr(p.NotificationsWithSubscribers).some(x=>arr(x.Subscribers).length))P("warn",n.id,`${n.id}: không gửi cảnh báo tới đâu`);break;
      case"AWS::SNS::Topic":for(const s of arr(p.Subscription))if(s&&s.Protocol==="email"&&RT&&RT.subs[n.id+"|"+s.Endpoint]==="PendingConfirmation")P("info",n.id,`${n.id}: ${s.Endpoint} chưa xác nhận subscription`);break;
      case"AWS::EC2::Instance":if(!refId(p.SubnetId))P("info",n.id,`${n.id}: chưa chọn subnet → chạy trong default VPC`);if(!sgsOf(n.id).length)P("info",n.id,`${n.id}: không có security group → dùng default SG`);break;
      case"CloudLab::Client":if(!refId(p.Target))P("info",n.id,`${n.id}: client chưa gọi tới đâu`);break}}
  if(typeof orgProblems==="function")orgProblems(P);
  const order={error:0,warn:1,info:2};return out.sort((a,b)=>order[a.sev]-order[b.sev])}
