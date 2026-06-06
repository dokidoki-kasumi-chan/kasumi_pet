/**
 * 户山香澄学习伴侣桌宠 - 主入口
 * 完整状态触发系统
 */

import { createPetController } from './core/PetController.js';
import { saveEnvConfig } from './api/client.js';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { readText } from '@tauri-apps/api/clipboard';

import { getStateQuote, getAmbientQuote, getReminderQuote, getGreetingQuote, getPersistQuote, getStateConfig, getSchedule, initCharacterLoader } from './data/character-loader.js';
import { loadAffection, bumpAffection, getAffection } from './data/affection-store.js';

// 状态配置从 characters/{id}/character.json 加载（由 character-loader 提供）

// ==================== 设置面板函数 ====================

let settingsPanelOpening = false;

/**
 * 打开设置面板（防重复调用）
 */
async function openSettingsPanel(): Promise<void> {
  if (settingsPanelOpening) return;
  settingsPanelOpening = true;
  try {
    await invoke('open_settings_window');
  } catch (e) {
    console.error('Failed to open settings window:', e);
  } finally {
    // 延迟重置，防止双击时第二次调用
    setTimeout(() => { settingsPanelOpening = false; }, 1000);
  }
}

let petController: ReturnType<typeof createPetController> | null = null;

// ===== 状态变量 =====
let isInputting = false;
let currentState = 'IDLE';
let stateTimer: number | null = null;
let idleTimer: number | null = null;
let lastInteractionTime = Date.now();
let lastStateChangeTime = 0;  // 状态切换冷却时间
const STATE_COOLDOWN = 5000;  // 5秒冷却

// ===== B站摸鱼检测 =====
let slackingPhase: 'none' | 'initial' | 'persist' = 'none';
let slackingTimer: number | null = null;
let bilibiliChecks = 0;
const BILIBILI_THRESHOLD = 10; // 10 × 30s = 5 分钟

// ===== 学习鼓励 + Popipa 音乐检测 =====
const STUDY_APPS = ['Code', 'Cursor', 'Codex', 'Xcode', 'Terminal', 'Trae'];
const STUDY_THRESHOLD = 6; // 6 × 30s = 3 分钟
let studyChecks = 0;
let studyNotified = false;
let lastSongTitle = '';

async function checkRunningApp(keywords: string[]): Promise<string | null> {
  try {
    const raw = await invoke<string>('check_running_app', { keywords });
    const result = JSON.parse(raw);
    return result.found ? result.keyword : null;
  } catch { return null; }
}

async function checkMatchWindow(keywords: string[]): Promise<{keyword: string; title: string; owner: string} | null> {
  try {
    const raw = await invoke<string>('match_window', { keywords });
    if (raw === 'null') return null;
    return JSON.parse(raw);
  } catch { return null; }
}

async function checkBilibiliOpen(): Promise<boolean> {
  try {
    return await invoke<boolean>('find_window_by_title', { keyword: 'bilibili' });
  } catch { return false; }
}

function handleSlackingStart(): void {
  if (!canChangeState('SLY_SMILE')) return;
  slackingPhase = 'initial';
  updatePetState('SLY_SMILE');
  slackingTimer = window.setTimeout(() => {
    slackingTimer = null;
    checkSlackingPersist();
  }, 5 * 60 * 1000);
}

function checkSlackingPersist(): void {
  checkBilibiliOpen().then(stillOpen => {
    if (stillOpen && slackingPhase === 'initial') {
      slackingPhase = 'persist';
      updateBubble(getPersistQuote('SLY_SMILE'));
      slackingTimer = window.setTimeout(() => {
        slackingTimer = null;
        handleSlackingEnd();
      }, 2 * 60 * 1000);
    } else {
      handleSlackingEnd();
    }
  }).catch(() => { handleSlackingEnd(); });
}

function handleSlackingEnd(): void {
  slackingPhase = 'none';
  bilibiliChecks = 0;
  if (slackingTimer) { clearTimeout(slackingTimer); slackingTimer = null; }
  if (currentState === 'SLY_SMILE') { resetToIdle(); }
}

function startActivityMonitor(): void {
  window.setInterval(async () => {
    if (isSleepTime() || responseLocked || isThinkingLocked || isInputting || currentState === 'SLEEP') return;

    // 1. B站摸鱼检测
    const bilibiliOpen = await checkBilibiliOpen();
    if (bilibiliOpen && slackingPhase === 'none') {
      bilibiliChecks++;
      if (bilibiliChecks >= BILIBILI_THRESHOLD) {
        handleSlackingStart();
        bilibiliChecks = 0;
      }
    } else if (!bilibiliOpen) {
      bilibiliChecks = 0;
      if (slackingPhase !== 'none') { handleSlackingEnd(); }
    }

    // 2. 学习编辑器检测（仅在 IDLE 时，使用 NSWorkspace 检测运行中的应用）
    const study = await checkRunningApp(STUDY_APPS);
    if (study && currentState === 'IDLE' && !studyNotified) {
      studyChecks++;
      if (studyChecks >= STUDY_THRESHOLD) {
        const appName = study === 'Code' ? 'VS Code' : study;
        updateBubble(`哇~ 你已经在 ${appName} 写了这么久代码，香澄好佩服你！Kira Kira~ ✨`);
        studyNotified = true;
      }
    } else if (!study) {
      studyChecks = 0;
      studyNotified = false;
    }

    // 3. 网易云音乐检测（使用 NSWorkspace 检测运行中的应用）
    const MUSIC_QUOTES = [
      '🎵 听歌放松呢~ Kira Kira~♪',
      '这首歌好好听！星星都在跳舞呢✨',
      '一边听歌一边学习，效率翻倍！',
      '耳朵里有音乐，心里有星星~',
      'Popipa 的歌最棒了对吧！',
    ];
    const music = await checkRunningApp(['网易云音乐', 'NeteaseMusic']);
    if (music && currentState === 'IDLE') {
      if (!lastSongTitle) {
        lastSongTitle = 'playing';
        updateBubble(MUSIC_QUOTES[Math.floor(Math.random() * MUSIC_QUOTES.length)]);
      }
      // 每 10 个周期（5 分钟）随机弹一条音乐台词
      if (Math.random() < 0.2) {
        updateBubble(MUSIC_QUOTES[Math.floor(Math.random() * MUSIC_QUOTES.length)]);
      }
    } else {
      lastSongTitle = '';
    }
  }, 30000);
}

