/**
 * ==========================================
 * 全局常量定义 (Global Constants)
 * ==========================================
 * 集中管理所有魔法数字，提高代码可读性和可维护性
 */

// ==================== 系统配置 ====================
export const SYSTEM = {
    /** 通道数量 */
    CHANNEL_COUNT: 8,
    /** 默认开启的通道数 */
    DEFAULT_ACTIVE_CHANNELS: 2,
    /** 默认采样率 (Hz) */
    DEFAULT_SAMPLE_RATE: 96000,
    /** 最小 WebAudio 采样率 */
    MIN_WEBAUDIO_RATE: 8000,
    /** 最大 WebAudio 采样率 */
    MAX_WEBAUDIO_RATE: 96000,
};

// ==================== 缓冲区配置 ====================
export const BUFFER = {
    /** 
     * FFT 缓冲区大小 - 音频模式使用（Web Audio API限制最大32768）
     */
    FFT_SIZE: 32768,
    /** 
     * 串口模式FFT大小 - 使用与音频模式相同的32768点
     * 保证频谱分析的一致性，同时避免内存占用过大
     */
    SERIAL_FFT_SIZE: 32768,
    /** XY 模式采样点数 */
    XY_POINTS: 16384,
    /** 小型 FFT 缓冲区 */
    FFT_SMALL: 4096,
    /** 串口原始缓冲区最大大小 */
    MAX_RAW_BUFFER: 65536,
    /** 串口缓冲区大小 */
    SERIAL_BUFFER: 8192,
    /** 音频块大小 */
    AUDIO_CHUNK: 2048,
    /** 顶点数据乘数 (用于 WebGL 缓冲区分配) */
    VERTEX_MULTIPLIER: 30,
};

// ==================== 网格配置 ====================
export const GRID = {
    /** X 轴网格分割数 */
    DIVISIONS_X: 10,
    /** Y 轴网格分割数 */
    DIVISIONS_Y: 8,
    /** NDC 范围 (-1 到 1，总范围 2) */
    NDC_RANGE: 2.0,
    /** NDC 每格 */
    get NDC_PER_DIV() { return this.NDC_RANGE / this.DIVISIONS_Y; },
};

// ==================== 触发配置 ====================
export const TRIGGER = {
    /** 触发迟滞 */
    HYSTERESIS: 0.02,
    /** 触发搜索起始点 */
    SEARCH_START: 1000,
    /** 触发搜索结束偏移 */
    SEARCH_END_OFFSET: 2000,
    /** 触发历史深度 */
    HISTORY_DEPTH: 16000,
    /** 触发范围乘数 */
    RANGE_MULTIPLIER: 4.0,
    /** 触发步进除数 */
    STEP_DIVISOR: 100,
};

// ==================== 测量配置 ====================
export const MEASUREMENT = {
    /** 扫描长度 */
    SCAN_LENGTH: 8000,
    /** 最小有效峰峰值 */
    MIN_VALID_VPP: 0.02,
    /** 最小值初始化 */
    MIN_INIT: -999,
    /** 最大值初始化 */
    MAX_INIT: 999,
};

// ==================== 时基配置 ====================
export const TIMEBASE = {
    /** 默认每格秒数 (ms) */
    DEFAULT_MS: 5,
    /** 最小每格秒数 (ms) */
    MIN_MS: 0.1,
    /** 最大每格秒数 (ms) */
    MAX_MS: 1000,
    /** 采样率千除数 */
    KILO_DIVISOR: 1000,
    /** 毫秒转秒 */
    MS_TO_S: 1000,
    /** 秒转毫秒 */
    S_TO_MS: 0.001,
};

// ==================== 信号发生器配置 ====================
export const GENERATOR = {
    /** 默认频率 (Hz) */
    DEFAULT_FREQ: 1000,
    /** 默认幅度 */
    DEFAULT_AMP: 0.5,
    /** 最大幅度 */
    MAX_AMP: 20,
    /** 频率滑块归一化 */
    FREQ_SLIDER_NORM: 100,
    /** 幅度滑块归一化 */
    AMP_SLIDER_NORM: 100,
};

// ==================== 光标配置 ====================
export const CURSOR = {
    /** 默认模式 */
    DEFAULT_MODE: 0,
    /** 默认电压光标1 */
    DEFAULT_V1: 0.25,
    /** 默认电压光标2 */
    DEFAULT_V2: -0.25,
    /** 默认时间光标1 */
    DEFAULT_T1: -0.25,
    /** 默认时间光标2 */
    DEFAULT_T2: 0.25,
    /** 模式数量 */
    MODE_COUNT: 3,
    /** 拖拽阈值 */
    DRAG_THRESHOLD: 0.15,
    /** 水平位置归一化 */
    HPOS_NORM: 100,
};

