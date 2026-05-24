# Open External 设计文档

> 面向不熟悉 VSCode 插件开发和 TypeScript 的程序员，讲解本插件的设计思路和实现细节。

---

## 一、这个插件做什么？

一句话：**在 VSCode 里打开文件时，用外部应用（Typora、WPS、Office 等）来打开，而不是在 VSCode 内部打开。**

举个例子：你在 VSCode 里双击一个 `.pptx` 文件，默认 VSCode 会以二进制方式打开它，显示乱码。有了这个插件，右键点击 → "Open in External App"，就能直接用 PowerPoint 或 WPS 打开。

---

## 二、整体架构

插件的核心流程只有 4 步：

```
用户触发命令 → 匹配规则 → 查找应用 → 启动应用
```

对应代码中的 4 个核心模块：

```
┌─────────────────────────────────────────────────────┐
│                   extension.ts                       │
│                                                      │
│  ┌──────────┐   ┌──────────┐   ┌──────────────┐    │
│  │ 命令注册  │──▶│ 规则匹配  │──▶│ 应用路径检测  │    │
│  │ activate │   │ matchRule│   │ resolveAppPath│    │
│  └──────────┘   └──────────┘   └──────┬───────┘    │
│                                       │             │
│                              ┌────────▼────────┐   │
│                              │   启动应用       │   │
│                              │  openWithApp    │   │
│                              └─────────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

## 三、VSCode 插件基础知识

### 3.1 插件 = 一个 Node.js 程序

VSCode 插件本质上是一个 Node.js 程序，入口文件由 `package.json` 中的 `"main"` 字段指定：

```json
"main": "./out/extension.js"
```

我们用 TypeScript 写代码（`src/extension.ts`），编译后输出到 `out/extension.js`。

### 3.2 两个必须导出的函数

VSCode 只认两个函数：

```typescript
export function activate(context: vscode.ExtensionContext) {
  // 插件被激活时调用，注册命令、事件监听等
}

export function deactivate() {
  // 插件被停用时调用，清理资源（本插件不需要）
}
```

### 3.3 package.json 是插件的"身份证"

VSCode 通过 `package.json` 的 `contributes` 字段了解插件提供了什么功能：

| 字段 | 作用 | 本插件的配置 |
|------|------|-------------|
| `commands` | 注册命令 | `openExternal.open` → "Open in External App" |
| `menus` | 把命令放到菜单里 | 编辑器标题栏按钮 + 资源管理器右键 |
| `configuration` | 声明用户可配置项 | `openExternal.rules` 和 `openExternal.showEditorTitleButton` |

### 3.4 激活事件

VSCode 插件默认不加载，只有满足特定条件才激活。本插件设置：

```json
"activationEvents": ["onStartupFinished"]
```

意思是 VSCode 启动完成后自动激活，因为我们需要在任何文件类型上都能响应命令。

---

## 四、核心模块详解

### 4.1 命令注册（用户如何触发）

用户通过 3 种方式触发 `openExternal.open` 命令：

1. **命令面板**：`Ctrl+Shift+P` → 输入 "Open in External App"
2. **编辑器标题栏按钮**：代码中的 `menus.editor/title` 配置
3. **资源管理器右键菜单**：代码中的 `menus.explorer/context` 配置

命令被触发后，需要获取当前文件的路径和语言 ID：

```typescript
// 如果从右键菜单触发，uri 参数有值
if (uri && uri.fsPath) {
  filePath = uri.fsPath;
} else {
  // 从命令面板或标题栏按钮触发，取当前活动编辑器
  const activeEditor = vscode.window.activeTextEditor;
  filePath = activeEditor.document.uri.fsPath;
  languageId = activeEditor.document.languageId;
}
```

### 4.2 规则匹配（决定用哪个应用打开）

规则是插件最核心的数据结构：

```typescript
interface Rule {
  language?: string;   // VSCode 语言 ID，如 "markdown"
  extension?: string;  // 文件扩展名，如 ".pptx"
  pattern?: string;    // glob 模式，如 "*.design.ts"
  app: string;         // 应用名称或绝对路径
}
```

匹配优先级：**language > extension > pattern**

**为什么要 language → extension 的兜底机制？**

当用户从资源管理器右键触发命令时，VSCode 可能还没有打开这个文件，此时 `languageId` 为 `undefined`。比如 `.md` 文件的规则是 `{ language: "markdown", app: "Typora" }`，如果只按 language 匹配，从右键菜单触发就匹配不上。

解决方案：维护一个 `LANGUAGE_EXTENSIONS` 映射表，当 language 匹配不到时，用文件扩展名反查 language：

```
.md → markdown → 命中 { language: "markdown", app: "Typora" }
```

### 4.3 应用路径检测（找到应用在哪）

这是最复杂的模块，需要处理 3 种操作系统 + WSL 场景。

#### 4.3.1 本地检测（Windows/macOS/Linux）

维护一个已知应用的安装路径映射表 `APP_PATHS`：

```
Typora → {
  win32: ["C:\\Users\\...\\AppData\\Local\\Programs\\Typora\\Typora.exe", ...],
  darwin: ["/Applications/Typora.app/Contents/MacOS/Typora"],
  linux: ["/usr/bin/typora", ...]
}
```

遍历候选路径，第一个存在的就返回。

#### 4.3.2 WSL 检测（难点）

WSL（Windows Subsystem for Linux）是本插件最复杂的场景。

**问题：** VSCode 通过 WSL 远程连接时，扩展运行在 Linux 侧，但需要调用 Windows 侧的应用。

**挑战：**
- WSL 中 `process.env.LOCALAPPDATA` 等 Windows 环境变量**不存在**
- WSL 中的文件路径（如 `/home/user/doc.md`）需要转换为 Windows 路径（如 `\\wsl$\Ubuntu\home\user\doc.md`）
- WPS 等应用安装在版本号子目录下（如 `WPS Office/12.1.0.26375/office6/`），路径不固定

**解决方案：**

1. **路径检测**：不依赖 Windows 环境变量，直接扫描 `/mnt/c/Users/`、`/mnt/c/Program Files/` 等硬编码路径
2. **路径转换**：使用 `wslpath -w` 命令将 Linux 路径转为 Windows 路径
3. **启动应用**：通过 `cmd.exe /c start` 启动 Windows 应用

```
WSL 中的流程：
  /home/user/doc.md
       ↓ wslpath -w
  \\wsl$\Ubuntu\home\user\doc.md
       ↓ cmd.exe /c start Typora.exe <windows_path>
  Windows 上的 Typora 打开文件
