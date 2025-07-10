import * as FlexPlugin from '@twilio/flex-plugin';
import { FlexPlugin as BaseFlexPlugin } from '@twilio/flex-plugin';
import { Actions, Notifications } from '@twilio/flex-ui';
import * as Flex from '@twilio/flex-ui';

const ATTRIBUTION_WORKFLOW_SID = 'WW69d6e646b4e937450439e4527eb4c8d6';
const CREATE_TASK_FUNCTION_URL = 'https://transfer-to-workflow-4057.twil.io/create-attribution-task';
const TRANSFER_TASK_FUNCTION_URL = 'https://transfer-to-workflow-4057.twil.io/transfer-task';

class BpoAssignmentPlugin extends BaseFlexPlugin {
  constructor() {
    super('BpoAssignmentPlugin');
    this.originalTransferRequests = new Map();
    this.affiliationToggle = 0;
    this.transferTriggered = new Set();
  }

  init(_flex, manager) {
    console.log('[BPO Plugin] Initializing BpoAssignmentPlugin...');
    this.overrideTransferTask();
    this.registerTaskUpdatedListener(manager);
    this.wrapAcceptTask();
    this.registerNotifications();
  }

  overrideTransferTask() {
    Actions.replaceAction('TransferTask', async (payload, original) => {
      const { sid, targetSid, options } = payload;
      const task = Flex.TaskHelper.getTaskByTaskSid(sid);

      if (!task) {
        console.error('[BPO Plugin] Could not resolve task for TransferTask:', sid);
        return original(payload);
      }

      // 🚨 Only intercept if this is NOT an attribution task and targetSid is a QUEUE SID (starts with WQ)
      if (
        task.taskChannelUniqueName === 'bpo_assortment' || !targetSid.startsWith('WQ')
      ) {
        console.log('[BPO Plugin] Skipping attribution task transfer interception. (Either bpo_assortment or not a queue transfer)');
        return original(payload);
      }

      const originalAttributes = task.attributes;

      console.log('[BPO Plugin] Intercepted TransferTask:');
      console.log(' - Task SID:', sid);
      console.log(' - Target SID:', targetSid);
      console.log(' - Mode:', options?.mode);

      this.originalTransferRequests.set(sid, { sid, targetSid, options });

      const affiliation = this.getNextAffiliation();
      console.log('[BPO Plugin] Simulated affiliation:', affiliation);

      const attributionPayload = {
        workflowSid: ATTRIBUTION_WORKFLOW_SID,
        taskAttributes: {
          affiliation,
          transfer_task: {
            sid: task.sid,
            taskSid: task.taskSid,
            attributes: originalAttributes,
            targetSid: targetSid,
          },
        },
      };

      console.log('[BPO Plugin] Sending request to create attribution task:', attributionPayload);

      try {
        const res = await fetch(CREATE_TASK_FUNCTION_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(attributionPayload),
        });

        if (!res.ok) {
          const body = await res.text();
          console.error('[BPO Plugin] Attribution task creation failed with status:', res.status);
          console.error('[BPO Plugin] Response body:', body);
        } else {
          const result = await res.json();
          console.log('[BPO Plugin] Attribution task created successfully:', result);
        }
      } catch (err) {
        console.error('[BPO Plugin] Failed to create attribution task:', err);
      }
    });
  }


  registerTaskUpdatedListener(manager) {
    manager.workerClient.on('reservationCreated', reservation => {
      const task = reservation.task;
      if (!task) return;

      console.log('[BPO Plugin] reservationCreated:', task.sid);

      task.on('updated', async updatedTask => {
        const attrs = updatedTask.attributes || {};
        const transferTo = attrs.transferTo;
        const isAssortment = updatedTask.taskChannelUniqueName === 'bpo_assortment';
        const transferKey = `${updatedTask.sid}:${transferTo}`;

        console.log('[BPO Plugin] task.updated triggered');
        console.log(' - Task SID:', updatedTask.sid);
        console.log(' - Reservation SID:', reservation.sid);
        console.log(' - Task Attributes:', attrs);
        console.log(' - transferTo:', transferTo);

        // Only proceed if we haven't already triggered for this transfer target
        if (transferTo && !isAssortment) {
          if (!this.transferTriggered.has(transferKey)) {
            this.transferTriggered.add(transferKey); // Mark early to prevent race

            if (updatedTask.status !== "assigned") {
              console.warn("[BPO Plugin] Not transferring: Task status is not assigned:", updatedTask.status);
              return;
            }

            try {
              // Use the reservation.sid to get the right ITask in Flex UI
              const flexTask = Flex.TaskHelper.getTaskByTaskSid(reservation.sid);

              if (!flexTask) {
                console.warn('[BPO Plugin] Could not resolve Flex task for transfer:', reservation.sid);
                return;
              }

              console.log('[BPO Plugin] Invoking TransferTask action for task SID:', flexTask.sid, 'to target SID:', transferTo);

              await Actions.invokeAction('TransferTask', {
                task: flexTask,
                targetSid: transferTo,
                options: { mode: 'WARM' }, // Can parameterize mode if needed
              });

              console.log('[BPO Plugin] TransferTask action invoked successfully for task SID:', flexTask.sid);

              // Clean up transferTo attribute to prevent re-triggering
              const cleanedAttributes = { ...attrs };
              delete cleanedAttributes.transferTo;

              try {
                await Actions.invokeAction('SetTaskAttributes', {
                  sid: updatedTask.sid,
                  attributes: cleanedAttributes,
                });
                console.log('[BPO Plugin] Cleared transferTo attribute on task:', updatedTask.sid);
              } catch (err) {
                console.warn('[BPO Plugin] Failed to clear transferTo attribute:', err);
              }
            } catch (error) {
              console.error('[BPO Plugin] Error invoking TransferTask action for task SID:', updatedTask.sid, error);
            }
          } else {
            // For visibility
            console.log("[BPO Plugin] TransferTask already triggered for this Task/Target, skipping.");
          }
        }
      });
    });
  }


  wrapAcceptTask() {
    console.log('[BPO Plugin] Registering AcceptTask wrapper...');

    Actions.replaceAction('AcceptTask', async (payload, original) => {
      console.log('[BPO Plugin] AcceptTask invoked with payload:', payload);

      const task = payload.task || Flex.TaskHelper.getTaskByTaskSid(payload.sid);
      console.log('[BPO Plugin] Resolved task:', task);

      if (!task) {
        console.error('[BPO Plugin] No task found in AcceptTask payload:', payload);
        return original(payload);
      }

      const { taskChannelUniqueName, attributes = {}, sid: attributionTaskSid } = task;
      console.log('[BPO Plugin] taskChannelUniqueName:', taskChannelUniqueName);
      console.log('[BPO Plugin] attributes:', attributes);

      if (taskChannelUniqueName !== 'bpo_assortment') {
        console.log('[BPO Plugin] Task is not of type "bpo_assortment". Skipping attribution logic.');
        return original(payload);
      }

      if (!attributes.transfer_task) {
        console.log('[BPO Plugin] Task is "bpo_assortment" but missing transfer_task. Skipping attribution logic.');
        return original(payload);
      }

      const { transfer_task } = attributes;
      const receivingWorkerSid = Flex.Manager.getInstance().workerClient?.sid;

      console.log('[BPO Plugin] receivingWorkerSid:', receivingWorkerSid);
      console.log('[BPO Plugin] transfer_task payload:', transfer_task);

      if (!transfer_task?.taskSid || !transfer_task?.attributes) {
        console.error('[BPO Plugin] Malformed transfer_task payload:', transfer_task);
        return original(payload);
      }

      const requestBody = {
        attributionTaskSid,
        receivingWorkerSid,
        transfer_task,
      };

      console.log('[BPO Plugin] AcceptTask intercepted for attribution task. Invoking transfer-task function with payload:', requestBody);

      try {
        const res = await fetch(TRANSFER_TASK_FUNCTION_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        const result = await res.json();
        console.log('[BPO Plugin] Response from transfer-task function:', result);

        if (!res.ok || !result.success) {
          console.error('[BPO Plugin] Transfer-task function failed:', result);
          throw new Error(result.error || 'Transfer-task function failed');
        }

        console.log('[BPO Plugin] Transfer-task succeeded. Proceeding to accept and complete attribution task...');

        // Accept the attribution task in UI (let Flex finish the accept process)
        await original(payload);

        // Mark attribution task complete so Worker B is available for the original call
        try {
          await Actions.invokeAction('CompleteTask', { sid: attributionTaskSid });
          console.log('[BPO Plugin] Attribution task marked complete.');
        } catch (completeErr) {
          console.warn('[BPO Plugin] Failed to complete attribution task (possibly already completed):', completeErr);
        }

      } catch (err) {
        console.error('[BPO Plugin] Failed to process attribution task transfer:', err);
        Flex.Notifications.showNotification('TransferFailed', {
          message: 'Could not transfer task. Please try again.',
        });
      }
    });
  }

  getNextAffiliation() {
    const options = ['BPO_A', 'BPO_B', 'BPO_C'];
    const aff = options[this.affiliationToggle % options.length];
    this.affiliationToggle++;
    return aff;
  }

  registerNotifications() {
    // Avoid duplicate registration by checking if already registered
    if (!Notifications.notifications || !Notifications.notifications.TransferFailed) {
      Notifications.registerNotification({
        id: 'TransferFailed',
        type: 'error',
        content: 'Transfer failed. Please try again or contact a supervisor.',
        timeout: 4000,
      });
    }
  }
}

FlexPlugin.loadPlugin(BpoAssignmentPlugin);
export default BpoAssignmentPlugin;
