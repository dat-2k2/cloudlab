"use strict";
/* IaC export: CloudFormation ready for AWS (simulation metadata stripped), Terraform (awscc provider, 1:1 with
   CloudFormation resource schemas) and AWS CDK TypeScript (L1 Cfn* constructs with the same logical IDs). */
function stripCl(v){if(Array.isArray(v))return v.map(stripCl);if(v&&typeof v==="object"){const o={};for(const k of Object.keys(v)){if(k==="CloudLab")continue;const x=stripCl(v[k]);if(x&&typeof x==="object"&&!Array.isArray(x)&&!Object.keys(x).length&&k==="Metadata")continue;o[k]=x}return o}return v}
function cfnForAws(m){m=m||M;const res={};for(const[k,v]of Object.entries(m.res))res[k]=ordered(clean(stripCl(v)));
  const doc={AWSTemplateFormatVersion:"2010-09-09",Description:(m.desc||m.name)+" (xuất từ CloudLab)",Resources:res};
  const head="# Xuất từ CloudLab. Đã bỏ Metadata.CloudLab (traffic giả lập, client, monitor).\n# CloudLab không mô phỏng NAT gateway: máy ở private subnet chưa ra được Internet.\n";
  return head+(CFN?jsyaml.dump(doc,{schema:CFN,lineWidth:110,noRefs:true}):JSON.stringify(doc,null,2))}
/* ---------- shared naming ---------- */
const snake=s=>s.replace(/([a-z0-9])([A-Z])/g,"$1_$2").replace(/([A-Z]+)([A-Z][a-z])/g,"$1_$2").toLowerCase();
const camel=s=>{const m=/^([A-Z]+)([A-Z][a-z].*)?$/.exec(s);if(m&&m[1].length>1)return m[1].slice(0,m[2]?-0:undefined).toLowerCase()+(m[2]||"");return s.charAt(0).toLowerCase()+s.slice(1)};
const camelKey=s=>{const m=/^([A-Z]{2,})([A-Z][a-z])/.exec(s);if(m)return m[1].toLowerCase()+s.slice(m[1].length);return /^[A-Z]{2,}$/.test(s)?s.toLowerCase():s.charAt(0).toLowerCase()+s.slice(1)};
const typeParts=t=>{const[,svc,res]=t.split("::");return{svc,res}};
/* ---------- Terraform (awscc) ---------- */
function tfName(id){return snake(id)}
function tfType(t){const{svc,res}=typeParts(t);return`awscc_${svc.toLowerCase()}_${snake(res)}`}
function tfAddr(id){const r=M.res[id];return r?`${tfType(r.Type)}.${tfName(id)}`:`"${id}"`}
function tfVal(v,ind){const pad="  ".repeat(ind);
  if(v===null||v===undefined)return"null";if(typeof v==="boolean"||typeof v==="number")return String(v);if(typeof v==="string"){const ssm=/^\{\{resolve:ssm:([^}]+)\}\}$/.exec(v);if(ssm){TF_SSM.add(ssm[1]);return`data.aws_ssm_parameter.${ssmName(ssm[1])}.value`}return JSON.stringify(v).replace(/\$\{/g,"$${")}
  if(Array.isArray(v))return v.length?`[\n${v.map(x=>pad+"  "+tfVal(x,ind+1)).join(",\n")}\n${pad}]`:"[]";
  if("Ref" in v)return v.Ref==="AWS::AccountId"?"data.aws_caller_identity.current.account_id":v.Ref==="AWS::Region"?"data.aws_region.current.name":`${tfAddr(v.Ref)}.id`;
  if("Fn::GetAtt" in v){const g=arr(v["Fn::GetAtt"]).length===1?String(v["Fn::GetAtt"]).split("."):v["Fn::GetAtt"];return`${tfAddr(g[0])}.${snake(g[1].replace("DNSName","DnsName").replace("ID","Id"))}`}
  if("Fn::Sub" in v){const s=Array.isArray(v["Fn::Sub"])?v["Fn::Sub"][0]:v["Fn::Sub"];return'"'+String(s).replace(/\$\{([^}]+)\}/g,(_,x)=>x==="AWS::AccountId"?"${data.aws_caller_identity.current.account_id}":x==="AWS::Region"?"${data.aws_region.current.name}":x.includes(".")?"${"+tfAddr(x.split(".")[0])+"."+snake(x.split(".")[1])+"}":"${"+tfAddr(x)+".id}")+'"'}
  if("Fn::Join" in v){const[sep,list]=v["Fn::Join"];return`join(${JSON.stringify(sep)}, ${tfVal(list,ind)})`}
  const ks=Object.keys(v);if(!ks.length)return"{}";
  return`{\n${ks.map(k=>`${pad}  ${/PolicyDocument$/.test(k)?snake(k)+" = jsonencode("+tfVal(v[k],ind+1)+")":snake(k)+" = "+tfVal(v[k],ind+1)}`).join("\n")}\n${pad}}`}
