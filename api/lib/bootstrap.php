<?php
/**
 * HV Discover form API: bootstrap, loaded by quote.php, contact.php and token.php only.
 *
 * Every file in lib/ starts with the HVD_API guard, so requesting it directly (if the
 * .htaccess rules are ever lost) executes nothing and returns 404.
 */
declare(strict_types=1);

if (!defined('HVD_API')) {
    http_response_code(404);
    exit;
}

if (PHP_VERSION_ID < 70400) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Server configuration error.\n";
    exit;
}

define('HVD_API_DIR', dirname(__DIR__));

// Nothing reaches the client unless a response helper sends it on purpose.
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
ini_set('html_errors', '0');
error_reporting(E_ALL);
ob_start();
header_remove('X-Powered-By');

require __DIR__ . '/text.php';
require __DIR__ . '/settings.php';
require __DIR__ . '/logger.php';
require __DIR__ . '/http.php';
require __DIR__ . '/store.php';
require __DIR__ . '/timetoken.php';
require __DIR__ . '/forms.php';
require __DIR__ . '/smtp.php';
require __DIR__ . '/mailer.php';
require __DIR__ . '/page.php';
require __DIR__ . '/endpoint.php';

set_error_handler('hvd_on_php_error');
set_exception_handler('hvd_on_exception');
register_shutdown_function('hvd_on_shutdown');
