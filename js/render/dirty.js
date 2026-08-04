/**
 * ==========================================
 * 脏标记系统 (Dirty Flags)
 * ==========================================
 * 跟踪哪些渲染层需要更新，避免每帧全量重绘。
 *
 * 使用位掩码实现高效标记合并：
 *   flag = DATA | GRID | WAVEFORM  # 同时标记多个层
 *   if (flag & WAVEFORM) ...        # 检查单个层
 */

// ---- 渲染层位掩码 ----
export const LAYER = {
    /** 背景网格（主题切换/窗口缩放时） */
    GRID:       1 << 0,
    /** 波形数据（新数据到达时） */
    WAVEFORM:   1 << 1,
    /** OSD 文字（触发状态/通道设置变化时） */
    OSD:        1 << 2,
    /** 测量面板（测量值更新时） */
    MEASURE:    1 << 3,
    /** FFT 频谱（FFT 参数/数据变化时） */
    FFT:        1 << 4,
    /** 光标（光标模式/位置变化时） */
    CURSOR:     1 << 5,
    /** 悬停信息（鼠标移动时） */
    HOVER:      1 << 6,
    /** 触发线（触发设置变化时） */
    TRIGGER:    1 << 7,
    /** 小地图（数据变化时） */
    MINIMAP:    1 << 8,
    /** 时间音频进度条 */
    AUDIO_SEEK: 1 << 9,
    /** 所有层 */
    ALL:        (1 << 10) - 1,
    /** 暂停时只需要 UI 层 */
    UI_ONLY:    (1 << 2) | (1 << 5) | (1 << 6) | (1 << 7) | (1 << 9),
};

/**
 * 脏标记管理器
 */
class DirtyFlags {
    constructor() {
        this._flags = 0;
        this._frameCount = 0;
        this._measureThrottle = 0;
        this._minimapThrottle = 0;
    }

    /** 标记某层为脏 */
    mark(layer) {
        this._flags |= layer;
    }

    /** 清除某层的脏标记 */
    clear(layer) {
        this._flags &= ~layer;
    }

    /** 检查某层是否需要更新 */
    needs(layer) {
        return (this._flags & layer) !== 0;
    }

    /** 获取当前所有脏标记 */
    get flags() {
        return this._flags;
    }

    /** 重置所有脏标记 */
    reset() {
        this._flags = 0;
    }

    /** 增加帧计数 */
    tick() {
        this._frameCount++;
        this._measureThrottle++;
        this._minimapThrottle++;
    }

    /** 获取当前帧号 */
    get frame() {
        return this._frameCount;
    }

    /** 检查测量节流（每 N 帧更新一次） */
    shouldMeasure(interval = 4) {
        if (this._measureThrottle >= interval) {
            this._measureThrottle = 0;
            return true;
        }
        return false;
    }

    /** 检查小地图节流（每 N 帧更新一次） */
    shouldUpdateMinimap(interval = 6) {
        if (this._minimapThrottle >= interval) {
            this._minimapThrottle = 0;
            return true;
        }
        return false;
    }
}

/** 全局脏标记实例 */
export const dirty = new DirtyFlags();

export default dirty;
