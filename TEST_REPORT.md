# mibo 桌宠 交互测试报告（完整版）

报告日期: 2026-07-05
覆盖范围: `frontend/src/main.ts`、`frontend/src/api/client.ts`、`frontend/src/data/character-loader.ts`、`frontend/src/data/affection-store.ts`
测试性质: 静态代码审查（只读分析，不改代码）

---

## 前置阅读

完整阅读了全部 1465 行 `main.ts`、221 行 `client.ts`、85 行 `character-loader.ts`、57 行 `affection-store.ts`。`main.ts` 因 token 限制被截断一次，通过 `sed` 补读了中间被截断的 `setupInteractions` 部分（第 585-800 行）和后部所有函数（第 800-1465 行），确保无盲区。

---

## 测试 1: 状态切换稳定性

审查 `main.ts` 中状态机逻辑，确认:

- `canChangeState` 是否覆盖全部边界（SLEEP / THINKING / responseLocked 互斥）
- SLEEP 状态下是否能被非预期交互打断
- THINKING→CELEBRATE→HAPPY 流程是否有竞态条件
- 60s 安全看门狗的所有分支是否都能正确清理 `isThinkingLocked`

---

### 1.1 `canChangeState` 边界覆盖分析

**函数位置**: `main.ts` 第 221-248 行

```typescript
function canChangeState(newState: string): boolean {
  // 回答锁定期间：禁止交互触发状态变更（AI/SLEEP 系统状态除外）
  if (responseLocked && newState !== 'THINKING' && newState !== 'CELEBRATE'
      && newState !== 'HAPPY' && newState !== 'SLEEP') {
    console.log('🚫 回答锁定中，禁止状态切换');
    return false;
  }

  // THINKING 锁定期间，只允许切换到其他非交互状态
  if (isThinkingLocked && newState !== 'IDLE' && newState !== 'THINKING' && newState !== 'SLEEP') {
    console.log('🚫 THINKING 锁定中，禁止交互状态切换');
    return false;
  }

  // 输入模式下不允许切换（IDLE/SLEEP 系统状态除外）
  if (isInputting && newState !== 'IDLE' && newState !== 'SLEEP') {
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
```

逐层分析四层守卫：

**第一层: `responseLocked` 守卫**
白名单: THINKING, CELEBRATE, HAPPY, SLEEP。
IDLE 不在白名单中。这在目前不崩溃，因为 `startResponseLock` 的 60 秒超时回调（`main.ts:1154`）先执行 `responseLocked = false`，再调 `updatePetState('IDLE')`。所有其他从 responseLocked 恢复的路径也是同样的顺序。

但如果未来有人写了一个新的定时任务，没有先清 responseLocked 就调 `updatePetState('IDLE')`，这个调用会**静默失败**——既不报错也不抛异常，只是状态卡住。这是**隐含的契约依赖**，应该在函数注释或白名单中显式注明。

**第二层: `isThinkingLocked` 守卫**
白名单: IDLE, THINKING, SLEEP。
CELEBRATE、HAPPY 不在这个白名单中。在 `sendMessage` 流程中，API 返回后先 `isThinkingLocked = false`（`main.ts:1089`）再调 `updatePetState('CELEBRATE')`，所以此处没问题。但如果 `isThinkingLocked` 和 `responseLocked` 同时为 true，由于第一层先判断，CELEBRATE/HAPPY 通过第一层但第二层直接拦截。

**第三层: `isInputting` 守卫**
白名单: IDLE, SLEEP。合理。

**第四层: 5 秒冷却**
冷却白名单是 `if (newState === 'IDLE' || newState === 'THINKING' || newState === 'SLEEP')`。
`CELEBRATE` 和 `HAPPY` 不在冷却白名单中，它们受 5 秒冷却限制。

---

#### [C1] (Critical) SLEEP 状态缺失独立保护层

**文件/行号**: `main.ts:221-248` (canChangeState)

**分析过程**:

在 `canChangeState` 中搜索任何对 `currentState === 'SLEEP'` 或 `currentState` 当前状态的引用——**没有找到**。`canChangeState` 完全不关心当前状态是什么，它只检查新状态是否被锁定条件拒绝。

然后检查了所有可能触发状态切换的路径:

**路径 A: 用户交互**（`petSection` click, mouseenter, document dblclick, document click 空白）

这些都在 `setupInteractions` 中（第 619-740 行），它们的事件处理函数开头统一有:
```typescript
if (isSleepTime()) return;
```
但 `isSleepTime()` 检查的是**当前时间**是否在睡眠时段，而不是 `currentState === 'SLEEP'`。如果用户设置的睡眠时段是 23:00-08:00，当前时间是 08:01（刚过睡眠时段但宠物可能还没被唤醒），点击仍然会通过。不过 `startLateNightChecker` 每分钟会把 `currentState === 'SLEEP'` 切换到 IDLE（`main.ts:929-933`），所以窗口只有 1 分钟。

更重要的是: `petSection` 事件用 `isSleepTime()` 检查了，所以 SLEEP 交互防护在用户层是完整的。

