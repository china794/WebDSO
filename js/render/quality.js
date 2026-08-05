/**
 * ==========================================
 * Render Quality — 设备性能自适应降级
 * ==========================================
 * 根据设备硬件能力自动选择渲染质量档位 (high/medium/low),
 * 移动端低性能设备自动降级, 高端设备全效。
 *
 * 评估信号:
 * - navigator.hardwareConcurrency (CPU 核心数)
 * - navigator.deviceMemory (内存 GB, 非标准但 Chrome/Edge 支持)
 * - navigator.userAgent 移动端启发式 (无 hardwareConcurrency 时)
 * - prefers-reduced-motion (用户偏好减少动画)
 *
 * 输出 quality 对象, 供渲染层读取降级参数。
 */

/** 默认质量档位 (桌面) */
let quality = {
    level: 'high',
    /** DPR 上限: 控制 canvas 像素量 */
    maxDpr: 3,
    /** 渲染点数上限 */
    maxRenderPoints: 4000,
    /** 辉光 (bloom) 是否启用 */
    glow: true,
    /** 余辉 (phosphor) 是否启用 */
    phosphor: true,
    /** FFT 显示点数 */
    fftBins: 512,
    /** 是否低电量模式 */
    lowBattery: false,
};

/** 检测设备性能档位并更新 quality */
export function detectQuality() {
    const ua = navigator.userAgent || '';
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);

    // 硬件信号
    const cores = navigator.hardwareConcurrency || (isMobile ? 4 : 8);
    const memory = navigator.deviceMemory || (isMobile ? 4 : 8); // GB

    // 用户偏好减少动画
    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // 综合评分 (加权)
    let score = 0;
    score += Math.min(cores, 16) * 10;            // 核心数
    score += Math.min(memory, 16) * 10;           // 内存
    if (!isMobile) score += 20;                    // 桌面加分
    if (prefersReducedMotion) score -= 30;         // 减少动画偏好

    // 分档
    let level;
    if (prefersReducedMotion) level = 'low';
    else if (score >= 120) level = 'high';
    else if (score >= 70) level = 'medium';
    else level = 'low';

    // 档位参数
    const levels = {
        low: {
            level: 'low',
            maxDpr: 1,
            maxRenderPoints: 1000,
            glow: false,
            phosphor: false,
            fftBins: 256,
        },
        medium: {
            level: 'medium',
            maxDpr: 1.5,
            maxRenderPoints: 2500,
            glow: true,
            phosphor: true,
            fftBins: 512,
        },
        high: {
            level: 'high',
            maxDpr: 3,
            maxRenderPoints: 4000,
            glow: true,
            phosphor: true,
            fftBins: 512,
        },
    };

    quality = { ...quality, ...levels[level], lowBattery: false };

    // 电池电量检测 (Battery API, 非标准但可用)
    if (navigator.getBattery) {
        navigator.getBattery().then((battery) => {
            if (battery.level < 0.2 && !battery.charging) {
                quality.lowBattery = true;
                // 低电量时进一步降级
                if (quality.level === 'high') {
                    quality.maxDpr = Math.min(quality.maxDpr, 2);
                }
            }
        }).catch(() => {});
    }

    return quality;
}

/** 获取当前质量档位 */
export function getQuality() {
    return quality;
}
