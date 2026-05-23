import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execFile, exec } from "child_process";

/**
 * 检测当前是否运行在 WSL 环境中
 * 通过内核版本号中是否包含 "microsoft" 或 "wsl" 来判断
 */
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

/**
 * 检测当前是否为远程容器或 SSH 连接（非 WSL）
 * WSL 虽然也是远程连接，但可以访问 Windows 文件系统，所以单独处理
 */
function isRemoteContainer(): boolean {
  if (!vscode.env.remoteName) {
    return false;
  }
  return vscode.env.remoteName !== "wsl";
}

/**
 * 从 HOME 路径中提取 Windows 用户名
 * 例如 /mnt/c/Users/gaopengju → gaopengju
 */
function getWindowsUsername(): string | undefined {
  const user = process.env.USER || process.env.LOGNAME;
  const home = process.env.HOME || "";
  const match = home.match(/\/mnt\/[c-z]\/Users\/([^/]+)/);
  if (match) {
    return match[1];
  }
  return user;
}

// 自动检测 Typora 可执行文件路径
// WSL: 扫描 Windows 用户目录和 Program Files
// Windows: 使用 LOCALAPPDATA、ProgramFiles 环境变量
// macOS: 检测 Applications 目录
// Linux: 检测标准可执行文件路径
function detectTyporaPath(): string | undefined {
  if (isWsl()) {
    const candidates: string[] = [];

    // 通过 WINDIR 环境变量确定 Windows 系统盘符，扫描所有用户的 AppData 目录
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
          candidates.push(path.join(winUsersBase, u, "AppData", "Local", "Programs", "Typora", "Typora.exe"));
        }
      } catch {
        // ignore
      }
    }

    // 补充 Program Files 路径
    for (const drive of ["c", "d"]) {
      candidates.push(`/mnt/${drive}/Program Files/Typora/Typora.exe`);
      candidates.push(`/mnt/${drive}/Program Files (x86)/Typora/Typora.exe`);
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

  const platform = os.platform();
  const candidates: string[] = [];

  if (platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    const programFiles = process.env.ProgramFiles || "";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "";
    candidates.push(
      path.join(localAppData, "Programs", "Typora", "Typora.exe"),
      path.join(programFiles, "Typora", "Typora.exe"),
      path.join(programFilesX86, "Typora", "Typora.exe")
    );
  } else if (platform === "darwin") {
    candidates.push("/Applications/Typora.app/Contents/MacOS/Typora");
  } else {
    candidates.push("/usr/bin/typora", "/usr/local/bin/typora", "/snap/bin/typora");
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

/**
 * 获取 Typora 路径：优先使用用户配置，未配置则自动检测
 */
function getTyporaPath(): string | undefined {
  const config = vscode.workspace.getConfiguration("openInTypora");
  const configured = config.get<string>("executablePath", "");
  if (configured) {
    return configured;
  }
  return detectTyporaPath();
}

/**
 * 将 WSL 中的 Linux 路径转换为 Windows 路径
 * 使用 wslpath -w 命令，例如 /home/user/doc.md → \\wsl$\Ubuntu\home\user\doc.md
 */
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

/**
 * 使用 Typora 打开指定的 Markdown 文件
 * 
 * 处理三种场景：
 * 1. 远程容器/SSH：提示不支持
 * 2. WSL：路径转换后通过 cmd.exe 调用 Windows 上的 Typora
 * 3. 本地：直接 execFile 启动 Typora
 */
async function openInTypora(filePath: string): Promise<void> {
  if (isRemoteContainer()) {
    vscode.window.showErrorMessage(
      "Open in Typora is not supported in remote containers or SSH sessions. It only works locally or via WSL."
    );
    return;
  }

  const typoraPath = getTyporaPath();

  if (!typoraPath) {
    const openSettings = "Open Settings";
    const choice = await vscode.window.showErrorMessage(
      "Typora executable not found. Please set 'openInTypora.executablePath' in settings.",
      openSettings
    );
    if (choice === openSettings) {
      vscode.commands.executeCommand("workbench.action.openSettings", "openInTypora.executablePath");
    }
    return;
  }

  // WSL 场景：将 Linux 路径转为 Windows 路径，通过 cmd.exe start 启动 Typora
  if (isWsl()) {
    const winPath = await wslToWindowsPath(filePath);
    const winTyporaPath = await wslToWindowsPath(typoraPath);
    return new Promise((resolve, reject) => {
      execFile("cmd.exe", ["/c", "start", "", winTyporaPath, winPath], (error) => {
        if (error) {
          vscode.window.showErrorMessage(`Failed to open Typora: ${error.message}`);
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  // 本地场景：直接启动 Typora 进程
  return new Promise((resolve, reject) => {
    execFile(typoraPath, [filePath], (error) => {
      if (error) {
        vscode.window.showErrorMessage(`Failed to open Typora: ${error.message}`);
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/**
 * 插件入口：注册 openInTypora.open 命令
 * 支持从命令面板调用，也支持从编辑器标题栏按钮调用（传入 uri 参数）
 */
export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand("openInTypora.open", async (uri?: vscode.Uri) => {
    let filePath: string | undefined;

    // 优先使用传入的 uri（标题栏按钮场景），否则取当前活动编辑器的文件路径
    if (uri && uri.fsPath) {
      filePath = uri.fsPath;
    } else {
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        filePath = activeEditor.document.uri.fsPath;
      }
    }

    if (!filePath) {
      vscode.window.showWarningMessage("No file is currently open.");
      return;
    }

    if (!filePath.toLowerCase().endsWith(".md")) {
      vscode.window.showWarningMessage("Current file is not a Markdown file.");
      return;
    }

    await openInTypora(filePath);
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // nothing
}
