<?php
/**
 * HV Discover form API: request flow for quote.php, contact.php and token.php.
 *
 * POST /api/quote.php | /api/contact.php, in order:
 *    1. method must be POST                                          405
 *    2. attempt limits per IP and per network (every POST counts)    429
 *    3. Origin / Referer must be an allowed origin                   403
 *    4. content type: urlencoded or JSON only                        415
 *    5. body size limit                                              413
 *    6. body must parse                                              400
 *    7. honeypot filled -> fake success, nothing sent                200 / 303
 *    8. field validation                                             422 (or review page)
 *    9. signed token: present, genuine, this form, fresh, older than
 *       min_fill_seconds (busy.min_fill_seconds in busy mode)        403 code=token / 429 code=retry
 *   10. duplicate of a recent request -> same reference              200 / 303
 *   11. send budget, read only: per IP, per network (in busy mode
 *       also busy.sends_per_network), site-wide hourly + daily caps  429
 *   12. claim the token nonce (single use)                           403 code=token
 *   13. charge the send budget (atomic re-check; the claim is given
 *       back if a parallel request took the last slot)               429
 *   14. send the email                                               503 on failure
 *   15. success: {ok:true, reference} or 303 to the success page
 *
 * Nothing in the send budget is charged before the claim in step 12 succeeds, so replaying
 * a used token, even with every field changed, costs the replayer attempt slots only.
 *
 * Busy mode: once the whole site has sent busy.after emails within its window (20 an hour by
 * default, several days' normal traffic), each network (IPv4 /24, IPv6 /48) may send only
 * busy.sends_per_network (1 an hour) and tokens must be busy.min_fill_seconds old. A flood
 * then needs a new network for every email to reach the hard caps, instead of locking the
 * forms with two addresses.
 *
 * GET /api/token.php?form=quote|contact issues a token (rate-limited per IP).
 */
declare(strict_types=1);

if (!defined('HVD_API')) {
    http_response_code(404);
    exit;
}

/** @return array{0: HvdRequest, 1: HvdStore} */
function hvd_begin(string $endpoint): array
{
    $req = new HvdRequest();
    $req->endpoint = $endpoint;
    $req->method = strtoupper(hvd_server('REQUEST_METHOD'));
    $req->mediaType = hvd_media_type();
    $req->json = $endpoint === 'token' ? true : hvd_wants_json($req->mediaType);
    $GLOBALS['hvd_request'] = $req;

    if (hvd_server('PATH_INFO') !== '') {
        hvd_fail($req, 404, 'not_found', 'Not found.');
    }
    try {
        $cfg = hvd_config();
    } catch (HvdConfigError $e) {
        error_log('hvd-forms: configuration error: ' . $e->getMessage());
        hvd_fail($req, 503, 'server', hvd_msg_server(null));
    }
    date_default_timezone_set($cfg['timezone']);
    $req->cfg = $cfg;
    try {
        $store = new HvdStore(hvd_data_dir($cfg));
        $logDir = $store->path('log');
    } catch (HvdStorageError $e) {
        error_log('hvd-forms: storage error: ' . $e->getMessage());
        hvd_fail($req, 503, 'server', hvd_msg_server($cfg));
    }
    HvdLog::init($logDir, $cfg['log_max_bytes']);
    $req->ip = hvd_client_ip($cfg);
    $req->ipKey = hash_hmac('sha256', hvd_ip_bucket($req->ip), hvd_subkey($cfg, 'ip'));
    $req->netKey = hash_hmac('sha256', hvd_ip_network($req->ip), hvd_subkey($cfg, 'net'));
    HvdLog::context([
        'ep' => $endpoint,
        'ip' => substr($req->ipKey, 0, 16),
        'net' => hvd_ip_for_log($req->ip, $cfg['log_full_ip']),
    ]);
    if (random_int(1, 100) === 1) {
        try {
            $store->gc($cfg['log_retention_days']);
        } catch (Throwable $e) {
            // best effort
        }
    }
    return [$req, $store];
}

/** Record a hit under $rules; true when allowed. Logs the first refusal per key and window. */
function hvd_rate_ok(HvdStore $store, string $bucket, string $key, int $retain, array $rules, string $why, bool $important = false): bool
{
    $r = $store->hit($bucket, $key, $retain, $rules);
    if ($r === HvdStore::BLOCKED_FIRST) {
        HvdLog::event('rejected', ['why' => $why], $important);
    }
    return $r === HvdStore::ALLOWED;
}