**路径 B: 定时器触发**

- `startActivityMonitor`（第 385 行）: `if (isSleepTime() || ... || currentState === 'SLEEP') return;` ✓ 双重防护
- `startIdleTimeChecker`（第 945 行）: `if (idleTime >= 10 && currentState === 'IDLE' && !isSleepTime())` ✓ 检查 IDLE 和睡眠时段
- `startLateNightChecker`（第 909 行）: 只从非 SLEEP 切到 SLEEP，不从 SLEEP 切走 ✓
- `startRestReminderChecker`（第 886 行）: **只检查 hour >= 9 && hour < 22，不检查 `currentState` 或 `isSleepTime()`**
- `startMealReminderChecker`（第 904 行）: **直接用 `scheduleDailyTask` 触发，无任何守卫**

**路径 B 的问题具体分析:**

`startMealReminderChecker`（第 899-907 行）:
```typescript
function startMealReminderChecker(): void {
  scheduleDailyTask(getSchedule().lunchTime, () => {
    console.log('=== Auto: EATING (午饭) ===');
    updatePetState('EATING', getReminderQuote('lunch'));
  });
  scheduleDailyTask(getSchedule().dinnerTime, () => {
    console.log('=== Auto: EATING (晚饭) ===');
    updatePetState('EATING', getReminderQuote('dinner'));
  });
}
```
假设用户设置睡眠时段 23:00-08:00，午饭时间 12:00:
- 12:00 宠物处于 SLEEP 状态（如果用户上午没操作或者 `currentState` 恰好是 SLEEP）
- `scheduleDailyTask` 触发 → 调 `updatePetState('EATING')`
- `updatePetState` 调 `canChangeState('EATING')`:
  - responseLocked 检查: false，通过
  - isThinkingLocked 检查: false，通过
  - isInputting 检查: false（SLEEP 时不在输入模式），通过
  - 冷却检查: EATING 不在 IDLE/THINKING/SLEEP 豁免列表，检查冷却——但 `lastStateChangeTime` 可能已经很久了（SLEEP 一直没切过），通过
- **EATING 成功覆盖了 SLEEP 状态**

类似的，`startRestReminderChecker` 在 9:00-22:00 之间每分钟检查，如果用户的睡眠时段落在 9:00-22:00 之外（最常见的是 23:00-08:00，不重叠），则安全。但如果用户自定义睡眠时段为 22:00-8:00（22 点入睡），在 9:00 时 `isSleepTime()` 返回 false（因为 `hour=9, sleepStartHour=22, sleepEndHour=8`: `9 >= 22 || 9 < 8` = `false || false` = `false`），正常。但如果上次睡眠的 `currentState === 'SLEEP'` 还没被晚检查器恢复，休息提醒可能先一步触发。

SLEEP 的保护是不完整的——它依赖于每个调用方自己显式检查 `isSleepTime()`，而不是由 `canChangeState` 集中守卫。定时器触发的路径容易忘记检查。

**修复建议**:

在 `canChangeState` 最前面增加:
```typescript
// SLEEP 状态下只允许切到 IDLE（唤醒）或 SLEEP（保持）
if (currentState === 'SLEEP' && newState !== 'SLEEP' && newState !== 'IDLE') {
  console.log('🚫 睡眠中，禁止状态切换');
  return false;
}
```
这样即使调用方忘了检查 `isSleepTime()`，SLEEP 也有最后一道防线。

---

#### [M1] (Minor) `responseLocked` 白名单不含 `IDLE`

**文件/行号**: `main.ts:225`

```typescript
if (responseLocked && newState !== 'THINKING' && newState !== 'CELEBRATE'
    && newState !== 'HAPPY' && newState !== 'SLEEP') {
```

`responseLocked` 允许 THINKING → 在响应锁期间还可以开始新的思考（如果有新消息进来）。
允许 CELEBRATE 和 HAPPY → 这两个是锁期间应该显示的回复状态。
允许 SLEEP → 睡眠优先级高于回答锁。

但不允许 IDLE。这意味着如果某个组件在 `responseLocked` 为 true 时想切回 IDLE（比如系统定时器），会被拒绝。当前代码中 `startResponseLock` 的回调（`main.ts:1152-1168`）总是先设 `responseLocked = false` 再切 IDLE，所以不触发此问题。

这是**契约性依赖**——所有恢复 IDLE 的代码都必须知道要先清 responseLocked。建议加注释或直接加 IDLE 进白名单。

---

### 1.2 SLEEP 状态下非预期交互打断

**结论**: 上文的 C1 是根本原因。除此之外的事件层拦截完整。

逐条核对入口:

