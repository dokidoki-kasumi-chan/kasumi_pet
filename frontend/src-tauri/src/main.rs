#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Window, Manager, AppHandle};
use std::collections::HashMap;
use std::path::PathBuf;
use std::fs;

#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

// ==================== 已有的窗口命令 ====================

#[tauri::command]
fn close_window(window: Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn close_settings_window(app: AppHandle) -> Result<(), String> {
    if let Some(settings_window) = app.get_window("settings") {
        settings_window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 获取角色目录路径（打包后 → Resources/characters/xxx，开发 → frontend/characters/xxx）
fn get_character_path(character_id: &str) -> PathBuf {
    let exe_dir = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("/"));
    let resource_dir = exe_dir
        .parent()
        .and_then(|p| p.parent())
        .unwrap_or_else(|| exe_dir.parent().unwrap_or(&exe_dir));

    let char_dir = resource_dir.join("Resources").join("characters").join(character_id);
    if char_dir.exists() {
        return char_dir;
    }
    // fallback: dev mode — navigate from exe (target/debug/mibo → ../../../characters/)
    let dev_chars = exe_dir.join("../../../characters").join(character_id);
    if dev_chars.exists() {
        return dev_chars;
    }
    // last resort
    exe_dir.join("../../../characters").join(character_id)
}

#[tauri::command]
fn get_soul_content(character_id: Option<String>) -> Result<String, String> {
    let cid = character_id.unwrap_or_else(|| "kasumi".to_string());
    let soul_path = get_character_path(&cid).join("SOUL.md");
    if !soul_path.exists() {
        return Err(format!("SOUL.md not found for character: {}", cid));
    }
    fs::read_to_string(&soul_path)
        .map_err(|e| format!("无法读取 SOUL.md: {}", e))
}

#[tauri::command]
fn get_rag_data(character_id: Option<String>) -> Result<String, String> {
    let cid = character_id.unwrap_or_else(|| "kasumi".to_string());
    let mut rag_path = get_character_path(&cid).join("profile.json");
    if !rag_path.exists() {
        // fallback to old all.jsonl for backward compat (dev mode)
        let exe_dir = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
        let dev_rag = exe_dir.join("../../../../rag/data/all.jsonl");
        if dev_rag.exists() {
            rag_path = dev_rag;
        }
    }
    fs::read_to_string(&rag_path)
        .map_err(|e| format!("无法读取 RAG 数据: {}", e))
}

#[tauri::command]
fn get_character_config(character_id: Option<String>) -> Result<String, String> {
    let cid = character_id.unwrap_or_else(|| "kasumi".to_string());
    let config_path = get_character_path(&cid).join("character.json");
    if !config_path.exists() {
        return Err(format!("character.json not found for: {}", cid));
    }
    fs::read_to_string(&config_path)
        .map_err(|e| format!("无法读取角色配置: {}", e))
}

#[tauri::command]
fn open_settings_window(app: AppHandle) -> Result<(), String> {
    let main_window = app.get_window("main").ok_or("Main window not found")?;
    let settings_window = app.get_window("settings").ok_or("Settings window not found")?;

    let main_position = main_window.outer_position().map_err(|e| e.to_string())?;
    settings_window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
        x: main_position.x as i32 - 460,
        y: main_position.y as i32 + 25,
    })).ok();

    #[cfg(target_os = "macos")]
    {
        let _ = settings_window.with_webview(|webview| {
            unsafe {
                let wv: cocoa::base::id = webview.inner();
                let ns_view: cocoa::base::id = objc::msg_send![wv, superview];
                let ns_win: cocoa::base::id = objc::msg_send![ns_view, window];
                let _: () = objc::msg_send![ns_win, setHasShadow: cocoa::base::NO];
            }
        });
    }

    settings_window.show().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn settings_updated(app: AppHandle) -> Result<(), String> {
    app.emit_all("settings-changed", ()).map_err(|e| e.to_string())?;
    Ok(())
}

// ==================== 新增 .env 读写命令 ====================

/// 获取 .env 文件路径
/// macOS: ~/Library/Application Support/com.kasumipet.app/.env
fn get_env_path(app: &AppHandle) -> PathBuf {
    use tauri::api::path::app_data_dir;
    let config = app.config();
    let mut dir = app_data_dir(&config).unwrap_or_else(|| {
        // fallback: 手动构造路径
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("com.kasumipet.app")
    });
    fs::create_dir_all(&dir).ok();
    dir.push(".env");
    dir
}

