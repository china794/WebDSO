/**
 * ==========================================
 * WebGL 着色器库 (Shaders)
 * 包含用于波形抗锯齿渲染的主着色器，以及用于发光特效的后期处理着色器
 * ==========================================
 */

/**
 * 1. 主波形 - 顶点着色器 (Vertex Shader)
 * 负责传递顶点坐标与数据到片段着色器
 */
export const vsSource = `
    attribute vec2 a_position;
    attribute vec3 a_data;
    varying vec3 v_data;

    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_data = a_data;
    }
`;

/**
 * 2. 主波形 - 片段着色器 (Fragment Shader)
 * 包含基于高斯误差函数 (erf) 的高级抗锯齿与线宽渲染算法
 */
export const fsSource = `
    precision highp float;
    
    varying vec3 v_data;
    uniform vec3 u_color;
    uniform float u_size;
    uniform float u_intensity;
    
    #define EPS 1E-6
    #define SQRT2 1.4142135623730951
    
    // 误差函数 (Error Function) 近似实现，用于完美平滑线段边缘
    float erf(float x) {
        float s = sign(x);
        float a = abs(x);
        x = 1.0 + (0.278393 + (0.230389 + (0.000972 + 0.078108 * a) * a) * a) * a;
        x *= x;
        return s - s / (x * x);
    }
    
    void main() {
        float len = v_data.z;
        vec2 xy = v_data.xy;
        float alpha;
        
        // 计算线段发散标准差
        float sigma = u_size / (2.0 + 2.0 * 1000.0 * u_size / 50.0 + 0.0 * pow(u_intensity, 2.0));
        
        // 区分孤立点与连续线段的渲染逻辑
        if (len < EPS) {
            // 渲染圆点
            alpha = exp(-pow(length(xy), 2.0) / (2.0 * sigma * sigma)) / 2.0 / sqrt(u_size);
        } else {
            // 渲染带抗锯齿的线段
            alpha = erf(xy.x / SQRT2 / sigma) - erf((xy.x - len) / SQRT2 / sigma);
            alpha *= exp(-xy.y * xy.y / (2.0 * sigma * sigma)) / 2.0 / len * u_size;
        }
        
        // 计算光晕强度与最终透明度
        float intens = max(0.0, u_intensity - 0.4) * 0.7 - 1000.0 * u_size / 500.0;
        alpha = pow(alpha, 1.0 - intens) * (0.01 + min(0.99, u_intensity * 3.0));
        
        gl_FragColor = vec4(u_color * alpha, alpha);
    }
`;

/**
 * 3. 辉光特效 - 顶点着色器 (Bloom Vertex Shader)
 * 用于生成全屏覆盖的矩形并计算纹理坐标
 */
export const vsBloom = `
    attribute vec2 a_pos;
    varying vec2 v_texCoord;
    
    void main() {
        gl_Position = vec4(a_pos, 0.0, 1.0);
        // 将 NDC 坐标 (-1 到 1) 映射为纹理坐标 (0 到 1)
        v_texCoord = a_pos * 0.5 + 0.5;
    }
`;

/**
 * 4. 辉光特效 - 片段着色器 (Bloom Fragment Shader)
 * 使用多重采样高斯模糊近似算法，生成赛博朋克风格的发光效果
 */
export const fsBloom = `
    precision highp float;
    
    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    uniform vec2 u_texSize;
    
    void main() {
        vec4 baseColor = texture2D(u_texture, v_texCoord);
        vec2 offset = 1.0 / u_texSize;
        vec4 bloom = vec4(0.0);
        float blurSize = 1.5;
        
        // 3x3 核心紧凑模糊采样 (权重总和接近 1.0)
        bloom += texture2D(u_texture, v_texCoord + vec2(-blurSize, -blurSize) * offset) * 0.0625;
        bloom += texture2D(u_texture, v_texCoord + vec2( 0.0,      -blurSize) * offset) * 0.125;
        bloom += texture2D(u_texture, v_texCoord + vec2( blurSize, -blurSize) * offset) * 0.0625;
        bloom += texture2D(u_texture, v_texCoord + vec2(-blurSize,  0.0     ) * offset) * 0.125;
        bloom += baseColor * 0.25;
        bloom += texture2D(u_texture, v_texCoord + vec2( blurSize,  0.0     ) * offset) * 0.125;
        bloom += texture2D(u_texture, v_texCoord + vec2(-blurSize,  blurSize) * offset) * 0.0625;
        bloom += texture2D(u_texture, v_texCoord + vec2( 0.0,       blurSize) * offset) * 0.125;
        bloom += texture2D(u_texture, v_texCoord + vec2( blurSize,  blurSize) * offset) * 0.0625;
        
        // 宽范围扩散采样 (模拟强光光晕扩散)
        vec4 wideBloom = vec4(0.0);
        float spread = 4.0;
        
        wideBloom += texture2D(u_texture, v_texCoord + vec2(-spread,  0.0   ) * offset);
        wideBloom += texture2D(u_texture, v_texCoord + vec2( spread,  0.0   ) * offset);
        wideBloom += texture2D(u_texture, v_texCoord + vec2( 0.0,    -spread) * offset);
        wideBloom += texture2D(u_texture, v_texCoord + vec2( 0.0,     spread) * offset);
        wideBloom *= 0.02;
        
        // 混合原始图像与发光层
        gl_FragColor = baseColor + bloom * 0.6 + wideBloom;
    }
`;