| 入口 | 文件行号 | 防护 | 结果 |
|---|---|---|---|
| `petSection` click | `main.ts:623` | `if (isSleepTime()) return;` | ✓ |
| `petSection` mouseenter | `main.ts:685` | `if (isSleepTime() \|\| ...) return;` | ✓ |
| `document` dblclick 空白 | `main.ts:722` | `if (isSleepTime()) return;` | ✓ |
| `document` click 空白 | `main.ts:738` | `if (isSleepTime()) return;` | ✓ |
| 聊天按钮 | `main.ts:760` | 走 `switchToInputMode` 内检查 | ✓ |
| 剪贴板助手按钮 | 第 810-848 行 | 走 click handler | ✓ |
| 番茄钟启动 | 第 852-861 行 | 走 click handler | ✓ |
| `startActivityMonitor` | 第 385 行 | `isSleepTime() \|\| currentState === 'SLEEP'` | ✓ 双重防护 |
| `startIdleTimeChecker` | 第 945 行 | `currentState === 'IDLE' && !isSleepTime()` | ✓ |
| `startPomodoroReminder` | 第 1330 行 | `if (isSleepTime()) return;` | ✓ |
| `startRestReminderChecker` | 第 886 行 | hour 9-22，无 SLEEP 检查 | ✗ |
| `startMealReminderChecker` | 第 904 行 | 无任何 SLEEP 检查 | ✗ |

---

### 1.3 THINKING→CELEBRATE→HAPPY 流程竞态条件

**关键代码段**: `sendMessage` 函数（第 1017-1120 行）

流程时序:
```
sendMessage 入口
  → 清理 responseLocked/bubblePermanent
  → isThinkingLocked = true
  → updatePetState('THINKING')     // 冷豁免，通过
  → 设 60s 看门狗 safetyTimer
  → await petController.chat(message)
  → 清除 safetyTimer
  → isThinkingLocked = false
  → updatePetState('CELEBRATE')    // ！冷却检查！
  → updateBubble(fixedQuote)
  → setTimeout 4000ms:
      → startResponseLock()        // responseLocked = true
      → updatePetState('HAPPY')    // 通过 responseLocked 白名单
```

#### [M2] (Major) CELEBRATE 可能因 5s 冷却被静默拦截

**文件/行号**: `main.ts:1106`

```typescript
updatePetState('CELEBRATE');
```

**分析**:
此时 `responseLocked` 是 false（`sendMessage` 开头已清理），`isThinkingLocked` 也是 false（第 1089 行刚设为 false）。
CELEBRATE 走 `canChangeState`:
- responseLocked 检查: false，通过
- isThinkingLocked 检查: false，通过
- isInputting 检查: false（`switchToChatButtonMode` 已调用），通过
- 冷却检查: CELEBRATE 不在 IDLE/THINKING/SLEEP 豁免列表 → **检查 `lastStateChangeTime`**

问题是: `lastStateChangeTime` 可能是什么时候更新的？
`updatePetState` 只在以下状态更新 `lastStateChangeTime`:
```typescript
if (state !== 'IDLE' && state !== 'THINKING' && state !== 'SLEEP'
    && state !== 'CELEBRATE' && state !== 'HAPPY') {
  lastStateChangeTime = Date.now();
}
```
所以 THINKING 本身不更新冷却。

但**用户可能在发送消息前触发了状态切换**——例如点击宠物触发了 SURPRISED 或 POKED（第 654-665 行）。这些状态会更新 `lastStateChangeTime`。

如果用户在 5 秒内点击了宠物，然后发送消息，API 在 5 秒内返回，`updatePetState('CELEBRATE')` 的 `canChangeState` 冷却检查会拒绝切换。

**结果**: 成功获取了 AI 回复，但庆祝状态被跳过，气泡上直接显示 CELEBRATE 的台词（但立绘没变），或如果台词也因为 `canChangeState` 返回 false 而 `updatePetState` 直接 return 了——台词也不更新。

回到 `updatePetState` 的第 277 行:
```typescript
function updatePetState(state: string, customQuote?: string): void {
  cleanupDuplicateBubbles();
  if (!canChangeState(state)) {
    return;   // ← 完全静默返回，调用者不知道失败了
  }
  ...
}
```
整个函数 return，立绘不切、台词不更新、`currentState` 不更新。后续的 `updateBubble(fixedQuote)` 在第 1107 行仍然执行（它在 `updatePetState` 外面），所以气泡可能显示 CELEBRATE 的台词但立绘还是 THINKING 的。

**修复建议**: 在调用 CELEBRATE 前重置冷却，或将 CELEBRATE 加入豁免，或在 `sendMessage` 中先短暂设 `responseLocked=true` 让 CELEBRATE 走白名单。

---

#### [m1] (Minor) CELEBRATE→HAPPY 的 4 秒窗口无过渡锁

**文件/行号**: `main.ts:1110-1113`

```typescript
setTimeout(() => {
  startResponseLock();
  updatePetState('HAPPY', finalContent);
}, 4000);
```

API 返回后（第 1089 行）`isThinkingLocked = false`。这 4 秒窗口内用户点击宠物会被正常处理——因为 `petSection` 的 click handler（第 619 行）只检查 `isSleepTime()`、`responseLocked`、`isThinkingLocked`、`isInputting`，全部为 false。