// 思考锁定状态（THINKING期间屏蔽所有交互）
let isThinkingLocked = false;

// AI 回答锁定：回答后 1 分钟内禁止交互改变状态/气泡（最高优先级）
let responseLocked = false;
let responseLockTimer: number | null = null;
// 气泡永久驻留标志（输出结果后气泡不自动消失）
let bubblePermanent = false;

function isSleepTime(): boolean {
  const hour = new Date().getHours();
  const schedule = getSchedule();
  return hour >= schedule.sleepStartHour || hour < schedule.sleepEndHour;
}

// 剪贴板监听相关
let lastClipboardContent = '';

// 交互相关变量
let clickTimer: number | null = null;  // 单双击分离计时器
let clickCount = 0;  // 记录点击次数
let hoverTimer: number | null = null;  // 悬停计时器（摸头杀）
let hoverStartPos = { x: 0, y: 0 };  // 悬停开始时的鼠标位置
let isHovering = false;  // 是否正在悬停

// ===== DOM 元素引用 =====
let chatText: HTMLElement | null = null;
let chatInput: HTMLInputElement | null = null;
let chatBtn: HTMLElement | null = null;
let clipboardHelpBtn: HTMLElement | null = null;
let pomodoroBtn: HTMLElement | null = null;
let inputArea: HTMLElement | null = null;
let petSection: HTMLElement | null = null;

// 剪贴板待处理内容（供 AI 分析）
let pendingClipboardContent = '';
let pendingClipboardType: 'code' | 'error' | 'english' | 'general' = 'general';
let clipboardHelpTimer: number | null = null;
let pomodoroReminderTimer: number | null = null;

// 双缓冲立绘切换
let activeSpriteSlot: 'a' | 'b' = 'a';
let spriteSwitching = false;

// 番茄钟状态
let pomodoroActive = false;
let pomodoroPhase: 'focus' | 'break' = 'focus';
let pomodoroTimer: number | null = null;
let pomodoroEndTime = 0;

const POMODORO_FOCUS = 25 * 60 * 1000;   // 25分钟专注
const POMODORO_BREAK = 5 * 60 * 1000;    // 5分钟休息

function getActiveSprite(): HTMLImageElement | null {
  return document.getElementById(`pet-image-${activeSpriteSlot}`) as HTMLImageElement;
}
function getHiddenSprite(): HTMLImageElement | null {
  const slot = activeSpriteSlot === 'a' ? 'b' : 'a';
  return document.getElementById(`pet-image-${slot}`) as HTMLImageElement;
}

/**
 * 初始化桌宠
 */
async function initPet(): Promise<void> {
  console.log('🎸 初始化户山香澄桌宠...');

  // 迁移旧 localStorage 配置到 .env
  await migrateFromLocalStorage();

  // 加载角色数据（台词/立绘/日程）
  await initCharacterLoader('kasumi');
  // 加载好感度
  await loadAffection('kasumi');

  petController = createPetController();
  await petController.init();

  (window as any).pet = petController;

  // 设置变更监听：设置窗口保存后重新加载 API 客户端
  listen('settings-changed', async () => {
    console.log('🔧 检测到设置变更，重新加载 API 客户端...');
    await petController?.reloadConfig();
    console.log('✅ API 客户端已更新');
  });

  // 角色切换监听
  listen('character-changed', async (event: any) => {
    const newCharId: string = event.payload || 'kasumi';
    console.log('🔄 切换角色:', newCharId);
    await initCharacterLoader(newCharId);
    await loadAffection(newCharId);
    await petController?.reloadConfig();
    // 重置到 IDLE
    isThinkingLocked = false;
    bubblePermanent = false;
    updatePetState('IDLE');
    showGreetingMessage();
  });

  // 获取 DOM 元素
  chatText = document.getElementById('chat-text');
  chatInput = document.getElementById('chat-input') as HTMLInputElement;
  chatBtn = document.getElementById('chat-btn');
  clipboardHelpBtn = document.getElementById('clipboard-help-btn');
  pomodoroBtn = document.getElementById('pomodoro-btn');
  inputArea = document.getElementById('input-area');
  petSection = document.getElementById('pet-section');

  setupInteractions();
  startScheduleCheckers();

  console.log('✨ 桌宠已启动！');
  // 初始化为 IDLE 状态（设置默认图片）
  updatePetState('IDLE');
  // 显示问候语
  showGreetingMessage();
}

/**
 * 从 localStorage 迁移旧配置到 .env（首次升级时执行）
 */
async function migrateFromLocalStorage(): Promise<void> {
  const oldSettings = localStorage.getItem('kasumi_settings');
  if (!oldSettings) return;

  try {
    const settings = JSON.parse(oldSettings);
    if (settings.apiKey || settings.apiUrl || settings.modelName) {
      console.log('🔧 检测到旧 localStorage 配置，迁移到 .env...');
      const envConfig: Record<string, string> = {};
      if (settings.provider) envConfig.API_PROVIDER = settings.provider;
      if (settings.apiKey) envConfig.API_KEY = settings.apiKey;
      if (settings.apiUrl) envConfig.API_URL = settings.apiUrl;
      if (settings.modelName) envConfig.MODEL_NAME = settings.modelName;
      await saveEnvConfig(envConfig);
      localStorage.removeItem('kasumi_settings');
      console.log('✅ 迁移完成，旧配置已清除');
    }
  } catch (e) {
    console.error('Migration failed:', e);
  }
}


/**
 * 清理气泡残留（移除多余的气泡元素）
 */
