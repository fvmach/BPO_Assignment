exports.handler = async function (context, event, callback) {
  const client = context.getTwilioClient();
  const response = new Twilio.Response();

  // --- CORS Headers ---
  const requestOrigin = event.headers?.origin || '';
  const allowedOrigins = ['http://localhost:3000', 'https://flex.twilio.com'];
  const allowOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : '*';

  response.appendHeader('Access-Control-Allow-Origin', allowOrigin);
  response.appendHeader('Access-Control-Allow-Methods', 'OPTIONS, POST');
  response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.appendHeader('Access-Control-Allow-Credentials', 'true');
  response.appendHeader('Content-Type', 'application/json');

  // --- Preflight ---
  if (event.httpMethod === 'OPTIONS') {
    console.log('[transfer-task] CORS preflight response sent');
    response.setStatusCode(204);
    return callback(null, response);
  }

  // --- Raw Incoming Payload Logging ---
  console.log('[transfer-task] RAW incoming event:', JSON.stringify(event));

  // --- Validation Logging ---
  let validationErrors = [];
  if (!event.attributionTaskSid) validationErrors.push('Missing attributionTaskSid');
  if (!event.receivingWorkerSid) validationErrors.push('Missing receivingWorkerSid');
  if (!event.transfer_task) validationErrors.push('Missing transfer_task');
  if (event.transfer_task && !event.transfer_task.taskSid) validationErrors.push('Missing transfer_task.taskSid');
  if (event.transfer_task && !event.transfer_task.attributes) validationErrors.push('Missing transfer_task.attributes');

  if (validationErrors.length > 0) {
    console.warn('[transfer-task] Validation failed:', validationErrors.join('; '));
    response.setStatusCode(400);
    response.setBody({ success: false, error: 'Validation error', details: validationErrors });
    return callback(null, response);
  }

  try {
    const { attributionTaskSid, receivingWorkerSid, transfer_task } = event;
    console.log('[transfer-task] All required fields present.');
    console.log('[transfer-task] attributionTaskSid:', attributionTaskSid);
    console.log('[transfer-task] receivingWorkerSid:', receivingWorkerSid);
    console.log('[transfer-task] transfer_task:', transfer_task);

    const originalTaskSid = transfer_task.taskSid;
    const originalAttributes = transfer_task.attributes;

    // --- Attributes Mutation Logging ---
    const updatedAttributes = {
      ...originalAttributes,
      transferTo: receivingWorkerSid,
    };
    console.log('[transfer-task] Updating task', originalTaskSid, 'with new attributes:', updatedAttributes);

    const result = await client.taskrouter.v1
      .workspaces(context.TWILIO_WORKSPACE_SID)
      .tasks(originalTaskSid)
      .update({
        attributes: JSON.stringify(updatedAttributes),
      });

    console.log('[transfer-task] Successfully updated original task SID:', result.sid);

    response.setStatusCode(200);
    response.setBody({ success: true, updated: true, taskSid: result.sid });
    return callback(null, response);

  } catch (err) {
    console.error('[transfer-task] Error during task update:', {
      message: err.message,
      stack: err.stack,
      event
    });

    response.setStatusCode(500);
    response.setBody({
      success: false,
      error: 'Failed to update original task with transferTo',
      details: err.message,
    });
    return callback(null, response);
  }
};
