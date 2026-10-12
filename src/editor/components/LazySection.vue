<script setup>
import { ref } from 'vue';
import SectionEditor from './SectionEditor.vue';

/**
 * 节容器（2026-08-17 重构：懒挂载方案废弃）。
 * 旧方案用 IntersectionObserver 卸载/重挂载屏外节 + 占位 div 保高，问题成堆：
 * 占位与真实高度不一致 → 挂载/卸载时总高骤变 → 滚动锚定跳动、抖动、IO 振荡白屏；
 * 且导出前必须先滚动触发挂载才能拿到 getJSON。
 * 现方案：编辑器始终挂载（getJSON 随时可用、零抖动），屏外节的渲染开销由
 * .sheet 上的 content-visibility:auto 承担——浏览器跳过屏外节的布局/绘制但保留
 * DOM 与状态，contain-intrinsic-size 的 auto 记忆保证滚动条高度稳定。
 */
const props = defineProps({
    section: { type: Object, required: true },
    editable: { type: Boolean, default: true },
    zoom: { type: Number, default: 1 },
    visualPagination: { type: Boolean, default: true },
    pageOffset: { type: Number, default: 0 }, // 全局页码偏移（前序各节页数之和）
    pageTotal: { type: Number, default: 0 } // 全文总页数（{pages} 占位显示）
});
const emit = defineEmits(['focus', 'section-patch', 'section-pages']);

const editorRef = ref(null);
const getJSON = () => editorRef.value?.getJSON() ?? { type: 'doc', content: props.section.content };
defineExpose({ getJSON, get editor() { return editorRef.value?.editor; } });
</script>

<template>
    <div>
        <SectionEditor
            ref="editorRef"
            :section="section"
            :editable="editable"
            :zoom="zoom"
            :visual-pagination="visualPagination"
            :page-offset="pageOffset"
            :page-total="pageTotal"
            @focus="(e) => emit('focus', e)"
            @section-patch="(id, p) => emit('section-patch', id, p)"
            @section-pages="(id, pages) => emit('section-pages', id, pages)"
        />
    </div>
</template>
