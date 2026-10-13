<?php
/**
 * HV Discover form API: form definitions, validation and the email text.
 *
 * Field names, required rules and messages mirror the site's forms
 * (request-a-quote and contact mockups, assets/js/forms.js, quote.js).
 * Length limits are server-side only; the site should add matching maxlength attributes.
 */
declare(strict_types=1);

if (!defined('HVD_API')) {
    http_response_code(404);
    exit;
}

/**
 * The only models a quote can name (quote.js CATALOG ids), with their descriptions.
 * The quote list holds at most this many items. The cable test van is not quotable.
 */
const HVD_PRODUCTS = [
    'TDR-901' => 'Time domain reflectometer',
    'ARM Filter' => 'Arc reflection filter',
    'PG-10' => 'Surge generator, 10 kV',
    'PG-32' => 'Surge generator, 30 kV',
    'AP-01' => 'Acoustic pinpointer',
    'CRT-015' => 'Cable route tracer',
];
const HVD_QTY_MAX = 99;

const HVD_MSG_EMAIL_INVALID = 'Enter an email address in the form name@company.com.';
const HVD_MSG_UNREADABLE = 'This field contains characters we cannot read. Retype it and try again.';
const HVD_MSG_ITEMS_UNREADABLE = 'Your quote list could not be read. Remove the products and add them again.';
const HVD_MSG_ITEMS_UNKNOWN = 'One of the products in your list is not in our catalog. Remove it and try again.';
const HVD_MSG_ITEMS_QTY = 'Set each quantity to a whole number from 1 to 99.';
const HVD_MSG_NEED_ITEMS_OR_MESSAGE = 'Add a product to the list, or tell us here what you need.';

function hvd_schema(string $form): array
{
    $dontKnow = "I don\u{2019}t know";
    if ($form === 'quote') {
        return [
            'items' => true,
            'fields' => [
                'name' => [
                    'type' => 'text', 'label' => 'Name', 'required' => true, 'max' => 100, 'nolinks' => true,
                    'autocomplete' => 'name',
                    'msg_required' => 'Enter your name, so we know who to reply to.',
                ],
                'company' => [
                    'type' => 'text', 'label' => 'Company or utility', 'required' => true, 'max' => 150, 'nolinks' => true,
                    'autocomplete' => 'organization',
                    'msg_required' => 'Enter your company or utility, so we can prepare the offer in its name.',
                ],
                'country' => [
                    'type' => 'text', 'label' => 'Country', 'required' => true, 'min' => 2, 'max' => 80, 'nolinks' => true,
                    'autocomplete' => 'country-name',
                    'msg_required' => 'Enter the country where the equipment will be used. It decides delivery and power options.',
                ],
                'email' => [
                    'type' => 'email', 'label' => 'Email', 'required' => true, 'max' => 254,
                    'autocomplete' => 'email',
                    'msg_required' => 'Enter your email address. The quote is sent there.',
                    'msg_invalid' => HVD_MSG_EMAIL_INVALID,
                ],
                'phone' => [
                    'type' => 'tel', 'label' => 'Phone', 'required' => false, 'max' => 24,
                    'autocomplete' => 'tel',
                    'msg_invalid' => 'Enter a phone number using digits, spaces and + ( ) - only, including the country code.',
                ],
                'voltage' => [
                    'type' => 'select', 'label' => 'Cable voltage', 'required' => false, 'max' => 40,
                    'placeholder' => 'Choose a voltage',
                    'options' => [
                        'Low voltage, up to 1 kV' => 'Low voltage, up to 1 kV',
                        '6 to 11 kV' => '6 to 11 kV',
                        '20 kV' => '20 kV',
                        '33 to 36 kV' => '33 to 36 kV',
                        'Above 36 kV' => 'Above 36 kV',
                        'unknown' => $dontKnow,
                    ],
                    'aliases' => [$dontKnow => 'unknown', "I don't know" => 'unknown'],
                    'msg_invalid' => 'Choose a voltage from the list.',
                ],
                'length' => [
                    'type' => 'select', 'label' => 'Approximate length', 'required' => false, 'max' => 40,
                    'placeholder' => 'Choose a length',
                    'options' => [
                        'Under 500 m' => 'Under 500 m',
                        '500 m to 2 km' => '500 m to 2 km',
                        '2 to 5 km' => '2 to 5 km',
                        '5 to 20 km' => '5 to 20 km',
                        'Over 20 km' => 'Over 20 km',
                        'unknown' => $dontKnow,
                    ],
                    'aliases' => [$dontKnow => 'unknown', "I don't know" => 'unknown'],
                    'msg_invalid' => 'Choose a length from the list.',
                ],
                'message' => [
                    'type' => 'textarea', 'label' => 'Message', 'required' => false, 'max' => 5000, 'maxlinks' => 5,
                    'hint' => 'Fault types you see, cable type, training needs. Required only if your quote list is empty.',
                ],
            ],
        ];
    }
    if ($form === 'contact') {
        return [
            'items' => false,
            'fields' => [
                'name' => [
                    'type' => 'text', 'label' => 'Name', 'required' => true, 'max' => 100, 'nolinks' => true,
                    'autocomplete' => 'name',
                    'msg_required' => 'Enter your name, so we know who to reply to.',
                ],
                'email' => [
                    'type' => 'email', 'label' => 'Email', 'required' => true, 'max' => 254,
                    'autocomplete' => 'email',
                    'msg_required' => 'Enter your email address. Our reply goes there.',
                    'msg_invalid' => HVD_MSG_EMAIL_INVALID,
                ],
                'company' => [
                    'type' => 'text', 'label' => 'Company', 'required' => false, 'max' => 150, 'nolinks' => true,
                    'autocomplete' => 'organization',
                ],
                'message' => [
                    'type' => 'textarea', 'label' => 'Message', 'required' => true, 'max' => 5000, 'maxlinks' => 5,
                    'msg_required' => 'Write your question. For a fault, give the cable type, its length and what you see.',
                    'hint' => 'For a fault: cable type, length, and what the instruments show.',
                ],
            ],
        ];
    }
    throw new InvalidArgumentException('unknown form');
}

