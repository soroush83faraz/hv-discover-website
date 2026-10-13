<?php
/**
 * HV Discover form API: request inspection and responses.
 */
declare(strict_types=1);

if (!defined('HVD_API')) {
    http_response_code(404);
    exit;
}

const HVD_JSON_FLAGS = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT;

final class HvdRequest
{
    /** @var string quote | contact | token */
    public $endpoint = '';
    /** @var string */
    public $method = 'GET';
    /** @var string lower-case media type without parameters */
    public $mediaType = '';
    /** @var bool answer with JSON (fetch) rather than HTML pages and redirects (plain form post) */
    public $json = true;
    /** @var string */
    public $ip = '0.0.0.0';
    /** @var string keyed hash of the client address (IPv4, or IPv6 /64), for rate limits */
    public $ipKey = '';
    /** @var string keyed hash of the client network (IPv4 /24, IPv6 /48), for rate limits */
    public $netKey = '';
    /** @var array|null */
    public $cfg = null;
}

/** @var HvdRequest|null the request being served, for the error handlers */
$GLOBALS['hvd_request'] = null;

function hvd_server(string $key): string
{
    $v = $_SERVER[$key] ?? '';
    return is_string($v) ? $v : '';
}

function hvd_media_type(): string
{
    $ct = hvd_server('CONTENT_TYPE');
    if ($ct === '') {
        $ct = hvd_server('HTTP_CONTENT_TYPE');
    }
    $parts = explode(';', $ct, 2);
    return strtolower(trim($parts[0]));
}

/**
 * fetch() callers send Accept: application/json (or a JSON body) and get JSON.
 * A plain HTML form post (Accept: text/html...) gets redirects and HTML pages.
 * Anything else (curl, scripts) gets JSON.
 */
function hvd_wants_json(string $mediaType): bool
{
    $accept = strtolower(hvd_server('HTTP_ACCEPT'));
    if ($mediaType === 'application/json' || strpos($accept, 'application/json') !== false) {
        return true;
    }
    return strpos($accept, 'text/html') === false;
}

function hvd_origin_allowed(string $origin, array $cfg): bool
{
    $n = hvd_normalize_origin($origin);
    if ($n === null) {
        return false; // includes the literal "null" origin (sandboxed frames, data: URLs)
    }
    if (isset($cfg['allowed_origins'][$n])) {
        return true;
    }
    if ($cfg['dev_mode'] && preg_match('#\Ahttps?://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?\z#', $n) === 1) {
        return true;
    }
    return false;
}

function hvd_origin_from_url(string $url): ?string
{
    $p = parse_url($url);
    if (!is_array($p) || !isset($p['scheme'], $p['host'])) {
        return null;
    }
    $host = $p['host'];
    if (strpos($host, ':') !== false && $host[0] !== '[') {
        $host = '[' . $host . ']';
    }
    return $p['scheme'] . '://' . $host . (isset($p['port']) ? ':' . $p['port'] : '');
}

/**
 * CSRF / cross-site check. Browsers send Origin on every POST; if it is missing
 * (very old browsers) the Referer must name an allowed origin. Requests with neither
 * are refused, as is anything a browser marks Sec-Fetch-Site: cross-site.
 */
function hvd_origin_ok(array $cfg): bool
{
    if (strtolower(hvd_server('HTTP_SEC_FETCH_SITE')) === 'cross-site') {
        return false;
    }
    if (isset($_SERVER['HTTP_ORIGIN'])) {
        return hvd_origin_allowed(trim(hvd_server('HTTP_ORIGIN')), $cfg);
    }
    $ref = trim(hvd_server('HTTP_REFERER'));
    if ($ref === '') {
        return false;
    }
    $o = hvd_origin_from_url($ref);
    return $o !== null && hvd_origin_allowed($o, $cfg);
}

/**
 * A valid IP in one canonical text form. IPv4-mapped (::ffff:a.b.c.d, ::ffff:c000:280) and
 * IPv4-compatible (::a.b.c.d) IPv6 addresses become plain IPv4, so one client cannot appear
 * under several spellings (separate rate-limit buckets, trusted-proxy mismatches).
 */
function hvd_normalize_ip(string $ip): ?string
{
    $ip = trim($ip, " \t");
    if ($ip === '' || strlen($ip) > 64 || filter_var($ip, FILTER_VALIDATE_IP) === false) {
        return null;
    }
    $bin = @inet_pton($ip);
    if ($bin === false) {
        return null;
    }
    if (strlen($bin) === 16) {
        $tail = substr($bin, 12, 4);
        $mapped = substr($bin, 0, 12) === str_repeat("\0", 10) . "\xff\xff";
        $compatible = substr($bin, 0, 12) === str_repeat("\0", 12) && $tail !== "\0\0\0\0" && $tail !== "\0\0\0\1";
        if ($mapped || $compatible) {
            $bin = $tail;
        }
    }
    $out = @inet_ntop($bin);
    return is_string($out) ? $out : null;
}

/** The network a client belongs to for network-level limits: IPv4 /24, IPv6 /48. */
function hvd_ip_network(string $ip): string
{
    $bin = @inet_pton($ip);
    if ($bin === false) {
        return 'invalid';
    }
    if (strlen($bin) === 4) {
        return bin2hex(substr($bin, 0, 3)) . '/24';
    }
    return bin2hex(substr($bin, 0, 6)) . '/48';
}

