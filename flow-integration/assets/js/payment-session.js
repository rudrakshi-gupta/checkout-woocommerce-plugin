/*
* The main object managing the Checkout.com flow payment integration.
*/
var ckoFlow = {
	flowComponent: null, // Holds the reference to the Checkout Web Component.

	/*
	* Initializes the payment flow by loading the component.
	*/
	init: () => {
		ckoFlow.loadFlow();
	},

	/*
	* Loads the Checkout.com payment flow by collecting cart and user info,
	* creating a payment session, and mounting the Checkout component.
	*/
	loadFlow: async () => {
		let cartInfo = jQuery("#cart-info").data("cart");
		console.log(cartInfo);

		/*
		* Extract information from cartInfo or fallback to DOM form inputs.
		*/
		let amount = cartInfo["order_amount"];
		let currency = cartInfo["purchase_currency"];

		let reference = "WOO-" + cko_flow_vars.ref_session;

		let email =
			cartInfo["billing_address"]["email"] ||
			document.getElementById("billing_email").value;
		let family_name =
			cartInfo["billing_address"]["family_name"] ||
			document.getElementById("billing_last_name").value;
		let given_name =
			cartInfo["billing_address"]["given_name"] ||
			document.getElementById("billing_first_name").value;
		let phone =
			cartInfo["billing_address"]["phone"] ||
			document.getElementById("billing_phone").value;

		let address1 = cartInfo["billing_address"]["street_address"];
		let address2 = cartInfo["billing_address"]["street_address2"];
		let city = cartInfo["billing_address"]["city"];
		let zip = cartInfo["billing_address"]["postal_code"];
		let country = cartInfo["billing_address"]["country"];

		let orders = cartInfo["billing_address"]["order_lines"];

		/*
		* Helper to get a field value by ID from the DOM.
		*/
		function getCheckoutField(fieldId) {
			const el = document.getElementById(fieldId);
			return el && el.value ? el.value : null;
		}

		if (!email) {
			email = getCheckoutField("billing_email");
		}

		if (!family_name) {
			family_name = getCheckoutField("billing_first_name");
		}

		if (!given_name) {
			given_name = getCheckoutField("billing_last_name");
		}

		if (!phone) {
			phone = getCheckoutField("billing_phone");
		}

		/*
		* Displays the loading overlay.
		*/
		function showLoadingOverlay(arg) {
			let overlay = document.getElementById("loading-overlay");
			if (arg === 2) {
				overlay = document.getElementById("loading-overlay2");
			}
			if (overlay) {
				overlay.style.display = "flex";
			}
		}

		/*
		* Hides the loading overlay.
		*/
		function hideLoadingOverlay(arg) {
			let overlay = document.getElementById("loading-overlay");
			if (arg === 2) {
				overlay = document.getElementById("loading-overlay2");
			}
			if (overlay) {
				overlay.style.display = "none";
			}
		}

		try {
			showLoadingOverlay();

			/*
			* Send request to Checkout.com to create a payment session.
			*/
			let response = await fetch(cko_flow_vars.apiURL, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${cko_flow_vars.SKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					amount: amount,
					currency: currency,
					reference: reference,
					customer: {
						// email: email,
						name: `${given_name} ${family_name}`,
					},
					billing: {
						address: {
							address_line1: address1,
							address_line2: address2,
							city: city,
							zip: zip,
							country: country,
						},
						// phone: {
						// 	number: phone,
						// },
					},
					success_url: window.location.origin + "/" + cko_flow_vars.checkoutSlug + "/?status=succeeded",
					failure_url: window.location.origin + "/" + cko_flow_vars.checkoutSlug + "/?status=failed",
					metadata: {},
					payment_method_configuration: {
						card: {
						  store_payment_details: "enabled"
						}
					},
					capture: true,
					items: orders,
					integration: {
						external_platform: {
							name: "Woocomerce",
							version: cko_flow_vars.woo_version,
						},
					},
				}),
			});

			let paymentSession = await response.json();

			/*
			* Handle API Session errors returned from Checkout.com.
			*/
			if (paymentSession.error_type) {
				// Hide loading overlay.
				hideLoadingOverlay();

				const readableErrors = {
					customer_email_invalid: wp.i18n.__(
						"The email address is invalid.",
						"checkout-com-unified-payments-api"
					),
					billing_phone_number_invalid: wp.i18n.__(
						"The phone number is invalid.",
						"checkout-com-unified-payments-api"
					),
				};

				let messages = (paymentSession.error_codes || []).map(
					(code) => readableErrors[code] || code
				);
				showError(messages.join("<br>"));
				return;
			}

			/*
			* Successfully received a payment session.
			* Load Checkout.com Web Component.
			*/
			if (paymentSession.id) {
				const checkout = await CheckoutWebComponents({
					publicKey: cko_flow_vars.PKey,
					environment: cko_flow_vars.env,
					locale: window.locale,
					paymentSession,
					appearance: window.appearance,
					componentOptions: window.componentOptions,
					translations: window.translations,

					/*
					* Called when the component is ready.
					* Validate WooCommerce checkout before showing payment UI.
					*/
					onReady: () => {
						hideLoadingOverlay();

						const form = jQuery("form.checkout");
						const formData = form.serialize();

						jQuery.ajax({
							url: cko_flow_vars.ajax_url,
							type: "POST",
							data: {
								action: "cko_validate_checkout",
								...Object.fromEntries(new URLSearchParams(formData)),
							},
							success: function (response) {
								if (response.success) {
									document.getElementById("flow-container").style.display =
										"block";
								} else {
									document.getElementById("flow-container").style.display =
										"none";
									showError(response.data.message);
								}
							},
							error: function () {
								document.getElementById("flow-container").style.display =
									"none";
								showError(
									wp.i18n.__(
										"An error occurred. Please try again.",
										"checkout-com-unified-payments-api"
									)
								);
							},
						});
					},

					/*
					* Called when the payment is completed successfully.
					*/
					onPaymentCompleted: (_component, paymentResponse) => {
						if (paymentResponse.id) {
							hideLoadingOverlay(2);

							// Set the hidden input values.
							jQuery("#cko-flow-payment-id").val(paymentResponse.id);
							jQuery("#cko-flow-payment-type").val(paymentResponse?.type || "");

							// Trigger WooCommerce order placement.
							if (window.showPayButton) {
								jQuery("form.checkout").find("#place_order").trigger("click");
							} else {
								jQuery("form.checkout").submit();
							}
						}
					},

					/*
					* Triggered when user submits the payment using Place Order Button of Woocommerce.
					*/
					onSubmit: async (component) => {
						console.log("[FLOW] Payment Button Submitted");
						showLoadingOverlay(2);
					
						return { continue: true };
					},

					/*
					* Triggered on component state change.
					*/
					onChange: (component) => {
						console.log(
							`[FLOW] onChange() -> isValid: "${component.isValid()}" for "${
								component.type
							}"`
						);
					},

					/*
					* Triggered on component click.
					*/
					handleClick: (component) => {
						return { continue: true };
					},

					/*
					* Triggered on any error in the component.
					*/
					onError: (component, error) => {
						console.log("[FLOW] onError", error, "Component", component.type);

						// Hide loading overlay.
						hideLoadingOverlay();
						hideLoadingOverlay(2);

						if(error.message === "[Submit]: Component is invalid [component_invalid]") {
							error.message = "Please complete your payment before placing the order."
						}

						showError(
							error.message ||
								wp.i18n.__(
									"Something went wrong. Please try again.",
									"checkout-com-unified-payments-api"
								)
						);
					},
				});

				const flowComponent = checkout.create(window.componentName, {
					showPayButton: window.showPayButton,
				});

				ckoFlow.flowComponent = flowComponent;

				/* 
				* Check if the component is available. Mount component only if available.
				*/
				flowComponent.isAvailable().then((available) => {
					if (available) {
						flowComponent.mount(document.getElementById("flow-container"));
					} else {
						// Hide loading overlay.
						hideLoadingOverlay();
						console.error("[FLOW] Component is not available.");

						showError(
							wp.i18n.__(
								"The selected payment method is not available at this time.",
								"checkout-com-unified-payments-api"
							)
						);
					}
				});
			}
		} catch (error) {
			// Hide loading overlay.
			hideLoadingOverlay();
			console.error("[FLOW] Error creating payment session:", error);

			showError(
				error.message ||
					wp.i18n.__(
						"Error creating payment session.",
						"checkout-com-unified-payments-api"
					)
			);
		}
	},
};

