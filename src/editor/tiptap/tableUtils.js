/**
 * 表格公共工具（TableFloatingMenu / TableWidthClamp / 表格菜单共用）：
 * - colwidth 语义：单元格 colwidth 数组按 colspan 计，Σ首行 = 表格总宽（PM 表格恒为矩形，首行必覆盖所有列）
 * - 表格可用宽 = .tableWrapper 的 clientWidth（zoom 是 CSS zoom 属性，clientWidth 与 colwidth 同单位空间，直接可比）
 */

// 选区所在的表格 { depth, pos, node }；不在表格内返回 null
export const findTable = ($from) => {
    for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'table') return { depth: d, pos: $from.before(d), node: $from.node(d) };
    }
    return null;
};

// 首行全列 colwidth 总和；任一 cell 宽度信息不完整（无 colwidth 或数组长度 != colspan）返回 null ——
// 那种情况 CSS 100% 自适应，无需收缩/钳制。注意必须累加整个数组：colspan=2 colwidth=[100,100] 实际占 200px
export const colwidthTotal = (table) => {
    const firstRow = table.firstChild;
    if (!firstRow) return null;
    let total = 0;
    let missing = false;
    firstRow.forEach((cell) => {
        const cw = cell.attrs.colwidth;
        if (Array.isArray(cw) && cw.length === cell.attrs.colspan) total += cw.reduce((a, b) => a + b, 0);
        else missing = true;
    });
    return missing ? null : total;
};

// 按比例缩放整表 colwidth（下限 min），写进传入的 tr；返回是否有实际变更（触底无变更时调用方应 bail，防死循环）
export const scaleTableColwidths = (tr, tablePos, table, ratio, min = 20) => {
    let changed = false;
    let rowPos = tablePos + 1;
    table.forEach((row) => {
        let cellPos = rowPos + 1;
        row.forEach((cell) => {
            const cw = cell.attrs.colwidth;
            if (cw?.length) {
                const nw = cw.map((w) => Math.max(min, Math.round(w * ratio)));
                if (nw.some((w, i) => w !== cw[i])) {
                    tr.setNodeMarkup(cellPos, undefined, { ...cell.attrs, colwidth: nw });
                    changed = true;
                }
            }
            cellPos += cell.nodeSize;
        });
        rowPos += row.nodeSize;
    });
    return changed;
};

// 表格可用宽度（px）：编辑态 node view 的 dom 即 .tableWrapper（100% 宽 block，其 clientWidth 就是表格预算）
export const tableLimitPx = (view, tablePos) => {
    const wrapper = view.nodeDOM(tablePos);
    return wrapper && wrapper.nodeType === 1 ? wrapper.clientWidth : null;
};
