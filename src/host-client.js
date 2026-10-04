// Public message selectors differ across Harness 0.1 and 0.2. Keep that
// distinction at this boundary; playback and sentence logic share one path.
const EMPTY_HOST_MESSAGES = Object.freeze([]);
function useHostMessages(props) {
  if (props.useChat) return props.useChat(snapshot => snapshot.legacy.nodes);
  if (props.useSession) return props.useSession(snapshot => snapshot.nodes) || EMPTY_HOST_MESSAGES;
  return props.session?.nodes || EMPTY_HOST_MESSAGES;
}