/*
* Displays error messages at the top of the WooCommerce form.
*/
let showError = function (error_message) {
	if ("string" === typeof error_message) {
		error_message = [error_message];
	}

	let ulWrapper = jQuery("<ul/>")
		.prop("role", "alert")
		.addClass("woocommerce-error");

	if (Array.isArray(error_message)) {
		jQuery.each(error_message, function (index, value) {
			jQuery(ulWrapper).append(jQuery("<li>").html(value));
		});
	}

	let wcNoticeDiv = jQuery("<div>")
		.addClass("woocommerce-NoticeGroup woocommerce-NoticeGroup-checkout")
		.append(ulWrapper);

	let scrollTarget;

	if (jQuery("form.checkout").length) {
		jQuery("form.checkout .woocommerce-NoticeGroup").remove();
		jQuery("form.checkout").prepend(wcNoticeDiv);
		jQuery(".woocommerce, .form.checkout").removeClass("processing").unblock();
		scrollTarget = jQuery("form.checkout");
	} else if (jQuery(".woocommerce-order-pay").length) {
		jQuery(".woocommerce-order-pay .woocommerce-NoticeGroup").remove();
		jQuery(".woocommerce-order-pay").prepend(wcNoticeDiv);
		jQuery(".woocommerce, .woocommerce-order-pay")
			.removeClass("processing")
			.unblock();
		scrollTarget = jQuery(".woocommerce-order-pay");
	}

	// Scroll to top of checkout form.
	if (scrollTarget) {
		jQuery("html, body").animate(
			{
				scrollTop: scrollTarget.offset().top - 100,
			},
			1000
		);
	}
};

