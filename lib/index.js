// dsh-window-zoom — host half.
//
// 目标：让 DSH Desktop（Electron, titleBarStyle:"hiddenInset"）拥有 macOS 的
// 「双击标题栏 = 缩放」行为。客户端壳层的 drag region 在本机不响应（真机实测），
// 且窗口只有 close/fullscreen/minimize 三个 AX 按钮（没有 AXZoomButton），
// 所以这里不走「点按钮」，而是直接用 System Events 的 AX 接口设置窗口
// position/size —— 与 macOS zoom 语义等价（记录原 frame ↔ 展开到工作区）。
//
// 路由：POST /dsh-window-zoom/toggle  （client 半边双击时调用）
//       GET  /dsh-window-zoom         （诊断：当前 frame / 工作区 / 已存 frame）
//
// 依赖：macOS 辅助功能（System Events 控制其它 app 的窗口）+ 自动化授权。
//       已在 DSH Desktop 语境下实测可用（从 host 子进程执行 osascript 成功）。
// 零 npm 依赖；非 darwin 平台全部 no-op 且不报错。

import { spawnSync } from "node:child_process";

export const name = "dsh-window-zoom";

const PROCESS_NAME = "DeepSeek Harness";
/** 判定「已展开到工作区」的像素容差（AX 设置常有 1px 级取整）。 */
const EPS = 12;

/**
 * 读窗口 frame 与主屏工作区（NSScreen.visibleFrame，含菜单栏/dock 扣除）。
 * AX 坐标原点在左上、NSScreen 原点在左下，脚本内完成换算。
 * @returns {{frame:{x:number,y:number,w:number,h:number}, work:{x:number,y:number,w:number,h:number}} | {error:string}}
 */
function readState() {
	const lines = [
		'use framework "AppKit"',
		"set scr to current application's NSScreen's mainScreen()",
		"set vf to scr's visibleFrame()",
		"set fr to scr's frame()",
		"set sh to (current application's NSHeight(fr))",
		"set wx to (current application's NSMinX(vf))",
		"set wy to (current application's NSMinY(vf))",
		"set ww to (current application's NSWidth(vf))",
		"set wh to (current application's NSHeight(vf))",
		"set axY to sh - (wy + wh)",
		`tell application "System Events" to tell process "${PROCESS_NAME}"`,
		"tell window 1",
		"set {px, py} to position",
		"set {pw, ph} to size",
		"end tell",
		"end tell",
		"return {px, py, pw, ph, wx, axY, ww, wh}",
	];
	const result = runScript(lines);
	if (result.code !== 0) return { error: result.err || `osascript exited ${result.code}` };
	const nums = result.out.split(",").map((part) => Number(String(part).trim()));
	if (nums.length < 8 || nums.some((value) => !Number.isFinite(value))) {
		return { error: `unparsable osascript output: ${result.out}` };
	}
	const [px, py, pw, ph, wx, wy, ww, wh] = nums;
	return {
		frame: { x: px, y: py, w: pw, h: ph },
		work: { x: wx, y: wy, w: ww, h: wh },
	};
}

/**
 * 设置窗口 frame。
 * @param {{x:number,y:number,w:number,h:number}} frame - 目标 frame（AX 左上原点）。
 * @returns {{code:number, err:string}}
 */
function setFrame(frame) {
	const lines = [
		`tell application "System Events" to tell process "${PROCESS_NAME}"`,
		"tell window 1",
		`set position to {${Math.round(frame.x)}, ${Math.round(frame.y)}}`,
		`set size to {${Math.round(frame.w)}, ${Math.round(frame.h)}}`,
		"end tell",
		"end tell",
	];
	return runScript(lines);
}

/**
 * 执行一串 AppleScript 行（等价多个 -e）。
 * @param {string[]} lines - 脚本行。
 * @returns {{code:number, out:string, err:string}}
 */