用户点击可能触发 SURPRISED 或 POKED，更新立绘和气泡。4 秒后 HAPPY 覆盖回来。用户看到: CELEBRATE → 自己点的 SURPRISED 一闪 → HAPPY。体验不连贯。

**修复建议**: 在 4s 窗口内维持 `isThinkingLocked = true`，或引入一个轻量过渡锁。

---

#### [m2] (Minor) `bumpAffection` 错误完全静默

**文件/行号**: `main.ts:1100`

```typescript
bumpAffection().catch(() => {});
```

好感度写入 Tauri 后端失败时（文件写入权限问题、磁盘满等），错误被 `catch(() => {})` 完全吞掉。建议至少 `console.warn`。

---

### 1.4 60s 安全看门狗

**代码位置**: `sendMessage` 中，第 1066-1078 行

```typescript
let safetyTimedOut = false;
const safetyTimer = window.setTimeout(() => {
  if (!isThinkingLocked) return;    // 分支 A: isThinkingLocked 已被其他路径清理
  safetyTimedOut = true;            // 分支 B: 正常触发
  isThinkingLocked = false;
  updateBubble('唔...想了太久也没想出来，可能网络出问题了...等一下再试试吧？');
  setTimeout(() => {
    if (currentState !== 'IDLE') {
      updatePetState('IDLE');        // 5 秒后尝试恢复 IDLE
    }
  }, 5000);
}, 60000);
```

**分支分析**:

**分支 A**: `isThinkingLocked` 已被其他地方设为 false
其他什么路径会设 `isThinkingLocked = false`？
- `clipboardHelpBtn` 的事件处理中 try/catch/finally 都有设 false（第 837, 844 行）
- 没有任何其他路径会修改 `isThinkingLocked` 但不会清理 `safetyTimer`

所以分支 A 在 `sendMessage` 的正常流程中几乎不可能被触发。但如果 `clipboardHelpBtn` 的异步流程与 `sendMessage` 并发，理论上存在 `isThinkingLocked` 被提前清理的可能——不过剪贴板按钮有 `responseLocked` 守卫，不应并发。

**分支 B**: 正常触发
60 秒内 API 没回来 → 看门狗触发:
1. 设 `safetyTimedOut = true`
2. `isThinkingLocked = false`
3. 更新气泡提示网络问题
4. 5 秒后尝试 `updatePetState('IDLE')`

**后续处理**:
如果 API 在 60 秒之后但看门狗触发之后返回:
- `clearTimeout(safetyTimer)` → 看门狗已经执行了，clearTimeout 无效果
- `if (safetyTimedOut) return;` → 跳过后续 `isThinkingLocked = false` 和 CELEBRATE/HAPPY 流程
- ✓ 正确处理

**分支完整性检查**: 所有分支都能正确清理 `isThinkingLocked` 吗？
- 分支 A: 进入时 `isThinkingLocked` 已 false，直接 return ✓
- 分支 B: 正常设为 false ✓
- API 正常返回: `isThinkingLocked = false` ✓
- API 异常抛错: catch 中 `isThinkingLocked = false`（第 1117 行） ✓

结论: `isThinkingLocked` 的清理在所有路径都处理了。但 `responseLocked` 和 `bubblePermanent` 没有在看门狗中清理。

---

#### [M3] (Major) 看门狗不清理 `responseLocked` 和 `bubblePermanent`

**文件/行号**: `main.ts:1066-1078`

看门狗只清理了:
- `isThinkingLocked = false` ✓
- `updateBubble(...)` ✓

没有清理:
- `responseLocked` ✗
- `bubblePermanent` ✗

在 `sendMessage` 的正常流程中，看门狗触发时 `responseLocked` 应该是 false（第 1039-1042 行已清理）。但**如果未来代码进化**，在 THINKING 过程中加入了提前设锁的逻辑，看门狗不会恢复这两个标志。

---

#### [M4] (Major) 看门狗 5 秒后 `updatePetState('IDLE')` 可能被拦截

**文件/行号**: `main.ts:1076`

```typescript
setTimeout(() => {
  if (currentState !== 'IDLE') {
    updatePetState('IDLE');   // ← 可能被 canChangeState 拦截
  }
}, 5000);
```

`updatePetState('IDLE')` 调 `canChangeState('IDLE')`:
- 如果其间有代码设了 `responseLocked = true` → IDLE 不在白名单 → **拦截**。

这个 5 秒窗口内可能发生的事件:
- `startResponseLock` 从其他地方被调用（虽然在 sendMessage 中不可能，但如果是其他并发路径呢？）
- 实际上 5 秒不足以做什么，但理论上不安全

**修复建议**: 看门狗恢复时直接重置所有锁:
```typescript
responseLocked = false;
bubblePermanent = false;
isThinkingLocked = false;
updatePetState('IDLE');
```

---

#### [m3] (Minor) `safetyTimedOut` 缺少注释

**文件/行号**: `main.ts:1066`

