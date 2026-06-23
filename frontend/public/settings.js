/**
 * 设置窗口逻辑
 * 读写 .env 文件（通过 Tauri read_env / write_env 命令）
 */

// 供应商预设 + 常用模型
const PROVIDER_CONFIG = {
  zhipu: {
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    models: ['glm-4-flash', 'glm-4-plus', 'glm-4', 'glm-4-air']
  },
  openai: {
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    models: ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o3-mini']
  },
  deepseek: {
    apiUrl: 'https://api.deepseek.com/chat/completions',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-reasoner']
  },
  anthropic: {
    apiUrl: 'https://api.anthropic.com/v1/messages',
    models: ['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']
  },
  custom: {
    apiUrl: '',
    models: []
  }
};

/** 从 .env 加载配置 */
async function loadSettingsFromEnv() {
  try {
    return await window.__TAURI__.invoke('read_env');
  } catch (e) {
    console.error('Failed to read .env:', e);
    return { API_PROVIDER: 'zhipu', API_KEY: '', API_URL: '', MODEL_NAME: '' };
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

/** 填充模型下拉框 */
function populateModelSelect(provider, currentModel) {
  const modelSelect = document.getElementById('model-select');
  const modelInput = document.getElementById('model-name');
  if (!modelSelect || !modelInput) return;

  const config = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.custom;
  const models = config.models;

  modelSelect.innerHTML = '';
  if (models.length > 0) {
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      modelSelect.appendChild(opt);
    }
    const opt = document.createElement('option');
    opt.value = '__custom__';
    opt.textContent = '其他（手动输入）';
    modelSelect.appendChild(opt);

    // 选中当前模型或默认第一个
    if (models.includes(currentModel)) {
      modelSelect.value = currentModel;
      modelInput.value = currentModel;
      modelInput.style.display = 'none';
    } else if (currentModel && currentModel !== models[0]) {
      modelSelect.value = '__custom__';
      modelInput.value = currentModel;
      modelInput.style.display = 'block';
    } else {
      modelSelect.value = models[0];
      modelInput.value = models[0];
      modelInput.style.display = 'none';
    }
  } else {
    // custom 供应商没有预设模型
    const opt = document.createElement('option');
    opt.value = '__custom__';
    opt.textContent = '手动输入';
    modelSelect.appendChild(opt);
    modelSelect.value = '__custom__';
    modelInput.value = currentModel || '';
    modelInput.style.display = 'block';
  }
}

/** 填充 UI */
async function loadSettingsToUI() {
  const env = await loadSettingsFromEnv();

  const providerSelect = document.getElementById('api-provider');
  const apiKeyInput = document.getElementById('api-key');
  const apiUrlInput = document.getElementById('api-url');

  const provider = env.API_PROVIDER || 'deepseek';
  if (providerSelect) providerSelect.value = provider;
  if (apiKeyInput) apiKeyInput.value = env.API_KEY || '';
  if (apiUrlInput) apiUrlInput.value = env.API_URL || (PROVIDER_CONFIG[provider]?.apiUrl || '');

  populateModelSelect(provider, env.MODEL_NAME || '');
  loadCharactersToUI();
}

/** 供应商切换时联动更新 URL 和模型列表 */
function onProviderChange(provider) {
  const config = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.custom;
  const apiUrlInput = document.getElementById('api-url');
  if (apiUrlInput) apiUrlInput.value = config.apiUrl || '';
  populateModelSelect(provider, '');
}

/** 模型下拉框切换 */
function onModelSelectChange() {
  const modelSelect = document.getElementById('model-select');
  const modelInput = document.getElementById('model-name');
  if (!modelSelect || !modelInput) return;

  if (modelSelect.value === '__custom__') {
    modelInput.style.display = 'block';
    modelInput.focus();
  } else {
    modelInput.style.display = 'none';
    modelInput.value = modelSelect.value;
  }
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
  const modelSelect = document.getElementById('model-select');
  const modelInput = document.getElementById('model-name');

  const provider = providerSelect.value;
  const config = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.custom;
  const apiUrl = apiUrlInput.value.trim() || config.apiUrl;

  // 模型：优先用手动输入的值
  let modelName;
  if (modelSelect.value === '__custom__' || config.models.length === 0) {
    modelName = modelInput.value.trim();
  } else {
    modelName = modelSelect.value;
  }
  if (!modelName) modelName = config.models[0] || '';

  if (!apiKeyInput.value.trim()) {
    alert('请输入 API Key');
    return;
  }

  await saveSettingsToEnv({ provider, apiKey: apiKeyInput.value.trim(), apiUrl, modelName });

  // 保存角色选择
  const charSelect = document.getElementById('character-select');
  if (charSelect) {
    try {
      await window.__TAURI__.invoke('set_current_character', { characterId: charSelect.value });
    } catch (e) {
      console.error('Failed to save character:', e);
    }
  }

  try { await window.__TAURI__.invoke('settings_updated'); } catch (e) {}
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
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });

  document.getElementById('api-provider')?.addEventListener('change', (e) => onProviderChange(e.target.value));
  document.getElementById('model-select')?.addEventListener('change', onModelSelectChange);
});