let TF_SSM=new Set();const ssmName=p=>p.split("/").pop().replace(/[^a-z0-9]+/gi,"_").toLowerCase();
function tfRecord(id,p){const a=p.AliasTarget||{},t=refId(a.DNSName),tn=t&&nodeOf(t);const zone=String(p.HostedZoneName||"example.com.").replace(/\.$/,"");
  return`\n# ${id} (AWS::Route53::RecordSet) · Cloud Control không hỗ trợ RecordSet nên dùng provider aws\ndata "aws_route53_zone" "${tfName(id)}_zone" {\n  name = "${zone}"\n}\nresource "aws_route53_record" "${tfName(id)}" {\n  zone_id = data.aws_route53_zone.${tfName(id)}_zone.zone_id\n  name    = "${String(p.Name||"").replace(/\.$/,"")}"\n  type    = "${p.Type||"A"}"\n`+(tn?`  alias {\n    name                   = ${tn.type==="AWS::CloudFront::Distribution"?tfAddr(t)+".domain_name":tfAddr(t)+".dns_name"}\n    zone_id                = ${tn.type==="AWS::CloudFront::Distribution"?'"Z2FDTNDATAQYW2"':tfAddr(t)+".canonical_hosted_zone_id"}\n    evaluate_target_health = true\n  }\n`:"")+"}\n"}
function toTerraform(m){m=m||M;const sM=M;M=m;TF_SSM=new Set();try{let out=`# Xuất từ CloudLab · provider awscc (Cloud Control API, cùng schema với CloudFormation).\n# Kiểm tra bằng: terraform init && terraform plan\n\nterraform {\n  required_providers {\n    awscc = { source = "hashicorp/awscc" }\n    aws   = { source = "hashicorp/aws" }\n  }\n}\n\nprovider "awscc" {\n  region = "${REGION}"\n}\nprovider "aws" {\n  region = "${REGION}"\n}\n\ndata "aws_caller_identity" "current" {}\ndata "aws_region" "current" {}\n`;
  let body="";for(const[id,r]of Object.entries(m.res)){const p=clean(stripCl(r.Properties||{}));if(r.Type==="AWS::Route53::RecordSet"){body+=tfRecord(id,p);continue}let out_="";out_+=`\n# ${id} (${r.Type})${r.DeletionPolicy?` · DeletionPolicy ${r.DeletionPolicy} → dùng lifecycle { prevent_destroy = true } nếu cần`:""}\nresource "${tfType(r.Type)}" "${tfName(id)}" {\n`;
    for(const[k,v]of Object.entries(p))out_+=`  ${/PolicyDocument$/.test(k)?snake(k)+" = jsonencode("+tfVal(v,1)+")":snake(k)+" = "+tfVal(v,1)}\n`;
    const dep=arr(r.DependsOn).filter(d=>m.res[d]);if(dep.length)out_+=`  depends_on = [${dep.map(tfAddr).join(", ")}]\n`;body+=out_+"}\n"}
  for(const s of TF_SSM)out+=`\ndata "aws_ssm_parameter" "${ssmName(s)}" {\n  name = "${s}"\n}\n`;
  return out+body}finally{M=sM}}
/* ---------- AWS CDK (TypeScript, L1) ---------- */
const CDK_MOD={EC2:"ec2",S3:"s3",Lambda:"lambda",IAM:"iam",SNS:"sns",SQS:"sqs",DynamoDB:"dynamodb",ApiGatewayV2:"apigatewayv2",Events:"events",Logs:"logs",CloudWatch:"cloudwatch",Budgets:"budgets",
  ElasticLoadBalancingV2:"elbv2",RDS:"rds",ElastiCache:"elasticache",CloudFront:"cloudfront",Route53:"route53",MSK:"msk",AmazonMQ:"amazonmq",Organizations:"organizations",ControlTower:"controltower"};