`let safetyTimedOut = false;` 作为局部变量被闭包捕获，看门狗回调里设为 true，API 回调里检查 `if (safetyTimedOut) return;`。逻辑正确，但值得加一句注释说明这是用于防止看门狗触发后 API 回来继续执行。

---

## 测试 2: 剪贴板检测

审查 `startClipboardChecker`:

- 分类算法阈值的合理性
- 与 `responseLocked` / `isThinkingLocked` 的互斥
- `clipboardHelpTimer` 清理路径完整性

---

### 2.1 分类算法阈值分析

**函数位置**: `startClipboardChecker`，第 1230-1313 行

算法流程:
```
剪贴板内容变化
  → 检测 hasError（关键词 + 堆栈模式）
  → 检测 isCode（结构特征）
  → 检测 isEnglish（字符比例 + 功能词）
  → 决定 pendingClipboardType
```

#### [M5] (Major) 英文文本 `englishRatio` 分子未截断导致长文本比率夸大

**文件/行号**: `main.ts:1270`

```typescript
const englishChars = (currentContent.match(/[a-zA-Z]/g) || []).length;
const totalChars = currentContent.replace(/\s/g, '').length;
const englishRatio = totalChars > 0 ? englishChars / Math.min(totalChars, 500) : 0;
```

**分析**:
`englishChars` 计算的是**全部**英文字符数，没有截断。
`totalChars` 被 `Math.min` 截断到 500。

场景: 用户复制了一篇 2000 字符的英文文章
- `totalChars` = 2000（去掉空格后），但 `Math.min(totalChars, 500)` = 500
- `englishChars` = ~1700（假设 85% 英文字符），没有被截断
- `englishRatio` = 1700 / 500 = 3.4

但实际英文比例应该是 1700/2000 = 0.85。
计算出的 3.4 仍然 > 0.6，所以对于纯英文文本不会导致分类错误（依然是 isEnglish = true）。

**真正风险**: 中英混合文本，例如 2000 个中文字 + 300 个英文字符:
- `totalChars` = 2300，`Math.min(2300, 500)` = 500
- `englishChars` = 300
- `englishRatio` = 300/500 = 0.6
- 实际比例 = 300/2300 = 0.13

实际只有 13% 英文字符的文本被判为 isEnglish！这会**错误地将中英混合但英文比例低的文本分类为英文类型**。

**修复建议**:
```typescript
const englishChars = Math.min((currentContent.match(/[a-zA-Z]/g) || []).length, 500);
```

---

#### 其他阈值合理性分析

**`hasError`**（第 1240 行）:
```typescript
const hasError = /error|Error|错误|Exception|failed|Failed|Traceback|panic|stack ?trace|at \S+\.\w+:\d+/i.test(currentContent);
```
- `error` 和 `Error` 重复，因为 `i` flag 已经使 `error` 匹配大小写。可简化但无功能影响。
- `stack trace` 和 `stacktrace` 都匹配 ✓
- `at ` 堆栈匹配 `at ClassName.method` ✓

**`isCode` 阈值**（第 1243-1258 行）:
- `specialDensity > 0.25`: 中英混合自然语言的 specialDensity 通常 < 0.1（英文字母多，符号少），0.25 合理偏高 ✓
- `codeEndingRatio > 0.4`: 正常文本行末极少以 ;{}: 结尾，0.4 的门槛很安全 ✓
- `indentRatio > 0.3 && hasComments`: 缩进 + 注释的组合判断多一层保障 ✓

**`isEnglish` 阈值**（第 1260-1273 行）:
- `englishRatio > 0.6`: 正常 ✓（但如上所述有 M5 的 bug）
- `englishChars > 100`: 过滤短文本 ✓
- `funcWordCount >= 3`: 需要至少 3 个功能词，过滤了随机字母组合 ✓

**`hasInterest`**（第 1275 行）:
```typescript
const hasInterest = isCode || hasError || isEnglish || currentContent.length > 80;
```
- `currentContent.length > 80`: 长文本兜底，即使是普通中文文本也触发。合理 ✓

**分类优先级**（第 1279-1296 行）:
```
if (isCode && hasError) → 'error'
else if (isCode) → 'code'
else if (hasError) → 'error'
else if (isEnglish) → 'english'
else → 'general'
```
代码报错优先于纯代码，代码优先于纯报错。合理 ✓

---

### 2.2 与 `responseLocked` / `isThinkingLocked` 的互斥

**文件/行号**: `main.ts:1235`

```typescript
if (responseLocked || isInputting || isThinkingLocked || isSleepTime()) return;
```

**结论**: 完整。四种阻塞条件全部覆盖，顺序上从最高优先级（responseLocked）到最低（isSleepTime），没有遗漏。

---

### 2.3 `clipboardHelpTimer` 清理路径完整性

清理路径分析:

| 路径 | 代码位置 | 清理 `clipboardHelpTimer`? |
|---|---|---|
| 用户点击剪贴板助手按钮 | `main.ts:820` | ✓ `clearTimeout; timer = null` |
| 按钮 60s 超时隐藏 | `main.ts:1303-1306` | ✓ `timer = null` |
| 用户进入输入模式 | `main.ts:561` (`switchToInputMode`) | ✓ `clearTimeout; timer = null` |
| 切换到聊天按钮模式 | `main.ts:571` (`switchToChatButtonMode`) | ✗ **未清理** |
| 进入睡眠 | `main.ts:909-929` (`startLateNightChecker`) | ✗ **未清理** |

#### [m6] (Minor) 未清理路径的影响分析

**路径 `switchToChatButtonMode`**:
用户进入输入模式 → `clipboardHelpTimer` 被清理 → 用户退出输入模式 → 不清理（但此时 timer 已经是 null）→ 不影响。

**路径睡眠切换**:
1. 剪贴板变化触发按钮显示 + 60s timer 启动
2. 用户直接点击睡眠进入睡眠
3. `startLateNightChecker` 清理了 `pomodoroTimer`，但未清理 `clipboardHelpTimer`
4. timer 60s 后在睡眠期间触发回调：
   ```typescript
   clipboardHelpBtn?.classList.add('hidden');
   pendingClipboardContent = '';
   clipboardHelpTimer = null;
   if (currentState === 'IDLE' && !bubblePermanent) {
     updateBubble(getAmbientQuote('IDLE'));  // 睡眠中 currentState !== 'IDLE'，不执行
   }
   ```
   实际影响有限（条件检查阻止了气泡更新），但**逻辑上应该清理**以防未来回调内容变化。

**修复建议**: 在 `switchToChatButtonMode` 和 `startLateNightChecker` 的 SLEEP 分支中添加:
```typescript
if (clipboardHelpTimer) { clearTimeout(clipboardHelpTimer); clipboardHelpTimer = null; }
```

---

## 测试 3: 番茄钟

审查 `startPomodoro` / `endCurrentPhase` / `updatePomodoroCountdown`:

- `setInterval` 1000ms 的累积误差
- `endCurrentPhase` 内定时器竞争条件
- 番茄钟结束调用 `startResponseLock()` 的合理性
- 番茄钟 + 回答锁并发时的状态恢复

---

### 3.1 `setInterval 1000ms` 累积误差

**代码位置**: `startPomodoro` 第 1374 行

```typescript
pomodoroTimer = window.setInterval(() => {
  updatePomodoroCountdown();
  if (Date.now() >= pomodoroEndTime) {
    endCurrentPhase();
  }
}, 1000);
```

#### [M6] (Major) 后台标签页节流导致显示跳秒

**分析**:
浏览器对后台标签页的 `setInterval` 做节流处理:
- Chrome: 最小间隔 ≥ 1000ms（从 >= 1000ms 开始节流，实际可能到几秒）
- Safari: 节流到 ≥ 1000ms
- Firefox: 类似

`endCurrentPhase` 的触发用 `Date.now() >= pomodoroEndTime` 对比绝对时间，所以**阶段切换不会错过**。但是 `updatePomodoroCountdown` 显示剩余时间时:

```typescript
const remaining = Math.max(0, pomodoroEndTime - Date.now());
const minutes = Math.floor(remaining / 60000);
const seconds = Math.floor((remaining % 60000) / 1000);
```

如果 interval 被节流到 3 秒才触发一次，倒计时显示会从:
```
02:00 → 01:57 （跳了 3 秒）
```
而不是平滑的每秒更新。用户切换到桌面宠物标签页时会看到跳秒。

**修复建议**: 将 interval 缩短到 200ms，或用 `requestAnimationFrame` 实现更平滑的倒计时更新。

---

### 3.2 `endCurrentPhase` 内定时器竞争条件

**代码位置**: 第 1406-1434 行

```typescript
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
        endCurrentPhase();     // 可能的递归调用
      }
    }, 1000);
  } else {
    // 休息结束 → 完成
    pomodoroActive = false;
    ...
    startResponseLock();
  }
}
```

分析 `clearInterval` 的作用时间:
`clearInterval(pomodoroTimer)` 在 `endCurrentPhase` 入口处执行。但**当前的 interval 回调还没有执行完**——`endCurrentPhase` 是在 interval 回调中被调用的。`clearInterval` 阻止的是**下一次**回调入队，不会中断当前执行。

因此不会出现 `endCurrentPhase` 被连续两次间隔的 interval 重复调用。

**但有一个边缘情况**: 如果系统时间被人为**回拨**（如 NTP 同步、夏令时调整等），`Date.now()` 突然变小，会使 `Date.now() >= pomodoroEndTime` 从 true 变成 false。然后当时间回到正常时，这个条件再次为 true，`endCurrentPhase` 被调用第二次。

考虑时间回拨后的第二次调用:
- 第一次 `endCurrentPhase` 已设 `pomodoroPhase = 'break'`、新的 `pomodoroEndTime`、新的 `pomodoroTimer`
- 第二次调用时:
  - `clearInterval(pomodoroTimer)` → 清除 break 的 timer
  - 检查 `pomodoroPhase === 'focus'` → 现在是 'break'，走 else
  - `pomodoroActive = false` → 番茄钟提前结束

