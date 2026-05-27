/**
 * 角色数据加载器
 * 从 characters/{id}/character.json 加载角色配置
 * 提供与旧 quotes.ts 完全相同的 API
 */
import { invoke } from '@tauri-apps/api/tauri';

interface CharacterData {
  id: string;
  name: { ja: string; en: string; zh: string };
  band: string;
  color: string;
  windowTitle: string;
  states: Record<string, { image: string; duration?: number }>;
  quotes: Record<string, { state: string[]; ambient: string[]; thinkingLocked?: string[]; persist?: string[] }>;
  reminders: Record<string, string[]>;
  greetings: Record<string, string[]>;
  schedule: {
    lunchTime: string;
    dinnerTime: string;
    sleepStartHour: number;
    sleepEndHour: number;
    restReminderIntervalMin: number;
    idleTimeoutMin: number;
    yawnTimeoutMin: number;
  };
}

let charData: CharacterData | null = null;
let currentCharId: string = 'kasumi';

export async function initCharacterLoader(characterId: string = 'kasumi'): Promise<void> {
  currentCharId = characterId;
  try {
    const raw = await invoke<string>('get_character_config', { characterId });
    const data = JSON.parse(raw) as CharacterData;
    charData = data;
    console.log(`[Character] Loaded: ${data.id} (${data.name.zh})`);
  } catch (e) {
    console.error('[Character] Failed to load character config:', e);
    throw e;
  }
}

function ensureLoaded(): CharacterData {
  if (!charData) throw new Error('Character not loaded. Call initCharacterLoader() first.');
  return charData;
}

export function getStateQuote(state: string): string {
  const d = ensureLoaded();
  const quotes = d.quotes[state];
  if (!quotes?.state?.length) return d.quotes.IDLE.state[0];
  return quotes.state[Math.floor(Math.random() * quotes.state.length)];
}

export function getAmbientQuote(state: string): string {
  const d = ensureLoaded();
  const quotes = d.quotes[state];
  if (!quotes?.ambient?.length) return d.quotes.IDLE.ambient[0];
  return quotes.ambient[Math.floor(Math.random() * quotes.ambient.length)];
}

export function getPersistQuote(state: string): string {
  const d = ensureLoaded();
  const quotes = d.quotes[state];
  if (!quotes?.persist?.length) return getAmbientQuote(state);
  return quotes.persist[Math.floor(Math.random() * quotes.persist.length)];
}

export function getReminderQuote(type: string): string {
  const d = ensureLoaded();
  const quotes = d.reminders[type] || d.reminders.water;
  return quotes[Math.floor(Math.random() * quotes.length)];
}

export function getGreetingQuote(): string {
  const d = ensureLoaded();
  const hour = new Date().getHours();
  let key = 'morning';
  if (hour < 6) key = 'night';
  else if (hour < 9) key = 'morning';
  else if (hour < 12) key = 'midMorning';
  else if (hour < 14) key = 'noon';
  else if (hour < 18) key = 'afternoon';
  else if (hour < 22) key = 'evening';
  else key = 'lateNight';
  const quotes = d.greetings[key];
  return quotes[Math.floor(Math.random() * quotes.length)];
}

export function getStateConfig(): Record<string, { image: string; duration?: number }> {
  return ensureLoaded().states;
}

export function getSchedule() {
  return ensureLoaded().schedule;
}

export function getCharacterInfo() {
  const d = ensureLoaded();
  return { id: d.id, name: d.name, band: d.band, color: d.color, windowTitle: d.windowTitle };
}

export function getCurrentCharacterId(): string {
  return currentCharId;
}
