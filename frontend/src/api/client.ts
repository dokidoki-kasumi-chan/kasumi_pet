/**
 * LLM API 客户端
 * 配置从 .env 文件加载（通过 Tauri read_env/write_env 命令）
 */
import type { AIChatResponse, ChatMessage, ApiEnvConfig } from '../types/pet.js';
import { invoke } from '@tauri-apps/api/tauri';

/**
 * API 供应商预设配置
 */
export const API_PROVIDER_PRESETS = {
  zhipu: {
    name: '智谱AI (ZhipuAI)',
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    modelName: 'glm-4-flash'
  },
  openai: {
    name: 'OpenAI',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    modelName: 'gpt-3.5-turbo'
  },
  deepseek: {
    name: 'DeepSeek',
    apiUrl: 'https://api.deepseek.com/chat/completions',
    modelName: 'deepseek-v4-flash'
  },
  anthropic: {
    name: 'Anthropic (Claude)',
    apiUrl: 'https://api.anthropic.com/v1/messages',
    modelName: 'claude-3-haiku-20240307'
  },
  custom: {
    name: '自定义',
    apiUrl: '',
    modelName: ''
  }
};

/**
 * 加载 .env 配置（通过 Tauri 命令）
 */
export async function loadEnvConfig(): Promise<ApiEnvConfig> {
  try {
    const vars: Record<string, string> = await invoke('read_env');
    return {
      API_PROVIDER: vars.API_PROVIDER || 'zhipu',
      API_KEY: vars.API_KEY || '',
      API_URL: vars.API_URL || API_PROVIDER_PRESETS.zhipu.apiUrl,
      MODEL_NAME: vars.MODEL_NAME || API_PROVIDER_PRESETS.zhipu.modelName,
    };
  } catch (e) {
    console.error('[Env] Failed to read .env:', e);
    return {
      API_PROVIDER: 'zhipu',
      API_KEY: '',
      API_URL: API_PROVIDER_PRESETS.zhipu.apiUrl,
      MODEL_NAME: API_PROVIDER_PRESETS.zhipu.modelName,
    };
  }
}

/**
 * 保存 API 配置到 .env
 */
export async function saveEnvConfig(config: Partial<ApiEnvConfig>): Promise<void> {
  await invoke('write_env', { vars: config });
}

/**
 * 解析 JSONL 格式的 RAG 数据，转换为提示词参考语料
 */
function formatRagData(raw: string): string {
  const lines = raw.trim().split('\n').filter(Boolean);
  const items = lines.map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);

  const profile = items.find((i: any) => i.source === 'manual_curated');
  const quotes = items.filter((i: any) =>
    ['anime_s1', 'anime_s2', 'anime_s3', 'game_main'].includes(i.source)
  );

  let section = '\n\n## 角色档案（补充参考）\n';

  if (profile) {
    if (profile.background) {
      section += `\n背景：${profile.background}`;
    }
    if (profile.personality_traits) {
      const traits = profile.personality_traits.map((t: any) => t.zh).join('、');
      section += `\n性格：${traits}`;
    }
    if (profile.catchphrases) {
      const phrases = profile.catchphrases.map((c: any) => `${c.zh}（${c.ja}）`).join('；');
      section += `\n口头禅：${phrases}`;
    }
    if (profile.relationships) {
      const rels = profile.relationships.map((r: any) => `${r.name}（${r.relation}）`).join('；');
      section += `\n人际关系：${rels}`;
    }
    if (profile.wiki_personality) {
      section += `\n性格补充：${profile.wiki_personality}`;
    }
  }

  if (quotes.length > 0) {
    section += '\n\n## 台词例句（请模仿以下语气和风格回复）\n';
    for (const q of quotes) {
      const scene = q.note || q.context || '';
      section += `- 【${scene}】${q.zh}（日：${q.ja}）\n`;
    }
  }

  return section;
}

/**
 * LLM API 客户端
 * 直接发送 HTTP 请求到配置的 API 端点
 */
export class ApiClient {
  private apiUrl: string;
  private apiKey: string;
  private modelName: string;
  private systemPrompt: string = '';
  private initialized: boolean = false;

  constructor() {
    this.apiUrl = '';
    this.apiKey = '';
    this.modelName = '';
  }

