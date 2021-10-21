// Select-all detection

type Callback = () => boolean | void;

const listeners: Set<Callback> = new Set();

export function addSelectAllListener(callback: Callback): void {
	listeners.add(callback);
}

export function removeSelectAllListener(callback: Callback): void {
	if (!listeners.delete(callback)) {
		throw new Error("select all listener wasn't registered");
	}
}

function createMarker(): HTMLDivElement {
	const marker = document.createElement("div");
	marker.style.position = "fixed";
	marker.style.opacity = "0";
	marker.style.userSelect = "auto";
	marker.append("\u200b"); // zero-width space
	return marker;
}

const start = createMarker();
document.body.prepend(start);

const end = createMarker();
document.body.append(end);

addEventListener("selectstart", () => {
	requestAnimationFrame(() => {
		const selection = getSelection();
		if (selection === null) {
			return;
		}
		if (start.contains(selection.anchorNode) && end.contains(selection.focusNode)) {
			for (const listener of listeners) {
				if (listener() === false) {
					selection.removeAllRanges();
				}
			}
		}
	});
});