function cleanupDuplicateBubbles(): void {
  const bubbles = document.querySelectorAll('.chat-bubble');
  if (bubbles.length > 1) {
    console.warn(`⚠️ 发现 ${bubbles.length} 个气泡，清理多余的...`);
    bubbles.forEach((bubble, index) => {
      if (index > 0) {
        bubble.remove();
      }
    });
  }
}

/**
 * 去掉 Markdown 格式符号，保留纯文本
 */
function stripMarkdown(text: string): string {
  return text
    // 标题符号
    .replace(/^#{1,6}\s+/gm, '')
    // 粗体
    .replace(/\*\*(.+?)\*\*/g, '$1')
    // 斜体
    .replace(/\*(.+?)\*/g, '$1')
    // 无序列表标记
    .replace(/^[\s]*[-*+]\s+/gm, '')
    // 有序列表标记
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // 水平线
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // 行内代码
    .replace(/`(.+?)`/g, '$1')
    // 多余空行压缩
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 更新气泡内容
 */
function updateBubble(text: string): void {
  // 先清理可能存在的重复气泡
  cleanupDuplicateBubbles();

  const cleanText = stripMarkdown(text);
  if (chatText) {
    chatText.textContent = cleanText;
  }
  console.log('💬 Bubble:', cleanText);
}

/**
 * 切换人物状态图片
 */
/**
 * 检查是否允许切换状态
 */
function canChangeState(newState: string): boolean {
  // 回答锁定期间：禁止交互触发状态变更（AI 回复流程 THINKING/CELEBRATE/HAPPY 除外）
  if (responseLocked && newState !== 'THINKING' && newState !== 'CELEBRATE' && newState !== 'HAPPY') {
    console.log('🚫 回答锁定中，禁止状态切换');
    return false;
  }

  // THINKING 锁定期间，只允许切换到其他非交互状态
  if (isThinkingLocked && newState !== 'IDLE' && newState !== 'THINKING' && newState !== 'SLEEP') {
    console.log('🚫 THINKING 锁定中，禁止交互状态切换');
    return false;
  }

  // 输入模式下不允许切换（除了IDLE恢复）
  if (isInputting && newState !== 'IDLE') {
    console.log('🚫 输入模式下禁止切换状态');
    return false;
  }

  // IDLE, THINKING, SLEEP 不受冷却限制
  if (newState === 'IDLE' || newState === 'THINKING' || newState === 'SLEEP') {
    return true;
  }

  // 检查冷却时间
  const now = Date.now();
  if (now - lastStateChangeTime < STATE_COOLDOWN) {
    const remaining = Math.ceil((STATE_COOLDOWN - (now - lastStateChangeTime)) / 1000);
    console.log(`🚫 状态冷却中，还需 ${remaining} 秒`);
    return false;
  }

  return true;
}

/**
 * 处理 THINKING 锁定期间的点击
 */
function handleLockedInteraction(): void {
  // 锁定期不覆盖气泡，静默忽略交互
  console.log('🔒 回答锁定中，忽略交互');
}

function handleThinkingLockedClick(): void {
  if (!chatText) return;
  const q = getAmbientQuote('THINKING');
  updateBubble(q || '别闹，我正在认真思考呢...');
}

/**
 * 状态切换（自动抽取台词+图片）
 * @param state 状态名称
 * @param customQuote 可选自定义台词（覆盖随机台词）
 */
function updatePetState(state: string, customQuote?: string): void {
  // 清理气泡残留
  cleanupDuplicateBubbles();

  // 检查是否允许切换状态
  if (!canChangeState(state)) {
    return;
  }

  // 记录状态切换时间（IDLE/THINKING/SLEEP/CELEBRATE/HAPPY 不触发冷却）
  if (state !== 'IDLE' && state !== 'THINKING' && state !== 'SLEEP' && state !== 'CELEBRATE' && state !== 'HAPPY') {
    lastStateChangeTime = Date.now();
    // 用户交互触发的新状态清除 AI 回复持久标志
    if (bubblePermanent) {
      bubblePermanent = false;
      if (cleanupTimer) {
        clearTimeout(cleanupTimer);
        cleanupTimer = null;
      }
    }
  }

  // 清除之前的计时器
  if (stateTimer) {
    clearTimeout(stateTimer);
    stateTimer = null;
  }

  currentState = state;
  const config = getStateConfig()[state] || getStateConfig()['IDLE'];

  console.log('=== State Change ===');
  console.log('New state:', state);
  console.log('Image:', config.image);

  // 双缓冲切图：预加载到隐藏槽，加载完成后瞬间切换
  const hidden = getHiddenSprite();
  if (!hidden || spriteSwitching) return;

  spriteSwitching = true;
  const onDone = () => {
    const active = getActiveSprite();
    if (active) active.classList.remove('visible');
    hidden.classList.add('visible');
    activeSpriteSlot = activeSpriteSlot === 'a' ? 'b' : 'a';
    spriteSwitching = false;
  };
  hidden.onload = onDone;
  hidden.onerror = onDone;
  hidden.src = config.image;

  // 更新台词 - 使用自定义或随机抽取
  if (customQuote) {
    updateBubble(customQuote);
  } else {
    updateBubble(getStateQuote(state));
  }

  // 自动恢复 IDLE（部分状态）
  // 有自定义台词时保持更长时间（30 秒），让用户看完 AI 回复
  // 但错误消息不自动恢复，也不触发随机台词
  const isErrorMessage = customQuote && (
    customQuote.includes('连接') ||
    customQuote.includes('问题') ||
    customQuote.includes('稍后再试') ||
    customQuote.includes('抱歉')
  );

  // 错误消息不设置自动恢复定时器
  if (!isErrorMessage && config.duration && state !== 'IDLE' && state !== 'THINKING' && state !== 'SLEEP' && !responseLocked) {
    const duration = customQuote ? 30000 : config.duration;
    stateTimer = window.setTimeout(() => {
      if (responseLocked) return; // 回答锁期间不自动恢复
      // 双缓冲切回 IDLE 立绘
      const hidden = getHiddenSprite();
      if (hidden && !spriteSwitching) {
        spriteSwitching = true;
        const onDone = () => {
          const active = getActiveSprite();
          if (active) active.classList.remove('visible');
          hidden.classList.add('visible');
          activeSpriteSlot = activeSpriteSlot === 'a' ? 'b' : 'a';
          spriteSwitching = false;
        };
        hidden.onload = onDone;
        hidden.onerror = onDone;
        hidden.src = getStateConfig().IDLE.image;
      }
      currentState = 'IDLE';
      // 非 AI 回复时同步更新气泡台词
      if (!bubblePermanent) {
        updateBubble(getAmbientQuote('IDLE'));
      }
      startIdleChatter();
    }, duration);
  }
}

/**
 * 切换到输入状态
 */
function switchToInputMode(): void {
  if (isSleepTime()) {
    updateBubble('zzz... 香澄已经睡着了... 💤');
    return;
  }
  isInputting = true;
  if (chatBtn) chatBtn.classList.add('hidden');
  if (clipboardHelpBtn) clipboardHelpBtn.classList.add('hidden');
  if (pomodoroBtn && !pomodoroActive) pomodoroBtn.classList.add('hidden');
  if (clipboardHelpTimer) { clearTimeout(clipboardHelpTimer); clipboardHelpTimer = null; }
  if (pomodoroReminderTimer) { clearTimeout(pomodoroReminderTimer); pomodoroReminderTimer = null; }
  if (inputArea) inputArea.classList.remove('hidden');
  if (chatInput) chatInput.focus();

  // 停止待机自语
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  console.log('Switched to input mode');
}

/**
 * 切换到聊天按钮状态
 */
function switchToChatButtonMode(): void {
  isInputting = false;
  if (chatBtn) chatBtn.classList.remove('hidden');
  if (inputArea) inputArea.classList.add('hidden');

  // 恢复待机自语
  startIdleChatter();

  console.log('Switched to chat button mode');
}

/**
 * 开始待机自语（随机显示气泡）
 */
function startIdleChatter(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  // 只在非输入模式下运行
  if (isInputting) return;
  // 气泡永久驻留时不启动自语
  if (bubblePermanent) return;

  // 随机 5-15 秒显示一次自语
  const randomDelay = 5000 + Math.random() * 10000;

  idleTimer = window.setTimeout(() => {
    // 气泡驻留时不覆盖
    if (bubblePermanent) return;
    if (!isInputting && currentState === 'IDLE') {
      updateBubble(getAmbientQuote('IDLE'));
      startIdleChatter(); // 继续下一次
    }
  }, randomDelay);
}

/**
 * 设置交互
 */
function setupInteractions(): void {
  const sendBtn = document.getElementById('send-btn');
  const dragHandle = document.getElementById('drag-handle');

  // ===== 拖动按钮事件处理 =====
  if (dragHandle) {
    // 齿轮点击打开设置（鼠标按下短+移动小=点击；双击由防重入锁保护）
    let mouseDownTime = 0;
    let mouseDownPos = { x: 0, y: 0 };

    dragHandle.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      e.preventDefault();
    });

    dragHandle.addEventListener('mousedown', (e) => {
      mouseDownTime = Date.now();
      mouseDownPos = { x: e.clientX, y: e.clientY };
    });

    dragHandle.addEventListener('mouseup', (e) => {
      const timeDiff = Date.now() - mouseDownTime;
      const distDiff = Math.sqrt(
        Math.pow(e.clientX - mouseDownPos.x, 2) +
        Math.pow(e.clientY - mouseDownPos.y, 2)
      );

      // 按下短 + 移动小 → 点击（非拖动），防重入锁阻止双击重复打开
      if (timeDiff < 200 && distDiff < 5) {
        console.log('=== Click gear → open settings ===');
        openSettingsPanel();
      }
    });
  }

  // ===== Pet 区域点击事件（单双击分离）=====
  if (petSection) {
    petSection.addEventListener('click', (e) => {
      // 如果点击的是拖动按钮，不处理
      if ((e.target as HTMLElement).id === 'drag-handle') return;

      // 睡眠期间 — 彻底锁死互动
      if (isSleepTime()) return;

      // 回答锁定期间 — 最高优先级，点击只给反馈不改变状态
      if (responseLocked) {
        handleLockedInteraction();
        return;
      }

      // THINKING 锁定期间
      if (isThinkingLocked) {
        handleThinkingLockedClick();
        return;
      }

      // 输入模式下点击退出输入模式
      if (isInputting) {
        console.log('=== Click pet to exit input mode ===');
        switchToChatButtonMode();
        return;
      }

      // 单双击分离逻辑
      clickCount++;
      if (clickTimer) clearTimeout(clickTimer);

      clickTimer = window.setTimeout(() => {
        // 1% 彩蛋：触发生气
        if (Math.random() < 0.01) {
          console.log('=== Rare ANGRY triggered! ===');
          updatePetState('ANGRY');
        } else if (clickCount === 1) {
          // 单击 → SURPRISED
          console.log('=== Single Click (SURPRISED) ===');
          updatePetState('SURPRISED');
        } else if (clickCount === 2) {
          // 双击 → POKED
          console.log('=== Double Click (POKED) ===');
          updatePetState('POKED');
        }
        clickCount = 0;
        clickTimer = null;
      }, 300); // 300ms 延迟区分单双击
    });
  }

  // ===== 悬停静止 3.5 秒 → SHY 害羞 =====
  if (petSection) {
    petSection.addEventListener('mouseenter', (e) => {
      if (isSleepTime() || responseLocked || isThinkingLocked || isInputting) return;

      isHovering = true;
      hoverStartPos = { x: e.clientX, y: e.clientY };

      hoverTimer = window.setTimeout(() => {
        console.log('=== Pet Hover Still 3.5s (SHY) ===');
        updatePetState('SHY');
        hoverTimer = null;
      }, 3500);
    });

    petSection.addEventListener('mouseleave', () => {
      isHovering = false;
      if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
    });

    petSection.addEventListener('mousemove', (e) => {
      if (isThinkingLocked || isInputting) return;
      if (!isHovering) return;

      const moveDistance = Math.sqrt(
        Math.pow(e.clientX - hoverStartPos.x, 2) +
        Math.pow(e.clientY - hoverStartPos.y, 2)
      );

      if (moveDistance > 20) {
        if (hoverTimer) {
          clearTimeout(hoverTimer);
        }
        hoverStartPos = { x: e.clientX, y: e.clientY };
        hoverTimer = window.setTimeout(() => {
          console.log('=== Pet Hover Still 3.5s (SHY) ===');
          updatePetState('SHY');
          hoverTimer = null;
        }, 3500);
      }
    });
  }

  // 记录用户交互时间
  document.addEventListener('mousemove', updateInteractionTime);
  document.addEventListener('keydown', updateInteractionTime);

  // ===== 双击空白区域关闭气泡并恢复 IDLE =====
  document.addEventListener('dblclick', (e) => {
    const target = e.target as HTMLElement;

    // 如果点击的是交互元素，不处理
    if (target.id === 'chat-btn' || target.id === 'send-btn' ||
        target.id === 'chat-input' || target.id === 'drag-handle' ||
        target.closest('#pet-section')) {
      return;
    }

    // 如果气泡是永久驻留的，双击空白区域关闭并恢复 IDLE
    if (bubblePermanent) {
      console.log('=== Double click blank area to close bubble ===');
      bubblePermanent = false;
      resetToIdle();
    }
  });

  // 点击空白区域（非永久驻留时）恢复 IDLE
  document.addEventListener('click', (e) => {
    // 永久驻留时不处理
    if (bubblePermanent) return;
    // 输入模式下不处理
    if (isInputting) return;

    const target = e.target as HTMLElement;
    if (target.id === 'chat-btn' || target.id === 'send-btn' ||
        target.id === 'chat-input' || target.id === 'drag-handle' ||
        target.closest('#pet-section')) {
      return;
    }

    // 如果当前不是 IDLE，点击空白区域恢复
    if (currentState !== 'IDLE') {
      resetToIdle();
    }
  });

  // 点击"聊天"按钮
  if (chatBtn) {
    chatBtn.addEventListener('click', () => {
      console.log('=== Chat Button Clicked ===');
      switchToInputMode();
    });
  }

  // 点击输入区域也进入输入模式（如果还未进入）
  if (inputArea) {
    inputArea.addEventListener('click', () => {
      if (!isInputting) {
        console.log('=== Input Area Clicked ===');
        switchToInputMode();
      }
    });
  }

  if (chatInput) {
    chatInput.addEventListener('click', () => {
      if (!isInputting) {
        console.log('=== Input Clicked ===');
        switchToInputMode();
      }
    });
  }

  // 发送消息
  if (sendBtn) {
    sendBtn.addEventListener('click', sendMessage);
  }

  // 剪贴板助手按钮 — 根据检测类型发不同 prompt
  if (clipboardHelpBtn) {
    clipboardHelpBtn.addEventListener('click', async () => {
      if (!pendingClipboardContent || !petController) return;
      console.log(`📋 剪贴板助手：类型=${pendingClipboardType}`);

      // 隐藏按钮，清除自动隐藏定时器
      clipboardHelpBtn?.classList.add('hidden');
      if (clipboardHelpTimer) {
        clearTimeout(clipboardHelpTimer);
        clipboardHelpTimer = null;
      }

      // 进入思考状态
      isThinkingLocked = true;

      let thinkMsg: string;
      let prompt: string;
      switch (pendingClipboardType) {
        case 'english':
          thinkMsg = '唔……香澄正在帮你翻译！';
          prompt = `你好香澄！请把以下英文内容翻译成中文，保持原意，语言自然流畅。\n\n${pendingClipboardContent}`;
          break;
        case 'error':
          thinkMsg = '唔……香澄正在帮你分析这段报错！';
          prompt = `你好香澄！我复制了以下报错信息，能帮我分析原因并给出修复建议吗？\n\n${pendingClipboardContent}`;
          break;
        case 'code':
          thinkMsg = '唔……香澄正在帮你分析这段代码！';
          prompt = `你好香澄！我复制了以下代码，能帮我解释它在做什么吗？\n\n${pendingClipboardContent}`;
          break;
        default:
          thinkMsg = '唔……香澄正在帮你分析这段内容！';
          prompt = `你好香澄！我复制了以下内容，能帮我看看这是什么吗？\n\n${pendingClipboardContent}`;
      }

      updatePetState('THINKING', thinkMsg);
      try {
        const aiContent = await petController.chat(prompt);
        isThinkingLocked = false;
        const content = aiContent?.trim();
        if (!content || content.length < 2) {
          updatePetState('IDLE', '诶？香澄没有收到回复呢...可能是 API 连接不稳定，再试一次？');
        } else {
          // 用 customQuote 传 AI 回复，然后启动 2 分钟锁
          startResponseLock();
          updatePetState('HAPPY', content);
        }
        pendingClipboardContent = '';
      } catch (e) {
        console.error('Clipboard analysis error:', e);
        isThinkingLocked = false;
        updatePetState('IDLE', '抱歉，分析出错了，请检查 API Key 配置。');
      }
    });
  }

  // 番茄钟按钮 — 启动/停止
  if (pomodoroBtn) {
    pomodoroBtn.addEventListener('click', () => {
      if (pomodoroActive) {
        stopPomodoro();
      } else {
        pomodoroBtn?.classList.add('hidden');
        startPomodoro();
      }
    });
  }

  // 回车发送
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }
}

