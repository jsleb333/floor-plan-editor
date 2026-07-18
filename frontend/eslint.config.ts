import prettierSkipFormatting from '@vue/eslint-config-prettier/skip-formatting'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'

export default defineConfigWithVueTs(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  pluginVue.configs['flat/recommended'],
  vueTsConfigs.strict,
  prettierSkipFormatting,
  {
    rules: {
      'vue/multi-word-component-names': ['error', { ignores: ['App'] }],
    },
  },
)
