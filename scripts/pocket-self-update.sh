#!/usr/bin/env bash
# Pocket Code installs its own release (1.123, POCKET_SELF_UPDATE=1). Started detached by the daemon (self-update.mjs), so
# it outlives the restart it causes; the daemon that comes up afterwards reads the progress file.
# The same guarded steps an operator runs (docs/operations.md, "Upgrade an existing installation"): a clean checkout on main
# or on a detached release; the release tag on remote main; a backup of the private state; npm ci; the release check;
# a PM2 restart; the new version served. If the new version does not come up, the previous one is put back and restarted.
# Args: checkout, target version, expected HEAD (full), PM2 id, port, progress file, node binary, GitHub repo, current version.
set -uo pipefail
dir=$1 target=$2 expected=$3 pmid=$4 port=$5 status=$6 node=$7 repo=$8 from=$9
tag="v$target"
# Tests shorten the waits; the daemon passes no such variables.
tries=${POCKET_SELF_UPDATE_TRIES:-45} settle=${POCKET_SELF_UPDATE_SETTLE:-10} beat=${POCKET_SELF_UPDATE_BEAT:-60} idle=${POCKET_SELF_UPDATE_IDLE_TRIES:-300}
branch='' prev='' moved=0

# say <phase> [error] [backup dir]: rewrite the progress file atomically. 1.124.4: it returns the writer's status (it returned
# echo's, so a progress write that failed went unnoticed and the job sat at its last phase); each call says what a failure does.
say() {
  local rc
  "$node" -e '
const fs=require("fs");const [f,phase,error,backup]=process.argv.slice(1);
let j={};try{j=JSON.parse(fs.readFileSync(f,"utf8"));}catch{}
Object.assign(j,{phase,updatedAt:Date.now()});if(error)j.error=error;if(backup)j.backup=backup;
if(phase==="complete"||phase==="failed")j.finishedAt=Date.now();
const t=f+".tmp";fs.writeFileSync(t,JSON.stringify(j,null,2),{mode:0o600});fs.renameSync(t,f);' "$status" "$1" "${2:-}" "${3:-}"; rc=$?
  echo "$(date -u +%H:%M:%S) $1${2:+: $2}"
  [ "$rc" = 0 ] || echo "$(date -u +%H:%M:%S) could not write $1 to $(basename "$status")"
  return "$rc"
}
# A failed `say failed` is not checked: the script exits 1 either way, and the log has the reason.
fail() { say failed "$1"; exit 1; }
# 1.124.4: a progress write that failed before the checkout moves stops the update; fail tries once more to record why.
unwritten() { fail "Pocket could not write the update's progress to its data folder, so it stopped. Nothing was changed."; }
served() { # the version Pocket serves on its port, or nothing
  "$node" -e 'fetch(`http://127.0.0.1:${process.argv[1]}/release.json`,{signal:AbortSignal.timeout(5000)}).then(r=>r.json()).then(j=>process.stdout.write(String(j.version||""))).catch(()=>{})' "$port"
}
# The PID PM2 has for our process. `pm2 pid` takes only a name and prints nothing for an id, so read it from jlist.
app_pid() {
  pm2 jlist 9>&- 2>/dev/null | "$node" -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{try{const a=JSON.parse(t.slice(t.indexOf("[")));const p=a.find(x=>String(x.pm_id)===process.argv[1]);process.stdout.write(String(p?.pid||""));}catch{}})' "$pmid"
}
busy() { # the replies a restart would cut short, from the daemon's /api/health (1.124.3); 0 when it does not say
  "$node" -e 'fetch(`http://127.0.0.1:${process.argv[1]}/api/health`,{signal:AbortSignal.timeout(5000)}).then(r=>r.json()).then(j=>process.stdout.write(String(Number(j.busy)||0))).catch(()=>process.stdout.write("0"))' "$port"
}
healthy() { "$node" -e 'fetch(`http://127.0.0.1:${process.argv[1]}/api/health`,{signal:AbortSignal.timeout(5000)}).then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))' "$port"; }
# wait_for <version> <old pid>: up to 90 s for a new process to serve it and answer health, then still the same process and
# still healthy 10 s later (one that crashes on boot and is restarted by PM2 fails here). release.json is read from disk, so
# the version alone would also match the old process once the checkout has moved: the PID must change too.
wait_for() {
  local pid=''
  for _ in $(seq 1 "$tries"); do
    sleep 2; pid=$(app_pid)
    if [ -n "$pid" ] && [ "$pid" != 0 ] && [ "$pid" != "$2" ] && [ "$(served)" = "$1" ] && healthy; then
      sleep "$settle"; [ "$(app_pid)" = "$pid" ] && healthy && return 0; return 1
    fi
  done; return 1
}
put_back() { # return the checkout and its packages to what was running; fails when either could not be put back
  [ "$moved" = 1 ] || return 0
  if [ "$branch" = main ]; then git reset -q --hard "$prev"; else git checkout -q --detach "$prev"; fi || return 1
  npm ci --silent --no-audit --no-fund
}
# 1.124.2: npm ci removes node_modules before it installs, so when putting the old packages back fails too, the running daemon
# works only from what it has loaded and will not start again: say so, and what to run, instead of "Pocket stays on".
not_back() { fail "$1, and putting $from's packages back failed too. Pocket keeps running for now but will not start again after a restart until you run npm ci in $dir on the server. Backup: $backup"; }