/// 解析 .env 文件内容为键值对
fn parse_env(content: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in content.lines() {
        let trimmed = line.trim();
        // 跳过空行和注释
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        // KEY=VALUE
        if let Some(pos) = trimmed.find('=') {
            let key = trimmed[..pos].trim().to_string();
            let value = trimmed[pos + 1..].trim().to_string();
            if !key.is_empty() {
                map.insert(key, value);
            }
        }
    }
    map
}

/// 将键值对序列化为 .env 格式
fn serialize_env(vars: &HashMap<String, String>) -> String {
    let mut content = String::from("# 香澄桌宠 - API 配置文件\n");
    content.push_str("# 修改此文件后重启应用即可生效\n\n");
    for (key, value) in vars {
        content.push_str(&format!("{}={}\n", key, value));
    }
    content
}

#[tauri::command]
fn read_env(app: AppHandle) -> Result<HashMap<String, String>, String> {
    let path = get_env_path(&app);
    if path.exists() {
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("读取 .env 失败: {}", e))?;
        Ok(parse_env(&content))
    } else {
        // 首次启动：创建空模板
        let default_vars = HashMap::from([
            ("API_PROVIDER".to_string(), "zhipu".to_string()),
            ("API_KEY".to_string(), "".to_string()),
            ("API_URL".to_string(), "https://open.bigmodel.cn/api/paas/v4/chat/completions".to_string()),
            ("MODEL_NAME".to_string(), "glm-4-flash".to_string()),
        ]);
        let content = serialize_env(&default_vars);
        fs::write(&path, &content)
            .map_err(|e| format!("创建 .env 失败: {}", e))?;
        Ok(default_vars)
    }
}

#[tauri::command]
fn write_env(app: AppHandle, vars: HashMap<String, String>) -> Result<(), String> {
    let path = get_env_path(&app);

    // 合并：保留现有键，更新新值
    let mut existing = if path.exists() {
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("读取 .env 失败: {}", e))?;
        parse_env(&content)
    } else {
        HashMap::new()
    };

    for (key, value) in &vars {
        existing.insert(key.clone(), value.clone());
    }

    let content = serialize_env(&existing);
    fs::write(&path, &content)
        .map_err(|e| format!("写入 .env 失败: {}", e))?;

    println!("[Rust] .env 已写入: {:?}", path);
    Ok(())
}

// ==================== 好感度系统 ====================

fn get_affection_path(app: &AppHandle) -> PathBuf {
    use tauri::api::path::app_data_dir;
    let config = app.config();
    let mut dir = app_data_dir(&config).unwrap_or_else(|| {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("com.kasumipet.app")
    });
    fs::create_dir_all(&dir).ok();
    dir.push("affection.json");
    dir
}

fn default_affection() -> HashMap<String, i64> {
    HashMap::from([
        ("affection".into(), 50),
        ("trust".into(), 50),
        ("familiarity".into(), 0),
        ("mood".into(), 60),
        ("interactions".into(), 0),
    ])
}

#[tauri::command]
fn read_affection(app: AppHandle, character_id: String) -> Result<HashMap<String, i64>, String> {
    let path = get_affection_path(&app);
    if path.exists() {
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("读取 affection 失败: {}", e))?;
        let all: HashMap<String, HashMap<String, i64>> =
            serde_json::from_str(&content).unwrap_or_default();
        Ok(all.get(&character_id).cloned().unwrap_or_else(default_affection))
    } else {
        Ok(default_affection())
    }
}

#[tauri::command]
fn write_affection(app: AppHandle, character_id: String, vars: HashMap<String, i64>) -> Result<(), String> {
    let path = get_affection_path(&app);
    let mut all: HashMap<String, HashMap<String, i64>> = if path.exists() {
        let content = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        HashMap::new()
    };
    let mut entry = all.get(&character_id).cloned().unwrap_or_else(default_affection);
    for (k, v) in &vars {
        entry.insert(k.clone(), *v);
    }
    all.insert(character_id, entry);
    let json = serde_json::to_string_pretty(&all).map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(&path, &json).map_err(|e| format!("写入 affection 失败: {}", e))?;
    Ok(())
}

// ==================== 多角色切换 ====================

