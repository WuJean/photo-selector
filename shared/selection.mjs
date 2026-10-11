export function selectPhoto(
  state,
  id,
  visible,
  { toggle = false, shift = false, append = false } = {},
) {
  const allowed = new Set(visible),
    selected = state.selected.filter((v) => allowed.has(v));
  if (!allowed.has(id)) return { ...state, selected };
  if (shift && allowed.has(state.anchor)) {
    const a = visible.indexOf(state.anchor),
      b = visible.indexOf(id),
      range = visible.slice(Math.min(a, b), Math.max(a, b) + 1);
    return {
      anchor: state.anchor,
      selected: append ? [...new Set([...selected, ...range])] : range,
    };
  }
  return {
    anchor: id,
    selected: toggle
      ? selected.includes(id)
        ? selected.filter((v) => v !== id)
        : [...selected, id]
      : [id],
  };
}
export function nextAfterDecision(visible, selected) {
  const chosen = new Set(selected),
    last = Math.max(-1, ...selected.map((id) => visible.indexOf(id)));
  return (
    visible.slice(last + 1).find((id) => !chosen.has(id)) ||
    visible
      .slice(0, last)
      .reverse()
      .find((id) => !chosen.has(id)) ||
    ""
  );
}
