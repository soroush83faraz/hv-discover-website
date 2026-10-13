<?php
/**
 * HV Discover form API: configuration loading and validation.
 *
 * Search order (first match wins, no merging):
 *   1. the file named by the HVD_CONFIG environment variable (SetEnv HVD_CONFIG /path/config.php);
 *      when set, no other location is tried;
 *   2. <web root>/../hvd-private/config.php  (outside public_html: recommended for production);
 *   3. api/config.php                        (denied by api/.htaccess).
 *
 * Any invalid value stops the endpoints with a generic 503 (fail closed) and a log line
 * naming the setting. Secret values are never logged.
 */
declare(strict_types=1);

if (!defined('HVD_API')) {
    http_response_code(404);
    exit;
}

final class HvdConfigError extends RuntimeException
{
}

/** Placeholder secrets that must never run in production. */
const HVD_SECRET_PLACEHOLDERS = ['CHANGE_ME', 'change-me', 'changeme', 'your-secret', 'secret'];

function hvd_config_file(): ?string
{
    $env = getenv('HVD_CONFIG');
    if (!is_string($env) || $env === '') {
        $env = (isset($_SERVER['HVD_CONFIG']) && is_string($_SERVER['HVD_CONFIG'])) ? $_SERVER['HVD_CONFIG'] : '';
    }
    if ($env !== '') {
        return is_file($env) ? $env : null;
    }
    $private = dirname(HVD_API_DIR, 2) . DIRECTORY_SEPARATOR . 'hvd-private' . DIRECTORY_SEPARATOR . 'config.php';
    if (@is_file($private)) {
        return $private;
    }
    $local = HVD_API_DIR . DIRECTORY_SEPARATOR . 'config.php';
    return is_file($local) ? $local : null;
}

function hvd_config(): array
{
    static $cfg = null;
    if (is_array($cfg)) {
        return $cfg;
    }
    $file = hvd_config_file();
    if ($file === null) {
        throw new HvdConfigError('config file not found');
    }
    // Include in an isolated scope: the file sees no local variables.
    $raw = (static function (string $f) {
        return require $f;
    })($file);
    if (!is_array($raw)) {
        throw new HvdConfigError('config file must return an array');
    }
    $normalized = hvd_normalize_config($raw);
    // A config file inside the web root (e.g. api/config.php, or a development copy shipped
    // with a site build) is protected only by .htaccess and the PHP guard; one handler
    // misconfiguration would serve the secret and SMTP password as text. Production must
    // keep it outside (hvd-private/ or HVD_CONFIG); only dev_mode accepts it.
    if (!$normalized['dev_mode'] && hvd_path_inside($file, dirname(HVD_API_DIR))) {
        throw new HvdConfigError('the config file in use is inside the web root (' . basename(dirname($file)) . '/'
            . basename($file) . '): move it to <web root>/../hvd-private/config.php or point HVD_CONFIG to a file'
            . ' outside the web root (dev_mode => true allows it for local development only)');
    }
    $cfg = $normalized;
    return $cfg;
}

/** True when $path (an existing file) lies inside directory $dir, after resolving links. */
function hvd_path_inside(string $path, string $dir): bool
{
    $p = realpath($path);
    $d = realpath($dir);
    if ($p === false || $d === false) {
        return false;
    }
    $p = str_replace('\\', '/', $p);
    $d = rtrim(str_replace('\\', '/', $d), '/') . '/';
    if (DIRECTORY_SEPARATOR === '\\') {
        $p = strtolower($p);
        $d = strtolower($d);
    }
    return strncmp($p, $d, strlen($d)) === 0;
}