/**
 * Validate a submission. Returns [values, errors]; errors maps field name => message
 * ("items" for the quote list). Values are cleaned and canonical even when invalid,
 * so the no-JavaScript review page can show them again.
 */
function hvd_validate(string $form, array $data): array
{
    $schema = hvd_schema($form);
    $values = [];
    $errors = [];

    foreach ($schema['fields'] as $name => $f) {
        $values[$name] = '';
        // Formatted fields (email, phone, lists) report length problems with their own
        // "invalid" message, as the browser check does (type=email, pattern="...{6,24}").
        $tooLong = in_array($f['type'], ['email', 'tel', 'select'], true)
            ? $f['msg_invalid']
            : sprintf('Use %d characters or fewer.', $f['max']);
        $raw = $data[$name] ?? null;
        if ($raw === null) {
            $raw = '';
        } elseif (is_int($raw)) {
            $raw = (string) $raw;
        } elseif (!is_string($raw)) {
            $errors[$name] = $f['msg_invalid'] ?? 'Check this field.';
            continue;
        }
        // Cheap cap before any regex work: 4 bytes per character is the UTF-8 maximum.
        if (strlen($raw) > 4 * $f['max'] + 64) {
            $errors[$name] = $tooLong;
            continue;
        }
        $clean = $f['type'] === 'textarea' ? hvd_clean_text($raw) : hvd_clean_line($raw);
        if ($clean === null) {
            $errors[$name] = HVD_MSG_UNREADABLE;
            continue;
        }
        $values[$name] = $clean;
        if ($clean === '') {
            if ($f['required']) {
                $errors[$name] = $f['msg_required'];
            }
            continue;
        }
        $len = hvd_strlen($clean);
        if ($len > $f['max']) {
            $errors[$name] = $tooLong;
            continue;
        }
        if (isset($f['min']) && $len < $f['min']) {
            $errors[$name] = sprintf('Use at least %d characters.', $f['min']);
            continue;
        }
        switch ($f['type']) {
            case 'email':
                if (!hvd_valid_email($clean)) {
                    $errors[$name] = $f['msg_invalid'];
                }
                break;
            case 'tel':
                if (!hvd_valid_phone($clean)) {
                    $errors[$name] = $f['msg_invalid'];
                }
                break;
            case 'select':
                $canon = null;
                if (array_key_exists($clean, $f['options'])) {
                    $canon = $clean;
                } elseif (isset($f['aliases'][$clean])) {
                    $canon = $f['aliases'][$clean];
                }
                if ($canon === null) {
                    $errors[$name] = $f['msg_invalid'];
                    $values[$name] = '';
                } else {
                    $values[$name] = (string) $canon;
                }
                break;
        }
        if (isset($errors[$name])) {
            continue;
        }
        if (!empty($f['nolinks']) && (strpos($clean, '://') !== false || stripos($clean, 'www.') !== false)) {
            $errors[$name] = 'Remove the web address from this field.';
        } elseif (!empty($f['maxlinks']) && hvd_count_links($clean) > $f['maxlinks']) {
            $errors[$name] = sprintf('Use at most %d links in your message.', $f['maxlinks']);
        }
    }

    if ($schema['items']) {
        $items = hvd_validate_items($data['items'] ?? null);
        $values['items'] = $items[0];
        if ($items[1] !== '') {
            $errors['items'] = $items[1];
        } elseif (!$items[0] && $values['message'] === '' && !isset($errors['message'])) {
            $errors['message'] = HVD_MSG_NEED_ITEMS_OR_MESSAGE;
        }
    }
    return [$values, $errors];
}