#### [M7] (Major) 缺少重入保护

**文件/行号**: `main.ts:1406-1434`

即使不考虑时间回拨，如果 `endCurrentPhase` 被不小心从两个地方同时调用（例如某个定时器和另一个代码路径），`pomodoroTimer` 可能被第二次设值然后丢失。

**修复建议**:
```typescript
function endCurrentPhase(): void {
  if (!pomodoroTimer && !pomodoroActive) return; // 重入保护
  ...
}
```

---

### 3.3 番茄钟结束调用 `startResponseLock()` 的合理性

**文件/行号**: `main.ts:1434`

```typescript
function endCurrentPhase(): void {
  ...
  } else {
    // 休息结束 → 完成
    pomodoroActive = false;
    if (pomodoroBtn) {
      pomodoroBtn.textContent = '番茄钟？';
      pomodoroBtn.classList.add('hidden');
    }
    updateBubble('一轮番茄钟完成！刚才学了什么？跟香澄聊聊吧~ ✨');
    startResponseLock();
  }
}
```

**设计意图**: 一轮完整的番茄钟完成后，启动回答锁 1 分钟，让完成提示的气泡保持显示不被后续状态切换覆盖。

这是合理的——用户需要看到"完成"的反馈。但 1 分钟的回答锁意味着用户在这一分钟内:
- 不能点击宠物触发交互状态
- 不能通过空白区域关闭气泡
- 只能在输入模式下操作

如果用户想立即表扬或触摸宠物，会被 `handleLockedInteraction()` 静默忽略。

**修复建议**: 将锁时间缩短到 15-30 秒，或仅驻留气泡不禁用交互:
```typescript
bubblePermanent = true;
setTimeout(() => {
  bubblePermanent = false;
  if (!pomodoroActive && !responseLocked) {
    updatePetState('IDLE');
  }
}, 15000);
```

---

### 3.4 番茄钟 + 回答锁并发时的状态恢复

#### [M8] (Major) 番茄钟在回答锁到期前完成 → 锁被意外延长

**文件/行号**: `main.ts:1434`

完整场景分析:

1. **初始状态**: 番茄钟正在运行（专注阶段或休息阶段），`pomodoroActive = true`
2. **用户聊天**: 用户发送消息 → `sendMessage` 开头清理 `responseLocked` 和 `responseLockTimer`（第 1039-1042 行）。`pomodoroActive` 保持不变（不会被清理）。
3. **AI 回复**: 聊天成功后 4 秒 → `startResponseLock()` 设 1 分钟答复锁（第 1111 行）。`responseLocked = true`，锁到 T1+60s。
4. **番茄钟处于回答锁期间**: `updatePomodoroCountdown` 因 `if (responseLocked) return;` 不更新气泡（第 1352 行）。用户看不到倒计时，但番茄钟内部仍在跑。
5. **番茄钟在回答锁到期前结束**: 假设 T1+30s 时番茄钟休息阶段结束，`endCurrentPhase` 调用 `startResponseLock()`。
   `startResponseLock` 内部（第 1145 行）:
   ```typescript
   if (responseLockTimer) clearTimeout(responseLockTimer);
   responseLockTimer = window.setTimeout(() => { ... }, 1 * 60 * 1000);
   ```
   原来 T1+60s 到期的锁被清理，新锁从当前时间（T1+30s）再延长 60s 到 T1+90s。**用户要多等 30 秒。**

**可能的频率**: 中等。25 分钟（专注）+ 5 分钟（休息）= 30 分钟一轮。如果用户在这 30 分钟内发了一条消息，回复加锁 1 分钟，而这 1 分钟与番茄钟最后阶段重叠，就有几率发生。

**修复建议**: `endCurrentPhase` 调 `startResponseLock` 前检查:
```typescript
if (!responseLocked) {
  startResponseLock();
} else {
  bubblePermanent = true;   // 仅驻留气泡
}
```

---

#### [m7] (Minor) 回答锁期间倒计时气泡不更新

**文件/行号**: `main.ts:1351-1352`

```typescript
function updatePomodoroCountdown(): void {
  if (!pomodoroActive) return;
  if (responseLocked) return;  // 静默跳过
  ...
}
```

用户发起聊天后，回答锁激活，番茄钟倒计时不再更新。气泡从"⏱ 12:30 专注中..."变成 AI 回复内容，然后锁到期后突然跳回"⏱ 10:15 专注中..."。用户看到断崖式的时间跳跃。

**修复建议**: 回答锁期间跳过气泡更新但保持内部计算，锁到期后立即刷新。

---

#### [m8] (Minor) `stopPomodoro` 在锁期间不反馈用户

**文件/行号**: `main.ts:1401-1403`

```typescript
if (!responseLocked) {
  updateBubble('番茄钟已停止，随时可以聊天框说"番茄钟"再开始哦~');
}
```