/**
 * 更新用户交互时间
 */
function updateInteractionTime(): void {
  lastInteractionTime = Date.now();
}

/**
 * 启动定时检查器
 */
function startScheduleCheckers(): void {
  console.log('🕐 启动定时检查器...');

  // 休息提醒检查器
  startRestReminderChecker();

  // 饭点提醒检查器
  startMealReminderChecker();

  // 深夜检查器
  startLateNightChecker();

  // 无操作检查器
  startIdleTimeChecker();

  // 剪贴板监听检查器
  startClipboardChecker();

  // B站摸鱼检测
  startActivityMonitor();

  // 连续活跃1小时提示番茄钟
  startPomodoroReminder();
}

/**
 * 休息提醒检查器 - 每2小时
 */
function startRestReminderChecker(): void {
  setInterval(() => {
    const now = new Date();
    const hour = now.getHours();

    // 只在工作时间提醒：9:00-22:00
    if (hour >= 9 && hour < 22) {
      const lastWorkTime = lastInteractionTime;
      const timeSinceWork = (Date.now() - lastWorkTime) / (1000 * 60); // 分钟

      // 如果连续工作120分钟（2小时）
      if (timeSinceWork >= 120) {
        const random = Math.random();
        if (random > 0.5) {
          console.log('=== Auto: SLEEPY (工作2小时) ===');
          updatePetState('SLEEPY', getReminderQuote('rest'));
        } else {
          console.log('=== Auto: YAWN (工作2小时) ===');
          updatePetState('YAWN', getReminderQuote('rest'));
        }
      }
    }
  }, 60 * 1000); // 每分钟检查一次
}

