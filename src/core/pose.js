export const MAX_POSE_AGE_MS = 150;

// SDK image landmarks only. World/depth coordinates and display mirroring are
// deliberately excluded. Confidence gates tracking, never reachability/capture.
export function normalizePose(result, at) {
  const lost = reason => ({ tracked: false, reason, at });
  if (!Number.isFinite(at) || at < 0 || !Array.isArray(result?.landmarks)) return lost('invalid_pose');
  if (result.landmarks.length === 0) return lost('no_person');
  if (result.landmarks.length !== 1) return lost('multiple_people');
  const landmarks = result.landmarks[0];
  if (!Array.isArray(landmarks) || landmarks.length !== 33) return lost('invalid_pose');
  const wrists = {};
  for (const [joint, index] of [['leftWrist', 15], ['rightWrist', 16]]) {
    const point = landmarks[index];
    if (!point || ![point.x, point.y, point.visibility].every(Number.isFinite) ||
        point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1 ||
        point.visibility < 0 || point.visibility > 1) return lost('invalid_pose');
    if (point.visibility < 0.8) return lost('occluded');
    wrists[joint] = { joint, x: point.x, y: point.y, confidence: point.visibility, at };
  }
  return { tracked: true, at, wrists };
}

export function isFreshPoseTime(at, now, previous = null) {
  return Number.isFinite(at) && at >= 0 && Number.isFinite(now) && now >= at &&
    now - at <= MAX_POSE_AGE_MS && (previous === null || at > previous);
}
