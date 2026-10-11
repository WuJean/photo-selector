/** Keep original order while gathering similar frames into one comparison unit. */
export function immersiveGroups(photos) {
  const members = new Map();
  for (const photo of photos) {
    const key = photo.similarId || photo.id;
    if (!members.has(key)) members.set(key, []);
    members.get(key).push(photo);
  }
  const seen = new Set(),
    groups = [];
  for (const photo of photos) {
    const key = photo.similarId || photo.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const items = members.get(key);
    groups.push({
      id: key,
      kind: items.length > 1 ? "similar" : "single",
      photos: items,
    });
  }
  return groups;
}
export function zoomAround(current, next, point) {
  const zoom = Math.min(8, Math.max(1, next));
  if (zoom === 1) return { zoom: 1, x: 0, y: 0 };
  const ratio = zoom / current.zoom;
  return {
    zoom,
    x: point.x - (point.x - current.x) * ratio,
    y: point.y - (point.y - current.y) * ratio,
  };
}
