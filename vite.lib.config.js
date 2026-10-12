import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 库构建配置（npm run build:lib）。
 * 推荐集成方式：源码级 file: 依赖（宿主同为 Vite+Vue3，零构建、迭代顺）；
 * 需要 dist 产物（发 registry 等）时用本配置。
 */
export default defineConfig({
    plugins: [vue()],
    build: {
        outDir: 'dist-lib',
        lib: {
            entry: path.resolve(__dirname, 'src/editor/index.js'),
            name: 'PagedDocEditor',
            formats: ['es'],
            fileName: 'paged-doc-editor'
        },
        rollupOptions: {
            external: ['vue', /^@tiptap\//],
            output: {
                assetFileNames: 'style.css'
            }
        }
    }
});
