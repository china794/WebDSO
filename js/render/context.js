/**
 * ==========================================
 * Render Context — 渲染上下文共享模块
 * ==========================================
 * 持有 Canvas2D / WebGL 上下文及 WebGL 资源变量，
 * 供所有渲染子模块引用，消除 render/index.js 与
 * 子模块之间的循环依赖。
 *
 * 所有变量通过 initRenderContext() 一次性初始化。
 */

// Canvas 2D 上下文
export let ctx2d = null;

// WebGL 上下文
export let gl = null;

// WebGL 程序和资源（延迟初始化）
export let shaderProgram = null;
export let bloomProgram = null;
export let posAttrBloom = null;
export let texUniBloom = null;
export let texSizeUniBloom = null;
export let quadVBO = null;
export let fbo = null;
export let fboTexture = null;
export let currentFboWidth = 0;
export let currentFboHeight = 0;

// 余辉合成 (composite) 资源
export let compositeProgram = null;
export let posAttrComposite = null;
export let texUniComposite = null;
export let tonemapUniComposite = null;
// HDR 半浮点纹理支持（运行时检测）
export let fboHDR = false;
// 每帧余辉衰减量（由 webglRenderer 设置）
let _phosphorDecay = 0.06;

/** 是否已初始化 */
let _initialized = false;

/**
 * 初始化渲染上下文
 * @param {HTMLCanvasElement} oscCanvas - Canvas 2D 画布 (oscilloscope)
 * @param {HTMLCanvasElement} glCanvas - WebGL 画布 (gl-canvas)
 * @returns {boolean} 是否成功
 */
export function initRenderContext(oscCanvas, glCanvas) {
    if (_initialized) return true;

    if (!oscCanvas || !glCanvas) {
        console.error('Canvas elements not provided');
        return false;
    }

    ctx2d = oscCanvas.getContext('2d', { alpha: true });
    gl = glCanvas.getContext('webgl', { alpha: false, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: true });

    if (!ctx2d || !gl) {
        console.error('Failed to get canvas context');
        ctx2d = null;
        gl = null;
        return false;
    }

    // WebGL 上下文丢失事件
    glCanvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        console.warn('WebGL context lost');
        _initialized = false;
    }, false);
    glCanvas.addEventListener('webglcontextrestored', () => {
        console.warn('WebGL context restored — reinitializing');
        // 通知 webglRenderer 清空缓存的 attrib location / VBO（新 context 上已失效）
        if (typeof window.__WEBDSO_RESET_WEBGL === 'function') {
            window.__WEBDSO_RESET_WEBGL();
        }
        initWebGLResources();
        if (!gl || !shaderProgram || !gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
            console.error('WebGL 恢复失败 — 着色器无效');
            _initialized = false;
            return;
        }
        _initialized = true;
        console.log('WebGL 上下文已成功恢复');
    }, false);

    initWebGLResources();

    _initialized = true;
    return true;
}

/**
 * 检查是否已初始化
 */
export function isInitialized() {
    return _initialized;
}

/**
 * 重置初始化状态（用于重新初始化）
 */
export function resetInitialized() {
    _initialized = false;
}

// ========== WebGL 资源初始化 ==========

/**
 * 编译单个着色器
 */
function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        return null;
    }
    return shader;
}

/**
 * 初始化 WebGL 资源（着色器、VBO、FBO）
 */
