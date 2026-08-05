/**
 * ==========================================
 * Bytebeat 简易 IDE 编辑器 (overlay 三层)
 * ==========================================
 * 透明 textarea 覆盖在高亮的 pre 上, 左侧行号栏独立滚动。
 * 零依赖手写 tokenizer, 针对 bytebeat 代码(JS 表达式)特征高亮。
 *
 * 结构:
 *   .bytebeat-editor
 *     ├── .bb-line-nums   (行号, 独立滚动)
 *     ├── .bb-highlight   (高亮 pre, 只读展示)
 *     └── textarea#bytebeat-code (透明文字, 接收输入)
 */

/** 转义 HTML 特殊字符, 防止破坏布局 */
function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 内置 Math 函数名 (高亮为蓝色) */
const MATH_FUNCS = new Set([
    'abs','acos','acosh','asin','asinh','atan','atan2','atanh','cbrt','ceil',
    'clz32','cos','cosh','exp','expm1','floor','fround','hypot','imul','log',
    'log10','log1p','log2','max','min','pow','random','round','sign','sin',
    'sinh','sqrt','tan','tanh','trunc'
]);

/** JS 关键字 (bytebeat 公式常用的) */
const KEYWORDS = new Set([
    'this','var','let','const','if','else','while','for','return','function',
    'true','false','null','undefined','new','typeof','instanceof','switch','case','break'
]);

/**
 * 轻量 tokenizer: 把 bytebeat 代码转成带高亮 class 的 HTML。
 * 扫描顺序: 字符串 → 注释 → 数字 → 标识符 → 运算符 → 括号 → 其他。
 */
export function tokenizeToHtml(code) {
    let html = '';
    let i = 0;
    const n = code.length;

    while (i < n) {
        const ch = code[i];

        // 块注释 /* */
        if (ch === '/' && code[i + 1] === '*') {
            const end = code.indexOf('*/', i + 2);
            const j = end === -1 ? n : end + 2;
            html += '<span class="bb-hl-comment">' + escapeHtml(code.slice(i, j)) + '</span>';
            i = j;
            continue;
        }
        // 行注释 //
        if (ch === '/' && code[i + 1] === '/') {
            const end = code.indexOf('\n', i + 2);
            const j = end === -1 ? n : end;
            html += '<span class="bb-hl-comment">' + escapeHtml(code.slice(i, j)) + '</span>';
            i = j;
            continue;
        }
        // 字符串 (单双引号)
        if (ch === '"' || ch === "'" || ch === '`') {
            let j = i + 1;
            while (j < n && code[j] !== ch) {
                if (code[j] === '\\') j++;
                j++;
            }
            j = Math.min(j + 1, n);
            html += '<span class="bb-hl-string">' + escapeHtml(code.slice(i, j)) + '</span>';
            i = j;
            continue;
        }
        // 数字 (十进制 + 十六进制 + 科学计数)
        if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(code[i + 1] || ''))) {
            let j = i;
            if (code[j] === '0' && (code[j + 1] === 'x' || code[j + 1] === 'X')) {
                j += 2;
                while (j < n && /[0-9a-fA-F]/.test(code[j])) j++;
            } else {
                while (j < n && /[0-9.]/.test(code[j])) j++;
                if (code[j] === 'e' || code[j] === 'E') {
                    j++;
                    if (code[j] === '+' || code[j] === '-') j++;
                    while (j < n && /[0-9]/.test(code[j])) j++;
                }
            }
            html += '<span class="bb-hl-num">' + escapeHtml(code.slice(i, j)) + '</span>';
            i = j;
            continue;
        }
        // 标识符 (字母/下划线/$)
        if (/[a-zA-Z_$]/.test(ch)) {
            let j = i;
            while (j < n && /[a-zA-Z0-9_$]/.test(code[j])) j++;
            const word = code.slice(i, j);
            if (MATH_FUNCS.has(word)) {
                html += '<span class="bb-hl-func">' + escapeHtml(word) + '</span>';
            } else if (KEYWORDS.has(word)) {
                html += '<span class="bb-hl-keyword">' + escapeHtml(word) + '</span>';
            } else {
                html += escapeHtml(word);
            }
            i = j;
            continue;
        }
        // 运算符 (多字符优先: >>>=, ===, >>= 等)
        const op3 = code.slice(i, i + 4);
        const op2 = code.slice(i, i + 3);
        const op1 = code.slice(i, i + 2);
        const OPS = /^(>>>|===|!==|<<=|>>=|>>>|\*\*|=>|==|!=|<=|>=|&&|\|\||\?\?|\+\+|--|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|<<|>>|\?)/;
        if (OPS.test(op3)) {
            html += '<span class="bb-hl-op">' + escapeHtml(op3.slice(0, 3)) + '</span>';
            i += 3;
            continue;
        }
        if (OPS.test(op2)) {
            html += '<span class="bb-hl-op">' + escapeHtml(op2.slice(0, 2)) + '</span>';
            i += 2;
            continue;
        }
        if (OPS.test(op1)) {
            html += '<span class="bb-hl-op">' + escapeHtml(op1.slice(0, 1)) + '</span>';
            i += 1;
            continue;
        }
        // 括号
        if (ch === '(' || ch === ')' || ch === '[' || ch === ']' || ch === '{' || ch === '}') {
            html += '<span class="bb-hl-paren">' + escapeHtml(ch) + '</span>';
            i++;
            continue;
        }
        // 其他字符 (空格、换行等) 原样输出
        html += escapeHtml(ch);
        i++;
    }
    return html;
}

