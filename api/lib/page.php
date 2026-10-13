<?php
/**
 * HV Discover form API: HTML pages for browsers without JavaScript.
 *
 * A plain form post without a valid token (JavaScript off, or the page was open for hours)
 * gets a "check and send" page: the same fields, pre-filled, with inline errors and a fresh
 * token. Sending that page completes the request. Every value is escaped with hvd_h();
 * the CSP allows no script at all and only the one inline stylesheet (by hash).
 */
declare(strict_types=1);

if (!defined('HVD_API')) {
    http_response_code(404);
    exit;
}

function hvd_page_css(): string
{
    return ':root{color-scheme:light;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1d2125;background:#f4f5f6}'
        . 'body{margin:0;padding:24px 16px;line-height:1.5}'
        . 'main{max-width:640px;margin:0 auto;background:#fff;border:1px solid #d5d9dd;border-radius:6px;padding:24px}'
        . 'h1{font-size:1.5rem;line-height:1.25;margin:0 0 8px}'
        . 'p{margin:0 0 12px}'
        . '.lead{color:#465057}'
        . '.alert,.notice{padding:10px 12px;margin:0 0 16px;border-left:4px solid}'
        . '.alert{border-color:#b42318;background:#fef3f2}'
        . '.notice{border-color:#1d2125;background:#f2f4f5}'
        . 'fieldset{border:0;margin:0;padding:0}'
        . 'label,.lg{display:block;font-weight:600;margin:16px 0 4px;padding:0}'
        . '.opt{font-weight:400;color:#5b646b}'
        . 'input,select,textarea{box-sizing:border-box;width:100%;font:inherit;padding:8px 10px;border:1px solid #858e96;border-radius:4px;background:#fff;color:inherit}'
        . 'textarea{min-height:9em;resize:vertical}'
        . '[aria-invalid=true]{border-color:#b42318;border-width:2px}'
        . '.hint{margin:4px 0 0;color:#5b646b;font-size:.94rem}'
        . '.err{margin:4px 0 0;color:#b42318;font-size:.94rem;font-weight:600}'
        . '.items{margin:4px 0 0;padding-left:20px}'
        . 'button{margin-top:20px;font:inherit;font-weight:600;padding:10px 18px;border:0;border-radius:4px;background:#1d2125;color:#fff;cursor:pointer}'
        . 'button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid #f55231;outline-offset:2px}'
        . '.hp{display:none!important}'
        . '.foot{margin-top:20px;font-size:.94rem}'
        . 'a{color:#a3301a}';
}

function hvd_page(int $status, string $title, string $inner, array $headers = []): void
{
    $css = hvd_page_css();
    $hash = 'sha256-' . base64_encode(hash('sha256', $css, true));
    $html = "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        . "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        . "<meta name=\"robots\" content=\"noindex\">\n"
        . '<title>' . hvd_h($title) . " | HV Discover</title>\n"
        . '<style>' . $css . "</style>\n</head>\n<body>\n<main id=\"main\">\n"
        . $inner
        . "</main>\n</body>\n</html>\n";
    hvd_respond_html($status, $html, $hash, $headers);
}

/** A form-level message (errors such as 403, 413, 429, 503) with a link back. */
function hvd_render_message_page(int $status, string $message, string $backUrl, array $headers = []): void
{
    $title = $status >= 500 ? 'Please try again later' : 'We could not accept this request';
    $inner = '<h1>' . hvd_h($title) . "</h1>\n"
        . '<p class="lead">' . hvd_h($message) . "</p>\n"
        . '<p class="foot"><a href="' . hvd_h($backUrl) . '">Back to the site</a></p>' . "\n";
    hvd_page($status, $title, $inner, $headers);
}

/**
 * The "check and send" page.
 * @param array $values cleaned values (hvd_validate)
 * @param array $errors field => message
 */