  /**
   * 初始化：加载 .env 配置 + SOUL.md 人设
   */
  async init(): Promise<void> {
    // 加载 API 配置
    const env = await loadEnvConfig();
    this.apiUrl = env.API_URL;
    this.apiKey = env.API_KEY;
    this.modelName = env.MODEL_NAME;

    // 加载系统人设 (SOUL.md + RAG 数据集)
    try {
      const soulContent = await invoke<string>('get_soul_content', { characterId: 'kasumi' });
      if (soulContent) {
        this.systemPrompt = soulContent;
      }
    } catch (e) {
      console.error('[API] Failed to load SOUL.md:', e);
      this.systemPrompt = '你是一个友好、乐于助人的AI助手。';
    }

    // 拼接 RAG 数据集（角色档案 + 台词例句）
    try {
      const ragRaw = await invoke<string>('get_rag_data', { characterId: 'kasumi' });
      if (ragRaw) {
        const ragSection = formatRagData(ragRaw);
        this.systemPrompt += ragSection;
        console.log('[API] RAG data appended');
      }
    } catch (e) {
      console.warn('[API] RAG data not available, using SOUL.md only:', e);
    }

    this.initialized = true;
    console.log('[API] Initialized, provider:', env.API_PROVIDER, 'model:', this.modelName);
  }

  /**
   * 更新配置（设置保存后调用）
   */
  async reloadConfig(): Promise<void> {
    this.initialized = false;
    await this.init();
  }

  /**
   * 获取 API 配置快照（供设置窗口读取）
   */
  getConfig(): { apiUrl: string; apiKey: string; modelName: string } {
    return {
      apiUrl: this.apiUrl,
      apiKey: this.apiKey,
      modelName: this.modelName,
    };
  }

  /**
   * 发送聊天请求（带历史）
   */
  async chatWithHistory(messages: ChatMessage[]): Promise<AIChatResponse> {
    if (!this.initialized) {
      await this.init();
    }

    try {
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage || lastMessage.role !== 'user') {
        return { response: '请发送有效消息', emotion: 'IDLE' };
      }

      // 构造发送给 API 的消息列表
      // system prompt 在这里统一添加（不在 PetController 中重复）
      let apiMessages: { role: string; content: string }[] = [];
      if (this.systemPrompt) {
        apiMessages.push({ role: 'system', content: this.systemPrompt });
      }
      for (const m of messages) {
        apiMessages.push({ role: m.role, content: m.content });
      }

      const response = await this.sendApiRequest(apiMessages);
      const content = response.message || response.content || response.text || response.reply || '';

      return {
        response: content,
        emotion: 'HAPPY'
      };
    } catch (error) {
      console.error('[API] Chat error:', error);
      return {
        response: '抱歉，连接出现问题，请检查 API Key 配置。',
        emotion: 'IDLE'
      };
    }
  }

  /**
   * 发送 HTTP 请求到 LLM API
   */
  private async sendApiRequest(messages: { role: string; content: string }[]): Promise<AgentResponse> {
    if (!this.apiKey) {
      throw new Error('API Key 未设置，请在设置中配置');
    }

    console.log('[API] Sending request to:', this.apiUrl);
    console.log('[API] Model:', this.modelName);
    console.log('[API] Messages count:', messages.length);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.modelName,
          messages: messages
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[API] HTTP error:', response.status, errorText);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      console.log('[API] Raw response structure:', JSON.stringify(data).substring(0, 300));

      // 兼容多种响应格式
      const content = data.choices?.[0]?.message?.content
        || data.choices?.[0]?.delta?.content
        || data.content
        || data.message
        || '';

      console.log('[API] Response received, length:', content.length);
      return {
        message: content,
        content: content,
        text: content,
        reply: content
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        console.error('[API] 请求超时 (30s)');
        throw new Error('API 请求超时，请检查网络或切换 API 供应商');
      }
      console.error('[API] Request failed:', error);
      throw error;
    }
  }
}

interface AgentResponse {
  message?: string;
  content?: string;
  text?: string;
  reply?: string;
}

/**
 * 创建 API 客户端实例
 */
export function createApiClient(): ApiClient {
  return new ApiClient();
}
