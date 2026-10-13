<?php
/**
 * HV Discover form API: minimal SMTP client (submission to one configured server).
 *
 * Why not PHPMailer: one fixed recipient, one plain-text message, no attachments.
 * This client is ~250 lines that can be read in full; it needs no Composer, no vendored
 * tree to keep patched, and it has no "send to visitor-supplied address" paths at all.
 *
 * Security properties:
 *   - TLS: secure = 'ssl' (implicit TLS, port 465) or 'tls' (STARTTLS, port 587).
 *     Certificates and host names are always verified; there is no option to turn
 *     verification off. If the server does not offer STARTTLS the send fails
 *     (no silent downgrade to plain text).
 *   - STARTTLS injection (CVE-2011-0411 class): any byte received after the "220" to
 *     STARTTLS and before the handshake aborts the send, so plain text injected on the wire
 *     can never be read later as if it had come through TLS.
 *   - secure = 'none' is accepted only for a server on this machine (settings.php
 *     enforces it), so credentials never cross a network in clear text.
 *   - Time: every blocking step has the per-operation timeout, capped by one overall
 *     deadline (smtp.deadline, default 30 s), so a slow or drip-feeding server cannot hold
 *     the PHP worker.
 *   - The envelope (MAIL FROM / RCPT TO) comes from validated configuration only.
 *   - The message is normalised to CRLF line endings with no bare CR or LF (SMTP smuggling)
 *     and dot-stuffed; the body is base64, so visitor bytes never appear raw on the wire.
 *   - Errors carry the SMTP command verb and reply code only: never credentials or content.
 */
declare(strict_types=1);

if (!defined('HVD_API')) {
    http_response_code(404);
    exit;
}

final class HvdMailError extends RuntimeException
{
}

final class HvdSmtp
{
    /** @var array */
    private $cfg;
    /** @var resource|null */
    private $fp = null;
    /** @var array<string, string[]> */
    private $caps = [];
    /** @var string bytes received but not yet consumed as reply lines */
    private $buf = '';
    /** @var float microtime(true) after which nothing more is attempted */
    private $deadline = 0.0;

    private const MAX_LINE = 4096;

    public function __construct(array $smtpCfg)
    {
        $this->cfg = $smtpCfg;
    }