function hvd_render_review(HvdRequest $req, string $form, array $values, array $errors, string $token, string $notice): void
{
    $cfg = $req->cfg;
    $schema = hvd_schema($form);
    $isQuote = $form === 'quote';
    $title = $isQuote ? 'Check your quote request' : 'Check your message';
    $action = hvd_server('SCRIPT_NAME');
    if (!hvd_valid_local_url($action)) {
        $action = '';
    }

    $o = '<h1>' . hvd_h($title) . "</h1>\n";
    if ($errors) {
        $n = count($errors);
        $o .= '<div class="alert" role="alert"><b>Check the form.</b> '
            . hvd_h($n === 1 ? 'One field needs your attention.' : $n . ' fields need your attention.') . "</div>\n";
    } elseif ($notice !== '') {
        $o .= '<div class="notice" role="status">' . hvd_h($notice) . "</div>\n";
    }
    if (isset($errors['form'])) {
        $o .= '<p class="err">' . hvd_h($errors['form']) . "</p>\n";
    }

    $o .= '<form method="post" action="' . hvd_h($action) . '" accept-charset="UTF-8">' . "\n";
    $o .= '<input type="hidden" name="token" value="' . hvd_h($token) . '">' . "\n";
    $o .= '<div class="hp"><label for="hp-website">Leave this field empty</label>'
        . '<input id="hp-website" name="website" type="text" tabindex="-1" autocomplete="off" value=""></div>' . "\n";

    if ($isQuote) {
        $items = $values['items'] ?? [];
        $o .= '<fieldset><legend class="lg">Products</legend>';
        if (isset($errors['items'])) {
            $o .= '<p class="err" id="err-items">' . hvd_h($errors['items']) . '</p>';
        } elseif (!$items) {
            $o .= '<p class="hint">No products listed. Describe what you need in the message.</p>';
        } else {
            $o .= '<ul class="items">';
            foreach ($items as $i => $it) {
                $o .= '<li>' . hvd_h((string) $it['qty']) . ' &times; ' . hvd_h($it['model'])
                    . '<input type="hidden" name="items[' . (int) $i . '][model]" value="' . hvd_h($it['model']) . '">'
                    . '<input type="hidden" name="items[' . (int) $i . '][qty]" value="' . (int) $it['qty'] . '"></li>';
            }
            $o .= '</ul>';
        }
        $o .= "</fieldset>\n";
    }

    foreach ($schema['fields'] as $name => $f) {
        $id = 'f-' . $name;
        $val = (string) ($values[$name] ?? '');
        $err = $errors[$name] ?? '';
        $describedBy = [];
        $o .= '<label for="' . $id . '">' . hvd_h($f['label']);
        if (!$f['required']) {
            $o .= ' <span class="opt">' . ($name === 'message' && $isQuote ? 'required if no products are listed' : 'optional') . '</span>';
        }
        $o .= '</label>';
        $hint = '';
        if (isset($f['hint'])) {
            $hint = '<p class="hint" id="' . $id . '-hint">' . hvd_h($f['hint']) . '</p>';
            $describedBy[] = $id . '-hint';
        }
        $errHtml = '';
        if ($err !== '') {
            $errHtml = '<p class="err" id="' . $id . '-err">' . hvd_h($err) . '</p>';
            $describedBy[] = $id . '-err';
        }
        $attrs = ' id="' . $id . '" name="' . hvd_h($name) . '"';
        if ($f['required']) {
            $attrs .= ' required';
        }
        if ($err !== '') {
            $attrs .= ' aria-invalid="true"';
        }
        if ($describedBy) {
            $attrs .= ' aria-describedby="' . hvd_h(implode(' ', $describedBy)) . '"';
        }
        if (isset($f['autocomplete'])) {
            $attrs .= ' autocomplete="' . hvd_h($f['autocomplete']) . '"';
        }
        if ($f['type'] === 'select') {
            $o .= '<select' . $attrs . '><option value="">' . hvd_h($f['placeholder']) . '</option>';
            foreach ($f['options'] as $optVal => $optLabel) {
                $o .= '<option value="' . hvd_h((string) $optVal) . '"' . ((string) $optVal === $val ? ' selected' : '') . '>'
                    . hvd_h($optLabel) . '</option>';
            }
            $o .= '</select>';
        } elseif ($f['type'] === 'textarea') {
            $o .= '<textarea' . $attrs . ' rows="6" maxlength="' . (int) $f['max'] . '">' . hvd_h($val) . '</textarea>';
        } else {
            $type = $f['type'] === 'email' ? 'email' : ($f['type'] === 'tel' ? 'tel' : 'text');
            $extra = ' maxlength="' . (int) $f['max'] . '"';
            if ($type === 'tel') {
                // Valid both as a "u" and a "v" flag pattern (browsers now compile with "v").
                $extra .= ' pattern="[0-9+\\(\\)\\s.\\-]{6,24}" inputmode="tel"';
            }
            if ($type === 'email') {
                $extra .= ' inputmode="email" spellcheck="false"';
            }
            $o .= '<input type="' . $type . '"' . $attrs . $extra . ' value="' . hvd_h($val) . '">';
        }
        $o .= $hint . $errHtml . "\n";
    }

    $o .= '<button type="submit">' . ($isQuote ? 'Send quote request' : 'Send message') . "</button>\n</form>\n";
    $o .= '<p class="foot">We use these details only to answer you. See the <a href="/privacy">privacy notice</a>. '
        . 'Or <a href="' . hvd_h($cfg['form_pages'][$form]) . '">go back to the site</a>.</p>' . "\n";

    hvd_page($errors ? 422 : 200, $title, $o);
}
