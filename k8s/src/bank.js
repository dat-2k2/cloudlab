"use strict";
/* Kubernetes pack · banking context: every lesson is set in the same fictional bank as the AWS lessons (Ngân hàng An
   Phát). Cases and rules were checked against the linked sources; Thông tư 09/2020 article numbers are the article
   headings (wording paraphrased, check the official text before quoting). Applied onto LESSONS at the end. */
const K8S_BANK={
  pods:{
    why:"Triển khai ứng dụng giống mở một quầy giao dịch mới: chỉ cần sai tên mẫu biểu hay thiếu con dấu là quầy không mở được. Một lỗi gõ nhầm tag image hoặc tên ConfigMap khiến Pod không chạy, bản Internet Banking mới không lên. Vì vậy cấu hình phải được kiểm tra trước khi đưa vào vận hành, và phải có đường quay lại bản cũ.",
    cases:[
      {t:"Ngày 1/8/2012, Knight Capital triển khai sai code mới lên bộ định tuyến lệnh tự động, hệ thống gửi hơn 4 triệu lệnh trong 45 phút đầu phiên và công ty lỗ hơn 460 triệu USD; SEC sau đó phạt 12 triệu USD.",url:"https://www.sec.gov/news/press-release/2013-222"}
    ],
    rule:{t:"Thông tư 09/2020/TT-NHNN, Điều 21 yêu cầu xây dựng tiêu chuẩn và yêu cầu kỹ thuật bảo đảm hệ thống hoạt động bình thường trước khi đưa vào sử dụng chính thức, và rà soát lại các tiêu chuẩn này khi hệ thống thay đổi.",url:"https://caselaw.vn/van-ban-phap-luat/373213-thong-tu-so-09-2020-tt-nhnn-ngay-21-10-2020-cua-thong-doc-ngan-hang-nha-nuoc-viet-nam-quy-dinh-ve-an-toan-he-thong-thong-tin-trong-hoat-dong-ngan-hang"},
    q:"Ở đơn vị anh/chị, ai kiểm tra lại tên phiên bản và tham số cấu hình trước khi một bản phát hành được đưa lên môi trường thật?",
    scenario:"Sáng nay tôi phát hành bản Internet Banking mới với màn hình chuyển khoản cải tiến. Trên màn hình quản trị, bản mới cứ báo lỗi và không chịu chạy, khách thì không mở được trang. Còn nửa tiếng nữa là đến giờ cao điểm buổi sáng.",
    who:["L","Lan · Dev Internet Banking"]
  },
  service:{
    why:"Service giống tổng đài chuyển cuộc gọi: khách gọi một số chung, tổng đài nối tới giao dịch viên đang trực. Nếu tổng đài ghi sai tên nhóm (label selector) hoặc sai số máy lẻ (targetPort), cuộc gọi không đến được ai dù mọi người vẫn ngồi đó. Khách nhận lỗi 503 và nghĩ ngân hàng sập.",
    cases:[
      {t:"Ngày 27/10/2017, ngân hàng số Monzo (Anh) bị sự cố hơn một giờ khi lớp định tuyến linkerd trên Kubernetes không còn nhận cập nhật vị trí Pod và gửi yêu cầu tới địa chỉ IP không hợp lệ; thanh toán đi bị lỗi, thanh toán đến bị chậm.",url:"https://www.theregister.com/2017/10/31/kubernetes_bug_bank_app_monzo/"}
    ],
    q:"Khi khách báo lỗi dịch vụ tạm thời không khả dụng, đơn vị anh/chị kiểm tra gì trước: ứng dụng có đang chạy không, hay đường nối tới ứng dụng có đúng không?",
    scenario:"Từ 9 giờ, tổng đài nhận liên tiếp phản ánh: mở trang Internet Banking chỉ thấy thông báo lỗi 503. Bên kỹ thuật nói các máy chủ ứng dụng đều đang chạy bình thường, nhưng khách vẫn không vào được. Tôi cần biết khi nào dịch vụ trở lại để trả lời khách.",
    who:["H","Hà · Khối Vận hành"]
  },
  probes:{
    why:"Core API khởi động chậm giống chi nhánh cần 15 phút đầu ngày để kiểm quỹ. Nếu bảo vệ thấy chưa mở cửa là bắt nhân viên ra về, chi nhánh không bao giờ mở được: đó là liveness probe quá vội gây CrashLoopBackOff. Còn readiness probe kiểm tra sai đường dẫn thì giống biển báo luôn ghi chưa sẵn sàng, Pod không bao giờ được nhận khách.",
    cases:[
      {t:"Tài liệu Kubernetes cảnh báo liveness probe cấu hình sai có thể gây lỗi dây chuyền: container bị khởi động lại đúng lúc tải cao, yêu cầu của khách bị lỗi và phần tải dồn lên các Pod còn lại.",url:"https://kubernetes.io/docs/concepts/workloads/pods/probes/"},
      {t:"Tháng 4/2018, TSB (Anh) chuyển đổi nền tảng CNTT và gặp lỗi làm gián đoạn chi nhánh, điện thoại, Internet và mobile banking, ảnh hưởng một phần đáng kể trong 5,2 triệu khách; tháng 12/2022 FCA và PRA phạt tổng cộng 48,65 triệu bảng.",url:"https://www.fca.org.uk/news/press-releases/tsb-fined-48m-operational-resilience-failings"}
    ],
    rule:{t:"Thông tư 09/2020/TT-NHNN, Điều 20 khoản 1 yêu cầu hệ thống từ cấp độ 3 trở lên có quy trình vận hành, gồm cả khởi động và dừng hệ thống, được rà soát ít nhất mỗi năm một lần.",url:"https://caselaw.vn/van-ban-phap-luat/373213-thong-tu-so-09-2020-tt-nhnn-ngay-21-10-2020-cua-thong-doc-ngan-hang-nha-nuoc-viet-nam-quy-dinh-ve-an-toan-he-thong-thong-tin-trong-hoat-dong-ngan-hang"},
    q:"Core banking của đơn vị anh/chị cần bao lâu để khởi động xong sau bảo trì, và con số đó có được ghi trong quy trình vận hành không?",
    scenario:"Đêm qua, trong khung bảo trì, chúng tôi nâng cấp core API. Đến 6 giờ sáng hệ thống vẫn chưa lên: dịch vụ khởi động được một lúc lại tắt, rồi lại khởi động. Còn hai tiếng nữa là chi nhánh mở cửa.",
    who:["M","Minh · Trưởng nhóm hạ tầng"]
  },
  ingress:{
    why:"Mỗi Service kiểu LoadBalancer là một cửa mở thẳng ra Internet, như tòa nhà có nhiều cửa phụ không ai trực. Gom về một Ingress là chỉ để một cửa chính có bảo vệ; công cụ quản trị nội bộ phải nằm phía trong và chỉ vào qua kênh nội bộ. Ít cửa hơn cũng là ít địa chỉ IP công khai và ít chi phí load balancer hơn.",
    cases:[
      {t:"Tháng 2/2018, RedLock công bố bảng điều khiển Kubernetes của Tesla mở ra Internet không có mật khẩu; kẻ tấn công lấy được thông tin đăng nhập AWS lưu trong một Pod và dùng tài nguyên để đào tiền mã hóa Monero.",url:"https://www.bleepingcomputer.com/news/security/tesla-internal-servers-infected-with-cryptocurrency-miner/"},
      {t:"Tài liệu Kubernetes nêu Ingress cho phép định tuyến từ một địa chỉ IP tới nhiều Service theo đường dẫn, nhờ đó giữ số load balancer ở mức tối thiểu.",url:"https://kubernetes.io/docs/concepts/services-networking/ingress/"}
    ],
    rule:{t:"Thông tư 09/2020/TT-NHNN, Điều 23 khoản 3 yêu cầu chia mạng thành các vùng và có vùng DMZ riêng cho dịch vụ cung cấp trên Internet.",url:"https://caselaw.vn/van-ban-phap-luat/373213-thong-tu-so-09-2020-tt-nhnn-ngay-21-10-2020-cua-thong-doc-ngan-hang-nha-nuoc-viet-nam-quy-dinh-ve-an-toan-he-thong-thong-tin-trong-hoat-dong-ngan-hang"},
    q:"Hôm nay có bao nhiêu màn hình quản trị của đơn vị anh/chị mà người ngoài ngân hàng mở được từ Internet, và ai là người biết chắc con số đó?",
    scenario:"Đợt rà soát bề mặt tấn công tuần này cho thấy An Phát có năm địa chỉ IP công khai, mỗi địa chỉ trỏ vào một dịch vụ khác nhau. Một trong số đó là trang quản trị back-office, nơi nhân viên duyệt hồ sơ khách hàng, và ai trên Internet cũng mở được trang đăng nhập của nó.",
    who:["T","Tuấn · Bảo mật thông tin"]
  },
  resources:{
    why:"Requests giống số chỗ đặt trước, limits là mức trần. Trần bộ nhớ quá thấp thì ứng dụng bị tắt ngang (OOMKilled), như quầy bị cắt điện giữa giao dịch. Đặt trước nhiều CPU hơn sức chứa của một node thì Pod chờ mãi (Pending), như đặt bàn 20 người trong phòng 10 ghế. Đây là bài toán hoạch định năng lực, cần số đo thực tế chứ không đoán.",
    cases:[
      {t:"Tài liệu Kubernetes nêu scheduler từ chối đặt Pod lên node nếu tổng requests vượt sức chứa, kể cả khi mức dùng thực tế đang thấp, để phòng lúc tải tăng vào giờ cao điểm; còn vượt memory limit thì container có thể bị kernel tắt (OOM kill).",url:"https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/"}
    ],
    rule:{t:"Thông tư 09/2020/TT-NHNN, Điều 21 khoản 2 yêu cầu giám sát, tối ưu hiệu suất và đánh giá năng lực hệ thống để dự báo, lập kế hoạch mở rộng, nâng cấp đáp ứng nhu cầu tương lai.",url:"https://caselaw.vn/van-ban-phap-luat/373213-thong-tu-so-09-2020-tt-nhnn-ngay-21-10-2020-cua-thong-doc-ngan-hang-nha-nuoc-viet-nam-quy-dinh-ve-an-toan-he-thong-thong-tin-trong-hoat-dong-ngan-hang"},
    q:"Đơn vị anh/chị dựa vào đâu để quyết định một hệ thống cần bao nhiêu CPU và bộ nhớ: số đo thực tế, khuyến nghị của nhà cung cấp, hay thói quen?",
    scenario:"Dịch vụ tra cứu sao kê cứ khoảng nửa tiếng lại gián đoạn vài giây, khách đang xem dở thì bị văng ra. Bên kỹ thuật thêm một bản chạy nữa thì bản đó không chịu khởi động, cứ nằm chờ. Tuần sau là kỳ gửi sao kê cuối tháng.",
    who:["H","Hà · Khối Vận hành"]
  },
  hpa:{
    why:"Ngày trả lương hay cận Tết, lượng giao dịch có thể tăng gấp mấy lần trong vài giờ. HPA giống việc mở thêm quầy khi hàng chờ dài, nhưng nó chỉ đo được mức bận khi mỗi container khai báo requests, và chỉ mở thêm được khi node pool còn chỗ. Thiếu một trong hai điều đó, quầy mới không bao giờ mở.",
    cases:[
      {t:"Ngày 28/1/2022, cận Tết Nhâm Dần, khách hàng BIDV, Vietcombank, Techcombank phản ánh app báo lỗi khi chuyển khoản; Vietcombank cho biết lượng giao dịch khi đó cao gấp khoảng ba lần ngày thường.",url:"https://vnbusiness.vn/sat-tet-app-ngan-hang-lai-lien-tuc-do.html"},
      {t:"Ngày 9/2/2024, cận Tết Giáp Thìn, khách hàng phản ánh chuyển khoản nhanh qua app TPBank, Vietcombank, BIDV bị lỗi hoặc treo nhiều giờ; BIDV giải thích lượng giao dịch tăng đột biến vào giờ cao điểm gây quá tải.",url:"https://doanhnhan.baophapluat.vn/den-hen-lai-len-khach-hang-ngan-ngam-truoc-tinh-trang-nghen-mang-chuyen-khoan-thanh-toan-online-ngay-can-tet-65513.html"}
    ],
    rule:{t:"Thông tư 09/2020/TT-NHNN, Điều 23 khoản 3 yêu cầu hệ thống từ cấp độ 3 trở lên cung cấp dịch vụ trên Internet phải có cân bằng tải và phương án xử lý tấn công từ chối dịch vụ.",url:"https://caselaw.vn/van-ban-phap-luat/373213-thong-tu-so-09-2020-tt-nhnn-ngay-21-10-2020-cua-thong-doc-ngan-hang-nha-nuoc-viet-nam-quy-dinh-ve-an-toan-he-thong-thong-tin-trong-hoat-dong-ngan-hang"},
    q:"Đơn vị anh/chị có gửi lịch các ngày cao điểm (trả lương, Tết, sự kiện lớn) cho bộ phận hạ tầng trước ít nhất một tuần không?",
    scenario:"Ngày 25 là ngày nhiều doanh nghiệp trả lương. Từ 8 giờ, mobile banking chậm dần, nhiều khách phải chờ hơn 30 giây mới chuyển được tiền. Chúng tôi đã cài tự động mở rộng từ tháng trước, nhưng số bản chạy vẫn đứng yên ở 2.",
    who:["M","Minh · Trưởng nhóm hạ tầng"]
  },
  secrets:{
    why:"Để mật khẩu cơ sở dữ liệu trong ConfigMap giống dán mã két sắt lên cửa phòng: ai đọc được cấu hình là có chìa khóa. Secret tách thông tin này ra để phân quyền riêng, nhưng mặc định nó chỉ được mã hóa base64 và lưu không mã hóa trong etcd. Cần bật encryption at rest, RBAC tối thiểu và cân nhắc kho bí mật bên ngoài.",
    cases:[
      {t:"Năm 2016, một kỹ sư Uber đăng khóa truy cập (access key) lên một kho GitHub riêng tư; kẻ xâm nhập dùng khóa đó tải dữ liệu gồm 25,6 triệu tên và email của khách và tài xế, theo FTC.",url:"https://www.ftc.gov/node/54285"},
      {t:"Thông tư 50/2024/TT-NHNN (hiệu lực 01/01/2025), Điều 19 yêu cầu thông tin xác thực giao dịch như mật khẩu, mã PIN phải được mã hóa hoặc che dấu khi lưu trữ.",url:"https://luatvietnam.vn/tin-van-ban-moi/ngan-hang-ap-dung-toi-thieu-5-bien-phap-bao-mat-du-lieu-khach-hang-tu-01-01-2025-186-99993-article.html"}
    ],
    rule:{t:"PCI DSS v4, yêu cầu 8.3.2: mọi yếu tố xác thực phải được làm cho không đọc được bằng mật mã mạnh khi truyền và khi lưu trữ.",url:"https://www.pcisecuritystandards.org/faq/articles/Frequently_Asked_Question/does-hashing-of-passwords-meet-the-intent-of-pci-dss-requirement-8-3-2"},
    q:"Nếu hôm nay một nhân viên từng có quyền đọc cấu hình hệ thống nghỉ việc, đơn vị anh/chị cần bao lâu để đổi hết các mật khẩu người đó có thể đã thấy?",
    scenario:"Trong đợt kiểm toán quý, tôi mở file cấu hình của ứng dụng cho vay để đối chiếu tham số. Ngay dòng thứ mười là tài khoản và mật khẩu cơ sở dữ liệu khách hàng, đọc được bằng mắt thường. Tôi cần biết còn những ai khác xem được file này.",
    who:["V","Vy · Kiểm toán nội bộ"]
  },
  netpol:{
    why:"Vùng dữ liệu thẻ giống kho tiền: chỉ bộ phận thanh toán được vào, phòng marketing dù cùng tòa nhà cũng không có thẻ từ. Mặc định trong Kubernetes, Pod nào cũng gọi được Pod nào. NetworkPolicy là cửa kiểm soát giữa các namespace, giúp thu hẹp phạm vi đánh giá PCI DSS và hạn chế thiệt hại khi một ứng dụng bị chiếm quyền.",
    cases:[
      {t:"Tài liệu Kubernetes nêu mặc định Pod không bị cô lập, mọi kết nối vào và ra đều được phép; NetworkPolicy chỉ có hiệu lực khi network plugin của cụm hỗ trợ.",url:"https://kubernetes.io/docs/concepts/services-networking/network-policies/"},
      {t:"PCI DSS v4, yêu cầu 1.3.1 và 1.3.2: lưu lượng vào và ra khỏi môi trường dữ liệu chủ thẻ (CDE) chỉ được phép ở mức cần thiết, mọi lưu lượng khác phải bị từ chối.",url:"https://learn.microsoft.com/en-us/entra/standards/pci-requirement-1"}
    ],
    rule:{t:"Thông tư 09/2020/TT-NHNN, Điều 23 khoản 3 yêu cầu chia mạng thành các vùng theo đối tượng, mục đích sử dụng và hệ thống, tối thiểu có vùng riêng cho máy chủ ứng dụng và cơ sở dữ liệu của hệ thống từ cấp độ 3 trở lên, và dùng tường lửa kiểm soát truy cập giữa các vùng quan trọng.",url:"https://caselaw.vn/van-ban-phap-luat/373213-thong-tu-so-09-2020-tt-nhnn-ngay-21-10-2020-cua-thong-doc-ngan-hang-nha-nuoc-viet-nam-quy-dinh-ve-an-toan-he-thong-thong-tin-trong-hoat-dong-ngan-hang"},
    q:"Nếu ứng dụng khảo sát khách hàng của khối marketing bị chiếm quyền, kẻ tấn công có thể đi tới những hệ thống nào khác của ngân hàng?",
    scenario:"Trong đợt kiểm thử xâm nhập tháng này, đối tác đứng từ một ứng dụng khuyến mãi của khối marketing và gọi thẳng được tới dịch vụ lưu số thẻ. Không có lớp nào chặn lại. Nếu để vậy, đợt đánh giá PCI DSS sắp tới sẽ coi cả cụm là phạm vi dữ liệu thẻ.",
    who:["T","Tuấn · Bảo mật thông tin"]
  },
  pvc:{
    why:"Chạy cơ sở dữ liệu bằng Deployment không có ổ lưu trữ bền giống ghi sổ cái lên bảng trắng: lau bảng là mất. Container khởi động lại với trạng thái trắng, dữ liệu ghi bên trong biến mất. Ngân hàng phải lưu chứng từ, sổ sách nhiều năm và sao lưu định kỳ, nên dữ liệu phải nằm trên PersistentVolume gắn với StatefulSet, không phụ thuộc vòng đời Pod.",
    cases:[
      {t:"Tài liệu Kubernetes nêu file trong container là tạm thời: khi container bị lỗi hoặc dừng, kubelet khởi động lại nó với trạng thái sạch, và dữ liệu trong emptyDir bị xóa vĩnh viễn khi Pod rời node.",url:"https://kubernetes.io/docs/concepts/storage/volumes/"},
      {t:"Bộ Tài chính hướng dẫn theo Nghị định 174/2016/NĐ-CP: chứng từ dùng trực tiếp ghi sổ, sổ kế toán và báo cáo tài chính phải lưu trữ tối thiểu 10 năm.",url:"https://portal.mof.gov.vn/hoidapcstc/home/cthoidap/162984"}
    ],
    rule:{t:"Thông tư 09/2020/TT-NHNN, Điều 22 yêu cầu dữ liệu hệ thống từ cấp độ 3 trở lên được sao lưu tự động, sao ra phương tiện lưu trữ ngoài và kiểm tra phục hồi ít nhất mỗi năm một lần.",url:"https://caselaw.vn/van-ban-phap-luat/373213-thong-tu-so-09-2020-tt-nhnn-ngay-21-10-2020-cua-thong-doc-ngan-hang-nha-nuoc-viet-nam-quy-dinh-ve-an-toan-he-thong-thong-tin-trong-hoat-dong-ngan-hang"},
    q:"Lần gần nhất đơn vị anh/chị thử khôi phục dữ liệu từ bản sao lưu là khi nào, và mất bao lâu?",
    scenario:"Sáng nay hệ thống ghi nhận yêu cầu tra soát khởi động lại sau một lần cập nhật. Khi lên lại, toàn bộ yêu cầu khách gửi từ tuần trước biến mất, danh sách trống trơn. Hơn 300 khách đang chờ phản hồi khiếu nại.",
    who:["H","Hà · Khối Vận hành"]
  },
  cronjob:{
    why:"Đối soát cuối ngày giống kiểm quỹ lúc đóng cửa: chỉ làm một lần và phải xong trước ca sau. Nếu lần chạy hôm nay chậm mà lịch vẫn khởi động lần kế tiếp (concurrencyPolicy: Allow), hai lần đối soát chạy chồng nhau và bút toán có thể bị ghi hai lần. Tài liệu Kubernetes cũng nói CronJob đôi khi tạo hai Job, nên Job phải idempotent.",
    cases:[
      {t:"Tháng 6/2012, một lần nâng cấp phần mềm xử lý cập nhật tài khoản qua đêm tại RBS, NatWest và Ulster Bank gây gián đoạn cho hơn 6,5 triệu khách trong nhiều tuần; năm 2014 FCA phạt 42 triệu bảng và PRA phạt thêm 14 triệu bảng.",url:"https://www.fca.org.uk/news/press-releases/fca-fines-rbs-natwest-and-ulster-bank-ltd-42m-for-it-failures"},
      {t:"Tháng 3/2018, lỗi hệ thống thanh toán của ING (Hà Lan) làm khoảng 3 triệu khoản ghi nợ tự động bị ghi hai lần.",url:"https://www.dutchnews.nl/2018/03/ing-repairs-system-rebooks-funds-transferred-by-glitch"}
    ],
    rule:{t:"Thông tư 09/2020/TT-NHNN, Điều 20 khoản 4 yêu cầu hệ thống giao dịch khách hàng có biện pháp bảo vệ tính toàn vẹn dữ liệu giao dịch và ghi nhật ký mọi thao tác để phục vụ kiểm tra.",url:"https://caselaw.vn/van-ban-phap-luat/373213-thong-tu-so-09-2020-tt-nhnn-ngay-21-10-2020-cua-thong-doc-ngan-hang-nha-nuoc-viet-nam-quy-dinh-ve-an-toan-he-thong-thong-tin-trong-hoat-dong-ngan-hang"},
    q:"Nếu đêm nay job đối soát chạy hai lần, sáng mai ai sẽ phát hiện ra đầu tiên, và bằng cách nào?",
    scenario:"Sáng thứ Hai, báo cáo đối soát cuối ngày thứ Sáu có hai bộ bút toán điều chỉnh giống hệt nhau, chênh lệch quỹ bị nhân đôi. Khối Vận hành cho biết đêm đó job chạy lâu hơn thường lệ vì lượng giao dịch tăng. Tôi cần biết còn những ngày nào khác cũng bị như vậy.",
    who:["V","Vy · Kiểm toán nội bộ"]
  }
};
for(const L of LESSONS){const B=K8S_BANK[L.id];if(!B)continue;L.who=B.who||L.who;L.scenario=B.scenario||L.scenario;L.bank={why:B.why,cases:B.cases||[],rule:B.rule,q:B.q}}