/** For read-only refusals: at most one log line per reason and key every 10 minutes. */
function hvd_log_once(HvdStore $store, string $why, string $key, bool $important = false): void
{
    if ($store->hit('logged', hash('sha256', $why . '|' . $key), 600, [[1, 600]]) === HvdStore::ALLOWED) {
        HvdLog::event('rejected', ['why' => $why], $important);
    }
}

function hvd_global_key(): string
{
    return hash('sha256', 'hvd-global-sends');
}

/** One retention for the site-wide bucket: its longest window, busy trigger included. */
function hvd_global_retain(array $cfg): int
{
    return max($cfg['limits']['sends_global'][1], $cfg['limits']['sends_global_daily'][1], $cfg['busy']['after'][1]);
}

/** @return int[] site-wide send times */
function hvd_global_hits(HvdStore $store, array $cfg): array
{
    return $store->hits('send_all', hvd_global_key(), hvd_global_retain($cfg));
}

function hvd_is_busy(array $cfg, array $globalHits): bool
{
    return HvdStore::countSince($globalHits, $cfg['busy']['after'][1], time()) >= $cfg['busy']['after'][0];
}

function hvd_min_fill(array $cfg, bool $busy): int
{
    return $busy ? max($cfg['min_fill_seconds'], $cfg['busy']['min_fill_seconds']) : $cfg['min_fill_seconds'];
}

/**
 * The send budget of one request, tier => [bucket, key, retention, rules, log reason].
 * A bucket's retention covers the longest window ever used on it (busy rules included),
 * so entering busy mode finds the history it needs.
 */
function hvd_send_plan(HvdRequest $req, array $cfg, bool $busy): array
{
    $l = $cfg['limits'];
    $netRules = [$l['sends_per_network']];
    if ($busy) {
        $netRules[] = $cfg['busy']['sends_per_network'];
    }
    return [
        'ip' => ['send_ip', $req->ipKey, $l['sends_per_ip'][1], [$l['sends_per_ip']], 'rate_sends'],
        'net' => ['send_net', $req->netKey, max($l['sends_per_network'][1], $cfg['busy']['sends_per_network'][1]),
            $netRules, $busy ? 'rate_sends_net_busy' : 'rate_sends_net'],
        'all' => ['send_all', hvd_global_key(), hvd_global_retain($cfg),
            [$l['sends_global'], $l['sends_global_daily']], 'rate_global'],
    ];
}

/** @return never */
function hvd_fail_budget(HvdRequest $req, array $cfg, string $tier, array $rules): void
{
    $retry = 0;
    foreach ($rules as $rule) {
        $retry = max($retry, min(3600, (int) $rule[1]));
    }
    if ($tier === 'all') {
        hvd_fail($req, 429, 'rate_limited',
            'We are receiving an unusual number of requests. Try again later, or email ' . $cfg['public_email'] . '.',
            ['Retry-After: ' . $retry]);
    }
    hvd_fail($req, 429, 'rate_limited', hvd_msg_rate($cfg), ['Retry-After: ' . $retry]);
}

function hvd_new_token(array $cfg, string $form): string
{
    return HvdToken::issue($form, hvd_token_key($cfg), time());
}

function hvd_msg_rate(array $cfg): string
{
    return 'Too many requests from your network. Wait a few minutes and try again, or email ' . $cfg['public_email'] . '.';
}

/** @return never */
function hvd_success(HvdRequest $req, string $form, string $ref): void
{
    if ($req->json) {
        hvd_respond_json(200, ['ok' => true, 'reference' => $ref]);
    }
    hvd_redirect(str_replace('{ref}', rawurlencode($ref), $req->cfg['success_redirect'][$form]));
}

function hvd_read_body(HvdRequest $req, int $max): string
{
    $len = hvd_server('CONTENT_LENGTH');
    $tooLarge = static function (int $bytes) use ($req): void {
        HvdLog::event('rejected', ['why' => 'too_large', 'bytes' => $bytes]);
        hvd_fail($req, 413, 'too_large', 'Your message is too long. Shorten it and try again.');
    };
    if ($len !== '') {
        if (preg_match('/\A[0-9]{1,15}\z/', $len) !== 1) {
            hvd_fail($req, 400, 'bad_request', 'The form data could not be read. Reload the page and try again.');
        }
        if ((int) $len > $max) {
            $tooLarge((int) $len);
        }
    }
    $raw = file_get_contents('php://input', false, null, 0, $max + 1);
    if (!is_string($raw)) {
        $raw = '';
    }
    if (strlen($raw) > $max) {
        $tooLarge(strlen($raw));
    }
    return $raw;
}

