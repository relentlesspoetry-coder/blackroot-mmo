// Transport readiness only. Loading never pauses the authoritative simulation.
export const SCENE_LOAD_TIMEOUT_MS = 120000;

export function sceneLoading(ws) {
  return !!ws.sceneLoad && !ws.sceneLoad.ready;
}

export function beginSceneLoad(ws, zoneId, token, now = Date.now()) {
  // A further transition cannot extend an already pending loading deadline.
  const deadline = sceneLoading(ws) ? ws.sceneLoad.deadline : now + SCENE_LOAD_TIMEOUT_MS;
  const generation = (ws.sceneGeneration || 0) + 1;
  ws.sceneGeneration = generation;
  ws.sceneLoad = { zoneId, token, generation, deadline, ready: false, needsSnapshot: false };
  return { zoneId, token, generation };
}

export function acceptSceneReady(ws, message, zoneId, now = Date.now()) {
  const load = ws.sceneLoad;
  if (!sceneLoading(ws) || now >= load.deadline || load.zoneId !== zoneId ||
      message.zoneId !== load.zoneId || message.token !== load.token ||
      message.generation !== load.generation) return false;
  load.ready = true; load.needsSnapshot = true;
  // This authenticated acknowledgement is also fresh evidence of liveness.
  ws.isAlive = true;
  return true;
}

export function heartbeatExpired(ws, now = Date.now()) {
  // Scene construction may stall browser pong processing. Only an authenticated,
  // server-issued load gets this bounded grace; the ordinary heartbeat remains.
  if (ws.joined && sceneLoading(ws)) return now >= ws.sceneLoad.deadline;
  return !ws.isAlive || (!ws.joined && now - ws.connectedAt > 15000);
}
