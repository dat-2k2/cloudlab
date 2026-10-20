"use strict";
/* IAM evaluation over the template: identity policies of a role (inline + AWS managed) and S3 bucket policies.
   Order: explicit Deny wins → otherwise an Allow is needed → otherwise implicit deny. */
function roleStatements(roleId){const r=nodeOf(roleId);if(!r||r.type!=="AWS::IAM::Role")return[];const out=[];
  for(const p of arr(r.props.Policies))for(const s of arr(p&&p.PolicyDocument&&p.PolicyDocument.Statement))out.push({...s,_by:`${p.PolicyName||"inline"} · ${s.Sid||"(không Sid)"}`});
  for(const a of arr(r.props.ManagedPolicyArns)){const arn=resolve(a),mp=MANAGED[arn];if(mp)for(const s of mp.st)out.push({...s,_by:`${mp.name} · ${s.Sid}`})}
  return out}
function stmtHits(s,action,res){return matchAny(arr(s.Action),action)&&arr(resolve(s.Resource)).some(p=>glob(p).test(res))}
function evalRole(roleId,action,res){if(!nodeOf(roleId))return{allow:false,kind:"implicit",by:"role không tồn tại"};let allowBy=null;
  for(const s of roleStatements(roleId)){if(!stmtHits(s,action,res))continue;if(s.Effect==="Deny")return{allow:false,kind:"explicit",by:s._by};allowBy=allowBy||s._by}
  return allowBy?{allow:true,kind:"allow",by:allowBy}:{allow:false,kind:"implicit",by:"không statement nào cho phép"}}
function trusts(roleId,who){const r=nodeOf(roleId);if(!r)return false;
  return arr(getP(r.props,"AssumeRolePolicyDocument.Statement")).some(s=>s.Effect==="Allow"&&(who==="lambda"?arr(s.Principal&&s.Principal.Service).includes("lambda.amazonaws.com"):!!(s.Principal&&(s.Principal.AWS||s.Principal==="*"))))}
const isPublicPrincipal=p=>p==="*"||(p&&(p.AWS==="*"||arr(p.AWS).includes("*")));
function bucketPolicies(bucketId){return Object.keys({...M.res,...M.manual}).map(nodeOf).filter(n=>n&&n.type==="AWS::S3::BucketPolicy"&&refId(n.props.Bucket)===bucketId)}
const bpa=b=>b.props.PublicAccessBlockConfiguration||{};
/* who = {role:id} or {anon:true} */
function evalS3(who,bucketId,action,key){const b=nodeOf(bucketId);if(!b)return{allow:false,kind:"implicit",by:"bucket không tồn tại"};
  const res=action==="s3:ListBucket"?arnOf(bucketId):arnOf(bucketId)+"/"+key;
  const pols=bucketPolicies(bucketId).flatMap(p=>arr(getP(p.props,"PolicyDocument.Statement")).map(s=>({...s,_by:`${p.id} · ${s.Sid||"(không Sid)"}`})));
  for(const s of pols)if(s.Effect==="Deny"&&stmtHits(s,action,res)&&(isPublicPrincipal(s.Principal)||who.role))return{allow:false,kind:"explicit",by:s._by};
  if(who.anon){const pub=pols.find(s=>s.Effect==="Allow"&&isPublicPrincipal(s.Principal)&&stmtHits(s,action,res));
    if(!pub)return{allow:false,kind:"implicit",by:"không có quyền công khai"};
    if(bpa(b).RestrictPublicBuckets||bpa(b).BlockPublicPolicy)return{allow:false,kind:"bpa",by:"Block Public Access chặn policy public"};
    return{allow:true,kind:"public",by:`${pub._by} (Principal "*")`,leak:true}}
  const e=evalRole(who.role,action,res);if(e.allow)return e;
  const rp=pols.find(s=>s.Effect==="Allow"&&stmtHits(s,action,res)&&isPublicPrincipal(s.Principal)&&!(bpa(b).RestrictPublicBuckets||bpa(b).BlockPublicPolicy));
  return rp?{allow:true,kind:"public",by:rp._by}:e}
const denyMsg=(action,res,e,who)=>`AccessDenied: ${who||"principal"} is not authorized to perform: ${action} on resource: ${res} `+(e.kind==="explicit"?"with an explicit deny":e.kind==="bpa"?"(Block Public Access)":`because no policy allows the ${action} action`);
