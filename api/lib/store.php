<?php
/**
 * HV Discover form API: small file-based store (no database needed).
 *
 * <data>/
 *   .htaccess, index.html   deny-all guard (in case data_dir sits inside the web root)
 *   rl/<bucket>-<nn>.json   sliding-window rate limits, sharded into 64 files per bucket so a
 *                           flood from many IPs cannot create thousands of files (inode quota);
 *                           <file>.lock beside each one serialises access
 *   kv/nonce/<hash>         single-use token claims (created with fopen 'x': atomic)
 *   kv/dup/<hash>.json      duplicate-submission records: fingerprint -> reference
 *   log/                    see logger.php
 *   outbox/                 composed emails when mail_transport = 'file' (testing only)
 *
 * Keys are HMACs, so file names reveal nothing about IPs or content.
 * Writes go to a temporary file that replaces the old one only when complete, so a full
 * disk leaves the previous state in place and the request fails (503): limits never reset
 * by accident (fail closed).
 */
declare(strict_types=1);

if (!defined('HVD_API')) {
    http_response_code(404);
    exit;
}

final class HvdStorageError extends RuntimeException
{
}

const HVD_DENY_HTACCESS = "# Private data of the HV Discover form API. Never served.\n"
    . "<IfModule mod_authz_core.c>\n    Require all denied\n</IfModule>\n"
    . "<IfModule !mod_authz_core.c>\n    Order Deny,Allow\n    Deny from all\n</IfModule>\n";

final class HvdStore
{
    /** @var string */
    private $dir;
    /** @var callable|null test seam: fn(string $path, string $data): int|false, default file_put_contents */
    private $writer;

    /** Rate-limit result codes. */
    public const ALLOWED = 0;
    public const BLOCKED_FIRST = 1; // first refusal in this retention window: worth one log line
    public const BLOCKED = 2;

    private const SHARDS = 64;
    private const MAX_KEYS_PER_SHARD = 4000;

    public function __construct(string $dir, ?callable $writer = null)
    {
        $this->dir = rtrim($dir, '/\\');
        $this->writer = $writer;
        $this->ensureDir($this->dir);
        if (!is_file($this->dir . '/.htaccess')) {
            @file_put_contents($this->dir . '/.htaccess', HVD_DENY_HTACCESS);
        }
        if (!is_file($this->dir . '/index.html')) {
            @file_put_contents($this->dir . '/index.html', '');
        }
    }

    public function path(string $sub): string
    {
        $p = $this->dir . '/' . $sub;
        $this->ensureDir($p);
        return $p;
    }

    private function ensureDir(string $dir): void
    {
        // Recursive mkdir can lose a race with another request creating a parent at the same
        // moment (it then gives up before the last level): retry, and accept a dir that exists.
        for ($i = 0; $i < 3; $i++) {
            if (is_dir($dir)) {
                if (!is_writable($dir)) {
                    throw new HvdStorageError('directory not writable: ' . basename($dir));
                }
                return;
            }
            if (@mkdir($dir, 0700, true)) {
                return;
            }
            clearstatcache(true, $dir);
        }
        if (!is_dir($dir)) {
            throw new HvdStorageError('cannot create directory: ' . basename($dir));
        }
    }

    // ------------------------------------------------------------------ rate limits

    private function shardFile(string $bucket, string $key): string
    {
        $shard = hexdec(substr($key, 0, 2)) % self::SHARDS;
        return $this->path('rl') . '/' . $bucket . '-' . sprintf('%02d', $shard) . '.json';
    }

    /** @return resource */
    private function lock(string $file, int $mode)
    {
        $lh = @fopen($file . '.lock', 'c');
        if ($lh === false) {
            throw new HvdStorageError('cannot open lock file for ' . basename($file));
        }
        if (!flock($lh, $mode)) {
            fclose($lh);
            throw new HvdStorageError('cannot lock ' . basename($file));
        }
        return $lh;
    }

    /** @param resource $lh */
    private function unlock($lh): void
    {
        flock($lh, LOCK_UN);
        fclose($lh);
    }

    private function readShard(string $file): array
    {
        clearstatcache(true, $file);
        if (!file_exists($file)) {
            return [];
        }
        if (!is_file($file) || !is_readable($file)) {
            throw new HvdStorageError('rate-limit file unreadable: ' . basename($file));
        }
        $json = @file_get_contents($file);
        if (!is_string($json)) {
            throw new HvdStorageError('cannot read ' . basename($file));
        }
        $data = $json === '' ? [] : json_decode($json, true);
        return is_array($data) ? $data : []; // corrupt (tampered) file: start over
    }