function initWebGLResources() {
    if (!gl) return;

    // 仅在首次或重建时导入着色器源码
    // 使用动态导入避免模块加载时的依赖
    const { vsSource, fsSource, vsBloom, fsBloom } = window.__WEBDSO_SHADERS || {};
    if (!vsSource || !fsSource) {
        console.error('Shaders not loaded — call loadShaders() first');
        return;
    }

    shaderProgram = gl.createProgram();
    const vsShader = createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fsShader = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (vsShader && fsShader) {
        gl.attachShader(shaderProgram, vsShader);
        gl.attachShader(shaderProgram, fsShader);
        gl.linkProgram(shaderProgram);
        if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
            console.error('Shader program link error:', gl.getProgramInfoLog(shaderProgram));
        }
    }

    bloomProgram = gl.createProgram();
    const vsBloomShader = createShader(gl, gl.VERTEX_SHADER, vsBloom);
    const fsBloomShader = createShader(gl, gl.FRAGMENT_SHADER, fsBloom);
    if (vsBloomShader && fsBloomShader) {
        gl.attachShader(bloomProgram, vsBloomShader);
        gl.attachShader(bloomProgram, fsBloomShader);
        gl.linkProgram(bloomProgram);
        if (!gl.getProgramParameter(bloomProgram, gl.LINK_STATUS)) {
            console.error('Bloom program link error:', gl.getProgramInfoLog(bloomProgram));
        }
    }

    posAttrBloom = gl.getAttribLocation(bloomProgram, 'a_pos');
    texUniBloom = gl.getUniformLocation(bloomProgram, 'u_texture');
    texSizeUniBloom = gl.getUniformLocation(bloomProgram, 'u_texSize');

    quadVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1.0, -1.0, 1.0, -1.0, -1.0, 1.0,
        -1.0, 1.0, 1.0, -1.0, 1.0, 1.0
    ]), gl.STATIC_DRAW);

    fbo = gl.createFramebuffer();
    fboTexture = gl.createTexture();

    // 余辉合成着色器：采样累积 FBO → HDR 色调映射 → 屏幕
    const { vsComposite, fsComposite } = window.__WEBDSO_SHADERS || {};
    compositeProgram = gl.createProgram();
    if (vsComposite && fsComposite) {
        const vsCShader = createShader(gl, gl.VERTEX_SHADER, vsComposite);
        const fsCShader = createShader(gl, gl.FRAGMENT_SHADER, fsComposite);
        if (vsCShader && fsCShader) {
            gl.attachShader(compositeProgram, vsCShader);
            gl.attachShader(compositeProgram, fsCShader);
            gl.linkProgram(compositeProgram);
            if (!gl.getProgramParameter(compositeProgram, gl.LINK_STATUS)) {
                console.error('Composite program link error:', gl.getProgramInfoLog(compositeProgram));
                compositeProgram = null;
            }
        }
    } else {
        compositeProgram = null;
    }
    if (compositeProgram) {
        posAttrComposite = gl.getAttribLocation(compositeProgram, 'a_pos');
        texUniComposite = gl.getUniformLocation(compositeProgram, 'u_texture');
        tonemapUniComposite = gl.getUniformLocation(compositeProgram, 'u_tonemap');
    }

    // HDR 能力检测：half-float 纹理可作渲染目标才启用
    const hfColor = gl.getExtension('EXT_color_buffer_half_float');
    const hfTex = gl.getExtension('OES_texture_half_float');
    fboHDR = !!(hfColor && hfTex);

    gl.enable(gl.BLEND);
}

/** 设置余辉衰减量（供 webglRenderer 每帧调用） */
export function setPhosphorDecay(decay) {
    _phosphorDecay = decay;
}

/** 读取当前余辉衰减量 */
export function getPhosphorDecay() {
    return _phosphorDecay;
}

/**
 * 检查尺寸变化并重新分配 FBO
 * @param {number} w - 新宽度
 * @param {number} h - 新高度
 * @returns {boolean} 尺寸是否变化
 */
export function checkResizeFBO(w, h) {
    if (!gl || !fbo || !fboTexture) return false;
    if (w === currentFboWidth && h === currentFboHeight) return false;
    currentFboWidth = w;
    currentFboHeight = h;
    gl.bindTexture(gl.TEXTURE_2D, fboTexture);
    if (fboHDR) {
        // half-float 纹理：HDR 累积，重叠处可超亮
        const hfExt = gl.getExtension('OES_texture_half_float');
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, hfExt.HALF_FLOAT_OES, null);
    } else {
        // 降级 RGBA8：普通余辉（无法超亮）
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
}

/** 调整 FBO 尺寸（仅调用时，由 checkResizeFBO 内置检测） */
export function resizeFBO(w, h) {
    checkResizeFBO(w, h);
}
