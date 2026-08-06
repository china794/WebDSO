/**
 * ==========================================
 * 串口协议解析 (Serial Protocols)
 * ==========================================
 * 支持 JustFloat 二进制帧、FireWater 文本、CSV、JSON Lines
 */

const JUSTFLOAT_SYNC = [0x00, 0x00, 0x80, 0x7F];
const MAX_TEXT_BUFFER_LENGTH = 65536;

/**
 * 在字节数组中查找 JustFloat 同步头 (00 00 80 7F)。
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
 * 将小端 IEEE-754 字节转换为浮点数值。
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
 * 将解码后的文本块追加到待处理文本缓冲区。
 * 使用共享的 TextDecoder 流式解码，保证跨串口分块的
 * 多字节 UTF-8 字符完整保留；限制缓冲区长度，防止
 * 设备无限发送超长行导致内存无限增长。
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
        // 若共享 decoder 状态丢失，则回退到新 decoder。
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
 * 解析 JustFloat 二进制帧。返回值为未消费的尾部数据。
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
 * 解析 FireWater 文本协议。
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
 * 解析 CSV，保留空的通道位置。
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
 * 解析 JSON Lines。支持 [ch1, ch2] 与 {"ch1": value, "ch2": value} 格式。
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