// ==================== 音频配置 ====================
export const AUDIO = {
    /** 主音量 */
    MASTER_VOLUME: 0.5,
    /** 增益渐变时间 (秒) */
    GAIN_RAMP_TIME: 0.02,
    /** 高通滤波器频率 */
    HIGHPASS_FREQ: 10,
    /** DC 偏置 */
    DC_BIAS: 0.000001,
    /** 最小播放速度 */
    MIN_SPEED: 0.001,
    /** 最大播放速度 */
    MAX_SPEED: 2.0,
    /** 速度死区下限 */
    SPEED_DEADZONE_LOW: 0.97,
    /** 速度死区上限 */
    SPEED_DEADZONE_HIGH: 1.03,
    /** 正常播放速度 */
    NORMAL_SPEED: 1.0,
    /** 速度滑块归一化 */
    SPEED_SLIDER_NORM: 100,
};

// ==================== 串口配置 ====================
export const SERIAL = {
    /** 默认波特率 */
    DEFAULT_BAUD: 115200,
    /** JustFloat 每帧字节数 (8通道) */
    BYTES_PER_FRAME: 120,
    /** JustFloat 帧大小 */
    FRAME_SIZE: 12,
    /** 同步字节 */
    SYNC_BYTES: [0x00, 0x00, 0x80, 0x7F],
    /** 缓冲区修剪比例 */
    BUFFER_TRIM_RATIO: 2,
    /** 最小音频播放率 */
    MIN_PLAYBACK_RATE: 8000,
    /** 音频漂移校正延迟 */
    DRIFT_CORRECTION_DELAY: 0.05,
    /** 音频漂移最大提前 */
    DRIFT_MAX_AHEAD: 0.4,
    /** 时基最小样本数 */
    TIMEBASE_MIN_SAMPLES: 10,
    /** 时基最大样本数 */
    TIMEBASE_MAX_SAMPLES: 500,
    /** 时基默认样本数 */
    TIMEBASE_DEFAULT_SAMPLES: 50,
    /** 时基最小毫秒数 */
    TIMEBASE_MIN_MS: 0.1,
};

// ==================== 高速单通道协议配置 ====================
export const SINGLE_FLOAT_PROTOCOL = {
    /** 协议名称 */
    NAME: 'SingleFloat',
    /** 每帧字节数 (2B同步头 + 1B通道号 + 4B数据) */
    BYTES_PER_FRAME: 7,
    /** 同步头 */
    SYNC_BYTES: [0xAA, 0x55],
    /** 同步头长度 */
    SYNC_LENGTH: 2,
    /** 最大理论采样率 @ 12Mbps */
    MAX_SAMPLE_RATE: 12000000 / 70, // ~171kHz
    /** 推荐采样率 @ 7Mbps (FT232H) */
    RECOMMENDED_SAMPLE_RATE: 7000000 / 70, // ~100kHz
};

// ==================== 渲染配置 ====================
export const RENDER = {
    /** 默认线宽 */
    DEFAULT_LINE_SIZE: 0.002,
    /** 最小密度 Alpha */
    MIN_DENSITY_ALPHA: 0.6,
    /** 密度 Alpha 乘数 */
    DENSITY_ALPHA_MULT: 2,
    /** 密度 Alpha 偏移 */
    DENSITY_ALPHA_OFFSET: 1.5,
    /** FPS 更新间隔 (ms) */
    FPS_UPDATE_INTERVAL: 1000,
    /** Canvas 像素偏移 */
    CANVAS_PIXEL_OFFSET: 0.5,
    /** 十字准星刻度长度 */
    CROSSHAIR_TICK_LEN: 3,
    /** 触发线虚线模式 */
    TRIGGER_DASH: [4, 4],
    /** 默认最大 FFT 频率 - 提高到20kHz以覆盖全部可听频率范围 */
    DEFAULT_FFT_MAX_FREQ: 20000,
    /** 默认 FFT 增益 */
    DEFAULT_FFT_GAIN: 100,
    /** FFT 面高度 */
    FFT_PANEL_HEIGHT: 150,
    /** FFT 文本 Y 偏移 */
    FFT_TEXT_Y_OFFSET: 135,
    /** FFT 频率标签步数 */
    FFT_FREQ_STEPS: 6,
    /** FFT 标签最小边距 */
    FFT_LABEL_MARGIN: 15,
    /** 最小可听频率 */
    MIN_AUDIBLE_FREQ: 20,
    /** FFT 条最大高度 */
    MAX_FFT_BAR_HEIGHT: 145,
    /** FFT 箱乘数 */
    FFT_BIN_MULT: 2,
};

