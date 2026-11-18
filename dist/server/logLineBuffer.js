import { StringDecoder } from 'node:string_decoder';
/** Reassemble a single stdout or stderr stream before persisting or broadcasting log lines. */
export class LogLineBuffer {
    onLine;
    decoder = new StringDecoder('utf8');
    pending = '';
    constructor(onLine) {
        this.onLine = onLine;
    }
    write(chunk) {
        this.pending += this.decoder.write(chunk);
        let newline;
        while ((newline = this.pending.indexOf('\n')) !== -1) {
            const line = this.pending.slice(0, newline);
            this.pending = this.pending.slice(newline + 1);
            this.onLine(line);
        }
    }
    /** Preserve the last line even when the process exits without a trailing newline. */
    end() {
        this.pending += this.decoder.end();
        const line = this.pending;
        this.pending = '';
        if (line)
            this.onLine(line);
    }
}