cd "$dir" || fail 'Could not open the Pocket Code folder. Nothing was changed.'
# 1.124.3: the tools are checked before the lock is taken. macOS has no flock(1), and the lock then failed every time with
# "Another Pocket Code update is running". The backup takes GNU tar's options; on macOS tar is bsdtar, and GNU tar is gtar.
for tool in git npm pm2 tar flock; do command -v "$tool" >/dev/null || fail "$tool is not on Pocket's PATH, so it cannot update itself. Update it from the server."; done
gnutar=$(command -v gtar || command -v tar)
case "$("$gnutar" --version 2>/dev/null)" in *'GNU tar'*) ;; *) fail "Pocket's backup needs GNU tar, and $gnutar is not GNU tar. Install it (on macOS: brew install gnu-tar), or update Pocket from the server. Nothing was changed." ;; esac
exec 9>"$status.lock"
flock -n 9 || fail 'Another Pocket Code update is running.'
# 1.124.3: a heartbeat. The daemon takes a job silent for 20 minutes for one that died with its server, and a large backup or
# a slow npm ci can be quiet that long; touching the lock file keeps it running. It stops with the script (the trap, or at its
# next beat if the script was killed), and does not hold the lock (fd 9 closed), even in the sleep it leaves behind.
( while sleep "$beat" && kill -0 $$ 2>/dev/null; do touch "$status.lock"; done ) 9>&- >/dev/null 2>&1 &
beater=$!
trap 'kill "$beater" 2>/dev/null' EXIT
say checking || unwritten
origin=$(git config --get remote.origin.url)
case "$origin" in
  "https://github.com/$repo"|"https://github.com/$repo.git"|"git@github.com:$repo.git") ;;
  *) fail "This checkout does not come from github.com/$repo, so Pocket will not update it by itself. Update it from the server." ;;
esac
branch=$(git branch --show-current)
[ "$branch" = main ] || [ -z "$branch" ] || fail "The checkout is on branch $branch, not main. Update it from the server."
[ -z "$(git status --porcelain --untracked-files=no)" ] || fail 'Files in the Pocket Code folder were changed by hand. Update it from the server.'
prev=$(git rev-parse HEAD)
[ "$prev" = "$expected" ] || fail 'The checkout changed since the update started. Check again.'
git fetch -q origin || fail 'Could not reach GitHub. Nothing was changed; try again.'
git fetch -q origin "refs/tags/$tag:refs/tags/$tag" || fail "Could not fetch release $tag. Nothing was changed."
commit=$(git rev-parse "$tag^{commit}") || fail "Release $tag was not found. Nothing was changed."
git merge-base --is-ancestor "$commit" origin/main || fail "Release $tag is not on main. Nothing was changed."
if [ "$branch" = main ]; then git merge-base --is-ancestor "$prev" "$commit" || fail 'The checkout has commits that are not in the release. Update it from the server.'; fi

say backing-up || unwritten
free_kb=$(df -Pk "$HOME" | awk 'NR==2{print $4}')
[ "${free_kb:-0}" -ge 5242880 ] || fail 'The server has less than 5 GB free, and Pocket needs room for its backup. Free some space, then try again. Nothing was changed.'
backup="$HOME/backups/pocket-code-$target-update-$(date -u +%Y%m%d-%H%M%S)"
mkdir -m 700 -p "$backup" || fail 'Could not make the backup folder. Nothing was changed.'
# 1.124.4: git's own status is read (the pipeline's never was, and grep -zv exits 1 when it filters every name out, so that 1
# is fine). A listing that failed gave an empty archive that passed every check below, and the job completed pointing at it.
git ls-files --others --ignored --exclude-standard -z | grep -zv '^node_modules/' | grep -zv '^\.impeccable/' > "$backup/files.nul"; st=("${PIPESTATUS[@]}")
if [ "${st[0]}" != 0 ] || [ "${st[1]}" -gt 1 ] || [ "${st[2]}" -gt 1 ]; then
  rm -rf -- "$backup"
  fail "Could not list Pocket's private files for the backup, so it stopped. Nothing was changed."