    /** Replace $file with $data atomically; the old content survives any failure. */
    private function writeAtomic(string $file, string $data): void
    {
        $tmp = $file . '.' . bin2hex(random_bytes(6)) . '.tmp';
        $n = $this->writer !== null ? ($this->writer)($tmp, $data) : @file_put_contents($tmp, $data);
        if ($n !== strlen($data)) {
            @unlink($tmp);
            throw new HvdStorageError('cannot write ' . basename($file) . ' (disk full or quota?)');
        }
        if (!@rename($tmp, $file)) {
            @unlink($tmp);
            throw new HvdStorageError('cannot replace ' . basename($file));
        }
    }

    /** Count of $hits newer than $window seconds. */
    public static function countSince(array $hits, int $window, int $now): int
    {
        $n = 0;
        foreach ($hits as $t) {
            if (is_int($t) && $t > $now - $window) {
                $n++;
            }
        }
        return $n;
    }

    /** True when one more hit is within every [limit, window] rule. */
    public static function allows(array $hits, array $rules, int $now): bool
    {
        foreach ($rules as $rule) {
            if (self::countSince($hits, (int) $rule[1], $now) >= (int) $rule[0]) {
                return false;
            }
        }
        return true;
    }

    /**
     * The recorded hit times of $key (read-only, shared lock). $retain must be the same
     * value every caller of this bucket uses (the longest window of its rules).
     * @return int[]
     */
    public function hits(string $bucket, string $key, int $retain): array
    {
        $file = $this->shardFile($bucket, $key);
        $lh = $this->lock($file, LOCK_SH);
        try {
            $data = $this->readShard($file);
        } finally {
            $this->unlock($lh);
        }
        $now = time();
        $h = isset($data[$key]['h']) && is_array($data[$key]['h']) ? $data[$key]['h'] : [];
        return array_values(array_filter($h, static function ($t) use ($now, $retain): bool {
            return is_int($t) && $t > $now - $retain;
        }));
    }

    /**
     * Record a hit for $key if every rule [limit, window] (window <= $retain) still allows
     * one more; atomic for the shard. Returns ALLOWED, BLOCKED_FIRST or BLOCKED.
     */
    public function hit(string $bucket, string $key, int $retain, array $rules): int
    {
        $file = $this->shardFile($bucket, $key);
        $now = time();
        $lh = $this->lock($file, LOCK_EX);
        try {
            $data = $this->readShard($file);
            // Prune everything older than the retention (all keys in this file share it).
            foreach ($data as $k => $entry) {
                $h = isset($entry['h']) && is_array($entry['h']) ? $entry['h'] : [];
                $h = array_values(array_filter($h, static function ($t) use ($now, $retain): bool {
                    return is_int($t) && $t > $now - $retain;
                }));
                $b = isset($entry['b']) && is_int($entry['b']) && $entry['b'] > $now - $retain ? $entry['b'] : 0;
                if (!$h && $b === 0) {
                    unset($data[$k]);
                } else {
                    $data[$k] = ['h' => $h, 'b' => $b];
                }
            }
            $entry = $data[$key] ?? ['h' => [], 'b' => 0];
            if (self::allows($entry['h'], $rules, $now)) {
                $entry['h'][] = $now;
                $result = self::ALLOWED;
            } elseif ($entry['b'] === 0) {
                $entry['b'] = $now;
                $result = self::BLOCKED_FIRST;
            } else {
                $result = self::BLOCKED;
            }
            $data[$key] = $entry;
            if (count($data) > self::MAX_KEYS_PER_SHARD) {
                // Under a very wide flood keep the most recent keys only.
                uasort($data, static function (array $a, array $b): int {
                    return (int) max($b['h'] ?: [0]) <=> (int) max($a['h'] ?: [0]);
                });
                $data = array_slice($data, 0, self::MAX_KEYS_PER_SHARD, true);
            }
            $out = json_encode($data, JSON_UNESCAPED_SLASHES);
            if (!is_string($out)) {
                throw new HvdStorageError('cannot encode rate-limit data');
            }
            $this->writeAtomic($file, $out);
            return $result;
        } finally {
            $this->unlock($lh);
        }
    }

    // ------------------------------------------------------------------ claims and records

    private function kvPath(string $ns, string $key, string $ext = ''): string
    {
        return $this->path('kv/' . $ns) . '/' . hash('sha256', $key) . $ext;
    }

    /**
     * Atomically claim $key for $ttl seconds. True only for the first caller;
     * a concurrent or repeated claim gets false (single-use tokens).
     */
    public function claim(string $ns, string $key, int $ttl): bool
    {
        $file = $this->kvPath($ns, $key);
        $fh = @fopen($file, 'x');
        if ($fh === false) {
            clearstatcache(true, $file);
            if (!file_exists($file)) {
                // Removed in between (released, or swept): try once more, then give up.
                $fh = @fopen($file, 'x');
                if ($fh === false) {
                    clearstatcache(true, $file);
                    if (!file_exists($file)) {
                        throw new HvdStorageError('cannot create claim file');
                    }
                    return false;
                }
            } else {
                $fh = $this->takeOverExpired($ns, $file);
                if ($fh === false) {
                    return false;
                }
            }
        }
        $s = (string) (time() + $ttl);
        $ok = fwrite($fh, $s) === strlen($s) && fflush($fh);
        fclose($fh);
        if (!$ok) {
            @unlink($file);
            throw new HvdStorageError('cannot write claim file (disk full or quota?)');
        }
        return true;
    }

