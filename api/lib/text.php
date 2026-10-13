<?php
/**
 * HV Discover form API: text cleaning and low-level validators.
 *
 * Every value a visitor sends passes through hvd_clean_line() or hvd_clean_text()
 * before it is validated, logged or put in an email:
 *   - invalid UTF-8 is rejected, never "repaired";
 *   - CR and LF never survive in single-line values (they become spaces);
 *   - control characters, bidi overrides, zero-width and tag characters are removed.
 */
declare(strict_types=1);

if (!defined('HVD_API')) {
    http_response_code(404);
    exit;
}

/** HTML-escape for text and attribute contexts. */
function hvd_h(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
}

function hvd_is_utf8(string $s): bool
{
    return $s === '' || preg_match('//u', $s) === 1;
}

/** Length in Unicode code points (mbstring is optional on shared hosts). */
function hvd_strlen(string $s): int
{
    if (function_exists('mb_strlen')) {
        return (int) mb_strlen($s, 'UTF-8');
    }
    $n = preg_match_all('/./su', $s);
    return $n === false ? strlen($s) : (int) $n;
}

/** Cut to at most $max code points (input must be valid UTF-8). */
function hvd_truncate(string $s, int $max): string
{
    if ($max <= 0) {
        return '';
    }
    if (function_exists('mb_substr')) {
        return (string) mb_substr($s, 0, $max, 'UTF-8');
    }
    if (preg_match('/\A.{0,' . $max . '}/su', $s, $m) === 1) {
        return $m[0];
    }
    return substr($s, 0, $max);
}

/**
 * Remove characters that have no business in a form value:
 * C0 controls except TAB and LF, DEL and C1 controls, zero-width space, word joiner and
 * invisible operators, bidi embeddings/overrides/isolates (text-reordering spoofing),
 * BOM, interlinear annotations, and Unicode tag characters (hidden text).
 * ZWNJ/ZWJ (U+200C/U+200D) and LRM/RLM stay: several scripts need them.
 */
function hvd_strip_invisible(string $s): ?string
{
    $out = preg_replace(
        '/[\x{0000}-\x{0008}\x{000B}\x{000C}\x{000E}-\x{001F}\x{007F}-\x{009F}\x{200B}\x{202A}-\x{202E}\x{2060}-\x{2064}\x{2066}-\x{2069}\x{FEFF}\x{FFF9}-\x{FFFB}\x{E0000}-\x{E007F}]/u',
        '',
        $s
    );
    return is_string($out) ? $out : null;
}

function hvd_nfc(string $s): string
{
    if (class_exists('Normalizer')) {
        $n = Normalizer::normalize($s, Normalizer::FORM_C);
        if (is_string($n)) {
            return $n;
        }
    }
    return $s;
}

/**
 * Single-line value: line breaks and tabs become spaces, invisible characters go,
 * runs of whitespace collapse to one space. Returns null for invalid UTF-8.
 */
function hvd_clean_line(string $s): ?string
{
    if (!hvd_is_utf8($s)) {
        return null;
    }
    $s = str_replace(["\r\n", "\r", "\n", "\t", "\u{2028}", "\u{2029}", "\u{0085}"], ' ', $s);
    $s = hvd_strip_invisible($s);
    if ($s === null) {
        return null;
    }
    $s = hvd_nfc($s);
    $s = preg_replace('/[\x{0020}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{202F}\x{205F}\x{3000}]+/u', ' ', $s);
    if (!is_string($s)) {
        return null;
    }
    // Belt and braces: nothing below this line may contain CR or LF.
    if (strpbrk($s, "\r\n\0") !== false) {
        return null;
    }
    return trim($s, ' ');
}

/**
 * Multi-line value (the message): line breaks normalise to LF, invisible characters go,
 * trailing spaces are trimmed per line and long runs of blank lines are shortened.
 */
function hvd_clean_text(string $s): ?string
{
    if (!hvd_is_utf8($s)) {
        return null;
    }
    $s = str_replace(["\r\n", "\r", "\u{2028}", "\u{2029}", "\u{0085}"], "\n", $s);
    $s = hvd_strip_invisible($s);
    if ($s === null) {
        return null;
    }
    $s = hvd_nfc($s);
    $s = preg_replace('/[ \t\x{00A0}]+$/mu', '', $s);
    if (!is_string($s)) {
        return null;
    }
    $s = preg_replace("/\n{3,}/", "\n\n", $s);
    if (!is_string($s) || strpbrk($s, "\r\0") !== false) {
        return null;
    }
    return trim($s);
}

/**
 * Strict email check. Deliberately narrower than RFC 5322: a dot-atom local part from a
 * conservative character set (no quotes, backslashes, spaces, '=' or '?') and an ASCII or
 * punycode domain. The result is safe to place, alone, in a Reply-To header.
 * PHP's FILTER_VALIDATE_EMAIL must also accept it (it alone would allow quoted local
 * parts that can carry CR/LF through backslash escapes).
 */
function hvd_valid_email(string $e): bool
{
    if ($e === '' || strlen($e) > 254) {
        return false;
    }
    $re = '/\A[A-Za-z0-9_%+\'-]+(?:\.[A-Za-z0-9_%+\'-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})\z/';
    if (preg_match($re, $e) !== 1) {
        return false;
    }
    $at = strrpos($e, '@');
    if ($at === false || $at > 64) {
        return false;
    }
    return filter_var($e, FILTER_VALIDATE_EMAIL) !== false;
}

/** Same rule as the form's pattern="[0-9+()\s.\-]{6,24}", plus at least 6 digits. */
function hvd_valid_phone(string $p): bool
{
    if (preg_match('/\A[0-9+(). \-]{6,24}\z/', $p) !== 1) {
        return false;
    }
    return preg_match_all('/[0-9]/', $p) >= 6;
}

function hvd_count_links(string $s): int
{
    $n = preg_match_all('~(?:\bhttps?://|\bwww\.)~i', $s);
    return $n === false ? 0 : (int) $n;
}

function hvd_b64url(string $bin): string
{
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

/** True for a non-associative array with keys 0..n-1 in order. */
function hvd_is_list(array $a): bool
{
    $i = 0;
    foreach ($a as $k => $unused) {
        if ($k !== $i) {
            return false;
        }
        $i++;
    }
    return true;
}

/**
 * Make an arbitrary string safe for a single log field: no ASCII or C1 control characters
 * (U+0085 NEL counts as a line break in some viewers), no U+2028/U+2029, no bidi overrides
 * or invisible characters that could disguise a log line.
 */
function hvd_log_str(string $s, int $max = 160): string
{
    if (!hvd_is_utf8($s)) {
        $s = (string) preg_replace('/[^\x20-\x7E]/', '?', $s);
    } else {
        $s = (string) preg_replace('/[\t\n\r\x{0085}\x{2028}\x{2029}]/u', ' ', $s);
        $stripped = hvd_strip_invisible($s);
        $s = $stripped === null ? (string) preg_replace('/[^\x20-\x7E]/', '?', $s) : $stripped;
    }
    $s = (string) preg_replace('/[\x00-\x1F\x7F]/', ' ', $s);
    return hvd_truncate($s, $max);
}
