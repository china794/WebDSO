export const vsSource = `
    attribute vec2 a_position; attribute vec3 a_data; varying vec3 v_data;
    void main() { gl_Position = vec4(a_position, 0.0, 1.0); v_data = a_data; }
`;

export const fsSource = `
    precision highp float; varying vec3 v_data; uniform vec3 u_color; uniform float u_size; uniform float u_intensity;
    #define EPS 1E-6
    #define SQRT2 1.4142135623730951
    float erf(float x) {
        float s = sign(x), a = abs(x);
        x = 1.0 + (0.278393 + (0.230389 + (0.000972 + 0.078108 * a) * a) * a) * a;
        x *= x; return s - s / (x * x);
    }
    void main() {
        float len = v_data.z; vec2 xy = v_data.xy; float alpha;
        float sigma = u_size / (2.0 + 2.0 * 1000.0 * u_size / 50.0 + 0.0 * pow(u_intensity, 2.0));
        if (len < EPS) { alpha = exp(-pow(length(xy), 2.0) / (2.0 * sigma * sigma)) / 2.0 / sqrt(u_size); } 
        else { alpha = erf(xy.x / SQRT2 / sigma) - erf((xy.x - len) / SQRT2 / sigma); alpha *= exp(-xy.y * xy.y / (2.0 * sigma * sigma)) / 2.0 / len * u_size; }
        float intens = max(0.0, u_intensity - 0.4) * 0.7 - 1000.0 * u_size / 500.0;
        alpha = pow(alpha, 1.0 - intens) * (0.01 + min(0.99, u_intensity * 3.0));
        gl_FragColor = vec4(u_color * alpha, alpha);
    }
`;

export const vsBloom = `
    attribute vec2 a_pos; varying vec2 v_texCoord;
    void main() { gl_Position = vec4(a_pos, 0.0, 1.0); v_texCoord = a_pos * 0.5 + 0.5; }
`;

export const fsBloom = `
    precision highp float; varying vec2 v_texCoord; uniform sampler2D u_texture; uniform vec2 u_texSize;
    void main() {
        vec4 baseColor = texture2D(u_texture, v_texCoord); vec2 offset = 1.0 / u_texSize; vec4 bloom = vec4(0.0); float blurSize = 1.5;
        bloom += texture2D(u_texture, v_texCoord + vec2(-blurSize, -blurSize) * offset) * 0.0625;
        bloom += texture2D(u_texture, v_texCoord + vec2( 0.0, -blurSize) * offset) * 0.125;
        bloom += texture2D(u_texture, v_texCoord + vec2( blurSize, -blurSize) * offset) * 0.0625;
        bloom += texture2D(u_texture, v_texCoord + vec2(-blurSize,  0.0) * offset) * 0.125;
        bloom += baseColor * 0.25;
        bloom += texture2D(u_texture, v_texCoord + vec2( blurSize,  0.0) * offset) * 0.125;
        bloom += texture2D(u_texture, v_texCoord + vec2(-blurSize,  blurSize) * offset) * 0.0625;
        bloom += texture2D(u_texture, v_texCoord + vec2( 0.0,  blurSize) * offset) * 0.125;
        bloom += texture2D(u_texture, v_texCoord + vec2( blurSize,  blurSize) * offset) * 0.0625;
        vec4 wideBloom = vec4(0.0); float spread = 4.0;
        wideBloom += texture2D(u_texture, v_texCoord + vec2(-spread, 0.0) * offset);
        wideBloom += texture2D(u_texture, v_texCoord + vec2( spread, 0.0) * offset);
        wideBloom += texture2D(u_texture, v_texCoord + vec2(0.0, -spread) * offset);
        wideBloom += texture2D(u_texture, v_texCoord + vec2(0.0,  spread) * offset); wideBloom *= 0.02;
        gl_FragColor = baseColor + bloom * 0.6 + wideBloom;
    }
`;