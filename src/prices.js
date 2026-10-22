"use strict";
/* List prices used by the simulators (AWS page, GCP page) and the price comparison page. On-demand USD, no free tier, no
   discounts. Read on 2026-10-22 from the official AWS Price List API files (offers/v1.0/aws/<service>/current/<region>) and
   from the per-region tables of the cloud.google.com pricing pages. Regions: AWS ap-southeast-2 (Sydney, as the rest of the
   AWS page), GCP asia-southeast1 (Singapore). Capacity figures marked "CloudLab estimate" are teaching assumptions,
   not benchmarks. Prices change: check the source links before deploying. */
const PRICES={checked:"2026-10-22",
  aws:{region:"ap-southeast-2",regionName:"Sydney",
    msk:{"kafka.t3.small":0.0578,"kafka.m5.large":0.263,"kafka.m7g.large":0.255,storGBmo:0.12},
    mskSl:{clusterH:0.9375,partH:0.001875,inGB:0.125,outGB:0.0625,storGBmo:0.12},
    cacheNode:{"cache.t4g.micro":0.024,"cache.t4g.small":0.048,"cache.t3.micro":0.025,"cache.t3.small":0.05},/* Redis OSS; Valkey nodes are 20% lower */
    cacheNodeValkey:{"cache.t4g.micro":0.0192,"cache.t4g.small":0.0384},
    ecSl:{valkey:{gbH:0.101,ecpu:0.0027/1e6,minGB:0.1},redis:{gbH:0.150,ecpu:0.0041/1e6,minGB:1}},
    mq:{"mq.t3.micro":0.03432,"mq.m7g.medium":0.1709,"mq.m7g.large":0.3417,"mq.m5.large":0.36,storGBmo:0.12},
    mqCluster:{"mq.m7g.medium":0.5126,"mq.m7g.large":1.0251,"mq.m5.large":1.08},
    ws:{msg:1.30/1e6,connMin:0.325/1e6},
    ec2:{"t3.micro":0.0132,"t3.small":0.0264,"t4g.micro":0.0106,"t4g.small":0.0212},gp3GBmo:0.096,ipv4H:0.005},
  gcp:{region:"asia-southeast1",regionName:"Singapore",
    vm:{"e2-micro":0.010333268,"e2-small":0.020666535,"e2-medium":0.04133307,"e2-standard-2":0.08266614,"e2-standard-4":0.16533228},
    pdGBmo:0.11,ipv4H:0.005,egressGB:0.12,
    run:{vcpuS:0.0000336,gibS:0.0000035,idleVcpuS:0.0000035,idleGibS:0.0000035,req:0.40/1e6,instVcpuS:0.0000216,instGibS:0.0000024},
    /* Memorystore for Redis per GiB-hour by capacity tier (M1 1–4, M2 5–10, M3 11–35, M4 36–100, M5 >100 GiB) */
    redis:[{max:4,basic:0.065,std:0.114},{max:10,basic:0.04,std:0.075},{max:35,basic:0.032,std:0.063},{max:100,basic:0.024,std:0.047},{max:1e9,basic:0.019,std:0.037}],
    valkeyNode:{SHARED_CORE_NANO:0.0392,CUSTOM_PICO:0.037884,CUSTOM_MICRO:0.075768,STANDARD_SMALL:0.1758,HIGHMEM_MEDIUM:0.2372},
    /* Managed Kafka bills DCU: 1 vCPU = 0.6 DCU, 1 GiB = 0.1 DCU at $0.11025/DCU-h; local disk 100 GiB per vCPU at $0.000256164/GiB-h */
    kafka:{vcpuH:0.6*0.11025,gibH:0.1*0.11025,localGiBh:0.000256164,localGiBperVcpu:100,storGBmo:0.000136986*730,mbpsPerVcpu:10/* CloudLab estimate */},
    pubsubTiB:40,pubsubFreeGiB:10,gcsGBmo:0.02,gcsOpA:0.005,
    trial:{credit:300,days:90,vcpu:8}},
  src:{
    "AWS MSK":"https://aws.amazon.com/msk/pricing/","AWS ElastiCache":"https://aws.amazon.com/elasticache/pricing/","Amazon MQ":"https://aws.amazon.com/amazon-mq/pricing/",
    "API Gateway":"https://aws.amazon.com/api-gateway/pricing/","EC2":"https://aws.amazon.com/ec2/pricing/on-demand/","AWS Price List API":"https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/price-changes.html",
    "AWS Free Tier":"https://aws.amazon.com/free/faqs/","Amazon MQ instance types":"https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/rmq-broker-instance-types.html",
    "GCP Free Trial":"https://cloud.google.com/terms/free-trial","GCP free features":"https://docs.cloud.google.com/free/docs/free-cloud-features",
    "Managed Kafka":"https://cloud.google.com/managed-service-for-apache-kafka/pricing","Memorystore Redis":"https://cloud.google.com/memorystore/docs/redis/pricing",
    "Memorystore Valkey":"https://cloud.google.com/memorystore/valkey/pricing","Compute Engine":"https://cloud.google.com/products/compute/pricing/general-purpose",
    "Disks":"https://cloud.google.com/compute/disks-image-pricing","Network":"https://cloud.google.com/vpc/network-pricing","Cloud Run":"https://cloud.google.com/run/pricing",
    "Cloud Run WebSockets":"https://docs.cloud.google.com/run/docs/triggering/websockets","Pub/Sub":"https://cloud.google.com/pubsub/pricing","Cloud Storage":"https://cloud.google.com/storage/pricing",
    "Budgets":"https://docs.cloud.google.com/billing/docs/how-to/budgets","Budget API":"https://docs.cloud.google.com/billing/docs/reference/budget/rest/v1/billingAccounts.budgets"}};
