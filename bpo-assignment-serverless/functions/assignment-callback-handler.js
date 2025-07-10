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
    console.log('[handle-attribution-assignment-callback] CORS preflight response sent');
    response.setStatusCode(204);
    return callback(null, response);
  }

  
  try {
    const {
      TaskSid: attributionTaskSid,
      WorkerSid: receivingWorkerSid,
      TaskAttributes
    } = event;

    console.log('[handle-attribution-assignment-callback] Received event:', {
      attributionTaskSid,
      receivingWorkerSid,
      rawTaskAttributes: TaskAttributes
    });

    if (!attributionTaskSid || !receivingWorkerSid || !TaskAttributes) {
      console.warn('[handle-attribution-assignment-callback] Missing required fields');
      response.setStatusCode(400);
      response.setBody({
        success: false,
        error: 'Missing TaskSid, WorkerSid, or TaskAttributes in event',
      });
      return callback(null, response);
    }

    const attributes = JSON.parse(TaskAttributes);
    console.log('[handle-attribution-assignment-callback] Parsed attributes:', attributes);

    const transferringTaskSid = attributes.transfer_task?.taskSid;
    const originalAttributes = attributes.originalTaskAttributes;

    if (!transferringTaskSid) {
      console.warn('[handle-attribution-assignment-callback] No transferringTaskSid found in transfer_task');
      response.setStatusCode(400);
      response.setBody({
        success: false,
        error: 'transferringTaskSid not found in attribution task attributes',
      });
      return callback(null, response);
    }

    const updatedAttributes = {
      ...originalAttributes,
      transferTo: receivingWorkerSid,
    };

    console.log('[handle-attribution-assignment-callback] Updating transferring task SID:', transferringTaskSid);
    console.log('[handle-attribution-assignment-callback] New attributes:', updatedAttributes);

    const result = await client.taskrouter
      .workspaces(context.TWILIO_WORKSPACE_SID)
      .tasks(transferringTaskSid)
      .update({ attributes: JSON.stringify(updatedAttributes) });

    console.log('[handle-attribution-assignment-callback] Task updated successfully:', result.sid);

    response.setStatusCode(200);
    response.setBody({ success: true, updated: true });
    return callback(null, response);
  } catch (err) {
    console.error('[handle-attribution-assignment-callback] Error during update:', err);
    response.setStatusCode(500);
    response.setBody({
      success: false,
      error: 'Failed to update transferring task',
      details: err.message,
    });
    return callback(null, response);
  }
};