fn get_app_data_path(app: &AppHandle) -> PathBuf {
    use tauri::api::path::app_data_dir;
    let config = app.config();
    let dir = app_data_dir(&config).unwrap_or_else(|| {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        PathBuf::from(home).join("Library").join("Application Support").join("com.kasumipet.app")
    });
    fs::create_dir_all(&dir).ok();
    dir
}

#[derive(serde::Serialize)]
struct CharacterInfo {
    id: String,
    name_zh: String,
    band: String,
    color: String,
}

#[tauri::command]
fn list_characters() -> Result<Vec<CharacterInfo>, String> {
    // 尝试 resources 路径和开发路径
    let chars_dir = get_character_path("kasumi")
        .parent()
        .unwrap_or(&PathBuf::from("."))
        .to_path_buf();

    let mut chars = Vec::new();
    if let Ok(entries) = fs::read_dir(&chars_dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let config_path = entry.path().join("character.json");
                if let Ok(content) = fs::read_to_string(&config_path) {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                        chars.push(CharacterInfo {
                            id: v["id"].as_str().unwrap_or("unknown").to_string(),
                            name_zh: v["name"]["zh"].as_str().unwrap_or("").to_string(),
                            band: v["band"].as_str().unwrap_or("").to_string(),
                            color: v["color"].as_str().unwrap_or("#FF5522").to_string(),
                        });
                    }
                }
            }
        }
    }
    Ok(chars)
}

#[tauri::command]
fn get_current_character(app: AppHandle) -> Result<String, String> {
    let path = get_app_data_path(&app).join("current_character");
    if path.exists() {
        fs::read_to_string(&path)
            .map(|s| s.trim().to_string())
            .map_err(|e| format!("读取当前角色失败: {}", e))
    } else {
        Ok("kasumi".to_string())
    }
}

#[tauri::command]
fn set_current_character(app: AppHandle, character_id: String) -> Result<(), String> {
    let path = get_app_data_path(&app).join("current_character");
    fs::write(&path, &character_id)
        .map_err(|e| format!("写入当前角色失败: {}", e))?;
    app.emit_all("character-changed", &character_id).ok();
    Ok(())
}


// ==================== macOS 窗口检测模块 ====================

