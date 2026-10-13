"""Verify one isolated deployment probe account. Never print credentials or cookies."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import http.cookiejar
import json
from pathlib import Path
import urllib.request
import urllib.error

parser = argparse.ArgumentParser()
parser.add_argument('--directory', required=True)
parser.add_argument('--phase', choices=('setup', 'checkpoint', 'persisted'), required=True)
args = parser.parse_args()
directory = Path(args.directory)
probe = json.loads((directory / 'probe-input.json').read_text())
origin = 'http://127.0.0.1:3000'

def client():
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    def call(path, body=None, method=None, request_origin=origin):
        data = json.dumps(body).encode() if body is not None else None
        headers = {'Origin': request_origin}
        if data is not None:
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(origin + path, data=data, method=method or ('POST' if data else 'GET'), headers=headers)
        try:
            with opener.open(request, timeout=20) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)
    return call

member = client()
if args.phase == 'setup':
    assert client()('/api/workspace')[0] == 401
    admin = client()
    credentials = json.loads((directory / 'initial-admin.json').read_text())
    assert admin('/api/auth/sign-in/email', {'email': credentials['email'], 'password': credentials['password']})[0] == 200
    status, invitation = admin('/api/admin/invites', {'email': probe['email']})
    assert status == 200
    token = invitation['url'].split('#invite=')[1]
    body = {**probe, 'token': token}
    assert client()('/api/register', body)[0] == 200
    assert client()('/api/register', body)[0] == 400
    assert member('/api/auth/sign-in/email', {'email': probe['email'], 'password': probe['password']})[0] == 200
    assert member('/api/admin/users')[0] == 403
    assert member('/api/preferences', {}, 'PUT', 'https://foreign.example')[0] == 403
    preferences = {'engine': 'Godot', 'engineVersion': '4.5', 'platform': 'Windows', 'difficulty': '专家', 'timeBudget': 60, 'passThreshold': 80}
    assert member('/api/preferences', {'name': probe['name'], 'preferences': preferences}, 'PUT')[0] == 200
    assert admin('/api/workspace')[1]['data']['projects'] == []
    print('PASS live registration, login, invitation replay rejection, roles, Origin and preferences')
else:
    assert member('/api/auth/sign-in/email', {'email': probe['email'], 'password': probe['password']})[0] == 200
    if args.phase == 'checkpoint':
        current = member('/api/workspace')[1]
        assert current['data']['projects'] and current['data']['projects'][0]['versions']
        payload = {'revision': current['revision'], 'data': current['data']}
        with ThreadPoolExecutor(max_workers=2) as executor:
            statuses = list(executor.map(lambda _: member('/api/workspace', payload, 'PUT')[0], range(2)))
        assert sorted(statuses) == [200, 409]
        state = {'workspace': member('/api/workspace')[1], 'preferences': member('/api/me')[1]['preferences']}
        (directory / 'probe-checkpoint.json').write_text(json.dumps(state), encoding='utf-8')
        print('PASS live simultaneous-save conflict; persisted checkpoint recorded')
    else:
        state = json.loads((directory / 'probe-checkpoint.json').read_text())
        assert member('/api/workspace')[1] == state['workspace']
        assert member('/api/me')[1]['preferences'] == state['preferences']
        print('PASS workspace, frozen version and preferences survived App/DB restart')
