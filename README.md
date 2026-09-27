# dsh-window-zoom

给 **DSH Desktop（macOS）** 补上「双击窗口顶部 = 缩放」的原生行为：双击展开到屏幕工作区，
再双击还原。纯插件实现（client + host 两半），**不修改客户端 app 的任何文件**。

## 为什么是这个实现

| 已排除的路径 | 原因（本机实测） |
|---|---|
| CSS `-webkit-app-region: drag` + 系统双击标题栏 | 官方前端**本来就标了** `data-window-drag`，但本机壳层不响应（真鼠标拖动/双击均无效） |
| 点窗口按钮（`AXZoomButton`） | 这个 Electron 窗口只有 `AXCloseButton / AXFullScreenButton / AXMinimizeButton` —— **没有 zoom 按钮**可点 |
| `window.resizeTo/moveTo` | Chromium 不允许脚本改非自开窗口，实测无效 |
| 改 app.asar / 重签 / `Resources/app` 覆盖 | 禁止（用户红线；且会破坏 TCC 授权） |

**可行路径**：System Events 的 AX 接口直接设置窗口 `position/size`，用「记录原 frame ↔ 展开到
`NSScreen.visibleFrame`」复刻 zoom 语义。已实测：读 frame、设 size、设 position、工作区读取全部可用。

## 结构

```
lib/index.js    host 半边：AppleScript 读写窗口 frame，注册路由
lib/client.js   client 半边：双击检测（顶部 96px + computed drag 区）
tests/client-test.mjs  fake-loader 探针（6 条断言，node 直接跑）
```

| 路由 | 说明 |
|---|---|
| `POST /dsh-window-zoom/toggle` | 双击时调用：展开 / 还原（幂等） |
| `GET  /dsh-window-zoom` | 诊断：`{frame, work, saved, lastAction}` |

## 安装（desktop profile）

1. 本目录置于 `~/.dsh/local-plugins/dsh-window-zoom`
2. `~/.dsh/profiles/desktop/package.json` dependencies 加
   `"dsh-window-zoom": "link:../../local-plugins/dsh-window-zoom"`
3. `~/.dsh/profiles/desktop/cordis.patch.yml` 加 insert `{id: dsh-window-zoom, name: dsh-window-zoom}`
4. `node_modules/dsh-window-zoom -> ../../../local-plugins/dsh-window-zoom` 软链
   （pnpm install 在 desktop 上会重建整树、prune 手工 link，改用软链）
5. **完全重启 DSH Desktop**（host 半边与 client 清单都在启动时读取）

## 权限（一次性）

宿主需要两个 TCC 授权，弹窗允许即可；本机已确认可用：

- **自动化（AppleEvents）**：允许 DSH 控制 System Events
- **辅助功能**：允许 System Events 操作其它 app 的窗口

## 回滚

删掉 patch insert 块 + package.json 依赖行 + 软链，重启应用。

## 已知边界

- 只在 macOS 桌面壳工作（`html[data-platform="darwin"]`）；web GUI / 非 mac 零监听零请求
- 还原点存在 host 进程内存里，重启应用后首次双击视为「展开」
- 多窗口时只操作 `window 1`（DSH 桌面目前单主窗）