/** @return array{0: array<int, array{model: string, qty: int}>, 1: string} */
function hvd_validate_items($raw): array
{
    if ($raw === null || $raw === '') {
        return [[], ''];
    }
    if (!is_array($raw) || count($raw) > count(HVD_PRODUCTS)) {
        return [[], HVD_MSG_ITEMS_UNREADABLE];
    }
    ksort($raw); // form posts may arrive as items[1], items[0]
    $items = [];
    $seen = [];
    foreach ($raw as $k => $it) {
        if (!is_int($k) || !is_array($it)) {
            return [[], HVD_MSG_ITEMS_UNREADABLE];
        }
        $model = $it['model'] ?? ($it['id'] ?? null);
        if (!is_string($model) || !array_key_exists($model, HVD_PRODUCTS)) {
            return [[], HVD_MSG_ITEMS_UNKNOWN];
        }
        $qty = hvd_parse_qty($it['qty'] ?? null);
        if ($qty === null) {
            return [[], HVD_MSG_ITEMS_QTY];
        }
        if (isset($seen[$model])) {
            return [[], HVD_MSG_ITEMS_UNREADABLE];
        }
        $seen[$model] = true;
        $items[] = ['model' => $model, 'qty' => $qty];
    }
    return [$items, ''];
}

function hvd_parse_qty($q): ?int
{
    if (is_int($q)) {
        return ($q >= 1 && $q <= HVD_QTY_MAX) ? $q : null;
    }
    if (is_string($q) && preg_match('/\A[1-9][0-9]?\z/', $q) === 1) {
        return (int) $q;
    }
    return null;
}

/** Server-generated reference: HVD-<year>-<6 chars>, 32^6 (about 10^9) values from a CSPRNG. */
function hvd_reference(): string
{
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
    $s = '';
    for ($i = 0; $i < 6; $i++) {
        $s .= $alphabet[random_int(0, 31)];
    }
    return 'HVD-' . date('Y') . '-' . $s;
}

