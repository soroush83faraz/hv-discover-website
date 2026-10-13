<?php
/**
 * GET /api/token.php?form=quote|contact: issue a signed timestamp token for one form.
 * Response: {"ok":true,"token":"v1....","min_wait":3,"expires_in":7200}. See CLIENT.md.
 */
declare(strict_types=1);

define('HVD_API', true);
require __DIR__ . '/lib/bootstrap.php';

hvd_handle_token();
