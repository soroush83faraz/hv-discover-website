<?php
/**
 * HV Discover form API: configuration TEMPLATE. Safe to commit; holds no secrets.
 *
 * Make the real file from this one:
 *   - Production: put it OUTSIDE public_html, at
 *       /home/<user>/domains/hvdiscover.com/hvd-private/config.php
 *     The API finds it there automatically, and a new site build cannot overwrite it.
 *   - Or set the path explicitly in api/.htaccess:  SetEnv HVD_CONFIG /full/path/config.php
 *   - A config file INSIDE the web root (e.g. api/config.php) is refused (generic 503, reason
 *     in the PHP error log) unless dev_mode is true: it is for local development only, and a
 *     development config.php that travels with a site build can never run in production.
 * Never commit the real file. File permissions: 0600 (or 0640), owned by the site user.
 *
 * Deploy checklist
 *   1. secret: a new random value made on the server:  php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"
 *   2. mail_to: the mailbox that receives requests; confirm it exists and is read.
 *   3. mail_from: an address on hvdiscover.com. SPF for hvdiscover.com must allow this server
 *      (mail()) or the SMTP server; DKIM signing enabled for the domain in DirectAdmin.
 *      If hvdiscover.com mail is hosted elsewhere (Google, Zoho...), set DirectAdmin's
 *      "Use remote mail server" for the domain, or local delivery will swallow the mail.
 *   4. smtp: fill in to use authenticated SMTP (recommended); leave host empty for mail().
 *   5. data_dir: a writable folder outside public_html, e.g.
 *      /home/<user>/domains/hvdiscover.com/hvd-private/data  (created if missing, mode 0700).
 *   6. mail_transport must NOT be 'file' in production (that only writes .eml files).
 *   7. dev_mode must be false in production.
 *   8. Check where the client IP comes from (CLIENT.md section 8): behind nginx or a CDN
 *      without mod_remoteip every visitor shares one address, and therefore one limit.
 *   9. Send one real test request from the live site and check it arrives (see CLIENT.md).
 */
defined('HVD_API') || exit; // requested directly: output nothing

return [
    // HMAC key for tokens, IP hashing and duplicate fingerprints. At least 32 characters.
    // Changing it invalidates tokens that are open in visitors' browsers (they refresh automatically).
    'secret' => 'CHANGE_ME_run_php_r_echo_bin2hex_random_bytes_32',

    // Who receives the requests: one address or a list (max 5).
    'mail_to' => 'info@hvdiscover.com',

    // The From address: must be on the site's own domain. Replies go to the visitor (Reply-To).
    'mail_from' => 'website@hvdiscover.com',
    'mail_from_name' => 'HV Discover website',

    // Envelope sender (Return-Path), where bounces go. Empty = same as mail_from.
    'mail_envelope_from' => '',

    // Shown to visitors in error messages ("...or email info@hvdiscover.com").
    'public_email' => 'info@hvdiscover.com',

    // auto = SMTP when smtp.host is set, otherwise PHP mail(). Also: 'smtp', 'mail', 'file' (tests).
    'mail_transport' => 'auto',

    // Line ending for mail() headers: auto (CRLF on PHP 8+, LF on 7.x), 'crlf' or 'lf'.
    // Switch to 'lf' only if received mail shows broken headers.
    'mail_eol' => 'auto',

    // Authenticated SMTP. secure: 'tls' = STARTTLS (port 587), 'ssl' = implicit TLS (port 465),
    // 'none' = only for a server on this machine (localhost). Certificates are always verified:
    // use the host name on the server's certificate (e.g. the server's own host name), or set
    // peer_name to it when connecting by another name.
    'smtp' => [
        'host' => '',
        'port' => 587,
        'secure' => 'tls',
        'user' => '',       // e.g. website@hvdiscover.com
        'pass' => '',       // that mailbox's password; keep this file private
        'timeout' => 15,    // per network step
        'deadline' => 30,   // the whole SMTP conversation, start to finish (seconds)
        'peer_name' => '',
        'helo' => '',       // default: the domain of mail_from
    ],

    // Pages allowed to post the forms (exact origins, no paths, no wildcards).
    'allowed_origins' => [
        'https://hvdiscover.com',
        'https://www.hvdiscover.com',
    ],

    // Development only. true allows http(s)://localhost and 127.0.0.1 origins on any port, and
    // a config file inside the web root (refused otherwise).
    'dev_mode' => false,

    // Writable folder for rate limits, token claims and logs. Empty = <web root>/../hvd-private/data
    // when hvd-private exists and is writable, else api/data (denied by .htaccess).
    'data_dir' => '',

    // Only if the site sits behind a CDN or proxy (e.g. Cloudflare): its IP ranges, and the
    // header carrying the visitor address, e.g. 'HTTP_CF_CONNECTING_IP' or 'HTTP_X_FORWARDED_FOR'.
    // Leave both empty otherwise; the header is never trusted from other addresses.
    'trusted_proxies' => [],
    'client_ip_header' => '',

    'timezone' => 'Europe/London',
    'site_url' => 'https://www.hvdiscover.com',   // only used in the email footer

    // Anti-spam timing: a token must be at least this old (seconds) and at most token_max_age.
    'min_fill_seconds' => 3,
    'token_max_age' => 7200,

    'max_body_bytes' => 65536,
    'duplicate_window' => 3600,   // identical request within this time: same reference, no second email

    // [count, seconds]. "ip" = one IPv4 address or one IPv6 /64; "network" = IPv4 /24 or IPv6 /48.
    // Send counters move only after a token is claimed, so replayed tokens cost attempts only.
    'limits' => [
        'attempts_per_ip' => [20, 600],       // every POST, valid or not
        'attempts_per_network' => [60, 600],
        'sends_per_ip' => [5, 600],           // emails sent
        'sends_per_network' => [10, 3600],
        'sends_global' => [100, 3600],        // hard caps for the whole site: keep them under the
        'sends_global_daily' => [300, 86400], // host's outgoing-mail limit, or a flood could get the
                                              // account's mail (all company email) blocked
        'tokens_per_ip' => [30, 600],
    ],

    // Busy mode, a soft cap before the hard ones: once the site has sent busy.after emails in
    // its window (20 an hour is several days of normal traffic), each network may send only
    // busy.sends_per_network, and tokens must be busy.min_fill_seconds old (the site's script
    // waits automatically). A flood then needs a new network for every further email, while
    // real visitors from other networks still get through.
    'busy' => [
        'after' => [20, 3600],
        'sends_per_network' => [1, 3600],
        'min_fill_seconds' => 10,
    ],

    // Where a plain (no-JavaScript) form post lands after success. {ref} = the reference.
    'success_redirect' => [
        'quote' => '/quote-sent?ref={ref}',
        'contact' => '/contact?ref={ref}#message-sent',
    ],
    // The form pages, for "back" links.
    'form_pages' => [
        'quote' => '/request-a-quote',
        'contact' => '/contact',
    ],

    // Logs keep a keyed hash of the IP and its /24 (IPv6 /48) network. true = full IP.
    'log_full_ip' => false,
    'log_max_bytes' => 5242880,
    'log_retention_days' => 180,
];
