/** Retain a bounded suffix so an upstream key split across transport chunks is never forwarded. */
export class RelayStreamRedactor {
  private pending = "";
  private readonly secrets: string[];
  private readonly retainedLength: number;

  constructor(secrets: readonly string[]) {
    this.secrets = [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length);
    this.retainedLength = Math.max(0, ...this.secrets.map((secret) => secret.length - 1));
  }

  push(text: string, final = false): string {
    this.pending += text;
    const limit = final ? this.pending.length : this.pending.length - this.retainedLength;
    let output = "", offset = 0;
    while (offset < limit) {
      const matched = this.secrets.find((secret) => this.pending.startsWith(secret, offset));
      if (matched) {
        output += "[đã ẩn]";
        offset += matched.length;
      } else {
        const point = this.pending.codePointAt(offset)!;
        if (!final && point >= 0xd800 && point <= 0xdbff && offset === this.pending.length - 1) break;
        output += String.fromCodePoint(point);
        offset += point > 0xffff ? 2 : 1;
      }
    }
    this.pending = this.pending.slice(offset);
    return output;
  }
}
