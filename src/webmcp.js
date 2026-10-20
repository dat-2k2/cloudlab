"use strict";
/* WebMCP: lets a browser AI agent (e.g. Gemini in Chrome, once the browser supports WebMCP) read and drive CloudLab
   through typed tools instead of clicking around. Spec: https://github.com/webmachinelearning/webmcp
   API used: document.modelContext.registerTool({name, description, inputSchema, execute}, {signal}); older builds
   exposed navigator.modelContext, so both are tried. Nothing happens in browsers without WebMCP.
   The same tools are on window.CloudLab.tools for testing. Tool results are JSON in a single text content item. */
(function(){
  const out=x=>({content:[{type:"text",text:typeof x==="string"?x:JSON.stringify(x,null,1)}]});
  const fail=msg=>({content:[{type:"text",text:"Lỗi: "+msg}],isError:true});
  const typeOf=id=>{const n=nodeOf(id);return n?n.type:null};
  const blockSummary=n=>{const v=nodeView(n);return{id:n.id,type:n.type,label:n.def.label,status:v.st?v.st[1]:null,rows:Object.fromEntries(v.rows.map(r=>[r[0],r[1]])),...(n.ext?{external:true}:{})}};
  const state=()=>{const L=L_();return{mode:UI.mode,lesson:L?{id:L.id,title:L.title,goal:L.goal}:null,stack:{name:M.name,status:RT.stack.status},simTimeSec:Math.round(RT.t),costUSD:+RT.total.toFixed(4),running:!!RT.running,
    blocks:allNodes().map(blockSummary),connections:edges().filter(e=>!e.hidden).map(e=>({from:e.from,to:e.to,kind:e.kind,label:e.label||"",lastIssue:RT.why[e.id]||null})),problems:problems().map(p=>({severity:p.sev,block:p.id,message:p.msg}))}};
  const after=label=>{render();return{ok:true,did:label,problems:problems().map(p=>p.sev+": "+p.msg)}};
  const TOOLS=[
    {name:"get_state",description:"Đọc trạng thái hiện tại của CloudLab: đang ở sandbox hay bài nào, stack, các khối trên sơ đồ (trạng thái, số liệu), các mũi tên kèm lỗi gần nhất, chi phí, và danh sách vấn đề cấu hình.",
      inputSchema:{type:"object",properties:{}},execute:async()=>out(state())},
    {name:"get_template",description:"Lấy template CloudFormation (YAML) của sơ đồ hiện tại, gồm cả Metadata.CloudLab dùng cho mô phỏng.",inputSchema:{type:"object",properties:{}},execute:async()=>out(toYaml())},
    {name:"get_format_guide",description:"Hướng dẫn viết template CloudLab đọc được: loại tài nguyên AWS được hỗ trợ, nguồn tải bên ngoài trong Metadata.CloudLab.External và thuộc tính của chúng. Đọc trước khi gọi load_template.",
      inputSchema:{type:"object",properties:{}},execute:async()=>out({format:"CloudFormation YAML; tham chiếu bằng !Ref/!GetAtt/!Sub; phần chỉ cho mô phỏng nằm trong Metadata.CloudLab; vùng ap-southeast-2; không mô phỏng route table, NAT",
        awsTypes:Object.keys(T).filter(t=>!t.startsWith("CloudLab::")),external:Object.fromEntries(Object.values(T).filter(t=>t.type.startsWith("CloudLab::")).map(t=>[t.type,t.fields.map(f=>f.k)])),
        resourceMetadata:Object.fromEntries(Object.values(T).map(t=>[t.type,(t.fields||[]).map(f=>f.k).filter(k=>k&&k.startsWith("@")&&!k.startsWith("@@")).map(k=>k.slice(1))]).filter(x=>x[1].length)),
        guide:"https://dat-2k2.github.io/cloudlab/learn.html#gemini"})},
    {name:"list_lessons",description:"Liệt kê các bài học (id, tiêu đề, mục tiêu, chặng) và bài nào đã đạt.",inputSchema:{type:"object",properties:{}},
      execute:async()=>out(LESSONS.map(l=>({id:l.id,step:l.step,title:l.title,goal:l.goal,phase:l.phase,done:DONE.has(l.id)})))},
    {name:"get_lesson",description:"Chi tiết bài đang mở: tình huống, bối cảnh ngân hàng, nhiệm vụ và kết quả Kiểm tra gần nhất, giải thích từng khối.",inputSchema:{type:"object",properties:{}},
      execute:async()=>{const L=L_();if(!L)return fail("Đang ở sandbox, không có bài nào mở. Dùng open_lesson.");const R=UI.result;
        return out({id:L.id,title:L.title,goal:L.goal,scenario:L.scenario,bank:L.bank||null,tasks:L.tasks.map((t,i)=>({task:t.t,criteria:t.c,passed:R?!!R.res[i]:null})),blocks:L.explain,concepts:L.concepts})}},
    {name:"explain_component",description:"Giải thích một khối hoặc một loại thành phần AWS bằng ngôn ngữ đơn giản (ví dụ ngân hàng) và mô tả kỹ thuật.",
      inputSchema:{type:"object",properties:{idOrType:{type:"string",description:"Id khối trên sơ đồ (ví dụ Db) hoặc loại (ví dụ AWS::RDS::DBInstance)"}},required:["idOrType"]},
      execute:async({idOrType})=>{const ty=T[idOrType]?idOrType:typeOf(idOrType);if(!ty)return fail(`Không có khối hay loại “${idOrType}”.`);const L=L_();
        return out({type:ty,label:T[ty].label,simple:typeof eli5Of==="function"?eli5Of(ty):"",doc:T[ty].doc||"",inThisLesson:L&&L.explain?L.explain[idOrType]||null:null,block:nodeOf(idOrType)?blockSummary(nodeOf(idOrType)):null})}},
    {name:"open_lesson",description:"Mở một bài học theo id (xem list_lessons). Thay sơ đồ hiện tại bằng template của bài.",inputSchema:{type:"object",properties:{id:{type:"string"}},required:["id"]},
      execute:async({id})=>{const i=LESSONS.findIndex(l=>l.id===id);if(i<0)return fail(`Không có bài “${id}”.`);startLesson(i);render();return out({ok:true,opened:LESSONS[i].title,goal:LESSONS[i].goal})}},
    {name:"open_sandbox",description:"Mở sandbox tự do (giữ sơ đồ sandbox đã lưu trước đó).",inputSchema:{type:"object",properties:{}},execute:async()=>{startSandbox();render();return out({ok:true,blocks:allNodes().length})}},
    {name:"load_template",description:"Mở một template CloudFormation YAML vào sandbox (thay sơ đồ sandbox hiện tại). Dùng để dựng tình huống của người dùng. Trả về lỗi YAML kèm số dòng, hoặc danh sách khối và vấn đề.",
      inputSchema:{type:"object",properties:{yaml:{type:"string",description:"Template CloudFormation YAML; xem get_format_guide"}},required:["yaml"]},
      execute:async({yaml})=>{const r=fromYaml(String(yaml||""),{name:"sandbox"});if(!r.ok)return fail(`YAML lỗi${r.line?` ở dòng ${r.line}`:""}: ${r.err}`);
        startSandbox(r.model);gs().zoom=null;render();log("CloudLab","webmcp","load_template",`Agent mở template · ${Object.keys(r.model.res).length} tài nguyên`,"ok");
        return out({ok:true,blocks:allNodes().map(n=>n.id),problems:problems().map(p=>p.sev+": "+p.msg)})}},
    {name:"add_component",description:"Thêm một khối mới lên sơ đồ.",inputSchema:{type:"object",properties:{type:{type:"string",description:"Loại, ví dụ AWS::S3::Bucket (xem get_format_guide)"}},required:["type"]},
      execute:async({type})=>{if(!T[type]||T[type].edge)return fail(`Loại “${type}” không thêm được thành khối.`);let id;const[x,y]=freeSpot(...viewCenter());edit("add "+type,()=>{id=addNode(type,x,y)});UI.sel={node:id};return out({...after("add "+id),id})}},
    {name:"connect",description:"Nối khối from tới khối to, giống kéo mũi tên trên canvas (ví dụ Lambda → bucket thêm biến môi trường và quyền). Trả lý do nếu không nối được.",
      inputSchema:{type:"object",properties:{from:{type:"string"},to:{type:"string"},grant:{type:"boolean",description:"Khi phép nối kèm cấp quyền IAM hoặc mở security group: true để làm luôn (mặc định true)"}},required:["from","to"]},
      execute:async({from,to,grant})=>{if(!nodeOf(from)||!nodeOf(to))return fail("Không tìm thấy khối from hoặc to.");const r=connectRule(from,to);if(!r)return fail(whyNot(from,to));
        edit(`${from} → ${to}`,()=>r.apply(grant!==false));return out({...after(`${from} → ${to}: ${r.label}`),connected:r.label})}},
    {name:"set_property",description:"Đổi một thuộc tính của khối (đường dẫn theo Properties, ví dụ MemorySize hoặc PublicAccessBlockConfiguration.BlockPublicAcls). Đường dẫn bắt đầu bằng @ là Metadata.CloudLab (ví dụ @WorkMs).",
      inputSchema:{type:"object",properties:{id:{type:"string"},path:{type:"string"},value:{description:"Giá trị mới (chuỗi, số, boolean, object hoặc mảng)"}},required:["id","path","value"]},
      execute:async({id,path,value})=>{const raw=M.res[id]||M.ext[id]||M.manual[id];if(!raw)return fail(`Không có khối “${id}”.`);
        edit(`${id}.${path}`,()=>{if(String(path).startsWith("@"))setP(raw,"Metadata.CloudLab."+String(path).slice(1),value);else{raw.Properties=raw.Properties||{};setP(raw.Properties,String(path),value)}});return out(after(`${id}.${path}`))}},
    {name:"remove_component",description:"Xóa một khối khỏi sơ đồ (gỡ luôn các tham chiếu tới nó).",inputSchema:{type:"object",properties:{id:{type:"string"}},required:["id"]},
      execute:async({id})=>{if(!nodeOf(id))return fail(`Không có khối “${id}”.`);edit("rm "+id,()=>removeNode(id));if(UI.sel&&UI.sel.node===id)UI.sel=null;return out(after("remove "+id))}},
    {name:"run_simulation",description:"Chạy mô phỏng trong một khoảng thời gian giả lập (deploy nếu chưa deploy) rồi trả kết quả: số liệu từng khối, lỗi trên từng mũi tên, chi phí và vấn đề cấu hình.",
      inputSchema:{type:"object",properties:{seconds:{type:"number",description:"Thời gian giả lập, giây (ví dụ 3600 = 1 giờ, tối đa 2592000 = 30 ngày)"}},required:["seconds"]},
      execute:async({seconds})=>{const total=Math.min(Math.max(+seconds||60,1),2592000);if(typeof simPlay==="function")simPlay(false);if(!stackUp()&&Object.keys(M.res).length)deploy();
        const c0=RT.total,st=total<=600?10:total<=86400?60:3600;for(let t=0;t<total;t+=st)step(Math.min(st,total-t));render();
        return out({simulatedSec:total,costThisRunUSD:+(RT.total-c0).toFixed(4),costTotalUSD:+RT.total.toFixed(4),blocks:allNodes().map(n=>({id:n.id,metrics:(RT.n[n.id]||{}).m||{},lastError:(RT.n[n.id]||{}).lastErr||null})),
          blockedConnections:Object.entries(RT.why).map(([k,v])=>({edge:k.replace(/>/g," → "),reason:v})),problems:problems().map(p=>p.sev+": "+p.msg)})}},
    {name:"check_lesson",description:"Bấm Kiểm tra cho bài đang mở: chấm từng nhiệm vụ và trả kết quả.",inputSchema:{type:"object",properties:{}},
      execute:async()=>{const L=L_();if(!L)return fail("Đang ở sandbox, không có bài để kiểm tra.");check();render();const R=UI.result;
        return out({passed:R.ok,message:R.msg,tasks:L.tasks.map((t,i)=>({task:t.t,passed:!!R.res[i]}))})}},
    {name:"export_iac",description:"Xuất sơ đồ hiện tại ra code hạ tầng: cfn (CloudFormation có metadata CloudLab), aws (CloudFormation sạch để deploy), tf (Terraform), cdk (AWS CDK TypeScript).",
      inputSchema:{type:"object",properties:{format:{type:"string",enum:["cfn","aws","tf","cdk"]}},required:["format"]},
      execute:async({format})=>{const e=EXPORTS[format];if(!e)return fail("format phải là cfn, aws, tf hoặc cdk");return out(e.gen?e.gen():toYaml())}}];
  if(window.CloudLab)window.CloudLab.tools=Object.fromEntries(TOOLS.map(t=>[t.name,t]));
  /* register with the browser when WebMCP is available */
  const mc=(typeof document!=="undefined"&&document.modelContext)||(typeof navigator!=="undefined"&&navigator.modelContext);
  if(!mc)return;const ctl=new AbortController();
  (async()=>{try{if(typeof mc.registerTool==="function"){for(const t of TOOLS)await mc.registerTool(t,{signal:ctl.signal})}
    else if(typeof mc.provideContext==="function")await mc.provideContext({tools:TOOLS});
    log("CloudLab","webmcp","register",`WebMCP: ${TOOLS.length} công cụ cho trợ lý AI của trình duyệt`,"ok")}catch(err){console.warn("WebMCP registration failed",err)}})();
})();
