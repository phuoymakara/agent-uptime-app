                Central API (one region)
                        │
                        │ create monitor
                        ▼
                  Job Queue (Redis/SQS)
                ┌────────┼────────┐
                ▼        ▼        ▼
        Worker (Asia) Worker (EU) Worker (US)
            │             │            │
            └────── check target URL ─┘
                        │
                        ▼
                 Send result → API


https://developers.cloudflare.com/workers/configuration/placement/#:~:text=Python%20Workers,Understand%20placement

https://docs.cloud.google.com/compute/docs/regions-zones