/**
 * 饭点提醒检查器
 */
function startMealReminderChecker(): void {
  // 午饭时间
  scheduleDailyTask(getSchedule().lunchTime, () => {
    console.log('=== Auto: EATING (午饭) ===');
    updatePetState('EATING', getReminderQuote('lunch'));
  });

  // 晚饭时间
  scheduleDailyTask(getSchedule().dinnerTime, () => {
    console.log('=== Auto: EATING (晚饭) ===');
    updatePetState('EATING', getReminderQuote('dinner'));
  });
}

/**
 * 深夜检查器 - 00:00-08:00 睡眠模式
 */
function startLateNightChecker(): void {
  setInterval(() => {
    if (isSleepTime()) {
      if (currentState !== 'SLEEP') {
        console.log('=== Auto: SLEEP (深夜模式 00:00-08:00) ===');
        updatePetState('SLEEP');
        updateBubble('💤');
        // 隐藏所有按钮
        if (chatBtn) chatBtn.classList.add('hidden');
        if (clipboardHelpBtn) clipboardHelpBtn.classList.add('hidden');
        if (pomodoroBtn) pomodoroBtn.classList.add('hidden');
        if (inputArea) inputArea.classList.add('hidden');
        isInputting = false;
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      }
    } else {
      if (currentState === 'SLEEP') {
        updatePetState('IDLE');
        showGreetingMessage();
        if (chatBtn) chatBtn.classList.remove('hidden');
      }
    }
  }, 60 * 1000); // 每分钟检查
}