function hvd_config_defaults(): array
{
    return [
        'secret' => '',
        'mail_to' => ['info@hvdiscover.com'],
        'mail_from' => '',
        'mail_from_name' => 'HV Discover website',
        'mail_envelope_from' => '',
        'public_email' => 'info@hvdiscover.com',
        'mail_transport' => 'auto',
        'mail_eol' => 'auto',
        'smtp' => [
            'host' => '',
            'port' => 587,
            'secure' => 'tls',
            'user' => '',
            'pass' => '',
            'timeout' => 15,
            'deadline' => 30,
            'peer_name' => '',
            'helo' => '',
        ],
        'allowed_origins' => ['https://hvdiscover.com', 'https://www.hvdiscover.com'],
        'dev_mode' => false,
        'data_dir' => '',
        'trusted_proxies' => [],
        'client_ip_header' => '',
        'timezone' => 'Europe/London',
        'site_url' => 'https://www.hvdiscover.com',
        'min_fill_seconds' => 3,
        'token_max_age' => 7200,
        'max_body_bytes' => 65536,
        'duplicate_window' => 3600,
        // "ip" = one IPv4 address or one IPv6 /64; "network" = IPv4 /24 or IPv6 /48
        // (a typical whole IPv6 customer allocation, so /64-hopping does not multiply limits).
        'limits' => [
            'attempts_per_ip' => [20, 600],
            'attempts_per_network' => [60, 600],
            'sends_per_ip' => [5, 600],
            'sends_per_network' => [10, 3600],
            'sends_global' => [100, 3600],
            'sends_global_daily' => [300, 86400],
            'tokens_per_ip' => [30, 600],
        ],
        // Busy mode: once the whole site has sent busy.after emails within its window, every
        // network may send only busy.sends_per_network, and tokens must be older.
        'busy' => [
            'after' => [20, 3600],
            'sends_per_network' => [1, 3600],
            'min_fill_seconds' => 10,
        ],
        'success_redirect' => [
            'quote' => '/quote-sent?ref={ref}',
            'contact' => '/contact?ref={ref}#message-sent',
        ],
        'form_pages' => [
            'quote' => '/request-a-quote',
            'contact' => '/contact',
        ],
        'log_full_ip' => false,
        'log_max_bytes' => 5242880,
        'log_retention_days' => 180,
    ];
}

/** Envelope senders end up on a sendmail command line: no quotes, no leading dash. */
function hvd_valid_envelope(string $e): bool
{
    return hvd_valid_email($e)
        && preg_match('/\A[A-Za-z0-9._+][A-Za-z0-9._+-]*@[A-Za-z0-9.-]+\z/', $e) === 1;
}

function hvd_normalize_origin(string $o): ?string
{
    $o = strtolower(trim($o, " \t"));
    if (preg_match('#\A(https?)://([a-z0-9.-]+|\[[0-9a-f:.]+\])(?::([0-9]{1,5}))?\z#', $o, $m) !== 1) {
        return null;
    }
    $scheme = $m[1];
    $host = $m[2];
    $port = isset($m[3]) && $m[3] !== '' ? (int) $m[3] : null;
    if ($port !== null && ($port < 1 || $port > 65535)) {
        return null;
    }
    if (($scheme === 'https' && $port === 443) || ($scheme === 'http' && $port === 80)) {
        $port = null;
    }
    return $scheme . '://' . $host . ($port !== null ? ':' . $port : '');
}

/** Relative, same-site URL only: "/path", never "//host" or "/\host". */
function hvd_valid_local_url(string $u): bool
{
    return preg_match('#\A/(?![/\\\\])[A-Za-z0-9._~!$&\'()*+,;=:@%/?{}\#-]*\z#', $u) === 1;
}