#[cfg(target_os = "macos")]
mod macos_window {
    use std::ffi::{c_void, CStr};
    use std::ptr;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" { fn CGWindowListCopyWindowInfo(option: u32, win_id: u32) -> *const c_void; }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFArrayGetCount(arr: *const c_void) -> i64;
        fn CFArrayGetValueAtIndex(arr: *const c_void, idx: i64) -> *const c_void;
        fn CFDictionaryGetValue(dict: *const c_void, key: *const c_void) -> *const c_void;
        fn CFStringGetCStringPtr(s: *const c_void, enc: u32) -> *const i8;
        fn CFStringGetCString(s: *const c_void, buf: *mut i8, len: i64, enc: u32) -> i8;
        fn CFStringGetLength(s: *const c_void) -> i64;
        fn CFStringGetMaximumSizeForEncoding(len: i64, enc: u32) -> i64;
        fn CFStringCreateWithCString(alloc: *const c_void, s: *const i8, enc: u32) -> *const c_void;
        fn CFRelease(cf: *const c_void);
        fn CFNumberGetValue(num: *const c_void, typ: i64, val: *mut c_void) -> i8;
    }

    const UTF8: u32 = 0x08000100;
    const ON_SCREEN: u32 = 0; // kCGWindowListOptionAll — 不过滤离屏/最小化窗口
    const NULL_WIN: u32 = 0;

    unsafe fn make_cfstr(s: &str) -> *const c_void {
        CFStringCreateWithCString(ptr::null(), s.as_ptr() as *const i8, UTF8)
    }

    unsafe fn read_cfstr(cf: *const c_void) -> String {
        if cf.is_null() { return String::new(); }
        let cstr = CFStringGetCStringPtr(cf, UTF8);
        if !cstr.is_null() { return CStr::from_ptr(cstr).to_string_lossy().to_string(); }
        let len = CFStringGetLength(cf);
        if len <= 0 { return String::new(); }
        let max = CFStringGetMaximumSizeForEncoding(len, UTF8);
        let mut buf = vec![0u8; max as usize + 1];
        if CFStringGetCString(cf, buf.as_mut_ptr() as *mut i8, buf.len() as i64, UTF8) != 0 {
            return CStr::from_bytes_until_nul(&buf).map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        }
        String::new()
    }

    /// 扫描所有窗口标题 + 所有者名，查找关键词（不区分大小写，不过滤 layer）
    pub fn find_window_title(keyword: &str) -> bool {
        unsafe {
            let list = CGWindowListCopyWindowInfo(ON_SCREEN, NULL_WIN);
            if list.is_null() { return false; }
            let count = CFArrayGetCount(list);
            let k_name = make_cfstr("kCGWindowName");
            let k_owner = make_cfstr("kCGWindowOwnerName");
            let lower_kw = keyword.to_lowercase();

            let mut found = false;
            for i in 0..count {
                let dict = CFArrayGetValueAtIndex(list, i);
                if dict.is_null() { continue; }
                if read_cfstr(CFDictionaryGetValue(dict, k_name)).to_lowercase().contains(&lower_kw)
                || read_cfstr(CFDictionaryGetValue(dict, k_owner)).to_lowercase().contains(&lower_kw) {
                    found = true;
                    break;
                }
            }
            CFRelease(k_name); CFRelease(k_owner); CFRelease(list);
            found
        }
    }

    /// 一次扫描匹配多个关键词，返回首个匹配的 (keyword, title, owner)
    pub fn match_any_window(keywords: &[String]) -> Option<(String, String, String)> {
        unsafe {
            let list = CGWindowListCopyWindowInfo(ON_SCREEN, NULL_WIN);
            if list.is_null() { return None; }
            let count = CFArrayGetCount(list);
            let k_name = make_cfstr("kCGWindowName");
            let k_owner = make_cfstr("kCGWindowOwnerName");

            let mut result = None;
            for i in 0..count {
                let dict = CFArrayGetValueAtIndex(list, i);
                if dict.is_null() { continue; }
                let title = read_cfstr(CFDictionaryGetValue(dict, k_name));
                let owner = read_cfstr(CFDictionaryGetValue(dict, k_owner));
                let text = format!("{} {}", title.to_lowercase(), owner.to_lowercase());
                for kw in keywords {
                    if text.contains(&kw.to_lowercase()) {
                        result = Some((kw.clone(), title, owner));
                        break;
                    }
                }
                if result.is_some() { break; }
            }
            CFRelease(k_name); CFRelease(k_owner); CFRelease(list);
            result
        }
    }

    /// 使用 NSWorkspace 检查是否有匹配名称的应用在运行（不依赖 CGWindowList）
    pub fn running_apps_contain(keywords: &[String]) -> Option<String> {
        unsafe {
            use objc::{class, msg_send, sel, sel_impl};
            let workspace: cocoa::base::id = msg_send![class!(NSWorkspace), sharedWorkspace];
            let apps: cocoa::base::id = msg_send![workspace, runningApplications];
            let count: u64 = msg_send![apps, count];
            for i in 0..count {
                let app: cocoa::base::id = msg_send![apps, objectAtIndex:i];
                let name: cocoa::base::id = msg_send![app, localizedName];
                if !name.is_null() {
                    let name_str = read_cfstr(name as *const c_void);
                    let lower = name_str.to_lowercase();
                    for kw in keywords {
                        if lower.contains(&kw.to_lowercase()) {
                            return Some(kw.clone());
                        }
                    }
                }
            }
            None
        }
    }

    /// 调试：dump 所有窗口的 (owner, title) 对
    pub fn dump_all_windows() -> Vec<serde_json::Value> {
        unsafe {
            let mut result = Vec::new();
            let list = CGWindowListCopyWindowInfo(ON_SCREEN, NULL_WIN);
            if list.is_null() { return result; }
            let count = CFArrayGetCount(list);
            let k_name = make_cfstr("kCGWindowName");
            let k_owner = make_cfstr("kCGWindowOwnerName");
            for i in 0..count {
                let dict = CFArrayGetValueAtIndex(list, i);
                if dict.is_null() { continue; }
                let title = read_cfstr(CFDictionaryGetValue(dict, k_name));
                let owner = read_cfstr(CFDictionaryGetValue(dict, k_owner));
                if !owner.is_empty() {
                    result.push(serde_json::json!({"owner": owner, "title": title}));
                }
            }
            CFRelease(k_name); CFRelease(k_owner); CFRelease(list);
            result
        }
    }

    /// 用 AppleScript 查浏览器标签页 URL（限时 3 秒，超时熔断 10 分钟）
    pub fn check_browser_url(keyword: &str) -> bool {
        use std::process::Command;
        use std::time::{Duration, SystemTime};
        use std::sync::mpsc;
        use std::thread;
        use std::sync::atomic::{AtomicI64, Ordering};

        static LAST_TIMEOUT: AtomicI64 = AtomicI64::new(0);
        let now_ts = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_secs() as i64;
        let last_ts = LAST_TIMEOUT.load(Ordering::Relaxed);
        // 熔断：上次超时未超过 10 分钟，跳过
        if last_ts > 0 && (now_ts - last_ts) < 600 { return false; }

        let kw = keyword.to_lowercase();
        let scripts: &[&str] = &[
            "tell application \"Safari\" to if it is running then URL of current tab of front window",
            "tell application \"Google Chrome\" to if it is running then URL of active tab of front window",
        ];

        let mut timed_out = false;
        for script in scripts {
            let (tx, rx) = mpsc::channel();
            let script_owned = script.to_string();
            thread::spawn(move || {
                let _ = tx.send(Command::new("osascript").args(["-e", &script_owned]).output());
            });

            match rx.recv_timeout(Duration::from_secs(3)) {
                Ok(Ok(output)) if output.status.success() => {
                    if String::from_utf8_lossy(&output.stdout).to_lowercase().contains(&kw) { return true; }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => { timed_out = true; }
                _ => {}
            }
        }
        if timed_out { LAST_TIMEOUT.store(now_ts, Ordering::Relaxed); }
        false
    }
}

