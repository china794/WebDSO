/**
 * ==========================================
 * 轻量级 FFT 实现 (Radix-2 Cooley-Tukey)
 * ==========================================
 * 用于实时频谱分析，支持 2 的幂次方点数
 */
export class FFT {
    constructor(size) {
        this.size = size;
        this.m = Math.log2(size);
        this._initReverseTable();
    }

    /** 预计算位反转索引表，用于 FFT 蝶形运算前的数据重排 */
    _initReverseTable() {
        this.reverseTable = new Uint32Array(this.size);
        for (let i = 0; i < this.size; i++) {
            let j = 0;
            for (let k = 0; k < this.m; k++) j = (j << 1) | ((i >> k) & 1);
            this.reverseTable[i] = j;
        }
    }

    /**
     * 执行实数 FFT 变换，返回幅值谱 (0 ~ Nyquist)
     * @param {Float32Array|Array} buffer - 时域采样数据
     * @returns {Float32Array} 归一化后的幅值数组
     */
    forward(buffer) {
        const n = this.size;
        const real = new Float32Array(buffer);
        const imag = new Float32Array(n);

        // 位反转排序 (Bit-reversal permutation)
        for (let i = 0; i < n; i++) {
            if (i < this.reverseTable[i]) {
                [real[i], real[this.reverseTable[i]]] = [real[this.reverseTable[i]], real[i]];
            }
        }

        // 蝶形运算 (Butterfly operation)
        for (let size = 2; size <= n; size <<= 1) {
            const halfSize = size >> 1;
            const angle = -2 * Math.PI / size;
            for (let i = 0; i < n; i += size) {
                for (let j = 0; j < halfSize; j++) {
                    const cos = Math.cos(angle * j);
                    const sin = Math.sin(angle * j);
                    const tr = real[i + j + halfSize] * cos - imag[i + j + halfSize] * sin;
                    const ti = real[i + j + halfSize] * sin + imag[i + j + halfSize] * cos;
                    real[i + j + halfSize] = real[i + j] - tr;
                    imag[i + j + halfSize] = imag[i + j] - ti;
                    real[i + j] += tr;
                    imag[i + j] += ti;
                }
            }
        }

        // 计算幅值并归一化 (只保留正频率部分)
        const magnitude = new Float32Array(n / 2);
        for (let i = 0; i < n / 2; i++) {
            magnitude[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / n;
        }
        return magnitude;
    }
}