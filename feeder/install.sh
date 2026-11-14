#!/bin/bash
# Ставит feeder как задачу launchd: раз в 2 минуты читает сайт и публикует снимок графика.
# Удалить: bash install.sh remove
set -e
LABEL=com.zp-outage.feeder
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR="$(cd "$(dirname "$0")" && pwd)"

if [ "$1" = "remove" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Удалено."
  exit 0
fi

PY="$(command -v python3)"
GH_BIN="$(command -v gh)"
[ -n "$GH_BIN" ] || { echo "Не найден gh (GitHub CLI)"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Войдите в GitHub: gh auth login"; exit 1; }

curl -s -m 20 -o /dev/null -w "%{http_code}" -A "Mozilla/5.0" https://www.zoe.com.ua/outage/ | grep -q 200 \
  || { echo "Сайт zoe.com.ua не открывается с этого компьютера — нужен украинский IP."; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$PY</string><string>$DIR/feeder.py</string></array>
  <key>StartInterval</key><integer>120</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$GH_BIN"):/usr/bin:/bin</string></dict>
  <key>StandardOutPath</key><string>$HOME/.zp-outage-feeder.log</string>
  <key>StandardErrorPath</key><string>$HOME/.zp-outage-feeder.log</string>
</dict></plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Готово. Работает раз в 2 минуты, пока Mac включён. Журнал: ~/.zp-outage-feeder.log"
