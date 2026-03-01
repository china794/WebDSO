/**
 * ==========================================
 * Serial Controller - 串口控制器
 * ==========================================
 * 负责处理串口通信、协议解析
 */

// TODO: 实现串口控制逻辑
import { STATE, DOM, showSysModal } from '../core.js';
import { SerialEngine } from '../serial.js';
import { initAudio, AudioState } from '../audio.js';

export function initSerialController() {
    if (DOM.btnSerialOpen) {
        DOM.btnSerialOpen.addEventListener('click', () => SerialEngine.connect());
    }

    if (DOM.btnSerialClose) {
        DOM.btnSerialClose.addEventListener('click', () => SerialEngine.disconnect());
    }

    if (DOM.serialProtocol) {
        DOM.serialProtocol.addEventListener('change', () => {
            SerialEngine.rawBuffer = [];
            SerialEngine.textBuffer = '';
        });
    }

    if (DOM.serialBaud) {
        DOM.serialBaud.addEventListener('change', () => {
            const baud = parseInt(DOM.serialBaud.value);
            console.log(`波特率已选择: ${baud} bps`);
            // 只记录日志，不改变任何状态
            // 真正的模式切换在点击连接按钮时进行
        });
    }
    
    // 监听串口连接状态，控制波特率选择器显示/隐藏
    // 使用状态监听而不是包装函数，避免多次包装的问题
    const checkSerialStatus = () => {
        if (DOM.serialBaud) {
            if (STATE.serial.connected) {
                // 连接中：禁用选择器
                DOM.serialBaud.disabled = true;
                DOM.serialBaud.style.opacity = '0.5';
            } else {
                // 未连接：启用选择器
                DOM.serialBaud.disabled = false;
                DOM.serialBaud.style.opacity = '1';
            }
        }
    };
    
    // 定期检查状态（每100ms）
    setInterval(checkSerialStatus, 100);

    STATE.serial.speaker = false;
    const btnSerialSpk = document.getElementById('btn-serial-spk');
    if (btnSerialSpk) {
        btnSerialSpk.addEventListener('click', () => {
            initAudio(); 
            if (AudioState.audioCtx && AudioState.audioCtx.state === 'suspended') {
                AudioState.audioCtx.resume();
            }
            
            STATE.serial.speaker = !STATE.serial.speaker;
            
            if (STATE.serial.speaker) {
                btnSerialSpk.innerText = '🔊 监听中';
                btnSerialSpk.classList.add('active');
                SerialEngine.audioNextTime = 0; 
            } else {
                btnSerialSpk.innerText = '🔈 监听';
                btnSerialSpk.classList.remove('active');
                SerialEngine.audioAccumL = [];
                SerialEngine.audioAccumR = [];
            }
        });
    }

    if (DOM.serialOutLeft) {
        DOM.serialOutLeft.addEventListener('change', (e) => {
            STATE.serialOutL = parseInt(e.target.value);
            initAudio();
        });
    }
    if (DOM.serialOutRight) {
        DOM.serialOutRight.addEventListener('change', (e) => {
            STATE.serialOutR = parseInt(e.target.value);
            initAudio();
        });
    }
}