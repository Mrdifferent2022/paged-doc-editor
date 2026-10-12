import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    plugins: [vue()],
    resolve: {
        alias: {
            // 模拟宿主应用以包形式消费编辑器（等价于 node_modules 里的 paged-doc-editor）
            '@editor': path.resolve(__dirname, 'src/editor')
        }
    },
    server: {
        port: 8100
    }
});
