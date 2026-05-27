import { createApiClient, type ApiClient } from '../api/client.js';
import type { ChatMessage } from '../types/pet.js';

export class PetController {
  private api: ApiClient;
  private chatHistory: ChatMessage[] = [];

  constructor() {
    this.api = createApiClient();
  }

  async init(): Promise<void> {
    await this.api.init();
  }

  async chat(message: string): Promise<string | null> {
    const userMessage: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: Date.now(),
    };
    this.chatHistory.push(userMessage);

    try {
      const response = await this.api.chatWithHistory(this.chatHistory);

      const assistantMessage: ChatMessage = {
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: response.response,
        timestamp: Date.now(),
      };
      this.chatHistory.push(assistantMessage);

      // 保留最近 50 条消息
      if (this.chatHistory.length > 50) {
        this.chatHistory = this.chatHistory.slice(-50);
      }

      return response.response;
    } catch (error) {
      console.error('Chat error:', error);
      throw error;
    }
  }

  async reloadConfig(): Promise<void> {
    await this.api.reloadConfig();
    this.chatHistory = [];
    console.log('[PetController] 配置已更新');
  }
}

export function createPetController(): PetController {
  return new PetController();
}
