import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execFile, exec } from "child_process";
import { minimatch } from "minimatch";

// ============ WSL 检测 ============

// 通过内核版本号检测 WSL 环境
function isWsl(): boolean {
  if (os.platform() !== "linux") {
    return false;
  }
  try {
    const release = os.release().toLowerCase();
    return release.includes("microsoft") || release.includes("wsl");
  } catch {
    return false;
  }
}

// 检测是否为远程容器或 SSH（非 WSL），这些场景不支持外部 GUI 应用
function isRemoteContainer(): boolean {
  if (!vscode.env.remoteName) {
    return false;
  }
  return vscode.env.remoteName !== "wsl";
}

// ============ 路径转换 ============

// 将 WSL 中的 Linux 路径转换为 Windows 路径
function wslToWindowsPath(wslPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(`wslpath -w "${wslPath}"`, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// ============ 规则匹配 ============

interface Rule {
  language?: string;
  extension?: string;
  pattern?: string;
  app: string;
}

// 获取用户配置的规则列表
function getRules(): Rule[] {
  const config = vscode.workspace.getConfiguration("openExternal");
  return config.get<Rule[]>("rules", []);
}

// 根据文件路径和语言 ID 匹配规则，返回第一条匹配的规则
function matchRule(filePath: string, languageId: string | undefined): Rule | undefined {
  const rules = getRules();
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  for (const rule of rules) {
    if (rule.language && languageId && rule.language === languageId) {
      return rule;
    }
    if (rule.extension && ext === rule.extension.toLowerCase()) {
      return rule;
    }
    if (rule.pattern && minimatch(fileName, rule.pattern, { nocase: true })) {
      return rule;
    }
  }
  return undefined;
}

// ============ 应用路径检测 ============

// 已知应用的默认安装路径映射
const APP_PATHS: Record<string, Record<string, string[]>> = {
  Typora: {
    win32: [
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Typora", "Typora.exe"),
      path.join(process.env.ProgramFiles || "", "Typora", "Typora.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "", "Typora", "Typora.exe"),
    ],
    darwin: ["/Applications/Typora.app/Contents/MacOS/Typora"],
    linux: ["/usr/bin/typora", "/usr/local/bin/typora", "/snap/bin/typora"],
  },
  Obsidian: {
    win32: [
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Obsidian", "Obsidian.exe"),
      path.join(process.env.ProgramFiles || "", "Obsidian", "Obsidian.exe"),
    ],
    darwin: ["/Applications/Obsidian.app/Contents/MacOS/Obsidian"],
    linux: ["/usr/bin/obsidian", "/snap/bin/obsidian", "/usr/local/bin/obsidian"],
  },
  MarkText: {
    win32: [
      path.join(process.env.LOCALAPPDATA || "", "Programs", "MarkText", "MarkText.exe"),
      path.join(process.env.ProgramFiles || "", "MarkText", "MarkText.exe"),
    ],
    darwin: ["/Applications/MarkText.app/Contents/MacOS/MarkText"],
    linux: ["/usr/bin/marktext", "/usr/local/bin/marktext", "/snap/bin/marktext"],
  },
};

// WSL 场景下检测 Windows 上的应用
function detectAppPathWsl(appName: string): string | undefined {
  const candidates: string[] = [];
  const windir = process.env.WINDIR;
  if (windir) {
    const driveLetter = windir.charAt(0).toLowerCase();
    const winUsersBase = `/mnt/${driveLetter}/Users`;
    try {
      const users = fs.readdirSync(winUsersBase);
      for (const u of users) {
        if (u === "Public" || u === "Default" || u === "Default User" || u === "All Users" || u.startsWith(".")) {
          continue;
        }
        candidates.push(path.join(winUsersBase, u, "AppData", "Local", "Programs", appName, `${appName}.exe`));
      }
    } catch {
      // ignore
    }
  }
  for (const drive of ["c", "d"]) {
    candidates.push(`/mnt/${drive}/Program Files/${appName}/${appName}.exe`);
    candidates.push(`/mnt/${drive}/Program Files (x86)/${appName}/${appName}.exe`);
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

// 在已知映射中查找应用路径，找不到则尝试将 app 当作可执行文件路径
function resolveAppPath(appName: string): string | undefined {
  if (isWsl()) {
    return detectAppPathWsl(appName);
  }

  const platform = os.platform() as string;
  const known = APP_PATHS[appName];
  if (known && known[platform]) {
    for (const candidate of known[platform]) {
      try {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch {
        // ignore
      }
    }
  }

  // 如果 appName 本身就是绝对路径，直接返回
  if (path.isAbsolute(appName)) {
    try {
      if (fs.existsSync(appName)) {
        return appName;
      }
    } catch {
      // ignore
    }
  }

  return undefined;
}

// ============ 核心打开逻辑 ============

async function openWithApp(filePath: string, rule: Rule): Promise<void> {
  if (isRemoteContainer()) {
    vscode.window.showErrorMessage(
      "Open in External App is not supported in remote containers or SSH sessions."
    );
    return;
  }

  const appPath = resolveAppPath(rule.app);

  if (!appPath) {
    const openSettings = "Open Settings";
    const choice = await vscode.window.showErrorMessage(
      `Application '${rule.app}' not found. Please set the correct path in 'openExternal.rules'.`,
      openSettings
    );
    if (choice === openSettings) {
      vscode.commands.executeCommand("workbench.action.openSettings", "openExternal.rules");
    }
    return;
  }

  // WSL: 转换路径后通过 cmd.exe 启动 Windows 应用
  if (isWsl()) {
    const winPath = await wslToWindowsPath(filePath);
    const winAppPath = await wslToWindowsPath(appPath);
    return new Promise((resolve, reject) => {
      execFile("cmd.exe", ["/c", "start", "", winAppPath, winPath], (error) => {
        if (error) {
          vscode.window.showErrorMessage(`Failed to open ${rule.app}: ${error.message}`);
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  // 本地: 直接启动应用
  return new Promise((resolve, reject) => {
    execFile(appPath, [filePath], (error) => {
      if (error) {
        vscode.window.showErrorMessage(`Failed to open ${rule.app}: ${error.message}`);
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

// ============ 插件入口 ============

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand("openExternal.open", async (uri?: vscode.Uri) => {
    let filePath: string | undefined;
    let languageId: string | undefined;

    if (uri && uri.fsPath) {
      filePath = uri.fsPath;
    } else {
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        filePath = activeEditor.document.uri.fsPath;
        languageId = activeEditor.document.languageId;
      }
    }

    if (!filePath) {
      vscode.window.showWarningMessage("No file is currently open.");
      return;
    }

    const rule = matchRule(filePath, languageId);
    if (!rule) {
      const openSettings = "Open Settings";
      const choice = await vscode.window.showWarningMessage(
        `No external app rule matched for this file. Configure rules in settings.`,
        openSettings
      );
      if (choice === openSettings) {
        vscode.commands.executeCommand("workbench.action.openSettings", "openExternal.rules");
      }
      return;
    }

    await openWithApp(filePath, rule);
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // nothing
}
