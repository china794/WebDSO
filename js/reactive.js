/**
 * ==========================================
 * 响应式状态管理模块 (Reactive State Management)
 * ==========================================
 * 提供简单的发布-订阅模式状态管理
 * 替代手动 DOM 更新，实现状态变更自动同步 UI
 */

/**
 * 创建响应式状态对象
 * @param {Object} initialState - 初始状态
 * @returns {Object} 响应式状态对象
 */
export function createReactiveState(initialState = {}) {
    const state = { ...initialState };
    const listeners = new Map();

    const proxy = new Proxy(state, {
        set(target, key, value) {
            const oldValue = target[key];
            if (oldValue !== value) {
                target[key] = value;
                // 触发该属性的监听器
                if (listeners.has(key)) {
                    listeners.get(key).forEach(callback => {
                        try {
                            callback(value, oldValue, key);
                        } catch (e) {
                            console.error(`Reactive state listener error for ${key}:`, e);
                        }
                    });
                }
                // 触发通配符监听器
                if (listeners.has('*')) {
                    listeners.get('*').forEach(callback => {
                        try {
                            callback(key, value, oldValue);
                        } catch (e) {
                            console.error(`Reactive state wildcard listener error:`, e);
                        }
                    });
                }
            }
            return true;
        },
        get(target, key) {
            return target[key];
        }
    });

    /**
     * 订阅状态变更
     * @param {string|Function} key - 属性名或通配符 '*'
     * @param {Function} callback - 回调函数 (newValue, oldValue, key) => void
     * @returns {Function} 取消订阅函数
     */
    proxy.$subscribe = (key, callback) => {
        if (typeof key === 'function') {
            callback = key;
            key = '*';
        }
        if (!listeners.has(key)) {
            listeners.set(key, new Set());
        }
        listeners.get(key).add(callback);

        // 返回取消订阅函数
        return () => {
            if (listeners.has(key)) {
                listeners.get(key).delete(callback);
            }
        };
    };

    /**
     * 批量更新状态
     * @param {Object} updates - 更新对象
     */
    proxy.$batch = (updates) => {
        Object.entries(updates).forEach(([key, value]) => {
            state[key] = value;
        });
        // 批量触发监听器
        Object.keys(updates).forEach(key => {
            if (listeners.has(key)) {
                listeners.get(key).forEach(callback => {
                    try {
                        callback(state[key], undefined, key);
                    } catch (e) {
                        console.error(`Reactive state batch update error for ${key}:`, e);
                    }
                });
            }
        });
        if (listeners.has('*')) {
            listeners.get('*').forEach(callback => {
                try {
                    Object.entries(updates).forEach(([key, value]) => {
                        callback(key, value, undefined);
                    });
                } catch (e) {
                    console.error(`Reactive state batch wildcard error:`, e);
                }
            });
        }
    };

    /**
     * 获取当前状态的快照
     * @returns {Object}
     */
    proxy.$snapshot = () => ({ ...state });

    return proxy;
}

/**
 * 创建计算属性
 * @param {Function} getter - 计算函数
 * @param {Array} deps - 依赖的响应式状态数组
 * @returns {Object} 计算属性对象 { value, dispose }
 */
export function createComputed(getter, deps = []) {
    let value = getter();
    const listeners = new Set();

    const update = () => {
        const newValue = getter();
        if (newValue !== value) {
            const oldValue = value;
            value = newValue;
            listeners.forEach(callback => {
                try {
                    callback(value, oldValue);
                } catch (e) {
                    console.error('Computed property listener error:', e);
                }
            });
        }
    };

    // 订阅所有依赖
    const unsubscribes = deps.map(dep => {
        if (dep && dep.$subscribe) {
            return dep.$subscribe('*', update);
        }
        return null;
    }).filter(Boolean);

    return {
        get value() { return value; },
        subscribe(callback) {
            listeners.add(callback);
            return () => listeners.delete(callback);
        },
        dispose() {
            unsubscribes.forEach(unsub => unsub());
            listeners.clear();
        }
    };
}

