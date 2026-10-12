import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state';
import { GapCursor } from '@tiptap/pm/gapcursor';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * visualPagination —— 自研块级视觉分页（编辑态专用，不进 JSON，服务端渲染零影响）
 *
 * 整页模型（每页在版式上严格等于一张纸高）：
 * - 宿主提供的一页可用内容高 C = 纸高 − 上下边距 − 页眉条 − 页脚条（页眉页脚条高度由宿主实测传入）；
 * - 页间隙 = 本页剩余空白填充(fillPx) + 页脚条 + 下边距白条 + 灰缝 + 上边距白条 + 页眉条，
 *   因此每一页占高恒为：上边距 + 页眉 + C + 页脚 + 下边距 = 纸高，灰缝恰好落在纸张边界上；
 * - 文档末尾追加"末页填充"(renderTail)，把纸张底部的页脚条钉在最后一页页底 → 末页也是整页。
 *
 * 高度记账（关键，差 1px 页界就漂）：
 * - offsetHeight **不含块级外边距**，而 .ProseMirror 的 p/h1/h2/table 都有上下 margin，
 *   不记账会每块少算 ~10-30px，几页之后灰缝就落到页面中间（"局部分页"观感的根因）；
 * - 相邻块的垂直外边距按 CSS 规则折叠：块间取 max(上块 mb, 本块 mt)；
 *   块紧贴页间隙/末页填充装饰时，其外侧外边距不再折叠，完整计入。
 *
 * 稳定性（与爆炸的 pagination-plus 根本不同）：
 * - 只在**块边界**插装饰，块高度不受装饰影响 → 一遍解析式扫描即定，无反馈循环；
 * - 重算走 rAF 去抖 + meta 事务回写 DecorationSet（meta 事务 doc 不变，不会再次触发重算）。
 *
 * 近似与边界（定版分页永远以 Chromium 打印为准）：
 * - 表格跨页界即走"行边界软分页"（不必整表超一页高）：为每个页界选不超过它的最晚行边界，
 *   把该行加高造出页间隙空间，与 Word/Chromium 的行界流动一致，避免"整表跳页"的突兀跳变；
 *   页界落在单行内部（单行超高）时回退：整表≤一页则整表跳页，整表超一页则画虚线跨页指示；
 * - 比一页还高的非表格块：不硬拆，画虚线跨页指示；
 *   其高度照常按页取模累计 → 后续块的页码、末页填充与纸张边界保持对齐，纸张总高仍是纸高整数倍。
 */
const key = new PluginKey('visualPagination');