    /** @param string[] $rcpts */
    public function send(string $from, array $rcpts, string $message, string $heloDomain): void
    {
        $c = $this->cfg;
        $this->deadline = microtime(true) + (int) $c['deadline'];
        $this->buf = '';
        $peer = $c['peer_name'] !== '' ? $c['peer_name'] : $c['host'];
        $ctx = stream_context_create(['ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
            'allow_self_signed' => false,
            'peer_name' => $peer,
            'SNI_enabled' => true,
            'disable_compression' => true,
            'crypto_method' => self::cryptoMethod(),
        ]]);
        $host = filter_var($c['host'], FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) !== false ? '[' . $c['host'] . ']' : $c['host'];
        $remote = ($c['secure'] === 'ssl' ? 'ssl://' : 'tcp://') . $host . ':' . (int) $c['port'];
        if ($c['secure'] !== 'none' && !extension_loaded('openssl')) {
            throw new HvdMailError('smtp: the openssl extension is required for TLS');
        }
        $errno = 0;
        $errstr = '';
        $fp = @stream_socket_client($remote, $errno, $errstr, $this->timeLeft(), STREAM_CLIENT_CONNECT, $ctx);
        if ($fp === false) {
            throw new HvdMailError('smtp: connect failed (' . $errno . ' ' . hvd_log_str($errstr, 80) . ')');
        }
        $this->fp = $fp;
        try {
            $this->expect('greeting', [220]);
            $helo = $c['helo'] !== '' ? $c['helo'] : $heloDomain;
            $this->ehlo($helo);
            if ($c['secure'] === 'tls') {
                if (!isset($this->caps['STARTTLS'])) {
                    throw new HvdMailError('smtp: server does not offer STARTTLS');
                }
                $this->command('STARTTLS', 'STARTTLS', [220]);
                // Nothing may follow the 220 before the handshake. Bytes already here (in our
                // buffer or PHP's) were sent in plain text and would otherwise be read after
                // the handshake as if they were the server's encrypted replies.
                $meta = stream_get_meta_data($fp);
                if ($this->buf !== '' || !empty($meta['unread_bytes'])) {
                    throw new HvdMailError('smtp: unexpected data after the STARTTLS reply (possible injection); not sending');
                }
                $this->applyTimeout();
                $ok = @stream_socket_enable_crypto($fp, true, self::cryptoMethod());
                if ($ok !== true) {
                    throw new HvdMailError('smtp: TLS handshake or certificate verification failed');
                }
                $this->ehlo($helo); // capabilities before TLS are discarded
            }
            if ($c['user'] !== '') {
                $this->auth($c['user'], $c['pass']);
            }
            $this->command('MAIL FROM:<' . $from . '>', 'MAIL', [250]);
            foreach ($rcpts as $r) {
                $this->command('RCPT TO:<' . $r . '>', 'RCPT', [250, 251]);
            }
            $this->command('DATA', 'DATA', [354]);
            $this->write(self::dotStuff(self::crlf($message)) . "\r\n.\r\n");
            $this->expect('DATA end', [250]);
            try {
                $this->command('QUIT', 'QUIT', [221]);
            } catch (HvdMailError $ignored) {
                // the message is accepted; a sloppy QUIT does not matter
            }
        } finally {
            @fclose($fp);
            $this->fp = null;
            $this->buf = '';
        }
    }

    private static function cryptoMethod(): int
    {
        $m = STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT;
        if (defined('STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT')) {
            $m |= STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT;
        }
        return $m;
    }

    /** Any CR, LF or CRLF becomes CRLF: no bare CR or LF reaches the server. */
    public static function crlf(string $s): string
    {
        return (string) preg_replace("/\r\n|\r|\n/", "\r\n", $s);
    }

    /** RFC 5321 4.5.2: a line starting with "." gets one more. */
    public static function dotStuff(string $s): string
    {
        $s = (string) preg_replace('/^\./m', '..', $s);
        return rtrim($s, "\r\n");
    }

    /** Seconds the next blocking step may take: the per-operation timeout, capped by the deadline. */
    private function timeLeft(): float
    {
        $left = $this->deadline - microtime(true);
        if ($left <= 0) {
            throw new HvdMailError('smtp: overall time limit reached');
        }
        return min((float) $this->cfg['timeout'], $left);
    }

    /** Set the socket timeout for the next step; true when the overall deadline is what limits it. */
    private function applyTimeout(): bool
    {
        $t = $this->timeLeft();
        $sec = (int) floor($t);
        stream_set_timeout($this->fp, $sec, (int) (($t - $sec) * 1000000));
        return $t < (float) $this->cfg['timeout'];
    }

    private function timeoutError(bool $byDeadline, string $what): HvdMailError
    {
        return new HvdMailError($byDeadline ? 'smtp: overall time limit reached' : 'smtp: timed out' . $what);
    }

    private function ehlo(string $helo): void
    {
        $lines = $this->command('EHLO ' . $helo, 'EHLO', [250]);
        $this->caps = [];
        foreach (array_slice($lines, 1) as $line) {
            $parts = preg_split('/\s+/', strtoupper(trim($line)));
            if (is_array($parts) && $parts[0] !== '') {
                $this->caps[$parts[0]] = array_slice($parts, 1);
            }
        }
    }

    private function auth(string $user, string $pass): void
    {
        $mechs = $this->caps['AUTH'] ?? [];
        if (in_array('PLAIN', $mechs, true)) {
            $this->command('AUTH PLAIN ' . base64_encode("\0" . $user . "\0" . $pass), 'AUTH PLAIN', [235]);
            return;
        }
        if (in_array('LOGIN', $mechs, true)) {
            $this->command('AUTH LOGIN', 'AUTH LOGIN', [334]);
            $this->command(base64_encode($user), 'AUTH user', [334]);
            $this->command(base64_encode($pass), 'AUTH pass', [235]);
            return;
        }
        throw new HvdMailError('smtp: server offers no PLAIN or LOGIN authentication');
    }

    /**
     * Send one command line and check the reply code.
     * $label is what errors show instead of the line (the line may hold credentials).
     * @return string[] reply lines (text after the code)
     */
    private function command(string $line, string $label, array $okCodes): array
    {
        if (strpbrk($line, "\r\n\0") !== false) {
            throw new HvdMailError('smtp: refusing a command containing a line break');
        }
        $this->write($line . "\r\n");
        return $this->expect($label, $okCodes);
    }

    /** @return string[] */
    private function expect(string $label, array $okCodes): array
    {
        [$code, $lines] = $this->readReply();
        if (!in_array($code, $okCodes, true)) {
            throw new HvdMailError('smtp: ' . $label . ' rejected with ' . $code . ' ' . hvd_log_str((string) ($lines[0] ?? ''), 100));
        }
        return $lines;
    }

    /** @return array{0: int, 1: string[]} */
    private function readReply(): array
    {
        $lines = [];
        for ($i = 0; $i < 100; $i++) {
            $line = $this->readLine();
            if (preg_match('/\A([2-5][0-9]{2})(?:([ -])(.*))?\z/s', $line, $m) !== 1) {
                throw new HvdMailError('smtp: malformed reply');
            }
            $lines[] = $m[3] ?? '';
            if (!isset($m[2]) || $m[2] !== '-') {
                return [(int) $m[1], $lines];
            }
        }
        throw new HvdMailError('smtp: reply too long');
    }

    /** One reply line without its line ending, from our buffer or the socket. */
    private function readLine(): string
    {
        while (true) {
            $nl = strpos($this->buf, "\n");
            if ($nl !== false) {
                $line = substr($this->buf, 0, $nl + 1);
                $this->buf = (string) substr($this->buf, $nl + 1);
                return rtrim($line, "\r\n");
            }
            if (strlen($this->buf) > self::MAX_LINE) {
                throw new HvdMailError('smtp: reply line too long');
            }
            $byDeadline = $this->applyTimeout(); // throws once the overall deadline has passed
            $chunk = @fread($this->fp, 4096);
            if (!is_string($chunk) || $chunk === '') {
                $meta = stream_get_meta_data($this->fp);
                if (!empty($meta['timed_out'])) {
                    throw $this->timeoutError($byDeadline, '');
                }
                if (!empty($meta['eof']) || !is_string($chunk)) {
                    throw new HvdMailError('smtp: connection closed');
                }
                usleep(10000);
                continue;
            }
            $this->buf .= $chunk;
        }
    }

    private function write(string $data): void
    {
        $len = strlen($data);
        $off = 0;
        while ($off < $len) {
            $byDeadline = $this->applyTimeout();
            $n = @fwrite($this->fp, substr($data, $off, 8192));
            if ($n === false || $n === 0) {
                $meta = stream_get_meta_data($this->fp);
                throw !empty($meta['timed_out']) ? $this->timeoutError($byDeadline, ' while writing') : new HvdMailError('smtp: write failed');
            }
            $off += $n;
        }
    }
}
