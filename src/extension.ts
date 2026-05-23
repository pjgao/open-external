import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execFile, exec } from "child_process";

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

// 简单的 glob 匹配：支持 * 和 ? 通配符，大小写不敏感
function simpleGlob(fileName: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  const regex = new RegExp(`^${regexStr}$`, "i");
  return regex.test(fileName);
}

// ============ 规则匹配 ============

interface Rule {
  language?: string;
  extension?: string;
  pattern?: string;
  app: string;
}

// 插件内置的默认规则，当用户未配置任何规则时使用
const DEFAULT_RULES: Rule[] = [
  { language: "markdown", app: "Typora" },
  { extension: ".drawio", app: "Drawio" },
  { extension: ".dio", app: "Drawio" },
  { extension: ".pptx", app: "PowerPoint" },
  { extension: ".ppt", app: "PowerPoint" },
  { extension: ".docx", app: "Word" },
  { extension: ".doc", app: "Word" },
  { extension: ".xlsx", app: "Excel" },
  { extension: ".xls", app: "Excel" },
  { extension: ".xmind", app: "XMind" },
  { extension: ".psd", app: "Photoshop" },
  { extension: ".ai", app: "Illustrator" },
];

// 获取用户配置的规则列表，未配置则使用默认规则
function getRules(): Rule[] {
  const config = vscode.workspace.getConfiguration("openExternal");
  const rules = config.get<Rule[]>("rules", []);
  if (rules && rules.length > 0) {
    return rules;
  }
  return DEFAULT_RULES;
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
    if (rule.pattern && simpleGlob(fileName, rule.pattern)) {
      return rule;
    }
  }
  return undefined;
}

// ============ 应用路径检测 ============

// WSL 场景下，各应用在 Windows 上的可执行文件名
// 部分应用的 exe 名与 app 名不一致（如 WPS 对应 ksolaunch.exe / wps.exe）
const WSL_EXE_NAMES: Record<string, string[]> = {
  WPS: ["ksolaunch.exe", "wps.exe", "et.exe", "wpp.exe"],
  Word: ["WINWORD.EXE"],
  PowerPoint: ["POWERPNT.EXE"],
  Excel: ["EXCEL.EXE"],
  Drawio: ["draw.io.exe"],
};