export const VisualPagination = Extension.create({
    name: 'visualPagination',

    addOptions() {
        return {
            enabled: true,
            /** 返回当前一页可用内容高度 C（px，调用方需自行乘 zoom 并扣除页眉/页脚条实测高度） */
            getPageContentHeight: () => 1000,
            /** 渲染页间隙内容：fn(nextPageNo, fillPx) => HTMLElement；fillPx = 上一页未用尽的空白高度 */
            renderGap: null,
            /** 渲染末页填充：fn(fillPx) => HTMLElement，钉住最后一页的页脚条（可选） */
            renderTail: null,
            /** 全局页码偏移：本节第一页 = 1 + getPageOffset()（前面各节页数之和，跨节连续编号） */
            getPageOffset: () => 0,
            /** 页间隙家具总高 G（页脚条+下边距+灰缝+上边距+页眉条），超高表格软分页按它造空间 */
            getGapHeight: () => 0,
            /** 间隙内容指纹（页眉/页脚 HTML/总页数等的哈希）：PM 对同 key widget 复用旧 DOM 不重跑 toDOM，
             *  页眉页脚改了但 pos/fill 没变时间隙条会冻结在旧内容——key 必须含内容指纹（坑 #23 推广） */
            getGapContentKey: () => '',
            /** 重算完成回调：fn(pages) —— 宿主据此聚合各节页数算全局页码偏移 */
            onComputed: null,
        };
    },

    addProseMirrorPlugins() {
        const opts = this.options;
        const editor = this.editor;

        const compute = (view) => {
            const pageH = opts.getPageContentHeight();
            if (!pageH || pageH <= 0) return DecorationSet.empty;

            // 块顶在 view.dom 内容坐标系里的实测值（offsetTop 链，zoom 免疫——坑 #35）。
            // 为什么不用 flowY 解析累加：首块 margin-top 会塌陷穿透 .ProseMirror 顶边（父盒无 border/padding），
            // 渲染坐标比解析坐标整体小一个首块 mt（实测 13.33px）——解析 flowY 放覆盖层会全部晚一个 mt，
            // 被衬垫加高的行底与覆盖层底对不齐，下一行被页间隙盖住一截（用户投诉"行被劈成两半"的渲染侧根因之一）
            const domTop = (el) => {
                let t = 0;
                let cur = el;
                while (cur && cur !== view.dom) {
                    t += cur.offsetTop;
                    cur = cur.offsetParent;
                }
                return t;
            };

            const off = opts.getPageOffset?.() ?? 0; // 全局页码偏移（跨节连续编号）
            const G = Math.max(0, Math.round(opts.getGapHeight?.() ?? 0)); // 页间隙家具总高（软分页造空间用）
            const decos = [];
            const bounds = []; // 块级页界的文档位置（新页第一块的起始 pos，升序）——右键"删除本页"按它圈页范围
            let acc = 0; // 当前页已用内容高度（含块间折叠外边距；间隙装饰不参与——见头注释）
            let page = 1;
            let prevMb = 0; // 上一块的下外边距
            let flowY = 0; // 流式布局 Y 游标（view.dom 内容坐标，含已插入的间隙高；表格跨页覆盖层按它绝对定位）
            const dbg = { pageH: Math.round(pageH), blocks: [] }; // 调试快照：无头验证脚本读取
            // 上次超高表格的软分页装饰：测量时要扣掉它们加的高度，否则装饰→变高→更多页→再加高的反馈循环
            const prevTall = editor.storage.visualPagination?.tallPads ?? {};
            const tallPads = {};
            let blockIdx = 0;
            const contentKey = opts.getGapContentKey?.() ?? ''; // 页眉页脚/总页数指纹（见 options 注释）

            const gapAt = (pos, fillPx) => {
                const pageNo = page + 1 + off; // 全局页码，立即固化——widget 是惰性绘制的，闭包不能引用会变的 page
                const fill = Math.max(0, Math.round(fillPx));
                return Decoration.widget(
                    pos,
                    () => {
                        const el = document.createElement('div');
                        el.className = 'vp-gap';
                        el.contentEditable = 'false';
                        const inner = opts.renderGap?.(pageNo, fill);
                        if (inner) el.appendChild(inner);
                        return el;
                    },
                    // key 必须含 fill 与内容指纹：PM 对同 key 的 widget 直接复用旧 DOM、不重跑 toDOM——
                    // 只含 pos 时 fill 变化后间隙冻结在旧高度；不含 contentKey 时页眉页脚改了间隙条还是旧内容
                    { side: -1, key: `vp-gap-${pos}-${fill}-${off}-${contentKey}` }
                );
            };

            view.state.doc.forEach((node, offset) => {
                const i = blockIdx++;
                const dom = view.nodeDOM(offset);
                let h;
                let mt = 0;
                let mb = 0;
                if (dom) {
                    // 注意：高度/外边距都可能为 0（如隐藏的分页符），不能用 || 回退，否则 0 被替换成估值
                    h = dom.offsetHeight;
                    const cs = getComputedStyle(dom);
                    mt = parseFloat(cs.marginTop) || 0;
                    mb = parseFloat(cs.marginBottom) || 0;
                    // 表格在编辑器里多包一层 .tableWrapper：外边距写在内层 table 上并穿透折叠到 wrapper 外，
                    // 视觉占高但 wrapper 自身 margin 为 0 —— 必须补记内层 table 的外边距
                    if (!mt && !mb && dom.classList.contains('tableWrapper') && dom.firstElementChild) {
                        const inner = getComputedStyle(dom.firstElementChild);
                        mt = parseFloat(inner.marginTop) || 0;
                        mb = parseFloat(inner.marginBottom) || 0;
                    }
                } else {
                    h = Math.max(24, Math.round(node.textContent.length / 40) * 24);
                }
                const lead = Math.max(prevMb, mt); // 与前一块的折叠外边距
                const blockTop = dom ? domTop(dom) : flowY + lead; // 块 border-box 顶（实测优先，见 domTop 注释）
                dbg.blocks.push({ type: node.type.name, h, mt, mb, accBefore: Math.round(acc) });

                if (node.type.name === 'pageBreak') {
                    // 手动分页符 = 强制页边界，整页切换：虚线条自身及其下外边距占本页高度
                    // （间隙装饰紧随其后，外边距不再折叠），本页剩余空白补齐，下一页从页首开始
                    acc += lead + h + mb;
                    const fill = pageH - acc;
                    decos.push(gapAt(offset + node.nodeSize, fill));
                    bounds.push(offset + node.nodeSize); // 分页符自身属于上一页，下一块起新页
                    flowY = blockTop + h + mb + Math.max(0, Math.round(fill)) + G;
                    page++;
                    acc = 0;
                    prevMb = 0;
                    return;
                }
                const isTable = node.type.name === 'table' && opts.renderGap && G > 0;
                const prev = isTable ? prevTall[i] || { crossed: 0, pads: [] } : null;
                // 扣上次软分页装饰加的全部高度（Σ pads.add，不是 crossed*G——pad 还含行底到页界的补齐），防反馈循环
                const hTrue = isTable ? h - prev.pads.reduce((s, p) => s + p.add, 0) : h;
                const total = acc + lead + hTrue;
                const crossed = Math.max(0, Math.floor(total / pageH));

                if (crossed > 0 && (isTable || hTrue > pageH)) {
                    // 跨页界：表格走"行边界软分页"（跨页即走，不要求整表超一页高——与 Word/Chromium 行界流动一致）；
                    // 其他超高块退化为虚线跨页指示。高度按页取模累计 → 后续块页码、末页填充与纸界保持对齐
                    if (isTable) {
                        // 软分页（不硬拆、不遮内容）：把页界前最后一行 <tr> 加高 G+(页界-行底) → 后续行真实下推
                        // 造出页间隙空间，再在空间上覆盖完整页间隙视觉（页脚条/边距白条/灰缝/页眉条，pointer-events 无）
                        const rows = [];
                        let cumPrev = 0; // 上次软分页衬垫在本行之前的累计（domTop 实测含衬垫，须扣回自然坐标）
                        node.forEach((row, roff) => {
                            const idx = rows.length;
                            const prevPad = prev.pads.find((pp) => pp.rowIdx === idx);
                            const trDom = view.nodeDOM(offset + 1 + roff);
                            let rh = trDom?.offsetHeight || 24;
                            if (prevPad) rh -= prevPad.add;
                            // 行顶逐行实测（offsetTop 取整误差不累计——累加 offsetHeight 18 行能漂 4px+，
                            // 行底与覆盖层底对不齐、下一行被盖）；无 DOM 时回退上行底
                            const top = trDom ? domTop(trDom) - blockTop - cumPrev : rows.length ? rows[rows.length - 1].bottom : 0;
                            rows.push({ pos: offset + 1 + roff, size: row.nodeSize, h: rh, top, bottom: top + rh });
                            if (prevPad) cumPrev += prevPad.add;
                        });
                        const pads = [];
                        const overlays = [];
                        let ok = true;
                        let cumFill = 0; // 前序各页界的填白累计：填白占了上一页版面 → 后续页界在自然坐标系里要前移 cumFill
                        let lastPick = -1;
                        let k = 0;
                        // 页界数动态确定（不再直接用自然 crossed）：扣填白后页界前移，超高行可能多顶出一个页界
                        while (true) {
                            const y = pageH - acc - lead + k * pageH - cumFill; // 页界的块内容坐标（自然高度系）
                            if (y >= hTrue - 1) break; // 页界已出表（前序填白把尾行顶回页内）→ 没有更多跨页
                            k++;
                            let pick = -1;
                            for (let ri = lastPick + 1; ri < rows.length - 1; ri++) {
                                if (rows[ri].bottom <= y + 1) pick = ri;
                                else break;
                            }
                            // 无新行界可选：页界落在某行内部（单行超高，或行间档距大于一页剩余）→ 放弃软分页
                            if (pick <= lastPick) { ok = false; break; }
                            const fillK = Math.round(y - rows[pick].bottom); // 本页行底到页界的填白（计入衬垫）
                            pads.push({ rowIdx: pick, add: Math.round(G + fillK) });
                            // 覆盖层顶/底锚定行实测几何（2026-09-11 图片边框遮蔽修复）：
                            // 原实现 top=y-fill、height=G+fill，靠 Math.round 链推算——底边与下一行渲染系顶理论相等，
                            // ±1px 圆整会多盖下一行顶 1px（下一行首格图片的上边框被盖白=用户报的"边框有时不显示"）。
                            // 现两边都用 domTop 实测行缘钉死：顶=衬垫行自然行底渲染系坐标、底=下一行渲染系顶
                            // （代数上 bottom-top ≡ G+fill，只是不再吃圆整漂移；覆盖层纯视觉不进 JSON，零布局影响）
                            overlays.push({
                                top: Math.round(blockTop + rows[pick].bottom + (k - 1) * G + cumFill),
                                bottom: Math.round(blockTop + rows[pick + 1].top + k * G + cumFill + fillK),
                                pageNo: page + k + off,
                                fill: Math.max(0, fillK)
                            });
                            cumFill += fillK;
                            lastPick = pick;
                        }
                        if (ok) {
                            const nCross = pads.length; // 实际页界数（≥ 自然 crossed，超高行被填白多顶出页界时会更多）
                            tallPads[i] = { crossed: nCross, pads };
                            // data-vp-padded：软分页成功的表全表单元格 vertical-align:top（editor.css）。
                            // 否则 middle 居中让内容随加高段下沉 add/2 落进盖白区——衬垫行内图片下边框、
                            // rowspan 跨行格（源格在上方 tr，挂行装饰够不着）内容被盖（2026-09-11 用户报图片边框被遮蔽）。
                            // 用 data 属性而非 class：TableDomSync 每次视图更新会把非节点属性的 class 抹掉（tableAlign.js:90-94）
                            decos.push(Decoration.node(offset, offset + node.nodeSize, { 'data-vp-padded': '1' }));
                            for (const pd of pads) {
                                const r = rows[pd.rowIdx];
                                // data-vp-pad：表格浮菜单锚点钳制用——衬垫行的单元格 rect 含加高段，
                                // ⋮ 手柄/选区描边须按自然行底定位（否则手柄落到页间隙里）
                                decos.push(Decoration.node(r.pos, r.pos + r.size, { style: `height:${Math.round(r.h + pd.add)}px`, 'data-vp-pad': String(pd.add) }));
                            }
                            decos.push(
                                Decoration.widget(
                                    offset,
                                    () => {
                                        const box = document.createElement('div');
                                        box.className = 'vp-overlays';
                                        box.contentEditable = 'false';
                                        for (const o of overlays) {
                                            const d = document.createElement('div');
                                            d.className = 'vp-ovl';
                                            // 顶=衬垫行自然行底、底=下一行渲染系顶（均实测锚定）：
                                            // fill 段盖掉被撑长的列边框/选中框串行，底边恰露出下一行真实顶边
                                            d.style.top = `${o.top}px`;
                                            d.style.height = `${Math.max(1, o.bottom - o.top)}px`;
                                            const inner = opts.renderGap(o.pageNo, o.fill);
                                            if (inner) d.appendChild(inner);
                                            box.appendChild(d);
                                        }
                                        return box;
                                    },
                                    { side: -1, key: `vp-ovl-${offset}-${nCross}-${Math.round(hTrue)}-${G}-${contentKey}` }
                                )
                            );
                            // 末页记账 = 自然取模 + 全部填白：填白都占前序页的版面，最后一页真实内容
                            // 从最后页界前移 Σfill 处起算（否则末页填充多算，纸底漂出）
                            page += nCross;
                            acc = total - nCross * pageH + cumFill;
                            flowY = blockTop + hTrue + nCross * G + cumFill;
                            prevMb = mb;
                            return;
                        }
                        if (hTrue > pageH) {
                            // 软分页失败且整表超一页：虚线跨页指示
                            decos.push(Decoration.node(offset, offset + node.nodeSize, { class: 'vp-table-split' }));
                            page += crossed;
                            acc = total - crossed * pageH;
                            flowY = blockTop + hTrue;
                            prevMb = mb;
                            return;
                        }
                        // 软分页失败但整表≤一页：落到下方通用溢出分支，整表跳页
                    } else {
                        decos.push(Decoration.node(offset, offset + node.nodeSize, { class: 'vp-table-split' }));
                        page += crossed;
                        acc = total - crossed * pageH;
                        flowY = blockTop + hTrue;
                        prevMb = mb;
                        return;
                    }
                }
                if (acc > 0 && acc + lead + hTrue > pageH) {
                    // 溢出（含软分页失败的≤一页表格）：间隙插在本块之前。上一块的 mb 完整计入本页（装饰不折叠外边距），本页剩余空白补齐
                    acc += prevMb;
                    const fill = pageH - acc;
                    decos.push(gapAt(offset, fill));
                    bounds.push(offset); // 溢出块自身是新页第一块
                    flowY = flowY + prevMb + Math.max(0, Math.round(fill)) + G; // 间隙在块前：prevMb → 间隙 → mt → 块
                    page++;
                    acc = mt + hTrue; // 装饰之后第一块的上外边距完整生效
                    prevMb = mb;
                    flowY += mt + hTrue;
                    return;
                }
                acc += lead + hTrue;
                prevMb = mb;
                flowY = blockTop + hTrue;
            });

            // 末页填充：把页脚条钉在最后一页页底（末块下外边距完整计入；内容恰好满页/以分页符结尾时补一整页）
            if (opts.renderTail) {
                const used = acc + prevMb;
                const fill = used > 0 ? pageH - used : pageH;
                if (fill > 0) {
                    const tailFill = Math.round(fill);
                    decos.push(
                        Decoration.widget(
                            view.state.doc.content.size,
                            () => {
                                const el = document.createElement('div');
                                el.className = 'vp-tail';
                                el.contentEditable = 'false';
                                const inner = opts.renderTail(tailFill);
                                if (inner) el.appendChild(inner);
                                return el;
                            },
                            { side: 1, key: `vp-tail-${tailFill}` } // 同 gap：key 含 fill，否则高度被冻结在首次渲染值
                        )
                    );
                }
            }
            dbg.pages = page;
            editor.storage.visualPagination.lastDebug = dbg;
            editor.storage.visualPagination.tallPads = tallPads;
            editor.storage.visualPagination.pageBounds = bounds;
            opts.onComputed?.(page);
            return DecorationSet.create(view.state.doc, decos);
        };

        return [
            new Plugin({
                key,
                state: {
                    init: () => DecorationSet.empty,
                    apply(tr, set) {
                        const next = tr.getMeta(key);
                        if (next) return next; // 重算结果整体替换
                        return set.map(tr.mapping, tr.doc);
                    }
                },
                props: {
                    decorations(state) {
                        return opts.enabled ? key.getState(state) : DecorationSet.empty;
                    },
                    handleDOMEvents: {
                        // 点击页间隙/末页填充（非编辑装饰区）→ 聚焦到上一页内容末尾。
                        // 解决"表格后紧跟分页符时，表格下方的页面空白处点击无法聚焦"（表格在最后，PM 默认无处可落光标）：
                        // 光标落在分页符之前（表格与分页符之间）的 GapCursor，输入的内容留在本页；
                        // 普通间隙则 Selection.near(-1) 落到上一块末尾。（软分页覆盖层 pointer-events:none，点击穿透到行内，无需处理）
                        mousedown(view, event) {
                            const t = event.target;
                            if (!(t instanceof Element)) return false;
                            const gapEl = t.closest('.vp-gap, .vp-tail');
                            if (!gapEl || !view.dom.contains(gapEl)) return false;
                            event.preventDefault();
                            let pos;
                            try {
                                pos = view.posAtDOM(gapEl, 0);
                            } catch {
                                return true;
                            }
                            const doc = view.state.doc;
                            const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
                            let $t = $pos;
                            const before = $pos.nodeBefore;
                            if (before && before.type.name === 'pageBreak') {
                                $t = doc.resolve(Math.max(0, $pos.pos - before.nodeSize));
                            }
                            try {
                                const sel = GapCursor.valid($t) ? new GapCursor($t) : Selection.near($t, -1);
                                view.dispatch(view.state.tr.setSelection(sel));
                            } catch {
                                /* 无有效落点（如空文档）——保持原选区 */
                            }
                            view.focus();
                            return true;
                        }
                    }
                },
                view(view) {
                    let scheduled = false;
                    const recompute = () => {
                        scheduled = false;
                        if (view.isDestroyed) return;
                        // content-visibility:auto 屏外跳过时，块高/页眉页脚条测量全为 0，
                        // 此时算出的分页是垃圾——保持旧装饰，等重新渲染时 RO 触发再算
                        if (view.state.doc.childCount > 0 && view.dom.offsetHeight === 0) return;
                        view.dispatch(view.state.tr.setMeta(key, compute(view)));
                    };
                    const schedule = () => {
                        if (!scheduled) {
                            scheduled = true;
                            requestAnimationFrame(recompute);
                        }
                    };
                    // 供外部（zoom/页眉页脚变化）强制重算
                    editor.storage.visualPagination = { refresh: schedule, lastDebug: null, pageBounds: [] };
                    schedule(); // 挂载后首算
                    // 字体/图片等异步资源加载会改变块高而不触发 doc 变更 → 监听内容盒尺寸变化重算。
                    // compute 是块高的纯函数（装饰不影响块高），重算收敛到不动点后尺寸不再变，RO 自停，不会死循环
                    const ro = new ResizeObserver(() => schedule());
                    ro.observe(view.dom);
                    document.fonts?.ready.then(schedule).catch(() => {});
                    return {
                        update(view, prev) {
                            if (view.state.doc !== prev?.doc) schedule();
                        },
                        destroy() {
                            ro.disconnect();
                        }
                    };
                }
            })
        ];
    }
});
