# Приглашение в админку из командной строки (если бот недоступен):
#   DATABASE_URL=... python3 tools/admin_invite.py [owner|admin|viewer] [адрес сайта]
# Печатает одноразовую ссылку, действует 7 дней.
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from admin import Admin, ROLES  # noqa: E402
from catalog_bot import Store  # noqa: E402

role = sys.argv[1] if len(sys.argv) > 1 else "owner"
site = (sys.argv[2] if len(sys.argv) > 2 else os.environ.get("SITE_URL", "http://localhost:8080")).rstrip("/")
if role not in ROLES or not os.environ.get("DATABASE_URL"):
    sys.exit("Использование: DATABASE_URL=... python3 tools/admin_invite.py [owner|admin|viewer] [адрес сайта]")
code = Admin(Store(os.environ["DATABASE_URL"])).create_invite(role)
print(f"{site}/admin?invite={code}")
