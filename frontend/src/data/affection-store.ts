/**
 * 好感度系统
 * 持久化到 ~/Library/Application Support/com.kasumipet.app/affection.json
 */
import { invoke } from '@tauri-apps/api/tauri';

export interface AffectionData {
  affection: number;    // 好感度 0-100
  trust: number;        // 信任 0-100
  familiarity: number;  // 熟悉度 0-100
  mood: number;         // 心情 0-100
  interactions: number; // 交互总次数
}

const DEFAULT: AffectionData = {
  affection: 50, trust: 50, familiarity: 0, mood: 60, interactions: 0
};

let current: AffectionData = { ...DEFAULT };

export async function loadAffection(characterId: string): Promise<AffectionData> {
  try {
    const vars: Record<string, number> = await invoke('read_affection', { characterId });
    current = {
      affection: vars.affection ?? DEFAULT.affection,
      trust: vars.trust ?? DEFAULT.trust,
      familiarity: vars.familiarity ?? DEFAULT.familiarity,
      mood: vars.mood ?? DEFAULT.mood,
      interactions: vars.interactions ?? DEFAULT.interactions,
    };
  } catch (e) {
    console.warn('[Affection] Load failed, using defaults:', e);
    current = { ...DEFAULT };
  }
  return current;
}

export async function updateAffection(delta: Partial<AffectionData>): Promise<void> {
  // 合并并限制在 0-100
  const vars: Record<string, number> = {};
  for (const [k, v] of Object.entries(delta)) {
    const key = k as keyof AffectionData;
    current[key] = Math.max(0, Math.min(100, current[key] + (v as number)));
    vars[k] = current[key];
  }
  try {
    // 从 character-loader 获取当前角色 ID
    const { getCurrentCharacterId } = await import('./character-loader.js');
    await invoke('write_affection', { characterId: getCurrentCharacterId(), vars });
  } catch (e) {
    console.warn('[Affection] Write failed:', e);
  }
}

export function getAffection(): AffectionData {
  return { ...current };
}

/** 根据熟悉度返回问候语气 */
export function getTone(): 'formal' | 'warm' | 'close' {
  if (current.familiarity >= 60) return 'close';
  if (current.familiarity >= 30) return 'warm';
  return 'formal';
}

/** 聊天成功后 bump 好感度 */
export async function bumpAffection(): Promise<void> {
  await updateAffection({
    affection: 1,
    familiarity: 0.5,
    interactions: 1,
    mood: 2,
  });
}
