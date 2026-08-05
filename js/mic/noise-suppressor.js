/**
 * ==========================================
 * Noise Suppressor - 声卡输入智能降噪 AudioWorklet
 * ==========================================
 * 零依赖谱减法 + 噪声门实时降噪，对标 Ferrite Audio / RNNoise 的思路。
 *
 * 算法管线（每帧 128 样本, 累积到 FFT_SIZE 帧）:
 *   1. 累积 128 样本块到 FFT 输入缓冲
 *   2. Hann 窗 → 内嵌 radix-2 FFT → 幅度谱
 *   3. 噪声谱估计（学习模式采样, 或指数平均持续更新）
 *   4. 过减: |S| = max(|X| - α·|N|, β·|X|)   [α=过减因子, β=谱下限防音乐噪声]
 *   5. 时间平滑（一阶 IIR）抑制"音乐噪声"伪影
 *   6. 噪声门: 帧能量低于阈值时整体衰减
 *   7. iFFT → 重叠相加(OLA) → 输出
 *
 * 注意: AudioWorklet 模块必须自包含（无 import），通过 registerProcessor
 * 注册，主线程用 port 通信（遵循 bytebeat worklet 的既定模式）。
 */

// ==================== 内嵌 Radix-2 FFT ====================
// worklet 不能 import 外部模块, 故在此内嵌一个轻量 FFT
// 实数输入 → 复数输出 (iFFT 复用同一蝶形, 共轭对称处理)

function makeFFT(N) {
    // 位反转表
    const rev = new Uint32Array(N);
    const bits = Math.log2(N);
    for (let i = 0; i < N; i++) {
        let r = 0;
        for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1);
        rev[i] = r;
    }
    // 预计算旋转因子 (cos/sin) 的缓存, 避免逐帧 Math.cos 开销
    const cosCache = new Float32Array(N / 2);
    const sinCache = new Float32Array(N / 2);
    for (let i = 0; i < N / 2; i++) {
        const ang = -2 * Math.PI * i / N;
        cosCache[i] = Math.cos(ang);
        sinCache[i] = Math.sin(ang);
    }
    return { N, rev, cosCache, sinCache };
}

/**
 * 实数 FFT: 输入 real (Float32Array N), 输出 reOut/imOut (自然序频率),
 * 以及幅度谱 magOut (N/2, 归一化)。
 * 输入 real 不被修改。
 */
function realFFT(fft, real, reOut, imOut, magOut) {
    const { N, rev, cosCache, sinCache } = fft;
    // 位反转重排 (输入自然序 → 位反转序)
    for (let i = 0; i < N; i++) reOut[i] = real[rev[i]];
    imOut.fill(0);
    // 蝶形运算
    for (let size = 2; size <= N; size <<= 1) {
        const half = size >> 1;
        const step = N / size;
        for (let i = 0; i < N; i += size) {
            for (let j = 0; j < half; j++) {
                const k = j * step;
                const c = cosCache[k], s = sinCache[k];
                const tr = reOut[i + j + half] * c - imOut[i + j + half] * s;
                const ti = reOut[i + j + half] * s + imOut[i + j + half] * c;
                reOut[i + j + half] = reOut[i + j] - tr;
                imOut[i + j + half] = imOut[i + j] - ti;
                reOut[i + j] += tr;
                imOut[i + j] += ti;
            }
        }
    }
    // 幅度谱 (只取正频率, 归一化到 0..1)
    const half = N >> 1;
    for (let i = 0; i < half; i++) {
        magOut[i] = Math.sqrt(reOut[i] * reOut[i] + imOut[i] * imOut[i]) / half;
    }
}

/** 实数 iFFT: 从幅度谱+相位重建时域。
 * 利用 ifft(x) = conj(fft(conj(x)))/N, 复用正变换蝶形 (已验证精确)。
 * 输入 magIn/phaseIn (自然序), 输出 timeOut (自然序时域)。
 */
