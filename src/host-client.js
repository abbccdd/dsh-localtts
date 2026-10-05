// Public message selectors differ across Harness 0.1 and 0.2. Keep that
// distinction at this boundary; playback and sentence logic share one path.
const EMPTY_HOST_MESSAGES = Object.freeze([]);
const hostMessageCapability = { supported: true };
function selectHostMessageSnapshot(snapshot) {
  if (snapshot == null) return EMPTY_HOST_MESSAGES;
  const nodes = snapshot.legacy?.nodes ?? snapshot.nodes;
  hostMessageCapability.supported = Array.isArray(nodes);
  return hostMessageCapability.supported ? nodes : EMPTY_HOST_MESSAGES;
}
function useHostMessages(props) {
  if (typeof props.useChat === 'function') return props.useChat(selectHostMessageSnapshot) || EMPTY_HOST_MESSAGES;
  if (typeof props.useSession === 'function') return props.useSession(selectHostMessageSnapshot) || EMPTY_HOST_MESSAGES;
  return selectHostMessageSnapshot(props.session);
}
