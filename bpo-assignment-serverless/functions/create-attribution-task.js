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
    console.log('[create-attribution-task] CORS preflight response sent');
    response.setStatusCode(204);
    return callback(null, response);
  }

  try {
    // --- Input validation (event already contains parsed JSON) ---
    const { workflowSid, taskAttributes } = event;

    console.log('[create-attribution-task] Incoming request:', {
      workflowSid,
      taskAttributes,
      taskQueueSid: taskAttributes?.transfer_task?.targetSid,
    });

    if (!workflowSid || !taskAttributes) {
      response.setStatusCode(400);
      response.setBody({ success: false, error: 'Missing workflowSid or taskAttributes' });
      return callback(null, response);
    }

    // --- Task Creation ---
    const task = await client.taskrouter
      .workspaces(context.TWILIO_WORKSPACE_SID)
      .tasks.create({
        workflowSid,
        taskChannel: 'bpo_assortment',
        attributes: JSON.stringify(taskAttributes),
      });

    console.log('[create-attribution-task] Task created:', task.sid);

    response.setStatusCode(201);
    response.setBody({ success: true, taskSid: task.sid });
    return callback(null, response);
  } catch (err) {
    console.error('[create-attribution-task] Error:', err);
    response.setStatusCode(500);
    response.setBody({ success: false, error: 'Task creation failed', details: err.message });
    return callback(null, response);
  }
};