function hvd_normalize_config(array $raw): array
{
    $d = hvd_config_defaults();
    $c = [];
    $fail = static function (string $why): void {
        throw new HvdConfigError($why);
    };

    // secret
    $secret = $raw['secret'] ?? '';
    if (!is_string($secret) || strlen($secret) < 32) {
        $fail('secret must be a string of at least 32 characters');
    }
    foreach (HVD_SECRET_PLACEHOLDERS as $ph) {
        if (stripos($secret, $ph) !== false) {
            $fail('secret is still the placeholder from config.sample.php');
        }
    }
    $c['secret'] = $secret;

    // recipients
    $to = $raw['mail_to'] ?? $d['mail_to'];
    if (is_string($to)) {
        $to = [$to];
    }
    if (!is_array($to) || count($to) < 1 || count($to) > 5) {
        $fail('mail_to must be one address or a list of up to 5');
    }
    $c['mail_to'] = [];
    foreach ($to as $addr) {
        if (!is_string($addr) || !hvd_valid_email($addr)) {
            $fail('mail_to contains an invalid address');
        }
        $c['mail_to'][] = $addr;
    }

    // sender
    $from = $raw['mail_from'] ?? '';
    if (!is_string($from) || !hvd_valid_envelope($from)) {
        $fail('mail_from must be a plain address on the site domain, e.g. website@hvdiscover.com');
    }
    $c['mail_from'] = $from;

    $name = $raw['mail_from_name'] ?? $d['mail_from_name'];
    if (!is_string($name) || preg_match('/\A[A-Za-z0-9 .,&()\'-]{0,64}\z/', $name) !== 1) {
        $fail('mail_from_name: up to 64 ASCII letters, digits, spaces and .,&()\'-');
    }
    $c['mail_from_name'] = trim($name);

    $env = $raw['mail_envelope_from'] ?? '';
    if (!is_string($env)) {
        $fail('mail_envelope_from must be a string');
    }
    if ($env === '') {
        $env = $from;
    }
    if (!hvd_valid_envelope($env)) {
        $fail('mail_envelope_from is not a valid plain address');
    }
    $c['mail_envelope_from'] = $env;

    $pub = $raw['public_email'] ?? $d['public_email'];
    if (!is_string($pub) || !hvd_valid_email($pub)) {
        $fail('public_email is not a valid address');
    }
    $c['public_email'] = $pub;

    // transport
    $tr = $raw['mail_transport'] ?? $d['mail_transport'];
    if (!is_string($tr) || !in_array($tr, ['auto', 'mail', 'smtp', 'file'], true)) {
        $fail('mail_transport must be auto, mail, smtp or file');
    }
    $c['mail_transport'] = $tr;

    $eol = $raw['mail_eol'] ?? $d['mail_eol'];
    if (!is_string($eol) || !in_array($eol, ['auto', 'crlf', 'lf'], true)) {
        $fail('mail_eol must be auto, crlf or lf');
    }
    $c['mail_eol'] = $eol === 'lf' ? "\n" : ($eol === 'crlf' ? "\r\n" : (PHP_VERSION_ID >= 80000 ? "\r\n" : "\n"));

    // SMTP
    $s = $raw['smtp'] ?? [];
    if (!is_array($s)) {
        $fail('smtp must be an array');
    }
    $s = array_merge($d['smtp'], $s);
    foreach (['host', 'secure', 'user', 'pass', 'peer_name', 'helo'] as $k) {
        if (!is_string($s[$k])) {
            $fail('smtp.' . $k . ' must be a string');
        }
    }
    $hostRe = '/\A(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\z/';
    if ($s['host'] !== '' && preg_match($hostRe, $s['host']) !== 1 && filter_var($s['host'], FILTER_VALIDATE_IP) === false) {
        $fail('smtp.host must be a host name or IP address');
    }
    if ($s['peer_name'] !== '' && preg_match($hostRe, $s['peer_name']) !== 1) {
        $fail('smtp.peer_name must be a host name');
    }
    if ($s['helo'] !== '' && preg_match($hostRe, $s['helo']) !== 1) {
        $fail('smtp.helo must be a host name');
    }
    if (!in_array($s['secure'], ['tls', 'ssl', 'none'], true)) {
        $fail('smtp.secure must be tls (STARTTLS), ssl (implicit TLS) or none');
    }
    $port = $s['port'];
    if (!is_int($port) || $port < 1 || $port > 65535) {
        $fail('smtp.port must be an integer port number');
    }
    $timeout = $s['timeout'];
    if (!is_int($timeout) || $timeout < 3 || $timeout > 60) {
        $fail('smtp.timeout must be an integer from 3 to 60 seconds');
    }
    $deadline = $s['deadline'];
    if (!is_int($deadline) || $deadline < 5 || $deadline > 120) {
        $fail('smtp.deadline must be an integer from 5 to 120 seconds');
    }
    if ($s['host'] !== '' && $s['secure'] === 'none' && !hvd_is_loopback_host($s['host'])) {
        $fail('smtp.secure "none" is allowed only for a server on this machine (localhost)');
    }
    if (strpbrk($s['user'] . $s['pass'], "\r\n\0") !== false) {
        $fail('smtp.user / smtp.pass contain line breaks');
    }
    if ($tr === 'smtp' && $s['host'] === '') {
        $fail('mail_transport is smtp but smtp.host is empty');
    }
    $c['smtp'] = $s;

    // origins
    $origins = $raw['allowed_origins'] ?? $d['allowed_origins'];
    if (!is_array($origins) || !$origins) {
        $fail('allowed_origins must be a non-empty list');
    }
    $c['allowed_origins'] = [];
    foreach ($origins as $o) {
        $n = is_string($o) ? hvd_normalize_origin($o) : null;
        if ($n === null) {
            $fail('allowed_origins entries must look like https://www.hvdiscover.com (no path, no wildcard)');
        }
        $c['allowed_origins'][$n] = true;
    }

    $dev = $raw['dev_mode'] ?? false;
    if (!is_bool($dev)) {
        $fail('dev_mode must be true or false');
    }
    $c['dev_mode'] = $dev;

    // storage
    $dataDir = $raw['data_dir'] ?? '';
    if (!is_string($dataDir) || strpbrk($dataDir, "\r\n\0") !== false) {
        $fail('data_dir must be a path string');
    }
    $c['data_dir'] = $dataDir;

    // proxies
    $tp = $raw['trusted_proxies'] ?? [];
    if (!is_array($tp)) {
        $fail('trusted_proxies must be a list of IPs or CIDR ranges');
    }
    $c['trusted_proxies'] = [];
    foreach ($tp as $cidr) {
        if (!is_string($cidr) || !hvd_valid_cidr($cidr)) {
            $fail('trusted_proxies contains an invalid IP or CIDR range');
        }
        $c['trusted_proxies'][] = $cidr;
    }
    $hdr = $raw['client_ip_header'] ?? '';
    if (!is_string($hdr) || ($hdr !== '' && preg_match('/\AHTTP_[A-Z0-9_]{1,64}\z/', $hdr) !== 1)) {
        $fail('client_ip_header must be empty or a $_SERVER key such as HTTP_X_FORWARDED_FOR');
    }
    $c['client_ip_header'] = $hdr;

    // timezone
    $tz = $raw['timezone'] ?? $d['timezone'];
    if (!is_string($tz) || !in_array($tz, timezone_identifiers_list(), true)) {
        $fail('timezone must be a valid identifier such as Europe/London');
    }
    $c['timezone'] = $tz;

    $site = $raw['site_url'] ?? $d['site_url'];
    if (!is_string($site) || hvd_normalize_origin($site) === null) {
        $fail('site_url must be an origin such as https://www.hvdiscover.com');
    }
    $c['site_url'] = hvd_normalize_origin($site);

    // numbers
    $ints = [
        'min_fill_seconds' => [0, 60],
        'token_max_age' => [300, 86400],
        'max_body_bytes' => [8192, 1048576],
        'duplicate_window' => [0, 86400],
        'log_max_bytes' => [65536, 104857600],
        'log_retention_days' => [1, 3650],
    ];
    foreach ($ints as $k => $range) {
        $v = $raw[$k] ?? $d[$k];
        if (!is_int($v) || $v < $range[0] || $v > $range[1]) {
            $fail($k . ' must be an integer from ' . $range[0] . ' to ' . $range[1]);
        }
        $c[$k] = $v;
    }

    $lim = $raw['limits'] ?? [];
    if (!is_array($lim)) {
        $fail('limits must be an array');
    }
    $lim = array_merge($d['limits'], $lim);
    $c['limits'] = [];
    foreach (array_keys($d['limits']) as $k) {
        if (!hvd_valid_limit($lim[$k])) {
            $fail('limits.' . $k . ' must be [count, seconds]');
        }
        $c['limits'][$k] = [$lim[$k][0], $lim[$k][1]];
    }

    $busy = $raw['busy'] ?? [];
    if (!is_array($busy)) {
        $fail('busy must be an array');
    }
    $busy = array_merge($d['busy'], $busy);
    foreach (['after', 'sends_per_network'] as $k) {
        if (!hvd_valid_limit($busy[$k])) {
            $fail('busy.' . $k . ' must be [count, seconds]');
        }
    }
    if (!is_int($busy['min_fill_seconds']) || $busy['min_fill_seconds'] < 0 || $busy['min_fill_seconds'] > 120) {
        $fail('busy.min_fill_seconds must be an integer from 0 to 120');
    }
    $c['busy'] = [
        'after' => [$busy['after'][0], $busy['after'][1]],
        'sends_per_network' => [$busy['sends_per_network'][0], $busy['sends_per_network'][1]],
        'min_fill_seconds' => $busy['min_fill_seconds'],
    ];

    // redirects and form pages
    foreach (['success_redirect', 'form_pages'] as $group) {
        $g = $raw[$group] ?? [];
        if (!is_array($g)) {
            $fail($group . ' must be an array');
        }
        $g = array_merge($d[$group], $g);
        foreach (['quote', 'contact'] as $form) {
            $u = $g[$form];
            if (!is_string($u) || !hvd_valid_local_url($u)) {
                $fail($group . '.' . $form . ' must be a path on this site, starting with a single /');
            }
            $c[$group][$form] = $u;
        }
    }

    $lf = $raw['log_full_ip'] ?? false;
    if (!is_bool($lf)) {
        $fail('log_full_ip must be true or false');
    }
    $c['log_full_ip'] = $lf;

    return $c;
}