/*
* Listens to changes in the payment method radio buttons
* and initializes the flow if the flow method is selected.
*/
function handleFlowPaymentSelection() {
	let flowContainer = document.getElementById("flow-container");
	let flowPayment = document.getElementById("payment_method_wc_checkout_com_flow");
	let placeOrderElement = document.getElementById("place_order");

	if (flowPayment && flowPayment.checked) {
		ckoFlow.init();

		flowContainer.style.display = "block";

		if (window.showPayButton) {
			document.body.classList.add("flow-method-selected");
		} else {
			document.body.classList.remove("flow-method-selected");
		}
	} else {
		flowContainer.style.display = "none";
		placeOrderElement.style.display = "block";
		document.body.classList.remove("flow-method-selected");
	}
}

// Listen to changes in payment method selection.
document.addEventListener("change", function (event) {
	if (event.target && event.target.name === "payment_method") {
		handleFlowPaymentSelection();
	}
});

// Handle initial state on page load.
document.addEventListener("DOMContentLoaded", function () {
	handleFlowPaymentSelection();
});

/**
 * Handle Place Order Button with Flow Checkout when ShowPayButton is False.
 */
document.addEventListener("DOMContentLoaded", function () {
	document.addEventListener("click", function (event) {
		const flowPayment = document.getElementById(
			"payment_method_wc_checkout_com_flow"
		);

		if (event.target && event.target.id === "place_order") {
			if (flowPayment && flowPayment.checked) {
				if (!window.showPayButton) {
					event.preventDefault();

					if (ckoFlow.flowComponent) {
						ckoFlow.flowComponent.submit();
					}
				}
			}
		}
	});
});

/**
 * Handle asynchronous payment return flow.
 */
const paymentId = new URLSearchParams(window.location.search).get(
	"cko-payment-id"
);

if (paymentId) {
	fetch(`${cko_flow_vars.async_url}?paymentId=${paymentId}`)
		.then((res) => res.json())
		.then((data) => {
			if (data.approved) {

				// Set the hidden input values.
				jQuery("#cko-flow-payment-id").val(data.id);
				jQuery("#cko-flow-payment-type").val(data.source?.type || "");

				if (window.showPayButton) {
					jQuery("form.checkout").find("#place_order").trigger("click");
				} else {
					jQuery("form.checkout").submit();
				}
			} else {
				showError(
					wp.i18n.__(
						"Payment Failed. Please try some another payment method.",
						"checkout-com-unified-payments-api"
					)
				);

				const urlWithoutQuery =
					window.location.origin + window.location.pathname;
				window.history.replaceState({}, document.title, urlWithoutQuery);
			}
		})
		.catch((err) => {
			console.error("Error fetching payment status:", err);
		});
}
