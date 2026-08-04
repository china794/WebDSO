/**
 * ==========================================
 * 国际化模块 (i18n)
 * ==========================================
 * 轻量级中英文切换，零外部依赖
 */

const LOCALES = {
  'zh-CN': {
    // 标题
    title: 'WebDSO - 纯原生网页示波器',
    panelTitle: '控制面板',
    // 工具按钮
    measure: '测量',
    cursor: '光标: 关',
    ytMode: 'Y-T 模式',
    xyMode: 'X-Y 模式',
    math: '🧮 数学运算: 关',
    mathOn: '🧮 数学运算: 开',
    refSave: '📷 保存参考波',
    refClear: '✕ 清除参考',
    exportCfg: '📤 导出配置',
    importCfg: '📥 导入配置',
    exportPng: '🖼️ 导出截图 (PNG)',
    run: '运行/停止 (RUN/STOP)',
    autoset: '自动设置 (AUTO)',
    fftOff: '📊 频谱模式 (OFF)',
    fftOn: '📊 频谱模式 (ON)',
    // 垂直
    vertical: '垂直',
    selectCh: '选择频道',
    pos: 'POS',
    scale: 'SCALE',
    cpl: 'CPL',
    // 水平
    horizontal: '水平',
    secDiv: 'SEC/DIV',
    // 触发
    trigger: '触发',
    trigOff: '触发: 关',
    trigOn: '触发: 开',
    edgeRise: '边沿: ↗ 上升沿',
    edgeFall: '边沿: ↘ 下降沿',
    level: 'LEVEL',
    // 信号发生器
    input: '输入',
    freq: 'FREQ',
    amp: 'AMP',
    stereo: '双声道输出',
    speakerOff: '🔈 扬声器: 关',
    speakerOn: '🔊 扬声器: 开',
    // 串口
    serial: '串口连接 SERIAL',
    bps: 'BPS',
    prot: 'PROT',
    connect: '连接串口',
    disconnect: '断开',
    // 音频
    mic: '声卡输入',
    micConnected: '已连接',
    music: '📂 示波器音乐',
    localFile: '↳ 📁 本地上传...',
    time: 'TIME',
    speed: 'SPEED',
    // 主题
    dark: '🌙 深色',
    light: '☀️ 浅色',
    green: '🟢 绿',
    amber: '🟡 琥珀',
    // 测量
    freq: 'Freq',
    vpp: 'Vpp',
    vmax: 'Vmax',
    vmin: 'Vmin',
    vavg: 'Vavg',
    duty: 'Duty',
    rms: 'RMS',
    period: 'Period',
  },
  'en': {
    title: 'WebDSO - Web Oscilloscope',
    panelTitle: 'CONTROL PANEL',
    measure: 'Measure',
    cursor: 'Cursor: Off',
    ytMode: 'Y-T Mode',
    xyMode: 'X-Y Mode',
    math: '🧮 Math: Off',
    mathOn: '🧮 Math: On',
    refSave: '📷 Save Ref',
    refClear: '✕ Clear Ref',
    exportCfg: '📤 Export Config',
    importCfg: '📥 Import Config',
    exportPng: '🖼️ Export PNG',
    run: 'RUN/STOP',
    autoset: 'AUTO',
    fftOff: '📊 FFT (OFF)',
    fftOn: '📊 FFT (ON)',
    vertical: 'VERTICAL',
    selectCh: 'Select CH',
    pos: 'POS',
    scale: 'SCALE',
    cpl: 'CPL',
    horizontal: 'HORIZONTAL',
    secDiv: 'SEC/DIV',
    trigger: 'TRIGGER',
    trigOff: 'Trigger: Off',
    trigOn: 'Trigger: On',
    edgeRise: 'Edge: ↗ Rising',
    edgeFall: 'Edge: ↘ Falling',
    level: 'LEVEL',
    input: 'INPUT',
    freq: 'FREQ',
    amp: 'AMP',
    stereo: 'Stereo Output',
    speakerOff: '🔈 Speaker: Off',
    speakerOn: '🔊 Speaker: On',
    serial: 'SERIAL',
    bps: 'BPS',
    prot: 'PROT',
    connect: 'Connect',
    disconnect: 'Disconnect',
    mic: 'Mic Input',
    micConnected: 'Connected',
    music: '📂 Demo Tracks',
    localFile: '↳ 📁 Local File...',
    time: 'TIME',
    speed: 'SPEED',
    dark: '🌙 Dark',
    light: '☀️ Light',
    green: '🟢 Green',
    amber: '🟡 Amber',
    freq: 'Freq',
    vpp: 'Vpp',
    vmax: 'Vmax',
    vmin: 'Vmin',
    vavg: 'Vavg',
    duty: 'Duty',
    rms: 'RMS',
    period: 'Period',
  }
};

let _currentLocale = 'zh-CN';

export function getLocale() {
  return _currentLocale;
}

export function setLocale(locale) {
  if (LOCALES[locale]) {
    _currentLocale = locale;
    localStorage.setItem('webdso_locale', locale);
  }
}

export function t(key) {
  const locale = LOCALES[_currentLocale] || LOCALES['zh-CN'];
  return locale[key] || key;
}

export { LOCALES };
