/**
 * ==========================================
 * 轻量级响应式状态管理 (Reactive Store)
 * ==========================================
 * 提供路径取值/设值、变更订阅、批量更新机制
 * 替代全局 STATE 直接读写，逐步迁移
 */

/**
 * 通配符路径匹配
 * "ch*.on" 匹配 "ch1.on", "ch2.on" 等
 */
function matchWildcard(pattern, path) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '[^.]+') + '$');
    return regex.test(path);
}

/**
 * 深层克隆
 */
function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Float32Array) return new Float32Array(obj);
    if (obj instanceof ArrayBuffer) return obj;
    if (Array.isArray(obj)) return obj.map(deepClone);
    const cloned = {};
    for (const key of Object.keys(obj)) {
        cloned[key] = deepClone(obj[key]);
    }
    return cloned;
}

/**
 * 取嵌套对象中的值
 */
function getNested(obj, path) {
    const keys = path.split('.');
    let curr = obj;
    for (const key of keys) {
        if (curr === null || curr === undefined) return undefined;
        curr = curr[key];
    }
    return curr;
}

/**
 * 设嵌套对象中的值
 */
function setNested(obj, path, value) {
    const keys = path.split('.');
    const prop = keys.pop();
    let parent = obj;
    for (const key of keys) {
        if (!(key in parent) || typeof parent[key] !== 'object') {
            parent[key] = {};
        }
        parent = parent[key];
    }
    const oldValue = parent[prop];
    parent[prop] = value;
    return oldValue;
}

export class Store {
    constructor(initialState = {}) {
        // 直接引用外部传入的 state 对象（而非 deepClone）。
        // 这样 STATE 与 store._state 指向同一对象：
        //  - STATE.foo = bar 直接生效，store.get('foo') 能读到
        //  - store.set('foo', bar) 也能真正改到 STATE
        // 原来 deepClone 会让 store 操作一个影子副本，全部 watcher 失效。
        this._state = initialState;
        this._watchers = new Map(); // path → Set<callback>
        this._batchDepth = 0;
        this._pendingNotifications = [];
    }

    /**
     * 读取路径值
     * @param {string} path - 如 'trigger.src' 或 'ch1.scale'
     * @returns {*} 值，路径不存在返回 undefined
     */
    get(path) {
        if (!path) return this._state;
        return getNested(this._state, path);
    }

    /**
     * 设置路径值并通知订阅者
     * @param {string} path - 如 'trigger.src'
     * @param {*} value - 新值
     */
    set(path, value) {
        if (!path || path === '') return;
        const oldValue = setNested(this._state, path, value);
        if (oldValue === value) return;
        if (this._batchDepth > 0) {
            this._pendingNotifications.push({ path, value, oldValue });
        } else {
            this._notify(path, value, oldValue);
        }
    }

    /**
     * 批量更新——多个 set 合并为一次通知
     * @param {Function} fn - 执行更新的函数
     */
    batch(fn) {
        this._batchDepth++;
        try {
            fn();
        } finally {
            this._batchDepth--;
            if (this._batchDepth === 0) {
                this._flushPending();
            }
        }
    }

    /**
     * 订阅路径变更
     * @param {string} path - 路径，支持通配符如 'ch*.on'
     * @param {Function} callback - (newValue, oldValue) => void
     * @returns {Function} 取消订阅函数
     */
    watch(path, callback) {
        if (!this._watchers.has(path)) {
            this._watchers.set(path, new Set());
        }
        this._watchers.get(path).add(callback);
        const store = this;
        return function unsubscribe() {
            const set = store._watchers.get(path);
            if (set) set.delete(callback);
        };
    }

    /**
     * 获取整个状态树的快照（用于序列化/调试）
     */
    snapshot() {
        return deepClone(this._state);
    }

    /**
     * 合并状态（用于导入配置）
     */
    merge(path, partial) {
        const target = path ? getNested(this._state, path) : this._state;
        if (!target || typeof target !== 'object') return;
        this.batch(() => {
            for (const key of Object.keys(partial)) {
                const fullPath = path ? `${path}.${key}` : key;
                this.set(fullPath, partial[key]);
            }
        });
    }

    // ================ 内部 ================

