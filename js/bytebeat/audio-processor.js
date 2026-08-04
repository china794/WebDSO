/**
 * ==========================================
 * Bytebeat AudioWorklet Processor
 * ==========================================
 * 从 dollchan.net/bytebeat (MIT) 移植的 bytebeat 引擎。
 * 在 AudioWorklet 线程逐样本求值 bytebeat 公式，实时生成音频。
 *
 * 四种模式：
 *   Bytebeat       — 无符号 8bit (0-255)，& 255 回绕
 *   Signed Bytebeat— 有符号 8bit (-128..127)，+128 偏移后 & 255
 *   Floatbeat      — 浮点 [-1,1] 直接输出（高音质）
 *   Funcbeat       — 代码返回一个函数，以 (秒, 采样率) 调用
 *
 * 安全与隔离：
 *   - deleteGlobals / freezeGlobals 防止用户公式污染全局
 *   - 编译/运行期双重 try/catch，任何异常不崩 worklet
 *
 * 注意：AudioWorklet 模块必须自包含（无 import），
 *       通过 registerProcessor 注册，主线程用 port 通信。
 */

class BytebeatProcessor extends AudioWorkletProcessor {
    constructor(...args) {
        super(...args);
        this.audioSample = 0;
        this.byteSample = 0;
        this.drawMode = 'Points';
        this.errorDisplayed = true;
        this.func = null;
        this.getValues = null;
        this.isFuncbeat = false;
        this.isPlaying = true;
        this.lastByteValue = [null, null];
        this.lastFuncValue = [null, null];
        this.lastTime = -1;
        this.outValue = [0, 0];
        this.playbackSpeed = 1;
        this.sampleRate = 8000;
        this.sampleRatio = 1;
        this.srDivisor = 1;

        Object.seal(this);
        BytebeatProcessor.deleteGlobals();
        BytebeatProcessor.freezeGlobals();

        this.port.addEventListener('message', e => this.receiveData(e.data));
        this.port.start();
    }

    /** 清空全局上的单字母变量与自有属性，防止残留串台 */
    static deleteGlobals() {
        for (let i = 0; i < 26; ++i) {
            delete globalThis[String.fromCharCode(65 + i)];
            delete globalThis[String.fromCharCode(97 + i)];
        }
        for (const name in globalThis) {
            if (Object.prototype.hasOwnProperty.call(globalThis, name)) {
                delete globalThis[name];
            }
        }
    }

    /** 冻结全局对象/函数，防止用户公式篡改 Math、Array 等内置对象 */
    static freezeGlobals() {
        Object.getOwnPropertyNames(globalThis).forEach(name => {
            const prop = globalThis[name];
            const type = typeof prop;
            if ((type === 'object' || type === 'function') && name !== 'globalThis') {
                try { Object.freeze(prop); } catch (e) {}
            }
            if (type === 'function' && Object.prototype.hasOwnProperty.call(prop, 'prototype')) {
                try { Object.freeze(prop.prototype); } catch (e) {}
            }
            try {
                Object.defineProperty(globalThis, name, { writable: false, configurable: false });
            } catch (e) {}
        });
    }

    static getErrorMessage(err, time) {
        const when = time === null ? 'compilation' : 't=' + time;
        if (!(err instanceof Error)) {
            return `${when} thrown: ${typeof err === 'string' ? err : JSON.stringify(err)}`;
        }
        const { message, lineNumber, columnNumber } = err;
        return `${when} error: ${typeof message === 'string' ? message : JSON.stringify(message)}` +
            (typeof lineNumber === 'number' && typeof columnNumber === 'number' ?
                ` (at line ${lineNumber - 3}, character ${+columnNumber})` : '');
    }

    /** 逐样本求值 bytebeat 公式，填充双声道输出 */
    process(inputs, [chData]) {
        const chDataLen = chData[0].length;
        if (!chDataLen || !this.isPlaying) {
            return true;
        }
        let time = this.sampleRatio * this.audioSample;
        let { byteSample } = this;
        const drawBuffer = [];

        for (let i = 0; i < chDataLen; ++i) {
            time += this.sampleRatio;
            const currentTime = Math.floor(time / this.srDivisor) * this.srDivisor;
            if (this.lastTime !== currentTime) {
                let funcValue;
                const currentSample = Math.floor(byteSample / this.srDivisor) * this.srDivisor;
                try {
                    if (this.isFuncbeat) {
                        funcValue = this.func(currentSample / this.sampleRate, this.sampleRate);
                    } else {
                        funcValue = this.func(currentSample);
                    }
                } catch (err) {
                    if (this.errorDisplayed) {
                        this.errorDisplayed = false;
                        this.sendData({
                            error: {
                                message: BytebeatProcessor.getErrorMessage(err, currentSample),
                                isRuntime: true
                            }
                        });
                    }
                    funcValue = NaN;
                }
                funcValue = Array.isArray(funcValue)
                    ? [funcValue[0], funcValue[1]]
                    : [funcValue, funcValue];
                let hasValue = false;
                let ch = 2;
                while (ch--) {
                    try {
                        funcValue[ch] = +funcValue[ch];
                    } catch (err) {
                        funcValue[ch] = NaN;
                    }
                    if (funcValue[ch] === this.lastFuncValue[ch]) {
                        continue;
                    } else if (!isNaN(funcValue[ch])) {
                        this.outValue[ch] = this.getValues(funcValue[ch], ch);
                        hasValue = true;
                    } else if (!isNaN(this.lastFuncValue[ch])) {
                        this.lastByteValue[ch] = NaN;
                        hasValue = true;
                    }
                }
                if (hasValue) {
                    drawBuffer.push({ t: currentSample, value: [...this.lastByteValue] });
                }
                byteSample += currentTime - this.lastTime;
                this.lastFuncValue = funcValue;
                this.lastTime = currentTime;
            }
            chData[0][i] = this.outValue[0];
            chData[1][i] = this.outValue[1];
        }
        if (Math.abs(byteSample) > Number.MAX_SAFE_INTEGER) {
            this.resetTime();
            return true;
        }
        this.audioSample += chDataLen;
        let isSend = false;
        const data = {};
        if (byteSample !== this.byteSample) {
            isSend = true;
            data.byteSample = this.byteSample = byteSample;
        }
        if (drawBuffer.length) {
            isSend = true;
            data.drawBuffer = drawBuffer;
        }
        if (isSend) {
            this.sendData(data);
        }
        return true;
    }

