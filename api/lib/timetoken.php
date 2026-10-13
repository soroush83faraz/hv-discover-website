<?php
/**
 * HV Discover form API: signed timestamp tokens (minimum fill time + single use).
 *
 * Format:  v1.<form>.<issued unix time>.<nonce>.<signature>
 *   form       quote | contact (a token only works for the form it was issued for)
 *   nonce      16 random bytes, base64url (22 chars); claimed once on a successful send
 *   signature  HMAC-SHA256 over "v1.<form>.<time>.<nonce>" with a key derived from the
 *              config secret, base64url (43 chars); compared in constant time
 *
 * Stateless to issue; the only server state is the nonce claim after a send.
 * The token is not secret and not tied to a session or cookie: its jobs are to prove that
 * the client fetched it at least min_fill_seconds before submitting, recently, and that
 * each token sends at most one message.
 */
declare(strict_types=1);

if (!defined('HVD_API')) {
    http_response_code(404);
    exit;
}

final class HvdToken
{
    public const OK = 'ok';
    public const MISSING = 'missing';
    public const INVALID = 'invalid';
    public const EXPIRED = 'expired';
    public const TOO_FAST = 'too_fast';

    private const RE = '/\Av1\.(quote|contact)\.([0-9]{10})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})\z/';

    public static function issue(string $form, string $key, int $now): string
    {
        $payload = 'v1.' . $form . '.' . $now . '.' . hvd_b64url(random_bytes(16));
        return $payload . '.' . hvd_b64url(hash_hmac('sha256', $payload, $key, true));
    }

    /**
     * @return array{status: string, nonce: string, wait: int}
     */
    public static function check($token, string $form, string $key, int $now, int $minAge, int $maxAge): array
    {
        $r = ['status' => self::INVALID, 'nonce' => '', 'wait' => 0];
        if ($token === null || $token === '') {
            $r['status'] = self::MISSING;
            return $r;
        }
        if (!is_string($token) || strlen($token) > 120 || preg_match(self::RE, $token, $m) !== 1) {
            return $r;
        }
        $payload = 'v1.' . $m[1] . '.' . $m[2] . '.' . $m[3];
        $expected = hvd_b64url(hash_hmac('sha256', $payload, $key, true));
        if (!hash_equals($expected, $m[4])) {
            return $r;
        }
        if ($m[1] !== $form) {
            return $r;
        }
        $issued = (int) $m[2];
        if ($issued > $now + 30) {
            return $r; // issued "in the future": clock skew beyond reason
        }
        $age = $now - $issued;
        $r['nonce'] = $m[3];
        if ($age > $maxAge) {
            $r['status'] = self::EXPIRED;
            return $r;
        }
        if ($age < $minAge) {
            $r['status'] = self::TOO_FAST;
            $r['wait'] = $minAge - $age;
            return $r;
        }
        $r['status'] = self::OK;
        return $r;
    }
}

function hvd_token_key(array $cfg): string
{
    return hvd_subkey($cfg, 'form-token');
}