```

#### 4.3.3 动态搜索（处理版本号子目录）

WPS、Adobe 等应用的安装路径包含版本号，无法硬编码。`findExeInDir` 函数递归搜索父目录：

```
/mnt/c/Users/gaopengju/AppData/Local/Kingsoft/
  └── WPS Office/           ← 精确路径找不到 ksolaunch.exe
       └── 12.1.0.26375/    ← 动态搜索找到这个版本号子目录
            └── office6/
                 └── ksolaunch.exe  ← 找到了！
```

搜索深度限制为 2 层，避免性能问题。

### 4.4 应用降级（主应用找不到时用替代应用）

当用户电脑上没装 PowerPoint 但装了 WPS 时，自动降级：

```typescript
const APP_FALLBACKS = {
  Word: ["WPS"],
  PowerPoint: ["WPS"],
  Excel: ["WPS"],
  Photoshop: ["GIMP"],
  Illustrator: ["Inkscape"],
};
```

降级时会弹出提示：`'PowerPoint' not found, using 'WPS' instead.`

### 4.5 启动应用

最终启动应用时，区分两种场景：

- **本地**：`execFile(appPath, [filePath])` — 直接启动进程
- **WSL**：`execFile("cmd.exe", ["/c", "start", "", winAppPath, winPath])` — 通过 Windows 的 `start` 命令启动

---

## 五、项目文件结构

```
open-external/
├── src/
│   └── extension.ts          # 所有逻辑都在这一个文件里
├── out/
│   └── extension.js          # TypeScript 编译产物（自动生成）
├── images/
│   ├── icon.png              # Marketplace 图标
│   ├── icon.svg              # 矢量图标源文件
│   ├── icon-light.svg        # VSCode 浅色主题编辑器按钮
│   ├── icon-dark.svg         # VSCode 深色主题编辑器按钮
│   └── sample_represation.png # 使用效果截图
├── .vscode/
│   ├── launch.json           # F5 调试配置
│   └── tasks.json            # 构建任务配置
├── package.json              # 插件清单（命令、配置、菜单等）
├── tsconfig.json             # TypeScript 编译配置
├── .vscodeignore             # 打包时排除的文件
├── .gitignore
├── README.md                 # 中文文档（默认）
├── README.en.md              # 英文文档
└── DESIGN.md                 # 本设计文档
```

---

## 六、开发调试流程

### 6.1 环境准备

```bash
npm install          # 安装依赖（vscode 类型定义、TypeScript）
npm run compile      # 编译 TypeScript → JavaScript
```

### 6.2 调试

1. 在 VSCode 中打开本项目
2. 按 `F5`，VSCode 会启动一个新的"扩展开发主机"窗口
3. 在新窗口中打开 `.md` 或 `.pptx` 文件测试
4. 在原窗口中可以设置断点调试

### 6.3 打包

```bash
npx vsce package     # 生成 .vsix 文件，用户可以手动安装
```

---

## 七、关键设计决策

| 决策 | 原因 |
|------|------|
| 所有逻辑放在一个文件 | 插件规模小，单文件更易理解和维护 |
| 内置 `simpleGlob` 而非用 `minimatch` | vsce 打包时不包含 `node_modules`，外部依赖会导致运行时报错 |
| WSL 路径硬编码而非用环境变量 | WSL 中 Windows 环境变量（LOCALAPPDATA 等）不可用 |
| 动态搜索限制 2 层深度 | 避免在大型目录树中递归搜索导致性能问题 |
| 默认规则硬编码在代码中 | `package.json` 中的 `default` 数组有时不被 VSCode 正确读取 |
| language → extension 兜底 | 从资源管理器右键触发时，`languageId` 可能为 undefined |
| 应用降级机制 | 很多用户没装 Office，但装了 WPS，降级能提升体验 |

---

## 八、踩过的坑

1. **vsce 不打包 node_modules**：`minimatch` 作为运行时依赖没进 vsix，导致 `require` 失败。改为自实现 `simpleGlob`。
2. **WSL 环境变量缺失**：`LOCALAPPDATA`、`WINDIR` 在 WSL 中为 undefined，必须直接扫描 `/mnt/c/` 路径。
3. **Windows 路径反斜杠**：`path.join` 在 WSL 上用 `/`，但 Windows 路径用 `\`，转换时需要注意。
4. **默认规则不生效**：VSCode 对 `package.json` 中数组类型的 `default` 可能不自动填充，改为代码内硬编码 `DEFAULT_RULES`。
5. **资源管理器右键缺少 languageId**：右键菜单触发的命令中 `uri` 有值但 `languageId` 为 undefined，需要 extension 兜底匹配。
