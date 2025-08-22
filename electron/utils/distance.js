export function chebyshevDistance(pos1, pos2) {
  return Math.max(Math.abs(pos1.x - pos2.x), Math.abs(pos1.y - pos2.y));
}

export function calculateDistance(pos1, pos2) {
  if (!pos1 || !pos2) return Infinity;
  const dx = pos1.x - pos2.x;
  const dy = pos1.y - pos2.y;
  const dz = pos1.z - pos2.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