/**
 * 创建 DOM 绑定助手
 * 将响应式状态自动绑定到 DOM 元素
 */
export const DOMBinding = {
    /**
     * 绑定文本内容
     * @param {Object} state - 响应式状态
     * @param {string} key - 状态键名
     * @param {HTMLElement} element - DOM 元素
     * @param {Function} transform - 可选的转换函数
     * @returns {Function} 取消绑定函数
     */
    text(state, key, element, transform = v => v) {
        return state.$subscribe(key, (value) => {
            if (element) {
                element.textContent = transform(value);
            }
        });
    },

    /**
     * 绑定输入值（双向）
     * @param {Object} state - 响应式状态
     * @param {string} key - 状态键名
     * @param {HTMLInputElement} element - 输入元素
     * @returns {Function} 取消绑定函数
     */
    input(state, key, element) {
        // 状态 -> DOM
        const unsub = state.$subscribe(key, (value) => {
            if (element && element.value !== String(value)) {
                element.value = value;
            }
        });

        // DOM -> 状态
        const handler = (e) => {
            const value = element.type === 'number' ? parseFloat(e.target.value) : e.target.value;
            state[key] = value;
        };
        element.addEventListener('input', handler);
        element.addEventListener('change', handler);

        return () => {
            unsub();
            element.removeEventListener('input', handler);
            element.removeEventListener('change', handler);
        };
    },

    /**
     * 绑定样式类
     * @param {Object} state - 响应式状态
     * @param {string} key - 状态键名
     * @param {HTMLElement} element - DOM 元素
     * @param {string} className - 类名
     * @returns {Function} 取消绑定函数
     */
    class(state, key, element, className) {
        return state.$subscribe(key, (value) => {
            if (element) {
                element.classList.toggle(className, Boolean(value));
            }
        });
    },

    /**
     * 绑定可见性
     * @param {Object} state - 响应式状态
     * @param {string} key - 状态键名
     * @param {HTMLElement} element - DOM 元素
     * @returns {Function} 取消绑定函数
     */
    visible(state, key, element) {
        return state.$subscribe(key, (value) => {
            if (element) {
                element.style.display = value ? '' : 'none';
            }
        });
    },

    /**
     * 绑定属性
     * @param {Object} state - 响应式状态
     * @param {string} key - 状态键名
     * @param {HTMLElement} element - DOM 元素
     * @param {string} attr - 属性名
     * @returns {Function} 取消绑定函数
     */
    attr(state, key, element, attr) {
        return state.$subscribe(key, (value) => {
            if (element) {
                element.setAttribute(attr, value);
            }
        });
    }
};

/**
 * 创建事件总线
 * 用于模块间通信
 */
export function createEventBus() {
    const events = new Map();

    return {
        /**
         * 订阅事件
         * @param {string} event - 事件名
         * @param {Function} callback - 回调函数
         * @returns {Function} 取消订阅函数
         */
        on(event, callback) {
            if (!events.has(event)) {
                events.set(event, new Set());
            }
            events.get(event).add(callback);
            return () => this.off(event, callback);
        },

        /**
         * 取消订阅
         * @param {string} event - 事件名
         * @param {Function} callback - 回调函数
         */
        off(event, callback) {
            if (events.has(event)) {
                events.get(event).delete(callback);
            }
        },

        /**
         * 触发事件
         * @param {string} event - 事件名
         * @param {*} data - 事件数据
         */
        emit(event, data) {
            if (events.has(event)) {
                events.get(event).forEach(callback => {
                    try {
                        callback(data);
                    } catch (e) {
                        console.error(`Event bus error for ${event}:`, e);
                    }
                });
            }
        },

        /**
         * 订阅一次性事件
         * @param {string} event - 事件名
         * @param {Function} callback - 回调函数
         */
        once(event, callback) {
            const onceCallback = (data) => {
                this.off(event, onceCallback);
                callback(data);
            };
            this.on(event, onceCallback);
        },

        /**
         * 清除所有事件监听
         */
        clear() {
            events.clear();
        }
    };
}

// 创建全局事件总线实例
export const eventBus = createEventBus();
