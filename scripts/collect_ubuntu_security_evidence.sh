#!/usr/bin/env bash
# Read-only collection for AutoClip Q3 evidence. Run as the logged-in administrator.
set -euo pipefail

section() { printf '\n## %s\n' "$1"; }
run() { printf '\n$ %s\n' "$*"; "$@" 2>&1 || true; }

section "Collection metadata"
date --iso-8601=seconds
id -un
run uname -a
run lsb_release -ds

section "Automatic security updates"
run systemctl is-enabled apt-daily.timer
run systemctl is-enabled apt-daily-upgrade.timer
run systemctl is-active apt-daily.timer
run systemctl is-active apt-daily-upgrade.timer
if [[ -r /etc/apt/apt.conf.d/20auto-upgrades ]]; then
  run sed -n '1,120p' /etc/apt/apt.conf.d/20auto-upgrades
fi
printf 'Only the automatic-update controls are collected; proxy/repository settings are intentionally omitted.\n'

section "Pending security updates"
run apt list --upgradable

section "Host firewall"
if command -v ufw >/dev/null 2>&1; then
  run ufw status verbose
else
  printf 'ufw is not installed; document the firewall/host-exposure decision.\n'
fi

section "Endpoint protection and antimalware inventory"
for service in clamav-daemon clamav-freshclam falcon-sensor sophos-spl; do
  if systemctl list-unit-files "$service.service" --no-legend 2>/dev/null | grep -q .; then
    run systemctl is-enabled "$service"
    run systemctl is-active "$service"
  fi
done
for scanner in clamscan freshclam; do
  if command -v "$scanner" >/dev/null 2>&1; then
    run "$scanner" --version
  fi
done

section "Session-lock configuration"
if command -v gsettings >/dev/null 2>&1; then
  run gsettings get org.gnome.desktop.screensaver lock-enabled
  run gsettings get org.gnome.desktop.screensaver lock-delay
  run gsettings get org.gnome.desktop.session idle-delay
fi

section "Account password state"
run passwd -S "$(id -un)"
printf '\nManual evidence still required: lock the session, wait five minutes, and confirm that the account password is required to unlock it.\n'
