// Unicode code points, not UTF-16 units. Never merge adjacent sentences.
// Visual separators are layout, not speech. Replace them with whitespace so
// engines never pronounce Chinese em dashes or Markdown horizontal rules.
export function cleanSpeechText(text) {
  return String(text || '')
    .replace(/^\s*(?:[-*_~—―─━⸺⸻]\s*){3,}\s*$/gmu, ' ')
    .replace(/[—―─━⸺⸻]+/gu, ' ');
}

export class SentenceBuffer {
  constructor() { this.buffer = ''; }
  feed(text) { this.buffer = cleanSpeechText(this.buffer + String(text || '')); return this.drain(false); }
  flush() { return this.drain(true); }
  drain(final) {
    const out = [];
    while (this.buffer) {
      const chars = Array.from(this.buffer);
      let cut = 0;
      for (let i = 0; i < Math.min(chars.length, 70); i++) {
        const ch = chars[i];
        if ('。！？!?'.includes(ch) || (ch === '.' &&
            (i + 1 < chars.length || final) &&
            !(/[0-9]/.test(chars[i - 1] || '') && /[0-9]/.test(chars[i + 1] || '')))) {
          cut = i + 1; break;
        }
        if (i >= 54 && '，；：,;:'.includes(ch)) { cut = i + 1; break; }
      }
      if (!cut && chars.length >= 70) {
        cut = 70;
        for (let i = 69; i >= 54; i--) {
          if (/\s/.test(chars[i])) { cut = i + 1; break; }
        }
      }
      if (!cut && final) cut = chars.length;
      if (!cut) break;
      const text = chars.slice(0, cut).join('').replace(/\s+/g, ' ').trim();
      this.buffer = chars.slice(cut).join('').trimStart();
      if (text && /[\p{L}\p{N}\p{S}]/u.test(text)) out.push(text);
    }
    return out;
  }
}

export function sentences(text) {
  const buffer = new SentenceBuffer();
  return [...buffer.feed(text), ...buffer.flush()];
}