/** A rate rule: [count 1..100000, window 10..86400 seconds]. */
function hvd_valid_limit($pair): bool
{
    return is_array($pair) && count($pair) === 2 && is_int($pair[0] ?? null) && is_int($pair[1] ?? null)
        && $pair[0] >= 1 && $pair[0] <= 100000 && $pair[1] >= 10 && $pair[1] <= 86400;
}

function hvd_is_loopback_host(string $host): bool
{
    if (strtolower($host) === 'localhost') {
        return true;
    }
    if (filter_var($host, FILTER_VALIDATE_IP) === false) {
        return false;
    }
    return hvd_ip_in_cidr($host, '127.0.0.0/8') || hvd_ip_in_cidr($host, '::1/128');
}

function hvd_valid_cidr(string $cidr): bool
{
    $parts = explode('/', $cidr, 2);
    $bin = @inet_pton($parts[0]);
    if ($bin === false) {
        return false;
    }
    if (count($parts) === 1) {
        return true;
    }
    if (preg_match('/\A[0-9]{1,3}\z/', $parts[1]) !== 1) {
        return false;
    }
    return (int) $parts[1] <= strlen($bin) * 8;
}

function hvd_ip_in_cidr(string $ip, string $cidr): bool
{
    $parts = explode('/', $cidr, 2);
    $ipb = @inet_pton($ip);
    $netb = @inet_pton($parts[0]);
    if ($ipb === false || $netb === false || strlen($ipb) !== strlen($netb)) {
        return false;
    }
    $max = strlen($ipb) * 8;
    $bits = count($parts) === 2 ? (int) $parts[1] : $max;
    if ($bits < 0 || $bits > $max) {
        return false;
    }
    $bytes = intdiv($bits, 8);
    $rem = $bits % 8;
    if ($bytes > 0 && substr($ipb, 0, $bytes) !== substr($netb, 0, $bytes)) {
        return false;
    }
    if ($rem === 0) {
        return true;
    }
    $mask = (0xFF << (8 - $rem)) & 0xFF;
    return (ord($ipb[$bytes]) & $mask) === (ord($netb[$bytes]) & $mask);
}

function hvd_ip_in_list(string $ip, array $cidrs): bool
{
    foreach ($cidrs as $c) {
        if (hvd_ip_in_cidr($ip, $c)) {
            return true;
        }
    }
    return false;
}

/** Purpose-separated keys derived from the one configured secret. */
function hvd_subkey(array $cfg, string $purpose): string
{
    return hash_hmac('sha256', 'hvd-v1:' . $purpose, $cfg['secret'], true);
}