/**
 * 初始化 bytebeat 简易 IDE 编辑器。
 * @param {HTMLTextAreaElement} ta  透明 textarea
 * @param {HTMLElement} nums        行号栏
 * @param {HTMLElement} hl          高亮 pre
 * @param {number} [minHeight]      最小高度 px
 * @returns {{ refresh: () => void }}
 */
export function initBytebeatEditor(ta, nums, hl, minHeight = 160) {
    const LINE_H = 19.5; // 13px 字体 × 1.5 行高
    // 等宽字体 Courier New 13px 实测字符宽 7.801px。
    // 折行实际字符数比 宽/字宽 略少 (break-word 在符号处提前折行), 用安全系数收紧。
    const CHAR_W = 7.801;
    const WRAP_SAFETY = 0.92; // 实测 848px 宽实际每行 ~100 字符, 理论 108.7, 系数 ~0.92

    /** 容器内容宽度: textarea clientWidth - padding 左右 (46 + 10) */
    function contentWidth() {
        return Math.max(80, (ta.clientWidth || 280) - 56);
    }

    /** 每行可容纳字符数 (基于容器宽度 + 等宽字符宽 + 安全系数) */
    function charsPerVisualLine() {
        return Math.max(10, Math.floor(contentWidth() / CHAR_W * WRAP_SAFETY));
    }

    /** 单行的视觉折行数 (长行 wrap 成多行, 至少 1) */
    function visualRowsOfLine(line) {
        const cpl = charsPerVisualLine();
        // 按字符数估算折行 (tab 按 4 字符算, 中文等宽字符忽略)
        const eff = line.length + (line.match(/\t/g) || []).length * 3;
        return Math.max(1, Math.ceil(eff / cpl));
    }

    /**
     * 估算整段代码的视觉行总数: 长行会 wrap 成多行, 光数 \n 不够。
     * 基于容器实际宽度 + 等宽字符宽 + 安全系数, 保证长行粘贴后输入框撑够高度。
     */
    function visualLineCount(text) {
        let count = 0;
        const lines = text.split('\n');
        for (const line of lines) count += visualRowsOfLine(line);
        return count;
    }

    /** 重新计算高度: 视觉行数 × 行高 + padding(上下各 10px)
     * 高度完全跟随内容增长 (不设上限), 容器随 textarea 撑高,
     * 行号栏/高亮层 absolute 跟随容器, 三层始终对齐无裁剪。 */
    function autoHeight() {
        const lineCount = visualLineCount(ta.value);
        const h = Math.max(minHeight, lineCount * LINE_H + 20);
        ta.style.height = h + 'px';
    }

    /** 渲染行号 + 高亮
     * 行号栏按视觉折行渲染: 每行折成 N 个视觉行, 行号栏对应 N 个元素
     * (首个显示行号, 后续折行空占位), 保证行号与视觉行垂直对齐不错位。 */
    function render() {
        // 高亮
        hl.innerHTML = tokenizeToHtml(ta.value);

        // 行号 (按视觉折行)
        const lines = ta.value.split('\n');
        let numsHtml = '';
        const caretLine = getCaretLine();
        let visualRow = 0;
        for (let i = 0; i < lines.length; i++) {
            const rows = visualRowsOfLine(lines[i]);
            for (let r = 0; r < rows; r++) {
                const isFirstOfRow = r === 0;
                const isCaret = (i === caretLine && r === 0);
                numsHtml += '<span class="bb-ln' + (isCaret ? ' current' : '') + '">'
                    + (isFirstOfRow ? (i + 1) : '&nbsp;')
                    + '</span>';
                visualRow++;
            }
        }
        nums.innerHTML = numsHtml;
    }

    /** 计算光标所在行 (0-based) */
    function getCaretLine() {
        const start = ta.selectionStart;
        return ta.value.slice(0, start).split('\n').length - 1;
    }

    // 事件绑定
    ta.addEventListener('input', () => { autoHeight(); render(); });
    // 粘贴后强制刷新: Chrome 的 input 事件在粘贴大段代码时可能滞后/分批触发,
    // 直接监听 paste 在内容写入后立即重算高度 + 渲染, 确保输入框一定加长。
    ta.addEventListener('paste', () => {
        // 让出事件循环让浏览器完成粘贴写入, 再重算
        requestAnimationFrame(() => { autoHeight(); render(); });
        setTimeout(() => { autoHeight(); render(); }, 50);
    });
    ta.addEventListener('keyup', render);          // 光标移动时更新当前行高亮
    ta.addEventListener('click', render);
    ta.addEventListener('select', render);

    // 初始渲染
    autoHeight();
    render();

    return {
        /** 外部(如曲库选择)设置代码后调用, 同步编辑器视觉 */
        refresh() {
            autoHeight();
            render();
        }
    };
}
