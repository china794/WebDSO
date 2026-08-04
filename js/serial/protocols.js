/**
 * Serial protocol parsers.
 * Supports JustFloat binary frames, FireWater text, CSV, and JSON Lines.
 */

const JUSTFLOAT_SYNC = [0x00, 0x00, 0x80, 0x7F];
const MAX_TEXT_BUFFER_LENGTH = 65536;

/**
 * Find the JustFloat sync marker (00 00 80 7F) in a byte array.
 * @param {Uint8Array} buffer
 * @param {number} start
 * @returns {number}
 */
export function findSyncInArray(buffer, start) {
    for (let i = start; i <= buffer.length - JUSTFLOAT_SYNC.length; i++) {
        let matched = true;
        for (let j = 0; j < JUSTFLOAT_SYNC.length; j++) {
            if (buffer[i + j] !== JUSTFLOAT_SYNC[j]) {
                matched = false;
                break;
            }
        }
        if (matched) return i;
    }
    return -1;
}

/**
 * Convert little-endian IEEE-754 bytes to float values.
 * @param {Uint8Array} b
 * @returns {number[]}
 */
export function bytesToFloats(b) {
    try {
        const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
        const f = [];
        for (let i = 0; i + 4 <= b.length; i += 4) {
            f.push(v.getFloat32(i, true));
        }
        return f;
    } catch (error) {
        return [];
    }
}

/**
 * Append a decoded text chunk to the pending text buffer.
 * Uses the shared TextDecoder in streaming mode so multi-byte UTF-8
 * split across serial chunks is preserved. Caps the buffer length so a
 * device sending an endless line cannot grow memory unbounded.
 * @param {string} textBuffer
 * @param {Uint8Array} data
 * @param {TextDecoder} decoder
 * @returns {string}
 */
function appendTextChunk(textBuffer, data, decoder) {
    let str = '';
    try {
        str = decoder.decode(data, { stream: true });
    } catch (e) {
        // Fall back to a fresh decoder if the shared one lost its state.
        str = new TextDecoder().decode(data, { stream: true });
    }
    let buf = textBuffer + str;
    if (buf.length > MAX_TEXT_BUFFER_LENGTH) {
        buf = buf.slice(-MAX_TEXT_BUFFER_LENGTH);
    }
    return buf;
}

function getSyncPrefixTailLength(buffer) {
    const maxTail = Math.min(JUSTFLOAT_SYNC.length - 1, buffer.length);
    for (let len = maxTail; len > 0; len--) {
        let matches = true;
        for (let i = 0; i < len; i++) {
            if (buffer[buffer.length - len + i] !== JUSTFLOAT_SYNC[i]) {
                matches = false;
                break;
            }
        }
        if (matches) return len;
    }
    return 0;
}

function parseNumberField(value) {
    if (value === null || value === undefined || value === '') return undefined;
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function hasAnyValue(values) {
    return values.some(value => value !== undefined);
}

/**
 * Parse JustFloat binary frames. The returned buffer is the unconsumed tail.
 * @param {Uint8Array} data
 * @param {Uint8Array} linearBuffer
 * @param {Function} onFrame
 * @returns {Uint8Array}
 */
export function parseJustFloat(data, linearBuffer, onFrame) {
    const newBuffer = new Uint8Array(linearBuffer.length + data.length);
    newBuffer.set(linearBuffer, 0);
    newBuffer.set(data, linearBuffer.length);
    linearBuffer = newBuffer;

    if (linearBuffer.length > 1048576) {
        linearBuffer = linearBuffer.slice(-1048576);
    }

    let offset = 0;
    while (offset + JUSTFLOAT_SYNC.length * 2 <= linearBuffer.length) {
        const s1 = findSyncInArray(linearBuffer, offset);
        if (s1 === -1) {
            const tailLength = getSyncPrefixTailLength(linearBuffer);
            return tailLength > 0 ? linearBuffer.slice(linearBuffer.length - tailLength) : new Uint8Array(0);
        }
        if (s1 > offset) {
            offset = s1;
            continue;
        }

        const s2 = findSyncInArray(linearBuffer, offset + JUSTFLOAT_SYNC.length);
        if (s2 === -1) break;

        const payloadStart = offset + JUSTFLOAT_SYNC.length;
        const payloadLength = s2 - payloadStart;
        if (payloadLength > 0 && payloadLength % 4 === 0) {
            onFrame(bytesToFloats(linearBuffer.slice(payloadStart, s2)));
        }
        offset = s2;
    }

    if (offset >= linearBuffer.length) return new Uint8Array(0);

    const pendingSync = findSyncInArray(linearBuffer, offset);
    if (pendingSync !== -1) return linearBuffer.slice(pendingSync);

    const tailLength = getSyncPrefixTailLength(linearBuffer.subarray(offset));
    return tailLength > 0 ? linearBuffer.slice(linearBuffer.length - tailLength) : new Uint8Array(0);
}

/**
 * Parse FireWater text protocol.
 * @param {Uint8Array} data
 * @param {string} textBuffer
 * @param {TextDecoder} decoder
 * @param {Function} onFrame
 * @returns {string}
 */
export function parseFireWater(data, textBuffer, decoder, onFrame) {
    textBuffer = appendTextChunk(textBuffer, data, decoder);
    const lines = textBuffer.split(/\r?\n/);
    textBuffer = lines.pop();

    for (const l of lines) {
        let s = l.trim();
        if (!s) continue;
        if (s.includes(':')) s = s.split(':')[1];
        const v = s.split(',').map(p => parseNumberField(p.trim()));
        if (hasAnyValue(v)) onFrame(v);
    }
    return textBuffer;
}

/**
 * Parse CSV while preserving empty channel positions.
 */
export function parseCSV(data, textBuffer, decoder, onFrame) {
    textBuffer = appendTextChunk(textBuffer, data, decoder);
    const lines = textBuffer.split(/\r?\n/);
    textBuffer = lines.pop();

    for (const l of lines) {
        const s = l.trim();
        if (!s || s.startsWith('#') || s.startsWith('//')) continue;
        const v = s.split(',').map(p => parseNumberField(p.trim()));
        if (hasAnyValue(v)) onFrame(v);
    }
    return textBuffer;
}

/**
 * Parse JSON Lines. Supports [ch1, ch2] and {"ch1": value, "ch2": value}.
 */
export function parseJSONLines(data, textBuffer, decoder, onFrame) {
    textBuffer = appendTextChunk(textBuffer, data, decoder);
    const lines = textBuffer.split(/\r?\n/);
    textBuffer = lines.pop();

    for (const l of lines) {
        const s = l.trim();
        if (!s) continue;
        try {
            const parsed = JSON.parse(s);
            let values = [];
            if (Array.isArray(parsed)) {
                values = parsed.map(parseNumberField);
            } else if (typeof parsed === 'object' && parsed !== null) {
                values = new Array(8);
                for (let i = 1; i <= 8; i++) {
                    if (parsed['ch' + i] !== undefined) values[i - 1] = parseNumberField(parsed['ch' + i]);
                    else if (parsed['CH' + i] !== undefined) values[i - 1] = parseNumberField(parsed['CH' + i]);
                }
            }
            if (hasAnyValue(values)) onFrame(values);
        } catch (e) {}
    }
    return textBuffer;
}