#!/usr/bin/env bash
# Checks the live site right after a deploy, against the build that was uploaded. Called by
# .github/workflows/deploy.yml in its own job, which has no secrets. Read-only GET requests with
# plain, harmless URLs (the host's web application firewall answers 406 to hostile-looking ones).
#
#   smoke.sh DIST
#
#   https://hvdiscover.com/             200, no redirect; body byte-identical to DIST/index.html
#                                       (sha256); exactly the Content-Security-Policy of
#                                       DIST/.htaccess; the other security headers; no X-Robots-Tag
#   http://hvdiscover.com/              redirected (followed, at most 5 hops) to https://hvdiscover.com/, 200
#   http://www.hvdiscover.com/products  ends at https://hvdiscover.com/products, 200 (the host sends
#                                       http://www. to https://www. first, then .htaccess to the apex)
#   /products                           200, identical to products.html; /products/ -> 301 -> /products
#   /products/pg-32-surge-generator, /datasheets/pg-32.pdf    200, identical (when in the build)
#   /wp-login.php, /xmlrpc.php          404, no redirect;   /?attachment_id=8   410
#   /api/token.php?form=quote           200 JSON with a token; 503 = WARNING (private config not set)
#   GET /api/quote.php                  405
#   /.htaccess, /.deploy-version, /api/, /api/lib/bootstrap.php, /api/config.php
#                                       refused: 403, 404 or 406 (the firewall answers 406)
# The home page and its CSP are retried (SMOKE_ATTEMPTS x SMOKE_DELAY s) for caches to catch up;
# an API 500 is retried up to SMOKE_API_WAIT s (PHP caches the old .user.ini for up to 5 minutes).
# curl never uses a proxy (--noproxy '*'): the check must see the host itself.
# Writes a table and the rollback instruction to $GITHUB_STEP_SUMMARY. Exit 1 on any failure.
set -euo pipefail
export LC_ALL=C

readonly SITE="https://hvdiscover.com"
readonly HTTP_SITE="http://hvdiscover.com"
readonly HTTP_WWW="http://www.hvdiscover.com"
readonly UA="hvd-deploy-check/1.0 (+GitHub Actions deploy check by the site owner)"

DIST=${1:?usage: smoke.sh DIST}
ATTEMPTS=${SMOKE_ATTEMPTS:-6}
DELAY=${SMOKE_DELAY:-10}
API_WAIT=${SMOKE_API_WAIT:-360}
API_POLL=${SMOKE_API_POLL:-30}
for v in ATTEMPTS DELAY API_WAIT API_POLL; do
  [[ ${!v} =~ ^[0-9]{1,4}$ ]] || { echo "::error title=Bad setting::$v must be a whole number"; exit 2; }
done
(( ATTEMPTS >= 1 )) || ATTEMPTS=1
for f in index.html .htaccess; do
  [[ -f $DIST/$f ]] || { echo "::error title=No build::$DIST/$f not found"; exit 2; }
done
COMMIT=${DEPLOY_COMMIT:-}; [[ $COMMIT =~ ^[0-9a-f]{40}$ ]] || COMMIT=unknown
PREVIOUS=${PREVIOUS_COMMIT:-}; [[ $PREVIOUS =~ ^[0-9a-f]{40}$ ]] || PREVIOUS=""
UPLOADED=${UPLOADED_FILES:-}; [[ $UPLOADED =~ ^[0-9]+$ ]] || UPLOADED="?"
DELETED=${DELETED_FILES:-}; [[ $DELETED =~ ^[0-9]+$ ]] || DELETED="?"

T=$(mktemp -d "${RUNNER_TEMP:-/tmp}/hvd-smoke.XXXXXX")
trap 'rm -rf -- "$T"' EXIT

RESULTS=()
FAILS=0
WARNS=0
STATUS=000 HOPS=0 FINAL=""

