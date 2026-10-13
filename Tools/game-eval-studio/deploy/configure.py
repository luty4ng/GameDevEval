"""Create private server deployment configuration, without printing secrets.
Run once on the target server. A second run never overwrites credentials.
"""
import argparse
import json
import os
from pathlib import Path
import secrets
from urllib.parse import urlparse

parser = argparse.ArgumentParser()
parser.add_argument('--directory', required=True)
parser.add_argument('--origin', required=True)
parser.add_argument('--revision', required=True)
parser.add_argument('--admin-email', default='admin@gameeval.local')
parser.add_argument('--access-mode', choices=('public', 'ssh'), default='public')
args = parser.parse_args()
origin = urlparse(args.origin)
if args.access_mode == 'ssh':
    assert args.origin == 'http://127.0.0.1:3000', 'SSH deployment binds only port 3000 on loopback'
else:
    assert origin.scheme == 'https' and origin.hostname and origin.path == ''
assert '\n' not in args.admin_email and '@' in args.admin_email
assert len(args.revision) == 40 and all(c in '0123456789abcdef' for c in args.revision)
directory = Path(args.directory).resolve()
directory.mkdir(mode=0o700, parents=True, exist_ok=True)
if (directory / '.env').exists() or (directory / 'initial-admin.json').exists():
    raise SystemExit('Configuration already exists; refusing to overwrite credentials')

def private_file(name, contents):
    fd = os.open(directory / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        stream.write(contents)

private_file('.env', '\n'.join([
    f'DB_ADMIN_PASSWORD={secrets.token_hex(32)}', f'DB_PASSWORD={secrets.token_hex(32)}',
    f'AUTH_SECRET={secrets.token_hex(32)}', f'APP_URL={args.origin}',
    f'APP_HOST={origin.hostname}', f'ACCESS_MODE={args.access_mode}',
    f'APP_REVISION={args.revision}', 'TRAEFIK_HTTPS_ENTRYPOINT=websecure',
    'TRAEFIK_CERT_RESOLVER=letsencrypt', '',
]))
private_file('initial-admin.json', json.dumps({'email': args.admin_email, 'name': '平台管理员', 'password': secrets.token_urlsafe(32)}, ensure_ascii=False) + '\n')
print('Private configuration and initial administrator input created')
