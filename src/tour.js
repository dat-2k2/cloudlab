"use strict";
/* Product tour: a short walkthrough of the screen, shown once on the first visit. The "seen" flag lives in
   localStorage (cloudlab:tour = TOUR_VERSION); bump TOUR_VERSION when the tour changes enough to show again.
   The "?" button in the top bar replays it. The spotlight never blocks the page: only the card takes clicks. */
const TOUR_VERSION="v1",TOUR_KEY="cloudlab:tour";
const TOUR_STEPS=[
  {t:"Chào mừng đến CloudLab",b:"Ở đây bạn học AWS bằng cách sửa một hệ thống mẫu có lỗi, rồi chạy thử xem nó hoạt động thế nào. Không gọi AWS thật, không tốn tiền. Mất khoảng 1 phút để xem qua màn hình."},
  {sel:"#lesson",place:"left",t:"Bắt đầu từ khung này",b:"Mục tiêu và nhiệm vụ của bài nằm trên cùng. Bên dưới là bối cảnh: tình huống và ví dụ trong ngân hàng. Phần Tham khảo thu gọn sẵn, khi cần mới mở."},
  {sel:"#lessonResize",place:"left",t:"Kéo để mở rộng khung đọc",b:"Kéo mép này sang trái (hoặc bấm ⇤ Mở rộng) để đọc thoải mái. Sơ đồ bên cạnh khi đó chỉ để tham khảo."},
  {sel:".gx",place:"right",t:"Sơ đồ hệ thống",b:"Mỗi khối là một thành phần AWS, mũi tên là cách chúng gọi nhau. Bấm một khối để đọc phần Hiểu nhanh, giải thích bằng ví dụ ngân hàng."},
  {sel:"#side",place:"right",t:"Bài học và thành phần",b:"Tab Bài học là lộ trình. Tab Thành phần có mọi khối AWS: kéo một khối vào sơ đồ để thêm. Nút « ở dưới cùng thu gọn thanh này."},
  {sel:'[data-act="simToggle"]',place:"top",t:"Chạy mô phỏng",b:"Bấm Chạy để giả lập khách hàng gửi yêu cầu. Mũi tên đổi màu theo kết quả: chạy được, bị chặn, hay lỗi, kèm lý do."},
  {sel:".meter",place:"top",t:"Đồng hồ chi phí",b:"Tiền cộng dồn theo thời gian mô phỏng, theo giá tham khảo. Một cấu hình sai có thể làm nó chạy rất nhanh."},
  {sel:'[data-act="panel"][data-arg="problems"]',place:"top",t:"Vấn đề",b:"Danh sách lỗi cấu hình và rủi ro, như một người kiểm tra soát lại hồ sơ. Bấm một dòng để tới đúng khối."},
  {sel:'[data-act="check"]',place:"left",t:"Sửa xong thì Check",b:"Check chấm từng nhiệm vụ. Bí thì bấm Gợi ý: gợi ý mở dần từ triệu chứng tới nguyên nhân."},
  {sel:'[data-act="vMode"][data-arg="code"]',place:"bottom",t:"Xem dạng code",b:"Sơ đồ cũng là một file CloudFormation. Tab YAML cho xem và xuất ra Terraform hoặc CDK. Người không làm kỹ thuật có thể bỏ qua."},
  {sel:"#tourBtn",place:"bottom",t:"Xem lại lúc nào cũng được",b:"Nút ? mở lại hướng dẫn này. Chúc bạn học vui."}];
let TOUR=null;
const tourSeen=()=>{try{return localStorage.getItem(TOUR_KEY)===TOUR_VERSION}catch(_){return true}};
const tourMark=()=>{try{localStorage.setItem(TOUR_KEY,TOUR_VERSION)}catch(_){}};
function tourVisible(el){if(!el)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth}
function tourStart(){tourEnd(false);const steps=TOUR_STEPS.filter(s=>!s.sel||tourVisible(document.querySelector(s.sel)));
  const spot=document.createElement("div");spot.className="tour-spot";spot.setAttribute("aria-hidden","true");
  const card=document.createElement("div");card.className="tour-card";card.setAttribute("role","dialog");card.setAttribute("aria-modal","false");card.setAttribute("aria-labelledby","tourTitle");card.tabIndex=-1;
  document.body.append(spot,card);TOUR={i:0,steps,spot,card,ret:document.activeElement};tourShow();TOUR.raf=requestAnimationFrame(tourTrack)}