function realIFFT(fft, magIn, phaseIn, reOut, imOut, timeOut) {
    const { N, rev, cosCache, sinCache } = fft;
    const half = N >> 1;
    // 从幅度+相位重建复数谱 (自然序)
    for (let i = 0; i < half; i++) {
        const m = magIn[i] * half; // 反归一化 (与正变换的 /half 对称)
        reOut[i] = m * Math.cos(phaseIn[i]);
        imOut[i] = m * Math.sin(phaseIn[i]);
    }
    // 共轭对称填负频率 (实数信号)
    reOut[half] = 0; imOut[half] = 0;
    for (let i = 1; i < half; i++) {
        reOut[N - i] = reOut[i];
        imOut[N - i] = -imOut[i];
    }
    // 取共轭: 对复数谱做 conj
    const reC = reOut.slice();
    const imC = new Float32Array(N);
    for (let i = 0; i < N; i++) imC[i] = -imOut[i];
    // fft(conj): 复用正变换蝶形 (位反转交换 re/im)
    for (let i = 0; i < N; i++) {
        const j = rev[i];
        if (i < j) {
            const tr = reC[i]; reC[i] = reC[j]; reC[j] = tr;
            const ti = imC[i]; imC[i] = imC[j]; imC[j] = ti;
        }
    }
    for (let size = 2; size <= N; size <<= 1) {
        const halfSize = size >> 1;
        const step = N / size;
        for (let i = 0; i < N; i += size) {
            for (let j = 0; j < halfSize; j++) {
                const k = j * step;
                const c = cosCache[k], s = sinCache[k];
                const tr = reC[i + j + halfSize] * c - imC[i + j + halfSize] * s;
                const ti = reC[i + j + halfSize] * s + imC[i + j + halfSize] * c;
                reC[i + j + halfSize] = reC[i + j] - tr;
                imC[i + j + halfSize] = imC[i + j] - ti;
                reC[i + j] += tr;
                imC[i + j] += ti;
            }
        }
    }
    // conj(结果)/N
    for (let i = 0; i < N; i++) {
        timeOut[i] = reC[i] / N;   // 实数输出, 虚部应为 0, 取实部
    }
}