// 已知应用的默认安装路径映射
// WSL 路径不在此处，由 detectAppPathWsl 单独处理
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
  WPS: {
    win32: [
      path.join(process.env.LOCALAPPDATA || "", "Kingsoft", "WPS Office", "ksolaunch.exe"),
      path.join(process.env.ProgramFiles || "", "Kingsoft", "WPS Office", "ksolaunch.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "", "Kingsoft", "WPS Office", "ksolaunch.exe"),
    ],
    darwin: ["/Applications/wpsoffice.app/Contents/MacOS/wpsoffice"],
    linux: ["/usr/bin/wps", "/usr/bin/et", "/usr/bin/wpp", "/opt/kingsoft/wps-office/office6/wps"],
  },
  Word: {
    win32: [
      path.join(process.env.ProgramFiles || "", "Microsoft Office", "root", "Office16", "WINWORD.EXE"),
      path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft Office", "root", "Office16", "WINWORD.EXE"),
      path.join(process.env.ProgramFiles || "", "Microsoft Office", "Office16", "WINWORD.EXE"),
      path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft Office", "Office16", "WINWORD.EXE"),
      path.join(process.env.ProgramFiles || "", "Microsoft Office", "root", "Office15", "WINWORD.EXE"),
      path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft Office", "Office15", "WINWORD.EXE"),
    ],
    darwin: ["/Applications/Microsoft Word.app/Contents/MacOS/Microsoft Word"],
    linux: [],
  },
  PowerPoint: {
    win32: [
      path.join(process.env.ProgramFiles || "", "Microsoft Office", "root", "Office16", "POWERPNT.EXE"),
      path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft Office", "root", "Office16", "POWERPNT.EXE"),
      path.join(process.env.ProgramFiles || "", "Microsoft Office", "Office16", "POWERPNT.EXE"),
      path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft Office", "Office16", "POWERPNT.EXE"),
      path.join(process.env.ProgramFiles || "", "Microsoft Office", "root", "Office15", "POWERPNT.EXE"),
      path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft Office", "Office15", "POWERPNT.EXE"),
    ],
    darwin: ["/Applications/Microsoft PowerPoint.app/Contents/MacOS/Microsoft PowerPoint"],
    linux: [],
  },
  Excel: {
    win32: [
      path.join(process.env.ProgramFiles || "", "Microsoft Office", "root", "Office16", "EXCEL.EXE"),
      path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft Office", "root", "Office16", "EXCEL.EXE"),
      path.join(process.env.ProgramFiles || "", "Microsoft Office", "Office16", "EXCEL.EXE"),
      path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft Office", "Office16", "EXCEL.EXE"),
      path.join(process.env.ProgramFiles || "", "Microsoft Office", "root", "Office15", "EXCEL.EXE"),
      path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft Office", "Office15", "EXCEL.EXE"),
    ],
    darwin: ["/Applications/Microsoft Excel.app/Contents/MacOS/Microsoft Excel"],
    linux: [],
  },
  Drawio: {
    win32: [
      path.join(process.env.LOCALAPPDATA || "", "Programs", "draw.io", "draw.io.exe"),
      path.join(process.env.ProgramFiles || "", "draw.io", "draw.io.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "", "draw.io", "draw.io.exe"),
    ],
    darwin: ["/Applications/draw.io.app/Contents/MacOS/draw.io"],
    linux: ["/usr/bin/drawio", "/opt/draw.io/drawio", "/snap/bin/drawio"],
  },
  XMind: {
    win32: [
      path.join(process.env.LOCALAPPDATA || "", "Programs", "XMind", "XMind.exe"),
      path.join(process.env.ProgramFiles || "", "XMind", "XMind.exe"),
    ],
    darwin: ["/Applications/XMind.app/Contents/MacOS/XMind"],
    linux: ["/usr/bin/xmind", "/opt/XMind/xmind", "/snap/bin/xmind"],
  },
  Photoshop: {
    win32: [
      path.join(process.env.ProgramFiles || "", "Adobe", "Adobe Photoshop 2024", "Photoshop.exe"),
      path.join(process.env.ProgramFiles || "", "Adobe", "Adobe Photoshop 2023", "Photoshop.exe"),
      path.join(process.env.ProgramFiles || "", "Adobe", "Adobe Photoshop CC 2019", "Photoshop.exe"),
    ],
    darwin: ["/Applications/Adobe Photoshop 2024/Adobe Photoshop 2024.app/Contents/MacOS/Adobe Photoshop 2024"],
    linux: [],
  },
  Illustrator: {
    win32: [
      path.join(process.env.ProgramFiles || "", "Adobe", "Adobe Illustrator 2024", "Support Files", "Contents", "Windows", "Illustrator.exe"),
      path.join(process.env.ProgramFiles || "", "Adobe", "Adobe Illustrator 2023", "Support Files", "Contents", "Windows", "Illustrator.exe"),
    ],
    darwin: ["/Applications/Adobe Illustrator 2024/Adobe Illustrator 2024.app/Contents/MacOS/Adobe Illustrator 2024"],
    linux: [],
  },
  VLC: {
    win32: [
      path.join(process.env.ProgramFiles || "", "VideoLAN", "VLC", "vlc.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "", "VideoLAN", "VLC", "vlc.exe"),
    ],
    darwin: ["/Applications/VLC.app/Contents/MacOS/VLC"],
    linux: ["/usr/bin/vlc", "/usr/local/bin/vlc", "/snap/bin/vlc"],
  },
  Preview: {
    darwin: ["/System/Applications/Preview.app/Contents/MacOS/Preview"],
  },
};

// 在指定父目录下递归搜索可执行文件（最多2层，处理版本号子目录）
function findExeInDir(parentDir: string, exeName: string, maxDepth: number = 2): string | undefined {
  if (!fs.existsSync(parentDir)) {
    return undefined;
  }
  try {
    const entries = fs.readdirSync(parentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(parentDir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === exeName.toLowerCase()) {
        return fullPath;
      }
      if (entry.isDirectory() && maxDepth > 0) {
        const found = findExeInDir(fullPath, exeName, maxDepth - 1);
        if (found) {
          return found;
        }
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

// WSL 场景下检测 Windows 上的应用
// 优先从 APP_PATHS 中获取候选路径（转换为 /mnt 路径），再补充通用路径
// 对包含版本号子目录的应用（如 WPS），使用 findExeInDir 动态扫描
function detectAppPathWsl(appName: string): string | undefined {
  const candidates: string[] = [];
  const searchDirs: string[] = [];

  // 从 APP_PATHS 中获取该应用的 win32 路径，将 Windows 盘符路径转为 WSL /mnt 路径
  const known = APP_PATHS[appName];
  if (known && known.win32) {
    for (const winPath of known.win32) {
      const mntPath = winPath.replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`).replace(/\\/g, "/");
      candidates.push(mntPath);
    }
  }

  // 补充通用路径和搜索目录
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

  // 先尝试精确路径
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }

  // 精确路径找不到时，尝试在父目录中动态搜索可执行文件
  const exeNames = WSL_EXE_NAMES[appName] || [`${appName.toLowerCase()}.exe`];
  const parentDirs = new Set<string>();
  for (const candidate of candidates) {
    parentDirs.add(path.dirname(candidate));
    // 也加入上一级目录（如 Kingsoft/WPS Office 的父目录 Kingsoft）
    parentDirs.add(path.dirname(path.dirname(candidate)));
  }

  for (const dir of parentDirs) {
    for (const exeName of exeNames) {
      const found = findExeInDir(dir, exeName);
      if (found) {
        return found;
      }
    }
  }

  return undefined;
}

// 在已知映射中查找应用路径，找不到则在父目录动态搜索，最后尝试绝对路径
function resolveAppPath(appName: string): string | undefined {
  if (isWsl()) {
    return detectAppPathWsl(appName);
  }

  const platform = os.platform() as string;
  const known = APP_PATHS[appName];
  if (known && known[platform]) {
    // 先尝试精确路径
    for (const candidate of known[platform]) {
      try {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch {
        // ignore
      }
    }
    // 精确路径未找到，在父目录动态搜索可执行文件
    const exeNames = WSL_EXE_NAMES[appName] || [`${appName.toLowerCase()}.exe`];
    const parentDirs = new Set<string>();
    for (const candidate of known[platform]) {
      parentDirs.add(path.dirname(candidate));
      parentDirs.add(path.dirname(path.dirname(candidate)));
    }
    for (const dir of parentDirs) {
      for (const exeName of exeNames) {
        const found = findExeInDir(dir, exeName);
        if (found) {
          return found;
        }
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
