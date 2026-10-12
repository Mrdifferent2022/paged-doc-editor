import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primevue/themes/aura';
import Tooltip from 'primevue/tooltip';
import App from './demo/App.vue';
import './editor/styles/editor.css';
import 'primeicons/primeicons.css';

const app = createApp(App);
// 宿主应用（standard）本身已注册 PrimeVue；包内组件依赖宿主提供 PrimeVue 上下文与 tooltip 指令
app.use(PrimeVue, { theme: { preset: Aura, options: { darkModeSelector: false } } });
app.directive('tooltip', Tooltip);
app.mount('#app');
