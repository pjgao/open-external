# Open External

<div align="center">
  <img src="images/icon.png" width="128" height="128" alt="Open External Logo">
  <br><br>
  <em>用外部应用打开任何文件 — 就在 VSCode 中</em>
  <br><br>
  <a href="README.en.md">English</a> | 中文
</div>

<br>

一个 VSCode 扩展，让你可以用外部应用程序打开任何文件。通过配置规则，将文件类型映射到你喜欢的应用——[Typora](https://typora.io)、Obsidian、Photoshop 或任何其他应用。

## 效果预览

<div align="center">
  <img src="images/sample_represation.png" alt="使用效果截图" width="600">
</div>

## 特性

- **灵活的规则**：通过 VSCode 语言 ID、文件扩展名或 glob 模式映射文件到外部应用
- **多种触发方式**：命令面板、编辑器标题栏按钮、资源管理器右键菜单
- **自动检测应用**：自动在 Windows、macOS、Linux 和 WSL 上查找已知应用（Typora、WPS、Office 等）
- **WSL 支持**：自动转换路径，通过 `cmd.exe` 启动 Windows 应用
- **应用降级**：主应用未安装时自动降级到替代应用（如 PowerPoint → WPS）
- **自定义路径**：如果应用名未被识别，可直接使用绝对路径

## 使用方式

1. 在 VSCode 中打开一个文件
2. 通过以下方式触发：
   - 点击编辑器标题栏的 **Open External** 按钮，**或**
   - 在资源管理器中右键文件 → **"Open in External App"**，**或**
   - 按 `Ctrl+Shift+P` → 输入 **"Open in External App"** → 回车
3. 文件将在匹配的外部应用中打开

## 配置

在 `settings.json` 中配置规则：

```json
"openExternal.rules": [
  { "language": "markdown", "app": "Typora" },
  { "extension": ".psd", "app": "/usr/bin/gimp" },
  { "pattern": "*.design.ts", "app": "Figma" },
  { "language": "python", "app": "/Applications/PyCharm.app/Contents/MacOS/pycharm" }
]
```

### 规则属性

| 属性        | 说明                                               | 必填 |
|-------------|---------------------------------------------------|------|
| `language`  | VSCode 语言标识符（如 `markdown`）                 | 否*  |
| `extension` | 文件扩展名（如 `.psd`）                            | 否*  |
| `pattern`   | 文件名 glob 匹配模式（如 `*.design.ts`）           | 否*  |
| `app`       | 应用名称（如 `Typora`）或可执行文件的绝对路径       | 是   |

\* `language`、`extension`、`pattern` 至少需要指定一个。规则按顺序匹配，第一个匹配的规则生效。

### 其他设置

| 设置 | 说明 | 默认值 |
|------|------|--------|
| `openExternal.showEditorTitleButton` | 在编辑器标题栏显示按钮 | `true` |

### 应用自动检测

以下应用名称会自动解析到默认安装路径：

| 应用          | Windows | macOS | Linux | WSL |
|---------------|---------|-------|-------|-----|
| Typora        | ✓ | ✓ | ✓ | ✓ |
| Obsidian      | ✓ | ✓ | ✓ | ✓ |
| MarkText      | ✓ | ✓ | ✓ | ✓ |
| WPS           | ✓ | ✓ | ✓ | ✓ |
| Word          | ✓ | ✓ | — | ✓ |
| PowerPoint    | ✓ | ✓ | — | ✓ |
| Excel         | ✓ | ✓ | — | ✓ |
| Drawio        | ✓ | ✓ | ✓ | ✓ |
| XMind         | ✓ | ✓ | ✓ | ✓ |
| Photoshop     | ✓ | ✓ | — | ✓ |
| Illustrator   | ✓ | ✓ | — | ✓ |
| VLC           | ✓ | ✓ | ✓ | ✓ |
| Preview       | — | ✓ | — | — |

不在列表中的应用，请使用可执行文件的绝对路径作为 `app` 值。

### 应用降级

当主应用未安装时，会自动尝试降级到替代应用：

| 主应用       | 降级到     |
|-------------|-----------|
| Word        | WPS       |
| PowerPoint  | WPS       |
| Excel       | WPS       |
| Photoshop   | GIMP      |
| Illustrator | Inkscape  |

### 默认规则

扩展内置以下默认规则（可在设置中覆盖或扩展）：

| 文件类型     | 扩展名 / 语言标识       | 应用         |
|-------------|------------------------|-------------|
| Markdown    | `language: markdown`   | Typora      |
| Draw.io     | `.drawio`, `.dio`      | Drawio      |
| PowerPoint  | `.pptx`, `.ppt`        | PowerPoint  |
| Word        | `.docx`, `.doc`        | Word        |
| Excel       | `.xlsx`, `.xls`        | Excel       |
| XMind       | `.xmind`               | XMind       |
| Photoshop   | `.psd`                 | Photoshop   |
| Illustrator | `.ai`                  | Illustrator |

## 限制

- 远程容器和 SSH 会话**不支持**（外部应用是本地 GUI 程序）
- WSL 完全支持

## 开发

```bash
# 安装依赖
npm install

# 编译
npm run compile

# 监听变化
npm run watch

# 打包为 VSIX
npx vsce package
```

在 VSCode 中按 `F5` 启动扩展开发主机进行测试。

## 许可证

MIT