gh_data() { local s=$1; s=${s//'%'/'%25'}; s=${s//$'\r'/'%0D'}; s=${s//$'\n'/'%0A'}; printf '%s' "$s"; }
short() { local s=${1//$'\t'/ }; s=${s//$'\n'/ }; if (( ${#s} > 100 )); then s="${s:0:97}..."; fi; printf '%s' "$s"; }

record() {  # record PASS|WARN|FAIL CHECK EXPECTED GOT
  local got
  got=$(short "$4")
  RESULTS+=("$1"$'\t'"$2"$'\t'"$3"$'\t'"$got")
  case $1 in
    FAIL) FAILS=$((FAILS + 1)); printf '::error title=Live check failed::%s\n' "$(gh_data "$2: expected $3, got $got")" ;;
    WARN) WARNS=$((WARNS + 1)); printf '::warning title=Live check warning::%s\n' "$(gh_data "$2: $got")" ;;
  esac
  printf '%-4s  %s  (expected: %s; got: %s)\n' "$1" "$2" "$3" "$got"
}

# fetch NAME URL once|follow [curl options] -> $T/NAME.body, $T/NAME.head (every hop),
#   STATUS (last response; 000 = no answer), HOPS (redirects followed), FINAL (last URL)
fetch() {
  local name=$1 url=$2 mode=$3 try rc out
  shift 3
  local -a opts=(--silent --show-error --noproxy '*' --connect-timeout 10 --max-time 30 -A "$UA"
    -H 'Cache-Control: no-cache' -H 'Pragma: no-cache' --proto-redir '=https')
  if [[ $url == http://* ]]; then opts+=(--proto '=http,https'); else opts+=(--proto '=https'); fi
  if [[ $mode == follow ]]; then opts+=(-L --max-redirs 5); fi
  for try in 1 2 3; do
    rc=0
    out=$(curl "${opts[@]}" "$@" -o "$T/$name.body" -D "$T/$name.head" \
      -w '%{http_code}\t%{num_redirects}\t%{url_effective}' "$url" 2>"$T/$name.err") || rc=$?
    if (( rc == 0 )); then
      IFS=$'\t' read -r STATUS HOPS FINAL <<<"$out"
      return 0
    fi
    if (( rc == 47 )); then STATUS=TOO_MANY_REDIRECTS HOPS=5 FINAL=$url; return 0; fi
    echo "  $url: curl error $rc ($(tr '\n' ' ' <"$T/$name.err")), try $try of 3"
    sleep 5
  done
  STATUS=000 HOPS=0 FINAL=""
  : >"$T/$name.body"
  : >"$T/$name.head"
}

header() {  # header NAME FILE: each value of that header in the LAST response in FILE
  awk -v want="${1,,}" '
    { sub(/\r$/, "") }
    /^HTTP\// { n = 0; next }
    { i = index($0, ":"); if (i > 0 && tolower(substr($0, 1, i - 1)) == want) { v = substr($0, i + 1); sub(/^[ \t]+/, "", v); sub(/[ \t]+$/, "", v); vals[++n] = v } }
    END { for (k = 1; k <= n; k++) print vals[k] }' "$2"
}
first_hop() {  # first_hop FILE: "<status> <location>" of the FIRST response in FILE
  awk '{ sub(/\r$/, "") }
    /^HTTP\// { if (seen) exit; seen = 1; status = $2; next }
    seen && $0 == "" { exit }
    seen { i = index($0, ":"); if (i > 0 && tolower(substr($0, 1, i - 1)) == "location") { loc = substr($0, i + 1); sub(/^[ \t]+/, "", loc) } }
    END { print status " " loc }' "$1"
}
joined() { header "$1" "$2" | paste -sd '|' -; }
count() { header "$1" "$2" | grep -c . || true; }
sha() { sha256sum "$1" | cut -d' ' -f1; }
denied() { [[ $1 == 403 || $1 == 404 || $1 == 406 ]]; }

# ------------------------------------------------------------------------------ home page
want_sha=$(sha "$DIST/index.html")
want_csp=$(awk -F'"' '/^Header always set Content-Security-Policy "/ {print $2; exit}' "$DIST/.htaccess")
[[ -n $want_csp ]] || { echo "::error title=No CSP::$DIST/.htaccess has no Content-Security-Policy line"; exit 2; }
got_sha="" got_csp=""
for ((i = 1; i <= ATTEMPTS; i++)); do
  fetch home "$SITE/" once
  got_sha=$(sha "$T/home.body")
  got_csp=$(joined content-security-policy "$T/home.head")
  if [[ $STATUS == 200 && $got_sha == "$want_sha" && $got_csp == "$want_csp" ]]; then break; fi
  same_csp=different; [[ $got_csp == "$want_csp" ]] && same_csp=same
  echo "home page, try $i of $ATTEMPTS: status $STATUS, sha256 ${got_sha:0:12} (want ${want_sha:0:12}), CSP $same_csp"
  if (( i < ATTEMPTS )); then sleep "$DELAY"; fi
done
if [[ $STATUS == 200 ]]; then record PASS "GET $SITE/" "200, no redirect" "$STATUS"; else record FAIL "GET $SITE/" "200, no redirect" "$STATUS"; fi
if [[ $got_sha == "$want_sha" ]]; then
  record PASS "home page body = this build's index.html (sha256)" "${want_sha:0:16}" "${got_sha:0:16}"
else
  record FAIL "home page body = this build's index.html (sha256)" "${want_sha:0:16} ($(wc -c <"$DIST/index.html") bytes)" "${got_sha:0:16} ($(wc -c <"$T/home.body") bytes)"
  cmp "$DIST/index.html" "$T/home.body" 2>&1 | head -n 3 || true
fi
if [[ $(count content-security-policy "$T/home.head") == 1 && $got_csp == "$want_csp" ]]; then
  record PASS "exactly one Content-Security-Policy, equal to this build's .htaccess" "the policy of dist/.htaccess" "same"
else
  record FAIL "exactly one Content-Security-Policy, equal to this build's .htaccess" "$(short "$want_csp")" "${got_csp:-none}"
fi
check_header() {  # check_header NAME EXPECTED [WARN]: exactly one value on /, equal to EXPECTED
  local values level=${3:-FAIL}
  values=$(joined "$1" "$T/home.head")
  if [[ $(count "$1" "$T/home.head") == 1 && $values == "$2" ]]; then record PASS "header $1 on /" "$2" "$values"
  else record "$level" "header $1 on /" "$2" "${values:-missing}"; fi
}
check_header strict-transport-security "max-age=31536000"
check_header x-frame-options "DENY"
check_header x-content-type-options "nosniff"
check_header referrer-policy "strict-origin-when-cross-origin"
check_header cross-origin-opener-policy "same-origin"
if [[ $(count permissions-policy "$T/home.head") == 1 ]]; then record PASS "header permissions-policy on /" "present once" "present"
else record FAIL "header permissions-policy on /" "present once" "$(count permissions-policy "$T/home.head") value(s)"; fi
if [[ $(count x-robots-tag "$T/home.head") == 0 ]]; then record PASS "no X-Robots-Tag on / (a production build)" "absent" "absent"
else record FAIL "no X-Robots-Tag on / (a production build)" "absent" "$(joined x-robots-tag "$T/home.head")"; fi
check_header cache-control "no-cache" WARN

# ------------------------------------------------------------------------------ redirects
ends_at() {  # ends_at NAME URL FINAL-URL: followed (at most 5 hops) to FINAL-URL with 200
  fetch "$1" "$2" follow
  local hop
  hop=$(first_hop "$T/$1.head")
  if [[ $STATUS == 200 && $FINAL == "$3" && $HOPS -ge 1 && ${hop%% *} =~ ^30[1278]$ && ${hop#* } == https://* ]]; then
    record PASS "GET $2 (redirects followed)" "ends at $3, 200" "$HOPS hop(s), first ${hop%% *}, ends at $FINAL"
  else
    record FAIL "GET $2 (redirects followed)" "ends at $3, 200" "status $STATUS after $HOPS hop(s), first ${hop:-none}, ends at ${FINAL:-nothing}"
  fi
}
ends_at http "$HTTP_SITE/" "$SITE/"
ends_at wwwhttp "$HTTP_WWW/products" "$SITE/products"
fetch slash "$SITE/products/" follow
hop=$(first_hop "$T/slash.head")
if [[ ${hop%% *} == 301 && $STATUS == 200 && $FINAL == "$SITE/products" ]]; then record PASS "GET $SITE/products/" "301, then $SITE/products 200" "301 -> $FINAL $STATUS"
else record FAIL "GET $SITE/products/" "301, then $SITE/products 200" "first ${hop:-none}, ends at ${FINAL:-nothing} $STATUS"; fi

# ------------------------------------------------------------------------------ pages and files
same_file() {  # same_file NAME URL DIST-FILE [content-type prefix]: 200, no redirect, identical
  local name=$1 url=$2 file=$3 ctype=${4:-} got problems=()
  if [[ ! -f $DIST/$file ]]; then record WARN "GET $url" "200" "skipped: $file is not in this build"; return; fi
  fetch "$name" "$url" once
  got=$(sha "$T/$name.body")
  [[ $STATUS == 200 ]] || problems+=("status $STATUS")
  [[ $got == "$(sha "$DIST/$file")" ]] || problems+=("body differs from $file")
  if [[ -n $ctype ]]; then
    local ct
    ct=$(joined content-type "$T/$name.head")
    [[ $ct == "$ctype"* ]] || problems+=("Content-Type ${ct:-missing}")
  fi
  if (( ${#problems[@]} )); then record FAIL "GET $url" "200${ctype:+ $ctype}, identical to $file" "${problems[*]}"
  else record PASS "GET $url" "200${ctype:+ $ctype}, identical to $file" "200${ctype:+ $ctype}, identical"; fi
}
same_file products "$SITE/products" "products.html"
same_file product "$SITE/products/pg-32-surge-generator" "products/pg-32-surge-generator.html"
same_file datasheet "$SITE/datasheets/pg-32.pdf" "datasheets/pg-32.pdf" "application/pdf"

status_is() {  # status_is NAME URL WANT LABEL: exactly WANT, no redirect
  fetch "$1" "$2" once
  local loc
  loc=$(joined location "$T/$1.head")
  if [[ $STATUS == "$3" && -z $loc ]]; then record PASS "GET $2" "$4" "$STATUS"
  else record FAIL "GET $2" "$4" "$STATUS${loc:+ -> $loc}"; fi
}
status_is wplogin "$SITE/wp-login.php" 404 "404, no redirect"
status_is xmlrpc "$SITE/xmlrpc.php" 404 "404, no redirect"
status_is gone "$SITE/?attachment_id=8" 410 "410 (an old WordPress attachment)"
status_is quote "$SITE/api/quote.php" 405 "405 (the endpoint takes POST only)"

for path in /.htaccess /.deploy-version /api/ /api/lib/bootstrap.php /api/config.php; do
  fetch denied "$SITE$path" once
  if denied "$STATUS"; then record PASS "GET $SITE$path (refused)" "403, 404 or 406" "$STATUS"
  else record FAIL "GET $SITE$path (refused)" "403, 404 or 406" "$STATUS"; fi
done

# ------------------------------------------------------------------------------ form API
deadline=$((SECONDS + API_WAIT))
while :; do
  fetch api "$SITE/api/token.php?form=quote" once -H 'Accept: application/json'
  case $STATUS in
    500 | 502 | 504 | 000)
      if (( SECONDS < deadline )); then
        echo "form API answered $STATUS: PHP may still use the old .user.ini (cached for up to 5 minutes); next try in ${API_POLL}s"
        sleep "$API_POLL"; continue
      fi ;;
  esac
  break
done
api_csp_ok() { [[ $(count content-security-policy "$T/api.head") == 1 && $(joined content-security-policy "$T/api.head") == "default-src 'none'"* ]]; }
case $STATUS in
  200)
    if python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1],encoding="utf-8")); sys.exit(0 if d.get("ok") is True and isinstance(d.get("token"),str) and d["token"] else 1)' "$T/api.body" 2>/dev/null; then
      record PASS "GET $SITE/api/token.php?form=quote" "200 JSON with a token" "200 JSON with a token"
    else
      record FAIL "GET $SITE/api/token.php?form=quote" "200 JSON with a token" "200, but not the expected JSON"
    fi ;;
  503)
    record WARN "GET $SITE/api/token.php?form=quote" "200 JSON" "503: the form API has no valid private configuration (hvd-private/config.php), so the forms cannot send yet. Set it up (go-live guide, step 3); no redeploy is needed afterwards" ;;
  *)
    record FAIL "GET $SITE/api/token.php?form=quote" "200 JSON (or 503 while the private config is missing)" "$STATUS" ;;
esac
if [[ $STATUS == 200 || $STATUS == 503 ]]; then
  if api_csp_ok; then record PASS "the API sends only its own Content-Security-Policy" "one, default-src 'none' ..." "one"
  else record FAIL "the API sends only its own Content-Security-Policy" "one, default-src 'none' ..." "$(joined content-security-policy "$T/api.head")"; fi
fi

# ------------------------------------------------------------------------------ summary
if (( FAILS )); then verdict="FAILED ($FAILS failed, $WARNS warning(s))"
elif (( WARNS )); then verdict="PASSED ($WARNS warning(s))"
else verdict="PASSED"; fi
cell() { local s=${1//|/\\|}; s=${s//\`/\'}; printf '%s' "$s"; }
echo
echo "Live site check: $verdict"
if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
  workflow_url=""
  if [[ -n ${GITHUB_SERVER_URL:-} && -n ${GITHUB_REPOSITORY:-} ]]; then
    workflow_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/workflows/deploy.yml"
  fi
  {
    echo "## Live site check: $verdict"
    echo
    echo "- Commit deployed: \`$COMMIT\`"
    echo "- Checked: $(date -u '+%Y-%m-%d %H:%M UTC') against $SITE; files uploaded: $UPLOADED; stale assets removed: $DELETED"
    echo
    echo "| Result | Check | Expected | Got |"
    echo "|---|---|---|---|"
    for r in "${RESULTS[@]}"; do
      IFS=$'\t' read -r res chk exp got <<<"$r"
      printf '| %s | %s | %s | %s |\n' "$res" "$(cell "$chk")" "$(cell "$exp")" "$(cell "$got")"
    done
    echo
    echo "### Rollback"
    echo
    if [[ -n $PREVIOUS ]]; then
      echo "To put back the version that was live before this deploy: Actions > **Deploy to hvdiscover.com** > **Run workflow**, branch \`main\`, **ref** = \`$PREVIOUS\`, dry_run off > **Run workflow**."
    else
      echo "The version live before this deploy is not recorded (the first deploy by this pipeline). To return to another version: Actions > **Deploy to hvdiscover.com** > **Run workflow**, branch \`main\`, **ref** = the full commit SHA of that version (from the commit list of \`main\`), dry_run off."
    fi
    echo
    echo "To deploy this same version again later: **ref** = \`$COMMIT\`."
    if [[ -n $workflow_url ]]; then echo; echo "Workflow page: $workflow_url"; fi
  } >>"$GITHUB_STEP_SUMMARY"
fi
(( FAILS == 0 ))
