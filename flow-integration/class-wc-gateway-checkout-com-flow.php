<?php
/**
 * FLOW class.
 *
 * @package wc_checkout_com
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/../includes/settings/class-wc-checkoutcom-cards-settings.php';
require_once __DIR__ . '/../includes/api/class-wc-checkoutcom-api-request.php';

/**
 * Class WC_Gateway_Checkout_Com_Flow for FLOW.
 */
#[AllowDynamicProperties]
class WC_Gateway_Checkout_Com_Flow extends WC_Payment_Gateway {

	/**
	 * WC_Gateway_Checkout_Com_Flow constructor.
	 */
	public function __construct() {

		$core_settings = get_option( 'woocommerce_wc_checkout_com_cards_settings' );

		$this->id                 = 'wc_checkout_com_flow';
		$this->method_title       = __( 'Checkout.com', 'checkout-com-unified-payments-api' );
		$this->method_description = __( 'The Checkout.com extension allows shop owners to process online payments through the <a href="https://www.checkout.com">Checkout.com Payment Gateway.</a>', 'checkout-com-unified-payments-api' );
		$this->title              = __( $core_settings['title'] . ' FLOW Payment', 'checkout-com-unified-payments-api' );
		$this->has_fields         = true;
		$this->supports           = array(
			'products',
			'refunds',
			'tokenization',
		);

		$this->init_form_fields();
		$this->init_settings();

		$this->flow_enabled();

		// Turn these settings into variables we can use.
		foreach ( $this->settings as $setting_key => $value ) {
			$this->$setting_key = $value;
		}

		add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, array( $this, 'process_admin_options' ) );
	}

	/**
	 * Show module configuration in backend.
	 *
	 * @return string|void
	 */
	public function init_form_fields() {
		$this->form_fields = WC_Checkoutcom_Cards_Settings::flow_settings();
		$this->form_fields = array_merge(
			$this->form_fields,
			array(
				'screen_button' => array(
					'id'    => 'screen_button',
					'type'  => 'screen_button',
					'title' => __( 'Other Settings', 'checkout-com-unified-payments-api' ),
				),
			)
		);
	}

	/**
	 * Generate links for the admin page.
	 *
	 * @param string $key The key.
	 * @param array  $value The value.
	 */
	public function generate_screen_button_html( $key, $value ) {
		WC_Checkoutcom_Admin::generate_links( $key, $value );
	}

	/**
	 * Show frames js on checkout page.
	 */
	public function payment_fields() {

		$save_card = WC_Admin_Settings::get_option( 'ckocom_card_saved' );

		if ( ! empty( $this->get_option( 'description' ) ) ) {
			echo esc_html( $this->get_option( 'description' ) ); 
		}
		?>
			<div></div>
			<div id="loading-overlay"><?php esc_html_e( 'Loading...', 'checkout-com-unified-payments-api' ); ?></div>
			<div id="loading-overlay2"><?php esc_html_e( 'Loading...Do NOT refresh.', 'checkout-com-unified-payments-api' ); ?></div>
			<?php if ( is_user_logged_in() ) : ?>
				<div class="button-container">
					<label class="wp-style-button" style="display: none;" id="show-saved-methods-btn">
						<input type="radio" name="payment_method_selector" onclick="toggleRadio(this, handleShowSavedMethods)"/>
						<?php esc_html_e( 'Show Saved Payment Methods', 'checkout-com-unified-payments-api' ); ?>
					</label>
				</div>

				<script>
					jQuery(document).ready(function($) {
						const $savedMethods = $('.woocommerce-SavedPaymentMethods.wc-saved-payment-methods');

						$('#show-saved-methods-btn').hide();

						window.handleShowSavedMethods = function() {
							const checkoutComponent = document.querySelector('[data-testid="checkout-web-component-root"]');
							if (checkoutComponent) {
								checkoutComponent.style.display = 'none';
							}
							$savedMethods.show();
							$('#show-saved-methods-btn').hide();
							document.body.classList.remove("flow-method-selected");
						};

						window.toggleRadio = function(radio, callback) {
							radio.checked = false;
							if (typeof callback === 'function') {
								callback();
							}
						};
					});


					var savedCardBox = jQuery('.woocommerce-SavedPaymentMethods.wc-saved-payment-methods');
					if( savedCardBox.data('count') === "0" || savedCardBox.data('count') === 0 ) {
						jQuery('.cko-save-card-checkbox').show();
					}

					document.addEventListener('DOMContentLoaded', function () {
						const radios = document.querySelectorAll('input[name="wc-wc_checkout_com_flow-payment-token"]');
						radios.forEach(radio => {
							radio.checked = false;
						});
					});
				</script>

		<?php endif; ?>

			<div id="cart-info" data-cart='<?php echo wp_json_encode( WC_Checkoutcom_Api_Request::get_cart_info(true) ); ?>'></div>
			<input type="hidden" id="cko-flow-payment-id" name="cko-flow-payment-id" value="" />
			<input type="hidden" id="cko-flow-payment-type" name="cko-flow-payment-type" value="" />
		<?php 

		if ( ! is_user_logged_in() ) :
			?>
			<script>
				const targetNode = document.body;

				// Hide Saved payment method for non logged in users.
				const observer = new MutationObserver((mutationsList, observer) => {
					const $element = jQuery('.woocommerce-SavedPaymentMethods.wc-saved-payment-methods');
					if ($element.length) {
						$element.hide();
						observer.disconnect();
					}
				});

				const config = {
					childList: true,
					subtree: true
				};

				observer.observe(targetNode, config);

				// Try to hide it immediately in case it's already present.
				jQuery('.woocommerce-SavedPaymentMethods.wc-saved-payment-methods').hide();
			</script>
		<?php endif; ?>
		<?php

		// check if saved card enable from module setting.
		if ( $save_card ) {
			// Show available saved cards.
			$this->saved_payment_methods();
		}

		// Render Save Card input.
		$this->element_form_save_card( $save_card );
	}

	/**
	 * Process payment with card payment.
	 *
	 * @param int $order_id Order ID.
	 * @return array|void
	 */
	public function process_payment( $order_id ) {

		if ( ! session_id() ) {
			session_start();
		}

		$order = new WC_Order( $order_id );

		if ( WC_Checkoutcom_Api_Request::is_using_saved_payment_method() ) {
			// Saved card selected.
			$arg = sanitize_text_field( $_POST['wc-wc_checkout_com_flow-payment-token'] );
			// Create payment with card token.
			$result = (array) WC_Checkoutcom_Api_Request::create_payment( $order, $arg );

			if ( isset( $result['3d_redirection_error'] ) && true === $result['3d_redirection_error'] ) {
				// Retry Create payment with card token.
				$result = (array) WC_Checkoutcom_Api_Request::create_payment( $order, $arg, null, true );
			}
	
			// check if result has error and return error message.
			if ( isset( $result['error'] ) && ! empty( $result['error'] ) ) {
				WC_Checkoutcom_Utility::wc_add_notice_self( $result['error'] );
	
				return;
			}

			// Get save card config from module setting.
			$save_card = WC_Admin_Settings::get_option( 'ckocom_card_saved' );

			// Check if result contains 3d redirection url.
			if ( isset( $result['3d'] ) && ! empty( $result['3d'] ) ) {

				// Check if save card is enable and customer select to save card.
				if ( $save_card && isset( $_POST['wc-wc_checkout_com_cards-new-payment-method'] ) && sanitize_text_field( $_POST['wc-wc_checkout_com_cards-new-payment-method'] ) ) {
					// Save in session for 3D secure payment.
					WC()->session->set( 'wc-wc_checkout_com_cards-new-payment-method', 'yes' );
				} else {
					WC()->session->set( 'wc-wc_checkout_com_cards-new-payment-method', 'no' );
				}

				$order->add_order_note(
					sprintf(
						esc_html__( 'Checkout.com 3d Redirect waiting. URL : %s', 'checkout-com-unified-payments-api' ),
						$result['3d']
					)
				);

				// Redirect to 3D secure page.
				return [
					'result'   => 'success',
					'redirect' => $result['3d'],
				];
			}

			// Set action id as woo transaction id.
			$order->set_transaction_id( $result['action_id'] );
			$order->update_meta_data( '_cko_payment_id', $result['id'] );

			// Get cko auth status configured in admin.
			$status = WC_Admin_Settings::get_option( 'ckocom_order_authorised', 'on-hold' );

			/* translators: %s: Action ID. */
			$message = sprintf( esc_html__( 'Checkout.com Payment Authorised - Action ID : %s', 'checkout-com-unified-payments-api' ), $result['action_id'] );

			// Check if payment was flagged.
			if ( $result['risk']['flagged'] ) {
				// Get cko auth status configured in admin.
				$status = WC_Admin_Settings::get_option( 'ckocom_order_flagged', 'flagged' );

				/* translators: %s: Action ID. */
				$message = sprintf( esc_html__( 'Checkout.com Payment Flagged - Action ID : %s', 'checkout-com-unified-payments-api' ), $result['action_id'] );
			}

			$order_status = $order->get_status();

			if ( 'pending' === $order_status || 'failed' === $order_status ) {
				$order->update_meta_data( 'cko_payment_authorized', true );
			}
		}
		else {

			$flow_pay_id = isset( $_POST['cko-flow-payment-id'] ) ? sanitize_text_field( $_POST['cko-flow-payment-id'] ) : '';

			// Check if $flow_pay_id is not empty.
			if ( empty( $flow_pay_id ) ) {
				WC_Checkoutcom_Utility::wc_add_notice_self( __( 'There was an issue completing the payment. Please complete the payment.', 'checkout-com-unified-payments-api' ), 'error' );

				return;
			}

			$flow_payment_type = isset( $_POST['cko-flow-payment-type'] ) ? sanitize_text_field( $_POST['cko-flow-payment-type'] ) : '';

			if ( 'card' === $flow_payment_type ) {
				$this->flow_save_cards( $order, $flow_pay_id );
			}

			$order->update_meta_data( '_cko_flow_payment_id', $flow_pay_id );
			$order->update_meta_data( '_cko_flow_payment_type', $flow_payment_type );

			// translators: %s: payment type (e.g., card, applepay).
			$message = sprintf( esc_html__( 'Checkout.com Payment Authorised - using FLOW : %s', 'checkout-com-unified-payments-api' ), $flow_payment_type );

			// Get cko auth status configured in admin.
			$status = WC_Admin_Settings::get_option( 'ckocom_order_authorised', 'on-hold' );

		}

		// add notes for the order and update status.
		$order->add_order_note( $message );
		$order->update_status( $status );

		// Reduce stock levels.
		wc_reduce_stock_levels( $order_id );

		// Remove cart.
		WC()->cart->empty_cart();

		// Return thank you page.
		return array(
			'result'   => 'success',
			'redirect' => $this->get_return_url( $order ),
		);
	}

	/**
	 * Save customer's card information after a successful payment.
	 *
	 * @param WC_Order $order   The WooCommerce order object.
	 * @param string   $pay_id  The payment ID used to query payment status.
	 */
	public function flow_save_cards( $order, $pay_id ) {

		$save_card = WC_Admin_Settings::get_option( 'ckocom_card_saved' );

		// Check if save card is enable and customer select to save card.
		if ( ! $save_card ) {
			return;
		}

		$request  = new \WP_REST_Request( 'GET', '/ckoplugin/v1/payment-status' );
		$request->set_query_params( [ 'paymentId' => $pay_id ] );

		$result = rest_do_request( $request );

		if ( is_wp_error( $result ) ) {
			$error_message = $result->get_error_message();
			WC_Checkoutcom_Utility::logger( "There was an error in saving cards: $error_message" ); // phpcs:ignore
		} else {
			$data = $result->get_data();
		}
		
		$this->save_token( $order->get_user_id(), $data );
	}

	/**
	 * Renders the save card markup.
	 *
	 * @param string $save_card Save card enable.
	 *
	 * @return void
	 */
	public function element_form_save_card( $save_card ) {
		?>
		<!-- Show save card checkbox if this is selected on admin-->
		<div class="cko-save-card-checkbox" style="display: none">
			<?php
			if ( $save_card ) {
				$this->save_payment_method_checkbox();
			}
			?>
		</div>
		<?php
	}

	/**
	 * Save card.
	 *
	 * @param int   $user_id User id.
	 * @param array $payment_response Payment response.
	 *
	 * @return void
	 */
	public function save_token( $user_id, $payment_response ) {
		// Check if payment response is not null.
		if ( ! is_null( $payment_response ) ) {
			// argument to check token.
			$arg = array(
				'user_id'    => $user_id,
				'gateway_id' => $this->id,
				'limit'		 => 100,
			);

			// Query token by userid and gateway id.
			$token = WC_Payment_Tokens::get_tokens( $arg );

			foreach ( $token as $tok ) {
				$fingerprint = $tok->get_meta( 'fingerprint', true );
				// do not save source if it already exists in db.
				if ( $fingerprint === $payment_response['source']['fingerprint'] ) {
					return;
				}
			}

			// Save source_id in db.
			$token = new WC_Payment_Token_CC();
			$token->set_token( (string) $payment_response['source']['id'] );
			$token->set_gateway_id( $this->id );
			$token->set_card_type( (string) $payment_response['source']['scheme'] );
			$token->set_last4( $payment_response['source']['last4'] );
			$token->set_expiry_month( $payment_response['source']['expiry_month'] );
			$token->set_expiry_year( $payment_response['source']['expiry_year'] );
			$token->set_user_id( $user_id );

			// Add the `fingerprint` metadata.
			$token->add_meta_data( 'fingerprint', $payment_response['source']['fingerprint'], true );

			$token->save();
		}
	}

	/**
	 * Deactivate Classic methods when FLOW is active.
	 */
	public static function flow_enabled() {

		$flow_settings = get_option( 'woocommerce_wc_checkout_com_flow_settings' );

		$checkout_setting = get_option( 'woocommerce_wc_checkout_com_cards_settings' );
		$checkout_mode    = $checkout_setting['ckocom_checkout_mode'];
	
		$apm_settings      = get_option( 'woocommerce_wc_checkout_com_alternative_payments_settings' );
		$gpay_settings     = get_option( 'woocommerce_wc_checkout_com_google_pay_settings' );
		$applepay_settings = get_option( 'woocommerce_wc_checkout_com_apple_pay_settings' );
		$paypal_settings   = get_option( 'woocommerce_wc_checkout_com_paypal_settings' );
	
		if ( 'flow' === $checkout_mode ) {
			$flow_settings['enabled']     = 'yes';
			$checkout_setting['enabled']  = 'no';
			$apm_settings['enabled']      = 'no';
			$gpay_settings['enabled']     = 'no';
			$applepay_settings['enabled'] = 'no';
			$paypal_settings['enabled']   = 'no';
		} else {
			$flow_settings['enabled']    = 'no';
			$checkout_setting['enabled'] = 'yes';
		}
	
		update_option( 'woocommerce_wc_checkout_com_flow_settings', $flow_settings );
		update_option( 'woocommerce_wc_checkout_com_cards_settings', $checkout_setting );
		update_option( 'woocommerce_wc_checkout_com_alternative_payments_settings', $apm_settings );
		update_option( 'woocommerce_wc_checkout_com_google_pay_settings', $gpay_settings );
		update_option( 'woocommerce_wc_checkout_com_apple_pay_settings', $applepay_settings );
		update_option( 'woocommerce_wc_checkout_com_paypal_settings', $paypal_settings );
	}
}