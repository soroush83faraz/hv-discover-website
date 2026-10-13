<?php
/**
 * HV Discover form API: compose and send the notification email.
 *
 * Headers hold server-side values only (configured addresses, fixed subject text with the
 * server-generated reference and whitelisted model names), plus Reply-To: the visitor's
 * address after hvd_valid_email(). Every header value is checked once more for CR/LF/NUL
 * right before sending. The body is plain text (never HTML), UTF-8, base64-encoded.
 *
 * Nothing is ever sent to the visitor: no auto-reply, no copy. The form cannot be used to
 * mail arbitrary addresses.
 *
 * Transports (config mail_transport):
 *   auto  SMTP when smtp.host is set, otherwise mail()
 *   smtp  authenticated submission, see smtp.php
 *   mail  PHP mail() with the envelope sender set via -f
 *   file  write the composed message to <data>/outbox/*.eml instead of sending (tests only)
 */
declare(strict_types=1);

if (!defined('HVD_API')) {
    http_response_code(404);
    exit;
}

function hvd_header_value(string $v): string
{
    if (strpbrk($v, "\r\n\0") !== false || strlen($v) > 900) {
        throw new HvdMailError('refusing an unsafe header value');
    }
    return $v;
}

/** RFC 2047 encoded-word for non-ASCII text; plain ASCII passes through. */
function hvd_encode_header_text(string $s): string
{
    if (preg_match('/\A[\x20-\x7E]*\z/', $s) === 1) {
        return $s;
    }
    return '=?UTF-8?B?' . base64_encode($s) . '?=';
}

function hvd_format_from(array $cfg): string
{
    $name = $cfg['mail_from_name'];
    if ($name === '') {
        return $cfg['mail_from'];
    }
    return '"' . addcslashes($name, "\"\\") . '" <' . $cfg['mail_from'] . '>';
}

/**
 * @return string the transport that sent the message
 * @throws HvdMailError
 */
function hvd_send_mail(array $cfg, HvdStore $store, string $form, string $ref, string $subject, string $text, string $replyTo): string
{
    $transport = $cfg['mail_transport'];
    if ($transport === 'auto') {
        $transport = $cfg['smtp']['host'] !== '' ? 'smtp' : 'mail';
    }
    $domain = substr((string) strrchr($cfg['mail_from'], '@'), 1);
    $to = implode(', ', $cfg['mail_to']);

    $headers = [
        'Date' => date('r'),
        'From' => hvd_format_from($cfg),
        'To' => $to,
        'Reply-To' => $replyTo,
        'Subject' => hvd_encode_header_text($subject),
        'Message-ID' => '<' . gmdate('YmdHis') . '.' . bin2hex(random_bytes(8)) . '@' . $domain . '>',
        'MIME-Version' => '1.0',
        'Content-Type' => 'text/plain; charset=UTF-8',
        'Content-Transfer-Encoding' => 'base64',
        'X-HVD-Form' => $form,
        'X-HVD-Reference' => $ref,
    ];
    if ($replyTo === '' || !hvd_valid_email($replyTo)) {
        unset($headers['Reply-To']);
    }
    foreach ($headers as $k => $v) {
        $headers[$k] = hvd_header_value($v);
    }

    if ($transport === 'mail') {
        $eol = $cfg['mail_eol'];
        $subjectHeader = $headers['Subject'];
        unset($headers['To'], $headers['Subject']); // mail() adds these from its own arguments
        $lines = [];
        foreach ($headers as $k => $v) {
            $lines[] = $k . ': ' . $v;
        }
        $body = chunk_split(base64_encode($text), 76, $eol);
        $ok = @mail($to, $subjectHeader, $body, implode($eol, $lines), '-f' . $cfg['mail_envelope_from']);
        if ($ok !== true) {
            throw new HvdMailError('mail() returned false');
        }
        return 'mail';
    }

    $lines = [];
    foreach ($headers as $k => $v) {
        $lines[] = $k . ': ' . $v;
    }
    $message = implode("\r\n", $lines) . "\r\n\r\n" . chunk_split(base64_encode($text), 76, "\r\n");

    if ($transport === 'file') {
        $file = $store->path('outbox') . '/' . gmdate('Ymd-His') . '-' . $ref . '.eml';
        if (@file_put_contents($file, $message, LOCK_EX) === false) {
            throw new HvdMailError('cannot write outbox file');
        }
        return 'file';
    }

    $smtp = new HvdSmtp($cfg['smtp']);
    $smtp->send($cfg['mail_envelope_from'], $cfg['mail_to'], $message, $domain);
    return 'smtp';
}