function hvd_parse_body(HvdRequest $req, string $raw): array
{
    if ($req->mediaType === 'application/json') {
        $d = json_decode($raw, true, 16, JSON_BIGINT_AS_STRING);
        if (!is_array($d) || ($d !== [] && hvd_is_list($d))) {
            HvdLog::event('rejected', ['why' => 'bad_json']);
            hvd_fail($req, 400, 'bad_request', 'The form data could not be read. Reload the page and try again.');
        }
        return $d;
    }
    $d = [];
    parse_str($raw, $d);
    return $d;
}

function hvd_handle_form(string $form): void
{
    [$req, $store] = hvd_begin($form);
    $cfg = $req->cfg;
    try {
        hvd_process_form($req, $store, $cfg, $form);
    } catch (HvdStorageError $e) {
        HvdLog::event('storage_error', ['err' => $e->getMessage()], true);
        hvd_fail($req, 503, 'server', hvd_msg_server($cfg));
    }
}

function hvd_process_form(HvdRequest $req, HvdStore $store, array $cfg, string $form): void
{
    if ($req->method !== 'POST') {
        hvd_fail($req, 405, 'method', 'This address only accepts form submissions.', ['Allow: POST']);
    }
    $l = $cfg['limits'];
    $attemptTiers = [
        ['attempt_ip', $req->ipKey, $l['attempts_per_ip'], 'rate_attempts'],
        ['attempt_net', $req->netKey, $l['attempts_per_network'], 'rate_attempts_net'],
    ];
    foreach ($attemptTiers as [$bucket, $key, $rule, $why]) {
        if (!hvd_rate_ok($store, $bucket, $key, $rule[1], [$rule], $why)) {
            hvd_fail($req, 429, 'rate_limited', hvd_msg_rate($cfg), ['Retry-After: ' . $rule[1]]);
        }
    }
    if (!hvd_origin_ok($cfg)) {
        HvdLog::event('rejected', [
            'why' => 'origin',
            'origin' => hvd_server('HTTP_ORIGIN'),
            'ua' => hvd_server('HTTP_USER_AGENT'),
        ]);
        hvd_fail($req, 403, 'forbidden', 'This request was blocked. Reload the page and send the form again.');
    }
    if ($req->mediaType !== 'application/x-www-form-urlencoded' && $req->mediaType !== 'application/json') {
        HvdLog::event('rejected', ['why' => 'content_type', 'ct' => $req->mediaType]);
        hvd_fail($req, 415, 'bad_request', 'This request format is not supported. Reload the page and try again.');
    }
    $data = hvd_parse_body($req, hvd_read_body($req, $cfg['max_body_bytes']));

    // Honeypot: a field people never see. Pretend it worked; send nothing.
    $hp = $data['website'] ?? '';
    if (!is_string($hp) || trim($hp) !== '') {
        HvdLog::event('rejected', ['why' => 'honeypot', 'ua' => hvd_server('HTTP_USER_AGENT')]);
        hvd_success($req, $form, hvd_reference());
    }

    [$values, $errors] = hvd_validate($form, $data);
    $globalHits = hvd_global_hits($store, $cfg);
    $busy = hvd_is_busy($cfg, $globalHits);
    $tok = HvdToken::check(
        $data['token'] ?? null,
        $form,
        hvd_token_key($cfg),
        time(),
        hvd_min_fill($cfg, $busy),
        $cfg['token_max_age']
    );

    if ($errors) {
        HvdLog::event('invalid', ['fields' => array_keys($errors), 'token' => $tok['status']]);
        if ($req->json) {
            hvd_respond_json(422, ['ok' => false, 'errors' => $errors]);
        }
        hvd_render_review($req, $form, $values, $errors, hvd_new_token($cfg, $form), '');
    }

    if ($tok['status'] !== HvdToken::OK) {
        HvdLog::event('rejected', ['why' => 'token_' . $tok['status'], 'busy' => $busy]);
        if (!$req->json) {
            // No JavaScript (no token) or a stale page: show the details back with a fresh token.
            $fresh = $tok['status'] === HvdToken::MISSING || $tok['status'] === HvdToken::TOO_FAST;
            hvd_render_review($req, $form, $values, [], hvd_new_token($cfg, $form), $fresh
                ? 'Check your details below, then send.'
                : 'Your form session expired. Check your details below, then send again.');
        }
        if ($tok['status'] === HvdToken::TOO_FAST) {
            hvd_fail($req, 429, 'retry', 'Please wait a moment, then send the form again.',
                ['Retry-After: ' . $tok['wait']], ['retry_after' => $tok['wait']]);
        }
        hvd_fail($req, 403, 'token', 'Your form session expired. Reload the page and try again.');
    }

    $fingerprint = hvd_fingerprint($cfg, $form, $values);
    if ($cfg['duplicate_window'] > 0) {
        $prev = $store->get('dup', $fingerprint);
        if ($prev !== null) {
            HvdLog::event('duplicate', ['ref' => $prev]);
            hvd_success($req, $form, $prev);
        }
    }

    // Send budget, read only: refuse early without changing any counter.
    $plan = hvd_send_plan($req, $cfg, $busy);
    $now = time();
    foreach ($plan as $tier => [$bucket, $key, $retain, $rules, $why]) {
        $hits = $tier === 'all' ? $globalHits : $store->hits($bucket, $key, $retain);
        if (!HvdStore::allows($hits, $rules, $now)) {
            hvd_log_once($store, $why, $key, $tier === 'all');
            hvd_fail_budget($req, $cfg, $tier, $rules);
        }
    }

    // Single use. A used token stops here, before any send counter moves.
    if (!$store->claim('nonce', $tok['nonce'], $cfg['token_max_age'] + 300)) {
        HvdLog::event('rejected', ['why' => 'token_used']);
        if (!$req->json) {
            hvd_render_review($req, $form, $values, [], hvd_new_token($cfg, $form),
                'Check your details below, then send again.');
        }
        hvd_fail($req, 403, 'token', 'Your form session expired. Reload the page and try again.');
    }

    $ref = hvd_reference();
    try {
        // Charge the budget (atomic re-check: a parallel request may have taken the last slot).
        foreach ($plan as $tier => [$bucket, $key, $retain, $rules, $why]) {
            if (!hvd_rate_ok($store, $bucket, $key, $retain, $rules, $why, $tier === 'all')) {
                $store->release('nonce', $tok['nonce']);
                hvd_fail_budget($req, $cfg, $tier, $rules);
            }
        }
        $via = hvd_send_mail(
            $cfg,
            $store,
            $form,
            $ref,
            hvd_mail_subject($form, $ref, $values),
            hvd_mail_text($cfg, $form, $ref, $values),
            $values['email']
        );
    } catch (HvdMailError $e) {
        $store->release('nonce', $tok['nonce']); // let the visitor retry with the same page
        HvdLog::event('mail_failed', ['ref' => $ref, 'err' => $e->getMessage()], true);
        hvd_fail($req, 503, 'server',
            'We could not send your request just now. Try again in a few minutes, or email ' . $cfg['public_email'] . '.');
    } catch (HvdStorageError $e) {
        $store->release('nonce', $tok['nonce']);
        throw $e;
    }

    if ($cfg['duplicate_window'] > 0) {
        try {
            $store->put('dup', $fingerprint, $ref, $cfg['duplicate_window']);
        } catch (HvdStorageError $e) {
            HvdLog::event('storage_error', ['err' => $e->getMessage()], true);
        }
    }
    HvdLog::event('sent', ['ref' => $ref, 'via' => $via, 'items' => count($values['items'] ?? []), 'busy' => $busy], true);
    hvd_success($req, $form, $ref);
}

