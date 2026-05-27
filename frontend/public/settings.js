/**
 * 设置窗口逻辑
 * 读写 .env 文件（通过 Tauri read_env / write_env 命令）
 * 使用 window.__TAURI__ 全局 API
 */

const API_PROVIDER_PRESETS = {
  zhipu: {
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    modelName: 'glm-4-flash'
  },
  openai: {
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    modelName: 'gpt-3.5-turbo'
  },
  deepseek: {
    apiUrl: 'https://api.deepseek.com/chat/completions',
    modelName: 'deepseek-chat'
  },
  anthropic: {
    apiUrl: 'https://api.anthropic.com/v1/messages',
    modelName: 'claude-3-haiku-20240307'
  },
  custom: {
    apiUrl: '',
    modelName: ''
  }
};

/** 从 .env 加载配置 */
async function loadSettingsFromEnv() {
  try {
    return await window.__TAURI__.invoke('read_env');
  } catch (e) {
    console.error('Failed to read .env:', e);
    return {
      API_PROVIDER: 'zhipu',
      API_KEY: '',
      API_URL: API_PROVIDER_PRESETS.zhipu.apiUrl,
      MODEL_NAME: API_PROVIDER_PRESETS.zhipu.modelName
    };
  }
}

/** 保存配置到 .env */
async function saveSettingsToEnv(settings) {
  await window.__TAURI__.invoke('write_env', {
    vars: {
      API_PROVIDER: settings.provider,
      API_KEY: settings.apiKey,
      API_URL: settings.apiUrl,
      MODEL_NAME: settings.modelName
    }
  });
}

/** 加载可用角色列表 */
async function loadCharactersToUI() {
  try {
    const chars = await window.__TAURI__.invoke('list_characters');
    const current = await window.__TAURI__.invoke('get_current_character');
    const select = document.getElementById('character-select');
    if (!select) return;
    select.innerHTML = '';
    for (const c of chars) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.name_zh} (${c.band})`;
      if (c.id === current) opt.selected = true;
      select.appendChild(opt);
    }
  } catch (e) {
    console.error('Failed to load characters:', e);
  }
}

/** 填充 UI */
async function loadSettingsToUI() {
  const env = await loadSettingsFromEnv();

  const providerSelect = document.getElementById('api-provider');
  const apiKeyInput = document.getElementById('api-key');
  const apiUrlInput = document.getElementById('api-url');
  const modelNameInput = document.getElementById('model-name');

  const provider = env.API_PROVIDER || 'zhipu';
  if (providerSelect) providerSelect.value = provider;
  if (apiKeyInput) apiKeyInput.value = env.API_KEY || '';
  if (apiUrlInput) apiUrlInput.value = env.API_URL || '';
  if (modelNameInput) modelNameInput.value = env.MODEL_NAME || '';

  updateProviderUI(provider);
  loadCharactersToUI();
}

/** 根据供应商切换只读状态 */
function updateProviderUI(provider) {
  const apiUrlInput = document.getElementById('api-url');
  const modelNameInput = document.getElementById('model-name');

  if (provider === 'custom') {
    apiUrlInput?.removeAttribute('readonly');
    modelNameInput?.removeAttribute('readonly');
  } else {
    apiUrlInput?.setAttribute('readonly', 'readonly');
    modelNameInput?.setAttribute('readonly', 'readonly');
  }
}

/** 关闭设置窗口 */
async function closeSettings() {
  try {
    await window.__TAURI__.invoke('close_settings_window');
  } catch {
    try {
      await window.__TAURI__.invoke('close_window');
    } catch {
      window.close();
    }
  }
}

/** 保存并关闭 */
async function saveAndClose() {
  const providerSelect = document.getElementById('api-provider');
  const apiKeyInput = document.getElementById('api-key');
  const apiUrlInput = document.getElementById('api-url');
  const modelNameInput = document.getElementById('model-name');

  const provider = providerSelect.value;
  let apiUrl = apiUrlInput.value.trim();
  let modelName = modelNameInput.value.trim();

  // 自动填充预设
  if (provider !== 'custom') {
    const preset = API_PROVIDER_PRESETS[provider];
    if (preset) {
      apiUrl = preset.apiUrl;
      modelName = preset.modelName;
    }
  }

  if (!apiKeyInput.value.trim()) {
    alert('请输入 API Key');
    return;
  }

  await saveSettingsToEnv({
    provider,
    apiKey: apiKeyInput.value.trim(),
    apiUrl,
    modelName
  });

  // 保存角色选择
  const charSelect = document.getElementById('character-select');
  if (charSelect) {
    try {
      await window.__TAURI__.invoke('set_current_character', { characterId: charSelect.value });
    } catch (e) {
      console.error('Failed to save character:', e);
    }
  }

  try {
    await window.__TAURI__.invoke('settings_updated');
  } catch (e) {
    console.error('Failed to notify main window:', e);
  }

  await closeSettings();
}

/** 取消并关闭 */
async function cancelAndClose() {
  await closeSettings();
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  loadSettingsToUI();

  document.getElementById('save-settings')?.addEventListener('click', saveAndClose);
  document.getElementById('cancel-settings')?.addEventListener('click', cancelAndClose);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSettings();
  });

  document.getElementById('api-provider')?.addEventListener('change', (e) => {
    const value = e.target.value;
    updateProviderUI(value);

    if (value !== 'custom') {
      const preset = API_PROVIDER_PRESETS[value];
      if (preset) {
        const apiUrlInput = document.getElementById('api-url');
        const modelNameInput = document.getElementById('model-name');
        if (apiUrlInput) apiUrlInput.value = preset.apiUrl;
        if (modelNameInput) modelNameInput.value = preset.modelName;
      }
    }
  });
});
