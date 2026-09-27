// dsh-window-zoom — client 半边探针（fake loader，不需要跑应用）。
// 用法：node tests/client-test.mjs
// 断言：① apply 全程不抛错 ② darwin 注册 dblclick、非 darwin 零注册
//       ③ 顶部 drag 区的双击 → 发 POST /dsh-window-zoom/toggle
//       ④ y>96 / no-drag / 非 drag 链 → 不发请求.

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(here, "..", "lib", "client.js");

/** 用给定平台跑一遍 client.js，返回捕获到的 spec / 监听器 / fetch 调用。 */
async function boot(platform, regionAtTop = "drag", y = 20) {
	let spec = null;
	const listeners = [];
	const calls = [];
	globalThis.window = {
		__ModuleLoader__: { load: (value) => { spec = value; } },
		addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
	};
	globalThis.document = { documentElement: { dataset: platform === null ? {} : { platform } } };
	globalThis.getComputedStyle = () => ({
		webkitAppRegion: regionAtTop,
		appRegion: regionAtTop,
	});
	globalThis.fetch = async (url, init) => {
		calls.push({ url, init });
		return { ok: true, json: async () => ({ ok: true, action: "zoom" }) };
	};
	await import(`${pathToFileURL(CLIENT).href}?t=${Math.random()}`);
	assert.ok(spec !== null, "client.js 应该调用 __ModuleLoader__.load");
	assert.equal(spec.id, "dsh-window-zoom");
	let applyError = null;
	let exports = null;
	try {
		exports = spec.factory(() => { throw new Error("本插件不应 require 任何模块"); });
	} catch (error) {
		applyError = error;
	}
	assert.equal(applyError, null, `apply 不应抛错：${applyError?.message}`);
	return { exports, listeners, calls, fire: async () => {
		const handler = listeners.find((item) => item.type === "dblclick");
		if (!handler) return;
		handler.fn({
			clientY: y,
			target: {
				parentElement: null,
				nodeType: 1,
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
	} };
}

// ① darwin：注册监听，exports 完整
{
	const env = await boot("darwin");
	assert.equal(env.exports.name, "dsh-window-zoom");
	assert.deepEqual(env.exports.inject, []);
	assert.equal(typeof env.exports.apply, "function");
	assert.equal(env.listeners.length, 1, "darwin 应注册且只注册一个 dblclick 监听");
	assert.equal(env.listeners[0].capture, true, "应为捕获阶段");
	console.log("✅ darwin 注册路径 OK");
}

// ② 非 darwin：零监听、零请求
{
	const env = await boot("win32");
	assert.equal(env.listeners.length, 0, "非 darwin 不应注册任何监听");
	await env.fire();
	assert.equal(env.calls.length, 0);
	console.log("✅ 非 darwin 零副作用 OK");
}

// ③ 顶部 drag 区双击 → 发 POST
{
	const env = await boot("darwin", "drag", 20);
	await env.fire();
	assert.equal(env.calls.length, 1, "drag 区双击应发一次请求");
	assert.equal(env.calls[0].url, "/dsh-window-zoom/toggle");
	assert.equal(env.calls[0].init.method, "POST");
	console.log("✅ drag 区双击 → POST /dsh-window-zoom/toggle OK");
}

// ④ 三种不该触发的情形
{
	const low = await boot("darwin", "drag", 200);
	await low.fire();
	assert.equal(low.calls.length, 0, "y>96 不应触发");

	const noDrag = await boot("darwin", "no-drag", 20);
	await noDrag.fire();
	assert.equal(noDrag.calls.length, 0, "no-drag 元素不应触发");

	const none = await boot("darwin", "", 20);
	await none.fire();
	assert.equal(none.calls.length, 0, "不在 drag 链上不应触发");
	console.log("✅ 负例（y>96 / no-drag / 非 drag 链）全部不触发 OK");
}

console.log("client 半边 6/6 断言通过");