/**
 * 无操作检查器
 */
function startIdleTimeChecker(): void {
  setInterval(() => {
    const idleTime = (Date.now() - lastInteractionTime) / (1000 * 60); // 分钟
    const hour = new Date().getHours();

    // 30分钟无操作 → SLEEP（非深夜时段，8:00-22:59）
    if (idleTime >= 30 && currentState === 'IDLE' && hour >= 8 && hour < 23) {
      console.log('=== Auto: SLEEP (无操作30分钟) ===');
      updatePetState('SLEEP');
      return;
    }

    // 10分钟无操作 → YAWN
    if (idleTime >= 10 && currentState === 'IDLE') {
      console.log('=== Auto: YAWN (无操作10分钟) ===');
      updatePetState('YAWN', '还在吗？不要累坏啦~');
    }
  }, 60 * 1000); // 每分钟检查
}

/**
 * 定时任务辅助函数
 */
function scheduleDailyTask(timeStr: string, task: () => void): void {
  const [hour, minute] = timeStr.split(':').map(Number);
  const now = new Date();
  const target = new Date();
  target.setHours(hour, minute, 0, 0);

  // 如果今天的任务时间已过，安排到明天
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  const delay = target.getTime() - now.getTime();

  console.log(`📅 定时任务 ${timeStr} 已安排，将在 ${Math.floor(delay / 60000)} 分钟后执行`);

  setTimeout(() => {
    task();
    // 每天重复
    scheduleDailyTask(timeStr, task);
  }, delay);
}

// 清理定时器
let cleanupTimer: number | null = null;

/**
 * 检测是否为错误消息
 */
function isErrorMessage(text: string): boolean {
  return text.includes('连接出现问题') ||
         text.includes('稍后再试') ||
         text.includes('连接') ||
         text.includes('问题') ||
         text.includes('唔...');
}

/**
 * 清理状态，恢复 IDLE
 */
/**
 * 启动 AI 回答锁定（1 分钟，最高优先级）
 * 锁期间保持 HAPPY/CELEBRATE 立绘，结束后切回 IDLE 或恢复番茄钟
 */
function startResponseLock(): void {
  responseLocked = true;
  bubblePermanent = true;

  if (responseLockTimer) clearTimeout(responseLockTimer);
  responseLockTimer = window.setTimeout(() => {
    responseLocked = false;
    bubblePermanent = false;
    responseLockTimer = null;

    if (pomodoroActive) {
      // 番茄钟还在跑 → 恢复倒计时气泡
      updatePomodoroCountdown();
    } else {
      updatePetState('IDLE');
    }
  }, 1 * 60 * 1000); // 1 分钟
}

function resetToIdle(): void {
  if (cleanupTimer) {
    clearTimeout(cleanupTimer);
    cleanupTimer = null;
  }
  if (responseLockTimer) {
    clearTimeout(responseLockTimer);
    responseLockTimer = null;
  }
  responseLocked = false;
  bubblePermanent = false;  // 清除气泡驻留标志
  isThinkingLocked = false;  // 清除思考锁定
  updatePetState('IDLE');
}

/**
 * 发送消息
 */
