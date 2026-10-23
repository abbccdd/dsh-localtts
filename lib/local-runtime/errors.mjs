export class RuntimeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