function hvd_handle_token(): void
{
    [$req, $store] = hvd_begin('token');
    $cfg = $req->cfg;
    try {
        if ($req->method !== 'GET') {
            hvd_fail($req, 405, 'method', 'This address only answers GET requests.', ['Allow: GET']);
        }
        $form = $_GET['form'] ?? '';
        if (!is_string($form) || !in_array($form, ['quote', 'contact'], true)) {
            hvd_fail($req, 400, 'bad_request', 'Unknown form.');
        }
        if (strtolower(hvd_server('HTTP_SEC_FETCH_SITE')) === 'cross-site') {
            HvdLog::event('rejected', ['why' => 'token_cross_site', 'ua' => hvd_server('HTTP_USER_AGENT')]);
            hvd_fail($req, 403, 'forbidden', 'This request was blocked.');
        }
        $lim = $cfg['limits']['tokens_per_ip'];
        if (!hvd_rate_ok($store, 'token_ip', $req->ipKey, $lim[1], [$lim], 'rate_tokens')) {
            hvd_fail($req, 429, 'rate_limited', hvd_msg_rate($cfg), ['Retry-After: ' . $lim[1]]);
        }
        hvd_respond_json(200, [
            'ok' => true,
            'token' => hvd_new_token($cfg, $form),
            'min_wait' => hvd_min_fill($cfg, hvd_is_busy($cfg, hvd_global_hits($store, $cfg))),
            'expires_in' => $cfg['token_max_age'],
        ]);
    } catch (HvdStorageError $e) {
        HvdLog::event('storage_error', ['err' => $e->getMessage()], true);
        hvd_fail($req, 503, 'server', hvd_msg_server($cfg));
    }
}
