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

		let orders = cartInfo["order_lines"];

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
					},
					success_url:
						window.location.origin +
						"/" +
						cko_flow_vars.checkoutSlug +
						"/?status=succeeded",
					failure_url:
						window.location.origin +
						"/" +
						cko_flow_vars.checkoutSlug +
						"/?status=failed",
					metadata: {},
					payment_method_configuration: {
						card: {
							store_payment_details: "enabled",
						},
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
							jQuery("form.checkout").submit();
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

						const hiddenTypes = [
							"applepay",
							"googlepay",
							"alipaycn",
							"alipayhk",
							"dana",
							"gcash",
							"kakaopay",
							"octopus",
							"paypal",
							"stcpay",
							"touchngo",
							"truemoney",
							"twint",
							"venmo",
							"wechatpay"
						];

						const placeOrderButton = document.querySelector("#place_order");

						// Hide place order button on digital wallets.
						if (hiddenTypes.includes(component.selectedType)) {
							if (placeOrderButton) placeOrderButton.style.display = "none";
						} else {
							if (placeOrderButton) placeOrderButton.style.display = "block";
						}
						
						// Pre-validate for apple pay.
						if ( component.selectedType === "applepay" ) {
							const applePayButton = document.querySelector('button[aria-label="Apple Pay"]');
							applePayButton.disabled = true;

							const form = jQuery("form.checkout");

							validateCheckout(form, function (response) {
								applePayButton.disabled = false;
							});
						}

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

						if(component.type==="applepay") {
							return {continue: true};
						}

						return new Promise((resolve) => {
							const form = jQuery("form.checkout");
					
							validateCheckout(form, function (response) {
								resolve({ continue: true });
							});
						});
					},

					/*
					 * Triggered on any error in the component.
					 */
					onError: (component, error) => {
						console.log("[FLOW] onError", error, "Component", component.type);

						// Hide loading overlay.
						hideLoadingOverlay();
						hideLoadingOverlay(2);

						if (
							error.message ===
							"[Submit]: Component is invalid [component_invalid]"
						) {
							error.message =
								"Please complete your payment before placing the order.";
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
					showPayButton: false,
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

/**
 * Initializes the observer to monitor the presence of the Flow checkout component in the DOM.
 *
 * - Sets the `ckoFlowInitialized` flag to `false` on page load.
 * - Observes the DOM for any changes using `MutationObserver`.
 * - If the Flow checkout component (identified by `data-testid="checkout-web-component-root"`) 
 *   is removed from the DOM, the flag `ckoFlowInitialized` is reset to `false`.
 *
 * This helps ensure that the Flow component can be re-initialized when needed.
 */

let ckoFlowInitialized = false;

document.addEventListener("DOMContentLoaded", function () {
	const element = document.querySelector(
		'[data-testid="checkout-web-component-root"]'
	);
	ckoFlowInitialized = false;

	const observer = new MutationObserver(() => {
		const element = document.querySelector(
			'[data-testid="checkout-web-component-root"]'
		);

		// If the element is not present, update ckoFlowInitialized.
		if (!element) {
			ckoFlowInitialized = false;
		}
	});

	// Observe the entire document for any changes in the DOM.
	observer.observe(document.body, {
		childList: true,
		subtree: true,
	});
});

/*
 * Listens to changes in the payment method radio buttons
 * and initializes the Flow payment method if selected.
 * 
 * This function handles the logic for showing or hiding the Flow payment container
 * and initializing the Flow checkout component when the Flow payment method is selected.
 * It also manages the visibility of saved payment methods and ensures the Flow component is
 * initialized when needed.
 */
function handleFlowPaymentSelection() {

	// Fetching elemnets required.
	let flowContainer = document.getElementById("flow-container");
	let flowPayment = document.getElementById(
		"payment_method_wc_checkout_com_flow"
	);
	let placeOrderElement = document.getElementById("place_order");

	// Logic for saved cards.
	const ulElement = document.querySelector(".woocommerce-SavedPaymentMethods");
	const dataCount = ulElement.getAttribute("data-count");

	if (flowPayment && flowPayment.checked) {

		// If there are no saved payment methods, initialize Flow.
		if ("0" === dataCount) {

			if (!ckoFlowInitialized) {
				ckoFlow.init();
				ckoFlowInitialized = true;
			}

			flowContainer.style.display = "block";

			// Set up a MutationObserver to hide saved payment methods.
			const observer = new MutationObserver(() => {
				const dataCount = jQuery(
					".woocommerce-SavedPaymentMethods.wc-saved-payment-methods"
				).data("count");
				if (dataCount === "0" || dataCount === 0) {
					jQuery(
						".woocommerce-SavedPaymentMethods.wc-saved-payment-methods"
					).hide();
				}
			});

			observer.observe(document.body, { childList: true, subtree: true });
		} else {

			// If there are saved cards, handle the logic when flow payment is selected.
			jQuery(document).on(
				"click",
				"#wc-wc_checkout_com_flow-payment-token-new",
				function () {
					if (!ckoFlowInitialized) {
						ckoFlow.init();
						ckoFlowInitialized = true;
					}

					const flowCheckoutComponent = document.querySelector(
						'[data-testid="checkout-web-component-root"]'
					);
					if (flowCheckoutComponent) {
						flowCheckoutComponent.style.display = "block";
					}
					jQuery(
						".woocommerce-SavedPaymentMethods.wc-saved-payment-methods"
					).hide();
					jQuery("#show-saved-methods-btn").show();

					jQuery(this).prop("checked", false);
				}
			);
		}
	} else {
		flowContainer.style.display = "none";
		placeOrderElement.style.display = "block";
	}
}

/**
 * Listen for changes in the payment method selection and handle the Flow payment method.
 *
 * This event listener listens for changes to the payment method selection form (typically a radio button).
 * When a change is detected in the selection of the payment method, it checks if the selected input is 
 * the payment method field and triggers the Flow payment selection handler.
 */
document.addEventListener("change", function (event) {
	if (event.target && event.target.name === "payment_method") {
		handleFlowPaymentSelection();
	}
});

/**
 * Handle case -  when Flow is the only payment method or the starting payment method.
 * 
 * This function listens for the DOMContentLoaded event, then checks if Flow is the only 
 * payment method listed in the available payment methods. If so, it triggers actions 
 * to handle this scenario, such as adding specific classes or handling payment selection.
 * It also checks if required fields are filled and adjusts the Flow payment selection accordingly.
 * 
 */
document.addEventListener("DOMContentLoaded", function () {
	const paymentMethodsList = document.querySelector("ul.wc_payment_methods");

	if (paymentMethodsList) {
		const listItems = paymentMethodsList.children;

		// Check if the first list item is for the Flow payment method.
		if (
			listItems[0].classList.contains("payment_method_wc_checkout_com_flow")
		) {

			// If Flow is the only payment method, add a custom class to the body 
			// and trigger the Flow payment selection handler.
			if (listItems.length === 1) {
				document.body.classList.add("flow-method-single");
				handleFlowPaymentSelection();
			}

			// If required fields are not filled, trigger Flow payment selection handler.
			if (!requiredFieldsFilled()) {
				handleFlowPaymentSelection();
			}
		}
	}
});

/**
 * Handle Place Order Button with Flow Checkout when ShowPayButton is False.
 * 
 * This function listens for a click event on the "Place Order" button. If the checkout method 
 * is "Flow" and the user is using the checkout component, it validates the form and proceeds 
 * with the appropriate order placement, either using the Flow component or submitting the form directly.
 * 
 */
document.addEventListener("DOMContentLoaded", function () {
	document.addEventListener("click", function (event) {
		const flowPayment = document.getElementById(
			"payment_method_wc_checkout_com_flow"
		);

		// If the Place Order button is clicked, proceed.
		if (event.target && event.target.id === "place_order") {

			// If the Flow payment method is selected, proceed with validation and order placement.
			if (flowPayment && flowPayment.checked) {
				event.preventDefault();

				const form = jQuery("form.checkout");

				// Validate checkout before proceeding.
				validateCheckout(form, function (response) {
					document.getElementById("flow-container").style.display = "block";

					// Place order for FLOW.
					if (ckoFlow.flowComponent) {
						ckoFlow.flowComponent.submit();
					}

					// Place order for saved card.
					if (!ckoFlow.flowComponent) {
						form.submit();
					}
				});
			}
		}
	});
});

/**
 * Handle asynchronous payment return flow.
 * This checks for a payment ID in the URL, verifies its status via an API call,
 * and either submits the checkout form or displays an error.
 */

// Extract the 'cko-payment-id' parameter from the URL query string.
const paymentId = new URLSearchParams(window.location.search).get(
	"cko-payment-id"
);
// Proceed only if a payment ID is found.
if (paymentId) {

	// Fetch payment status from the server using the async endpoint.
	fetch(`${cko_flow_vars.async_url}?paymentId=${paymentId}`)
		.then((res) => res.json())
		.then((data) => {

			// If payment is approved, set hidden fields with the payment data and submit checkout form.
			if (data.approved) {
				jQuery("#cko-flow-payment-id").val(data.id);
				jQuery("#cko-flow-payment-type").val(data.source?.type || "");

				jQuery("form.checkout").submit();
			} else {

				// If payment is not approved, show an error message to the user.
				showError(
					wp.i18n.__(
						"Payment Failed. Please try some another payment method.",
						"checkout-com-unified-payments-api"
					)
				);

				// Clean up the URL by removing the query parameters.
				const urlWithoutQuery =
					window.location.origin + window.location.pathname;
				window.history.replaceState({}, document.title, urlWithoutQuery);
			}
		})
		.catch((err) => {

			// Log any network or parsing errors in the console.
			console.error("Error fetching payment status:", err);
		});
}

/**
 * Handle checkout flow-container rendering on various field changes.
 * Attaches debounced event listeners to checkout inputs to update flow state and cart info dynamically.
 */
jQuery(function ($) {

	/**
	 * Main handler function triggered on input/change events.
	 * It performs field checks and updates the checkout flow and cart info accordingly.
	 *
	 * @param {Event} event - The input or change event.
	 */
	const handleTyping = (event) => {

		let isShippingField = false;

		// Check if the changed field belongs to shipping info.
		if (event) {
			const $target = jQuery(event.target);
			isShippingField = $target.is('[id^="shipping"]');
		}

		// If the field is a shipping-related field, trigger WooCommerce checkout update and exit early.
		if (isShippingField) {
			console.log("Triggered by a shipping field, skipping...");
			$("body").trigger("update_checkout");
			return;
		}

		// Only proceed if all required fields are filled.
		if (requiredFieldsFilled()) {
			$("body").trigger("update_checkout");

			// If the event is from checking 'ship to different address' or 'create account', return early.
			if (
				jQuery(event.target).is(
					"#ship-to-different-address-checkbox, #createaccount"
				) &&
				jQuery(event.target).is(":checked")
			) {
				console.log("User just checked the checkbox. Returning early...");
				return;
			}

			var targetName = event.target.name || "";

			// If the event is not from billing fields or key checkboxes, exit early.
			if (
				!targetName.startsWith("billing") &&
				!jQuery(event.target).is(
					"#ship-to-different-address-checkbox, #terms, #createaccount, #coupon_code"
				)
			) {
				console.log(
					"Neither billing nor the shipping checkbox. Returning early..."
				);
				return;
			}

			// Fetch updated cart info via AJAX GET request.
			fetch(cko_flow_vars.ajax_url + "?action=get_cart_info")
				.then((res) => res.json())
				.then((data) => {
					if (data.success) {

						// Update #cart-info with the latest cart data.
						const $cartDiv = jQuery("#cart-info");
						$cartDiv.attr("data-cart", JSON.stringify(data.data));
						$cartDiv.data("cart", data.data);

						// Update global state and re-trigger payment flow setup.
						cartInfo = data.data;
						ckoFlowInitialized = false;
						handleFlowPaymentSelection();

					}
				})
				.catch((err) => {
					console.error("Failed to fetch cart info:", err);
				});
		}
	};

	// Debounce the handler to limit how often it's triggered during typing.
	const debouncedTyping = debounce(handleTyping, 2000);

	// Attach debounced handler to key billing fields.
	$(
		"#billing_first_name, #billing_last_name, #billing_email, #billing_phone"
	).on("input", function (e) {
		debouncedTyping(e);
	});

	// Attach to all other inputs/selects, excluding the key billing fields above.
	$(
		"input:not(#billing_first_name, #billing_last_name, #billing_email, #billing_phone), select"
	).on("input change", function (e) {
		debouncedTyping(e);
	});

	// Attach handler to all input/selects, but ignore payment method fields.
	$(document).on("input change", "input, select", function (e) {
		if ($(this).closest(".wc_payment_method").length === 0) {
			debouncedTyping(e);
		}
	});
});

/**
 * 
 * Debounce utility function.
 * Delays the execution of a function until after a specified delay
 * has passed since the last time it was invoked.
 * 
 * @param {Function} func - The function to debounce.
 * @param {number} delay - Delay in milliseconds.
 * 
 * @returns {Function} - A debounced version of the original function. 
 */
function debounce(func, delay) {
	let timer;

	return function (...args) {

		// Clear the existing timer, if any.
		clearTimeout(timer);

		// Set a new timer to call the function after the delay.
		timer = setTimeout(() => {

			// Call the original function with the correct context and arguments.
			func.apply(this, args);
		}, delay);
	};
}

/**
 * Checks if all non-shipping required fields in the WooCommerce checkout form are filled.
 *
 * This function looks for elements marked with a `.required` span inside labels
 * within the `.woocommerce-checkout` form, extracts the associated input field IDs,
 * filters out those related to shipping, and then verifies that the corresponding
 * fields are not empty.
 *
 * @returns {boolean} - Returns true if all non-shipping required fields are filled; otherwise, false.
 */
function requiredFieldsFilled() {

	// Select all required field indicators within WooCommerce checkout labels.
	const requiredLabels = document.querySelectorAll(
		".woocommerce-checkout label .required"
	);

	const fieldIds = [];

	requiredLabels.forEach((label) => {
		const fieldId = label.closest("label").getAttribute("for");
		if (fieldId) {
			fieldIds.push(fieldId);
		}
	});

	// Filter out fieldIds that start with "shipping".
	const filteredFieldIds = fieldIds.filter((id) => !id.startsWith("shipping"));

	// Check that each field is present and not empty.
	const result = filteredFieldIds.every((id) => {
		const field = document.getElementById(id);
		return field && field.value.trim() !== "";
	});

	return result;
}

/**
 * Validates the checkout form by sending serialized form data to the server
 * using an AJAX POST request. Executes callback functions based on the response.
 *
 * @param {jQuery} form - The jQuery-wrapped form element to be validated.
 * @param {Function} onSuccess - Callback function executed when validation is successful.
 * @param {Function} onError - Optional callback function executed when validation fails or an error occurs.
 */
function validateCheckout(form, onSuccess, onError) {

	const formData = form.serialize(); // Serialize the form.

	// Perform AJAX POST request for server-side validation.
	jQuery.ajax({
		url: cko_flow_vars.ajax_url,
		type: "POST",
		data: {
			action: "cko_validate_checkout",
			...Object.fromEntries(new URLSearchParams(formData)),
		},
		success: function (response) {

			// If the response indicates success, trigger the onSuccess callback.
			if (response.success) {
				onSuccess(response);
			} else {
				
				// Show an error message and trigger the onError callback if provided.
				showError(response.data.message);
				if (onError) onError(response);
			}
		},
		error: function () {

			// If the request fails, display the flow container and show a generic error message.
			document.getElementById("flow-container").style.display = "block";
			showError(
				wp.i18n.__(
					"An error occurred. Please try again.",
					"checkout-com-unified-payments-api"
				)
			);

			// Trigger onError callback if provided.
			if (onError) onError();
		},
	});
}
