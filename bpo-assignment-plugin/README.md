# BPO Assignment Plugin

## Overview

This plugin customizes Flex’s transfer experience:
1. Intercepts `TransferTask` for non‑attribution tasks being transferred to a **Queue** (SID starts with `WQ`).
2. Creates an **attribution task** (via serverless) carrying the original task SID, attributes, and target queue.
3. Listens for `reservationCreated -> task.updated` and replays the intended transfer once the attribution path signals it (e.g., via a `transferTo` attribute).
4. Wraps `AcceptTask` for attribution tasks to call the serverless **transfer-task** endpoint, then completes the attribution task so the receiving worker is freed.

The implementation also de‑duplicates replays with a `Set` keyed by `taskSid:transferTo`. If present in your current code, it can **preserve the original transfer mode** (e.g., `WARM` vs `COLD`) by caching it when intercepting and reusing it on replay.

---

## Install & Run

```bash
cd bpo-assignment-plugin
npm install
npm start
```

This starts the Flex plugin dev server and opens Flex with the plugin injected locally.

---

## Configure

Open `src/BpoAssignmentPlugin.js` (or equivalent) and set:

```js
const ATTRIBUTION_WORKFLOW_SID = 'WWxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const CREATE_TASK_FUNCTION_URL = 'https://<your-domain>.twil.io/create-attribution-task';
const TRANSFER_TASK_FUNCTION_URL = 'https://<your-domain>.twil.io/transfer-task';
```

Notes:
- `ATTRIBUTION_WORKFLOW_SID` — TaskRouter workflow used to create attribution tasks.
- Function URLs — from your `twilio serverless:deploy` output.

If you are using **mode preservation**, verify a Map like `this.transferModes` is present and that keys match the task/queue pair used later to replay the transfer.

---

## Deploy

```bash
twilio flex:plugins:deploy --major --changelog "BPO Assignment update"
twilio flex:plugins:release \
  --plugin bpo-assignment-plugin@X.Y.Z \
  --name "BPO Assignment" \
  --description "Attribution transfer flow"
```

---

## How It Works (Key Hooks)

- **overrideTransferTask()**
  - Skip interception if the task channel is the attribution channel (e.g., `bpo_assortment`) or target is **not** a Queue.
  - Otherwise call `create-attribution-task` with:
    - Original `task.sid` and `task.taskSid`
    - Original attributes
    - Target Queue SID
    - Optional affiliation tag (e.g., round‑robin among `BPO_A/B/C`)
  - Optionally cache `options.mode` (`WARM`, `COLD`) per `(taskSid:queueSid)`.

- **registerTaskUpdatedListener()**
  - On `reservationCreated`, attach `task.on('updated')`.
  - When attributes include `transferTo` (and status is `assigned`), invoke `TransferTask` again using:
    - The right Flex `ITask` (resolve via `TaskHelper.getTaskByTaskSid(reservation.sid)`).
    - The recorded `mode` if cached, defaulting to `WARM`.
  - Clear `transferTo` to avoid loops.

- **wrapAcceptTask()**
  - Only for attribution tasks (special channel).
  - Calls `transfer-task` function to resume the original transfer.
  - Accepts the attribution task in UI, then completes it.

- **Notifications**
  - Registers a `TransferFailed` error notification to inform agents on failures.

---

## Testing

- **Queue transfer**: Should be intercepted, attribution task created, then original task re‑transferred to the queue after attribution accept.
- **Worker transfer**: Not intercepted (target is a Worker SID, not a Queue).
- **Failure path**: Simulate function errors; plugin should show notification and avoid loops.

---

## Tips

- Clean up caches (e.g., `this.transferModes.delete(key)`) after a successful replay.
- Ensure attribution channel name (e.g., `bpo_assortment`) matches serverless logic.
- Use `console.log` generously; Flex devtools show plugin logs.

---

## References

- Flex Plugins: https://www.twilio.com/docs/flex/developer/plugins
- Flex Actions Framework: https://www.twilio.com/docs/flex/developer/ui/actions-framework