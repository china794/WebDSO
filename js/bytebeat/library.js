/**
 * ==========================================
 * Bytebeat 内置曲库
 * ==========================================
 * 经典 bytebeat 公式集合，覆盖四种模式。
 * 来源：互联网上流传的经典 bytebeat 曲目
 * (参考 dollchan.net/bytebeat 曲库与社区经典)
 */

export const BYTEBEAT_LIBRARY = [
    {
        name: '交响曲 (Symphony)',
        mode: 'Bytebeat',
        sampleRate: 8000,
        code: 't*((t>>12|t>>8)&63&t>>4)'
    },
    {
        name: '经典脉冲',
        mode: 'Bytebeat',
        sampleRate: 8000,
        code: 't*(42&t>>10)'
    },
    {
        name: '拨弦 (Pluck)',
        mode: 'Bytebeat',
        sampleRate: 8000,
        code: '(t*(t>>11&t>>8&123&t>>3))'
    },
    {
        name: '钟声 (Bells)',
        mode: 'Bytebeat',
        sampleRate: 8000,
        code: '(t&t>>8)>>(t>>16)'
    },
    {
        name: '摩托 (Motorcycle)',
        mode: 'Bytebeat',
        sampleRate: 8000,
        code: 't*(t>>8&t>>4)'
    },
    {
        name: '打击乐 (Percussion)',
        mode: 'Bytebeat',
        sampleRate: 8000,
        code: '(t*((t>>5|t>>8)>>(t>>16)))'
    },
    {
        name: '太空 (Space)',
        mode: 'Bytebeat',
        sampleRate: 8000,
        code: '(t>>6&1?t*2:1-t%6)'
    },
    {
        name: '雨声 (Rain)',
        mode: 'Bytebeat',
        sampleRate: 8000,
        code: '(t>>10^t>>9^t>>8^t>>7^t>>6^t>>5^t>>4^t>>3)'
    },
    {
        name: '蜜蜂 (Bee)',
        mode: 'Bytebeat',
        sampleRate: 8000,
        code: '(t>>4)*(t>>10)'
    },
    {
        name: '引擎 (Engine)',
        mode: 'Bytebeat',
        sampleRate: 8000,
        code: 't*(t>>11&t>>13&t>>7)'
    },
    {
        name: '催眠 (Trance)',
        mode: 'Bytebeat',
        sampleRate: 8000,
        code: '(t*5&t>>7)|(t*3&t>>10)'
    },
    {
        name: '经典 8bit (Classic)',
        mode: 'Bytebeat',
        sampleRate: 8000,
        code: '(t*(t>>8|t>>9)&46&t>>8)^(t&t>>13|t>>6)'
    },
    {
        name: '和弦 (Chord)',
        mode: 'Bytebeat',
        sampleRate: 8000,
        code: '(t*((t>>12|t>>8)&63&t>>4))*2+((t>>11&3)*(t>>16&1))'
    },
    {
        name: '幽灵 (Ghost)',
        mode: 'Signed Bytebeat',
        sampleRate: 8000,
        code: '(t*((t>>10|t>>8)&63&t>>4))-128'
    },
    {
        name: '浮点正弦 (Float Sine)',
        mode: 'Floatbeat',
        sampleRate: 8000,
        code: 'Math.sin(t/100)*Math.sin(t/157)'
    },
    {
        name: '浮点和弦 (Float Chord)',
        mode: 'Floatbeat',
        sampleRate: 8000,
        code: 'Math.sin(t/50)+Math.sin(t/77)+Math.sin(t/91)',
    },
    {
        name: '浮点鼓 (Float Kick)',
        mode: 'Floatbeat',
        sampleRate: 8000,
        code: 'Math.sin(t/20)*Math.exp(-t%1000/300)'
    },
    {
        name: '浮点琶音 (Float Arp)',
        mode: 'Floatbeat',
        sampleRate: 8000,
        code: 'Math.sin(t/30*Math.pow(2,(t>>10&7)/12))'
    }
];

/** 默认公式（页面初始加载用） */
export const DEFAULT_BYTEBEAT_CODE = 't*((t>>12|t>>8)&63&t>>4)';
export const DEFAULT_BYTEBEAT_MODE = 'Bytebeat';
export const DEFAULT_BYTEBEAT_SAMPLE_RATE = 8000;
