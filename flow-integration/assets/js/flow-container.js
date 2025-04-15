document.addEventListener("DOMContentLoaded", function () {
	function addPaymentMethod() {
		const paymentContainer = document.querySelector(
			".payment_method_wc_checkout_com_flow"
		);

		if (paymentContainer) {
			// Add flow-container.
			const innerDiv = paymentContainer.querySelector("div");
			if (innerDiv) {
				innerDiv.id = "flow-container";
                innerDiv.style.padding = "0";
			}
		}
	}

	addPaymentMethod();

	jQuery(document).on("updated_checkout", function () {
		addPaymentMethod();
	});
});
