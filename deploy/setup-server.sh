#!/usr/bin/env bash
# One-time setup of the Ednovax Support Desk on the VPS. Run it on the server, as the user GitHub
# Actions deploys with, after the first deploy has copied the code to /var/www/support-desk:
#
#   bash /var/www/support-desk/deploy/setup-server.sh
#
# It is safe to run again: nothing that already exists is overwritten (the .env, the database).
# It needs sudo for systemd, nginx and the sudoers rule that lets deploys restart the desk.
set -euo pipefail

APP_DIR=/var/www/support-desk
API_PORT=8795
DB_PORT=6395
DOMAIN=support.ednovax.com
SERVICE=support-desk
DEPLOY_USER=$(whoami)
NODE_BIN=$(command -v node || true)

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
fail() { printf '\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

cd "$APP_DIR" || fail "$APP_DIR doesn't exist yet. Push to main once so GitHub Actions copies the code, then run this again."
[ -n "$NODE_BIN" ] || fail "Node.js isn't installed (or not on PATH). Install Node 20.19 or newer first."
"$NODE_BIN" -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 20 || (major === 20 && minor >= 19) ? 0 : 1)' || fail "Node $("$NODE_BIN" -v) is too old: the desk needs 20.19 or newer."
command -v docker >/dev/null || fail "Docker isn't installed. The desk's FalkorDB runs in Docker."
# Users outside the docker group need sudo for Docker.
DOCKER=docker
docker info >/dev/null 2>&1 || DOCKER="sudo docker"
$DOCKER compose version >/dev/null 2>&1 || fail "Docker Compose v2 is missing (the docker compose command). Install the docker-compose-plugin package."
compose() { $DOCKER compose -p support-desk -f deploy/docker-compose.yml --env-file .env "$@"; }

say "Writing .env (kept if it exists)"
if [ ! -f .env ]; then
  cat > .env <<EOF
# Ednovax Support Desk, production. Keys (Anthropic, GitHub, WhatsApp) are set in the dashboard.
NODE_ENV=production
HOST=127.0.0.1
PORT=$API_PORT
PUBLIC_URL=https://$DOMAIN

FALKORDB_HOST=127.0.0.1
FALKORDB_PORT=$DB_PORT
FALKORDB_USERNAME=
FALKORDB_PASSWORD=$(openssl rand -hex 24)

# Encrypts the keys saved in Settings. Keep it: changing it means entering the keys again.
APP_SECRET=$(openssl rand -hex 32)
ID_HASH_SALT=$(openssl rand -hex 16)

# The staff accounts' password when they are first created, and whether the login screen lists them.
DEMO_PASSWORD=$(openssl rand -base64 12 | tr -d '/+=')
SHOW_DEMO_ACCOUNTS=false
# The demo visitor (sees only the demo school) is listed on the login screen with this password.
DEMO_VISITOR_PASSWORD=ednovax-demo
SHOW_DEMO_VISITOR=true
EOF
  chmod 600 .env
  echo "Created. The staff password is in .env (DEMO_PASSWORD)."
else
  echo "Already there, left as it is."
fi

say "Checking the desk's ports are free (API $API_PORT, FalkorDB $DB_PORT)"
port_busy() { sudo ss -ltnH "sport = :$1" | grep -q .; }
show_port() { sudo ss -ltnp "sport = :$1"; }
# A port the desk itself already holds (a second run of this script) is fine.
if ! systemctl is-active --quiet "$SERVICE" && port_busy "$API_PORT"; then
  show_port "$API_PORT"
  fail "Port $API_PORT is used by another program. Change it in this script, deploy/nginx-$DOMAIN.conf and .env."
fi
if [ -z "$(compose ps -q falkordb 2>/dev/null)" ] && port_busy "$DB_PORT"; then
  show_port "$DB_PORT"
  fail "Port $DB_PORT is used by another program. Change it in this script and in .env (FALKORDB_PORT)."
fi
echo "Both free (or already the desk's own)."

say "Starting FalkorDB (Docker, 127.0.0.1:$DB_PORT)"
compose up -d

say "Installing dependencies and building the dashboard"
npm install --no-audit --no-fund
npm run build
npm run model:fetch

say "Installing the systemd service"
sed -e "s|__USER__|$DEPLOY_USER|" -e "s|__NODE__|$NODE_BIN|" deploy/support-desk.service | sudo tee /etc/systemd/system/$SERVICE.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now $SERVICE

say "Letting deploys restart the desk without a password (this service only)"
SYSTEMCTL=$(command -v systemctl)
echo "$DEPLOY_USER ALL=(root) NOPASSWD: $SYSTEMCTL restart $SERVICE, $SYSTEMCTL is-active $SERVICE" | sudo tee /etc/sudoers.d/$SERVICE >/dev/null
sudo chmod 440 /etc/sudoers.d/$SERVICE
sudo visudo -cf /etc/sudoers.d/$SERVICE >/dev/null

say "Adding the nginx site ($DOMAIN on 8080)"
sudo cp deploy/nginx-$DOMAIN.conf /etc/nginx/sites-available/support-desk
sudo ln -sf /etc/nginx/sites-available/support-desk /etc/nginx/sites-enabled/support-desk
sudo nginx -t
sudo systemctl reload nginx

say "Checking the API answers"
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$API_PORT/api/auth/demo-accounts"; then echo "The desk is up."; break; fi
  sleep 2
done
curl -fsS -o /dev/null "http://127.0.0.1:$API_PORT/api/auth/demo-accounts" || fail "The API didn't start. See: journalctl -u $SERVICE -n 50"

cat <<EOF

Done. Two things left, outside this server's config files:
  1. DNS: point $DOMAIN at this server (an A record), unless *.ednovax.com already does.
  2. Caddy: add this site and reload Caddy (sudo systemctl reload caddy):

     $DOMAIN {
         reverse_proxy 127.0.0.1:8080
     }

Then open https://$DOMAIN and sign in as support@ednovax.com with the DEMO_PASSWORD from $APP_DIR/.env.
Add the Anthropic key and GitHub token in Settings → Connections (this is a fresh database).
EOF
