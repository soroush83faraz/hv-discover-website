<?php
/**
 * HV Discover form API: logging.
 *
 * One JSON object per line in <data>/log/forms-YYYY-MM.log. JSON encoding escapes CR/LF,
 * so a visitor cannot forge log lines. What is logged: time, endpoint, event, reason code,
 * failing field NAMES (never values), reference, a keyed hash of the client IP and its
 * network prefix. Never logged: names, emails, phone numbers, messages, tokens, secrets.
 *
 * When the monthly file passes log_max_bytes (a flood), only "important" events
 * (sent, mail failures, global limit, errors) are still written; past 4 x log_max_bytes
 * nothing is, so the disk cannot fill up.
 */
declare(strict_types=1);

if (!defined('HVD_API')) {
    http_response_code(404);
    exit;
}

final class HvdLog
{
    /** @var string|null */
    private static $dir = null;
    /** @var int */
    private static $maxBytes = 5242880;
    /** @var array<string, string> */
    private static $ctx = [];

    public static function init(string $dir, int $maxBytes): void
    {
        self::$dir = $dir;
        self::$maxBytes = $maxBytes;
        ini_set('log_errors', '1');
        ini_set('error_log', $dir . DIRECTORY_SEPARATOR . 'php-errors.log');
    }

    public static function context(array $ctx): void
    {
        self::$ctx = $ctx;
    }

    public static function event(string $event, array $fields = [], bool $important = false): void
    {
        $row = ['t' => date('c')] + self::$ctx + ['ev' => $event];
        foreach ($fields as $k => $v) {
            if (is_string($v)) {
                $row[$k] = hvd_log_str($v);
            } elseif (is_int($v) || is_bool($v) || $v === null) {
                $row[$k] = $v;
            } elseif (is_array($v)) {
                $row[$k] = array_map(static function ($x): string {
                    return hvd_log_str(is_scalar($x) ? (string) $x : gettype($x), 40);
                }, array_slice(array_values($v), 0, 20));
            }
        }
        $flags = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR;
        if (defined('JSON_INVALID_UTF8_SUBSTITUTE')) {
            $flags |= JSON_INVALID_UTF8_SUBSTITUTE;
        }
        $line = json_encode($row, $flags);
        if (!is_string($line)) {
            return;
        }
        if (self::$dir === null) {
            error_log('hvd-forms ' . $line);
            return;
        }
        $file = self::$dir . DIRECTORY_SEPARATOR . 'forms-' . date('Y-m') . '.log';
        clearstatcache(true, $file);
        $size = @filesize($file);
        // Past the limit only important events are kept; past 4x the limit, nothing is.
        if (is_int($size) && ($size > 4 * self::$maxBytes || (!$important && $size > self::$maxBytes))) {
            return;
        }
        @file_put_contents($file, $line . "\n", FILE_APPEND | LOCK_EX);
    }

    public static function dir(): ?string
    {
        return self::$dir;
    }
}

/** PHP warnings and notices: log them (file, line, message), never display them. */
function hvd_on_php_error(int $no, string $str, string $file = '', int $line = 0): bool
{
    if ((error_reporting() & $no) === 0) {
        return false; // silenced with @: let PHP's own (non-displaying) handler deal with it
    }
    HvdLog::event('php_error', [
        'level' => $no,
        'msg' => $str,
        'at' => basename($file) . ':' . $line,
    ]);
    return true;
}

function hvd_on_exception(Throwable $e): void
{
    HvdLog::event('exception', [
        'class' => get_class($e),
        'msg' => $e->getMessage(),
        'at' => basename($e->getFile()) . ':' . $e->getLine(),
    ], true);
    hvd_fail_generic(500);
}

function hvd_on_shutdown(): void
{
    $err = error_get_last();
    if ($err === null || !in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
        return;
    }
    HvdLog::event('fatal', [
        'msg' => (string) $err['message'],
        'at' => basename((string) $err['file']) . ':' . (int) $err['line'],
    ], true);
    if (!headers_sent()) {
        hvd_fail_generic(500);
    }
}