/** Keyed fingerprint of everything that was submitted, for duplicate suppression. */
function hvd_fingerprint(array $cfg, string $form, array $values): string
{
    $v = $values;
    if (isset($v['email'])) {
        $v['email'] = strtolower($v['email']);
    }
    ksort($v);
    $canon = json_encode([$form, $v], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    return hash_hmac('sha256', is_string($canon) ? $canon : serialize($v), hvd_subkey($cfg, 'duplicate'));
}

function hvd_select_label(string $form, string $field, string $value): string
{
    $f = hvd_schema($form)['fields'][$field];
    return $value === '' ? '' : (string) ($f['options'][$value] ?? '');
}

/** Subject line: built only from server-side values (reference, whitelisted model names). */
function hvd_mail_subject(string $form, string $ref, array $values): string
{
    if ($form === 'contact') {
        return 'Website message ' . $ref;
    }
    $models = array_map(static function (array $it): string {
        return $it['model'];
    }, $values['items'] ?? []);
    if (!$models) {
        return 'Quote request ' . $ref . ' (no products listed)';
    }
    $shown = array_slice($models, 0, 3);
    $more = count($models) - count($shown);
    return 'Quote request ' . $ref . ' (' . implode(', ', $shown) . ($more > 0 ? ' +' . $more . ' more' : '') . ')';
}

/**
 * The email body, plain text. Visitor text only ever appears after a label or, for the
 * message, as quoted lines ("> "), so it cannot imitate the structure of the email.
 */
function hvd_mail_text(array $cfg, string $form, string $ref, array $v): string
{
    $L = [];
    $pad = static function (string $label): string {
        return str_pad($label . ':', 12);
    };
    $L[] = $form === 'quote' ? 'New quote request from the website.' : 'New message from the website contact form.';
    $L[] = '';
    $L[] = $pad('Reference') . $ref;
    $L[] = $pad('Received') . date('Y-m-d H:i') . ' (' . date_default_timezone_get() . ', UTC' . date('P') . ')';
    $L[] = '';

    if ($form === 'quote') {
        $L[] = 'PRODUCTS';
        if (!$v['items']) {
            $L[] = '  None listed. See the message.';
        }
        foreach ($v['items'] as $it) {
            $L[] = sprintf('  %2d x %s (%s)', $it['qty'], $it['model'], HVD_PRODUCTS[$it['model']]);
        }
        $L[] = '';
    }

    $L[] = 'CUSTOMER';
    $L[] = $pad('Name') . $v['name'];
    if ($form === 'quote') {
        $L[] = $pad('Company') . $v['company'];
        $L[] = $pad('Country') . $v['country'];
    } elseif ($v['company'] !== '') {
        $L[] = $pad('Company') . $v['company'];
    }
    $L[] = $pad('Email') . $v['email'];
    if ($form === 'quote' && $v['phone'] !== '') {
        $L[] = $pad('Phone') . $v['phone'];
    }
    $L[] = '';

    if ($form === 'quote') {
        $volt = hvd_select_label('quote', 'voltage', $v['voltage']);
        $len = hvd_select_label('quote', 'length', $v['length']);
        $L[] = 'CABLE';
        $L[] = $pad('Voltage') . ($volt !== '' ? $volt : '(not given)');
        $L[] = $pad('Length') . ($len !== '' ? $len : '(not given)');
        $L[] = '';
    }

    $L[] = 'MESSAGE';
    if ($v['message'] === '') {
        $L[] = '  (no message)';
    } else {
        foreach (explode("\n", $v['message']) as $line) {
            $L[] = '> ' . $line;
        }
    }
    $L[] = '';
    $L[] = '-- ';
    $page = $cfg['site_url'] . $cfg['form_pages'][$form];
    $L[] = 'Sent by the form at ' . $page;
    $L[] = 'Reply to this email to answer the sender: Reply-To is their address.';
    $L[] = 'Everything above was typed by the visitor and is not verified. Be careful with links.';
    return implode("\n", $L) . "\n";
}
