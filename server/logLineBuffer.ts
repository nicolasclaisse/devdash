import { StringDecoder } from 'node:string_decoder'

/** Reassemble a single stdout or stderr stream before persisting or broadcasting log lines. */
export class LogLineBuffer {
  private decoder = new StringDecoder('utf8')
  private pending = ''

  constructor(private onLine: (line: string) => void) {}

  write(chunk: Buffer): void {
    this.pending += this.decoder.write(chunk)
    let newline: number
    while ((newline = this.pending.indexOf('\n')) !== -1) {
      const line = this.pending.slice(0, newline)
      this.pending = this.pending.slice(newline + 1)
      this.onLine(line)
    }
  }

  /** Preserve the last line even when the process exits without a trailing newline. */
  end(): void {
    this.pending += this.decoder.end()
    const line = this.pending
    this.pending = ''
    if (line) this.onLine(line)
  }
}
