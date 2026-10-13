<?php
/**
 * POST /api/quote.php: quote request from /request-a-quote.
 * Fields: name, company, country, email, phone?, voltage?, length?, message (required when
 * there are no items), items[{model, qty}], token, website (honeypot, must stay empty).
 * See CLIENT.md.
 */
declare(strict_types=1);

define('HVD_API', true);
require __DIR__ . '/lib/bootstrap.php';

hvd_handle_form('quote');