async function sendMessage(): Promise<void> {
  if (!chatInput || !petController) return;

  const message = chatInput.value.trim();
  if (!message) return;

  // 睡眠时间不聊天
  if (isSleepTime()) {
    updateBubble('zzz... 香澄已经睡着了... 💤');
    chatInput.value = '';
    return;
  }

  // 清空输入框
  chatInput.value = '';

  // 切换回聊天按钮模式
  switchToChatButtonMode();

  // 清理之前的定时器、回答锁和气泡驻留标志
  if (cleanupTimer) {
    clearTimeout(cleanupTimer);
    cleanupTimer = null;
  }
  if (responseLockTimer) {
    clearTimeout(responseLockTimer);
    responseLockTimer = null;
  }
  responseLocked = false;
  bubblePermanent = false;

  // 消息过长直接拒绝，不发给 API
  if (message.length > 2000) {
    updatePetState('SURPRISED', '消息太长了啦！香澄的脑袋装不下这么多字...简短一点好不好？');
    return;
  }

  // 第一阶段：THINKING 状态 + 固定台词，并启动锁定
  isThinkingLocked = true;  // 启动思考锁定
  const thinkingQuote = '唔……香澄正在拼命思考中！';
  updatePetState('THINKING');
  updateBubble(thinkingQuote);

  // 60s 安全看门狗：超时后强制恢复，避免永久卡 THINKING
  let safetyTimedOut = false;
  const safetyTimer = window.setTimeout(() => {
    if (!isThinkingLocked) return;
    safetyTimedOut = true;
    isThinkingLocked = false;
    updateBubble('唔...想了太久也没想出来，可能网络出问题了...等一下再试试吧？');
    setTimeout(() => {
      if (currentState !== 'IDLE') {
        updatePetState('IDLE');
      }
    }, 5000);
  }, 60000);

  try {
    // 发送消息到 LLM API
    console.log('🎸 发送消息:', message);
    const aiContent = await petController.chat(message);
    clearTimeout(safetyTimer);
    if (safetyTimedOut) return;
    console.log('🎸 AI 响应:', aiContent);

    // 解除思考锁定
    isThinkingLocked = false;

    // 空响应处理
    if (!aiContent) {
      updatePetState('IDLE', '唔...香澄的脑袋一片空白了...');
      return;
    }

    // 检测错误消息
    if (isErrorMessage(aiContent)) {
      updatePetState('IDLE', aiContent);
      return;
    }

    // 聊天成功 → 好感度+1
    bumpAffection().catch(() => {});

    // 第二阶段：CELEBRATE 状态 + 固定台词
    const fixedQuote = 'Kira-kira Doki-doki！大成功啦！我们在星空下果然是最棒的！';
    updatePetState('CELEBRATE');
    updateBubble(fixedQuote);

    // 第三阶段：4秒后显示 AI 内容，启动 2 分钟回答锁
    const finalContent = aiContent;
    setTimeout(() => {
      startResponseLock();
      updatePetState('HAPPY', finalContent);
    }, 4000);

  } catch (error) {
    clearTimeout(safetyTimer);
    console.error('❌ Chat error:', error);
    isThinkingLocked = false;  // 解除思考锁定
    updatePetState('IDLE', '唔...香澄有点听不懂你的话，能再说一遍吗？');
  }
}




/**
 * 显示问候消息
 */
function showGreetingMessage(): void {
  const greeting = getGreetingQuote();
  const aff = getAffection();
  // 高熟悉度偶尔加亲昵前缀
  if (aff.familiarity >= 60 && Math.random() > 0.5) {
    updateBubble('又见面啦！' + greeting);
  } else {
    updateBubble(greeting);
  }
}

/**
 * 启动剪贴板监听检查器
 */
