#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 (or 22.04) VPS, run as root:
#   ssh root@SERVER_IP 'bash -s' < deploy/bootstrap-vps.sh
# Installs Docker from Docker's apt repository, opens only SSH/HTTP/HTTPS, adds swap on small
# servers, enables automatic security updates, and schedules nightly database backups.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (or with sudo)." >&2
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive

echo "==> Base packages"
apt-get update -y
apt-get install -y ca-certificates curl gnupg rsync ufw unattended-upgrades openssl

echo "==> Docker Engine + Compose plugin"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "==> Firewall: SSH, HTTP, HTTPS only"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> Swap (building the images needs ~3 GB of memory)"
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [[ $mem_mb -lt 7000 ]] && ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> App directory and nightly backups"
mkdir -p /opt/tricity /var/backups/tricity
cat > /etc/cron.d/tricity-backup <<'EOF'
# Nightly PostgreSQL dump at 03:15 server time; keeps 14 days.
15 3 * * * root /opt/tricity/deploy/backup.sh >> /var/log/tricity-backup.log 2>&1
EOF

echo "Done. Next, from your computer: deploy/deploy.sh root@$(curl -fsS --max-time 5 https://api.ipify.org || echo SERVER_IP)"
