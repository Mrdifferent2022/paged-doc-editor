/**
 * doc-editor 用户提醒通道（2026-09-23）：编辑器包不假设宿主 UI 库——
 * 宿主用 setDocEditorNotifier 注入 toast；demo/未注入时
 * error 兜底 alert、warn 兜底 console.warn（与既有行为一致）。
 *
 * 用法（宿主 setup）：
 *   setDocEditorNotifier((severity, message) => toast.add({ severity, summary: 'CAD 图纸', detail: message, life: 4000 }));
 */

let notifier = null;

/** @param {(severity: 'warn'|'error', message: string) => void} fn */
export const setDocEditorNotifier = (fn) => { notifier = fn; };

export const notify = {
    warn: (msg) => (notifier ? notifier('warn', msg) : console.warn(msg)),
    error: (msg) => (notifier ? notifier('error', msg) : alert(msg))
};
