if (HTMLFormElement.prototype.requestSubmit === undefined) {
	HTMLFormElement.prototype.requestSubmit = function() {
		this.reportValidity()
		&& this.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
		&& this.submit();
	};
}
