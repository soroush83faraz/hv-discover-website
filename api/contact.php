<?php
/**
 * POST /api/contact.php: message from /contact.
 * Fields: name, email, company?, message, token, website (honeypot, must stay empty).
 * See CLIENT.md.
 */
declare(strict_types=1);

define('HVD_API', true);
require __DIR__ . '/lib/bootstrap.php';

hvd_handle_form('contact');