/**
 * The client address. REMOTE_ADDR, unless it is a configured trusted proxy (e.g. a CDN):
 * then the right-most address in the configured header that is not itself a trusted proxy.
 * The header is ignored completely when the request did not come from a trusted proxy,
 * so visitors cannot pick their own rate-limit bucket.
 */
function hvd_client_ip(array $cfg): string
{
    $remote = hvd_normalize_ip(hvd_server('REMOTE_ADDR'));
    if ($remote === null) {
        return '0.0.0.0';
    }
    if ($cfg['client_ip_header'] === '' || !hvd_ip_in_list($remote, $cfg['trusted_proxies'])) {
        return $remote;
    }
    $hops = array_reverse(explode(',', hvd_server($cfg['client_ip_header'])));
    foreach ($hops as $hop) {
        $ip = hvd_normalize_ip($hop);
        if ($ip === null) {
            break;
        }
        if (!hvd_ip_in_list($ip, $cfg['trusted_proxies'])) {
            return $ip;
        }
    }
    return $remote;
}

/** IPv4 address, or the /64 network of an IPv6 address (one subscriber has a whole /64). */
function hvd_ip_bucket(string $ip): string
{
    $bin = @inet_pton($ip);
    if ($bin === false) {
        return $ip;
    }
    if (strlen($bin) === 16) {
        return bin2hex(substr($bin, 0, 8)) . '::/64';
    }
    return $ip;
}

/** For logs: the address with its host part zeroed (IPv4 /24, IPv6 /48), unless log_full_ip. */
function hvd_ip_for_log(string $ip, bool $full): string
{
    if ($full) {
        return $ip;
    }
    $bin = @inet_pton($ip);
    if ($bin === false) {
        return '?';
    }
    if (strlen($bin) === 4) {
        return (string) inet_ntop(substr($bin, 0, 3) . "\0") . '/24';
    }
    return (string) inet_ntop(substr($bin, 0, 6) . str_repeat("\0", 10)) . '/48';
}

function hvd_discard_output(): void
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
}

function hvd_common_headers(): void
{
    header_remove('X-Powered-By');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: no-store, max-age=0');
    header('Pragma: no-cache');
    // "same-origin" (not "no-referrer"): pages served from here post back to this endpoint
    // and must keep their Origin header.
    header('Referrer-Policy: same-origin');
    header('X-Frame-Options: DENY');
    header('X-Robots-Tag: noindex, nofollow');
    header('Cross-Origin-Resource-Policy: same-origin');
}

/** @return never */
function hvd_respond_json(int $status, array $payload, array $headers = []): void
{
    hvd_discard_output();
    http_response_code($status);
    hvd_common_headers();
    header('Content-Type: application/json; charset=utf-8');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    foreach ($headers as $h) {
        header($h);
    }
    $flags = HVD_JSON_FLAGS;
    if (defined('JSON_INVALID_UTF8_SUBSTITUTE')) {
        $flags |= JSON_INVALID_UTF8_SUBSTITUTE;
    }
    $body = json_encode($payload, $flags);
    echo is_string($body) ? $body : '{"ok":false,"errors":{"form":"Server error."}}';
    exit;
}

/** @return never */
function hvd_respond_html(int $status, string $html, string $styleHash, array $headers = []): void
{
    hvd_discard_output();
    http_response_code($status);
    hvd_common_headers();
    header('Content-Type: text/html; charset=utf-8');
    header("Content-Security-Policy: default-src 'none'; style-src '" . $styleHash . "'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    foreach ($headers as $h) {
        header($h);
    }
    echo $html;
    exit;
}

/** @return never */
function hvd_redirect(string $location): void
{
    if (strpbrk($location, "\r\n\0") !== false || !hvd_valid_local_url($location)) {
        hvd_fail_generic(500);
    }
    hvd_discard_output();
    http_response_code(303);
    hvd_common_headers();
    header('Location: ' . $location);
    header('Content-Type: text/plain; charset=utf-8');
    exit;
}

/**
 * Refuse the request with a form-level message.
 * JSON: {ok:false, errors:{form: message}, code}. HTML: a small error page.
 * @return never
 */
function hvd_fail(HvdRequest $req, int $status, string $code, string $message, array $headers = [], array $extra = []): void
{
    if ($req->json) {
        hvd_respond_json($status, ['ok' => false, 'errors' => ['form' => $message], 'code' => $code] + $extra, $headers);
    }
    $back = '/';
    if ($req->cfg !== null && isset($req->cfg['form_pages'][$req->endpoint])) {
        $back = $req->cfg['form_pages'][$req->endpoint];
    }
    hvd_render_message_page($status, $message, $back, $headers);
}

/** Last-resort failure when the request or configuration is unknown. @return never */
function hvd_fail_generic(int $status): void
{
    $req = $GLOBALS['hvd_request'] ?? null;
    if (!$req instanceof HvdRequest) {
        $req = new HvdRequest();
        $req->json = hvd_wants_json(hvd_media_type());
    }
    hvd_fail($req, $status, 'server', hvd_msg_server($req->cfg));
}

function hvd_msg_server(?array $cfg): string
{
    $email = $cfg !== null ? $cfg['public_email'] : 'info@hvdiscover.com';
    return 'We could not process your request just now. Try again in a few minutes, or email ' . $email . '.';
}