// ==================== 颜色配置 ====================
export const COLOR = {
    /** Alpha LUT 指数 */
    ALPHA_LUT_EXP: 30,
    /** 最小 Alpha 阈值 */
    MIN_ALPHA: 0.02,
    /** 十六进制基数 */
    HEX_RADIX: 16,
    /** 十六进制分量长度 */
    HEX_COMPONENT_LEN: 2,
};

// ==================== 数学常量 ====================
export const MATH = {
    /** 极小值 */
    EPSILON: 1e-6,
    /** 平方根2 */
    SQRT2: 1.4142135623730951,
    /** 自然对数底 */
    E: Math.E,
    /** 2π */
    TWO_PI: 2 * Math.PI,
    /** 奈奎斯特因子 */
    NYQUIST_FACTOR: 2,
};

// ==================== 频率单位阈值 ====================
export const FREQ_UNITS = {
    /** MHz 阈值 */
    MHZ: 1000000,
    /** kHz 阈值 */
    KHZ: 1000,
};

// ==================== 电压单位阈值 ====================
export const VOLT_UNITS = {
    /** kV 阈值 */
    KV: 1000,
    /** mV 阈值 */
    MV: 0.001,
    /** mV 乘数 */
    MV_MULT: 1000,
};

// ==================== 时间单位阈值 ====================
export const TIME_UNITS = {
    /** 秒阈值 */
    SECOND: 1,
    /** 毫秒阈值 */
    MS: 0.001,
    /** 微秒阈值 */
    US: 0.000001,
    /** 毫秒乘数 */
    MS_MULT: 1000,
    /** 微秒乘数 */
    US_MULT: 1000000,
    /** 纳秒乘数 */
    NS_MULT: 1000000000,
};

// ==================== 防抖节流默认配置 ====================
export const TIMING = {
    /** 默认防抖时间 (ms) */
    DEBOUNCE_MS: 100,
    /** 默认节流时间 (ms) */
    THROTTLE_MS: 100,
    /** Modal 关闭延迟 (ms) */
    MODAL_CLOSE_DELAY: 50,
};

// ==================== WebGL 常量 ====================
export const WEBGL = {
    /** 每顶点字节数 */
    BYTES_PER_VERTEX: 20,
    /** 位置偏移 */
    POS_OFFSET: 0,
    /** 数据偏移 */
    DATA_OFFSET: 8,
    /** 全屏四边形顶点 */
    FULLSCREEN_QUAD: new Float32Array([
        -1.0, -1.0, 1.0, -1.0, -1.0, 1.0,
        -1.0, 1.0, 1.0, -1.0, 1.0, 1.0
    ]),
    /** 默认 DPR */
    DEFAULT_DPR: 1,
};

// ==================== 着色器常量 ====================
export const SHADER = {
    /** ERF 近似系数 */
    ERF_COEFFS: [0.278393, 0.230389, 0.000972, 0.078108],
    /** Sigma 分母 */
    SIGMA_DENOM: 2.0,
    /** Sigma 乘数 */
    SIGMA_MULT: 2.0,
    /** Sigma 比例因子 */
    SIGMA_SCALE: 1000.0,
    /** Sigma 除数 */
    SIGMA_DIV: 50.0,
    /** 强度阈值 */
    INTENSITY_THRESHOLD: 0.4,
    /** 强度比例 */
    INTENSITY_SCALE: 0.7,
    /** 强度大小因子 */
    INTENSITY_SIZE_FACTOR: 1000.0,
    /** 强度除数 */
    INTENSITY_DIV: 500.0,
    /** 最小 Alpha 基础值 */
    MIN_ALPHA_BASE: 0.01,
    /** 最大 Alpha 上限 */
    MAX_ALPHA_CAP: 0.99,
    /** Alpha 乘数 */
    ALPHA_MULT: 3.0,
    /** Bloom 模糊大小 */
    BLOOM_BLUR_SIZE: 1.5,
    /** Bloom 强度 */
    BLOOM_INTENSITY: 0.6,
    /** 宽 Bloom 扩散 */
    WIDE_BLOOM_SPREAD: 4.0,
    /** 宽 Bloom 权重 */
    WIDE_BLOOM_WEIGHT: 0.02,
    /** 3x3 高斯核权重 */
    GAUSSIAN_WEIGHTS: [0.0625, 0.125, 0.25],
};