function runScript(lines) {
	const args = [];
	for (const line of lines) args.push("-e", line);
	const result = spawnSync("/usr/bin/osascript", args, { encoding: "utf8", timeout: 8000 });
	return {
		code: typeof result.status === "number" ? result.status : 1,
		out: (result.stdout ?? "").trim(),
		err: (result.stderr ?? "").trim() || (result.error ? String(result.error.message) : ""),
	};
}

/** 放大前的窗口 frame（进程内记忆；重启即忘，符合桌面会话直觉）。 */
let savedFrame = null;
let lastAction = "idle";

/**
 * 在有窗口的平台判定 frame 是否已经等于工作区。
 * @param {{x:number,y:number,w:number,h:number}} frame - 当前 frame。
 * @param {{x:number,y:number,w:number,h:number}} work - 工作区 frame。
 * @returns {boolean}
 */
function isWorkArea(frame, work) {
	return Math.abs(frame.x - work.x) <= EPS && Math.abs(frame.y - work.y) <= EPS
		&& Math.abs(frame.w - work.w) <= EPS && Math.abs(frame.h - work.h) <= EPS;
}

/**
 * 双击语义：未展开 → 记下 frame 并展开到工作区；已展开 → 还原。幂等安全。
 * @returns {{ok:boolean, action?:string, frame?:object, error?:string}}
 */
export function windowZoomToggle() {
	if (process.platform !== "darwin") return { ok: false, error: "unsupported platform" };
	const state = readState();
	if (state.error) return { ok: false, error: state.error };
	const { frame, work } = state;
	if (isWorkArea(frame, work)) {
		if (savedFrame === null) {
			lastAction = "already";
			return { ok: true, action: "already", frame };
		}
		const restore = setFrame(savedFrame);
		if (restore.code !== 0) return { ok: false, error: restore.err };
		savedFrame = null;
		lastAction = "restore";
		return { ok: true, action: "restore", frame: work };
	}
	savedFrame = { ...frame };
	const zoom = setFrame(work);
	if (zoom.code !== 0) { savedFrame = null; return { ok: false, error: zoom.err }; }
	lastAction = "zoom";
	return { ok: true, action: "zoom", frame: work };
}

/**
 * 诊断读取（GET 路由与本地探针共用）。
 * @returns {object} 当前 frame / 工作区 / 已存 frame / 最近动作。
 */
export function windowZoomStatus() {
	if (process.platform !== "darwin") return { ok: false, error: "unsupported platform" };
	const state = readState();
	if (state.error) return { ok: false, error: state.error };
	return { ok: true, frame: state.frame, work: state.work, saved: savedFrame, lastAction };
}

/**
 * 挂载 host 半边：注册 /dsh-window-zoom 路由。
 * @param {object} ctx - cordis 上下文。
 */
export function apply(ctx) {
	if (process.platform !== "darwin") return; /* 非 mac 零副作用 */
	ctx.inject(["webServer"], (wctx) => {
		ctx.effect(
			() =>
				wctx.webServer.register({
					kind: "prefix",
					path: "/dsh-window-zoom",
					handler: (req, res) => {
						const url = new URL(req.url ?? "/", "http://localhost");
						/* ⚠️ prefix 注册下 req.url 是完整路径，两种形态都收（dsh-memguard 同款坑）。 */
						const pathname = url.pathname.replace(/\/+$/, "");
						const done = (status, body) => {
							const text = JSON.stringify(body);
							res.writeHead(status, {
								"content-type": "application/json; charset=utf-8",
								"content-length": Buffer.byteLength(text),
								"cache-control": "no-store",
							});
							res.end(text);
						};
						try {
							if (req.method === "POST" && (pathname === "/toggle" || pathname.endsWith("/dsh-window-zoom/toggle"))) {
								const body = windowZoomToggle();
								done(body.ok ? 200 : 500, body);
								return;
							}
							if (req.method === "GET") {
								const body = windowZoomStatus();
								done(body.ok ? 200 : 500, body);
								return;
							}
							done(405, { ok: false, error: "method not allowed" });
						} catch (error) {
							done(500, { ok: false, error: String(error?.message ?? error) });
						}
					},
				}),
			"dsh-window-zoom: toggle route",
		);
	});
}