    /**
     * An existing claim file may be expired. Taking it over happens under one lock per
     * namespace (gc() deletes under the same lock), so of several concurrent callers exactly
     * one can delete the expired file and create the new one. (Unreachable for tokens today:
     * a claim outlives the token it belongs to.)
     * @return resource|false
     */
    private function takeOverExpired(string $ns, string $file)
    {
        $lh = $this->lock($this->path('kv/' . $ns) . '/.takeover', LOCK_EX);
        try {
            clearstatcache(true, $file);
            $exp = (int) @file_get_contents($file);
            if ($exp <= 0 || $exp >= time()) {
                return false; // live claim, or one being written right now
            }
            @unlink($file);
            return @fopen($file, 'x'); // false if a lock-free claimer got there first
        } finally {
            $this->unlock($lh);
        }
    }

    public function release(string $ns, string $key): void
    {
        @unlink($this->kvPath($ns, $key));
    }

    public function get(string $ns, string $key): ?string
    {
        $file = $this->kvPath($ns, $key, '.json');
        $raw = @file_get_contents($file);
        if (!is_string($raw) || $raw === '') {
            return null;
        }
        $d = json_decode($raw, true);
        if (!is_array($d) || !isset($d['exp'], $d['v']) || !is_int($d['exp']) || !is_string($d['v'])) {
            return null;
        }
        if ($d['exp'] < time()) {
            @unlink($file);
            return null;
        }
        return $d['v'];
    }

    public function put(string $ns, string $key, string $value, int $ttl): void
    {
        $json = json_encode(['exp' => time() + $ttl, 'v' => $value], JSON_UNESCAPED_SLASHES);
        if (!is_string($json)) {
            throw new HvdStorageError('cannot encode ' . $ns . ' record');
        }
        $this->writeAtomic($this->kvPath($ns, $key, '.json'), $json);
    }

    /** Remove expired records, old logs and old outbox files. Cheap enough to run now and then. */
    public function gc(int $logRetentionDays): void
    {
        $now = time();
        foreach (['nonce', 'dup'] as $ns) {
            $dir = $this->dir . '/kv/' . $ns;
            if (!is_dir($dir)) {
                continue;
            }
            $lh = $ns === 'nonce' ? $this->lock($dir . '/.takeover', LOCK_EX) : null;
            try {
                foreach ((array) @scandir($dir) as $f) {
                    if (!is_string($f) || $f === '' || $f[0] === '.') {
                        continue;
                    }
                    $p = $dir . '/' . $f;
                    $mtime = (int) @filemtime($p);
                    $raw = (string) @file_get_contents($p, false, null, 0, 256);
                    if ($ns === 'nonce') {
                        $exp = (int) $raw;
                    } else {
                        $d = json_decode($raw, true);
                        $exp = is_array($d) && isset($d['exp']) && is_int($d['exp']) ? $d['exp'] : 0;
                    }
                    if (($exp > 0 && $exp < $now) || $mtime < $now - 2 * 86400) {
                        @unlink($p);
                    }
                }
            } finally {
                if ($lh !== null) {
                    $this->unlock($lh);
                }
            }
        }
        $sweep = [
            'log' => $logRetentionDays * 86400,
            'outbox' => 30 * 86400,
            'rl' => 2 * 86400, // only stray .tmp files from a crash; shards are rewritten constantly
        ];
        foreach ($sweep as $sub => $age) {
            $dir = $this->dir . '/' . $sub;
            if (!is_dir($dir)) {
                continue;
            }
            foreach ((array) @scandir($dir) as $f) {
                if (!is_string($f) || $f === '.' || $f === '..') {
                    continue;
                }
                if ($sub === 'rl' && substr($f, -4) !== '.tmp') {
                    continue;
                }
                $p = $dir . '/' . $f;
                if (is_file($p) && (int) @filemtime($p) < $now - $age) {
                    @unlink($p);
                }
            }
        }
    }
}

function hvd_data_dir(array $cfg): string
{
    if ($cfg['data_dir'] !== '') {
        return $cfg['data_dir'];
    }
    $private = dirname(HVD_API_DIR, 2) . DIRECTORY_SEPARATOR . 'hvd-private';
    if (@is_dir($private) && @is_writable($private)) {
        return $private . DIRECTORY_SEPARATOR . 'data';
    }
    return HVD_API_DIR . DIRECTORY_SEPARATOR . 'data';
}
