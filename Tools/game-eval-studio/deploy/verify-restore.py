"""Back up this app and verify a restore to a NEW database. Never overwrite a database.
Runs on the server. Credentials and record contents are never printed.
"""
import argparse
import os
from pathlib import Path
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--directory', required=True)
parser.add_argument('--release', required=True)
parser.add_argument('--restore-database', default='gameeval_restore_deployment')
args = parser.parse_args()
assert re.fullmatch(r'gameeval_restore_[a-z0-9_]+', args.restore_database)
directory = Path(args.directory).resolve()
compose = ['docker', 'compose', '--env-file', str(directory / '.env'), '-f', str(Path(args.release).resolve() / 'compose.yaml')]
execute = compose + ['exec', '-T', 'db']

def query(database, sql):
    return subprocess.run(execute + ['psql', '-U', 'postgres', '-d', database, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], check=True, capture_output=True, text=True).stdout.strip()

assert query('postgres', f"SELECT count(*) FROM pg_database WHERE datname='{args.restore_database}'") == '0', 'Restore database already exists; refusing to overwrite'
backups = directory / 'backups'
backups.mkdir(mode=0o700, exist_ok=True)
backup = backups / 'deployment-verified.dump'
fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'wb') as stream:
    subprocess.run(execute + ['pg_dump', '-U', 'postgres', '-d', 'gameeval', '-Fc'], check=True, stdout=stream)
subprocess.run(execute + ['createdb', '-U', 'postgres', '-O', 'gameeval', args.restore_database], check=True)
with backup.open('rb') as stream:
    subprocess.run(execute + ['pg_restore', '-U', 'postgres', '-d', args.restore_database, '--no-owner', '--role=gameeval', '--exit-on-error'], check=True, stdin=stream)
tables = query('gameeval', "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").splitlines()
assert tables and tables == query(args.restore_database, "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").splitlines()
for table in tables:
    assert re.fullmatch(r'[A-Za-z_]+', table)
    sql = f'''SELECT count(*)::text || ':' || md5(coalesce(string_agg(to_jsonb(t)::text, ',' ORDER BY to_jsonb(t)::text), '')) FROM "{table}" t'''
    assert query('gameeval', sql) == query(args.restore_database, sql), f'Restored data differs in {table}'
assert query(args.restore_database, "SELECT rolsuper::int + rolcreatedb::int + rolcreaterole::int FROM pg_roles WHERE rolname='gameeval'") == '0'
print(f'PASS private pg_dump and isolated restore; all {len(tables)} tables match; application role has no administrative privileges')
print('Restore database and private backup retained for operator inspection')
