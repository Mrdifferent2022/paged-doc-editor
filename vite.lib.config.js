import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 库构建配置（npm run build:lib，npm 发布的默认入口产物）。
 * external 全量外置：tiptap/mlightcad/element-plus/qrcode/primevue 等依赖全部留给宿主
 * node_modules 解析（它们都在 package.json dependencies/peerDependencies，且 import 均为动态），
 * dist-lib 保持 ~600KB 不捆 vendor。
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
            external: ['vue', /^@tiptap\//, /^@mlightcad\//, 'element-plus', 'qrcode', 'primevue', /^@primevue\//, 'primeicons'],
            output: {
                assetFileNames: 'style.css'
            }
        }
    }
});