/// 使用 NSWorkspace 检测应用是否在运行（不依赖 CGWindowList，无需特殊权限）
#[tauri::command]
fn check_running_app(keywords: Vec<String>) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        match macos_window::running_apps_contain(&keywords) {
            Some(kw) => Ok(serde_json::json!({"found": true, "keyword": kw}).to_string()),
            None => Ok(serde_json::json!({"found": false}).to_string()),
        }
    }
    #[cfg(not(target_os = "macos"))]
    { Ok(serde_json::json!({"found": false}).to_string()) }
}

/// 扫描所有窗口 + 浏览器标签页，检查是否包含关键词
#[tauri::command]
fn find_window_by_title(keyword: String) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        if macos_window::find_window_title(&keyword) { return Ok(true); }
        Ok(macos_window::check_browser_url(&keyword))
    }
    #[cfg(not(target_os = "macos"))]
    { Ok(false) }
}

/// 一次扫描匹配多个关键词，返回 JSON: {"keyword":"Code","title":"main.rs","owner":"Code"}
/// 或 "null" 无匹配
#[tauri::command]
fn match_window(keywords: Vec<String>) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        match macos_window::match_any_window(&keywords) {
            Some((kw, title, owner)) => {
                Ok(serde_json::json!({"keyword": kw, "title": title, "owner": owner}).to_string())
            }
            None => Ok("null".to_string())
        }
    }
    #[cfg(not(target_os = "macos"))]
    { Ok("null".to_string()) }
}

/// 调试：dump 所有窗口的 owner 和 title，返回 JSON 数组
#[tauri::command]
fn debug_windows() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let windows = macos_window::dump_all_windows();
        serde_json::to_string(&windows).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    { Ok("[]".to_string()) }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                for label in &["main", "settings"] {
                    if let Some(window) = app.get_window(label) {
                        let _ = window.with_webview(|webview| {
                            unsafe {
                                let wv: cocoa::base::id = webview.inner();
                                let ns_view: cocoa::base::id = objc::msg_send![wv, superview];
                                let ns_win: cocoa::base::id = objc::msg_send![ns_view, window];
                                let _: () = objc::msg_send![ns_win, setHasShadow: cocoa::base::NO];
                                let _: () = objc::msg_send![ns_win, setMovableByWindowBackground: cocoa::base::NO];
                            }
                        });
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            close_window,
            close_settings_window,
            get_soul_content,
            get_rag_data,
            get_character_config,
            open_settings_window,
            settings_updated,
            read_env,
            write_env,
            read_affection,
            write_affection,
            list_characters,
            get_current_character,
            set_current_character,
            find_window_by_title,
            match_window,
            check_running_app,
            debug_windows,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
