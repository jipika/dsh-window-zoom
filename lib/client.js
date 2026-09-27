// dsh-window-zoom — client half.
//
// 只在 macOS 桌面壳里工作（html[data-platform="darwin"]，由桌面 preload 标记）：
// 双击窗口顶部（≤96px）且落点在 computed drag 区域（官方 data-window-drag 的
// app-region:drag 链）时，调用 host 半边的 POST /dsh-window-zoom/toggle。
// 交互元素（按钮/标签/role/tabindex…）一律放过；非 mac / 普通浏览器零监听、零请求。

window.__ModuleLoader__.load({
	id: "dsh-window-zoom",
	factory: (require) => {
		const module = { exports: {} };
		const API = "/dsh-window-zoom";
		/** 顶部命中带：只认窗口最上面的 96 CSS 像素。 */
		const TOP_BAND = 96;
		let busy = false;

		/**
		 * 判断一次双击是否落在「标题栏区域」：从命中元素向上找最近的显式
		 * app-region —— 先遇到 no-drag 说明是交互控件，先遇到 drag 即命中。
		 * @param {MouseEvent} event - dblclick 事件。
		 * @returns {boolean} 是否应当触发窗口缩放。
		 */
		function inDragRegion(event) {
			if (typeof event.clientY !== "number" || event.clientY > TOP_BAND) return false;
			for (let node = event.target; node && node !== document.documentElement; node = node.parentElement) {
				let style;
				try {
					style = getComputedStyle(node);
				} catch {
					return false;
				}
				const region = style.webkitAppRegion || style.appRegion;
				if (region === "no-drag") return false;
				if (region === "drag") return true;
			}
			return false;
		}

		/**
		 * 请求 host 半边执行一次 zoom/还原。
		 * @returns {Promise<object>} host 返回的动作结果。
		 */
		async function toggle() {
			const response = await fetch(`${API}/toggle`, {
				method: "POST",
				headers: { accept: "application/json" },
			});
			return response.json();
		}

		function apply() {
			try {
				if (document.documentElement.dataset.platform !== "darwin") return;
				window.addEventListener(
					"dblclick",
					(event) => {
						try {
							if (busy || !inDragRegion(event)) return;
							busy = true;
							toggle()
								.catch(() => { /* fail soft：路由未挂载 / 权限未给 */ })
								.finally(() => {
									setTimeout(() => { busy = false; }, 500);
								});
						} catch {
							/* fail soft */
						}
					},
					true,
				);
			} catch {
				/* fail soft */
			}
		}

		module.exports.name = "dsh-window-zoom";
		module.exports.inject = [];
		module.exports.apply = apply;
		apply();
		return module.exports;
	},
});