function tourShow(){const T_=TOUR;if(!T_)return;const s=T_.steps[T_.i],el=s.sel&&document.querySelector(s.sel),last=T_.i===T_.steps.length-1;
  T_.card.innerHTML=`<div class="tour-h"><span class="tour-n">${T_.i+1}/${T_.steps.length}</span><button class="tour-x" data-tour="skip" aria-label="Đóng hướng dẫn">×</button></div>
    <h2 id="tourTitle">${esc(s.t)}</h2><p>${esc(s.b)}</p>
    <div class="tour-a">${T_.i?`<button class="sm ghost" data-tour="prev">Quay lại</button>`:`<button class="sm ghost" data-tour="skip">Bỏ qua</button>`}<button class="sm primary" data-tour="next">${last?"Bắt đầu học":"Tiếp"}</button></div>`;
  tourPlace();
  T_.card.focus({preventScroll:true})}
/* position the spotlight and the card around the current target; re-run whenever the target moves or resizes */
function tourPlace(){const T_=TOUR;if(!T_)return;const s=T_.steps[T_.i],el=s.sel&&document.querySelector(s.sel);
  if(el&&tourVisible(el)){const r=el.getBoundingClientRect(),pad=6;Object.assign(T_.spot.style,{display:"block",left:r.left-pad+"px",top:r.top-pad+"px",width:r.width+pad*2+"px",height:r.height+pad*2+"px"});T_.spot.classList.remove("center")}
  else{Object.assign(T_.spot.style,{display:"block",left:"50%",top:"50%",width:"0px",height:"0px"});T_.spot.classList.add("center")}
  /* place the card next to the target, clamped to the viewport */
  const c=T_.card,cw=Math.min(340,innerWidth-32);c.style.width=cw+"px";c.style.left="0px";c.style.top="0px";const ch=c.offsetHeight,gap=14;let x,y;
  if(el&&tourVisible(el)){const r=el.getBoundingClientRect(),p=s.place||"bottom";
    if(p==="left"){x=r.left-cw-gap;y=r.top+Math.min(40,r.height/2-ch/2)}else if(p==="right"){x=r.right+gap;y=r.top+Math.min(40,r.height/2-ch/2)}
    else if(p==="top"){x=r.left+r.width/2-cw/2;y=r.top-ch-gap}else{x=r.left+r.width/2-cw/2;y=r.bottom+gap}
    if(x<16||x+cw>innerWidth-16){x=Math.min(Math.max(16,r.left+r.width/2-cw/2),innerWidth-cw-16);y=r.bottom+gap+ch>innerHeight-16?r.top-ch-gap:r.bottom+gap}}
  else{x=innerWidth/2-cw/2;y=innerHeight/2-ch/2}
  c.style.left=Math.round(Math.min(Math.max(16,x),innerWidth-cw-16))+"px";c.style.top=Math.round(Math.min(Math.max(16,y),innerHeight-ch-16))+"px";
  T_.last=el&&tourVisible(el)?JSON.stringify(el.getBoundingClientRect()):"none"}
/* follow the target while the tour is open (e.g. the user drags the panel edge during the resize step) */
function tourTrack(){if(!TOUR)return;const s=TOUR.steps[TOUR.i],el=s.sel&&document.querySelector(s.sel),k=el&&tourVisible(el)?JSON.stringify(el.getBoundingClientRect()):"none";
  if(k!==TOUR.last)tourPlace();TOUR.raf=requestAnimationFrame(tourTrack)}
function tourEnd(mark){if(TOUR&&TOUR.raf)cancelAnimationFrame(TOUR.raf);if(!TOUR)return;const r=TOUR.ret;TOUR.spot.remove();TOUR.card.remove();TOUR=null;if(mark)tourMark();if(r&&r.focus)try{r.focus({preventScroll:true})}catch(_){}}
document.addEventListener("click",e=>{const b=e.target.closest&&e.target.closest("[data-tour]");if(b&&TOUR){const a=b.dataset.tour;
    if(a==="next"){if(TOUR.i>=TOUR.steps.length-1)tourEnd(true);else{TOUR.i++;tourShow()}}else if(a==="prev"){TOUR.i=Math.max(0,TOUR.i-1);tourShow()}else tourEnd(true);return}
  if(e.target.closest&&e.target.closest("#tourBtn"))tourStart()});
document.addEventListener("keydown",e=>{if(!TOUR)return;if(e.key==="Escape"){e.preventDefault();e.stopPropagation();tourEnd(true)}
  else if(e.key==="ArrowRight"&&TOUR.card.contains(document.activeElement)){TOUR.i=Math.min(TOUR.steps.length-1,TOUR.i+1);tourShow()}
  else if(e.key==="ArrowLeft"&&TOUR.card.contains(document.activeElement)){TOUR.i=Math.max(0,TOUR.i-1);tourShow()}},true);
window.addEventListener("resize",()=>{if(TOUR)tourPlace()});
/* first visit: show once the app has rendered */
if(!tourSeen()&&!/[?&]notour\b/.test(location.search))setTimeout(()=>{if(!tourSeen()&&!TOUR)tourStart()},700);