// ==================== 降噪处理器 ====================
class NoiseSuppressorProcessor extends AudioWorkletProcessor {
    constructor(...args) {
        super(...args);
        this.fftSize = 1024;               // FFT 帧长
        this.hopSize = 512;                // 重叠步长 (50% 重叠, Hann 窗满足 COLA 恒等重构)
        this.enabled = true;               // 降噪开关
        this.strength = 0.6;               // 过减因子 α
        this.beta = 0.02;                  // 谱下限 (防音乐噪声)
        this.gateThreshold = 0.01;         // 噪声门能量阈值 (RMS; 学习完成后自动对齐噪声底)
        this.gateRatio = 0.05;             // 门关闭时的残留 (越低静音越彻底)
        this.learnSamples = 0;             // 学习计数
        this.noiseLearning = false;        // 是否在学习
        this.learnLength = 0;              // 学习所需帧数
        this.smoothCoef = 0.7;             // 时间平滑系数
        this.noiseFloorRms = 0;            // 学习期测得的噪声 RMS 底 (用于门阈值自适应)
        this.noiseRmsAcc = 0;              // 学习期 RMS 累积
        this.noiseRmsCount = 0;

        // FFT 状态
        this.fft = makeFFT(this.fftSize);
        this.N = this.fftSize;
        this.half = this.fftSize >> 1;

        // 输入缓冲 — 每声道独立, 滑动窗 (50% 重叠):
        // 每 128 样本块整体左移 128, 新样本写入尾部; 每凑够 hopSize 样本出一帧。
        // 帧间隔 = hopSize, 与 OLA 写入错开完全同步, 满足 Hann 窗 COLA 恒等重构。
        this.inputBuf = [new Float32Array(this.fftSize), new Float32Array(this.fftSize)];
        this.pendingSamples = 0;

        // 输出缓冲 (OLA 重叠相加) — 每声道独立
        // 写入: processFrame 从偏移 0 叠加 (缓冲头部始终对应当前时间)。
        // 读取: 每 128 样本块从 olaRead 消费, 每消费满 hopSize 整体左移 hopSize 并清空尾部。
        // 帧间隔与消费步长同为 hopSize, 读写严格同步。
        this.olaBuf = [new Float32Array(this.fftSize + this.hopSize), new Float32Array(this.fftSize + this.hopSize)];
        this.olaRead = 0;      // 下一块输出从 olaBuf 读取的起始偏移

        // FFT 工作缓冲 (单声道计算, L/R 各跑一轮共享缓冲)
        this.hann = new Float32Array(this.fftSize);
        for (let i = 0; i < this.fftSize; i++) this.hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (this.fftSize - 1)));
        this.frame = new Float32Array(this.fftSize);
        this.reOut = new Float32Array(this.fftSize);
        this.imOut = new Float32Array(this.fftSize);
        this.magIn = new Float32Array(this.half);
        this.phaseIn = new Float32Array(this.half);
        this.magFilt = new Float32Array(this.half);   // 滤波后幅度 (用于 iFFT)
        this.magSmooth = new Float32Array(this.half); // 时间平滑谱
        this.noiseMag = new Float32Array(this.half);  // 噪声谱估计
        this.noiseAcc = new Float32Array(this.half);  // 噪声累积
        this.noiseCount = 0;

        // 学习模式消息
        this.port.addEventListener('message', (e) => this.onMessage(e.data));
        this.port.start();

        // 启动即自动采样环境噪声谱: 否则 noiseMag 全 0, 谱减法无料可用,
        // 降噪只能靠噪声门。节点创建后立刻学习前 ~0.8s 安静底噪。
        this.noiseLearning = true;
        this.learnSamples = 0;
        this.learnLength = Math.max(1, Math.floor(0.8 * sampleRate / this.fftSize));
        this.noiseAcc.fill(0);
        this.noiseCount = 0;
    }

    onMessage(msg) {
        if (!msg) return;
        switch (msg.type) {
            case 'enable':
                this.enabled = !!msg.value;
                break;
            case 'strength':
                this.strength = Math.max(0, Math.min(1.5, msg.value));
                break;
            case 'gate':
                this.gateThreshold = Math.pow(10, msg.value / 20); // dB → 线性
                break;
            case 'learnNoise':
                this.noiseLearning = true;
                this.learnSamples = 0;
                this.learnLength = Math.max(1, Math.floor((msg.ms || 1000) * sampleRate / this.fftSize));
                this.noiseAcc.fill(0);
                this.noiseCount = 0;
                break;
            case 'resetNoise':
                this.noiseMag.fill(0.0001);
                this.noiseAcc.fill(0);
                this.noiseCount = 0;
                this.noiseLearning = false;
                break;
            case 'setNoise':
                // 直接注入学习好的噪声谱 (主线程可预先算好)
                if (msg.mag && msg.mag.length === this.half) {
                    this.noiseMag.set(msg.mag);
                    this.noiseLearning = false;
                }
                break;
        }
    }

    /**
     * 主处理循环。Web Audio 每块 128 样本调用一次。
     * 双声道: L/R 各自独立走 FFT 降噪管线, 各自 OLA 输出。
     * 输入/输出声道数在 audioController 里固定为 2 (outputChannelCount)。
     */
    process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];
        if (!input || !input[0]) return true;

        const inCh = input[0];
        const outCh = output[0];
        // 声道数判定: 单声道输入 (大多数物理麦克风) 时把 L 镜像到 R,
        // 保证右侧通道始终有信号; 立体声输入则双通道各自独立处理。
        const isMono = input.length < 2;
        const inCh2 = isMono ? inCh : input[1];
        const outCh2 = output[1] || outCh;

        // 降噪关闭 → 双声道直通
        if (!this.enabled) {
            for (let i = 0; i < 128; i++) {
                outCh[i] = inCh[i];
                outCh2[i] = inCh2[i];
            }
            return true;
        }

        // 写入输入缓冲 (L/R) — 滑动窗
        // 每块先左移 128 再填尾部, 保持 inputBuf 始终是最近 fftSize 个样本
        for (let ch = 0; ch < 2; ch++) this.inputBuf[ch].copyWithin(0, 128);
        for (let i = 0; i < 128; i++) {
            this.inputBuf[0][this.fftSize - 128 + i] = inCh[i];
            this.inputBuf[1][this.fftSize - 128 + i] = inCh2[i];
        }
        this.pendingSamples += 128;

        // 每攒够 hopSize 样本出一帧 (两声道各处理一次)
        while (this.pendingSamples >= this.hopSize) {
            this.processFrame(0);
            this.processFrame(1);
            this.pendingSamples -= this.hopSize;
        }

        // 从 OLA 缓冲输出 128 样本 (L/R)
        for (let i = 0; i < 128; i++) {
            outCh[i] = this.olaBuf[0][this.olaRead];
            outCh2[i] = this.olaBuf[1][this.olaRead];
            this.olaRead++;
            if (this.olaRead >= this.hopSize) {
                // 头部 hopSize 样本已消费完, 前移并清空尾部
                for (let ch = 0; ch < 2; ch++) {
                    this.olaBuf[ch].copyWithin(0, this.hopSize);
                    this.olaBuf[ch].fill(0, this.fftSize);
                }
                this.olaRead = 0;
            }
        }
        return true;
    }

    /** 处理一个完整 FFT 帧 (声道 ch: 0=L, 1=R) */
    processFrame(ch) {
        const { N, half } = this;
        const inBuf = this.inputBuf[ch];

        // 1. 加窗
        for (let i = 0; i < N; i++) this.frame[i] = inBuf[i] * this.hann[i];

        // 2. FFT → 幅度谱 + 相位
        realFFT(this.fft, this.frame, this.reOut, this.imOut, this.magIn);
        for (let i = 0; i < half; i++) {
            this.phaseIn[i] = Math.atan2(this.imOut[i], this.reOut[i]);
        }

        // 帧能量 (用于噪声门)
        let frameEnergy = 0;
        for (let i = 0; i < N; i++) frameEnergy += inBuf[i] * inBuf[i];
        frameEnergy = Math.sqrt(frameEnergy / N);

        // 3. 噪声谱学习
        if (this.noiseLearning) {
            for (let i = 0; i < half; i++) this.noiseAcc[i] += this.magIn[i];
            this.noiseCount++;
            this.noiseRmsAcc += frameEnergy;
            this.noiseRmsCount++;
            this.learnSamples++;
            if (this.learnSamples >= this.learnLength) {
                for (let i = 0; i < half; i++) this.noiseMag[i] = this.noiseAcc[i] / this.noiseCount;
                this.noiseFloorRms = this.noiseRmsAcc / this.noiseRmsCount;
                // 门阈值对齐到噪声底上方 ~2.5 倍, 让底噪帧被门压住, 语音帧(RMS 数倍于底噪)通过
                this.gateThreshold = Math.max(this.gateThreshold, this.noiseFloorRms * 2.5);
                this.noiseLearning = false;
            }
        }

        // 4. 谱减法: |S| = max(|X| - α·|N|, β·|X|)
        const alpha = this.strength;
        const beta = this.beta;
        for (let i = 0; i < half; i++) {
            const x = this.magIn[i];
            const n = this.noiseMag[i] || 0.0001;
            let s = x - alpha * n;
            const floor = beta * x;
            if (s < floor) s = floor;
            if (s < 0) s = 0;
            this.magFilt[i] = s;
        }

        // 5. 时间平滑 (一阶 IIR, 抑制音乐噪声)
        const sc = this.smoothCoef;
        for (let i = 0; i < half; i++) {
            this.magSmooth[i] = sc * this.magSmooth[i] + (1 - sc) * this.magFilt[i];
        }

        // 6. 噪声门: 低能量帧整体衰减
        let gain = 1.0;
        if (frameEnergy < this.gateThreshold) {
            // 平滑过渡到残留
            const ratio = frameEnergy / (this.gateThreshold || 1e-6);
            gain = this.gateRatio + (1 - this.gateRatio) * Math.min(1, ratio * 5);
        }

        // 7. iFFT → OLA 重叠相加
        // 当前帧时间对齐在窗口起点 (输入已是最近 N 个样本)。
        // 读取端每消费 hopSize 样本就把缓冲整体左移 hopSize 并清空尾部,
        // 所以这里始终从偏移 0 开始叠加, 与已消费位置严格对齐。
        const magForIfft = this.magSmooth;
        realIFFT(this.fft, magForIfft, this.phaseIn, this.reOut, this.imOut, this.frame);
        const ola = this.olaBuf[ch];
        for (let i = 0; i < N; i++) ola[i] += this.frame[i] * gain;
    }
}

registerProcessor('noise-suppressor', NoiseSuppressorProcessor);