// ==================== UI 尺寸常量 ====================
export const UI = {
    /** 小圆角 */
    RADIUS_SM: '4px',
    /** 中圆角 */
    RADIUS_MD: '8px',
    /** 大圆角 */
    RADIUS_LG: '12px',
    /** 基础字体大小 */
    FONT_SIZE_BASE: '12px',
    /** 小字体 */
    FONT_SIZE_SM: '10px',
    /** 大字体 */
    FONT_SIZE_LG: '16px',
    /** 按钮内边距 */
    BTN_PADDING: '10px 8px',
    /** 选择框内边距 */
    SELECT_PADDING: '8px 10px',
    /** 输入框高度 */
    INPUT_HEIGHT: '28px',
    /** 滑块轨道高度 */
    SLIDER_TRACK_HEIGHT: '6px',
    /** 滑块滑块大小 */
    SLIDER_THUMB_SIZE: '16px',
    /** 滚动条宽度 */
    SCROLLBAR_WIDTH: '6px',
    /** 主容器内边距 */
    MAIN_PADDING: '20px',
    /** 主容器间距 */
    MAIN_GAP: '20px',
    /** 右侧面板宽度 */
    RIGHT_PANEL_WIDTH: '480px',
    /** 右侧面板内边距 */
    RIGHT_PANEL_PADDING: '24px',
    /** 响应式断点 */
    RESPONSIVE_BREAKPOINT: '1024px',
    /** 屏幕宽高比 */
    SCREEN_ASPECT_RATIO: '5 / 4',
    
    // 光标面板尺寸
    CURSOR_PANEL_WIDTH: 180,
    CURSOR_PANEL_MIN_HEIGHT: 50,
    CURSOR_PANEL_PADDING: 20,
    CURSOR_PANEL_ROW_HEIGHT: 18,
    
    // 时间光标面板
    CURSOR_TIME_PANEL_WIDTH: 160,
    CURSOR_TIME_PANEL_HEIGHT: 50,
    
    // 悬停面板
    HOVER_PANEL_WIDTH: 140,
    HOVER_PANEL_MIN_HEIGHT: 65,
    HOVER_PANEL_PADDING: 20,
    HOVER_PANEL_ROW_HEIGHT: 18,
    
    // FPS 节点位置
    FPS_NODE_TOP: 10,
    FPS_NODE_LEFT: 10,
};

// ==================== 主题配置 ====================
export const THEME = {
    /** 主题切换动画持续时间 (ms) */
    TRANSITION_DURATION: 500,
};

// ==================== 信号发生器配置补充 ====================
export const GENERATOR_EXT = {
    /** 最小档位步进 */
    MIN_SCALE_STEP: 0.05,
    /** 频率滑块归一化 */
    FREQ_SLIDER_NORM: 100,
    /** 幅度滑块归一化 */
    AMP_SLIDER_NORM: 100,
};

// ==================== 系统配置补充 ====================
export const SYSTEM_EXT = {
    /** 默认通道 scale */
    DEFAULT_SCALE: 4.0,
    /** 默认通道位置 */
    DEFAULT_POS: 0.0,
};

// ==================== 渲染配置补充 ====================
export const RENDER_EXT = {
    /** 密度 Alpha 乘数 */
    DENSITY_ALPHA_MULT: 2,
    /** 密度 Alpha 偏移 */
    DENSITY_ALPHA_OFFSET: 1.5,
    /** 周期显示因子 */
    CYCLE_DISPLAY_FACTOR: 4,
    /** FFT 条高度差 */
    FFT_BAR_HEIGHT_DIFF: 5,
};

// ==================== 串口配置补充 ====================
export const SERIAL_EXT = {
    /** 时基最小样本数 */
    TIMEBASE_MIN_SAMPLES: 10,
    /** 时基最大样本数 */
    TIMEBASE_MAX_SAMPLES: 500,
    /** 时基默认样本数 */
    TIMEBASE_DEFAULT_SAMPLES: 50,
    /** 时基最小毫秒数 */
    TIMEBASE_MIN_MS: 0.1,
    /** 估计采样率除数 */
    ESTIMATED_RATE_DIVISOR: 120,
};

// ==================== 导出所有常量 ====================
export default {
    SYSTEM,
    BUFFER,
    GRID,
    TRIGGER,
    MEASUREMENT,
    TIMEBASE,
    GENERATOR,
    CURSOR,
    AUDIO,
    SERIAL,
    RENDER,
    COLOR,
    MATH,
    FREQ_UNITS,
    VOLT_UNITS,
    TIME_UNITS,
    TIMING,
    WEBGL,
    SHADER,
    UI,
};