fi
names=$(tr -cd '\0' < "$backup/files.nul" | wc -c)
# 1 = a file changed while it was read (a live log): fine. 1.124.2: 2 is GNU tar's fatal error (a disk that filled, say); a
# turn file that vanished is only a warning under --ignore-failed-read, status 0. The archive must also list back (1.124.4:
# with at least one entry when the listing named files), and a backup that failed is removed, so it neither stays on a full
# disk nor passes for a backup.
"$gnutar" --warning=no-file-changed --ignore-failed-read --null -czf "$backup/private-state.tar.gz" -T "$backup/files.nul"; rc=$?
if [ "$rc" -gt 1 ] || ! [ -s "$backup/private-state.tar.gz" ] || ! entries=$("$gnutar" -tzf "$backup/private-state.tar.gz" 2>/dev/null | wc -l) \
  || { [ "${names:-0}" -gt 0 ] && [ "${entries:-0}" -eq 0 ]; }; then
  rm -rf -- "$backup"
  fail 'The backup could not be written, so Pocket removed it. Nothing was changed. Check that the server has room for the backup, then try again.'
fi
echo "$prev" > "$backup/prev-head.txt"; echo "${branch:-detached}" > "$backup/prev-branch.txt"
chmod 600 "$backup"/*
# Its path could not be recorded, so nothing would point to it: it goes, as a backup that failed does.
say backing-up '' "$backup" || { rm -rf -- "$backup"; unwritten; }

say installing || unwritten
if [ "$branch" = main ]; then git merge --ff-only -q "$commit"; else git checkout -q --detach "$commit"; fi || fail "Could not move to $tag. Nothing was changed."
moved=1
npm ci --silent --no-audit --no-fund || { put_back || not_back "Installing $tag's packages failed"; fail "Installing $tag's packages failed. Pocket stays on $from."; }
npm run -s check:release -- --released || { put_back || not_back "$tag did not pass its release check"; fail "$tag did not pass its release check. Pocket stays on $from."; }

# 1.124.3: the daemon checked for running replies when Update was pressed, and a reply can start in the minutes since (a
# message, a check-back, a job). Wait for them, up to 10 minutes, so the restart does not cut one short; if they keep
# running, put the version that is running back rather than restart under them.
n=0
for _ in $(seq 1 "$idle"); do n=$(busy); [ "$n" = 0 ] && break; echo "$(date -u +%H:%M:%S) waiting for $n replies to finish"; sleep 2; done
if [ "$n" != 0 ]; then put_back || not_back 'Replies kept running while Pocket waited to restart'; fail "Replies kept running while Pocket waited to restart, so it did not restart and stays on $from. Update again when they finish."; fi
# 1.124.4: the checkout has moved, so a failed write here puts the running version back, as the other failures before the
# restart do.
say restarting || { put_back || not_back "Pocket could not write the update's progress"; fail "Pocket could not write the update's progress to its data folder, so it did not restart and stays on $from."; }
old_pid=$(app_pid)
pm2 restart "$pmid" 9>&- >/dev/null
if wait_for "$target" "$old_pid"; then
  pm2 save 9>&- >/dev/null 2>&1
  # 1.124.4: tried twice. If it still fails the install is updated but the job would read restarting, then interrupted: say
  # so in the log and exit non-zero, not 0.
  say complete || { sleep 1; say complete; } || { echo "$(date -u +%H:%M:%S) $target is installed and running, but the result could not be recorded in $(basename "$status"). The job will show as interrupted; the version Pocket shows is the one running."; exit 2; }
  exit 0
fi
# A failed write here is not checked: putting the running version back matters more, and the fail below records the result.
say rolling-back
# 1.124.3: a put-back that failed is said, not restarted into "Pocket went back": the new version is not running, and the old
# one cannot start without its checkout and packages.
put_back || fail "$target did not start, and putting $from back failed too. Pocket may not be running: on the server, check out $from in $dir (its commit is in prev-head.txt in the backup), run npm ci in $dir and restart it with PM2. Backup: $backup"
old_pid=$(app_pid)
pm2 restart "$pmid" 9>&- >/dev/null
wait_for "$from" "$old_pid" || fail "$target did not start, and Pocket could not confirm $from came back. Check the server. Backup: $backup"
fail "$target did not start, so Pocket went back to $from. The log is $(basename "$status" .json).log in Pocket's data folder."
