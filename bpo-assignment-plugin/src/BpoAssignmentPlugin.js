import * as FlexPlugin from '@twilio/flex-plugin';
import { FlexPlugin as BaseFlexPlugin } from '@twilio/flex-plugin';
import { Actions } from '@twilio/flex-ui';
import * as Flex from '@twilio/flex-ui';

const ATTRIBUTION_WORKFLOW_SID = 'WW69d6e646b4e937450439e4527eb4c8d6';
const CREATE_TASK_FUNCTION_URL = 'https://transfer-to-workflow-4057.twil.io/create-attribution-task';

class BpoAssignmentPlugin extends BaseFlexPlugin {
  constructor() {
    super('BpoAssignmentPlugin');
    this.originalTransferRequests = new Map();
    this.affiliationToggle = 0;
  }

  init(_flex, manager) {
    console.log('[BPO Plugin] Initializing BpoAssignmentPlugin...');
    this.overrideTransferTask();
    this.registerTaskUpdatedListener(manager);
  }

  overrideTransferTask() {
    Actions.replaceAction('TransferTask', async (payload, _original) => {
      const { sid, targetSid, options } = payload;
      const task = Flex.TaskHelper.getTaskByTaskSid(sid);
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
            sid: task.sid, // reservation SID
            taskSid: task.taskSid, // actual task SID (for back end purposes)
            attributes: originalAttributes,
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

      // Attach a listener to the task's `updated` event
      task.on('updated', updatedTask => {
        const attrs = updatedTask.attributes || {};
        const transferTo = attrs.transferTo;

        console.log('[BPO Plugin] task.updated triggered');
        console.log(' - Task SID:', updatedTask.sid);
        console.log(' - Reservation SID:', reservation.sid);
        console.log(' - Task Attributes:', attrs);
        console.log(' - transferTo:', transferTo);

        if (transferTo) {
          console.log('[BPO Plugin] Triggering TransferTask to:', transferTo);

            try {
            console.log('[BPO Plugin] Invoking TransferTask action for task SID:', updatedTask.sid, 'to target SID:', transferTo);
            Actions.invokeAction('TransferTask', {
              task: updatedTask,
              targetSid: transferTo, // worker sid, queue sid, or workflow sid
              options: { mode: 'WARM' }
            });
            console.log('[BPO Plugin] TransferTask action invoked successfully for task SID:', updatedTask.sid);
            } catch (error) {
            console.error('[BPO Plugin] Error invoking TransferTask action for task SID:', updatedTask.sid, error);
            }
        }
      });


    });

  }

  getNextAffiliation() {
    const options = ['BPO_A', 'BPO_B', 'BPO_C'];
    const aff = options[this.affiliationToggle % options.length];
    this.affiliationToggle++;
    return aff;
  }
}

FlexPlugin.loadPlugin(BpoAssignmentPlugin);
export default BpoAssignmentPlugin;