const CDK_PKG={elbv2:"aws-elasticloadbalancingv2"};
function cdkVal(v,ind,raw){const pad="  ".repeat(ind);
  if(v===null||v===undefined)return"undefined";if(typeof v==="boolean"||typeof v==="number")return String(v);if(typeof v==="string")return`'${v.replace(/\\/g,"\\\\").replace(/'/g,"\\'")}'`;
  if(Array.isArray(v))return v.length?`[\n${v.map(x=>pad+"  "+cdkVal(x,ind+1,raw)).join(",\n")},\n${pad}]`:"[]";
  if("Ref" in v)return v.Ref==="AWS::AccountId"?"this.account":v.Ref==="AWS::Region"?"this.region":`cdk.Fn.ref('${v.Ref}')`;
  if("Fn::GetAtt" in v){const g=arr(v["Fn::GetAtt"]).length===1?String(v["Fn::GetAtt"]).split("."):v["Fn::GetAtt"];return`cdk.Fn.getAtt('${g[0]}', '${g[1]}').toString()`}
  if("Fn::Sub" in v){const s=Array.isArray(v["Fn::Sub"])?v["Fn::Sub"][0]:v["Fn::Sub"];return`cdk.Fn.sub('${s}')`}
  if("Fn::Join" in v){const[sep,list]=v["Fn::Join"];return`cdk.Fn.join('${sep}', ${cdkVal(list,ind,raw)})`}
  const ks=Object.keys(v);if(!ks.length)return"{}";
  return`{\n${ks.map(k=>{const json=raw||/PolicyDocument$/.test(k);return`${pad}  ${raw?JSON.stringify(k):camelKey(k)}: ${cdkVal(v[k],ind+1,json)}`}).join(",\n")},\n${pad}}`}
function toCdk(m){m=m||M;const mods=new Set(),body=[],deps=[];
  for(const[id,r]of Object.entries(m.res)){const{svc,res}=typeParts(r.Type),mod=CDK_MOD[svc]||svc.toLowerCase();mods.add(mod);const v=id.charAt(0).toLowerCase()+id.slice(1);
    const p=clean(stripCl(r.Properties||{}));body.push(`    const ${v} = new ${mod}.Cfn${res}(this, '${id}', ${cdkVal(p,2)});\n    ${v}.overrideLogicalId('${id}');`+(r.DeletionPolicy?`\n    ${v}.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.${r.DeletionPolicy.toUpperCase()};`:""));for(const d of arr(r.DependsOn).filter(d=>m.res[d]))deps.push(`    ${v}.addDependency(${d.charAt(0).toLowerCase()+d.slice(1)});`)}if(deps.length)body.push(deps.join("\n"))
  const cls=(m.name||"sandbox").replace(/(^|[-_ ])(\w)/g,(_,a,b)=>b.toUpperCase()).replace(/\W/g,"")+"Stack";
  return`// Xuất từ CloudLab · AWS CDK v2, construct L1 (Cfn*) giữ nguyên logical ID của template.\n// npx cdk synth && npx cdk deploy\nimport * as cdk from 'aws-cdk-lib';\nimport { Construct } from 'constructs';\n${[...mods].sort().map(x=>`import * as ${x} from 'aws-cdk-lib/${CDK_PKG[x]||"aws-"+x}';`).join("\n")}\n\nexport class ${cls} extends cdk.Stack {\n  constructor(scope: Construct, id: string, props?: cdk.StackProps) {\n    super(scope, id, { env: { region: '${REGION}' }, ...props });\n\n${body.join("\n\n")}\n  }\n}\n\nconst app = new cdk.App();\nnew ${cls}(app, '${cls}');\n`}
const EXPORTS={cfn:{label:"CloudFormation (CloudLab)",file:"template.cloudlab.yaml",edit:true,aria:"CloudFormation template (YAML)",note:`Sửa YAML là sửa canvas, và ngược lại. Phần mô phỏng (client, monitor, traffic) nằm ở <span class="mono">Metadata.CloudLab</span>.`},aws:{label:"CloudFormation cho AWS",file:"template.yaml",gen:()=>cfnForAws(),note:"Đã bỏ Metadata.CloudLab. Route table, Lambda permission, topic policy và OAC đã nằm trong template."},tf:{label:"Terraform",file:"main.tf",gen:()=>toTerraform(),note:"Provider awscc dùng cùng schema với CloudFormation nên ánh xạ 1-1. Chạy terraform plan để kiểm tra trước khi apply."},cdk:{label:"CDK (TypeScript)",file:"stack.ts",gen:()=>toCdk(),note:"Construct L1 (Cfn*) giữ nguyên logical ID, nên stack CDK tạo đúng template này."}};
