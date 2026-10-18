#!/usr/bin/env bash
# Uploads the production build of the site (site/dist) to the live host over explicit FTPS
# (FTP with TLS on port 21) with lftp. Called by .github/workflows/deploy.yml; runs on
# ubuntu-24.04 with bash 5, GNU coreutils/findutils and lftp 4.9 from apt.
#
#   deploy.sh verify DIST     refuse anything but a production build: the checks of
#                             tools/make_release.py, plus required files, forbidden files,
#                             file names and the exclusion list
#   deploy.sh check-config    are FTP_SERVER, FTP_USERNAME and FTP_PASSWORD set and well formed?
#                             Writes configured=true|false to $GITHUB_OUTPUT; none set = a notice
#   deploy.sh plan DIST       print the upload plan from the build alone (no network)
#   deploy.sh deploy DIST     verify, plan, guard, connect, upload, check, switch, clean _astro/.
#                             DRY_RUN=1: connect read-only (when configured), print the plan, stop
#   deploy.sh guard DIR       run the exclusion guard on plan lists in DIR (used by the tests)
#
# How a deploy runs (lftp stops at the first failed command of each session):
#   0  preflight, read-only: list / and /_astro/ with sizes, read the previous /.deploy-version
#      and the first line of the live .htaccess; refuse a wrong FTP folder or a live WordPress
#   1  upload, nothing visitors load changes yet:
#        _astro/ files that are missing or differ in size (hashed names: same name and size =
#        same file, so a live asset is never overwritten), in parallel, each through a temporary
#        name renamed into place; every other file of the build goes to a hidden temporary name
#        next to its target: <folder>/.hvd-new.<name> (a dotfile: .htaccess refuses it)
#   2  check: the size of every uploaded file on the server equals the build's; a mismatch is
#      uploaded again (up to 3 rounds), and if it stays wrong the deploy stops here: nothing
#      that visitors load has changed
#   3  switch: each temporary file is renamed over its target (one atomic rename each), in order
#        A  other assets (datasheets/ ...)
#        B  api/: the .htaccess guards first, then .user.ini, then lib/, then the endpoints
#        C  pages: favicon.svg, 404.html, nested pages, top pages, index.html, sitemaps, robots.txt
#        D  .user.ini, then .htaccess LAST
#      then /.deploy-version (commit and file list of this deploy), then the stale files in
#      _astro/ are deleted (there before this deploy, not in this build), then the sizes of the
#      whole build on the server are checked once more.
# Nothing outside _astro/ is ever deleted. Excluded paths (below) are never written or deleted.
#
# Environment: FTP_SERVER, FTP_USERNAME, FTP_PASSWORD (GitHub environment secrets), DRY_RUN=0|1,
# DEPLOY_COMMIT (the commit being deployed), GITHUB_OUTPUT, GITHUB_STEP_SUMMARY, GITHUB_* (Actions).
# The password reaches lftp only through LFTP_PASSWORD in lftp's own environment: never on a
# command line, in a file or in the log. Never run this script with `set -x`.
set -euo pipefail
set +x
export LC_ALL=C
umask 077

readonly SITE_DOMAIN="hvdiscover.com"
readonly HTACCESS_FIRST_LINE="# hvdiscover.com: server configuration for the static Astro build."
readonly MARKER=".deploy-version"
readonly TEMP_PREFIX=".hvd-new."
readonly PATH_RE='^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'
readonly NAME_RE='^[A-Za-z0-9._-]+$'
readonly LOCAL_PATH_RE='^/[A-Za-z0-9._/-]+$'
readonly MAX_FILES=5000
readonly MAX_BYTES=$((200 * 1024 * 1024))
readonly LFTP_TIMEOUT=1200
readonly REPAIR_ROUNDS=3

# Never written to, never deleted. First path component, compared in lower case; also any first
# component matching wp-* (WordPress leftovers) and any component starting with .git.
readonly EXCLUDED_TOP=(blog my staging .well-known cgi-bin hv-check _wp-rollback wordpress
  index.php xmlrpc.php license.txt readme.html .ftpquota)
# In the FTP root, these mean the account does not start in public_html.
readonly WRONG_ROOT=(public_html private_html public_ftp domains hvd-private imap maildir backups)
# In the FTP root, these are WordPress files.
readonly WORDPRESS=(wp-config.php wp-settings.php wp-load.php)

WARNINGS=()
WORK=""
declare +x DEPLOY_PASSWORD=""   # never exported: child processes do not inherit it
FTP_HOST=""
RUN_URL=""