function startClipboardChecker(): void {
  console.log('📋 启动剪贴板监听...');

  // 每 3 秒检查一次剪贴板
  window.setInterval(async () => {
    // 回答锁 / 输入模式 / THINKING 锁定 / 睡眠期间不检查
    if (responseLocked || isInputting || isThinkingLocked || isSleepTime()) return;

    try {
      const currentContent = await readText();

      // 内容有变化且不是空内容
      if (currentContent && currentContent !== lastClipboardContent) {
        lastClipboardContent = currentContent;

        // 检测是否是代码、报错、或英文文本
        // 报错：关键词 + 堆栈模式
        const hasError = /error|Error|错误|Exception|failed|Failed|Traceback|panic|stack ?trace|at \S+\.\w+:\d+/i.test(currentContent);

        // 代码：用结构特征而非关键词
        const lines = currentContent.split('\n');
        const nonEmptyLines = lines.filter(l => l.trim());
        // 特殊符号密度（代码括号、运算符）
        const codeSpecials = (currentContent.match(/[{}()\[\];=<>|&!+\-*\/%^@#$:~]/g) || []).length;
        const alphanumeric = (currentContent.match(/[a-zA-Z0-9]/g) || []).length;
        const specialDensity = alphanumeric > 0 ? codeSpecials / alphanumeric : 0;
        // 行末特征：以 ; { } : 结尾的行占比
        const codeEndingLines = nonEmptyLines.filter(l => /[;{}:]\s*$/.test(l.trim())).length;
        const codeEndingRatio = nonEmptyLines.length > 0 ? codeEndingLines / nonEmptyLines.length : 0;
        // 缩进行（以空格或 tab 开头）占比
        const indentedLines = nonEmptyLines.filter(l => /^[\t ]{2,}/.test(l)).length;
        const indentRatio = nonEmptyLines.length > 0 ? indentedLines / nonEmptyLines.length : 0;
        // 注释行
        const hasComments = /^\s*(\/\/|#|--|\/\*|\*)\s/m.test(currentContent);
        // 综合判断：符号密度高 或 行末代码特征明显 或 缩进+注释
        const isCode = specialDensity > 0.25 || codeEndingRatio > 0.4 || (indentRatio > 0.3 && hasComments);

        // 英文：英文字符占比高 + 自然语言特征
        const englishChars = (currentContent.match(/[a-zA-Z]/g) || []).length;
        const totalChars = currentContent.replace(/\s/g, '').length;
        const englishRatio = totalChars > 0 ? englishChars / Math.min(totalChars, 500) : 0;
        // 常见英文功能词（小写）
        const funcWordCount = (currentContent.match(/\b(the|a|an|is|are|was|were|has|have|will|would|could|should|this|that|with|from|for|and|not|but|you|your)\b/gi) || []).length;
        const isEnglish = !isCode && !hasError && englishRatio > 0.6 && englishChars > 100 && funcWordCount >= 3;

        const hasInterest = isCode || hasError || isEnglish || currentContent.length > 80;

        if (hasInterest && currentState === 'IDLE') {
          pendingClipboardContent = currentContent;

          if (isCode && hasError) {
            pendingClipboardType = 'error';
            console.log('📋 检测到代码报错，主动提醒');
            updateBubble('哎呀，代码报错了？需要香澄帮忙看看吗？');
            updatePetState('SURPRISED');
          } else if (isCode) {
            pendingClipboardType = 'code';
            console.log('📋 检测到代码复制');
            updateBubble('你复制了代码呢，要我帮你分析一下吗？');
          } else if (hasError) {
            pendingClipboardType = 'error';
            console.log('📋 检测到报错信息');
            updateBubble('报错了吗？需要香澄帮忙查一下吗？');
            updatePetState('SURPRISED');
          } else if (isEnglish) {
            pendingClipboardType = 'english';
            console.log('📋 检测到大段英文');
            updateBubble('复制了英文内容呢，要我帮你翻译一下吗？☆');
          } else {
            pendingClipboardType = 'general';
            console.log('📋 检测到长文本复制');
            updateBubble('复制了内容呢，需要我帮你看看吗？');
          }
          clipboardHelpBtn?.classList.remove('hidden');
          // 1分钟后自动隐藏按钮，同时恢复待机气泡
          if (clipboardHelpTimer) clearTimeout(clipboardHelpTimer);
          clipboardHelpTimer = window.setTimeout(() => {
            clipboardHelpBtn?.classList.add('hidden');
            pendingClipboardContent = '';
            clipboardHelpTimer = null;
            if (currentState === 'IDLE' && !bubblePermanent) {
              updateBubble(getAmbientQuote('IDLE'));
            }
          }, 60000);
        }
      }
    } catch (e) {
      // 剪贴板读取失败时忽略
    }
  }, 3000);
}

// ==================== 番茄钟 ====================

let lastPomodoroReminder = Date.now();

function startPomodoroReminder(): void {
  setInterval(() => {
    if (responseLocked || pomodoroActive || pomodoroBtn?.classList.contains('hidden') === false) return;

    // 连续活跃 < 5分钟 + 距上次提醒 > 60分钟 → 提示
    const activeMinutes = (Date.now() - lastInteractionTime) / 60000;
    const sinceLastReminder = (Date.now() - lastPomodoroReminder) / 60000;

    if (activeMinutes < 5 && sinceLastReminder > 60 && currentState === 'IDLE') {
      console.log('🍅 连续活跃1小时，提示番茄钟');
      updateBubble('已经学了一小时了呢！要开始番茄钟吗？');
      pomodoroBtn?.classList.remove('hidden');
      lastPomodoroReminder = Date.now();

      // 2分钟后自动隐藏（如果用户没点）
      if (pomodoroReminderTimer) clearTimeout(pomodoroReminderTimer);
      pomodoroReminderTimer = window.setTimeout(() => {
        if (!pomodoroActive) {
          pomodoroBtn?.classList.add('hidden');
          if (currentState === 'IDLE' && !bubblePermanent) {
            updateBubble(getAmbientQuote('IDLE'));
          }
        }
        pomodoroReminderTimer = null;
      }, 120000);
    }
  }, 60000); // 每分钟检查
}

function updatePomodoroCountdown(): void {
  if (!pomodoroActive) return;
  if (responseLocked) return; // 回答锁期间不更新气泡
  const remaining = Math.max(0, pomodoroEndTime - Date.now());
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const time = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const label = pomodoroPhase === 'focus' ? '专注' : '休息';
  updateBubble(`⏱ ${time} ${label}中...`);
}

function startPomodoro(): void {
  pomodoroActive = true;
  pomodoroPhase = 'focus';
  pomodoroEndTime = Date.now() + POMODORO_FOCUS;

  updateBubble('一起加油！25分钟专注开始！🍅');

  // 显示停止按钮
  if (pomodoroBtn) {
    pomodoroBtn.textContent = '⏹ 停止';
    pomodoroBtn.classList.remove('hidden');
  }

  pomodoroTimer = window.setInterval(() => {
    updatePomodoroCountdown();
    if (Date.now() >= pomodoroEndTime) {
      endCurrentPhase();
    }
  }, 1000);

  console.log('🍅 番茄钟专注开始');
}

function stopPomodoro(): void {
  if (pomodoroTimer) {
    clearInterval(pomodoroTimer);
    pomodoroTimer = null;
  }
  pomodoroActive = false;
  if (pomodoroBtn) {
    pomodoroBtn.textContent = '番茄钟？';
    pomodoroBtn.classList.add('hidden');
  }
  if (!responseLocked) {
    updateBubble('番茄钟已停止，随时可以聊天框说"番茄钟"再开始哦~');
  }
  console.log('🍅 番茄钟已停止');
}

function endCurrentPhase(): void {
  if (pomodoroTimer) {
    clearInterval(pomodoroTimer);
    pomodoroTimer = null;
  }

  if (pomodoroPhase === 'focus') {
    // 专注结束 → 休息
    pomodoroPhase = 'break';
    pomodoroEndTime = Date.now() + POMODORO_BREAK;
    updateBubble('太棒了！休息5分钟，起来走走喝杯水~ ☕');

    pomodoroTimer = window.setInterval(() => {
      updatePomodoroCountdown();
      if (Date.now() >= pomodoroEndTime) {
        endCurrentPhase();
      }
    }, 1000);
  } else {
    // 休息结束 → 完成
    pomodoroActive = false;
    if (pomodoroBtn) {
      pomodoroBtn.textContent = '番茄钟？';
      pomodoroBtn.classList.add('hidden');
    }
    updateBubble('一轮番茄钟完成！刚才学了什么？跟香澄聊聊吧~ ✨');
    // 启动回答锁（即使不是 AI 回答，也复用 2 分钟保护机制）
    startResponseLock();
  }
}

// 启动
initPet();
