import { reactive } from 'vue';

/**
 * 字段联动中枢：bindKey -> value
 * 所有带 bindKey 的 field 节点（跨表、跨 Section、跨编辑器实例）经这里同步。
 * 生产环境对应 Pinia store。
 */
export const fieldStore = reactive({
    values: {},
    // 订阅者：bindKey -> Set<fn>
    listeners: {},

    setValue(bindKey, value, source) {
        if (!bindKey) return;
        if (this.values[bindKey] === value) return;
        this.values[bindKey] = value;
        (this.listeners[bindKey] || []).forEach((fn) => {
            if (fn !== source) fn(value);
        });
    },


    subscribe(bindKey, fn) {
        if (!bindKey) return () => {};
        if (!this.listeners[bindKey]) this.listeners[bindKey] = new Set();
        this.listeners[bindKey].add(fn);
        // 首次同步已有值
        if (this.values[bindKey] !== undefined) fn(this.values[bindKey]);
        return () => this.listeners[bindKey]?.delete(fn);
    }
});