    /** 接收主线程控制消息 */
    receiveData(data) {
        if (data.byteSample !== undefined) {
            this.byteSample = +data.byteSample || 0;
            this.resetValues();
        }
        if (data.errorDisplayed === true) {
            this.errorDisplayed = true;
        }
        if (data.isPlaying !== undefined) {
            this.isPlaying = data.isPlaying;
        }
        if (data.srDivisor !== undefined) {
            this.srDivisor = data.srDivisor;
        }
        if (data.playbackSpeed !== undefined) {
            const sampleRatio = this.sampleRatio / this.playbackSpeed;
            this.playbackSpeed = data.playbackSpeed;
            this.setSampleRatio(sampleRatio);
        }
        if (data.mode !== undefined) {
            this.isFuncbeat = data.mode === 'Funcbeat';
            switch (data.mode) {
            case 'Bytebeat':
                this.getValues = (funcValue, ch) => (this.lastByteValue[ch] = funcValue & 255) / 127.5 - 1;
                break;
            case 'Signed Bytebeat':
                this.getValues = (funcValue, ch) =>
                    (this.lastByteValue[ch] = (funcValue + 128) & 255) / 127.5 - 1;
                break;
            case 'Floatbeat':
            case 'Funcbeat':
                this.getValues = (funcValue, ch) => {
                    const outValue = Math.max(Math.min(funcValue, 1), -1);
                    this.lastByteValue[ch] = Math.round((outValue + 1) * 127.5);
                    return outValue;
                };
                break;
            default:
                this.getValues = (funcValue, ch) => (this.lastByteValue[ch] = NaN);
            }
        }
        if (data.setFunction !== undefined) {
            this.setFunction(data.setFunction);
        }
        if (data.resetTime === true) {
            this.resetTime();
        }
        if (data.sampleRate !== undefined) {
            this.sampleRate = data.sampleRate;
        }
        if (data.sampleRatio !== undefined) {
            this.setSampleRatio(data.sampleRatio);
        }
    }

    sendData(data) {
        this.port.postMessage(data);
    }

    resetTime() {
        this.byteSample = 0;
        this.resetValues();
        this.sendData({ byteSample: 0 });
    }

    resetValues() {
        this.audioSample = 0;
        this.lastByteValue = this.lastFuncValue = [null, null];
        this.lastTime = -1;
        this.outValue = [0, 0];
    }

    /** 编译 bytebeat 公式。失败回滚旧函数，返回错误消息 */
    setFunction(codeText) {
        // 把 Math 方法拉平为形参（加速 + 隔离），并附加 int / window
        const params = Object.getOwnPropertyNames(Math);
        const values = params.map(k => Math[k]);
        params.push('int', 'window');
        values.push(Math.floor, globalThis);

        BytebeatProcessor.deleteGlobals();

        let isCompiled = false;
        const oldFunc = this.func;
        try {
            if (this.isFuncbeat) {
                this.func = new Function(...params, codeText).bind(globalThis, ...values);
            } else {
                // 优化 eval(unescape(escape`XXXX`...)) 混淆代码
                codeText = codeText.trim().replace(
                    /^eval\(unescape\(escape(?:`|\('|\("|\(`)(.*?)(?:`|'\)|"\)|`\)).replace\(\/u\(\.\.\)\/g,["'`]\$1%["'`]\)\)\)$/,
                    (match, m1) => unescape(escape(m1).replace(/u(..)/g, '$1%')));
                this.func = new Function(...params, 't', `return 0,\n${ codeText || 0 };`)
                    .bind(globalThis, ...values);
            }
            isCompiled = true;
            if (this.isFuncbeat) {
                this.func = this.func();
                this.func(0, this.sampleRate);
            } else {
                this.func(0);
            }
        } catch (err) {
            if (!isCompiled) {
                this.func = oldFunc;
            }
            this.errorDisplayed = false;
            this.sendData({
                error: { message: BytebeatProcessor.getErrorMessage(err, isCompiled ? 0 : null), isCompiled },
                updateUrl: isCompiled
            });
            return;
        }
        this.errorDisplayed = false;
        this.sendData({ error: { message: '', isCompiled }, updateUrl: true });
    }

    /** 调整采样率比值（时间连续性保持） */
    setSampleRatio(sampleRatio) {
        const timeOffset = Math.floor(this.sampleRatio * this.audioSample) - this.lastTime;
        this.sampleRatio = sampleRatio * this.playbackSpeed;
        this.lastTime = Math.floor(this.sampleRatio * this.audioSample) - timeOffset;
    }
}

registerProcessor('webdso-bytebeat', BytebeatProcessor);
