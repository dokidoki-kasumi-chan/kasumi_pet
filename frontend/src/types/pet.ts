/**
 * 桌宠配置接口
 */
export interface PetConfig {
  apiUrl: string;            // LLM API 地址
  apiKey?: string;           // API Key
  modelName?: string;        // 模型名称
  breakInterval: number;     // 休息提醒间隔（分钟）
  lunchTime: string;         // 午餐提醒时间
  dinnerTime: string;        // 晚餐提醒时间
  sleepTimeStart: string;    // 睡眠开始时间
  sleepTimeEnd: string;      // 睡眠结束时间
}

/**
 * 聊天消息接口
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

/**
 * AI 聊天响应（通用）
 */
export interface AIChatResponse {
  response: string;
  emotion?: string;
  sessionId?: string;
}

/**
 * .env 中的 API 配置
 */
export interface ApiEnvConfig {
  API_PROVIDER: string;
  API_KEY: string;
  API_URL: string;
  MODEL_NAME: string;
}