用户按了停止按钮，如果此时有回答锁，气泡不更新。用户看到按钮消失了但面板没有变化，可能怀疑操作是否生效。

**修复建议**: 无论是否 `responseLocked`，都更新气泡（因为 `startResponseLock` 的锁机制会保护气泡不被覆盖）。

---

## 问题汇总表

| 编号 | 严重度 | 分类 | 文件:行号 | 摘要 |
|---|---|---|---|---|
| C1 | **Critical** | 状态切换 | `main.ts:221-248` | SLEEP 无独立保护。`canChangeState` 不检查 `currentState`，定时器触发路径（饭点、休息提醒）可以打断睡眠。交互层虽用 `isSleepTime()` 拦截但定时器未防护。 |
| M1 | Minor | 状态切换 | `main.ts:225` | `responseLocked` 白名单不含 IDLE，依赖所有恢复路径先清锁再切状态。 |
| M2 | **Major** | 状态切换 | `main.ts:1106` | CELEBRATE 不在冷却豁免列表，API 快于 5s 时可能因 `lastStateChangeTime`（由之前交互更新）被冷却拦截，庆祝立绘/台词不显示。 |
| m1 | Minor | 状态切换 | `main.ts:1110-1113` | CELEBRATE→HAPPY 的 4s 窗口 `isThinkingLocked=false`，用户可点击切换状态造成视觉跳跃。 |
| m2 | Minor | 状态切换 | `main.ts:1100` | `bumpAffection().catch(() => {})` 错误完全静默。 |
| M3 | **Major** | 状态切换 | `main.ts:1066-1078` | 60s 看门狗不清理 `responseLocked` 和 `bubblePermanent`，只清理了 `isThinkingLocked`。 |
| M4 | **Major** | 状态切换 | `main.ts:1076` | 看门狗 5s 后 `updatePetState('IDLE')` 可能因 `responseLocked` 被 `canChangeState` 拦截（IDLE 不在白名单）。 |
| m3 | Minor | 状态切换 | `main.ts:1066` | `safetyTimedOut` 闭包捕获缺少注释说明设计意图。 |
| M5 | **Major** | 剪贴板 | `main.ts:1270` | `englishRatio = englishChars / Math.min(totalChars, 500)`，分子 `englishChars` 未截断 500，长文本比率被夸大。中英混合文本可能被错误分类为英文类型。 |
| m4 | Minor | 剪贴板 | `main.ts:1270-1273` | 其他阈值 (`specialDensity > 0.25`, `codeEndingRatio > 0.4`) 合理，`hasError` 正则中 `error` 和 `Error` 因 `i` flag 重复。 |
| m5 | Minor | 剪贴板 | `main.ts:1257` | `codeEndingRatio` 的 `/[;{}:]\s*$/` 不覆盖 Python 的 `return`/`pass`/`break` 语句，但被 `specialDensity` 和 `indentRatio` 兜底。 |
| m6 | Minor | 剪贴板 | `main.ts:571,909-929` | `switchToChatButtonMode` 和 `startLateNightChecker` 的 SLEEP 分支未清理 `clipboardHelpTimer`。 |
| M6 | **Major** | 番茄钟 | `main.ts:1374` | `setInterval(1000)` 在后台标签页被节流，倒计时跳秒。阶段切换用 `Date.now()` 所以不错过，但显示体验差。 |
| M7 | **Major** | 番茄钟 | `main.ts:1406-1434` | `endCurrentPhase` 缺少重入保护，系统时间回拨等场景下可能被重复调用，跳过休息阶段直接结束。 |
| M8 | **Major** | 番茄钟 | `main.ts:1434` | `endCurrentPhase` 无条件调 `startResponseLock()`，如果回答锁已在运行（聊天后），锁被重置延长 1 分钟。 |
| m7 | Minor | 番茄钟 | `main.ts:1352` | 回答锁期间 `updatePomodoroCountdown` 静默 return，用户看不到倒计时更新。 |
| m8 | Minor | 番茄钟 | `main.ts:1401-1403` | `stopPomodoro` 在 `responseLocked` 时不更新气泡，用户无操作反馈。 |

**严重度统计**: Critical: 1, Major: 7, Minor: 9

---

## 综合优先级建议

1. **C1** — SLEEP 被定时器路径打断。修 `canChangeState` 加 `currentState === 'SLEEP'` 守卫。
2. **M8** — 番茄钟完成 + 回答锁并发导致锁延长。修 `endCurrentPhase` 加 `!responseLocked` 检查。
3. **M7** — `endCurrentPhase` 重入保护。加入口守卫。
4. **M3 + M4** — 看门狗恢复不完整。加 `responseLocked` 和 `bubblePermanent` 清理。
5. **M2** — CELEBRATE 冷却竞争。将 CELEBRATE 加入豁免或设 `lastStateChangeTime = 0`。
6. **M5** — `englishRatio` 分子截断。修长文本分子分母不对称。
7. **M6** — 后台标签页跳秒。可降级为 minor（不影响功能，仅显示）。
8. 其余 minor 按需修复。
