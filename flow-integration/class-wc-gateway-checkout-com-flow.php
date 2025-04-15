<?php
/**
 * FLOW class.
 *
 * @package wc_checkout_com
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/../includes/settings/class-wc-checkoutcom-cards-settings.php';

/**
 * Class WC_Gateway_Checkout_Com_Flow for FLOW.
 */
#[AllowDynamicProperties]
class WC_Gateway_Checkout_Com_Flow extends WC_Payment_Gateway {

	/**
	 * WC_Gateway_Checkout_Com_Flow constructor.
	 */
	public function __construct() {
		$this->id                 = 'wc_checkout_com_flow';
		$this->method_title       = __( 'Checkout.com', 'checkout-com-unified-payments-api' );
		$this->method_description = __( 'The Checkout.com extension allows shop owners to process online payments through the <a href="https://www.checkout.com">Checkout.com Payment Gateway.</a>', 'checkout-com-unified-payments-api' );
		$this->title              = __( 'FLOW Payment', 'checkout-com-unified-payments-api' );
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
			<div id="loading-overlay"><?php _e( 'Loading...', 'checkout-com-unified-payments-api' ); ?></div>
			<div id="loading-overlay2"><?php _e( 'Loading...Do NOT refresh.', 'checkout-com-unified-payments-api' ); ?></div>

			<div id="cart-info" data-cart='<?php echo wp_json_encode( WC_Checkoutcom_Api_Request::get_cart_info() ); ?>'></div>
			<input type="hidden" id="cko-flow-payment-id" name="cko-flow-payment-id" value="" />
			<input type="hidden" id="cko-flow-payment-type" name="cko-flow-payment-type" value="" />
		<?php 

		if ( ! is_user_logged_in() ) :
			?>
		<script>
			jQuery('.woocommerce-SavedPaymentMethods.wc-saved-payment-methods').hide()
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

		$result = wp_remote_get( home_url( '/wp-json/ckoplugin/v1/payment-status?paymentId=' . $pay_id ) );

		if ( is_wp_error( $result ) ) {
			$error_message = $result->get_error_message();
			error_log( "There was an error in saving cards: $error_message" ); // phpcs:ignore
		} else {
			$body = wp_remote_retrieve_body( $result );
			$data = json_decode( $body, true );
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
			);

			// Query token by userid and gateway id.
			$token = WC_Payment_Tokens::get_tokens( $arg );

			foreach ( $token as $tok ) {
				$token_data = $tok->get_data();
				// do not save source if it already exists in db.
				if ( $token_data['token'] === $payment_response['id'] ) {
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