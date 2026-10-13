"""Read account credentials interactively; emit JSON only on stdout for piping.
Usage: python scripts/account-input.py admin | docker compose run --rm -T app npm run admin:init
"""
import getpass
import json
import sys

if len(sys.argv) != 2 or sys.argv[1] not in ('admin', 'reset-password'):
    raise SystemExit('Usage: account-input.py admin|reset-password')
print('Email: ', file=sys.stderr, end='', flush=True)
email = sys.stdin.readline().strip()
body = {'email': email}
if sys.argv[1] == 'admin':
    print('Display name: ', file=sys.stderr, end='', flush=True)
    body['name'] = sys.stdin.readline().strip()
password = getpass.getpass('Password (15+ characters): ')
confirmation = getpass.getpass('Confirm password: ')
if len(password) < 15 or len(password) > 128 or password != confirmation:
    raise SystemExit('Password length or confirmation is invalid.')
body['password'] = password
print(json.dumps(body, ensure_ascii=False))
