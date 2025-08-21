# BPO Assignment Serverless

## Overview

This folder contains Twilio Functions (or equivalents in your own cloud) that power the attribution flow:

- **create-attribution-task.js**  
  Creates a TaskRouter task using the Attribution Workflow. Payload includes:
  - `workflowSid`
  - `taskAttributes` (e.g., `affiliation`, and a `transfer_task` object with original `sid`, `taskSid`, original attributes, and `targetSid`).

- **transfer-task.js**  
  When the attribution task is accepted, this function:
  - Marks the original task with `transferTo` or directly triggers the Transfer, depending on your design.
  - Optionally validates receiving worker info.
  - Returns success to the plugin, which then completes the attribution task.

> By default these run as Twilio Functions. For larger operations, deploy equivalents on your cloud for scale (see below).

---

## Setup & Deploy (Twilio Functions)

```bash
cd bpo-assignment-serverless
npm install
twilio serverless:deploy
```

Note the URLs (e.g., `https://<service>-<random>.twil.io/create-attribution-task` and `/transfer-task`) and paste them into the plugin constants.

---

## Environment Variables

Set via `.env` (local) or Twilio Console → Functions → Environment Variables:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `WORKSPACE_SID` (TaskRouter)
- `ATTRIBUTION_WORKFLOW_SID`

If you validate attribution channel or roles, include those SIDs/names as needed.

---

## Example Requests

`POST /create-attribution-task`
```json
{
  "workflowSid": "WWxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "taskAttributes": {
    "affiliation": "BPO_A",
    "transfer_task": {
      "sid": "WTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "taskSid": "WTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "attributes": { "example": true },
      "targetSid": "WQxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    }
  }
}
```

`POST /transfer-task`
```json
{
  "attributionTaskSid": "WTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "receivingWorkerSid": "WKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "transfer_task": {
    "taskSid": "WTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "attributes": { "original": true, "foo": "bar" },
    "targetSid": "WQxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  }
}
```

---

## Operational Guidance on Scale

Twilio Functions are excellent for fast iteration and moderate throughput, but observe these limits:
- **~30 concurrent function invocations per account** (new invocations return HTTP 429 when exceeded).
- **10‑second execution time per invocation**.

For high‑volume or latency‑sensitive workloads, deploy these endpoints in your own cloud.

### Recommended Reference Architectures

**Option A — AWS**
- **Amazon API Gateway** → **AWS Lambda** for `/create-attribution-task` and `/transfer-task`.
- Use **SQS** (or EventBridge) for decoupling long operations.
- Store audit/state in **DynamoDB** (idempotency keys based on `taskSid:targetSid`).
- Private outbound to Twilio via **VPC NAT/Endpoints** if required.

**Option B — Google Cloud**
- **Cloud Run** (containerized) or **Cloud Functions** (2nd gen) behind **API Gateway**.
- Use **Pub/Sub** for async handoffs; **Firestore/Datastore** for state.
- Horizontal scaling with concurrency > 1 for bursty traffic.

**Option C — Azure**
- **Azure Functions** (Consumption or Premium) behind **Front Door**/**API Management**.
- **Service Bus**/**Event Grid** for async; **Cosmos DB** for state.

### Cross‑cutting Best Practices

- **Idempotency**: Use an idempotency key like `originalTaskSid:targetSid` to avoid duplicate transfers.
- **Retry & Backoff**: Handle Twilio 429/5xx with exponential backoff.
- **Timeout Budgeting**: Keep Function body < 1–2 seconds by delegating to queues/background workers.
- **Observability**: Emit request/response metrics, correlation IDs (`attributionTaskSid`, `originalTaskSid`).
- **Security**: Validate Flex JWT or use Function authentication (e.g., basic auth + allowlist), and verify Twilio webhook signatures if invoked by Twilio.
- **CORS**: Restrict origins to your Flex UI domain(s).
- **Configuration**: Keep SIDs and URLs in env vars; never hardcode secrets.

---

## Migration Notes (Functions → Your Cloud)

- Keep the request/response contract identical so the plugin remains unchanged.
- Replace Twilio Function URL constants in the plugin with your API Gateway/Front Door URLs.
- If using warm vs cold transfer **modes**, propagate a `mode` field end‑to‑end and respect it in your orchestration.

---

## References

- Twilio Functions & Assets FAQ: https://www.twilio.com/docs/serverless/functions-assets/faq
- Serverless API + Limits: https://www.twilio.com/docs/serverless/api
- Serverless Pricing: https://www.twilio.com/en-us/serverless/pricing