    _notify(path, value, oldValue) {
        // 1. 精确路径订阅
        const exactWatchers = this._watchers.get(path);
        if (exactWatchers) {
            exactWatchers.forEach(cb => {
                try { cb(value, oldValue); } catch (e) { console.error('Store watcher error:', e); }
            });
        }

        // 2. 父路径订阅（如 watch('ch1') 接收 'ch1.scale' 变更）
        const parts = path.split('.');
        for (let i = parts.length - 1; i > 0; i--) {
            const parentPath = parts.slice(0, i).join('.');
            const parentWatchers = this._watchers.get(parentPath);
            if (parentWatchers) {
                const val = getNested(this._state, parentPath);
                parentWatchers.forEach(cb => {
                    try { cb(val, undefined); } catch (e) { console.error('Store watcher error:', e); }
                });
            }
        }

        // 3. 通配符订阅（如 'ch*.on'），排除 '*' 因为它在全局订阅中处理
        for (const [pattern, cbs] of this._watchers) {
            if (pattern !== '*' && pattern.includes('*') && matchWildcard(pattern, path)) {
                cbs.forEach(cb => {
                    try { cb(value, oldValue); } catch (e) { console.error('Store watcher error:', e); }
                });
            }
        }

        // 4. 全局订阅（监听所有变更）
        const allWatchers = this._watchers.get('*');
        if (allWatchers) {
            allWatchers.forEach(cb => {
                try { cb({ path, value, oldValue }); } catch (e) { console.error('Store watcher error:', e); }
            });
        }
    }

    _flushPending() {
        for (const { path, value, oldValue } of this._pendingNotifications) {
            this._notify(path, value, oldValue);
        }
        this._pendingNotifications = [];
    }

    // 调试辅助
    _debug() {
        return {
            state: this._state,
            watcherCount: this._watchers.size,
            watcherPaths: Array.from(this._watchers.keys())
        };
    }
}

/**
 * 创建深度 Proxy 包装，使 store 可像普通对象一样操作
 * 例如: stateProxy.ch1.scale = 4.0 → store.set('ch1.scale', 4.0)
 * 例如: let x = stateProxy.ch1.scale → store.get('ch1.scale')
 *
 * 用于向后兼容：逐步将 STATE.foo = bar 迁移为 store.set('foo', bar)
 */
export function createStateProxy(store, basePath = '') {
    const cache = new Map();

    return new Proxy({}, {
        get(target, prop) {
            if (prop === '__store') return store;
            if (prop === '__isProxy') return true;

            const fullPath = basePath ? `${basePath}.${prop}` : String(prop);

            // 从 cache 取已创建的 proxy
            if (cache.has(fullPath)) return cache.get(fullPath);

            const value = store.get(fullPath);

            // 原始类型、TypedArray、null → 直接返回值
            if (value === null || value === undefined) return undefined;
            if (typeof value !== 'object') return value;
            if (value instanceof Float32Array) return value;
            if (value instanceof ArrayBuffer) return value;
            if (value instanceof Uint8Array) return value;
            if (value instanceof Uint32Array) return value;
            if (value instanceof Int32Array) return value;
            if (value instanceof DataView) return value;

            // 对对象/数组创建嵌套 proxy
            const proxy = createStateProxy(store, fullPath);
            cache.set(fullPath, proxy);
            return proxy;
        },

        set(target, prop, value) {
            const fullPath = basePath ? `${basePath}.${prop}` : String(prop);
            store.set(fullPath, value);

            // 清除相关 cache 条目
            for (const key of cache.keys()) {
                if (key === fullPath || key.startsWith(fullPath + '.')) {
                    cache.delete(key);
                }
            }
            return true;
        },

        deleteProperty(target, prop) {
            const fullPath = basePath ? `${basePath}.${prop}` : String(prop);
            store.set(fullPath, undefined);
            cache.delete(fullPath);
            return true;
        },

        has(target, prop) {
            const fullPath = basePath ? `${basePath}.${prop}` : String(prop);
            return store.get(fullPath) !== undefined;
        },

        ownKeys(target) {
            if (basePath) {
                const obj = store.get(basePath);
                return obj ? Object.keys(obj) : [];
            }
            return Object.keys(store._state);
        },

        getOwnPropertyDescriptor(target, prop) {
            const fullPath = basePath ? `${basePath}.${prop}` : String(prop);
            const value = store.get(fullPath);
            if (value === undefined) return undefined;
            return {
                configurable: true,
                enumerable: true,
                value,
                writable: true
            };
        }
    });
}

export default Store;