# ------------------------------------------------------------------------------ output
say() { printf '%s\n' "$*"; }
gh_data() { local s=$1; s=${s//'%'/'%25'}; s=${s//$'\r'/'%0D'}; s=${s//$'\n'/'%0A'}; printf '%s' "$s"; }
gh_prop() { local s; s=$(gh_data "$1"); s=${s//:/'%3A'}; s=${s//,/'%2C'}; printf '%s' "$s"; }
notice() { printf '::notice title=%s::%s\n' "$(gh_prop "$1")" "$(gh_data "$2")"; }
warn() { WARNINGS+=("$2"); printf '::warning title=%s::%s\n' "$(gh_prop "$1")" "$(gh_data "$2")"; }
die() { printf '::error title=%s::%s\n' "$(gh_prop "$1")" "$(gh_data "$2")"; exit 1; }
set_output() {
  if [[ -n ${GITHUB_OUTPUT:-} ]]; then printf '%s=%s\n' "$1" "$2" >>"$GITHUB_OUTPUT"; else say "output: $1=$2"; fi
}
summary() { if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then printf '%s\n' "$@" >>"$GITHUB_STEP_SUMMARY"; fi; }
warning_lines() { local w; for w in "${WARNINGS[@]}"; do printf -- '- Warning: %s\n' "$w"; done; }
count_lines() { grep -c . "$1" || true; }

cleanup() { if [[ -n $WORK && -d $WORK ]]; then rm -rf -- "$WORK"; fi; }
trap cleanup EXIT

new_work() {
  WORK=$(mktemp -d "${RUNNER_TEMP:-/tmp}/hvd-deploy.XXXXXX")
  [[ $WORK =~ $LOCAL_PATH_RE ]] || die "Unsafe work folder" "The temporary folder path has unexpected characters."
  mkdir -p "$WORK/plan"
}

# ------------------------------------------------------------------------------ paths
split_path() { local IFS=/; read -r -a PARTS <<<"$1"; }   # no globbing, unlike `for c in $p`

path_ok() {  # a relative path lftp can take inside double quotes, with no . or .. part
  local p=$1 c
  [[ ${#p} -le 1024 && $p =~ $PATH_RE ]] || return 1
  split_path "$p"
  for c in "${PARTS[@]}"; do [[ $c != . && $c != .. && ${#c} -le 200 ]] || return 1; done
  return 0
}

is_excluded() {  # 0 when the relative path is on the exclusion list
  local p=${1,,} top x c
  top=${p%%/*}
  for x in "${EXCLUDED_TOP[@]}"; do [[ $top == "$x" ]] && return 0; done
  [[ $top == wp-* ]] && return 0
  split_path "$p"
  for c in "${PARTS[@]}"; do [[ $c == .git* ]] && return 0; done
  return 1
}

dotfile_allowed() {  # dotfiles in a build: only .htaccess and .user.ini, at any depth
  local c
  split_path "$1"
  for c in "${PARTS[@]}"; do
    if [[ $c == .* && $c != .htaccess && $c != .user.ini ]]; then return 1; fi
  done
  return 0
}

dir_of() { if [[ $1 == */* ]]; then printf '%s' "${1%/*}"; else printf '.'; fi; }
temp_of() {  # the hidden temporary name next to a file: products/x.html -> products/.hvd-new.x.html
  if [[ $1 == */* ]]; then printf '%s/%s%s' "${1%/*}" "$TEMP_PREFIX" "${1##*/}"; else printf '%s%s' "$TEMP_PREFIX" "$1"; fi
}
remote_dir() { if [[ $1 == . ]]; then printf '/'; else printf '/%s/' "$1"; fi; }

# ------------------------------------------------------------------------------ verify
FILES=()
BUILD_BYTES=0
declare -A LOCAL_SIZE=()

load_files() {  # FILES = every file of DIST, relative, sorted; refuses anything odd
  local dist=$1 odd
  [[ -d $dist ]] || die "No build" "$dist is not a folder: run the production build first."
  odd=$(find "$dist" -mindepth 1 ! -type f ! -type d -printf '%P\n' | sed -n '1,20p')
  [[ -z $odd ]] || die "Not a plain build" "Symlinks or special files in the build: $(tr '\n' ' ' <<<"$odd")"
  mapfile -d '' -t FILES < <(find "$dist" -mindepth 1 -type f -printf '%P\0' | sort -z)
  (( ${#FILES[@]} > 0 )) || die "Empty build" "$dist holds no files."
}

cmd_verify() {
  local dist=${1:?usage: deploy.sh verify DIST} f bad=() excluded=() dots=() forbidden=() missing=() size path
  load_files "$dist"
  (( ${#FILES[@]} <= MAX_FILES )) || die "Build too large" "${#FILES[@]} files (limit $MAX_FILES): is this the right folder?"
  for f in "${FILES[@]}"; do
    if ! path_ok "$f"; then bad+=("$f"); continue; fi
    if is_excluded "$f"; then excluded+=("$f"); fi
    if ! dotfile_allowed "$f"; then dots+=("$f"); fi
    if [[ ${f##*/} == "$TEMP_PREFIX"* || ${f##*/} == .in.* ]]; then dots+=("$f"); fi
    case ${f,,} in
      config.php | */config.php | *config.sample.php | *.md | *.eml | *.log | *.sql | *.bak | *.pem | *.key \
        | *.env | node_modules/* | */node_modules/* | api/tests/* | api/data/*) forbidden+=("$f") ;;
    esac
  done
  (( ${#bad[@]} == 0 )) || die "Unsafe file names" "Only letters, digits, dot, dash and underscore are uploaded; rename: $(printf '%q ' "${bad[@]:0:10}")"
  (( ${#excluded[@]} == 0 )) || die "Excluded path in the build" "The build would write into paths the deploy never touches: ${excluded[*]:0:10}"
  (( ${#dots[@]} == 0 )) || die "Unexpected dotfile" "Only .htaccess and .user.ini dotfiles are deployed; found: ${dots[*]:0:10}"
  (( ${#forbidden[@]} == 0 )) || die "Forbidden file in the build" "These must never reach the server: ${forbidden[*]:0:10}"

  BUILD_BYTES=0
  LOCAL_SIZE=()
  while IFS=$'\t' read -r size path; do
    LOCAL_SIZE[$path]=$size
    BUILD_BYTES=$((BUILD_BYTES + size))
  done < <(find "$dist" -mindepth 1 -type f -printf '%s\t%P\n')
  (( BUILD_BYTES <= MAX_BYTES )) || die "Build too large" "$BUILD_BYTES bytes (limit $MAX_BYTES)."

  for f in index.html 404.html .htaccess .user.ini robots.txt sitemap-index.xml \
    api/.htaccess api/.user.ini api/token.php api/quote.php api/contact.php api/lib/bootstrap.php; do
    [[ -f $dist/$f ]] || missing+=("$f")
  done
  (( ${#missing[@]} == 0 )) || die "Incomplete build" "Missing from the build: ${missing[*]}"
  [[ -n $(find "$dist/_astro" -maxdepth 1 -type f -print -quit 2>/dev/null) ]] || die "Incomplete build" "_astro/ is missing or empty."

  # A production build, not a staging or preview one: the checks of tools/make_release.py ...
  local ht=$dist/.htaccess robots=$dist/robots.txt
  grep -qF 'RewriteRule ^ https://hvdiscover.com%{REQUEST_URI} [R=301,L]' "$ht" \
    || die "Not a production build" ".htaccess does not redirect to the canonical host https://hvdiscover.com."
  if grep -qF 'X-Robots-Tag' "$ht"; then die "Not a production build" ".htaccess sends X-Robots-Tag (a staging build)."; fi
  grep -qE '^Header always set Strict-Transport-Security ' "$ht" \
    || die "Not a production build" ".htaccess has no Strict-Transport-Security header."
  if grep -qF 'STAGING' "$ht"; then die "Not a production build" ".htaccess is a STAGING build."; fi
  grep -qF 'Sitemap: https://hvdiscover.com/sitemap-index.xml' "$robots" \
    || die "Not a production build" "robots.txt has no Sitemap line for https://hvdiscover.com."
  # ... and a few more
  [[ $(head -n 1 "$ht" | tr -d '\r') == "$HTACCESS_FIRST_LINE" ]] \
    || die "Not a production build" "The first line of .htaccess is not the production header."
  # (directives only: the header comment of the template names the placeholders on purpose)
  if grep -vE '^[[:space:]]*#' "$ht" | grep -qE '__(SITE_HOST|SITE_HOST_RE|INLINE_SCRIPT_HASHES|INLINE_STYLE_HASHES)__'; then
    die "Not a production build" ".htaccess still holds a build placeholder."
  fi
  grep -qE "^Header always set Content-Security-Policy \"default-src 'none'; " "$ht" \
    || die "Not a production build" ".htaccess has no Content-Security-Policy."
  if grep -qxE 'Disallow: /[[:space:]]*' "$robots"; then die "Not a production build" "robots.txt disallows everything (a preview or staging build)."; fi
  [[ ! -e $dist/.nojekyll ]] || die "Not a production build" "This is the GitHub Pages preview build."
  say "verify: production build OK (${#FILES[@]} files, $BUILD_BYTES bytes)"
}

# ------------------------------------------------------------------------------ plan
PLAN_A=() PLAN_B=() PLAN_C=() PLAN_D=()
ASTRO_LOCAL=()      # files directly in _astro/ (names only): uploaded by the parallel mirror
STAGED=()           # every other file of the build, in switch order: through a temporary name
PH="" KEY=""

phase_of() {  # sets PH (phase) and KEY (sort key inside the phase) for one relative path
  local p=$1 base=${1##*/} slashes d
  slashes=${p//[^\/]/}
  d=${#slashes}
  if [[ $p == .htaccess ]]; then PH=D KEY=9; return; fi
  if [[ $p == .user.ini ]]; then PH=D KEY=8; return; fi
  if [[ $p == api/* ]]; then
    PH=B
    if [[ $base == .htaccess ]]; then printf -v KEY '1.%02d' "$d"
    elif [[ $base == .user.ini ]]; then printf -v KEY '2.%02d' "$d"
    elif (( d >= 2 )); then KEY=3
    else KEY=4; fi
    return
  fi
  if [[ $base == .htaccess || $base == .user.ini ]]; then PH=D KEY=1; return; fi
  case $p in
    favicon.svg) PH=C KEY=1 ;;
    404.html) PH=C KEY=2 ;;
    index.html) PH=C KEY=5 ;;
    sitemap-index.xml) PH=C KEY=7 ;;
    robots.txt) PH=C KEY=8 ;;
    *.html) PH=C; if (( d >= 1 )); then KEY=3; else KEY=4; fi ;;
    sitemap*.xml) if (( d == 0 )); then PH=C KEY=6; else PH=A KEY=1; fi ;;
    _astro/*/*) PH=A KEY=1 ;;
    _astro/*) PH=A KEY=0 ;;
    *) PH=A KEY=1 ;;
  esac
}

build_plan() {  # FILES -> PLAN_A..D (switch order), ASTRO_LOCAL, STAGED; writes $WORK/plan/*
  local f ph path
  for f in "${FILES[@]}"; do
    phase_of "$f"
    printf '%s\t%s\t%s\n' "$PH" "$KEY" "$f"
  done | sort -t $'\t' -k1,1 -k2,2 -k3,3 >"$WORK/plan/ordered.tsv"
  PLAN_A=() PLAN_B=() PLAN_C=() PLAN_D=() ASTRO_LOCAL=() STAGED=()
  while IFS=$'\t' read -r ph _ path; do
    case $ph in
      A) PLAN_A+=("$path") ;;
      B) PLAN_B+=("$path") ;;
      C) PLAN_C+=("$path") ;;
      D) PLAN_D+=("$path") ;;
    esac
    if [[ $path == _astro/* && $path != _astro/*/* ]]; then ASTRO_LOCAL+=("${path#_astro/}"); else STAGED+=("$path"); fi
  done <"$WORK/plan/ordered.tsv"
  printf '%s\n' "${FILES[@]}" >"$WORK/plan/build.list"
  write_lists
}

ASTRO_UP=()         # _astro/ names to upload (missing on the server, or another size)
ASTRO_SAME=()       # _astro/ names already on the server with the same size: left as they are
write_lists() {     # the write and delete lists the guard checks
  local p
  {
    for p in "${ASTRO_UP[@]}"; do printf '_astro/%s\n' "$p"; done
    for p in "${STAGED[@]}"; do temp_of "$p"; printf '\n%s\n' "$p"; done
    printf '%s\n' "$MARKER"
  } | sed '/^$/d' >"$WORK/plan/write.list"
  [[ -f $WORK/plan/delete.list ]] || : >"$WORK/plan/delete.list"
}

# The guard: nothing in the plan may touch an excluded path; every written path must be a file of
# this build, the hidden temporary name of one, or the marker; every deletion must be a single
# file directly in _astro/ that this build does not have. A violation stops the deploy before
# anything is written.
guard_plan() {
  local dir=$1 p base real bad=() writes=0 deletes=0 have_build=0
  local -A build=()
  if [[ -f $dir/build.list ]]; then
    have_build=1
    while IFS= read -r p; do if [[ -n $p ]]; then build[$p]=1; fi; done <"$dir/build.list"
  fi
  while IFS= read -r p || [[ -n $p ]]; do
    [[ -z $p ]] && continue
    writes=$((writes + 1))
    if ! path_ok "$p"; then bad+=("write (bad name): $p"); continue; fi
    if is_excluded "$p"; then bad+=("write (excluded): $p"); continue; fi
    real=$p
    base=${p##*/}
    if [[ $base == "$TEMP_PREFIX"* ]]; then
      if [[ $p == */* ]]; then real="${p%/*}/${base#"$TEMP_PREFIX"}"; else real=${base#"$TEMP_PREFIX"}; fi
    fi
    if (( have_build )) && [[ $p != "$MARKER" && -z ${build[$real]:-} ]]; then bad+=("write (not in the build): $p"); fi
  done <"$dir/write.list"
  if [[ -f $dir/delete.list ]]; then
    while IFS= read -r p || [[ -n $p ]]; do
      [[ -z $p ]] && continue
      deletes=$((deletes + 1))
      if [[ ! $p =~ ^_astro/[A-Za-z0-9._-]+$ || $p == _astro/. || $p == _astro/.. ]]; then
        bad+=("delete (outside _astro/ or bad name): $p"); continue
      fi
      if is_excluded "$p"; then bad+=("delete (excluded): $p"); continue; fi
      if [[ -n ${build[$p]:-} ]]; then bad+=("delete (a file of this build): $p"); fi
    done <"$dir/delete.list"
  fi
  if (( ${#bad[@]} )); then
    say "guard: the plan was REFUSED:"
    printf '  %s\n' "${bad[@]:0:50}"
    die "Deploy refused by the guard" "The upload plan would touch an excluded path or delete outside _astro/ (${#bad[@]} problem(s)), first: ${bad[0]}"
  fi
  say "guard: plan OK ($writes writes, $deletes deletions; nothing excluded, deletions only in _astro/)"
}

guard_current_plan() {  # every file of the build planned exactly once (plus the marker), then the guard
  local finals want lines
  want=$(( ${#FILES[@]} ))
  finals=$(( ${#ASTRO_LOCAL[@]} + ${#STAGED[@]} ))
  lines=$(printf '%s\n' "${ASTRO_LOCAL[@]/#/_astro/}" "${STAGED[@]}" | sed '/^$/d' | sort -u | wc -l)
  (( finals == want && lines == want )) \
    || die "Plan error" "The plan does not cover every file of the build exactly once ($finals planned, $lines unique, $want files)."
  guard_plan "$WORK/plan"
}

print_plan() {
  local p n_up=${#ASTRO_UP[@]} n_same=${#ASTRO_SAME[@]}
  say "Plan for ${#FILES[@]} files of the build:"
  if (( ${CONNECTED:-0} )); then
    say "  1  upload   ${n_up} of ${#ASTRO_LOCAL[@]} _astro/ files (the other $n_same are on the server already, same name and size)"
  else
    say "  1  upload   up to ${#ASTRO_LOCAL[@]} _astro/ files (the server was not contacted: identical ones would be skipped)"
  fi
  say "             ${#STAGED[@]} other files to hidden temporary names (.hvd-new.*)"
  say "  2  check    sizes on the server = sizes in the build, before anything switches"
  say "  3  switch   A ${#PLAN_A[@]} assets (incl. _astro/), B ${#PLAN_B[@]} api/, C ${#PLAN_C[@]} pages, D ${#PLAN_D[@]} config (.htaccess last)"
  say "     marker   /$MARKER"
  say "     delete   $(count_lines "$WORK/plan/delete.list") stale file(s) in _astro/"
  say "Files written, in order:"
  for p in "${ASTRO_UP[@]}"; do say "  1 /_astro/$p"; done
  for p in "${STAGED[@]}"; do say "  1 /$(temp_of "$p")"; done
  for p in "${PLAN_A[@]}"; do if [[ $p != _astro/* || $p == _astro/*/* ]]; then say "  3A /$p"; fi; done
  for p in "${PLAN_B[@]}"; do say "  3B /$p"; done
  for p in "${PLAN_C[@]}"; do say "  3C /$p"; done
  for p in "${PLAN_D[@]}"; do say "  3D /$p"; done
  say "  + /$MARKER"
  while IFS= read -r p; do if [[ -n $p ]]; then say "  - /$p (delete)"; fi; done <"$WORK/plan/delete.list"
}

cmd_plan() {
  local dist=${1:?usage: deploy.sh plan DIST}
  new_work
  cmd_verify "$dist"
  build_plan
  ASTRO_UP=("${ASTRO_LOCAL[@]}")   # offline: every asset counts as an upload
  write_lists
  guard_current_plan
  print_plan
}

cmd_guard() {  # tests: guard a hand-made plan (write.list, delete.list, optional build.list)
  local dir=${1:?usage: deploy.sh guard DIR}
  [[ -f $dir/write.list ]] || die "No plan" "$dir/write.list not found."
  guard_plan "$dir"
}

# ------------------------------------------------------------------------------ config
# Returns 0 when all three secrets are set and valid, 2 when none is set; dies otherwise.
# Error messages never contain a secret value.
validate_config() {
  local missing=() v
  for v in FTP_SERVER FTP_USERNAME FTP_PASSWORD; do [[ -n ${!v:-} ]] || missing+=("$v"); done
  if (( ${#missing[@]} == 3 )); then return 2; fi
  (( ${#missing[@]} == 0 )) || die "Deployment half configured" \
    "These secrets are missing from the GitHub environment 'production': ${missing[*]}. Add them (Settings > Environments > production)."
  for v in FTP_SERVER FTP_USERNAME FTP_PASSWORD; do
    if [[ ${!v} =~ [[:space:][:cntrl:]] ]]; then
      die "Invalid secret" "$v contains spaces, tabs or line breaks: paste the value again without them."
    fi
  done
  local host=${FTP_SERVER,,}
  if [[ ${#host} -gt 253 || ! $host =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; then
    die "Invalid secret" "FTP_SERVER must be a plain host name such as $SITE_DOMAIN (no ftp://, no port, no path)."
  fi
  if [[ $host != "$SITE_DOMAIN" && $host != *".$SITE_DOMAIN" ]]; then
    die "Invalid secret" "FTP_SERVER must be $SITE_DOMAIN or a name under it: this pipeline only deploys this site."
  fi
  if [[ ! $FTP_USERNAME =~ ^[A-Za-z0-9._@+-]{1,128}$ ]]; then
    die "Invalid secret" "FTP_USERNAME may only hold letters, digits and . _ @ + - (for example deploy@$SITE_DOMAIN)."
  fi
  if (( ${#FTP_PASSWORD} < 8 || ${#FTP_PASSWORD} > 256 )); then
    die "Invalid secret" "FTP_PASSWORD must be 8 to 256 characters long (use the generator in the panel)."
  fi
  FTP_HOST=$host
  return 0
}

mask_password() {  # Actions already masks secrets; this also covers the value as given here
  if [[ ${GITHUB_ACTIONS:-} == true && -n ${FTP_PASSWORD:-} ]]; then printf '::add-mask::%s\n' "$(gh_data "$FTP_PASSWORD")"; fi
}

cmd_check_config() {
  mask_password
  local rc=0
  validate_config || rc=$?
  if (( rc == 2 )); then
    notice "Deployment not configured yet" \
      "No FTP secrets in the GitHub environment 'production', so nothing was uploaded. Add FTP_SERVER, FTP_USERNAME and FTP_PASSWORD there to switch on automatic deployment."
    set_output configured false
    summary "### Deployment not configured yet" "" \
      "The build passed its checks, but the GitHub environment \`production\` has no FTP secrets, so nothing was uploaded." \
      "Add \`FTP_SERVER\`, \`FTP_USERNAME\` and \`FTP_PASSWORD\` there to switch on automatic deployment."
    return 0
  fi
  set_output configured true
  say "config: FTP secrets present and well formed"
}

# ------------------------------------------------------------------------------ lftp
lftp_preamble() {  # settings for every session; the password comes from LFTP_PASSWORD
  cat <<EOF
set cmd:fail-exit yes
set cmd:interactive no
set cmd:save-cwd-history no
set cmd:save-rl-history no
set log:enabled/xfer no
set dns:order "inet inet6"
set dns:fatal-timeout 30
set ftp:proxy ""
set ftp:ssl-force true
set ftp:ssl-auth TLS
set ftp:ssl-protect-data true
set ftp:ssl-protect-list true
set ssl:verify-certificate yes
set ssl:check-hostname yes
set ssl:priority "NORMAL:-VERS-ALL:+VERS-TLS1.3:+VERS-TLS1.2"
set ftp:passive-mode on
set net:timeout 30
set net:max-retries $1
set net:persist-retries 0
set net:reconnect-interval-base 5
set net:reconnect-interval-multiplier 2
set net:reconnect-interval-max 30
set xfer:clobber on
open --env-password -u "$FTP_USERNAME" "ftp://$FTP_HOST"
EOF
}

# run_lftp SCRIPT STDOUT STDERR [tee]: the password is in lftp's environment only, no proxy
run_lftp() {
  local script=$1 out=$2 err=$3 rc=0
  local -a noproxy=(env -u ftp_proxy -u FTP_PROXY -u http_proxy -u HTTP_PROXY -u https_proxy -u HTTPS_PROXY -u all_proxy -u ALL_PROXY)
  if [[ ${4:-} == tee ]]; then
    LFTP_PASSWORD=$DEPLOY_PASSWORD timeout "$LFTP_TIMEOUT" "${noproxy[@]}" lftp --norc -f "$script" </dev/null 2>"$err" | tee "$out" || rc=$?
  else
    LFTP_PASSWORD=$DEPLOY_PASSWORD timeout "$LFTP_TIMEOUT" "${noproxy[@]}" lftp --norc -f "$script" </dev/null >"$out" 2>"$err" || rc=$?
  fi
  return "$rc"
}

listing_cmds() {  # lftp commands that list folders with exact sizes, each after a marker line
  local d
  for d in "$@"; do
    say "echo \"__HVD_LIST__ $d\""
    say "cls -1as --filesize --block-size=1 -BF \"$(remote_dir "$d")\" || echo __HVD_NONE__"
  done
}

declare -A REMOTE_SIZE=()   # "dir/name" (root: "name") -> size in bytes, from the last listing
parse_listings() {  # parse_listings OUTFILE: fills REMOTE_SIZE from the __HVD_LIST__ sections
  local out=$1 line dir="" size name key
  while IFS= read -r line; do
    line=${line%$'\r'}
    if [[ $line == "__HVD_LIST__ "* ]]; then dir=${line#__HVD_LIST__ }; continue; fi
    if [[ $line == __HVD_* ]]; then
      if [[ $line != __HVD_NONE__ ]]; then dir=""; fi
      continue
    fi
    [[ -n $dir ]] || continue
    if [[ $line =~ ^[[:space:]]*([0-9]+)[[:space:]](.+)$ ]]; then
      size=${BASH_REMATCH[1]} name=${BASH_REMATCH[2]}
      [[ $name == */ || $name == *@ ]] && continue
      if [[ $dir == . ]]; then key=$name; else key="$dir/$name"; fi
      REMOTE_SIZE[$key]=$size
    fi
  done <"$out"
}

ROOT_NAMES=() ASTRO_REMOTE=() PREVIOUS_COMMIT="" PREVIOUS_FILES=() LIVE_IS_OURS=0
CONNECTED=0
declare -A ASTRO_REMOTE_SIZE=()

preflight() {  # read-only: list / and /_astro/, read the marker and the live .htaccess
  local script=$WORK/preflight.lftp out=$WORK/preflight.out err=$WORK/preflight.err rc=0
  {
    lftp_preamble 2
    say "echo __HVD_ROOT__"
    say "cls -1aBF /"
    say "echo __HVD_ASTRO__"
    say "cls -1as --filesize --block-size=1 -BF /_astro/ || echo __HVD_NONE__"
    say "echo __HVD_MARKER__"
    say "get /$MARKER -o \"$WORK/previous-marker\" || echo __HVD_NONE__"
    say "echo __HVD_HTACCESS__"
    say "get /.htaccess -o \"$WORK/live-htaccess\" || echo __HVD_NONE__"
    say "echo __HVD_END__"
  } >"$script"
  run_lftp "$script" "$out" "$err" || rc=$?
  if (( rc != 0 )) || ! grep -qx '__HVD_END__' "$out"; then
    say "lftp (connection check) said:"
    sed -n '1,20p' "$err" | sed 's/^/  /'
    die "Cannot connect" "The FTPS connection or login failed (exit $rc): check FTP_SERVER, FTP_USERNAME and FTP_PASSWORD, and that the FTP account exists. Nothing was written."
  fi
  CONNECTED=1
  local section="" line name size
  ROOT_NAMES=() ASTRO_REMOTE=() ASTRO_REMOTE_SIZE=()
  while IFS= read -r line; do
    line=${line%$'\r'}
    case $line in
      __HVD_ROOT__) section=root; continue ;;
      __HVD_ASTRO__) section=astro; continue ;;
      __HVD_MARKER__ | __HVD_HTACCESS__ | __HVD_END__) section=""; continue ;;
      __HVD_NONE__ | "") continue ;;
    esac
    case $section in
      root)
        name=${line#"${line%%[![:space:]]*}"}
        case $name in . | .. | ./ | ../) ;; *) ROOT_NAMES+=("$name") ;; esac ;;
      astro)
        if [[ $line =~ ^[[:space:]]*([0-9]+)[[:space:]](.+)$ ]]; then
          size=${BASH_REMATCH[1]} name=${BASH_REMATCH[2]}
          ASTRO_REMOTE+=("$name"); ASTRO_REMOTE_SIZE[$name]=$size
        else
          name=${line#"${line%%[![:space:]]*}"}
          case $name in . | .. | ./ | ../) ;; *) ASTRO_REMOTE+=("$name") ;; esac
        fi ;;
    esac
  done <"$out"

  PREVIOUS_COMMIT="" PREVIOUS_FILES=()
  if [[ -f $WORK/previous-marker ]]; then
    local count=0
    while IFS= read -r line && (( count < 20000 )); do
      count=$((count + 1)); line=${line%$'\r'}
      if [[ $line =~ ^commit=([0-9a-f]{40})$ ]]; then PREVIOUS_COMMIT=${BASH_REMATCH[1]}
      elif [[ $line == "f "* ]]; then name=${line#f }; if path_ok "$name"; then PREVIOUS_FILES+=("$name"); fi; fi
    done <"$WORK/previous-marker"
  fi
  LIVE_IS_OURS=0
  if [[ -f $WORK/live-htaccess && $(head -n 1 "$WORK/live-htaccess" | tr -d '\r') == "$HTACCESS_FIRST_LINE" ]]; then LIVE_IS_OURS=1; fi

  local lower=() n x
  for n in "${ROOT_NAMES[@]}"; do n=${n%/}; n=${n%@}; lower+=("${n,,}"); done
  for x in "${WRONG_ROOT[@]}"; do
    for n in "${lower[@]}"; do
      if [[ $n == "$x" ]]; then
        die "Wrong FTP folder" "The FTP account starts in a folder that holds '$x', so it is not public_html. In DirectAdmin, set the account's folder to /domains/$SITE_DOMAIN/public_html. Nothing was written."
      fi
    done
  done
  local wp=""
  for x in "${WORDPRESS[@]}"; do for n in "${lower[@]}"; do if [[ $n == "$x" ]]; then wp=$x; fi; done; done
  if [[ -n $wp ]]; then
    if (( LIVE_IS_OURS )); then
      warn "WordPress file in public_html" "public_html still holds $wp from the old site. The deploy leaves it alone; move it out with the rest of WordPress (go-live guide, step 4)."
    elif [[ ${DRY_RUN:-0} == 1 ]]; then
      warn "WordPress still live" "public_html holds $wp and the live .htaccess is not this site's: a real deploy refuses until WordPress is moved out (go-live guide, step 4)."
    else
      die "WordPress still live" "public_html holds $wp and the live .htaccess is not this site's, so WordPress looks live. Move the WordPress files out first (go-live guide, step 4), then run this workflow again. Nothing was written."
    fi
  fi
  for n in "${lower[@]}"; do
    if [[ $n == wp-rollback ]]; then
      warn "wp-rollback inside public_html" "A wp-rollback folder is inside public_html, where visitors may reach its files. The deploy leaves it alone; move it next to public_html (go-live guide, step 4)."
    fi
  done
  local orphans=()
  for n in "${ROOT_NAMES[@]}"; do if [[ $n == "$TEMP_PREFIX"* ]]; then orphans+=("$n"); fi; done
  if (( ${#orphans[@]} )); then
    warn "Temporary files from an earlier run" "Left by an interrupted deploy (hidden from visitors; this run replaces the ones it needs): ${orphans[*]:0:10}"
  fi
  local kept=() ex
  for n in "${ROOT_NAMES[@]}"; do
    ex=${n%/}; ex=${ex%@}
    if [[ $ex =~ $NAME_RE ]] && is_excluded "$ex"; then kept+=("$n"); fi
  done
  say "remote: connected over TLS; the FTP root lists ${#ROOT_NAMES[@]} entries; left alone: ${kept[*]:-(none)}"
  say "remote: live .htaccess is $( ((LIVE_IS_OURS)) && echo "this site's" || echo "NOT this site's (or missing)"); _astro/ holds ${#ASTRO_REMOTE[@]} entries; version live now: ${PREVIOUS_COMMIT:-unknown}"
}

plan_remote() {  # with the preflight listing: which _astro/ files to upload, which are stale
  local -A local_set=()
  local n skipped=() stale=() limit
  ASTRO_UP=() ASTRO_SAME=()
  for n in "${ASTRO_LOCAL[@]}"; do
    local_set[$n]=1
    if [[ -n ${ASTRO_REMOTE_SIZE[$n]:-} && ${ASTRO_REMOTE_SIZE[$n]} == "${LOCAL_SIZE[_astro/$n]}" ]]; then ASTRO_SAME+=("$n"); else ASTRO_UP+=("$n"); fi
  done
  for n in "${ASTRO_REMOTE[@]}"; do
    if [[ $n == */ || $n == *@ ]]; then skipped+=("$n"); continue; fi   # folders, links: left alone
    if [[ ! $n =~ $NAME_RE ]]; then skipped+=("$n"); continue; fi
    if [[ -n ${local_set[$n]:-} ]]; then continue; fi
    stale+=("_astro/$n")
  done
  if (( ${#skipped[@]} )); then warn "Left in _astro/" "Not deleted (folder, link or unusual name): $(printf '%q ' "${skipped[@]:0:10}")"; fi
  limit=$(( ${#ASTRO_LOCAL[@]} * 3 > 500 ? ${#ASTRO_LOCAL[@]} * 3 : 500 ))
  if (( ${#stale[@]} > limit )); then
    warn "Cleanup skipped" "${#stale[@]} stale files in _astro/ is more than expected ($limit): nothing deleted this time; check _astro/ by hand."
    stale=()
  fi
  printf '%s\n' "${stale[@]}" | sed '/^$/d' >"$WORK/plan/delete.list"
  write_lists
}

LEFT_BEHIND=()
find_left_behind() {  # files of the previous deploy that this build no longer has (never deleted)
  local -A now=()
  local f
  LEFT_BEHIND=()
  for f in "${FILES[@]}"; do now[$f]=1; done
  for f in "${PREVIOUS_FILES[@]}"; do
    if [[ -n ${now[$f]:-} || $f == _astro/* || $f == "$MARKER" ]]; then continue; fi
    LEFT_BEHIND+=("$f")
  done
}

write_marker() {
  local f
  {
    say "# Written by .github/scripts/deploy.sh after each deploy. Refused to visitors by .htaccess."
    say "commit=$DEPLOY_COMMIT"
    say "deployed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    say "run=$RUN_URL"
    say "files=${#FILES[@]}"
    for f in "${FILES[@]}"; do say "f $f"; done
  } >"$WORK/marker"
}

staged_dirs() { local p; for p in "${STAGED[@]}"; do dir_of "$p"; printf '\n'; done | sort -u; }

upload_script() {  # step 1 and the listing for step 2
  local dist=$1 p d
  local -a dirs
  mapfile -t dirs < <(staged_dirs)
  lftp_preamble 4
  say "echo __HVD_STEP__ upload"
  if (( ${#ASTRO_UP[@]} )); then
    say "set xfer:use-temp-file yes"
    say "mirror --reverse --overwrite --transfer-all --no-perms --no-symlinks --parallel=4 --verbose=1 \"$WORK/stage-astro\" /_astro"
  fi
  say "set xfer:use-temp-file no"
  say "lcd \"$dist\""
  for d in "${dirs[@]}"; do if [[ $d != . ]]; then say "mkdir -p -f \"/$d\""; fi; done
  for p in "${STAGED[@]}"; do say "put \"$p\" -o \"/$(temp_of "$p")\""; done
  say "echo __HVD_STEP__ list"
  listing_cmds _astro "${dirs[@]}"
  say "echo __HVD_STEP__ done"
}

MISMATCH=()
check_uploads() {  # MISMATCH = planned uploads whose size on the server is not the build's
  local p t
  MISMATCH=()
  for p in "${ASTRO_UP[@]}"; do
    if [[ ${REMOTE_SIZE[_astro/$p]:-x} != "${LOCAL_SIZE[_astro/$p]}" ]]; then MISMATCH+=("_astro/$p"); fi
  done
  for p in "${STAGED[@]}"; do
    t=$(temp_of "$p")
    if [[ ${REMOTE_SIZE[$t]:-x} != "${LOCAL_SIZE[$p]}" ]]; then MISMATCH+=("$p"); fi
  done
}

repair_script() {  # uploads MISMATCH again and lists their folders
  local dist=$1 p
  local -a dirs
  mapfile -t dirs < <(for p in "${MISMATCH[@]}"; do dir_of "$p"; printf '\n'; done | sort -u)
  lftp_preamble 4
  say "lcd \"$dist\""
  for p in "${MISMATCH[@]}"; do
    if [[ $p == _astro/* && $p != _astro/*/* ]]; then
      say "set xfer:use-temp-file yes"; say "put \"$p\" -o \"/$p\""
    else
      say "set xfer:use-temp-file no"; say "put \"$p\" -o \"/$(temp_of "$p")\""
    fi
  done
  listing_cmds "${dirs[@]}"
  say "echo __HVD_STEP__ done"
}

switch_script() {  # step 3: renames in phase order, the marker, the cleanup, the final listing
  local p ph
  local -a dirs
  mapfile -t dirs < <(printf '%s\n' _astro "$(staged_dirs)" | sed '/^$/d' | sort -u)
  lftp_preamble 4
  for ph in A B C D; do
    say "echo __HVD_PHASE__ $ph"
    local -n list="PLAN_$ph"
    for p in "${list[@]}"; do
      if [[ $p == _astro/* && $p != _astro/*/* ]]; then continue; fi   # already in place (step 1)
      say "mv \"/$(temp_of "$p")\" \"/$p\""
    done
    unset -n list
  done
  say "echo __HVD_PHASE__ MARKER"
  say "set xfer:use-temp-file yes"
  say "put \"$WORK/marker\" -o \"/$MARKER\" || echo __HVD_MARKER_FAILED__"
  say "echo __HVD_PHASE__ CLEANUP"
  while IFS= read -r p; do
    if [[ -n $p ]]; then say "rm \"/$p\" || echo \"__HVD_RM_FAILED__ $p\""; fi
  done <"$WORK/plan/delete.list"
  say "echo __HVD_PHASE__ CHECK"
  listing_cmds "${dirs[@]}"
  say "echo __HVD_PHASE__ DONE"
}

phase_name() {
  case $1 in
    A) say "A (assets)" ;; B) say "B (api)" ;; C) say "C (pages)" ;; D) say "D (.user.ini and .htaccess)" ;;
    MARKER | CLEANUP | CHECK | DONE) say "after the switch ($1)" ;;
    *) say "before the switch" ;;
  esac
}

failure_state() {
  case $1 in
    A) say "Pages, api/ and .htaccess are still the old ones; some other assets (such as datasheets) may already be new." ;;
    B) say "The form API may be partly updated (guards first, endpoints last); pages and .htaccess are still the old ones." ;;
    C) say "Some pages are new and some old; every page still finds its assets. The old .htaccess is still live, so its Content-Security-Policy may not match the new pages until the re-run." ;;
    D) say "All pages are new; .user.ini may be new while .htaccess is still the old one." ;;
    *) say "Nothing visitors load has changed: only new _astro/ files and hidden .hvd-new.* files were added." ;;
  esac
}

cmd_deploy() {
  local dist=${1:?usage: deploy.sh deploy DIST} rc=0 dry=${DRY_RUN:-0} vrc=0 configured=1
  [[ $dry == 0 || $dry == 1 ]] || die "Invalid DRY_RUN" "DRY_RUN must be 0 or 1."
  [[ -d $dist ]] || die "No build" "$dist is not a folder."
  dist=$(cd "$dist" && pwd -P)
  [[ $dist =~ $LOCAL_PATH_RE ]] || die "Unsafe build path" "The build folder path has unexpected characters."
  mask_password
  validate_config || vrc=$?
  if (( vrc == 2 )); then configured=0; fi
  DEPLOY_PASSWORD=${FTP_PASSWORD:-}
  unset FTP_PASSWORD            # from here on only lftp gets it, through LFTP_PASSWORD
  DEPLOY_COMMIT=${DEPLOY_COMMIT:-}
  [[ $DEPLOY_COMMIT =~ ^[0-9a-f]{40}$ ]] || DEPLOY_COMMIT=unknown
  if [[ -n ${GITHUB_SERVER_URL:-} && -n ${GITHUB_REPOSITORY:-} && -n ${GITHUB_RUN_ID:-} ]]; then
    RUN_URL="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
  fi

  new_work
  cmd_verify "$dist"
  build_plan
  guard_current_plan            # before any connection: the plan from the build alone

  if (( configured == 0 )); then
    (( dry == 1 )) || die "Not configured" "FTP secrets missing: nothing to deploy to."
    ASTRO_UP=("${ASTRO_LOCAL[@]}")
    write_lists
    print_plan
    say "dry run: the FTP secrets are not set, so the server was not contacted. Nothing was written."
    set_output uploaded false
    summary "### Dry run (deployment not configured)" "" \
      "Commit \`$DEPLOY_COMMIT\`: ${#FILES[@]} files in the build. The FTP secrets are not set, so the server was not contacted."
    return 0
  fi
  command -v lftp >/dev/null || die "lftp missing" "lftp is not installed."

  preflight
  plan_remote
  guard_plan "$WORK/plan"       # again, now with the real uploads and the deletions
  find_left_behind
  local n_del
  n_del=$(count_lines "$WORK/plan/delete.list")

  if (( dry == 1 )); then
    print_plan
    if (( ${#LEFT_BEHIND[@]} )); then
      say "Left on the server (in the previous deploy, not in this build; never deleted):"
      printf '  /%s\n' "${LEFT_BEHIND[@]}"
    fi
    say "dry run: connection, certificate, login and folder checks passed; nothing was written."
    set_output uploaded false
    set_output previous "$PREVIOUS_COMMIT"
    summary "### Dry run: nothing was written" "" \
      "- Commit: \`$DEPLOY_COMMIT\`" \
      "- Would upload ${#ASTRO_UP[@]} new or changed \`_astro/\` files (${#ASTRO_SAME[@]} are on the server already) and ${#STAGED[@]} other files" \
      "- Would switch: A ${#PLAN_A[@]} assets, B ${#PLAN_B[@]} api, C ${#PLAN_C[@]} pages, D ${#PLAN_D[@]} config (.htaccess last)" \
      "- Would delete $n_del stale file(s) in \`_astro/\`" \
      "- Connection, TLS certificate, login and FTP folder: OK; live .htaccess: $( ((LIVE_IS_OURS)) && echo "this site's" || echo "not this site's")" \
      "- Version live now (previous deploy): \`${PREVIOUS_COMMIT:-unknown (no marker yet)}\`" \
      "$(warning_lines)"
    return 0
  fi

  # step 1: stage the _astro/ files to upload (a copy, so the mirror can only write these)
  mkdir -p "$WORK/stage-astro"
  local p
  for p in "${ASTRO_UP[@]}"; do cp -p -- "$dist/_astro/$p" "$WORK/stage-astro/$p"; done
  if [[ $(find "$WORK/stage-astro" -type f | wc -l) != "${#ASTRO_UP[@]}" ]]; then die "Plan error" "The staged assets differ from the plan."; fi
  write_marker
  upload_script "$dist" >"$WORK/upload.lftp"

  local started ended out=$WORK/upload.out err=$WORK/upload.err last state round repaired=0
  started=$(date +%s)
  say "upload: ${#ASTRO_UP[@]} _astro/ files (${#ASTRO_SAME[@]} unchanged, skipped) and ${#STAGED[@]} files to temporary names (commit $DEPLOY_COMMIT)"
  run_lftp "$WORK/upload.lftp" "$out" "$err" tee || rc=$?
  if (( rc != 0 )) || ! grep -qx '__HVD_STEP__ done' "$out"; then
    say "lftp said:"; tail -n 30 "$err" | sed 's/^/  /'
    state=$(failure_state none)
    summary "### Upload FAILED before the switch" "" "- Commit: \`$DEPLOY_COMMIT\`, lftp exit $rc" "- What is live now: $state" \
      "- Recovery: open this run and choose **Re-run all jobs** (or run the workflow again with the same ref)."
    die "Upload failed" "The upload stopped before the switch (lftp exit $rc). $state Re-run the workflow."
  fi

  # step 2: check every size; upload mismatches again
  REMOTE_SIZE=()
  parse_listings "$out"
  check_uploads
  for ((round = 1; round <= REPAIR_ROUNDS && ${#MISMATCH[@]} > 0; round++)); do
    warn "Upload repaired" "Round $round: ${#MISMATCH[@]} file(s) arrived with the wrong size and are uploaded again: ${MISMATCH[*]:0:10}"
    repaired=$((repaired + ${#MISMATCH[@]}))
    repair_script "$dist" >"$WORK/repair.lftp"
    rc=0
    run_lftp "$WORK/repair.lftp" "$WORK/repair.out" "$WORK/repair.err" || rc=$?
    if (( rc != 0 )); then say "lftp said:"; tail -n 20 "$WORK/repair.err" | sed 's/^/  /'; fi
    parse_listings "$WORK/repair.out"
    check_uploads
  done
  if (( ${#MISMATCH[@]} )); then
    state=$(failure_state none)
    summary "### Upload FAILED its size check" "" "- Commit: \`$DEPLOY_COMMIT\`" \
      "- These files keep arriving with the wrong size: ${MISMATCH[*]:0:20}" "- What is live now: $state"
    die "Size check failed" "${#MISMATCH[@]} file(s) keep arriving with the wrong size after $REPAIR_ROUNDS repairs: ${MISMATCH[*]:0:10}. $state"
  fi
  local repaired_note=""
  if (( repaired )); then repaired_note="; $repaired upload(s) repaired after a size mismatch"; fi
  say "check: every uploaded file has the size of the build$repaired_note"

  # step 3: switch, marker, cleanup, final check
  switch_script >"$WORK/switch.lftp"
  out=$WORK/switch.out err=$WORK/switch.err rc=0
  run_lftp "$WORK/switch.lftp" "$out" "$err" tee || rc=$?
  ended=$(date +%s)
  last=$(grep -E '^__HVD_PHASE__ ' "$out" | tail -n 1 | cut -d' ' -f2 || true)
  if (( rc != 0 )) && [[ $last != CHECK ]]; then
    say "lftp said:"; tail -n 30 "$err" | sed 's/^/  /'
    state=$(failure_state "${last:-none}")
    summary "### Deploy FAILED during the switch, phase $(phase_name "${last:-none}")" "" \
      "- Commit: \`$DEPLOY_COMMIT\`, after $((ended - started)) s, lftp exit $rc" \
      "- What is live now: $state" \
      "- Recovery: open this run and choose **Re-run all jobs** (or run the workflow again with the same ref); the re-run completes the switch." \
      "- If it keeps failing: the lftp lines in the log of the step \"Upload\" name the problem (connection, certificate, permission)."
    die "Switch failed" "Phase $(phase_name "${last:-none}") failed (lftp exit $rc). $state Re-run the workflow to complete the deploy."
  fi

  local wrong=() f
  REMOTE_SIZE=()
  parse_listings "$out"
  for f in "${FILES[@]}"; do
    if [[ ${REMOTE_SIZE[$f]:-x} != "${LOCAL_SIZE[$f]}" ]]; then wrong+=("$f"); fi
  done
  if (( rc != 0 || ${#wrong[@]} )); then
    summary "### Deploy switched, but the final check FAILED" "" "- Commit: \`$DEPLOY_COMMIT\`" \
      "- Wrong size or missing on the server: ${wrong[*]:0:20}" "- Recovery: run the workflow again with the same ref."
    die "Final check failed" "After the switch ${#wrong[@]} file(s) are missing or have the wrong size on the server (lftp exit $rc): ${wrong[*]:0:10}. Run the workflow again."
  fi

  local deleted failed_rm=() line
  while IFS= read -r line; do failed_rm+=("${line#__HVD_RM_FAILED__ }"); done < <(grep -E '^__HVD_RM_FAILED__ ' "$out" || true)
  deleted=$(( n_del - ${#failed_rm[@]} ))
  if (( ${#failed_rm[@]} )); then warn "Cleanup incomplete" "Could not delete ${#failed_rm[@]} stale file(s) in _astro/ (harmless; the next deploy tries again): ${failed_rm[*]:0:5}"; fi
  if grep -qx '__HVD_MARKER_FAILED__' "$out"; then warn "Marker not written" "/$MARKER could not be written; the next deploy cannot name the version it replaces."; fi
  if (( ${#LEFT_BEHIND[@]} )); then
    warn "Old files left on the server" "In the previous deploy but not in this build (the deploy never deletes outside _astro/; remove them by hand if they should go): ${LEFT_BEHIND[*]:0:20}"
  fi

  local uploaded=$(( ${#ASTRO_UP[@]} + ${#STAGED[@]} ))
  set_output uploaded true
  set_output files "$uploaded"
  set_output deleted "$deleted"
  set_output previous "$PREVIOUS_COMMIT"
  say "deploy: done in $((ended - started)) s: $uploaded files uploaded (${#ASTRO_SAME[@]} unchanged assets skipped), $deleted stale asset(s) deleted; every file of the build checked on the server"
  summary "### Deploy complete" "" \
    "- Commit: \`$DEPLOY_COMMIT\` (replaces \`${PREVIOUS_COMMIT:-unknown}\`)" \
    "- Finished: $(date -u '+%Y-%m-%d %H:%M UTC'), took $((ended - started)) s" \
    "- Uploaded: $uploaded files (${#ASTRO_UP[@]} new or changed \`_astro/\` files, ${#STAGED[@]} pages, api and other files); ${#ASTRO_SAME[@]} unchanged assets left as they were$repaired_note" \
    "- Switched in order: A assets, B api, C pages, D .user.ini and .htaccess (last); then the marker" \
    "- Deleted: $deleted stale file(s) in \`_astro/\`; nothing outside \`_astro/\` is ever deleted" \
    "- Final check: all ${#FILES[@]} files of the build are on the server with the right size" \
    "- The live-site checks and the rollback instruction are in the summary of the job \"Check the live site\"." \
    "$(warning_lines)"
}

# ------------------------------------------------------------------------------ main
main() {
  local cmd=${1:-}
  if (( $# )); then shift; fi
  case $cmd in
    verify) cmd_verify "$@" ;;
    check-config) cmd_check_config ;;
    plan) cmd_plan "$@" ;;
    deploy) cmd_deploy "$@" ;;
    guard) cmd_guard "$@" ;;
    *) say "usage: deploy.sh verify|plan|deploy DIST | check-config | guard DIR" >&2; exit 2 ;;
  esac
}
main "$@"
