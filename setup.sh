#!/bin/bash
# Одна команда: спрашивает токен, находит chat id, кладёт оба в секреты GitHub, запускает проверку.
set -e
REPO="7gts7sfvvg-blip/zp-outage-bot"
read -rsp "Вставьте токен бота (Cmd+V) и нажмите Enter: " TG_TOKEN; echo
case "$TG_TOKEN" in
  [0-9]*:*) ;;
  *) echo "Это не токен. Нужен вид 123456789:AA... из @BotFather"; exit 1;;
esac

echo "Ищу ваш chat id (бот должен получить от вас хоть одно сообщение)..."
CHAT=$(TG_TOKEN="$TG_TOKEN" python3 - <<'PY'
import json, os, urllib.request
t = os.environ["TG_TOKEN"]
d = json.load(urllib.request.urlopen(f"https://api.telegram.org/bot{t}/getUpdates", timeout=30))
ids = [u["message"]["chat"]["id"] for u in d.get("result", []) if "message" in u]
print(ids[-1] if ids else "")
PY
)
if [ -z "$CHAT" ]; then
  echo "Пусто. Откройте своего бота в Telegram, нажмите Start / напишите «привет» и запустите скрипт снова."
  exit 1
fi
echo "chat id: $CHAT"

printf %s "$TG_TOKEN" | gh secret set TG_TOKEN -R "$REPO"
printf %s "$CHAT" | gh secret set TG_CHAT_ID -R "$REPO"
gh workflow run check.yml -R "$REPO"
echo "Готово. Через минуту в Telegram придёт первое сообщение с графиком."
